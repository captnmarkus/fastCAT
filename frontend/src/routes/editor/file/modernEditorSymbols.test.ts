import { describe, expect, it } from "vitest";
import { SYMBOL_PICKER_ITEMS } from "./modernEditorSymbols";

describe("SYMBOL_PICKER_ITEMS", () => {
  it("contains the intended editor symbols", () => {
    expect(SYMBOL_PICKER_ITEMS).toEqual(
      expect.arrayContaining(["\u00A9", "\u2122", "\u2192", "\u20AC", "\u2713"])
    );
  });

  it("does not contain mojibake entries", () => {
    for (const symbol of SYMBOL_PICKER_ITEMS) {
      expect(symbol).not.toMatch(/[ÂÃâ]/);
    }
  });
});
