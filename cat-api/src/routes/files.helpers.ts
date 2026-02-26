import { db, withTransaction } from "../db.js";
import {
  ensureProjectReady,
  getRequestUser,
  isAdminUser,
  isManagerUser,
  requestUserDepartmentId,
  requestUserId
} from "../middleware/auth.js";
import {
  normalizeSegmentState,
  type IssueSummary,
  type SegmentIssue,
  type SegmentState,
  type TermbaseIndex
} from "../lib/segment-issues.js";

export type { SegmentState } from "../lib/segment-issues.js";

export type SegmentStatus = "draft" | "under_review" | "reviewed";
export type SegmentSourceType = "tmx" | "nmt" | "ntm_draft" | "llm" | "manual" | "none";

export type TermbaseRow = {
  term: string;
  translation: string;
  meta_json?: any;
};

function statusFromMeta(meta: Record<string, any>): "preferred" | "allowed" | "forbidden" {
  if (meta?.forbidden === true) return "forbidden";
  if (meta?.preferred === true) return "preferred";
  return "allowed";
}

export function normalizeIssueSummary(value: any): IssueSummary {
  const summary: IssueSummary = { error: 0, warning: 0, byType: {} };
  if (!value || typeof value !== "object") return summary;
  const raw = value as Record<string, any>;
  if (Number.isFinite(raw.error)) summary.error = Number(raw.error);
  if (Number.isFinite(raw.warning)) summary.warning = Number(raw.warning);
  if (raw.byType && typeof raw.byType === "object") {
    Object.entries(raw.byType as Record<string, any>).forEach(([key, val]) => {
      if (Number.isFinite(Number(val))) summary.byType[key] = Number(val);
    });
  }
  return summary;
}

export function normalizeIssueDetails(value: any): SegmentIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const raw = item && typeof item === "object" ? (item as Record<string, any>) : null;
      if (!raw) return null;
      const code = String(raw.code || "").trim();
      const severity = String(raw.severity || "").trim().toLowerCase();
      if (!code || (severity !== "error" && severity !== "warning")) return null;
      return {
        code,
        severity: severity as "error" | "warning",
        message: String(raw.message || "").trim() || code
      } as SegmentIssue;
    })
    .filter(Boolean) as SegmentIssue[];
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

export function parseSegmentStatus(input: any): SegmentStatus | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;
  if (value === "draft") return "draft";
  if (value === "under_review" || value === "under review" || value === "under-review") {
    return "under_review";
  }
  if (value === "reviewed") return "reviewed";
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

export function coerceSourceType(input: any): SegmentSourceType {
  return parseSourceType(input) ?? "none";
}

export function coerceSegmentStatus(input: any): SegmentStatus {
  return parseSegmentStatus(input) ?? "draft";
}

export function stateFromStatus(status: SegmentStatus): SegmentState {
  if (status === "reviewed") return "reviewed";
  return "draft";
}

export function coerceSegmentState(input: any, statusFallback: SegmentStatus): SegmentState {
  return normalizeSegmentState(input) ?? stateFromStatus(statusFallback);
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

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export function parseBool(input: any): boolean | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return null;
}

export async function ensureTaskAccess(
  taskId: number,
  user: ReturnType<typeof getRequestUser>,
  reply: any
) {
  const res = await db.query<{
    task_id: number;
    project_id: number;
    file_id: number;
    target_lang: string;
    translator_user: string;
    department_id: number | null;
    status: string;
    init_error: string | null;
  }>(
    `SELECT t.id AS task_id,
            t.project_id,
            t.file_id,
            t.target_lang,
            t.translator_user,
            p.department_id,
            p.status,
            p.init_error
     FROM translation_tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1
     LIMIT 1`,
    [taskId]
  );
  const row = res.rows[0];
  if (!row) {
    reply.code(404).send({ error: "Task not found" });
    return null;
  }

  if (!ensureProjectReady(row, reply)) return null;
  if (isAdminUser(user)) return row;
  const departmentId = await requestUserDepartmentId(user);
  if (!departmentId || Number(row.department_id) !== Number(departmentId)) {
    reply.code(403).send({ error: "Task access denied" });
    return null;
  }
  if (isManagerUser(user)) return row;
  const userId = requestUserId(user);
  if (!userId || String(row.translator_user) !== String(userId)) {
    reply.code(403).send({ error: "Task access denied" });
    return null;
  }
  return row;
}

export async function ensureTaskSegments(taskId: number) {
  await withTransaction(async (client) => {
    const existing = await client.query("SELECT 1 FROM segments WHERE task_id = $1 LIMIT 1", [taskId]);
    if ((existing.rowCount ?? 0) > 0) return;

    const taskRes = await client.query<{
      project_id: number;
      file_id: number;
      target_lang: string;
      project_target: string;
    }>(
      `SELECT t.project_id,
              t.file_id,
              t.target_lang,
              p.tgt_lang AS project_target
       FROM translation_tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1
       LIMIT 1`,
      [taskId]
    );
    const taskRow = taskRes.rows[0];
    if (!taskRow) return;

    const baseCount = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM segments
       WHERE project_id = $1 AND file_id = $2 AND task_id IS NULL`,
      [taskRow.project_id, taskRow.file_id]
    );
    const total = Number(baseCount.rows[0]?.count ?? 0) || 0;
    if (total === 0) return;

    const targetLang = String(taskRow.target_lang || "").trim().toLowerCase();
    const projectTarget = String(taskRow.project_target || "").trim().toLowerCase();
    const useExistingTarget = targetLang && projectTarget && targetLang === projectTarget;

    await client.query(
      `INSERT INTO segments(
         project_id,
         file_id,
         task_id,
         seg_index,
         src,
         tgt,
         src_runs,
         tgt_runs,
         segment_context,
         origin_details,
         word_count,
         status,
         state,
         generated_by_llm,
         qe_score,
         issue_summary,
         issue_details,
         source_type,
         source_score,
         source_match_id
       )
       SELECT
         s.project_id,
         s.file_id,
         $3,
         s.seg_index,
         s.src,
         CASE WHEN $4 THEN s.tgt ELSE NULL END,
         COALESCE(s.src_runs, '[]'::jsonb),
         CASE WHEN $4 THEN COALESCE(s.tgt_runs, '[]'::jsonb) ELSE '[]'::jsonb END,
         COALESCE(s.segment_context, '{}'::jsonb),
         CASE WHEN $4 THEN COALESCE(s.origin_details, '{}'::jsonb) ELSE '{}'::jsonb END,
         s.word_count,
         CASE WHEN $4 THEN s.status ELSE 'draft' END,
         CASE
           WHEN $4 THEN
             CASE
               WHEN LOWER(COALESCE(s.state, '')) = 'nmt_draft'
                 AND COALESCE(s.generated_by_llm, FALSE) = FALSE
                 AND LOWER(COALESCE(s.source_type, 'none')) NOT IN ('nmt', 'mt')
               THEN 'draft'
               ELSE s.state
             END
           ELSE 'draft'
         END,
         CASE WHEN $4 THEN COALESCE(s.generated_by_llm, FALSE) ELSE FALSE END,
         CASE WHEN $4 THEN s.qe_score ELSE NULL END,
         CASE WHEN $4 THEN COALESCE(s.issue_summary, '{}'::jsonb) ELSE '{}'::jsonb END,
         CASE WHEN $4 THEN COALESCE(s.issue_details, '[]'::jsonb) ELSE '[]'::jsonb END,
         CASE WHEN $4 THEN s.source_type ELSE 'none' END,
         CASE WHEN $4 THEN s.source_score ELSE NULL END,
         CASE WHEN $4 THEN s.source_match_id ELSE NULL END
       FROM segments s
       WHERE s.project_id = $1 AND s.file_id = $2 AND s.task_id IS NULL
       ORDER BY s.seg_index`,
      [taskRow.project_id, taskRow.file_id, taskId, useExistingTarget]
    );
  });
}
