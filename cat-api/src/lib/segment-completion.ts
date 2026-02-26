export type CompletionScope =
  | { kind: "file"; id: number }
  | { kind: "task"; id: number };

export type SegmentCompletionCounts = {
  total: number;
  draft: number;
  underReview: number;
  reviewed: number;
  emptyTarget: number;
};

type Queryable = {
  query: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[] }>;
};

type CompletionCountsRow = {
  total: number | string | null;
  draft: number | string | null;
  under_review: number | string | null;
  reviewed: number | string | null;
  empty_target: number | string | null;
};

const NO_COUNTS: SegmentCompletionCounts = {
  total: 0,
  draft: 0,
  underReview: 0,
  reviewed: 0,
  emptyTarget: 0
};

function toCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function completionScopeLabel(scope: CompletionScope): string {
  return scope.kind === "task" ? "Task" : "File";
}

export async function getSegmentCompletionCounts(
  db: Queryable,
  scope: CompletionScope
): Promise<SegmentCompletionCounts> {
  const where =
    scope.kind === "task"
      ? "task_id = $1"
      : "file_id = $1 AND task_id IS NULL";

  const res = await db.query<CompletionCountsRow>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
            COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
            COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed,
            COUNT(*) FILTER (WHERE BTRIM(COALESCE(tgt, '')) = '')::int AS empty_target
     FROM segments
     WHERE ${where}`,
    [scope.id]
  );

  const row = res.rows[0];
  if (!row) return NO_COUNTS;

  return {
    total: toCount(row.total),
    draft: toCount(row.draft),
    underReview: toCount(row.under_review),
    reviewed: toCount(row.reviewed),
    emptyTarget: toCount(row.empty_target)
  };
}

export type ReviewedCompletionGuardResult =
  | { ok: true }
  | {
      ok: false;
      code: "COMPLETE_REQUIRES_UNDER_REVIEW" | "COMPLETE_TARGET_REQUIRED";
      error: string;
      details: SegmentCompletionCounts;
    };

export function validateReviewedCompletion(
  scope: CompletionScope,
  counts: SegmentCompletionCounts
): ReviewedCompletionGuardResult {
  const label = completionScopeLabel(scope);

  if (counts.draft > 0) {
    return {
      ok: false,
      code: "COMPLETE_REQUIRES_UNDER_REVIEW",
      error: `${label} still has draft segments. Move all draft segments to Under review before marking as reviewed.`,
      details: counts
    };
  }

  if (counts.emptyTarget > 0) {
    return {
      ok: false,
      code: "COMPLETE_TARGET_REQUIRED",
      error: `${label} has empty target segments. Fill all targets before marking as reviewed.`,
      details: counts
    };
  }

  return { ok: true };
}
