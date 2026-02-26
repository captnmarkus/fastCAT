import test from "node:test";
import assert from "node:assert/strict";
import { xmlEscape } from "../src/utils.ts";

test("xmlEscape handles non-string values", () => {
  assert.equal(xmlEscape("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(xmlEscape(42), "42");
  assert.equal(xmlEscape(["a", 2]), "a | 2");
  assert.equal(xmlEscape({ value: "x" }), "x");
  assert.equal(xmlEscape({ label: "y" }), "y");
  assert.equal(xmlEscape(null), "");
  const objectEscaped = xmlEscape({ foo: "bar" });
  assert.ok(objectEscaped.includes("&quot;foo&quot;"));
});
