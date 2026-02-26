import { describe, expect, it } from "vitest";
import { insertAtSelection } from "./insert";

describe("insertAtSelection", () => {
  it("inserts at the cursor when no selection", () => {
    const result = insertAtSelection("Hello world", "CAT ", 6, 6);
    expect(result.nextValue).toBe("Hello CAT world");
    expect(result.nextCursor).toBe(10);
  });

  it("replaces selected text", () => {
    const result = insertAtSelection("Hello world", "CAT", 6, 11);
    expect(result.nextValue).toBe("Hello CAT");
    expect(result.nextCursor).toBe(9);
  });

  it("appends when selection is missing", () => {
    const result = insertAtSelection("Hello", " world");
    expect(result.nextValue).toBe("Hello world");
    expect(result.nextCursor).toBe(11);
  });
});
