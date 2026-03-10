import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import {
  requireAuth,
  ensureProjectAccess,
  ensureProjectReady,
  getRequestUser,
  requestUserId,
  requestUserMatchesIdentifier,
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
export let broadcast: (event: string, payload: any) => void = () => {};
export function setBroadcaster(fn: any) { broadcast = fn; }

export type SegmentSourceType = "tmx" | "nmt" | "ntm_draft" | "llm" | "manual" | "none";
export type SegmentStatus = "draft" | "under_review" | "reviewed";

export type TermbaseRow = {
  term: string;
  translation: string;
  meta_json?: any;
};

export const QE_REVIEW_THRESHOLD = 0.7;
export const BULK_JOB_TTL_MS = 30 * 60 * 1000;
export const BULK_UPDATE_CHUNK_SIZE = 250;
export const BULK_MAX_TRACKED_IDS = 5000;

export type BulkApproveScope = "all" | "visible" | "clean";
export type BulkApproveQaPolicy = "ignore" | "require_clean";
export type BulkApproveSkipReason =
  | "already_reviewed"
  | "empty_target"
  | "qa_issues"
  | "locked"
  | "permission_denied"
  | "task_read_only"
  | "update_failed";

export type BulkCandidateRow = {
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
  reviewer_user: string | null;
};

export type EvaluatedBulkCandidate = {
  row: BulkCandidateRow;
  summary: IssueSummary;
  issues: SegmentIssue[];
  hasQaIssues: boolean;
};

export type BulkEstimateResult = {
  total: number;
  eligible: number;
  skipped: number;
  qaFlaggedEligible: number;
  reasonsBreakdown: Record<string, number>;
  skippedSegmentIds: number[];
  problematicSegmentIds: number[];
  eligibleCandidates: EvaluatedBulkCandidate[];
};

export type BulkEstimatePublic = Omit<BulkEstimateResult, "eligibleCandidates">;

export type BulkJobProgress = {
  total: number;
  processed: number;
  approved: number;
  skipped: number;
  percent: number;
};

export type BulkJobSummary = {
  approved: number;
  skipped: number;
  qaFlaggedApproved: number;
  reasonsBreakdown: Record<string, number>;
  skippedSegmentIds: number[];
  problematicSegmentIds: number[];
};

export type BulkJobStatus = "queued" | "running" | "completed" | "failed";

export type BulkJobRecord = {
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

export const bulkJobsById = new Map<string, BulkJobRecord>();
export const BULK_PROBLEMATIC_REASONS = new Set<BulkApproveSkipReason>([
  "empty_target",
  "qa_issues",
  "locked",
  "permission_denied",
  "task_read_only",
  "update_failed"
]);

export function pruneBulkJobs() {
  const now = Date.now();
  for (const [jobId, job] of bulkJobsById.entries()) {
    if (job.status === "queued" || job.status === "running") continue;
    if (now - job.updatedAtMs < BULK_JOB_TTL_MS) continue;
    bulkJobsById.delete(jobId);
  }
}

export function toBulkEstimatePublic(estimate: BulkEstimateResult): BulkEstimatePublic {
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

export function normalizeBulkScope(input: unknown): BulkApproveScope | null {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "all") return "all";
  if (value === "visible") return "visible";
  if (value === "clean") return "clean";
  return null;
}

export function normalizeBulkQaPolicy(input: unknown): BulkApproveQaPolicy | null {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "ignore") return "ignore";
  if (value === "require_clean" || value === "require clean") return "require_clean";
  return null;
}

export function normalizeReviewGateStatus(value: unknown): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
    return "under_review";
  }
  if (raw === "error") return "error";
  return "draft";
}

export function isTaskReadOnlyStatus(value: unknown): boolean {
  return normalizeReviewGateStatus(value) === "reviewed";
}

export function parseFilterEnabled(input: unknown): boolean {
  if (input === true) return true;
  return parseBool(input) === true;
}

export function normalizeFilterText(input: unknown): string {
  return String(input ?? "").trim();
}

export function normalizeFilterObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

export function incrementReason(map: Record<string, number>, reason: BulkApproveSkipReason) {
  map[reason] = (map[reason] ?? 0) + 1;
}

export function pushTrackedId(target: number[], id: number) {
  if (!Number.isFinite(id) || id <= 0) return;
  if (target.length >= BULK_MAX_TRACKED_IDS) return;
  if (target.includes(id)) return;
  target.push(id);
}

export function canApproveBulkRow(params: {
  row: BulkCandidateRow;
  requester: ReturnType<typeof getRequestUser>;
  canApproveAny: boolean;
  projectOwner: string | null;
}): boolean {
  if (params.canApproveAny) return true;
  if (params.row.task_id != null) {
    return (
      requestUserMatchesIdentifier(params.requester, params.row.translator_user) ||
      requestUserMatchesIdentifier(params.requester, params.row.reviewer_user)
    );
  }
  return requestUserMatchesIdentifier(params.requester, params.projectOwner);
}

export function computeBulkProgress(total: number, processed: number, approved: number, skipped: number): BulkJobProgress {
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

export async function loadBulkApproveCandidates(params: {
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
            t.translator_user,
            t.reviewer_user
     FROM segments s
     LEFT JOIN translation_tasks t ON t.id = s.task_id
     WHERE ${where.join(" AND ")}
     ORDER BY s.seg_index ASC, s.id ASC`,
    values
  );
  return res.rows;
}

export async function persistBulkQaIssuePayload(updates: Array<{ id: number; summary: IssueSummary; issues: SegmentIssue[] }>) {
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

export async function evaluateBulkApproveCandidates(params: {
  rows: BulkCandidateRow[];
  qaPolicy: BulkApproveQaPolicy;
  requester: ReturnType<typeof getRequestUser>;
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
      requester: params.requester,
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

export async function runBulkApproveJob(params: {
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

export function statusFromMeta(meta: Record<string, any>): "preferred" | "allowed" | "forbidden" {
  if (meta?.forbidden === true) return "forbidden";
  if (meta?.preferred === true) return "preferred";
  return "allowed";
}

export function buildTermbaseIndex(rows: TermbaseRow[]): TermbaseIndex | null {
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

export async function loadTermbaseIndex(params: { projectId: number; taskId?: number | null }): Promise<TermbaseIndex | null> {
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

export function stateFromStatus(status: SegmentStatus): SegmentState {
  if (status === "reviewed") return "reviewed";
  return "draft";
}

export function coerceSegmentState(input: any, statusFallback: SegmentStatus): SegmentState {
  return normalizeSegmentState(input) ?? stateFromStatus(statusFallback);
}

export function normalizeIdList(input: any): number[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : String(input).split(",");
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

export function parseBool(input: any): boolean | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return null;
}


export function parseSegmentStatus(input: any): SegmentStatus | null {
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

export function parseSourceType(input: any): SegmentSourceType | null {
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

export function coerceSegmentStatus(input: any): SegmentStatus {
  return parseSegmentStatus(input) ?? "draft";
}

export function canTransitionSegmentStatus(from: SegmentStatus, to: SegmentStatus): boolean {
  if (from === to) return true;
  if (from === "draft") return to === "under_review" || to === "reviewed";
  if (from === "under_review") return to === "reviewed" || to === "draft";
  if (from === "reviewed") return to === "under_review" || to === "draft";
  return false;
}

export function isBlank(value: any): boolean {
  return String(value ?? "").trim().length === 0;
}
