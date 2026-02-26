import { db, withTransaction } from "../db.js";
import { requestSegmentLlmPayload, extractTranslationText, SegmentLlmError } from "./segment-llm.js";

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
  const prefix = `[pretranslate:${level}]`;
  console.log(`${prefix} ${message}`, data);
}

type PretranslateJobRow = {
  id: number;
  project_id: number;
  file_id: number;
  target_lang: string;
  engine_id: number | null;
  status: string;
  overwrite_existing: boolean;
  retry_count: number;
  max_retries: number;
};

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 2;

function isTransientError(err: any): boolean {
  if (err instanceof SegmentLlmError) {
    return err.status >= 500;
  }
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502")
  );
}

async function claimNextJob(): Promise<PretranslateJobRow | null> {
  return withTransaction(async (client) => {
    const res = await client.query<PretranslateJobRow>(
      `WITH next AS (
         SELECT id
         FROM project_pretranslate_jobs
         WHERE status = 'pending'
         ORDER BY updated_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE project_pretranslate_jobs
       SET status = 'running',
           started_at = NOW(),
           updated_at = NOW()
       WHERE id IN (SELECT id FROM next)
       RETURNING *`
    );
    return res.rows[0] ?? null;
  });
}

async function markJobUpdate(params: {
  jobId: number;
  status: "pending" | "running" | "done" | "failed";
  error?: string | null;
  retryCount?: number;
  segmentsTotal?: number;
  segmentsProcessed?: number;
  segmentsSkipped?: number;
  completed?: boolean;
}) {
  await db.query(
    `UPDATE project_pretranslate_jobs
     SET status = $2,
         error_message = $3,
         retry_count = COALESCE($4, retry_count),
         segments_total = COALESCE($5, segments_total),
         segments_processed = COALESCE($6, segments_processed),
         segments_skipped = COALESCE($7, segments_skipped),
         updated_at = NOW(),
         completed_at = CASE WHEN $8 THEN NOW() ELSE completed_at END,
         started_at = CASE WHEN $2 = 'pending' THEN NULL ELSE started_at END
     WHERE id = $1`,
    [
      params.jobId,
      params.status,
      params.error ?? null,
      params.retryCount ?? null,
      params.segmentsTotal ?? null,
      params.segmentsProcessed ?? null,
      params.segmentsSkipped ?? null,
      params.completed ? true : false
    ]
  );
}

async function processJob(
  job: PretranslateJobRow,
  opts?: {
    log?: LoggerLike;
    requestSegment?: typeof requestSegmentLlmPayload;
  }
) {
  const log = opts?.log;
  const requestSegment = opts?.requestSegment ?? requestSegmentLlmPayload;
  const context = {
    jobId: job.id,
    projectId: job.project_id,
    fileId: job.file_id,
    targetLang: job.target_lang,
    engineId: job.engine_id ?? null,
    overwriteExisting: job.overwrite_existing
  };
  logWith(log, "info", context, "Pretranslate job picked up");

  const taskRes = await db.query<{ id: number; engine_id: number | null }>(
    `SELECT id, engine_id
     FROM translation_tasks
     WHERE project_id = $1
       AND file_id = $2
       AND LOWER(target_lang) = LOWER($3)
     LIMIT 1`,
    [job.project_id, job.file_id, job.target_lang]
  );
  const task = taskRes.rows[0];
  if (!task) {
    logWith(log, "warn", context, "Pretranslate task not found");
    await markJobUpdate({
      jobId: job.id,
      status: "failed",
      error: "Translation task not found",
      completed: true
    });
    return;
  }

  const engineId = job.engine_id ?? task.engine_id ?? null;
  if (!engineId) {
    logWith(log, "warn", context, "No translation engine configured");
    await markJobUpdate({
      jobId: job.id,
      status: "done",
      error: "No translation engine configured",
      completed: true
    });
    return;
  }

  const segmentsRes = await db.query<{ id: number; tgt: string | null }>(
    `SELECT id, tgt
     FROM segments
     WHERE task_id = $1
     ORDER BY id ASC`,
    [task.id]
  );
  const segments = segmentsRes.rows;
  if (segments.length === 0) {
    const availableRes = await db.query<{ target_lang: string }>(
      `SELECT DISTINCT target_lang
       FROM translation_tasks
       WHERE project_id = $1 AND file_id = $2
       ORDER BY target_lang ASC`,
      [job.project_id, job.file_id]
    );
    const availableLangs = availableRes.rows.map((row) => row.target_lang);
    logWith(
      log,
      "warn",
      { ...context, availableLangs },
      "No segments found for file/target language"
    );
    await markJobUpdate({
      jobId: job.id,
      status: "failed",
      error: "No segments found for task",
      retryCount: job.retry_count,
      completed: true
    });
    return;
  }

  const total = segments.length;
  logWith(
    log,
    "info",
    { ...context, segmentCount: total, engineId },
    "Starting LLM seeding batch"
  );

  let processed = 0;
  let skipped = 0;
  let lastError: string | null = null;
  let transientError = false;
  let confirmedSample = false;
  const updateColumns = [
    "tgt",
    "status",
    "state",
    "generated_by_llm",
    "source_type",
    "source_score",
    "source_match_id",
    "updated_by",
    "updated_at",
    "version"
  ];

  for (let i = 0; i < segments.length; i += DEFAULT_BATCH_SIZE) {
    const batch = segments.slice(i, i + DEFAULT_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (seg) => {
        if (!job.overwrite_existing && String(seg.tgt ?? "").trim().length > 0) {
          return { skipped: true };
        }
        try {
          const result = await requestSegment({
            segmentId: seg.id,
            engineIdOverride: engineId,
            traceId: `pretranslate:${job.id}:${seg.id}`
          });
          const translation = extractTranslationText(result.payload);
          if (!translation) {
            logWith(log, "warn", { ...context, segmentId: seg.id }, "LLM returned empty translation");
            return { skipped: true };
          }

          const preview = translation.slice(0, 30);
          logWith(
            log,
            "info",
            { ...context, segmentId: seg.id, preview },
            "LLM translation parsed"
          );
          logWith(
            log,
            "debug",
            { ...context, segmentId: seg.id, table: "segments", columns: updateColumns },
            "Preparing segment update"
          );

          const updateRes = await db.query(
            `UPDATE segments
             SET tgt = $2,
                 status = 'draft',
                 state = 'nmt_draft',
                 generated_by_llm = TRUE,
                 source_type = 'nmt',
                 source_score = NULL,
                 source_match_id = NULL,
                 updated_by = $3,
                 updated_at = NOW(),
                 version = version + 1
             WHERE id = $1`,
            [seg.id, translation, "system"]
          );
          const rowCount = updateRes.rowCount ?? 0;
          logWith(
            log,
            "info",
            { ...context, segmentId: seg.id, rowCount },
            "Segment update written"
          );
          if (rowCount === 0) {
            return { failed: true, error: "Segment update affected 0 rows" };
          }

          if (!confirmedSample) {
            confirmedSample = true;
            const confirmRes = await db.query<{ id: number; tgt: string | null; status: string; state: string }>(
              `SELECT id, tgt, status, state
               FROM segments
               WHERE id = $1`,
              [seg.id]
            );
            const confirmRow = confirmRes.rows[0];
            logWith(
              log,
              "info",
              {
                ...context,
                segmentId: seg.id,
                confirmedTarget: confirmRow?.tgt?.slice(0, 30) ?? null,
                status: confirmRow?.status ?? null,
                state: confirmRow?.state ?? null
              },
              "Segment update confirmed"
            );
          }

          return { processed: true, preview, segmentId: seg.id };
        } catch (err: any) {
          if (isTransientError(err)) {
            transientError = true;
          }
          lastError = String(err?.message || err);
          logWith(
            log,
            "warn",
            { ...context, segmentId: seg.id, error: lastError },
            "Segment seed failed"
          );
          return { failed: true };
        }
      })
    );

    const parsedTranslations = results.filter((res) => (res as any).preview).length;
    const sample = results.find((res) => (res as any).preview) as any;
    if (parsedTranslations > 0) {
      logWith(
        log,
        "info",
        {
          ...context,
          parsedTranslationCount: parsedTranslations,
          sample: sample ? { segmentId: sample.segmentId, preview: sample.preview } : null
        },
        "Batch translations parsed"
      );
    }

    results.forEach((res) => {
      if (res.processed) processed += 1;
      else if (res.skipped) skipped += 1;
      else if (res.failed) {
        skipped += 1;
        if ((res as any).error) lastError = (res as any).error;
      }
    });

    if (transientError) break;
  }

  if (transientError && job.retry_count < job.max_retries) {
    await markJobUpdate({
      jobId: job.id,
      status: "pending",
      error: lastError ?? "Transient error",
      retryCount: job.retry_count + 1,
      segmentsTotal: total,
      segmentsProcessed: processed,
      segmentsSkipped: skipped,
      completed: false
    });
    return;
  }

  const status = lastError ? "failed" : "done";
  await markJobUpdate({
    jobId: job.id,
    status,
    error: lastError,
    segmentsTotal: total,
    segmentsProcessed: processed,
    segmentsSkipped: skipped,
    completed: true
  });

  const seededCountRes = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM segments
     WHERE task_id = $1
       AND BTRIM(COALESCE(tgt, '')) <> ''`,
    [task.id]
  );
  logWith(
    log,
    "info",
    { ...context, seededCount: Number(seededCountRes.rows[0]?.count ?? 0) },
    "Seeding job completed"
  );

  if (processed > 0) {
    await db.query(
      "UPDATE translation_tasks SET updated_at = NOW() WHERE id = $1",
      [task.id]
    );
  }
}

export function startPretranslateWorker(log?: any) {
  const pollIntervalMs = Number(process.env.PRETRANSLATE_POLL_MS) || DEFAULT_POLL_INTERVAL_MS;
  let running = false;
  logWith(log, "info", { pollIntervalMs }, "Pretranslate worker started");

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const job = await claimNextJob();
      if (job) {
        await processJob(job, { log });
      }
    } catch (err) {
      log?.error?.({ err }, "[pretranslate] Worker tick failed");
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, pollIntervalMs);
  tick().catch(() => {});
  return () => clearInterval(handle);
}

export async function processPretranslateJobForTest(
  job: PretranslateJobRow,
  opts?: {
    log?: LoggerLike;
    requestSegment?: typeof requestSegmentLlmPayload;
  }
) {
  await processJob(job, opts);
}
