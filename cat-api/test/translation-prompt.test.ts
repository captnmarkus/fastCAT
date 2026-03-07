import test from "node:test";
import assert from "node:assert/strict";
import { formatLanguageNameForPrompt } from "../src/lib/translation-prompt.js";

test("formatLanguageNameForPrompt normalizes locale artifacts to human-readable language names", () => {
  assert.equal(formatLanguageNameForPrompt("de-DE"), "German");
  assert.equal(formatLanguageNameForPrompt("fr-FR"), "French");
  assert.equal(formatLanguageNameForPrompt("da-DK"), "Danish");
  assert.equal(formatLanguageNameForPrompt("pt-BR"), "Portuguese");
});
