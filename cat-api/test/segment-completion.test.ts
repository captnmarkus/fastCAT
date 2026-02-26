import test from "node:test";
import assert from "node:assert/strict";
import {
  validateReviewedCompletion,
  type SegmentCompletionCounts
} from "../src/lib/segment-completion.js";

function counts(overrides: Partial<SegmentCompletionCounts>): SegmentCompletionCounts {
  return {
    total: 0,
    draft: 0,
    underReview: 0,
    reviewed: 0,
    emptyTarget: 0,
    ...overrides
  };
}

test("validateReviewedCompletion blocks reviewed completion when drafts remain", () => {
  const result = validateReviewedCompletion(
    { kind: "task", id: 42 },
    counts({ total: 5, draft: 2, underReview: 3 })
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "COMPLETE_REQUIRES_UNDER_REVIEW");
  assert.equal(result.details.draft, 2);
});

test("validateReviewedCompletion blocks reviewed completion when empty targets remain", () => {
  const result = validateReviewedCompletion(
    { kind: "file", id: 77 },
    counts({ total: 3, reviewed: 2, emptyTarget: 1 })
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "COMPLETE_TARGET_REQUIRED");
  assert.equal(result.details.emptyTarget, 1);
});

test("validateReviewedCompletion allows reviewed completion when all segments are ready", () => {
  const result = validateReviewedCompletion(
    { kind: "task", id: 13 },
    counts({ total: 4, underReview: 2, reviewed: 2, emptyTarget: 0 })
  );

  assert.deepEqual(result, { ok: true });
});
