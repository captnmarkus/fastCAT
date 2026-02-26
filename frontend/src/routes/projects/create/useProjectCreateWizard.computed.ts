// @ts-nocheck
import { useEffect, useMemo } from "react";
import { checkProjectNameAvailable } from "../../../api";
import type { SeedingValidationResult } from "./seedingValidation";
import { buildSeedingValidation } from "./seedingValidation";
import {
  ENGINE_INHERIT,
  RULESET_INHERIT,
  buildTasks,
  normalizeTargetForPayload,
  normalizeTargetKey,
  resolveDisplayAssignments,
  resolveEngineAssignments,
  resolveEngineIdValue,
  resolveGlossaryIdValue,
  resolveOverrideSelection,
  resolveRulesetAssignments,
  resolveRulesetIdValue
} from "./useProjectCreateWizard.logic";

export function useProjectCreateWizardComputed(ctx: any) {
  const {
    canAssign,
    currentUserKey,
    defaultAssigneeId,
    defaultTmxId,
    fileSearch,
    fileTypeConfigs,
    glossaries,
    glossariesLoaded,
    glossaryByTargetLang,
    glossaryEnabled,
    glossaryId,
    mtSeedingEnabled,
    name,
    pendingFiles,
    projectOwnerId,
    projectTargetLangs,
    rulesEnabled,
    rulesetByTargetLang,
    rulesetId,
    rulesets,
    rulesetsLoaded,
    selectedDepartment,
    selectedGlossary,
    selectedRuleset,
    selectedTranslationEngine,
    setNameAvailable,
    setNameCheckError,
    setNameChecking,
    showValidation,
    srcLang,
    step,
    targetMetaByTag,
    termbaseEnabled,
    terminologyEnabled,
    tmSampleById,
    tmSamples,
    tmxByTargetLang,
    tmxEnabled,
    translationEngineByTargetLang,
    translationEngineId,
    translationEngines,
    translationEnginesLoaded,
    translationPlanMode,
    users
  } = ctx;
const resolvedTmxByTarget = useMemo(() => {
  const next: Record<string, number | null> = {};
  if (!tmxEnabled) return next;
  projectTargetLangs.forEach((target) => {
    const key = normalizeTargetKey(target);
    if (!key) return;
    const explicit = tmxByTargetLang[key];
    next[key] = explicit != null ? explicit : defaultTmxId;
  });
  return next;
}, [projectTargetLangs, tmxEnabled, tmxByTargetLang, defaultTmxId]);

const missingTmxTargets = useMemo(() => {
  const missing = new Set<string>();
  if (!tmxEnabled) return missing;
  projectTargetLangs.forEach((target) => {
    const key = normalizeTargetKey(target);
    if (!key) return;
    const tmId = resolvedTmxByTarget[key];
    if (!tmId) missing.add(key);
  });
  return missing;
}, [projectTargetLangs, tmxEnabled, resolvedTmxByTarget]);

const resolvedRulesetByTarget = useMemo(() => {
  const next: Record<string, number | null> = {};
  if (!rulesEnabled) return next;
  const globalRulesetId = resolveRulesetIdValue(rulesetId);
  projectTargetLangs.forEach((target) => {
    const key = normalizeTargetKey(target);
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(rulesetByTargetLang, key)) {
      next[key] = rulesetByTargetLang[key] ?? null;
    } else {
      next[key] = globalRulesetId;
    }
  });
  return next;
}, [projectTargetLangs, rulesetByTargetLang, rulesetId, rulesEnabled]);

const resolvedEngineByTarget = useMemo(() => {
  const next: Record<string, number | null> = {};
  const globalEngineId = resolveEngineIdValue(translationEngineId);
  projectTargetLangs.forEach((target) => {
    const key = normalizeTargetKey(target);
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(translationEngineByTargetLang, key)) {
      next[key] = translationEngineByTargetLang[key] ?? null;
    } else {
      next[key] = globalEngineId;
    }
  });
  return next;
}, [projectTargetLangs, translationEngineByTargetLang, translationEngineId]);

const resolvedGlossaryByTarget = useMemo(() => {
  const next: Record<string, number | null> = {};
  if (!terminologyEnabled) return next;
  const globalGlossaryId = resolveGlossaryIdValue(glossaryId);
  projectTargetLangs.forEach((target) => {
    const key = normalizeTargetKey(target);
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(glossaryByTargetLang, key)) {
      next[key] = glossaryByTargetLang[key] ?? null;
    } else {
      next[key] = globalGlossaryId;
    }
  });
  return next;
}, [projectTargetLangs, glossaryByTargetLang, glossaryId, terminologyEnabled]);

const normalizedTargetKeys = useMemo(
  () => projectTargetLangs.map((target) => normalizeTargetKey(target)).filter(Boolean),
  [projectTargetLangs]
);

const missingEngineTargets = useMemo(() => {
  const missing = new Set<string>();
  if (!mtSeedingEnabled || !translationEnginesLoaded || translationEngines.length === 0) return missing;
  if (translationPlanMode !== "advanced") {
    normalizedTargetKeys.forEach((target) => {
      if (!resolvedEngineByTarget[target]) missing.add(target);
    });
    return missing;
  }

  const translatableFiles = pendingFiles.filter((entry) => entry.usage === "translatable");
  normalizedTargetKeys.forEach((target) => {
    const baseEngineId = resolvedEngineByTarget[target] ?? null;
    const filesWithTarget = translatableFiles.filter((entry) => entry.translationTargets.includes(target));
    if (filesWithTarget.length === 0) {
      if (!baseEngineId) missing.add(target);
      return;
    }
    for (const entry of filesWithTarget) {
      const selection = entry.engineAssignments?.[target]?.engineId;
      const resolvedEngineId = resolveOverrideSelection(baseEngineId, selection, ENGINE_INHERIT);
      if (!resolvedEngineId) {
        missing.add(target);
        break;
      }
    }
  });
  return missing;
}, [
  mtSeedingEnabled,
  normalizedTargetKeys,
  pendingFiles,
  resolvedEngineByTarget,
  translationEnginesLoaded,
  translationEngines.length,
  translationPlanMode
]);

const missingRulesetTargets = useMemo(() => {
  const missing = new Set<string>();
  if (!rulesEnabled || !rulesetsLoaded || rulesets.length === 0) return missing;
  if (translationPlanMode !== "advanced") {
    normalizedTargetKeys.forEach((target) => {
      if (!resolvedRulesetByTarget[target]) missing.add(target);
    });
    return missing;
  }

  const translatableFiles = pendingFiles.filter((entry) => entry.usage === "translatable");
  normalizedTargetKeys.forEach((target) => {
    const baseRulesetId = resolvedRulesetByTarget[target] ?? null;
    const filesWithTarget = translatableFiles.filter((entry) => entry.translationTargets.includes(target));
    if (filesWithTarget.length === 0) {
      if (!baseRulesetId) missing.add(target);
      return;
    }
    for (const entry of filesWithTarget) {
      const selection = entry.rulesetAssignments?.[target]?.rulesetId;
      const resolvedRulesetId = resolveOverrideSelection(baseRulesetId, selection, RULESET_INHERIT);
      if (!resolvedRulesetId) {
        missing.add(target);
        break;
      }
    }
  });
  return missing;
}, [
  normalizedTargetKeys,
  pendingFiles,
  resolvedRulesetByTarget,
  rulesEnabled,
  rulesetsLoaded,
  rulesets.length,
  translationPlanMode
]);

const missingGlossaryTargets = useMemo(() => {
  const missing = new Set<string>();
  if (!terminologyEnabled || !glossariesLoaded || glossaries.length === 0) return missing;
  normalizedTargetKeys.forEach((target) => {
    if (!resolvedGlossaryByTarget[target]) missing.add(target);
  });
  return missing;
}, [glossaries.length, glossariesLoaded, normalizedTargetKeys, resolvedGlossaryByTarget, terminologyEnabled]);

const tmxMissingMessage = useMemo(() => {
  if (!tmxEnabled || missingTmxTargets.size === 0) return "Select a TMX for every target language.";
  const firstMissing = projectTargetLangs.find((target) => {
    const key = normalizeTargetKey(target);
    return key ? missingTmxTargets.has(key) : false;
  });
  if (firstMissing) {
    const label = targetMetaByTag.get(firstMissing)?.label || firstMissing;
    return `TMX required for ${label}.`;
  }
  return "Select a TMX for every target language.";
}, [missingTmxTargets, projectTargetLangs, targetMetaByTag, tmxEnabled]);

const unseededTmxTargets = useMemo(() => {
  if (!tmxEnabled) return [];
  return projectTargetLangs.filter((target) => {
    const key = normalizeTargetKey(target);
    const tmxId = key ? resolvedTmxByTarget[key] ?? null : null;
    if (!tmxId) return false;
    const sample = tmSampleById.get(tmxId);
    return sample != null && !sample.seeded;
  });
}, [projectTargetLangs, resolvedTmxByTarget, tmSampleById, tmxEnabled]);

const tmxValidationBase = useMemo(
  () =>
    buildSeedingValidation({
      enabled: tmxEnabled,
      assetsAvailable: tmSamples.length > 0,
      missingTargets: missingTmxTargets,
      noAssetsMessage: "No TMX assets available.",
      missingSelectionMessage: tmxMissingMessage,
      rowErrorMessage: "TMX required for this language."
    }),
  [missingTmxTargets, tmxEnabled, tmSamples.length, tmxMissingMessage]
);

const tmxValidation = useMemo<SeedingValidationResult>(() => {
  const blockingErrors = [...tmxValidationBase.blockingErrors];
  if (blockingErrors.length === 0 && unseededTmxTargets.length > 0) {
    blockingErrors.push("Selected TMX is still seeding.");
  }
  return {
    blockingErrors,
    rowErrors: tmxValidationBase.rowErrors
  };
}, [tmxValidationBase, unseededTmxTargets.length]);

const engineValidation = useMemo<SeedingValidationResult>(
  () =>
    buildSeedingValidation({
      enabled: mtSeedingEnabled && translationEnginesLoaded,
      assetsAvailable: translationEngines.length > 0,
      missingTargets: missingEngineTargets,
      noAssetsMessage: "No Translation Engines available.",
      noAssetsHint: "Disable seeding or create an asset first.",
      missingSelectionMessage: "MT/LLM seeding is enabled but no engine is selected.",
      rowErrorMessage: "Engine required for this language (or disable MT/LLM seeding)."
    }),
  [missingEngineTargets, mtSeedingEnabled, translationEngines.length, translationEnginesLoaded]
);

const rulesValidation = useMemo<SeedingValidationResult>(
  () =>
    buildSeedingValidation({
      enabled: rulesEnabled && rulesetsLoaded,
      assetsAvailable: rulesets.length > 0,
      missingTargets: missingRulesetTargets,
      noAssetsMessage: "No Rulesets available.",
      noAssetsHint: "Disable seeding or create an asset first.",
      missingSelectionMessage: "Rules are enabled but no ruleset is selected.",
      rowErrorMessage: "Ruleset required for this language (or disable rules)."
    }),
  [missingRulesetTargets, rulesEnabled, rulesets.length, rulesetsLoaded]
);

const terminologyNoAssetsMessages = useMemo(() => {
  if (!terminologyEnabled || !glossariesLoaded) return [];
  if (glossaries.length > 0) return [];
  const messages: string[] = [];
  if (termbaseEnabled) messages.push("No Termbases available.");
  if (glossaryEnabled) messages.push("No Glossaries available.");
  if (messages.length === 0) messages.push("No Termbases available.");
  messages.push("Disable seeding or create an asset first.");
  return messages;
}, [glossaries.length, glossariesLoaded, glossaryEnabled, termbaseEnabled, terminologyEnabled]);

const terminologyMissingMessage = useMemo(() => {
  if (termbaseEnabled && glossaryEnabled) {
    return "Terminology seeding is enabled but no termbase or glossary is selected.";
  }
  if (termbaseEnabled) {
    return "Termbase seeding is enabled but no termbase is selected.";
  }
  if (glossaryEnabled) {
    return "Glossary seeding is enabled but no glossary is selected.";
  }
  return "Terminology seeding is enabled but no termbase is selected.";
}, [glossaryEnabled, termbaseEnabled]);

const terminologyRowError = useMemo(() => {
  if (termbaseEnabled && glossaryEnabled) {
    return "Termbase or glossary required for this language (or disable terminology).";
  }
  if (termbaseEnabled) {
    return "Termbase required for this language (or disable terminology).";
  }
  if (glossaryEnabled) {
    return "Glossary required for this language (or disable terminology).";
  }
  return "Termbase required for this language (or disable terminology).";
}, [glossaryEnabled, termbaseEnabled]);

const glossaryValidationBase = useMemo<SeedingValidationResult>(
  () =>
    buildSeedingValidation({
      enabled: terminologyEnabled && glossariesLoaded,
      assetsAvailable: glossaries.length > 0,
      missingTargets: missingGlossaryTargets,
      noAssetsMessage: "No Termbases available.",
      missingSelectionMessage: terminologyMissingMessage,
      rowErrorMessage: terminologyRowError
    }),
  [
    glossaries.length,
    glossariesLoaded,
    missingGlossaryTargets,
    terminologyEnabled,
    terminologyMissingMessage,
    terminologyRowError
  ]
);

const glossaryValidation = useMemo<SeedingValidationResult>(() => {
  if (terminologyNoAssetsMessages.length === 0) return glossaryValidationBase;
  return {
    blockingErrors: terminologyNoAssetsMessages,
    rowErrors: {}
  };
}, [glossaryValidationBase, terminologyNoAssetsMessages]);

const trimmedName = name.trim();
const normalizedFileSearch = useMemo(() => String(fileSearch || "").trim().toLowerCase(), [fileSearch]);
const departmentInvalid = showValidation && (!selectedDepartment || selectedDepartment.disabled);
const translationOverrides = useMemo<TranslationTaskOverrides>(() => {
  const fileTargets: Record<string, string[]> = {};
  const assignments: Record<string, Record<string, TranslationPlanAssignment>> = {};
  const rulesetAssignments: Record<string, Record<string, RulesetAssignment>> = {};
  const engineAssignments: Record<string, Record<string, EngineAssignment>> = {};
  pendingFiles.forEach((entry) => {
    fileTargets[entry.localId] = entry.translationTargets;
    assignments[entry.localId] = entry.assignments;
    rulesetAssignments[entry.localId] = entry.rulesetAssignments;
    engineAssignments[entry.localId] = entry.engineAssignments;
  });
  return { fileTargets, assignments, rulesetAssignments, engineAssignments };
}, [pendingFiles]);
const activeRulesetByTargetLang = rulesEnabled ? rulesetByTargetLang : {};
const activeGlossaryByTargetLang = terminologyEnabled ? glossaryByTargetLang : {};
const activeRulesetId = rulesEnabled ? resolveRulesetIdValue(rulesetId) : null;
const activeGlossaryId = terminologyEnabled ? resolveGlossaryIdValue(glossaryId) : null;
const translationTasks = useMemo(
  () =>
    buildTasks({
      files: pendingFiles,
      sourceLang: srcLang,
      projectTargets: projectTargetLangs,
      mode: translationPlanMode,
      defaults: { assigneeId: defaultAssigneeId },
      overrides: translationOverrides,
      tmxByTargetLang: resolvedTmxByTarget,
      engineId: resolveEngineIdValue(translationEngineId),
      engineByTargetLang: translationEngineByTargetLang,
      rulesetId: activeRulesetId,
      rulesetByTargetLang: activeRulesetByTargetLang,
      glossaryId: activeGlossaryId,
      glossaryByTargetLang: activeGlossaryByTargetLang
    }),
  [
    defaultAssigneeId,
    pendingFiles,
    projectTargetLangs,
    srcLang,
    translationOverrides,
    translationPlanMode,
    resolvedTmxByTarget,
    translationEngineId,
    translationEngineByTargetLang,
    activeRulesetId,
    activeRulesetByTargetLang,
    activeGlossaryId,
    activeGlossaryByTargetLang
  ]
);
const missingAssignments = useMemo(() => {
  const missing = new Set<string>();
  translationTasks.forEach((task) => {
    if (!task.assigneeId) {
      missing.add(`${task.fileLocalId}:${normalizeTargetForPayload(task.targetLang)}`);
    }
  });
  return missing;
}, [translationTasks]);
const assigneeLabelById = useMemo(() => {
  const map = new Map<string, string>();
  users.forEach((user) => {
    const label = user.displayName || user.username || String(user.id);
    map.set(String(user.id), label);
    map.set(String(user.username), label);
  });
  return map;
}, [users]);
const taskSummaryByFile = useMemo(() => {
  const map = new Map<string, Array<{ targetLang: string; assigneeLabel: string }>>();
  translationTasks.forEach((task) => {
    const entry = map.get(task.fileLocalId) ?? [];
    const assigneeLabel =
      task.assigneeId && assigneeLabelById.get(task.assigneeId)
        ? assigneeLabelById.get(task.assigneeId)!
        : task.assigneeId || "Unassigned";
    entry.push({ targetLang: task.targetLang, assigneeLabel });
    map.set(task.fileLocalId, entry);
  });
  return map;
}, [assigneeLabelById, translationTasks]);

const hasRulesetOverrides = useMemo(() => {
  if (!rulesEnabled) return false;
  return pendingFiles.some((entry) => {
    if (entry.usage !== "translatable") return false;
    return Object.values(entry.rulesetAssignments || {}).some(
      (assignment) => assignment.rulesetId !== RULESET_INHERIT
    );
  });
}, [pendingFiles, rulesEnabled]);

const hasEngineOverrides = useMemo(() => {
  return pendingFiles.some((entry) => {
    if (entry.usage !== "translatable") return false;
    return Object.values(entry.engineAssignments || {}).some(
      (assignment) => assignment.engineId !== ENGINE_INHERIT
    );
  });
}, [pendingFiles]);

const hasRulesetTargetOverrides = useMemo(
  () => rulesEnabled && Object.keys(rulesetByTargetLang).length > 0,
  [rulesEnabled, rulesetByTargetLang]
);

const hasEngineTargetOverrides = useMemo(
  () => Object.keys(translationEngineByTargetLang).length > 0,
  [translationEngineByTargetLang]
);

const hasGlossaryTargetOverrides = useMemo(
  () => terminologyEnabled && Object.keys(glossaryByTargetLang).length > 0,
  [terminologyEnabled, glossaryByTargetLang]
);

const rulesetSummaryLabel = useMemo(() => {
  if (!rulesEnabled) return "Disabled";
  if (translationPlanMode === "advanced" && hasRulesetOverrides) {
    return "Custom per file/language";
  }
  if (hasRulesetTargetOverrides) return "Custom per target";
  return selectedRuleset ? selectedRuleset.name : "None";
}, [hasRulesetOverrides, hasRulesetTargetOverrides, selectedRuleset, translationPlanMode, rulesEnabled]);

const engineSummaryLabel = useMemo(() => {
  if (!mtSeedingEnabled) return "Disabled";
  if (translationPlanMode === "advanced" && hasEngineOverrides) {
    return "Custom per file/language";
  }
  if (hasEngineTargetOverrides) return "Custom per target";
  return selectedTranslationEngine ? selectedTranslationEngine.name : "None";
}, [hasEngineOverrides, hasEngineTargetOverrides, selectedTranslationEngine, translationPlanMode, mtSeedingEnabled]);

const glossarySummaryLabel = useMemo(() => {
  if (!terminologyEnabled) return "Disabled";
  if (hasGlossaryTargetOverrides) return "Custom per target";
  return selectedGlossary ? selectedGlossary.label : "None";
}, [hasGlossaryTargetOverrides, selectedGlossary, terminologyEnabled]);

const hasEngineSelection = useMemo(() => {
  if (resolveEngineIdValue(translationEngineId) != null) return true;
  if (hasEngineTargetOverrides) return true;
  if (hasEngineOverrides) return true;
  return false;
}, [translationEngineId, hasEngineTargetOverrides, hasEngineOverrides]);

const canProceed = useMemo(() => {
  if (step === "tmx") return tmxValidation.blockingErrors.length === 0;
  if (step === "engine") return engineValidation.blockingErrors.length === 0;
  if (step === "rules") return rulesValidation.blockingErrors.length === 0;
  if (step === "glossary") return glossaryValidation.blockingErrors.length === 0;
  return true;
}, [engineValidation.blockingErrors.length, glossaryValidation.blockingErrors.length, rulesValidation.blockingErrors.length, step, tmxValidation.blockingErrors.length]);

useEffect(() => {
  if (!trimmedName) {
    setNameAvailable(null);
    setNameChecking(false);
    setNameCheckError(null);
    return;
  }

  let cancelled = false;
  setNameChecking(true);
  setNameAvailable(null);
  setNameCheckError(null);

  const assigned = canAssign ? (projectOwnerId || currentUserKey) : undefined;
  const handle = window.setTimeout(() => {
    (async () => {
      try {
        const available = await checkProjectNameAvailable({
          name: trimmedName,
          projectOwnerId: assigned
        });
        if (!cancelled) setNameAvailable(available);
      } catch (err: any) {
        if (!cancelled) {
          setNameAvailable(null);
          setNameCheckError(err?.message || "Failed to validate project name");
        }
      } finally {
        if (!cancelled) setNameChecking(false);
      }
    })();
  }, 300);

  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
}, [canAssign, currentUserKey, projectOwnerId, trimmedName]);

const filteredPendingFiles = useMemo(() => {
  if (!normalizedFileSearch) return pendingFiles;
  return pendingFiles.filter((entry) =>
    String(entry.file.name || "").toLowerCase().includes(normalizedFileSearch)
  );
}, [normalizedFileSearch, pendingFiles]);

const translationPlanFiles = useMemo<TranslationPlanFile[]>(
  () =>
    pendingFiles
      .filter((entry) => entry.usage === "translatable")
      .map((entry) => {
        const targetLangs = translationPlanMode === "simple" ? projectTargetLangs : entry.translationTargets;
        const assigneeAll = entry.assigneeAll || defaultAssigneeId;
        return {
          id: entry.localId,
          name: entry.file.name,
          sizeBytes: entry.file.size,
          targetLangs,
          assigneeAll,
          assignments: resolveDisplayAssignments(targetLangs, entry.assignments, {
            fallbackToDefault: translationPlanMode === "simple"
          })
        };
      }),
  [pendingFiles, projectTargetLangs, translationPlanMode, defaultAssigneeId]
);

const rulesetPlanFiles = useMemo(
  () =>
    pendingFiles
      .filter((entry) => entry.usage === "translatable")
      .map((entry) => {
        const targetLangs = translationPlanMode === "simple" ? projectTargetLangs : entry.translationTargets;
        return {
          id: entry.localId,
          name: entry.file.name,
          sizeBytes: entry.file.size,
          targetLangs,
          rulesetAll: entry.rulesetAll || RULESET_INHERIT,
          rulesetAssignments: resolveRulesetAssignments(targetLangs, entry.rulesetAssignments)
        };
      }),
  [pendingFiles, projectTargetLangs, translationPlanMode]
);

const enginePlanFiles = useMemo(
  () =>
    pendingFiles
      .filter((entry) => entry.usage === "translatable")
      .map((entry) => {
        const targetLangs = translationPlanMode === "simple" ? projectTargetLangs : entry.translationTargets;
        return {
          id: entry.localId,
          name: entry.file.name,
          sizeBytes: entry.file.size,
          targetLangs,
          engineAll: entry.engineAll || ENGINE_INHERIT,
          engineAssignments: resolveEngineAssignments(targetLangs, entry.engineAssignments)
        };
      }),
  [pendingFiles, projectTargetLangs, translationPlanMode]
);

const fileTypeConfigsByType = useMemo(() => {
  const map = new Map<string, FileTypeConfig[]>();
  for (const cfg of fileTypeConfigs) {
    const ft = String((cfg as any)?.config?.fileType || "").trim().toLowerCase();
    if (!ft) continue;
    if (!map.has(ft)) map.set(ft, []);
    map.get(ft)!.push(cfg);
  }
  for (const [ft, list] of map) {
    map.set(ft, list.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))));
  }
  return map;
}, [fileTypeConfigs]);

const missingFileTypeConfigMessage =
  "No File Type Configuration configured for this file type. Create one in Resources > File Type Configurations.";


  return {
    resolvedTmxByTarget,
    missingTmxTargets,
    resolvedRulesetByTarget,
    resolvedEngineByTarget,
    resolvedGlossaryByTarget,
    tmxValidation,
    engineValidation,
    rulesValidation,
    glossaryValidation,
    trimmedName,
    departmentInvalid,
    translationOverrides,
    translationTasks,
    missingAssignments,
    assigneeLabelById,
    taskSummaryByFile,
    hasRulesetOverrides,
    hasEngineOverrides,
    hasRulesetTargetOverrides,
    hasEngineTargetOverrides,
    hasGlossaryTargetOverrides,
    rulesetSummaryLabel,
    engineSummaryLabel,
    glossarySummaryLabel,
    hasEngineSelection,
    canProceed,
    filteredPendingFiles,
    translationPlanFiles,
    rulesetPlanFiles,
    enginePlanFiles,
    fileTypeConfigsByType,
    missingFileTypeConfigMessage
  };
}
