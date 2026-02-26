import { db } from "../db.js";

export function normalizeReviewGateStatus(value: unknown): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "in_review" || raw === "in_progress") return "under_review";
  if (raw === "error" || raw === "failed") return "error";
  return "draft";
}

export function isReviewGateSatisfied(value: unknown) {
  return normalizeReviewGateStatus(value) === "reviewed";
}

export function normalizeDedupeMode(value: unknown): "skip" | "overwrite" | "keep_both" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "overwrite") return "overwrite";
  if (raw === "keep_both" || raw === "keep-both" || raw === "keepboth") return "keep_both";
  return "skip";
}

function provisionStepCode(value: string | null | undefined): string | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "import" || raw === "import_files" || raw === "import-files") return "IMPORT_FILES";
  if (raw === "tmx" || raw === "tmx_seeding" || raw === "tmx-seeding") return "TMX_SEEDING";
  if (raw === "llm" || raw === "llm_seeding" || raw === "llm-seeding") return "LLM_SEEDING";
  if (raw === "rules" || raw === "apply_rules" || raw === "apply-rules") return "APPLY_RULES";
  if (raw === "glossary" || raw === "apply_glossary" || raw === "apply-glossary") return "APPLY_GLOSSARY";
  if (raw === "finalize") return "FINALIZE";
  return String(value || "").trim().toUpperCase() || null;
}

export async function readProvisionState(projectId: number) {
  const stepTemplates: Array<{ key: string; label: string }> = [
    { key: "IMPORT_FILES", label: "Import files" },
    { key: "TMX_SEEDING", label: "TMX seeding" },
    { key: "LLM_SEEDING", label: "LLM seeding" },
    { key: "APPLY_RULES", label: "Apply rules" },
    { key: "APPLY_GLOSSARY", label: "Apply glossary" },
    { key: "FINALIZE", label: "Finalize" }
  ];
  const projectRes = await db.query<{
    status: string;
    init_error: string | null;
    published_at: string | null;
    provisioning_started_at: string | null;
    provisioning_updated_at: string | null;
    provisioning_finished_at: string | null;
    provisioning_progress: number | null;
    provisioning_current_step: string | null;
  }>(
    `SELECT status,
            init_error,
            published_at,
            provisioning_started_at,
            provisioning_updated_at,
            provisioning_finished_at,
            provisioning_progress,
            provisioning_current_step
     FROM projects
     WHERE id = $1`,
    [projectId]
  );
  const project = projectRes.rows[0];
  if (!project) return null;

  const jobRes = await db.query<{
    status: string;
    step: string | null;
    progress: any;
    error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT status, step, progress, error, created_at, updated_at
     FROM provision_jobs
     WHERE project_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [projectId]
  );
  const job = jobRes.rows[0] ?? null;

  const progress = job?.progress && typeof job.progress === "object" ? job.progress : null;
  const progressPercent = Number(progress?.percent ?? project.provisioning_progress ?? (project.status === "ready" ? 100 : 0));
  const percent = Number.isFinite(progressPercent) ? Math.max(0, Math.min(100, Math.round(progressPercent))) : 0;
  const currentStep =
    provisionStepCode(project.provisioning_current_step) ??
    provisionStepCode(progress?.step) ??
    provisionStepCode(job?.step) ??
    (String(project.status || "").toLowerCase() === "ready" ? "FINALIZE" : "IMPORT_FILES");
  const providedSteps = Array.isArray(progress?.steps) ? progress.steps : [];
  const statusLower = String(project.status || "").toLowerCase();
  const currentStepIndex = Math.max(0, stepTemplates.findIndex((step) => step.key === currentStep));
  const steps =
    providedSteps.length > 0
      ? providedSteps
      : stepTemplates.map((step, index) => {
          let status: "pending" | "running" | "done" | "failed" = "pending";
          if (statusLower === "ready") {
            status = "done";
          } else if (statusLower === "failed") {
            if (index < currentStepIndex) status = "done";
            else if (index === currentStepIndex) status = "failed";
          } else if (statusLower === "provisioning") {
            if (index < currentStepIndex) status = "done";
            else if (index === currentStepIndex) status = "running";
          }
          const stepPercent =
            status === "done"
              ? 100
              : status === "running"
                ? Math.max(0, Math.min(100, percent))
                : 0;
          return {
            key: step.key,
            label: step.label,
            status,
            percent: stepPercent,
            message: null,
            startedAt: null,
            updatedAt: null,
            finishedAt: null
          };
        });
  const startedAt = project.provisioning_started_at
    ? new Date(project.provisioning_started_at).toISOString()
    : job?.created_at
      ? new Date(job.created_at).toISOString()
      : null;
  const updatedAt = project.provisioning_updated_at
    ? new Date(project.provisioning_updated_at).toISOString()
    : job?.updated_at
      ? new Date(job.updated_at).toISOString()
      : project.published_at
        ? new Date(project.published_at).toISOString()
        : null;
  const finishedAt = project.provisioning_finished_at
    ? new Date(project.provisioning_finished_at).toISOString()
    : null;
  const error = String(project.status || "").toLowerCase() === "failed"
    ? project.init_error ?? job?.error ?? null
    : job?.error ?? null;

  const filesRes = await db.query<{
    file_id: number;
    filename: string;
    status: string;
    segment_count: number;
  }>(
    `SELECT
       pf.id AS file_id,
       pf.original_name AS filename,
       COALESCE(pf.status::text, 'queued') AS status,
       COALESCE(COUNT(s.id), 0)::int AS segment_count
     FROM project_files pf
     LEFT JOIN segments s
       ON s.project_id = pf.project_id
      AND s.file_id = pf.id
      AND s.task_id IS NULL
     WHERE pf.project_id = $1
     GROUP BY pf.id
     ORDER BY pf.id ASC`,
    [projectId]
  );

  const logsRes = await db.query<{
    id: string;
    file_id: number;
    stage: string;
    status: string;
    message: string;
    details: any;
    created_at: string;
  }>(
    `SELECT id, file_id, stage, status, message, details, created_at
     FROM project_file_processing_logs
     WHERE project_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 200`,
    [projectId]
  );

  return {
    status: project.status,
    currentStep,
    step: currentStep,
    percent,
    progress: percent,
    steps,
    startedAt,
    updatedAt,
    finishedAt,
    lastUpdate: updatedAt,
    error,
    files: filesRes.rows.map((row) => ({
      fileId: Number(row.file_id),
      filename: String(row.filename || ""),
      status: String(row.status || "").trim().toUpperCase(),
      segmentCount: Number(row.segment_count || 0)
    })),
    logs: logsRes.rows.map((row) => ({
      id: String(row.id || ""),
      fileId: Number(row.file_id),
      stage: String(row.stage || "").trim().toUpperCase(),
      status: String(row.status || "").trim().toUpperCase(),
      message: String(row.message || ""),
      details: row.details && typeof row.details === "object" ? row.details : {},
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    })),
    provisioning: {
      startedAt,
      updatedAt,
      finishedAt,
      progress: percent,
      currentStep,
      steps
    }
  };
}
