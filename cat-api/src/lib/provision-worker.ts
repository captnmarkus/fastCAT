import fetch from "node-fetch";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import { enqueuePretranslateJobs } from "./pretranslate-queue.js";
import { applyLanguageProcessingRules } from "./language-processing.js";
import { computeSegmentIssues } from "./segment-issues.js";
import { enqueueProvisionJob } from "./provision-queue.js";
import { runProvisionSeeding, type ProvisionSeedTask } from "./provisioning.js";
import { addFileToAssigned, addProjectToAssigned, addProjectToCreated, touchProjectForUsers } from "./user-buckets.js";
import {
  buildProgress,
  normalizeProjectSettings,
  normalizeTmLangTag,
  parseOptionalBool,
  parseOptionalInt,
  PROVISION_STEPS,
  resolveRulesEnabled,
  resolveTerminologyEnabled,
  toProvisionStepCode,
  type ProvisionStepKey
} from "./provision-worker.helpers.js";

type LoggerLike = {
  info?: (obj: Record<string, any>, msg?: string) => void;
  warn?: (obj: Record<string, any>, msg?: string) => void;
  error?: (obj: Record<string, any>, msg?: string) => void;
  debug?: (obj: Record<string, any>, msg?: string) => void;
};

type ProvisionJobRow = {
  id: number;
  project_id: number;
  status: string;
  step: string | null;
  progress: any;
};

type TranslationTaskRow = {
  id: number;
  file_id: number;
  target_lang: string;
  tmx_id: number | null;
  engine_id: number | null;
  ruleset_id: number | null;
  glossary_id: number | null;
};

type ProjectRow = {
  id: number;
  status: string;
  src_lang: string;
  project_settings: any;
  created_by: string | null;
  assigned_user: string | null;
};

const DEFAULT_POLL_INTERVAL_MS = 2000;
const TMX_SCORE_THRESHOLD = 0.75;
const TMX_BATCH_SIZE = 5;

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

async function updateProvisionJob(params: {
  projectId: number;
  jobId: number;
  status: "pending" | "running" | "done" | "failed";
  step: ProvisionStepKey;
  progress: any;
  error?: string | null;
}) {
  await db.query(
    `UPDATE provision_jobs
     SET status = $2,
         step = $3,
         progress = $4,
         error = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [params.jobId, params.status, params.step, JSON.stringify(params.progress ?? {}), params.error ?? null]
  );

  const progressPercentRaw = Number(params.progress?.percent);
  const progressPercent = Number.isFinite(progressPercentRaw)
    ? Math.max(0, Math.min(100, Math.round(progressPercentRaw)))
    : null;
  const stepCode = toProvisionStepCode(params.step);

  if (params.status === "done") {
    await db.query(
      `UPDATE projects
       SET status = 'ready',
           init_error = NULL,
           published_at = COALESCE(published_at, NOW()),
           provisioning_started_at = COALESCE(provisioning_started_at, NOW()),
           provisioning_updated_at = NOW(),
           provisioning_finished_at = NOW(),
           provisioning_progress = 100,
           provisioning_current_step = $2
       WHERE id = $1`,
      [params.projectId, stepCode]
    );
    return;
  }

  if (params.status === "failed") {
    await db.query(
      `UPDATE projects
       SET status = 'failed',
           init_error = COALESCE($4, init_error),
           provisioning_started_at = COALESCE(provisioning_started_at, NOW()),
           provisioning_updated_at = NOW(),
           provisioning_finished_at = NOW(),
           provisioning_progress = COALESCE($2, provisioning_progress),
           provisioning_current_step = $3
       WHERE id = $1`,
      [params.projectId, progressPercent, stepCode, params.error ?? null]
    );
    return;
  }

  await db.query(
    `UPDATE projects
     SET status = 'provisioning',
         init_error = NULL,
         provisioning_started_at = COALESCE(provisioning_started_at, NOW()),
         provisioning_updated_at = NOW(),
         provisioning_finished_at = NULL,
         provisioning_progress = $2,
         provisioning_current_step = $3
     WHERE id = $1`,
    [params.projectId, progressPercent, stepCode]
  );
}

async function claimNextProvisionJob(): Promise<ProvisionJobRow | null> {
  return withTransaction(async (client) => {
    const res = await client.query<ProvisionJobRow>(
      `WITH file_status AS (
         SELECT project_id,
                COUNT(*)::int AS total_files,
                COUNT(*) FILTER (WHERE LOWER(status) = 'ready')::int AS ready_files
         FROM project_files
         GROUP BY project_id
       ),
       next AS (
         SELECT j.id
         FROM provision_jobs j
         LEFT JOIN file_status fs ON fs.project_id = j.project_id
         WHERE j.status = 'pending'
         ORDER BY
           CASE
             WHEN COALESCE(fs.total_files, 0) > 0
                  AND COALESCE(fs.ready_files, 0) = COALESCE(fs.total_files, 0)
             THEN 0
             ELSE 1
           END ASC,
           j.updated_at ASC,
           j.id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE provision_jobs
       SET status = 'running',
           updated_at = NOW()
       WHERE id IN (SELECT id FROM next)
       RETURNING *`
    );
    return res.rows[0] ?? null;
  });
}

async function loadProject(projectId: number): Promise<ProjectRow | null> {
  const res = await db.query<ProjectRow>(
    `SELECT id, status, src_lang, project_settings, created_by, assigned_user
     FROM projects
     WHERE id = $1
     LIMIT 1`,
    [projectId]
  );
  return res.rows[0] ?? null;
}

async function checkImportReady(projectId: number) {
  const filesRes = await db.query<{ id: number; status: string }>(
    `SELECT id, status FROM project_files WHERE project_id = $1 ORDER BY id ASC`,
    [projectId]
  );
  const totalFiles = filesRes.rows.length;
  const readyFiles = filesRes.rows.filter((row) => String(row.status || "").toLowerCase() === "ready").length;

  const tasksRes = await db.query<{ id: number }>(
    `SELECT id FROM translation_tasks WHERE project_id = $1 ORDER BY id ASC`,
    [projectId]
  );
  const taskIds = tasksRes.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));

  let missingTaskSegments = 0;
  if (taskIds.length > 0) {
    const segRes = await db.query<{ task_id: number; count: number }>(
      `SELECT task_id, COUNT(*)::int AS count
       FROM segments
       WHERE project_id = $1 AND task_id IS NOT NULL
       GROUP BY task_id`,
      [projectId]
    );
    const counts = new Map<number, number>();
    segRes.rows.forEach((row) => counts.set(Number(row.task_id), Number(row.count ?? 0)));
    for (const taskId of taskIds) {
      if ((counts.get(taskId) ?? 0) <= 0) missingTaskSegments += 1;
    }
  }

  const ready = totalFiles > 0 && readyFiles === totalFiles && missingTaskSegments === 0;
  return { ready, totalFiles, readyFiles, missingTaskSegments };
}

async function searchTm(params: {
  tmId: number;
  sourceLang: string;
  targetLang: string;
  text: string;
  limit?: number;
  traceId?: string | null;
}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (params.traceId) headers["x-request-id"] = params.traceId;
  const res = await fetch(`${CONFIG.TM_PROXY_URL}/api/tm/${params.tmId}/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sourceLang: normalizeTmLangTag(params.sourceLang) || params.sourceLang,
      targetLang: normalizeTmLangTag(params.targetLang) || params.targetLang,
      text: params.text,
      limit: params.limit ?? 1
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TM search failed (${res.status}): ${body || "unknown error"}`);
  }
  const data = (await res.json()) as { matches?: Array<{ source: string; target: string; score: number }> };
  return Array.isArray(data.matches) ? data.matches : [];
}

async function seedTmxForTask(params: {
  projectId: number;
  task: TranslationTaskRow;
  srcLang: string;
  log?: LoggerLike;
  traceId?: string | null;
}) {
  const context = {
    projectId: params.projectId,
    taskId: params.task.id,
    fileId: params.task.file_id,
    targetLang: params.task.target_lang,
    tmxId: params.task.tmx_id ?? null
  };

  if (!params.task.tmx_id) {
    return { segmentCount: 0, updatedRows: 0 };
  }

  const segRes = await db.query<{ id: number; src: string; tgt: string | null }>(
    `SELECT id, src, tgt
     FROM segments
     WHERE task_id = $1
     ORDER BY id ASC`,
    [params.task.id]
  );

  const segments = segRes.rows;
  let updatedRows = 0;
  const segmentCount = segments.length;

  for (let i = 0; i < segments.length; i += TMX_BATCH_SIZE) {
    const batch = segments.slice(i, i + TMX_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (seg) => {
        const existing = String(seg.tgt ?? "").trim();
        if (existing) return false;
        const matches = await searchTm({
          tmId: params.task.tmx_id as number,
          sourceLang: params.srcLang,
          targetLang: params.task.target_lang,
          text: seg.src,
          limit: 1,
          traceId: params.traceId ?? null
        });
        if (!matches.length) return false;
        const top = matches[0];
        if (typeof top.score !== "number" || top.score < TMX_SCORE_THRESHOLD) return false;
        const percent = Math.round(Math.max(0, Math.min(1, top.score)) * 100);
        const nextStatus = "reviewed";
        const nextState = "reviewed";
        const updateRes = await db.query(
          `UPDATE segments
           SET tgt = $2,
               status = $3,
               state = $4,
               is_locked = TRUE,
               generated_by_llm = FALSE,
               source_type = 'tmx',
               source_score = $5,
               source_match_id = NULL,
               updated_by = $6,
               updated_at = NOW(),
               version = version + 1
           WHERE id = $1 AND (tgt IS NULL OR BTRIM(COALESCE(tgt, '')) = '')`,
          [seg.id, top.target, nextStatus, nextState, percent, "system"]
        );
        return (updateRes.rowCount ?? 0) > 0;
      })
    );
    updatedRows += results.filter(Boolean).length;
  }

  logWith(
    params.log,
    "info",
    { ...context, segmentCount, updatedRows },
    "TMX seeding completed"
  );

  return { segmentCount, updatedRows };
}

async function applyRulesForProject(params: {
  projectId: number;
  projectSettings: Record<string, any>;
  tasks: TranslationTaskRow[];
  log?: LoggerLike;
}) {
  const rulesetCache = new Map<number, any[]>();
  const projectRulesetId = parseOptionalInt(
    params.projectSettings.languageProcessingRulesetId ??
      params.projectSettings.language_processing_ruleset_id ??
      params.projectSettings.rulesetId ??
      params.projectSettings.defaultRulesetId ??
      params.projectSettings.default_ruleset_id
  );

  let updatedRows = 0;
  let checked = 0;

  for (const task of params.tasks) {
    const effectiveRulesetId = task.ruleset_id ?? projectRulesetId ?? null;
    if (!effectiveRulesetId) continue;
    if (!rulesetCache.has(effectiveRulesetId)) {
      const res = await db.query<{ rules: any }>(
        "SELECT rules FROM language_processing_rulesets WHERE id = $1",
        [effectiveRulesetId]
      );
      rulesetCache.set(
        effectiveRulesetId,
        Array.isArray(res.rows[0]?.rules) ? res.rows[0]!.rules : []
      );
    }
    const rules = rulesetCache.get(effectiveRulesetId) ?? [];
    if (!Array.isArray(rules) || rules.length === 0) continue;

    const segRes = await db.query<{ id: number; tgt: string | null }>(
      `SELECT id, tgt
       FROM segments
       WHERE task_id = $1
         AND source_type IN ('tmx', 'nmt')
         AND BTRIM(COALESCE(tgt, '')) <> ''
       ORDER BY id ASC`,
      [task.id]
    );

    for (const seg of segRes.rows) {
      checked += 1;
      const current = String(seg.tgt ?? "");
      const result = applyLanguageProcessingRules(current, rules, { scope: "target" });
      if (result.output === current) continue;
      const updateRes = await db.query(
        `UPDATE segments
         SET tgt = $2,
             updated_by = $3,
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1`,
        [seg.id, result.output, "system"]
      );
      if ((updateRes.rowCount ?? 0) > 0) updatedRows += 1;
    }
  }

  logWith(
    params.log,
    "info",
    { projectId: params.projectId, checked, updatedRows },
    "Rules postprocessing completed"
  );

  return { checked, updatedRows };
}

async function loadTermbaseIndex(params: { projectId: number; taskId: number | null }) {
  const projectId = Number(params.projectId);
  if (!Number.isFinite(projectId) || projectId <= 0) return null;
  let glossaryId: number | null = null;
  let sourceLang = "";
  let targetLang = "";

  if (params.taskId != null) {
    const taskId = Number(params.taskId);
    if (!Number.isFinite(taskId) || taskId <= 0) return null;
    const taskRes = await db.query<{
      glossary_id: number | null;
      target_lang: string | null;
      src_lang: string;
      tgt_lang: string;
      project_glossary: number | null;
    }>(
      `SELECT t.glossary_id,
              t.target_lang,
              p.src_lang,
              p.tgt_lang,
              p.glossary_id AS project_glossary
       FROM translation_tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1 AND p.id = $2
       LIMIT 1`,
      [taskId, projectId]
    );
    const taskRow = taskRes.rows[0];
    if (!taskRow) return null;
    glossaryId = taskRow.glossary_id ?? taskRow.project_glossary ?? null;
    sourceLang = String(taskRow.src_lang || "").trim();
    targetLang = String(taskRow.target_lang || taskRow.tgt_lang || "").trim();
  } else {
    const projRes = await db.query<{ glossary_id: number | null; src_lang: string; tgt_lang: string }>(
      `SELECT glossary_id, src_lang, tgt_lang
       FROM projects
       WHERE id = $1
       LIMIT 1`,
      [projectId]
    );
    const projRow = projRes.rows[0];
    if (!projRow) return null;
    glossaryId = projRow.glossary_id ?? null;
    sourceLang = String(projRow.src_lang || "").trim();
    targetLang = String(projRow.tgt_lang || "").trim();
  }

  if (!glossaryId || !sourceLang || !targetLang) return null;

  const srcLike = `${sourceLang}%`;
  const tgtLike = `${targetLang}%`;

  const entriesRes = await db.query<{ term: string; translation: string; meta_json?: any }>(
    `SELECT term, translation, meta_json
     FROM glossary_entries
     WHERE glossary_id = $1
       AND LOWER(source_lang) LIKE LOWER($2)
       AND LOWER(target_lang) LIKE LOWER($3)
     ORDER BY id ASC`,
    [glossaryId, srcLike, tgtLike]
  );

  if (entriesRes.rows.length === 0) return null;

  const map = new Map<string, { source: string; preferredTargets: Set<string>; forbiddenTargets: Set<string> }>();
  for (const row of entriesRes.rows) {
    const source = String(row.term ?? "").trim();
    const target = String(row.translation ?? "").trim();
    if (!source || !target) continue;
    const key = source.toLowerCase();
    const meta = row.meta_json && typeof row.meta_json === "object" ? row.meta_json : {};
    const status = meta?.forbidden === true ? "forbidden" : meta?.preferred === true ? "preferred" : "allowed";
    const entry = map.get(key) ?? {
      source,
      preferredTargets: new Set<string>(),
      forbiddenTargets: new Set<string>()
    };
    if (status === "preferred") entry.preferredTargets.add(target);
    if (status === "forbidden") entry.forbiddenTargets.add(target);
    map.set(key, entry);
  }

  const entries = Array.from(map.values()).map((entry) => ({
    source: entry.source,
    preferredTargets: Array.from(entry.preferredTargets.values()),
    forbiddenTargets: Array.from(entry.forbiddenTargets.values())
  }));

  return entries.length > 0 ? { entries } : null;
}

async function applyGlossaryForProject(params: {
  projectId: number;
  tasks: TranslationTaskRow[];
  log?: LoggerLike;
}) {
  let checked = 0;
  let updatedRows = 0;

  for (const task of params.tasks) {
    const termbase = await loadTermbaseIndex({ projectId: params.projectId, taskId: task.id });
    if (!termbase) continue;

    const segRes = await db.query<{ id: number; src: string; tgt: string | null }>(
      `SELECT id, src, tgt
       FROM segments
       WHERE task_id = $1
         AND source_type IN ('tmx', 'nmt')
         AND BTRIM(COALESCE(tgt, '')) <> ''
       ORDER BY id ASC`,
      [task.id]
    );

    for (const seg of segRes.rows) {
      checked += 1;
      const { issues, summary } = computeSegmentIssues({
        src: seg.src,
        tgt: seg.tgt,
        termbase
      });
      const updateRes = await db.query(
        `UPDATE segments
         SET issue_summary = $2,
             issue_details = $3
         WHERE id = $1`,
        [seg.id, JSON.stringify(summary), JSON.stringify(issues)]
      );
      if ((updateRes.rowCount ?? 0) > 0) updatedRows += 1;
    }
  }

  logWith(
    params.log,
    "info",
    { projectId: params.projectId, checked, updatedRows },
    "Glossary enforcement completed"
  );

  return { checked, updatedRows };
}

async function waitForPretranslateCompletion(params: {
  projectId: number;
  log?: LoggerLike;
  pollIntervalMs: number;
  onProgress: (summary: {
    total: number;
    pending: number;
    running: number;
    done: number;
    failed: number;
    segmentsTotal: number;
    segmentsProcessed: number;
    segmentsSkipped: number;
  }) => Promise<void>;
}) {
  while (true) {
    const jobsRes = await db.query<{
      status: string;
      segments_total: number;
      segments_processed: number;
      segments_skipped: number;
    }>(
      `SELECT status, segments_total, segments_processed, segments_skipped
       FROM project_pretranslate_jobs
       WHERE project_id = $1`,
      [params.projectId]
    );

    const jobs = jobsRes.rows;
    const summary = jobs.reduce(
      (acc, job) => {
        acc.total += 1;
        const status = String(job.status || "").toLowerCase();
        if (status === "pending") acc.pending += 1;
        else if (status === "running") acc.running += 1;
        else if (status === "failed") acc.failed += 1;
        else if (status === "done") acc.done += 1;
        acc.segmentsTotal += Number(job.segments_total ?? 0) || 0;
        acc.segmentsProcessed += Number(job.segments_processed ?? 0) || 0;
        acc.segmentsSkipped += Number(job.segments_skipped ?? 0) || 0;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        running: 0,
        done: 0,
        failed: 0,
        segmentsTotal: 0,
        segmentsProcessed: 0,
        segmentsSkipped: 0
      }
    );

    await params.onProgress(summary);

    if (summary.pending + summary.running === 0) {
      logWith(params.log, "info", { projectId: params.projectId, summary }, "LLM seeding complete");
      return summary;
    }

    await new Promise((resolve) => setTimeout(resolve, params.pollIntervalMs));
  }
}

async function finalizeProject(params: {
  projectId: number;
  createdBy: string | null;
  assignedUser: string | null;
}) {
  await db.query(
    `UPDATE projects
     SET status = 'ready',
         published_at = NOW(),
         init_error = NULL
     WHERE id = $1`,
    [params.projectId]
  );

  const filesRes = await db.query<{ id: number }>(
    `SELECT id FROM project_files WHERE project_id = $1`,
    [params.projectId]
  );
  const fileIds = filesRes.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));

  const now = Date.now();
  if (params.createdBy) {
    await addProjectToCreated(params.createdBy, params.projectId, now);
    for (const fileId of fileIds) {
      await addFileToAssigned(params.createdBy, fileId, now);
    }
  }
  if (params.assignedUser) {
    await addProjectToAssigned(params.assignedUser, params.projectId, now);
    if (!params.createdBy || params.assignedUser !== params.createdBy) {
      for (const fileId of fileIds) {
        await addFileToAssigned(params.assignedUser, fileId, now);
      }
    }
  }
  await touchProjectForUsers({
    projectId: params.projectId,
    createdBy: params.createdBy,
    assignedUser: params.assignedUser,
    updatedAtMs: now
  });
}

async function processProvisionJob(job: ProvisionJobRow, opts?: { log?: LoggerLike }) {
  const log = opts?.log;
  const jobContext = { jobId: job.id, projectId: job.project_id };
  let progressState = job.progress && typeof job.progress === "object" ? job.progress : null;

  const writeProgress = async (params: {
    status: "pending" | "running" | "done" | "failed";
    step: ProvisionStepKey;
    stepPercent?: number;
    detail?: Record<string, any> | null;
    statusOverride?: "failed" | "done";
    error?: string | null;
    message?: string | null;
  }) => {
    progressState = buildProgress({
      stepKey: params.step,
      stepPercent: params.stepPercent,
      detail: params.detail ?? null,
      statusOverride: params.statusOverride,
      previous: progressState,
      message: params.message ?? null
    });
    await updateProvisionJob({
      projectId: job.project_id,
      jobId: job.id,
      status: params.status,
      step: params.step,
      progress: progressState,
      error: params.error ?? null
    });
  };

  const project = await loadProject(job.project_id);
  if (!project) {
    await writeProgress({
      status: "failed",
      step: "import",
      stepPercent: 0,
      statusOverride: "failed",
      error: "Project not found",
      message: "Project not found"
    });
    return;
  }

  const projectStatus = String(project.status || "").toLowerCase();
  if (projectStatus === "ready") {
    await writeProgress({
      status: "done",
      step: "finalize",
      stepPercent: 1,
      statusOverride: "done",
      message: "Project is already ready"
    });
    return;
  }

  try {
    const importStatus = await checkImportReady(job.project_id);
    if (!importStatus.ready) {
      const detail = {
        filesReady: importStatus.readyFiles,
        filesTotal: importStatus.totalFiles,
        missingTaskSegments: importStatus.missingTaskSegments
      };
      await writeProgress({
        status: "pending",
        step: "import",
        stepPercent: importStatus.totalFiles > 0 ? importStatus.readyFiles / importStatus.totalFiles : 0,
        detail,
        message: "Waiting for files to finish importing"
      });
      return;
    }

    await writeProgress({
      status: "running",
      step: "import",
      stepPercent: 1,
      statusOverride: "done",
      message: "Files imported"
    });

    const tasksRes = await db.query<TranslationTaskRow>(
      `SELECT id, file_id, target_lang, tmx_id, engine_id, ruleset_id, glossary_id
       FROM translation_tasks
       WHERE project_id = $1
       ORDER BY file_id ASC, target_lang ASC`,
      [job.project_id]
    );
    const tasks = tasksRes.rows;
    const seedTasks: ProvisionSeedTask[] = tasks.map((task) => ({
      taskId: Number(task.id),
      fileId: Number(task.file_id),
      targetLang: String(task.target_lang || ""),
      tmxId: task.tmx_id != null ? Number(task.tmx_id) : null,
      engineId: task.engine_id != null ? Number(task.engine_id) : null
    }));

    const enableTmx = tasks.some((task) => task.tmx_id != null);
    let tmxCompleted = 0;
    const tmxTotal = tasks.filter((task) => task.tmx_id != null).length;
    let tmxSegments = 0;
    let tmxUpdated = 0;

    if (enableTmx) {
      await writeProgress({
        status: "running",
        step: "tmx",
        stepPercent: 0,
        message: "TMX seeding started"
      });
    }

    await runProvisionSeeding({
      tasks: seedTasks,
      enableTmx,
      enableLlm: false,
      seedTmxTask: async (seedTask) => {
        const taskRow = tasks.find((task) => Number(task.id) === seedTask.taskId);
        if (!taskRow || !taskRow.tmx_id) return;
        const result = await seedTmxForTask({
          projectId: job.project_id,
          task: taskRow,
          srcLang: project.src_lang,
          log,
          traceId: null
        });
        tmxCompleted += 1;
        tmxSegments += result.segmentCount;
        tmxUpdated += result.updatedRows;
        await writeProgress({
          status: "running",
          step: "tmx",
          stepPercent: tmxTotal > 0 ? tmxCompleted / tmxTotal : 1,
          detail: { tasksTotal: tmxTotal, tasksDone: tmxCompleted, segmentCount: tmxSegments, updatedRows: tmxUpdated },
          message: `TMX seeding ${tmxCompleted}/${tmxTotal}`
        });
      },
      enqueueLlm: async () => {}
    });

    if (enableTmx) {
      await writeProgress({
        status: "running",
        step: "tmx",
        stepPercent: 1,
        statusOverride: "done",
        detail: { tasksTotal: tmxTotal, tasksDone: tmxTotal, segmentCount: tmxSegments, updatedRows: tmxUpdated },
        message: "TMX seeding complete"
      });
    }

    const projectSettings = normalizeProjectSettings(project.project_settings);
    const mtFlag = parseOptionalBool(
      projectSettings.mtSeedingEnabled ??
        projectSettings.mt_seeding_enabled ??
        projectSettings.translationEngineSeedingEnabled ??
        projectSettings.translation_engine_seeding_enabled
    );
    const enableLlm = mtFlag !== false;

    if (enableLlm) {
      await writeProgress({
        status: "running",
        step: "llm",
        stepPercent: 0,
        message: "LLM seeding started"
      });

      const enqueueResult = await enqueuePretranslateJobs({
        projectId: job.project_id,
        scope: "all",
        overwriteExisting: false,
        log
      });

      logWith(
        log,
        "info",
        { ...jobContext, enqueueResult },
        "LLM seeding enqueued"
      );

      const summary = await waitForPretranslateCompletion({
        projectId: job.project_id,
        log,
        pollIntervalMs: Number(process.env.PROVISION_POLL_MS) || DEFAULT_POLL_INTERVAL_MS,
        onProgress: async (summaryRow) => {
          const percent = summaryRow.total > 0 ? summaryRow.done / summaryRow.total : 1;
          await writeProgress({
            status: "running",
            step: "llm",
            stepPercent: percent,
            detail: summaryRow,
            message: `LLM seeding ${summaryRow.done}/${summaryRow.total}`
          });
        }
      });

      if (summary.failed > 0) {
        throw new Error(`LLM seeding failed for ${summary.failed} job(s)`);
      }
    } else {
      await writeProgress({
        status: "running",
        step: "llm",
        stepPercent: 1,
        statusOverride: "done",
        detail: { skipped: true },
        message: "LLM seeding skipped"
      });
    }

    const rulesEnabled = resolveRulesEnabled(projectSettings, tasks);
    const rulesResult = rulesEnabled
      ? await applyRulesForProject({
          projectId: job.project_id,
          projectSettings,
          tasks,
          log
        })
      : { checked: 0, updatedRows: 0, skipped: true };
    await writeProgress({
      status: "running",
      step: "rules",
      stepPercent: 1,
      statusOverride: "done",
      detail: rulesResult,
      message: "Rules step complete"
    });

    const terminologyEnabled = resolveTerminologyEnabled(projectSettings, tasks);
    const glossaryResult = terminologyEnabled
      ? await applyGlossaryForProject({
          projectId: job.project_id,
          tasks,
          log
        })
      : { checked: 0, updatedRows: 0, skipped: true };
    await writeProgress({
      status: "running",
      step: "glossary",
      stepPercent: 1,
      statusOverride: "done",
      detail: glossaryResult,
      message: "Glossary step complete"
    });

    await writeProgress({
      status: "running",
      step: "finalize",
      stepPercent: 0,
      message: "Finalizing project"
    });

    await finalizeProject({
      projectId: job.project_id,
      createdBy: project.created_by,
      assignedUser: project.assigned_user ?? project.created_by
    });

    await writeProgress({
      status: "done",
      step: "finalize",
      stepPercent: 1,
      statusOverride: "done",
      message: "Provisioning complete"
    });
  } catch (err: any) {
    const message = String(err?.message || "Provisioning failed");
    logWith(log, "error", { ...jobContext, error: message }, "Provisioning failed");
    const failedStepRaw = String(
      progressState?.stepKey || progressState?.step || job.step || "import"
    ).trim().toLowerCase();
    const failedStep = (
      PROVISION_STEPS.some((step) => step.key === (failedStepRaw as ProvisionStepKey))
        ? failedStepRaw
        : "import"
    ) as ProvisionStepKey;
    await writeProgress({
      status: "failed",
      step: failedStep,
      stepPercent: 0,
      statusOverride: "failed",
      error: message,
      message
    });
  }
}

export function startProvisionWorker(log?: LoggerLike) {
  const pollIntervalMs = Number(process.env.PROVISION_POLL_MS) || DEFAULT_POLL_INTERVAL_MS;
  let running = false;
  logWith(log, "info", { pollIntervalMs }, "Provision worker started");

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const job = await claimNextProvisionJob();
      if (job) {
        await processProvisionJob(job, { log });
      }
    } catch (err) {
      logWith(log, "error", { err }, "Provision worker tick failed");
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, pollIntervalMs);
  tick().catch(() => {});
  return () => clearInterval(handle);
}

export async function retryProvisionJob(params: {
  projectId: number;
  log?: LoggerLike;
}) {
  await db.query(
    `UPDATE projects
     SET status = 'provisioning',
         published_at = NULL,
         init_error = NULL,
         provisioning_started_at = NOW(),
         provisioning_updated_at = NOW(),
         provisioning_finished_at = NULL,
         provisioning_progress = 0,
         provisioning_current_step = 'IMPORT_FILES'
     WHERE id = $1`,
    [params.projectId]
  );
  const jobId = await enqueueProvisionJob({ projectId: params.projectId, step: "import", log: params.log });
  return jobId;
}
