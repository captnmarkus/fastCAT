import { describe, expect, it } from "vitest";
import { adjustFontSizeInRange, applyStylePatchToRange, projectTextToRuns, runsToText } from "./richTextRuns";

describe("richTextRuns", () => {
  it("projects suggestion text into template run styles", () => {
    const projected = projectTextToRuns(
      "Bonjour monde",
      [
        { text: "Hello", style: { fontFamily: "Calibri", bold: true } },
        { text: " world", style: { fontFamily: "Calibri", italic: true } }
      ]
    );
    expect(runsToText(projected)).toBe("Bonjour monde");
    expect(projected.length).toBeGreaterThan(1);
    expect(projected[0]?.style?.bold).toBe(true);
  });

  it("applies bold patch only in selected range", () => {
    const runs = applyStylePatchToRange({
      runs: [{ text: "Hello world", style: { fontFamily: "Calibri", bold: false } }],
      text: "Hello world",
      start: 6,
      end: 11,
      patch: { bold: true }
    });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.text).toBe("Hello ");
    expect(runs[0]?.style?.bold).toBeUndefined();
    expect(runs[1]?.text).toBe("world");
    expect(runs[1]?.style?.bold).toBe(true);
  });

  it("adjusts font size for selected range", () => {
    const runs = adjustFontSizeInRange({
      runs: [{ text: "Hello world", style: { fontFamily: "Calibri", fontSizePt: 10 } }],
      text: "Hello world",
      start: 0,
      end: 5,
      deltaPt: 2
    });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.text).toBe("Hello");
    expect(runs[0]?.style?.fontSizePt).toBe(12);
    expect(runs[1]?.text).toBe(" world");
    expect(runs[1]?.style?.fontSizePt).toBe(10);
  });
});
