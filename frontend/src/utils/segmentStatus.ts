import type { SegmentStatus } from "../types/app";

export const SEGMENT_STATUS_ORDER: SegmentStatus[] = [
  "draft",
  "under_review",
  "reviewed"
];

export const SEGMENT_STATUS_LABEL: Record<SegmentStatus, string> = {
  draft: "Draft",
  under_review: "Under review",
  reviewed: "Reviewed"
};

export function normalizeSegmentStatus(input: any): SegmentStatus {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "draft") return "draft";
  if (value === "under_review" || value === "under review" || value === "under-review") {
    return "under_review";
  }
  if (value === "reviewed") return "reviewed";
  if (value === "approved") return "reviewed";
  return "draft";
}

export function canTransitionSegmentStatus(
  from: SegmentStatus,
  to: SegmentStatus
): boolean {
  if (from === to) return true;
  if (to === "draft") return true;
  if (to === "reviewed") return true;
  if (from === "draft") return to === "under_review";
  if (from === "under_review") return to === "reviewed";
  if (from === "reviewed") return to === "under_review";
  return false;
}

export function isSegmentFinished(status: SegmentStatus): boolean {
  return status === "reviewed";
}

export function isSegmentEditable(status: SegmentStatus): boolean {
  return status === "draft";
}
