import { describe, expect, it } from "vitest";
import type { TermbaseEntryDetail } from "../../../api";
import { computeHeaderModifiedAt } from "./termbase-utils";

describe("computeHeaderModifiedAt", () => {
  it("returns the latest modified timestamp across entry and terms", () => {
    const entry: TermbaseEntryDetail = {
      entryId: "concept-1",
      updatedAt: "2024-01-01T10:00:00.000Z",
      audit: {
        createdAt: "2024-01-01T09:00:00.000Z",
        modifiedAt: "2024-01-01T10:00:00.000Z",
        createdBy: "importer",
        modifiedBy: "importer"
      },
      languages: [
        {
          language: "de",
          terms: [
            {
              termId: "t_de",
              text: "eins",
              status: "preferred",
              notes: null,
              partOfSpeech: null,
              updatedAt: "2024-02-01T10:00:00.000Z",
              audit: {
                modifiedAt: "2024-02-01T10:00:00.000Z",
                modifiedBy: "editor"
              }
            },
            {
              termId: "t_de_2",
              text: "zwei",
              status: "allowed",
              notes: null,
              partOfSpeech: null,
              updatedAt: "2024-03-01T10:00:00.000Z"
            }
          ]
        }
      ]
    };

    expect(computeHeaderModifiedAt(entry)).toBe("2024-03-01T10:00:00.000Z");
  });

  it("returns null when entry is missing", () => {
    expect(computeHeaderModifiedAt(null)).toBe(null);
  });
});
