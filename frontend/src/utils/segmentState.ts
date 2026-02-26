import type { SegmentState, SegmentStatus } from "../types/app";

export const SEGMENT_STATE_LABEL: Record<SegmentState, string> = {
  draft: "Draft",
  nmt_draft: "NMT Draft",
  reviewed: "Reviewed"
};

export const SEGMENT_STATE_TONE: Record<SegmentState, "secondary" | "warning" | "success"> = {
  draft: "secondary",
  nmt_draft: "secondary",
  reviewed: "success"
};

export function normalizeSegmentState(input: any): SegmentState | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;
  if (value === "nmt_draft" || value === "nmt draft" || value === "nmt-draft") return "nmt_draft";
  if (value === "llm_draft" || value === "llm draft" || value === "llm-draft") return "nmt_draft";
  if (value === "needs_review" || value === "needs review" || value === "needs-review") return "draft";
  if (value === "reviewed" || value === "approved") return "reviewed";
  if (value === "draft") return "draft";
  if (value === "under_review" || value === "under review" || value === "under-review") return "draft";
  return null;
}

export function stateFromStatus(status: SegmentStatus): SegmentState {
  if (status === "reviewed") return "reviewed";
  return "draft";
}

export function coerceSegmentState(input: any, statusFallback?: SegmentStatus): SegmentState {
  return normalizeSegmentState(input) ?? (statusFallback ? stateFromStatus(statusFallback) : "draft");
}

export function isSegmentReviewed(state: SegmentState): boolean {
  return state === "reviewed";
}
