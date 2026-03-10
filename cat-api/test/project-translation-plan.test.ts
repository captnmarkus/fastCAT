import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTranslationPlan } from "../src/routes/projects.routes.part2.helpers.js";

test("normalizeTranslationPlan normalizes locale assignment keys", () => {
  const plan = normalizeTranslationPlan(
    [
      {
        tempKey: "file-1",
        targetLangs: ["en-GB"],
        assignments: {
          "en-GB": {
            translatorUserId: "smoke_reviewer"
          }
        }
      }
    ],
    (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    },
    (value) => String(value ?? "").trim().toLowerCase(),
    (value) => {
      const raw = Array.isArray(value) ? value : [];
      return raw.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean);
    },
    (value) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {})
  );

  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0]?.targetLangs, ["en-gb"]);
  assert.equal(plan[0]?.assignments["en-gb"]?.translatorUserId, "smoke_reviewer");
});
