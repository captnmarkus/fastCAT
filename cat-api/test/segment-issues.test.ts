import test from "node:test";
import assert from "node:assert/strict";
import { computeSegmentIssues } from "../src/lib/segment-issues.js";

test("computeSegmentIssues flags empty target", () => {
  const { issues, summary } = computeSegmentIssues({ src: "Hello", tgt: "" });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "EMPTY_TARGET");
  assert.equal(issues[0]?.severity, "error");
  assert.equal(summary.error, 1);
});

test("computeSegmentIssues flags placeholder mismatch", () => {
  const { issues } = computeSegmentIssues({ src: "Value {1}", tgt: "Wert" });
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("PLACEHOLDER_MISSING"));
});

test("computeSegmentIssues flags number mismatch", () => {
  const { issues } = computeSegmentIssues({ src: "Total 10", tgt: "Summe 12" });
  const numberIssue = issues.find((issue) => issue.code === "NUMBER_MISMATCH");
  assert.ok(numberIssue, "expected number mismatch warning");
  assert.equal(numberIssue?.severity, "warning");
});
