import { describe, expect, it } from "vitest";
import { buildSeedingValidation } from "./seedingValidation";

describe("buildSeedingValidation", () => {
  it("returns blocking error when enabled with no assets", () => {
    const result = buildSeedingValidation({
      enabled: true,
      assetsAvailable: false,
      missingTargets: ["fr"],
      noAssetsMessage: "No assets available.",
      noAssetsHint: "Disable seeding or create an asset first.",
      missingSelectionMessage: "Missing selection.",
      rowErrorMessage: "Required."
    });

    expect(result.blockingErrors).toEqual([
      "No assets available.",
      "Disable seeding or create an asset first."
    ]);
    expect(result.rowErrors).toEqual({});
  });

  it("returns row errors when enabled with assets but no selections", () => {
    const result = buildSeedingValidation({
      enabled: true,
      assetsAvailable: true,
      missingTargets: ["fr", "de"],
      noAssetsMessage: "No assets available.",
      missingSelectionMessage: "Missing selection.",
      rowErrorMessage: "Required."
    });

    expect(result.blockingErrors).toEqual(["Missing selection."]);
    expect(result.rowErrors).toEqual({ fr: "Required.", de: "Required." });
  });
});
