import { describe, expect, it } from "vitest";
import fixture from "../test/fixtures/concordance-fixture.json";
import { buildOccurrenceIndex, findOccurrences } from "./concordance";

describe("occurrence index", () => {
  it("finds occurrences in source and target", () => {
    const segments = fixture.segments as Array<{
      id: number;
      index: number;
      src: string;
      tgt: string | null;
    }>;
    const index = buildOccurrenceIndex(segments as any);

    const sourceMatches = findOccurrences(index, "Satz");
    expect(sourceMatches.source.map((item) => item.segmentNo)).toEqual([1, 3]);
    expect(sourceMatches.target).toEqual([]);

    const targetMatches = findOccurrences(index, "sentence");
    expect(targetMatches.target.map((item) => item.segmentNo)).toEqual([1]);

    const paragraphMatches = findOccurrences(index, "Absatz");
    expect(paragraphMatches.source.map((item) => item.segmentNo)).toEqual([2, 3]);
  });
});
