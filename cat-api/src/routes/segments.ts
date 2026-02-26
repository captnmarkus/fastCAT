import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import {
  requireAuth,
  ensureProjectAccess,
  ensureProjectReady,
  getRequestUser,
  requestUserId,
  isAdminUser,
  isManagerUser
} from "../middleware/auth.js";
import { addFileToAssigned, touchProjectForUsers } from "../lib/user-buckets.js";
import { requestSegmentLlmPayload, SegmentLlmError } from "../lib/segment-llm.js";
import { ensureTaskAccess, ensureTaskSegments } from "./files.helpers.js";
import {
  computeSegmentIssues,
  mapStateToStatus,
  normalizeSegmentState,
  type IssueSummary,
  type SegmentIssue,
  type SegmentState,
  type TermbaseIndex
} from "../lib/segment-issues.js";
import {
  normalizeOriginDetails,
  normalizeRichTextRuns,
  projectTextToTemplateRuns,
  runsToPlainText
} from "../lib/rich-text.js";

// Shared WebSocket broadcaster (simple version)
let broadcast: (event: string, payload: any) => void = () => {};
export function setBroadcaster(fn: any) { broadcast = fn; }

type SegmentSourceType = "tmx" | "nmt" | "ntm_draft" | "llm" | "manual" | "none";
type SegmentStatus = "draft" | "under_review" | "reviewed";

type TermbaseRow = {
  term: string;
  translation: string;
  meta_json?: any;
};

const QE_REVIEW_THRESHOLD = 0.7;
const BULK_JOB_TTL_MS = 30 * 60 * 1000;
const BULK_UPDATE_CHUNK_SIZE = 250;
const BULK_MAX_TRACKED_IDS = 5000;

type BulkApproveScope = "all" | "visible" | "clean";
type BulkApproveQaPolicy = "ignore" | "require_clean";
type BulkApproveSkipReason =
  | "already_reviewed"
  | "empty_target"
  | "qa_issues"
  | "locked"
  | "permission_denied"
  | "task_read_only"
  | "update_failed";

type BulkCandidateRow = {
  id: number;
  project_id: number;
  file_id: number;
  task_id: number | null;
  seg_index: number;
  src: string;
  tgt: string | null;
  status: string;
  state: string | null;
  is_locked: boolean | null;
  issue_summary: any;
  issue_details: any;
  source_type: string | null;
  version: number;
  task_status: string | null;
  translator_user: string | null;
};

type EvaluatedBulkCandidate = {
  row: BulkCandidateRow;
  summary: IssueSummary;
  issues: SegmentIssue[];
  hasQaIssues: boolean;
};

type BulkEstimateResult = {
  total: number;
  eligible: number;
  skipped: number;
  qaFlaggedEligible: number;
  reasonsBreakdown: Record<string, number>;
  skippedSegmentIds: number[];
  problematicSegmentIds: number[];
  eligibleCandidates: EvaluatedBulkCandidate[];
};

type BulkEstimatePublic = Omit<BulkEstimateResult, "eligibleCandidates">;

type BulkJobProgress = {
  total: number;
  processed: number;
  approved: number;
  skipped: number;
  percent: number;
};

type BulkJobSummary = {
  approved: number;
  skipped: number;
  qaFlaggedApproved: number;
  reasonsBreakdown: Record<string, number>;
  skippedSegmentIds: number[];
  problematicSegmentIds: number[];
};

type BulkJobStatus = "queued" | "running" | "completed" | "failed";

type BulkJobRecord = {
  id: string;
  status: BulkJobStatus;
  createdAtMs: number;
  updatedAtMs: number;
  scope: BulkApproveScope;
  projectId: number;
  fileId: number;
  taskId: number | null;
  progress: BulkJobProgress;
  estimated: BulkEstimatePublic;
  summary: BulkJobSummary | null;
  error: string | null;
};

const bulkJobsById = new Map<string, BulkJobRecord>();
const BULK_PROBLEMATIC_REASONS = new Set<BulkApproveSkipReason>([
  "empty_target",
  "qa_issues",
  "locked",
  "permission_denied",
  "task_read_only",
  "update_failed"
]);

function pruneBulkJobs() {
  const now = Date.now();
  for (const [jobId, job] of bulkJobsById.entries()) {
    if (job.status === "queued" || job.status === "running") continue;
    if (now - job.updatedAtMs < BULK_JOB_TTL_MS) continue;
    bulkJobsById.delete(jobId);
  }
}

function toBulkEstimatePublic(estimate: BulkEstimateResult): BulkEstimatePublic {
  return {
    total: estimate.total,
    eligible: estimate.eligible,
    skipped: estimate.skipped,
    qaFlaggedEligible: estimate.qaFlaggedEligible,
    reasonsBreakdown: estimate.reasonsBreakdown,
    skippedSegmentIds: estimate.skippedSegmentIds,
    problematicSegmentIds: estimate.problematicSegmentIds
  };
}

function normalizeBulkScope(input: unknown): BulkApproveScope | null {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "all") return "all";
  if (value === "visible") return "visible";
  if (value === "clean") return "clean";
  return null;
}

function normalizeBulkQaPolicy(input: unknown): BulkApproveQaPolicy | null {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "ignore") return "ignore";
  if (value === "require_clean" || value === "require clean") return "require_clean";
  return null;
}

function normalizeReviewGateStatus(value: unknown): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
    return "under_review";
  }
  if (raw === "error") return "error";
  return "draft";
}

function isTaskReadOnlyStatus(value: unknown): boolean {
  return normalizeReviewGateStatus(value) === "reviewed";
}

function parseFilterEnabled(input: unknown): boolean {
  if (input === true) return true;
  return parseBool(input) === true;
}

function normalizeFilterText(input: unknown): string {
  return String(input ?? "").trim();
}

function normalizeFilterObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function incrementReason(map: Record<string, number>, reason: BulkApproveSkipReason) {
  map[reason] = (map[reason] ?? 0) + 1;
}

function pushTrackedId(target: number[], id: number) {
  if (!Number.isFinite(id) || id <= 0) return;
  if (target.length >= BULK_MAX_TRACKED_IDS) return;
  if (target.includes(id)) return;
  target.push(id);
}

function normalizeUserKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function canApproveBulkRow(params: {
  row: BulkCandidateRow;
  requesterId: string | null;
  canApproveAny: boolean;
  projectOwner: string | null;
}): boolean {
  if (params.canApproveAny) return true;
  const requester = normalizeUserKey(params.requesterId);
  if (!requester) return false;
  if (params.row.task_id != null) {
    const translator = normalizeUserKey(params.row.translator_user);
    return Boolean(translator) && translator === requester;
  }
  const owner = normalizeUserKey(params.projectOwner);
  return Boolean(owner) && owner === requester;
}

function computeBulkProgress(total: number, processed: number, approved: number, skipped: number): BulkJobProgress {
  const safeTotal = Math.max(0, total);
  const safeProcessed = Math.max(0, Math.min(safeTotal, processed));
  const percent = safeTotal === 0 ? 100 : Math.round((safeProcessed / safeTotal) * 100);
  return {
    total: safeTotal,
    processed: safeProcessed,
    approved: Math.max(0, approved),
    skipped: Math.max(0, skipped),
    percent: Math.max(0, Math.min(100, percent))
  };
}

async function loadBulkApproveCandidates(params: {
  projectId: number;
  fileId: number;
  taskId: number | null;
  scope: BulkApproveScope;
  filters: Record<string, unknown>;
}): Promise<BulkCandidateRow[]> {
  const where: string[] = ["s.project_id = $1", "s.file_id = $2"];
  const values: Array<number | string | string[]> = [params.projectId, params.fileId];

  if (params.taskId != null) {
    values.push(params.taskId);
    where.push(`s.task_id = $${values.length}`);
  } else {
    where.push("s.task_id IS NULL");
  }

  if (params.scope === "visible") {
    const filters = params.filters;
    if (parseFilterEnabled(filters.termHitsOnly)) {
      throw new Error("The visible bulk scope does not support the term-hits-only filter.");
    }

    const statusRaw = normalizeFilterText(filters.statusFilter ?? filters.status).toLowerCase();
    if (statusRaw && statusRaw !== "all") {
      const parsedStatus = parseSegmentStatus(statusRaw);
      if (!parsedStatus) {
        throw new Error("Invalid status filter for visible scope.");
      }
      values.push(parsedStatus);
      where.push(`LOWER(COALESCE(s.status, 'draft')) = $${values.length}`);
    }

    const sourceSearch = normalizeFilterText(filters.sourceSearch ?? filters.source);
    if (sourceSearch) {
      values.push(`%${sourceSearch}%`);
      where.push(`s.src ILIKE $${values.length}`);
    }

    const targetSearch = normalizeFilterText(filters.targetSearch ?? filters.target);
    if (targetSearch) {
      values.push(`%${targetSearch}%`);
      where.push(`COALESCE(s.tgt, '') ILIKE $${values.length}`);
    }

    if (parseFilterEnabled(filters.untranslatedOnly)) {
      where.push(`BTRIM(COALESCE(s.tgt, '')) = ''`);
    }
    if (parseFilterEnabled(filters.draftOnly)) {
      where.push(`LOWER(COALESCE(s.state, 'draft')) IN ('draft', 'nmt_draft', 'llm_draft')`);
    }
    if (parseFilterEnabled(filters.reviewedOnly)) {
      where.push(`(LOWER(COALESCE(s.state, '')) = 'reviewed' OR LOWER(COALESCE(s.status, '')) IN ('reviewed', 'approved'))`);
    }
    if (parseFilterEnabled(filters.withQaOnly)) {
      where.push(`(COALESCE((s.issue_summary->>'error')::int, 0) + COALESCE((s.issue_summary->>'warning')::int, 0)) > 0`);
    }
    if (parseFilterEnabled(filters.lockedOnly)) {
      where.push(`COALESCE(s.is_locked, FALSE) = TRUE`);
    }
    if (parseFilterEnabled(filters.ntmDraftOnly)) {
      where.push(`(LOWER(COALESCE(s.state, '')) IN ('nmt_draft', 'llm_draft') OR LOWER(COALESCE(s.source_type, '')) = 'ntm_draft')`);
    }
    if (parseFilterEnabled(filters.tmxOnly)) {
      where.push(`LOWER(COALESCE(s.source_type, '')) = 'tmx'`);
    }
  }

  const res = await db.query<BulkCandidateRow>(
    `SELECT s.id,
            s.project_id,
            s.file_id,
            s.task_id,
            s.seg_index,
            s.src,
            s.tgt,
            s.status,
            s.state,
            s.is_locked,
            s.issue_summary,
            s.issue_details,
            s.source_type,
            s.version,
            t.status AS task_status,
            t.translator_user
     FROM segments s
     LEFT JOIN translation_tasks t ON t.id = s.task_id
     WHERE ${where.join(" AND ")}
     ORDER BY s.seg_index ASC, s.id ASC`,
    values
  );
  return res.rows;
}

async function persistBulkQaIssuePayload(updates: Array<{ id: number; summary: IssueSummary; issues: SegmentIssue[] }>) {
  if (updates.length === 0) return;
  for (const update of updates) {
    await db.query(
      `UPDATE segments
       SET issue_summary = $2,
           issue_details = $3
       WHERE id = $1`,
      [update.id, JSON.stringify(update.summary), JSON.stringify(update.issues)]
    );
  }
}

async function evaluateBulkApproveCandidates(params: {
  rows: BulkCandidateRow[];
  qaPolicy: BulkApproveQaPolicy;
  requesterId: string | null;
  canApproveAny: boolean;
  projectOwner: string | null;
  persistQaPayload: boolean;
}): Promise<BulkEstimateResult> {
  const reasonsBreakdown: Record<string, number> = {};
  const skippedSegmentIds: number[] = [];
  const problematicSegmentIds: number[] = [];
  const eligibleCandidates: EvaluatedBulkCandidate[] = [];
  const qaUpdates: Array<{ id: number; summary: IssueSummary; issues: SegmentIssue[] }> = [];
  const termbaseCache = new Map<string, TermbaseIndex | null>();
  let qaFlaggedEligible = 0;

  for (const row of params.rows) {
    const termbaseKey = `${row.project_id}:${row.task_id ?? "none"}`;
    let termbase = termbaseCache.get(termbaseKey);
    if (termbase === undefined) {
      termbase = await loadTermbaseIndex({ projectId: row.project_id, taskId: row.task_id });
      termbaseCache.set(termbaseKey, termbase ?? null);
    }

    const qa = computeSegmentIssues({
      src: row.src,
      tgt: row.tgt,
      termbase: termbase ?? null
    });
    const hasQaIssues = qa.summary.error + qa.summary.warning > 0;
    if (params.persistQaPayload) {
      qaUpdates.push({ id: row.id, summary: qa.summary, issues: qa.issues });
    }

    const status = coerceSegmentStatus(row.status);
    const state = coerceSegmentState(row.state, status);
    const readOnlyTask = row.task_id != null && isTaskReadOnlyStatus(row.task_status);
    const permissionGranted = canApproveBulkRow({
      row,
      requesterId: params.requesterId,
      canApproveAny: params.canApproveAny,
      projectOwner: params.projectOwner
    });

    let reason: BulkApproveSkipReason | null = null;
    if (readOnlyTask) {
      reason = "task_read_only";
    } else if (!permissionGranted) {
      reason = "permission_denied";
    } else if (state === "reviewed") {
      reason = "already_reviewed";
    } else if (Boolean(row.is_locked)) {
      reason = "locked";
    } else if (isBlank(row.tgt)) {
      reason = "empty_target";
    } else if (params.qaPolicy === "require_clean" && hasQaIssues) {
      reason = "qa_issues";
    }

    if (reason) {
      incrementReason(reasonsBreakdown, reason);
      pushTrackedId(skippedSegmentIds, row.id);
      if (BULK_PROBLEMATIC_REASONS.has(reason)) {
        pushTrackedId(problematicSegmentIds, row.id);
      }
      continue;
    }

    if (hasQaIssues) qaFlaggedEligible += 1;
    eligibleCandidates.push({
      row,
      summary: qa.summary,
      issues: qa.issues,
      hasQaIssues
    });
  }

  if (params.persistQaPayload && qaUpdates.length > 0) {
    await persistBulkQaIssuePayload(qaUpdates);
  }

  const total = params.rows.length;
  const eligible = eligibleCandidates.length;
  return {
    total,
    eligible,
    skipped: total - eligible,
    qaFlaggedEligible,
    reasonsBreakdown,
    skippedSegmentIds,
    problematicSegmentIds,
    eligibleCandidates
  };
}

async function runBulkApproveJob(params: {
  job: BulkJobRecord;
  eligibleCandidates: EvaluatedBulkCandidate[];
  initialSkippedCount: number;
  initialReasons: Record<string, number>;
  initialSkippedIds: number[];
  initialProblematicIds: number[];
  userId: string;
  accessRow: any;
}) {
  const { job } = params;
  job.status = "running";
  job.updatedAtMs = Date.now();
  job.error = null;

  const reasonsBreakdown: Record<string, number> = { ...params.initialReasons };
  const skippedSegmentIds = [...params.initialSkippedIds];
  const problematicSegmentIds = [...params.initialProblematicIds];
  const touchedTaskIds = new Set<number>();
  const total = job.progress.total;
  let approved = 0;
  let skipped = params.initialSkippedCount;
  let processed = params.initialSkippedCount;
  let qaFlaggedApproved = 0;
  const now = new Date().toISOString();

  try {
    for (let offset = 0; offset < params.eligibleCandidates.length; offset += BULK_UPDATE_CHUNK_SIZE) {
      const chunk = params.eligibleCandidates.slice(offset, offset + BULK_UPDATE_CHUNK_SIZE);
      for (const candidate of chunk) {
        const row = candidate.row;
        try {
          const updateRes = await db.query<{ version: number }>(
            `UPDATE segments
             SET status = 'reviewed',
                 state = 'reviewed',
                 is_locked = TRUE,
                 issue_summary = $2,
                 issue_details = $3,
                 updated_by = $4,
                 updated_at = $5,
                 version = version + 1
             WHERE id = $1
             RETURNING version`,
            [row.id, JSON.stringify(candidate.summary), JSON.stringify(candidate.issues), params.userId, now]
          );

          if ((updateRes.rowCount ?? 0) <= 0) {
            skipped += 1;
            incrementReason(reasonsBreakdown, "update_failed");
            pushTrackedId(skippedSegmentIds, row.id);
            pushTrackedId(problematicSegmentIds, row.id);
            continue;
          }

          const rowStatus = coerceSegmentStatus(row.status);
          const rowState = coerceSegmentState(row.state, rowStatus);
          if (rowState !== "reviewed") {
            await db.query(
              `INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [row.id, row.tgt ?? null, row.tgt ?? null, params.userId, now]
            );
          }

          if (candidate.hasQaIssues) {
            qaFlaggedApproved += 1;
          }
          approved += 1;
          if (row.task_id != null) touchedTaskIds.add(row.task_id);
          broadcast("segment:update", { segmentId: row.id });
        } catch {
          skipped += 1;
          incrementReason(reasonsBreakdown, "update_failed");
          pushTrackedId(skippedSegmentIds, row.id);
          pushTrackedId(problematicSegmentIds, row.id);
        } finally {
          processed += 1;
          job.progress = computeBulkProgress(total, processed, approved, skipped);
          job.updatedAtMs = Date.now();
        }
      }
    }

    if (touchedTaskIds.size > 0) {
      await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = ANY($1::int[])`, [
        Array.from(touchedTaskIds.values()),
        now
      ]);
    }

    if (approved > 0) {
      try {
        const createdBy = params.accessRow?.created_by ? String(params.accessRow.created_by) : null;
        const assignedUserRaw = params.accessRow?.assigned_user ? String(params.accessRow.assigned_user) : null;
        const assignedUser = assignedUserRaw || createdBy;
        const nowMs = Date.now();
        if (createdBy) await addFileToAssigned(createdBy, job.fileId, nowMs);
        if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, job.fileId, nowMs);
        await touchProjectForUsers({
          projectId: job.projectId,
          createdBy,
          assignedUser,
          updatedAtMs: nowMs
        });
      } catch {
        // ignore redis errors
      }
    }

    job.status = "completed";
    job.summary = {
      approved,
      skipped,
      qaFlaggedApproved,
      reasonsBreakdown,
      skippedSegmentIds,
      problematicSegmentIds
    };
    job.progress = computeBulkProgress(total, total, approved, skipped);
    job.updatedAtMs = Date.now();
  } catch (err: any) {
    job.status = "failed";
    job.error = String(err?.message || "Bulk approval failed.");
    job.updatedAtMs = Date.now();
    job.progress = computeBulkProgress(total, processed, approved, skipped);
  } finally {
    pruneBulkJobs();
  }
}

function statusFromMeta(meta: Record<string, any>): "preferred" | "allowed" | "forbidden" {
  if (meta?.forbidden === true) return "forbidden";
  if (meta?.preferred === true) return "preferred";
  return "allowed";
}

function buildTermbaseIndex(rows: TermbaseRow[]): TermbaseIndex | null {
  if (!rows || rows.length === 0) return null;
  const map = new Map<string, { source: string; preferredTargets: Set<string>; forbiddenTargets: Set<string> }>();
  for (const row of rows) {
    const source = String(row.term ?? "").trim();
    const target = String(row.translation ?? "").trim();
    if (!source || !target) continue;
    const key = source.toLowerCase();
    const meta = row.meta_json && typeof row.meta_json === "object" ? row.meta_json : {};
    const status = statusFromMeta(meta as Record<string, any>);
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

async function loadTermbaseIndex(params: { projectId: number; taskId?: number | null }): Promise<TermbaseIndex | null> {
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

  const entriesRes = await db.query<TermbaseRow>(
    `SELECT term, translation, meta_json
     FROM glossary_entries
     WHERE glossary_id = $1
       AND LOWER(source_lang) LIKE LOWER($2)
       AND LOWER(target_lang) LIKE LOWER($3)
     ORDER BY id ASC`,
    [glossaryId, srcLike, tgtLike]
  );
  return buildTermbaseIndex(entriesRes.rows);
}

function stateFromStatus(status: SegmentStatus): SegmentState {
  if (status === "reviewed") return "reviewed";
  return "draft";
}

function coerceSegmentState(input: any, statusFallback: SegmentStatus): SegmentState {
  return normalizeSegmentState(input) ?? stateFromStatus(statusFallback);
}

function normalizeIdList(input: any): number[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : String(input).split(",");
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseBool(input: any): boolean | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return null;
}

export async function segmentRoutes(app: FastifyInstance) {
  
  // UPDATE SEGMENT
  app.post("/segments/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const sid = Number((req.params as any).id);
    const body = req.body as any;
    
    // Check access via JOIN
    const segRes = await db.query<{
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      src_runs: any;
      tgt_runs: any;
      origin_details: any;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      issue_summary: any;
      issue_details: any;
      source_type: string | null;
      is_locked: boolean | null;
      version: number;
    }>(
      `SELECT project_id,
              file_id,
              task_id,
              src,
              tgt,
              src_runs,
              tgt_runs,
              origin_details,
              status,
              state,
              generated_by_llm,
              qe_score,
              issue_summary,
              issue_details,
              source_type,
              is_locked,
              version
       FROM segments
       WHERE id = $1`,
      [sid]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Not found" });
    const projectRow = await ensureProjectAccess(seg.project_id, getRequestUser(req), reply);
    if (!projectRow) return;
    if (!ensureProjectReady(projectRow, reply)) return;
    const incomingVersion = Number(body?.version);
    if (!Number.isFinite(incomingVersion)) {
      return reply.code(400).send({ error: "Missing segment version", code: "SEGMENT_VERSION_REQUIRED" });
    }
    const currentVersion = Number(seg.version ?? 0);
    if (incomingVersion !== currentVersion) {
      return reply.code(409).send({
        error: "Segment has been modified by someone else.",
        code: "SEGMENT_VERSION_CONFLICT",
        currentVersion
      });
    }

    const now = new Date().toISOString();
    const userId = requestUserId(getRequestUser(req)) ?? "system";
    const currentStatus = coerceSegmentStatus(seg.status);
    const currentState = coerceSegmentState(seg.state, currentStatus);
    const hasIsLocked =
      Object.prototype.hasOwnProperty.call(body, "isLocked") ||
      Object.prototype.hasOwnProperty.call(body, "is_locked") ||
      Object.prototype.hasOwnProperty.call(body, "locked");
    const parsedIsLocked = hasIsLocked
      ? parseBool(body?.isLocked ?? body?.is_locked ?? body?.locked)
      : null;
    if (hasIsLocked && parsedIsLocked == null) {
      return reply.code(400).send({
        error: "Invalid segment lock state.",
        code: "SEGMENT_LOCK_INVALID"
      });
    }
    const unlocking = hasIsLocked && parsedIsLocked === false;

    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
    const requestedStatusRaw = hasStatus ? body?.status : null;
    const parsedStatus = hasStatus ? parseSegmentStatus(requestedStatusRaw) : currentStatus;
    const hasState = Object.prototype.hasOwnProperty.call(body, "state");
    const requestedState = hasState ? normalizeSegmentState(body?.state) : null;
    if (hasState && !requestedState) {
      return reply.code(400).send({
        error: "Invalid segment state.",
        code: "SEGMENT_STATE_INVALID"
      });
    }
    const requestedStatus = hasStatus
      ? parsedStatus
      : requestedState
      ? mapStateToStatus(requestedState)
      : parsedStatus;
    if (!requestedStatus) {
      return reply.code(400).send({
        error: "Invalid segment status.",
        code: "SEGMENT_STATUS_INVALID"
      });
    }
    if (!canTransitionSegmentStatus(currentStatus, requestedStatus)) {
      return reply.code(400).send({
        error: `Invalid segment status transition: ${currentStatus} -> ${requestedStatus}.`,
        code: "SEGMENT_STATUS_INVALID_TRANSITION",
        currentStatus,
        requestedStatus
      });
    }

    const hasSourceType = Object.prototype.hasOwnProperty.call(body, "sourceType");
    const parsedSourceType = hasSourceType ? parseSourceType(body?.sourceType) : null;
    if (hasSourceType && !parsedSourceType) {
      return reply.code(400).send({
        error: "Invalid segment source type.",
        code: "SEGMENT_SOURCE_TYPE_INVALID"
      });
    }

    const hasSourceScore = Object.prototype.hasOwnProperty.call(body, "sourceScore");
    let nextSourceScore: number | null = null;
    if (hasSourceScore) {
      if (body?.sourceScore == null || String(body?.sourceScore).trim() === "") {
        nextSourceScore = null;
      } else {
        const parsedScore = Number(body?.sourceScore);
        if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) {
          return reply.code(400).send({
            error: "Invalid segment source score.",
            code: "SEGMENT_SOURCE_SCORE_INVALID"
          });
        }
        nextSourceScore = Math.round(parsedScore);
      }
    }

    const hasSourceMatchId = Object.prototype.hasOwnProperty.call(body, "sourceMatchId");
    const nextSourceMatchId = hasSourceMatchId
      ? String(body?.sourceMatchId ?? "").trim() || null
      : null;

    const hasTarget = Object.prototype.hasOwnProperty.call(body, "tgt");
    let nextTarget = hasTarget ? body?.tgt ?? null : seg.tgt ?? null;
    const hasTargetRuns =
      Object.prototype.hasOwnProperty.call(body, "tgtRuns") ||
      Object.prototype.hasOwnProperty.call(body, "targetRuns");
    const incomingTargetRuns = hasTargetRuns
      ? normalizeRichTextRuns(body?.tgtRuns ?? body?.targetRuns, hasTarget ? String(nextTarget ?? "") : String(seg.tgt ?? ""))
      : normalizeRichTextRuns(seg.tgt_runs, String(seg.tgt ?? ""));
    const sourceRuns = normalizeRichTextRuns(seg.src_runs, String(seg.src ?? ""));
    let nextTargetRuns = incomingTargetRuns;
    if (!hasTargetRuns && hasTarget) {
      nextTargetRuns = projectTextToTemplateRuns({
        text: String(nextTarget ?? ""),
        templateRuns: incomingTargetRuns,
        fallbackRuns: sourceRuns
      });
    }
    if (hasTargetRuns && !hasTarget) {
      nextTarget = runsToPlainText(nextTargetRuns);
    }
    const nextTargetText = String(nextTarget ?? "");
    if (nextTargetText) {
      if (runsToPlainText(nextTargetRuns) !== nextTargetText) {
        nextTargetRuns = projectTextToTemplateRuns({
          text: nextTargetText,
          templateRuns: nextTargetRuns,
          fallbackRuns: sourceRuns
        });
      }
    } else {
      nextTargetRuns = [];
    }

    const hasOriginDetails = Object.prototype.hasOwnProperty.call(body, "originDetails");
    const nextOriginDetails = hasOriginDetails
      ? normalizeOriginDetails(body?.originDetails)
      : normalizeOriginDetails(seg.origin_details ?? {});

    const hasQeScore = Object.prototype.hasOwnProperty.call(body, "qeScore");
    let nextQeScore = seg.qe_score ?? null;
    if (hasQeScore) {
      if (body?.qeScore == null || String(body?.qeScore).trim() === "") {
        nextQeScore = null;
      } else {
        const parsed = Number(body?.qeScore);
        if (!Number.isFinite(parsed)) {
          return reply.code(400).send({
            error: "Invalid QE score.",
            code: "SEGMENT_QE_SCORE_INVALID"
          });
        }
        nextQeScore = parsed;
      }
    }

    const hasGeneratedByLlm = Object.prototype.hasOwnProperty.call(body, "generatedByLlm");
    let nextGeneratedByLlm = hasGeneratedByLlm ? Boolean(body?.generatedByLlm) : Boolean(seg.generated_by_llm);

    if (parsedSourceType === "nmt") {
      nextGeneratedByLlm = true;
    }

    const termbase = await loadTermbaseIndex({ projectId: seg.project_id, taskId: seg.task_id });
    const { issues, summary } = computeSegmentIssues({ src: seg.src, tgt: nextTarget, termbase });
    const forceReviewed = requestedState === "reviewed" || body?.forceReviewed === true || body?.markReviewed === true;
    const engineSeeded = hasGeneratedByLlm && nextGeneratedByLlm;
    const targetChanged = hasTarget && String(nextTarget ?? "") !== String(seg.tgt ?? "");

    let nextState: SegmentState = requestedState ?? (hasStatus ? stateFromStatus(requestedStatus) : currentState);
    if (unlocking) {
      nextState = "draft";
    } else if (forceReviewed) {
      nextState = "reviewed";
    } else if (targetChanged) {
      nextState = engineSeeded ? "nmt_draft" : "draft";
    }

    const finalStatus =
      hasStatus && requestedStatus === "under_review" && nextState !== "reviewed"
        ? "under_review"
        : mapStateToStatus(nextState);
    if (finalStatus === "reviewed" && isBlank(nextTarget)) {
      return reply.code(400).send({
        error: "Cannot mark a segment as reviewed with an empty target.",
        code: "SEGMENT_TARGET_REQUIRED_FOR_REVIEWED"
      });
    }

    const autoLock = !unlocking && nextState === "reviewed";
    const applyIsLocked = hasIsLocked || autoLock;
    const nextIsLocked = hasIsLocked ? Boolean(parsedIsLocked) : autoLock ? true : Boolean(seg.is_locked);

    const updateRes = await db.query<{ version: number }>(
      `UPDATE segments
       SET tgt = $1,
           tgt_runs = $2,
           status = $3,
           state = $4,
           is_locked = CASE WHEN $5 THEN $6 ELSE is_locked END,
           generated_by_llm = $7,
           qe_score = $8,
           issue_summary = $9,
           issue_details = $10,
           source_type = CASE WHEN $11 THEN $12 ELSE source_type END,
           source_score = CASE WHEN $13 THEN $14 ELSE source_score END,
           source_match_id = CASE WHEN $15 THEN $16 ELSE source_match_id END,
           origin_details = CASE WHEN $17 THEN $18 ELSE origin_details END,
           updated_by = $19,
           updated_at = $20,
           version = version + 1
       WHERE id = $21 AND version = $22
       RETURNING version`,
      [
        nextTarget,
        JSON.stringify(nextTargetRuns),
        finalStatus,
        nextState,
        applyIsLocked,
        nextIsLocked,
        nextGeneratedByLlm,
        nextQeScore,
        JSON.stringify(summary),
        JSON.stringify(issues),
        hasSourceType,
        parsedSourceType,
        hasSourceScore,
        nextSourceScore,
        hasSourceMatchId,
        nextSourceMatchId,
        hasOriginDetails,
        JSON.stringify(nextOriginDetails),
        userId,
        now,
        sid,
        currentVersion
      ]
    );

    if (updateRes.rowCount === 0) {
      return reply.code(409).send({
        error: "Segment has been modified by someone else.",
        code: "SEGMENT_VERSION_CONFLICT",
        currentVersion
      });
    }

    const shouldLogFinalization =
      currentState !== "reviewed" && nextState === "reviewed";
    if (shouldLogFinalization) {
      await db.query(
        `INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sid, seg.tgt ?? null, nextTarget, userId, now]
      );
    }

    if (seg.task_id != null) {
      await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = $1`, [seg.task_id, now]);
    }

    broadcast("segment:update", { segmentId: sid });

    try {
      const createdBy = (projectRow as any).created_by ? String((projectRow as any).created_by) : null;
      const assignedUserRaw = (projectRow as any).assigned_user ? String((projectRow as any).assigned_user) : null;
      const assignedUser = assignedUserRaw || createdBy;
      const nowMs = Date.now();
      if (createdBy) await addFileToAssigned(createdBy, seg.file_id, nowMs);
      if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, seg.file_id, nowMs);
      await touchProjectForUsers({ projectId: seg.project_id, createdBy, assignedUser, updatedAtMs: nowMs });
    } catch {
      /* ignore redis errors */
    }

    return {
      ok: true,
      version: updateRes.rows[0]?.version ?? currentVersion + 1,
      status: finalStatus,
      state: nextState,
      isLocked: nextIsLocked,
      generatedByLlm: nextGeneratedByLlm,
      qeScore: nextQeScore,
      tgtRuns: nextTargetRuns,
      originDetails: nextOriginDetails,
      issueSummary: summary,
      issues
    };
  });

  app.get("/segments/:id/history", { preHandler: [requireAuth] }, async (req, reply) => {
    const sid = Number((req.params as any).id);
    if (!Number.isFinite(sid) || sid <= 0) {
      return reply.code(400).send({ error: "Invalid segment id." });
    }
    const limitRaw = Number((req.query as any)?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;

    const segRes = await db.query<{
      id: number;
      project_id: number;
      seg_index: number;
      file_id: number;
      task_id: number | null;
    }>(
      `SELECT id, project_id, seg_index, file_id, task_id
       FROM segments
       WHERE id = $1
       LIMIT 1`,
      [sid]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Segment not found" });
    const accessRow = await ensureProjectAccess(seg.project_id, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    const historyRes = await db.query<{
      id: number;
      old_tgt: string | null;
      new_tgt: string | null;
      updated_by: string | null;
      created_at: string;
    }>(
      `SELECT id, old_tgt, new_tgt, updated_by, created_at
       FROM segment_history
       WHERE segment_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sid, limit]
    );

    return {
      segmentId: sid,
      segmentNo: Number(seg.seg_index) + 1,
      entries: historyRes.rows.map((row) => ({
        id: row.id,
        oldTgt: row.old_tgt ?? "",
        newTgt: row.new_tgt ?? "",
        updatedBy: row.updated_by ?? null,
        createdAt: row.created_at
      }))
    };
  });

  // BULK: recompute QA issues
  app.post("/segments/recompute-issues", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const segmentIds = normalizeIdList(body.segmentIds ?? body.segment_ids);
    const taskId = Number(body.taskId ?? body.task_id);
    const fileId = Number(body.fileId ?? body.file_id);
    const user = getRequestUser(req);

    let rows: Array<{
      id: number;
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      issue_summary: any;
      issue_details: any;
    }> = [];

    if (segmentIds.length > 0) {
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                issue_summary,
                issue_details
         FROM segments
         WHERE id = ANY($1::int[])`,
        [segmentIds]
      );
      rows = res.rows as typeof rows;
      if (rows.length === 0) return reply.code(404).send({ error: "Segments not found." });
      const projectIds = Array.from(new Set(rows.map((row) => row.project_id)));
      if (projectIds.length > 1) {
        return reply.code(400).send({ error: "Segments must belong to the same project." });
      }
      const accessRow = await ensureProjectAccess(projectIds[0]!, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
    } else if (Number.isFinite(taskId) && taskId > 0) {
      const taskRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM translation_tasks WHERE id = $1 LIMIT 1`,
        [taskId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      const accessRow = await ensureProjectAccess(taskRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                issue_summary,
                issue_details
         FROM segments
         WHERE task_id = $1
         ORDER BY seg_index`,
        [taskId]
      );
      rows = res.rows as typeof rows;
    } else if (Number.isFinite(fileId) && fileId > 0) {
      const fileRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM project_files WHERE id = $1 LIMIT 1`,
        [fileId]
      );
      const fileRow = fileRes.rows[0];
      if (!fileRow) return reply.code(404).send({ error: "File not found" });
      const accessRow = await ensureProjectAccess(fileRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                issue_summary,
                issue_details
         FROM segments
         WHERE file_id = $1 AND task_id IS NULL
         ORDER BY seg_index`,
        [fileId]
      );
      rows = res.rows as typeof rows;
    } else {
      return reply.code(400).send({ error: "Provide segmentIds, taskId, or fileId." });
    }

    if (rows.length === 0) {
      return { ok: true, updated: 0, segments: [] };
    }

    const termbaseCache = new Map<string, TermbaseIndex | null>();
    const updated: Array<{
      id: number;
      status: SegmentStatus;
      state: SegmentState;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
    }> = [];

    for (const row of rows) {
      const cacheKey = `${row.project_id}:${row.task_id ?? "none"}`;
      let termbase = termbaseCache.get(cacheKey);
      if (termbase === undefined) {
        termbase = await loadTermbaseIndex({ projectId: row.project_id, taskId: row.task_id });
        termbaseCache.set(cacheKey, termbase ?? null);
      }
      const { issues, summary } = computeSegmentIssues({
        src: row.src,
        tgt: row.tgt,
        termbase: termbase ?? null
      });
      await db.query(
        `UPDATE segments
         SET issue_summary = $2,
             issue_details = $3
         WHERE id = $1`,
        [row.id, JSON.stringify(summary), JSON.stringify(issues)]
      );
      const status = coerceSegmentStatus(row.status);
      const state = coerceSegmentState(row.state, status);
      updated.push({ id: row.id, status, state, issueSummary: summary, issues });
    }

    return { ok: true, updated: updated.length, segments: updated };
  });

  // BULK: mark reviewed (segments list)
  app.post("/segments/mark-reviewed", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const segmentIds = normalizeIdList(body.segmentIds ?? body.segment_ids);
    if (segmentIds.length === 0) {
      return reply.code(400).send({ error: "segmentIds must be provided." });
    }
    const forceReviewed = body.forceReviewed === true || body.force === true;
    const user = getRequestUser(req);

    const segRes = await db.query<{
      id: number;
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      issue_summary: any;
      issue_details: any;
      is_locked: boolean | null;
      version: number;
    }>(
      `SELECT id,
              project_id,
              file_id,
              task_id,
              src,
              tgt,
              status,
              state,
              generated_by_llm,
              qe_score,
              issue_summary,
              issue_details,
              is_locked,
              version
       FROM segments
       WHERE id = ANY($1::int[])`,
      [segmentIds]
    );
    const rows = segRes.rows;
    if (rows.length === 0) return reply.code(404).send({ error: "Segments not found." });
    const projectIds = Array.from(new Set(rows.map((row) => row.project_id)));
    if (projectIds.length > 1) {
      return reply.code(400).send({ error: "Segments must belong to the same project." });
    }
    const accessRow = await ensureProjectAccess(projectIds[0]!, user, reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    const termbaseCache = new Map<string, TermbaseIndex | null>();
    const now = new Date().toISOString();
    const userId = requestUserId(user) ?? "system";
    const updated: Array<{
      id: number;
      status: SegmentStatus;
      state: SegmentState;
      isLocked: boolean;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
      version: number;
    }> = [];
    const skipped: number[] = [];
    const taskIds = new Set<number>();

    for (const row of rows) {
      const tgt = String(row.tgt ?? "");
      if (!tgt.trim()) {
        skipped.push(row.id);
        continue;
      }
      const cacheKey = `${row.project_id}:${row.task_id ?? "none"}`;
      let termbase = termbaseCache.get(cacheKey);
      if (termbase === undefined) {
        termbase = await loadTermbaseIndex({ projectId: row.project_id, taskId: row.task_id });
        termbaseCache.set(cacheKey, termbase ?? null);
      }
      const { issues, summary } = computeSegmentIssues({
        src: row.src,
        tgt: row.tgt,
        termbase: termbase ?? null
      });
      const currentStatus = coerceSegmentStatus(row.status);
      const currentState = coerceSegmentState(row.state, currentStatus);
      let nextState: SegmentState = currentState;
      if (forceReviewed) {
        nextState = "reviewed";
      } else {
        const hasErrors = summary.error > 0;
        const lowQuality =
          row.qe_score != null && Number.isFinite(row.qe_score) && row.qe_score < QE_REVIEW_THRESHOLD;
        nextState = hasErrors || lowQuality ? "draft" : "reviewed";
      }
      const finalStatus = mapStateToStatus(nextState);
      const nextIsLocked = nextState === "reviewed" ? true : Boolean(row.is_locked);

      const updateRes = await db.query<{ version: number }>(
        `UPDATE segments
         SET status = $2,
             state = $3,
             is_locked = CASE WHEN $3 = 'reviewed' THEN TRUE ELSE is_locked END,
             issue_summary = $4,
             issue_details = $5,
             updated_by = $6,
             updated_at = $7,
             version = version + 1
         WHERE id = $1
         RETURNING version`,
        [row.id, finalStatus, nextState, JSON.stringify(summary), JSON.stringify(issues), userId, now]
      );

      if (nextState === "reviewed") {
        await db.query(
          `INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.id, row.tgt ?? null, row.tgt ?? null, userId, now]
        );
      }

      if (row.task_id != null) taskIds.add(row.task_id);

      updated.push({
        id: row.id,
        status: finalStatus,
        state: nextState,
        isLocked: nextIsLocked,
        issueSummary: summary,
        issues,
        version: updateRes.rows[0]?.version ?? (row.version ?? 0) + 1
      });
    }

    if (taskIds.size > 0) {
      await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = ANY($1::int[])`, [
        Array.from(taskIds.values()),
        now
      ]);
    }

    return {
      ok: true,
      updated: updated.length,
      skipped: skipped.length,
      segments: updated,
      skippedIds: skipped
    };
  });

  // BULK: accept clean LLM drafts
  app.post("/segments/accept-clean-llm-drafts", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const taskId = Number(body.taskId ?? body.task_id);
    const fileId = Number(body.fileId ?? body.file_id);
    const qeThresholdRaw = body.qeThreshold ?? body.qe_threshold;
    const qeThreshold = Number.isFinite(Number(qeThresholdRaw))
      ? Number(qeThresholdRaw)
      : QE_REVIEW_THRESHOLD;
    const user = getRequestUser(req);

    let rows: Array<{
      id: number;
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      version: number;
    }> = [];

    if (Number.isFinite(taskId) && taskId > 0) {
      const taskRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM translation_tasks WHERE id = $1 LIMIT 1`,
        [taskId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      const accessRow = await ensureProjectAccess(taskRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                version
         FROM segments
         WHERE task_id = $1
         ORDER BY seg_index`,
        [taskId]
      );
      rows = res.rows as typeof rows;
    } else if (Number.isFinite(fileId) && fileId > 0) {
      const fileRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM project_files WHERE id = $1 LIMIT 1`,
        [fileId]
      );
      const fileRow = fileRes.rows[0];
      if (!fileRow) return reply.code(404).send({ error: "File not found" });
      const accessRow = await ensureProjectAccess(fileRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                version
         FROM segments
         WHERE file_id = $1 AND task_id IS NULL
         ORDER BY seg_index`,
        [fileId]
      );
      rows = res.rows as typeof rows;
    } else {
      return reply.code(400).send({ error: "Provide taskId or fileId." });
    }

    if (rows.length === 0) {
      return { ok: true, updated: 0, segments: [] };
    }

    const termbaseCache = new Map<string, TermbaseIndex | null>();
    const now = new Date().toISOString();
    const userId = requestUserId(user) ?? "system";
    const updated: Array<{
      id: number;
      status: SegmentStatus;
      state: SegmentState;
      isLocked: boolean;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
      version: number;
    }> = [];
    const taskIds = new Set<number>();

    for (const row of rows) {
      const status = coerceSegmentStatus(row.status);
      const currentState = coerceSegmentState(row.state, status);
      if (currentState !== "nmt_draft") continue;
      if (!row.generated_by_llm) continue;
      const cacheKey = `${row.project_id}:${row.task_id ?? "none"}`;
      let termbase = termbaseCache.get(cacheKey);
      if (termbase === undefined) {
        termbase = await loadTermbaseIndex({ projectId: row.project_id, taskId: row.task_id });
        termbaseCache.set(cacheKey, termbase ?? null);
      }
      const { issues, summary } = computeSegmentIssues({
        src: row.src,
        tgt: row.tgt,
        termbase: termbase ?? null
      });
      const hasIssues = summary.error + summary.warning > 0;
      const lowQuality =
        row.qe_score != null && Number.isFinite(row.qe_score) && row.qe_score < qeThreshold;
      if (hasIssues || lowQuality) continue;

      const nextState: SegmentState = "reviewed";
      const finalStatus = mapStateToStatus(nextState);

      const updateRes = await db.query<{ version: number }>(
        `UPDATE segments
         SET status = $2,
             state = $3,
             is_locked = TRUE,
             issue_summary = $4,
             issue_details = $5,
             updated_by = $6,
             updated_at = $7,
             version = version + 1
         WHERE id = $1
         RETURNING version`,
        [row.id, finalStatus, nextState, JSON.stringify(summary), JSON.stringify(issues), userId, now]
      );

      if (nextState === "reviewed") {
        await db.query(
          `INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.id, row.tgt ?? null, row.tgt ?? null, userId, now]
        );
      }

      if (row.task_id != null) taskIds.add(row.task_id);

      updated.push({
        id: row.id,
        status: finalStatus,
        state: nextState,
        isLocked: true,
        issueSummary: summary,
        issues,
        version: updateRes.rows[0]?.version ?? (row.version ?? 0) + 1
      });
    }

    if (taskIds.size > 0) {
      await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = ANY($1::int[])`, [
        Array.from(taskIds.values()),
        now
      ]);
    }

    return { ok: true, updated: updated.length, segments: updated };
  });

  app.post("/projects/:projectId/files/:fileId/segments/bulk-approve", { preHandler: [requireAuth] }, async (req, reply) => {
    pruneBulkJobs();
    const projectId = Number((req.params as any).projectId);
    const fileId = Number((req.params as any).fileId);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return reply.code(400).send({ error: "Invalid projectId." });
    }
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid fileId." });
    }

    const user = getRequestUser(req);
    const requesterId = requestUserId(user);
    const canApproveAny = isAdminUser(user) || isManagerUser(user);
    const body = (req.body as any) || {};
    const parsedScope = normalizeBulkScope(body.scope);
    if (body.scope != null && parsedScope == null) {
      return reply.code(400).send({ error: "Invalid bulk approval scope.", code: "BULK_SCOPE_INVALID" });
    }
    const scope = parsedScope ?? "all";
    const parsedQaPolicy = normalizeBulkQaPolicy(body.qaPolicy);
    if (body.qaPolicy != null && parsedQaPolicy == null) {
      return reply.code(400).send({ error: "Invalid bulk approval QA policy.", code: "BULK_QA_POLICY_INVALID" });
    }
    const qaPolicy = parsedQaPolicy ?? (scope === "clean" ? "require_clean" : "ignore");
    const dryRun = body.dryRun === true || body.preview === true || body.estimateOnly === true;
    const taskIdRaw = Number(body.taskId ?? body.task_id);
    const taskId = Number.isFinite(taskIdRaw) && taskIdRaw > 0 ? Math.trunc(taskIdRaw) : null;
    const filters = normalizeFilterObject(body.filters);

    const accessRow = await ensureProjectAccess(projectId, user, reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    if (taskId != null) {
      const taskAccess = await ensureTaskAccess(taskId, user, reply);
      if (!taskAccess) return;
      if (Number(taskAccess.project_id) !== projectId || Number(taskAccess.file_id) !== fileId) {
        return reply.code(400).send({
          error: "taskId does not belong to the selected project/file.",
          code: "TASK_FILE_MISMATCH"
        });
      }
      await ensureTaskSegments(taskId);
    } else if (!canApproveAny) {
      return reply.code(400).send({
        error: "taskId is required for reviewer bulk approval.",
        code: "TASK_ID_REQUIRED"
      });
    }

    let rows: BulkCandidateRow[] = [];
    try {
      rows = await loadBulkApproveCandidates({
        projectId,
        fileId,
        taskId,
        scope,
        filters
      });
    } catch (err: any) {
      return reply.code(400).send({
        error: err?.message || "Invalid bulk approval filters.",
        code: "BULK_FILTER_INVALID"
      });
    }

    const projectOwner =
      accessRow && typeof accessRow === "object"
        ? String((accessRow as any).assigned_user ?? (accessRow as any).created_by ?? "").trim() || null
        : null;
    const estimate = await evaluateBulkApproveCandidates({
      rows,
      qaPolicy,
      requesterId,
      canApproveAny,
      projectOwner,
      persistQaPayload: qaPolicy === "require_clean"
    });
    const estimated = toBulkEstimatePublic(estimate);

    if (dryRun) {
      return { ok: true, dryRun: true, estimated };
    }

    const nowMs = Date.now();
    const jobId = `ba_${nowMs}_${Math.floor(Math.random() * 1_000_000)}`;
    const initialProgress = computeBulkProgress(
      estimate.total,
      estimate.skipped,
      0,
      estimate.skipped
    );
    const job: BulkJobRecord = {
      id: jobId,
      status: "queued",
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      scope,
      projectId,
      fileId,
      taskId,
      progress: initialProgress,
      estimated,
      summary: null,
      error: null
    };
    bulkJobsById.set(jobId, job);

    const jobUserId = requesterId ?? "system";
    setTimeout(() => {
      void runBulkApproveJob({
        job,
        eligibleCandidates: estimate.eligibleCandidates,
        initialSkippedCount: estimate.skipped,
        initialReasons: estimate.reasonsBreakdown,
        initialSkippedIds: estimate.skippedSegmentIds,
        initialProblematicIds: estimate.problematicSegmentIds,
        userId: jobUserId,
        accessRow
      });
    }, 0);

    return {
      ok: true,
      jobId,
      estimated
    };
  });

  app.get("/bulk-jobs/:jobId", { preHandler: [requireAuth] }, async (req, reply) => {
    pruneBulkJobs();
    const jobId = String((req.params as any).jobId || "").trim();
    if (!jobId) {
      return reply.code(400).send({ error: "Invalid jobId." });
    }

    const job = bulkJobsById.get(jobId);
    if (!job) {
      return reply.code(404).send({ error: "Bulk job not found." });
    }

    const accessRow = await ensureProjectAccess(job.projectId, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    return {
      jobId: job.id,
      status: job.status,
      scope: job.scope,
      projectId: job.projectId,
      fileId: job.fileId,
      taskId: job.taskId,
      progress: job.progress,
      estimated: job.estimated,
      summary: job.summary,
      error: job.error,
      createdAt: new Date(job.createdAtMs).toISOString(),
      updatedAt: new Date(job.updatedAtMs).toISOString()
    };
  });

  // LLM TRANSLATION
  app.post("/segments/:id/llm", { preHandler: [requireAuth] }, async (req, reply) => {
    const sid = Number((req.params as any).id);
    const segRes = await db.query<{ project_id: number }>(
      "SELECT project_id FROM segments WHERE id = $1 LIMIT 1",
      [sid]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Segment not found" });
    const accessRow = await ensureProjectAccess(seg.project_id, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    try {
      const traceId = (req.headers["x-request-id"] as string | undefined) ?? req.id;
      const result = await requestSegmentLlmPayload({ segmentId: sid, traceId });
      return reply.status(result.status).send(result.payload);
    } catch (err: any) {
      if (err instanceof SegmentLlmError) {
        return reply.code(err.status).send({ error: err.message });
      }
      return reply.code(502).send({ error: "LLM Error" });
    }
  });
}

function parseSegmentStatus(input: any): SegmentStatus | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;
  if (value === "draft") return "draft";
  if (value === "under_review" || value === "under review" || value === "under-review") {
    return "under_review";
  }
  if (value === "reviewed") return "reviewed";
  // Backwards-compat: "approved" was merged into "reviewed"
  if (value === "approved") return "reviewed";
  return null;
}

function parseSourceType(input: any): SegmentSourceType | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;
  if (value === "tmx" || value === "tm") return "tmx";
  if (value === "nmt" || value === "mt") return "nmt";
  if (value === "ntm_draft" || value === "ntm draft" || value === "ntm-draft") return "ntm_draft";
  if (value === "llm" || value === "llm_draft" || value === "llm draft" || value === "llm-draft") return "llm";
  if (value === "manual" || value === "human") return "manual";
  if (value === "none" || value === "-") return "none";
  return null;
}

function coerceSegmentStatus(input: any): SegmentStatus {
  return parseSegmentStatus(input) ?? "draft";
}

function canTransitionSegmentStatus(from: SegmentStatus, to: SegmentStatus): boolean {
  if (from === to) return true;
  if (from === "draft") return to === "under_review" || to === "reviewed";
  if (from === "under_review") return to === "reviewed" || to === "draft";
  if (from === "reviewed") return to === "under_review" || to === "draft";
  return false;
}

function isBlank(value: any): boolean {
  return String(value ?? "").trim().length === 0;
}
