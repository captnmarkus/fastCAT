import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderedPreviewCacheKey } from "../src/lib/rendered-preview-cache.js";

test("createRenderedPreviewCacheKey is stable for identical inputs", () => {
  const first = createRenderedPreviewCacheKey({
    projectId: 10,
    fileId: 20,
    taskId: 30,
    targetLang: "de",
    previewMethod: "pdf",
    draftRevisionId: "r1"
  });
  const second = createRenderedPreviewCacheKey({
    projectId: 10,
    fileId: 20,
    taskId: 30,
    targetLang: "de",
    previewMethod: "pdf",
    draftRevisionId: "r1"
  });
  assert.equal(first, second);
});

test("createRenderedPreviewCacheKey changes when revision or method changes", () => {
  const base = createRenderedPreviewCacheKey({
    projectId: 10,
    fileId: 20,
    taskId: 30,
    targetLang: "de",
    previewMethod: "pdf",
    draftRevisionId: "r1"
  });
  const differentRevision = createRenderedPreviewCacheKey({
    projectId: 10,
    fileId: 20,
    taskId: 30,
    targetLang: "de",
    previewMethod: "pdf",
    draftRevisionId: "r2"
  });
  const differentMethod = createRenderedPreviewCacheKey({
    projectId: 10,
    fileId: 20,
    taskId: 30,
    targetLang: "de",
    previewMethod: "images",
    draftRevisionId: "r1"
  });

  assert.notEqual(base, differentRevision);
  assert.notEqual(base, differentMethod);
});
