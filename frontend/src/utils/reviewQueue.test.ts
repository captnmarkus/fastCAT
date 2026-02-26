import { describe, expect, it, vi } from "vitest";
import type { Segment } from "../api";
import type { SegmentIssue } from "./qa";
import { buildIssueJumpHandler, filterSegmentsForReviewQueue } from "./reviewQueue";

describe("filterSegmentsForReviewQueue", () => {
  it("keeps only issue segments when enabled", () => {
    const segments: Segment[] = [
      { id: 1, index: 0, src: "A", tgt: "B", status: "draft", state: "draft", version: 1 },
      { id: 2, index: 1, src: "C", tgt: "D", status: "draft", state: "nmt_draft", version: 1 },
      { id: 3, index: 2, src: "E", tgt: "F", status: "draft", state: "draft", version: 1 }
    ];
    const issuesById: Record<number, SegmentIssue[]> = {
      3: [{ code: "NUMBER_MISMATCH", severity: "warning", message: "Numbers differ." }]
    };

    const filtered = filterSegmentsForReviewQueue(segments, issuesById, true);
    expect(filtered.map((seg) => seg.id)).toEqual([3]);
  });

  it("returns all segments when disabled", () => {
    const segments: Segment[] = [
      { id: 1, index: 0, src: "A", tgt: "B", status: "draft", state: "draft", version: 1 },
      { id: 2, index: 1, src: "C", tgt: "D", status: "draft", state: "nmt_draft", version: 1 }
    ];
    const filtered = filterSegmentsForReviewQueue(segments, {}, false);
    expect(filtered).toEqual(segments);
  });
});

describe("buildIssueJumpHandler", () => {
  it("focuses the segment and highlights the target", () => {
    const setActiveId = vi.fn();
    const setOccurrenceHighlight = vi.fn();
    const jump = buildIssueJumpHandler(setActiveId, setOccurrenceHighlight);

    jump(12);

    expect(setActiveId).toHaveBeenCalledWith(12);
    expect(setOccurrenceHighlight).toHaveBeenCalledWith({ segmentId: 12, term: "", side: "target" });
  });

  it("ignores empty ids", () => {
    const setActiveId = vi.fn();
    const setOccurrenceHighlight = vi.fn();
    const jump = buildIssueJumpHandler(setActiveId, setOccurrenceHighlight);

    jump(0);

    expect(setActiveId).not.toHaveBeenCalled();
    expect(setOccurrenceHighlight).not.toHaveBeenCalled();
  });
});
