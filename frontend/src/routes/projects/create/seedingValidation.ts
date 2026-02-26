export type SeedingValidationResult = {
  blockingErrors: string[];
  rowErrors: Record<string, string>;
};

export function buildSeedingValidation(params: {
  enabled: boolean;
  assetsAvailable: boolean;
  missingTargets: Iterable<string>;
  noAssetsMessage: string;
  noAssetsHint?: string;
  missingSelectionMessage: string;
  rowErrorMessage: string;
}): SeedingValidationResult {
  if (!params.enabled) {
    return { blockingErrors: [], rowErrors: {} };
  }

  if (!params.assetsAvailable) {
    const blockingErrors = [params.noAssetsMessage];
    if (params.noAssetsHint) {
      blockingErrors.push(params.noAssetsHint);
    }
    return { blockingErrors, rowErrors: {} };
  }

  const missing = Array.from(params.missingTargets);
  if (missing.length === 0) {
    return { blockingErrors: [], rowErrors: {} };
  }

  const rowErrors: Record<string, string> = {};
  missing.forEach((target) => {
    rowErrors[target] = params.rowErrorMessage;
  });

  return {
    blockingErrors: [params.missingSelectionMessage],
    rowErrors
  };
}
