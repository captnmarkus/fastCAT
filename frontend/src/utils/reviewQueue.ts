import type { Segment } from "../api";
import type { SegmentIssue } from "./qa";

export type IssueHighlight = {
  segmentId: number;
  term: string;
  side: "source" | "target";
};

export function shouldIncludeInReviewQueue(
  segment: Segment,
  issuesById: Record<number, SegmentIssue[]>
): boolean {
  const issues = issuesById[segment.id] ?? segment.issues ?? [];
  return issues.length > 0;
}

export function filterSegmentsForReviewQueue(
  segments: Segment[],
  issuesById: Record<number, SegmentIssue[]>,
  enabled: boolean
): Segment[] {
  if (!enabled) return segments;
  return segments.filter((seg) => shouldIncludeInReviewQueue(seg, issuesById));
}

export function buildIssueJumpHandler(
  setActiveId: (id: number) => void,
  setOccurrenceHighlight: (value: IssueHighlight | null) => void
) {
  return (segmentId: number) => {
    if (!segmentId) return;
    setActiveId(segmentId);
    setOccurrenceHighlight({ segmentId, term: "", side: "target" });
  };
}
