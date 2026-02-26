import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEngineSelection } from "../src/lib/translation-engine-settings.js";

test("resolveEngineSelection prioritizes overrides", () => {
  const projectDefaultId = 1;
  const defaultsByTarget = { fr: 2 };
  const overridesByFile = {
    "10": { fr: 3, de: null }
  };

  assert.equal(
    resolveEngineSelection({ projectDefaultId, defaultsByTarget, overridesByFile, fileId: 10, targetLang: "fr" }),
    3
  );
  assert.equal(
    resolveEngineSelection({ projectDefaultId, defaultsByTarget, overridesByFile, fileId: 10, targetLang: "de" }),
    null
  );
});

test("resolveEngineSelection falls back to target default then project default", () => {
  const projectDefaultId = 5;
  const defaultsByTarget = { fr: 7 };
  const overridesByFile = {};

  assert.equal(
    resolveEngineSelection({ projectDefaultId, defaultsByTarget, overridesByFile, fileId: 22, targetLang: "fr" }),
    7
  );
  assert.equal(
    resolveEngineSelection({ projectDefaultId, defaultsByTarget, overridesByFile, fileId: 22, targetLang: "de" }),
    5
  );
});
