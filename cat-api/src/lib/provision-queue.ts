import { db, withTransaction } from "../db.js";

type LoggerLike = {
  info?: (obj: Record<string, any>, msg?: string) => void;
  warn?: (obj: Record<string, any>, msg?: string) => void;
  error?: (obj: Record<string, any>, msg?: string) => void;
  debug?: (obj: Record<string, any>, msg?: string) => void;
};

function logWith(
  logger: LoggerLike | undefined,
  level: "info" | "warn" | "error" | "debug",
  data: Record<string, any>,
  message: string
) {
  const fn = logger?.[level];
  if (typeof fn === "function") {
    fn.call(logger, data, message);
    return;
  }
  const prefix = `[provision:${level}]`;
  console.log(`${prefix} ${message}`, data);
}

export async function enqueueProvisionJob(params: {
  projectId: number;
  step?: string | null;
  log?: LoggerLike;
}) {
  const step = params.step ?? "queued";
  const res = await db.query<{ id: number }>(
    `INSERT INTO provision_jobs(project_id, status, step, progress, error, updated_at)
     VALUES ($1, 'pending', $2, '{}'::jsonb, NULL, NOW())
     RETURNING id`,
    [params.projectId, step]
  );
  const jobId = res.rows[0]?.id ?? null;
  logWith(
    params.log,
    "info",
    { projectId: params.projectId, jobId, step },
    "Provision job enqueued"
  );
  return jobId;
}

export async function enqueueProvisionJobIfImportReady(params: {
  projectId: number;
  step?: string | null;
  log?: LoggerLike;
}) {
  return withTransaction(async (client) => {
    const projectRes = await client.query<{ id: number; status: string }>(
      `SELECT id, status
       FROM projects
       WHERE id = $1
       FOR UPDATE`,
      [params.projectId]
    );
    const project = projectRes.rows[0] ?? null;
    if (!project) {
      logWith(params.log, "warn", { projectId: params.projectId }, "Provision queue skipped: project not found");
      return { queued: false as const, reason: "project_not_found" as const, jobId: null };
    }

    const projectStatus = String(project.status || "").trim().toLowerCase();
    if (projectStatus === "ready") {
      return { queued: false as const, reason: "already_ready" as const, jobId: null };
    }

    const filesRes = await client.query<{ total: number; ready: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE LOWER(status) = 'ready')::int AS ready
       FROM project_files
       WHERE project_id = $1`,
      [params.projectId]
    );
    const totalFiles = Number(filesRes.rows[0]?.total ?? 0);
    const readyFiles = Number(filesRes.rows[0]?.ready ?? 0);
    if (totalFiles <= 0 || readyFiles < totalFiles) {
      return {
        queued: false as const,
        reason: "files_not_ready" as const,
        jobId: null,
        totalFiles,
        readyFiles
      };
    }

    const existingJobRes = await client.query<{ id: number; status: string }>(
      `SELECT id, status
       FROM provision_jobs
       WHERE project_id = $1
         AND status IN ('pending', 'running')
       ORDER BY id DESC
       LIMIT 1`,
      [params.projectId]
    );
    const existingJob = existingJobRes.rows[0] ?? null;
    if (existingJob) {
      return {
        queued: false as const,
        reason: "job_exists" as const,
        jobId: Number(existingJob.id),
        totalFiles,
        readyFiles
      };
    }

    const step = params.step ?? "queued";
    const insertRes = await client.query<{ id: number }>(
      `INSERT INTO provision_jobs(project_id, status, step, progress, error, updated_at)
       VALUES ($1, 'pending', $2, '{}'::jsonb, NULL, NOW())
       RETURNING id`,
      [params.projectId, step]
    );
    const jobId = Number(insertRes.rows[0]?.id ?? 0) || null;
    logWith(
      params.log,
      "info",
      { projectId: params.projectId, jobId, step, totalFiles, readyFiles },
      "Provision job enqueued after import readiness check"
    );
    return {
      queued: true as const,
      reason: "queued" as const,
      jobId,
      totalFiles,
      readyFiles
    };
  });
}
