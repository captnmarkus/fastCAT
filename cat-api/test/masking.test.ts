import test from "node:test";
import assert from "node:assert/strict";
import { maskApiKey, maskBaseUrl } from "../src/lib/masking.ts";

test("maskApiKey preserves the OpenAI-style prefix and final digits", () => {
  assert.equal(maskApiKey("sk-test-secret-1234"), "sk-****1234");
  assert.equal(maskApiKey("plain-secret-9876"), "****9876");
});

test("maskBaseUrl preserves protocol and host while hiding the path", () => {
  assert.equal(maskBaseUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/...");
  assert.equal(maskBaseUrl("not a url"), "stored");
});
