// @ts-nocheck
import { useEffect, useRef } from "react";
import { type ProjectTemplate } from "../../../api";
import { parsePositiveInt } from "../../../utils/ids";
import { detectUploadFileType, fileFingerprint } from "./useProjectCreateWizard.helpers";
import {
  ENGINE_INHERIT,
  RULESET_INHERIT,
  buildAssignments as buildAssignmentsCore,
  buildEngineAssignments as buildEngineAssignmentsCore,
  buildRulesetAssignments as buildRulesetAssignmentsCore,
  normalizeTargetKey,
  normalizeTargetList as normalizeTargetListCore,
  resolveEngineIdValue,
  resolveGlossaryIdValue,
  resolveRulesetIdValue,
  syncFileTargets as syncFileTargetsCore
} from "./useProjectCreateWizard.logic";

export function useProjectCreateWizardActions(ctx: any) {
  const {
    allowedProjectTargets,
    assignableUsers,
    defaultAssigneeId,
    defaultTmxId,
    departmentId,
    fileTypeConfigs,
    fileTypeConfigsByType,
    fileTypeConfigsLoaded,
    glossaries,
    glossaryId,
    isAdmin,
    pendingFiles,
    projectTargetLangs,
    projectTemplates,
    rulesetId,
    rulesets,
    sourceCanonical,
    targetOptions,
    templateFileTypeConfigDefaults,
    tmSampleByFilename,
    tmSampleById,
    translationEngineId,
    translationPlanMode,
    useSameAssignee,
    setDefaultAssigneeId,
    setDefaultTmxId,
    setDepartmentId,
    setGlossaryByTargetLang,
    setGlossaryEnabled,
    setGlossaryId,
    setMtSeedingEnabled,
    setPendingFiles,
    setProjectTargetLangs,
    setProjectTemplateId,
    setRulesEnabled,
    setRulesetByTargetLang,
    setRulesetId,
    setSrcLang,
    setTermbaseEnabled,
    setTemplateFileTypeConfigDefaults,
    setTmxByTargetLang,
    setTmxEnabled,
    setTranslationEngineByTargetLang,
    setTranslationEngineId,
    setTranslationPlanMode,
    setUseSameAssignee
  } = ctx;

  const normalizeTargetList = (values: string[]) => normalizeTargetListCore(values, allowedProjectTargets);

  const buildAssignments = (
    targets: string[],
    existing?: Record<string, any>,
    opts?: { forceAssignee?: boolean; defaultAssigneeId?: string; sameAssignee?: boolean }
  ) =>
    buildAssignmentsCore(targets, existing, {
      forceAssignee: opts?.forceAssignee,
      defaultAssigneeId: opts?.defaultAssigneeId ?? defaultAssigneeId,
      sameAssignee: opts?.sameAssignee,
      useSameAssignee
    });

  const buildRulesetAssignments = (
    targets: string[],
    existing?: Record<string, any>
  ) => buildRulesetAssignmentsCore(targets, existing);

  const buildEngineAssignments = (
    targets: string[],
    existing?: Record<string, any>
  ) => buildEngineAssignmentsCore(targets, existing);

  const syncFileTargets = (
    entry: any,
    targets: string[],
    opts?: {
      forceAssignee?: boolean;
      sameAssignee?: boolean;
      defaultAssigneeId?: string;
      rulesetAll?: string;
      engineAll?: string;
    }
  ) =>
    syncFileTargetsCore(entry, targets, {
      allowedProjectTargets,
      defaultAssigneeId,
      useSameAssignee,
      forceAssignee: opts?.forceAssignee,
      sameAssignee: opts?.sameAssignee,
      assigneeAll: opts?.defaultAssigneeId,
      rulesetAll: opts?.rulesetAll,
      engineAll: opts?.engineAll
    });
function applyTemplateDefaults(template: ProjectTemplate) {
  const defaults: Record<string, string> = {};
  const rulesetIdSet = new Set(rulesets.map((entry) => entry.id));
  const glossaryIdSet = new Set(glossaries.map((entry) => entry.id));
  let legacyDefaultTmxId: number | null = null;
  let legacyGlossaryId: number | null = null;
  let legacyRulesetId: number | null = null;
  let templateRulesEnabled: boolean | null = null;
  let templateTermbaseEnabled: boolean | null = null;
  let templateGlossaryEnabled: boolean | null = null;

  const rawSettings = (template as any)?.settings;
  if (rawSettings && typeof rawSettings === "object") {
    if (isAdmin) {
      const departmentCandidate =
        rawSettings.departmentId ??
        rawSettings.department_id ??
        rawSettings.defaultDepartmentId ??
        rawSettings.default_department_id ??
        null;
      const departmentValue = parsePositiveInt(departmentCandidate);
      if (departmentValue != null) {
        setDepartmentId(String(departmentValue));
      }
    }

    const tmSampleCandidate =
      rawSettings.tmSample ??
      rawSettings.tm_sample ??
      rawSettings.defaultTmSample ??
      rawSettings.default_tm_sample ??
      rawSettings.defaultTmxId ??
      rawSettings.default_tmx_id ??
      null;
    const nextDefaultTmxIdFromSettings =
      typeof tmSampleCandidate === "string"
        ? (() => {
            const trimmed = tmSampleCandidate.trim();
            if (!trimmed) return null;
            const sample = tmSampleByFilename.get(trimmed);
            return parsePositiveInt(sample?.tmId);
          })()
        : parsePositiveInt(tmSampleCandidate);
    legacyDefaultTmxId = nextDefaultTmxIdFromSettings;

    const glossaryCandidate =
      rawSettings.glossaryId ??
      rawSettings.glossary_id ??
      rawSettings.defaultGlossaryId ??
      rawSettings.default_glossary_id ??
      null;
    legacyGlossaryId = parsePositiveInt(glossaryCandidate);

    const rulesetCandidate =
      rawSettings.rulesetId ??
      rawSettings.languageProcessingRulesetId ??
      rawSettings.language_processing_ruleset_id ??
      rawSettings.defaultRulesetId ??
      rawSettings.default_ruleset_id ??
      null;
    legacyRulesetId = parsePositiveInt(rulesetCandidate);

    const rulesEnabledCandidate = rawSettings.rulesEnabled ?? rawSettings.rules_enabled ?? null;
    if (typeof rulesEnabledCandidate === "boolean") templateRulesEnabled = rulesEnabledCandidate;
    const termbaseEnabledCandidate = rawSettings.termbaseEnabled ?? rawSettings.termbase_enabled ?? null;
    if (typeof termbaseEnabledCandidate === "boolean") templateTermbaseEnabled = termbaseEnabledCandidate;
    const glossaryEnabledCandidate = rawSettings.glossaryEnabled ?? rawSettings.glossary_enabled ?? null;
    if (typeof glossaryEnabledCandidate === "boolean") templateGlossaryEnabled = glossaryEnabledCandidate;

    const fileDefaultsCandidate =
      rawSettings.fileTypeConfigDefaults ??
      rawSettings.file_type_config_defaults ??
      rawSettings.defaultFileTypeConfigIds ??
      rawSettings.default_file_type_config_ids ??
      null;
    if (fileDefaultsCandidate && typeof fileDefaultsCandidate === "object") {
      for (const [key, value] of Object.entries(fileDefaultsCandidate)) {
        const ft = String(key || "").trim().toLowerCase();
        const id = Number(value);
        if (!ft || !Number.isFinite(id) || id <= 0) continue;
        const cfg = fileTypeConfigs.find((c) => c.id === id);
        const cfgType = String((cfg as any)?.config?.fileType || "").trim().toLowerCase();
        if (cfg && cfgType === ft) defaults[ft] = String(id);
      }
    }
  }

  if (template.fileTypeConfigId != null) {
    const cfg = fileTypeConfigs.find((c) => c.id === template.fileTypeConfigId) ?? null;
    const ft = String((cfg as any)?.config?.fileType || "").trim().toLowerCase();
    if (cfg && ft) defaults[ft] = String(cfg.id);
  }

  if (template.translationEngineId != null) {
    setTranslationEngineId(String(template.translationEngineId));
  } else {
    setTranslationEngineId("");
  }
  const templateSeedingCandidate =
    rawSettings?.mtSeedingEnabled ??
    rawSettings?.mt_seeding_enabled ??
    rawSettings?.translationEngineSeedingEnabled ??
    rawSettings?.translation_engine_seeding_enabled ??
    null;
  if (typeof templateSeedingCandidate === "boolean") {
    setMtSeedingEnabled(templateSeedingCandidate);
  } else if (template.translationEngineId != null) {
    setMtSeedingEnabled(true);
  }

  const templateSource = template.languages?.src
    ? normalizeLocale(String(template.languages.src)).canonical
    : "";
  const effectiveSource = templateSource || sourceCanonical;
  if (templateSource) {
    setSrcLang(templateSource);
  }

  const allowedTargets = Array.isArray(template.languages?.targets) ? template.languages.targets : [];
  const normalizedTargets = allowedTargets
    .map((t) => normalizeLocale(String(t || "")).canonical)
    .filter(Boolean);
  const availableTargetsForTemplate = targetOptions.filter((value) => value !== effectiveSource);
  const filtered = normalizedTargets.filter((value) => availableTargetsForTemplate.includes(value));
  let nextTargets = projectTargetLangs
    .map((value) => normalizeLocale(String(value || "")).canonical)
    .filter(Boolean);
  if (filtered.length > 0) {
    const currentTargets = nextTargets;
    const keep = currentTargets.filter((value) => filtered.includes(value));
    nextTargets = keep.length > 0 ? keep : filtered;
    setProjectTargetLangs(nextTargets);
    setPendingFiles((prev) => prev.map((entry) => syncFileTargets(entry, nextTargets)));
  }

  const allowedTargetSet = new Set(nextTargets);
  const normalizeOverrideMap = (raw: Record<string, number | null> | undefined, validIds?: Set<number>) => {
    const out: Record<string, number | null> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.entries(raw).forEach(([key, value]) => {
      const normalizedKey = normalizeLocale(String(key || "")).canonical;
      if (!normalizedKey || !allowedTargetSet.has(normalizedKey)) return;
      if (value == null || String(value).trim() === "") {
        out[normalizedKey] = null;
        return;
      }
      const id = Number(value);
      if (!Number.isFinite(id) || id <= 0) return;
      if (validIds && !validIds.has(id)) return;
      out[normalizedKey] = id;
    });
    return out;
  };

  const nextTmxByTargetLang = normalizeOverrideMap(
    template.tmxByTargetLang,
    new Set(Array.from(tmSampleById.keys()))
  );
  const nextRulesetByTargetLang = normalizeOverrideMap(template.rulesetByTargetLang, rulesetIdSet);
  const nextGlossaryByTargetLang = normalizeOverrideMap(template.glossaryByTargetLang, glossaryIdSet);

  let nextDefaultTmxId = template.defaultTmxId ?? null;
  if (nextDefaultTmxId != null && !tmSampleById.has(nextDefaultTmxId)) {
    nextDefaultTmxId = null;
  }
  if (nextDefaultTmxId == null && legacyDefaultTmxId != null) {
    const legacyId = legacyDefaultTmxId;
    nextDefaultTmxId = tmSampleById.has(legacyId) ? legacyId : null;
  }
  const hasTmxOverride = Object.values(nextTmxByTargetLang).some((value) => value != null);
  setDefaultTmxId(nextDefaultTmxId);
  setTmxByTargetLang(nextTmxByTargetLang);
  setTmxEnabled(nextDefaultTmxId != null || hasTmxOverride);

  let nextDefaultRulesetId = template.defaultRulesetId ?? null;
  if (nextDefaultRulesetId != null && !rulesetIdSet.has(nextDefaultRulesetId)) {
    nextDefaultRulesetId = null;
  }
  if (nextDefaultRulesetId == null && legacyRulesetId != null) {
    const legacyId = legacyRulesetId;
    nextDefaultRulesetId = rulesetIdSet.has(legacyId) ? legacyId : null;
  }
  setRulesetId(nextDefaultRulesetId != null ? String(nextDefaultRulesetId) : "");
  setRulesetByTargetLang(nextRulesetByTargetLang);
  const hasRulesSelection =
    nextDefaultRulesetId != null || Object.values(nextRulesetByTargetLang).some((value) => value != null);
  setRulesEnabled(templateRulesEnabled ?? hasRulesSelection);

  let nextDefaultGlossaryId = template.defaultGlossaryId ?? null;
  if (nextDefaultGlossaryId != null && !glossaryIdSet.has(nextDefaultGlossaryId)) {
    nextDefaultGlossaryId = null;
  }
  if (nextDefaultGlossaryId == null && legacyGlossaryId != null) {
    const legacyId = legacyGlossaryId;
    nextDefaultGlossaryId = glossaryIdSet.has(legacyId) ? legacyId : null;
  }
  setGlossaryId(nextDefaultGlossaryId != null ? String(nextDefaultGlossaryId) : "");
  setGlossaryByTargetLang(nextGlossaryByTargetLang);
  const hasGlossarySelection =
    nextDefaultGlossaryId != null || Object.values(nextGlossaryByTargetLang).some((value) => value != null);
  const resolvedTermbaseEnabled =
    templateTermbaseEnabled ?? templateGlossaryEnabled ?? hasGlossarySelection;
  const resolvedGlossaryEnabled =
    templateGlossaryEnabled ?? templateTermbaseEnabled ?? hasGlossarySelection;
  setTermbaseEnabled(resolvedTermbaseEnabled);
  setGlossaryEnabled(resolvedGlossaryEnabled);

  setTemplateFileTypeConfigDefaults(defaults);

  if (Object.keys(defaults).length > 0) {
    setPendingFiles((prev) =>
      prev.map((entry) => {
        if (entry.uploadState === "uploading" || entry.uploadState === "uploaded") return entry;
        if (entry.fileType === "other") return entry;
        if (entry.fileTypeConfigId) return entry;
        const desired = defaults[entry.fileType];
        if (!desired) return entry;
        const options = fileTypeConfigsByType.get(entry.fileType) ?? [];
        if (!options.some((cfg) => String(cfg.id) === desired)) return entry;
        return { ...entry, fileTypeConfigId: desired };
      })
    );
  }
}

function handleProjectTemplateChange(value: string) {
  setProjectTemplateId(value);
  const template = projectTemplates.find((tpl) => String(tpl.id) === String(value)) ?? null;
  if (template) {
    applyTemplateDefaults(template);
  }
}

function addFiles(files: FileList | File[] | null | undefined) {
  if (!files) return;
  const list = Array.from(files);
  if (list.length === 0) return;

  setPendingFiles((prev) => {
    const existing = new Set(prev.map((p) => fileFingerprint(p.file)));
    const next = [...prev];
    const defaultTargets = normalizeTargetList(projectTargetLangs);

    for (const file of list) {
      const fingerprint = fileFingerprint(file);
      if (existing.has(fingerprint)) continue;
      existing.add(fingerprint);

      const fileType = detectUploadFileType(file);
      const options = fileType !== "other" ? fileTypeConfigsByType.get(fileType) ?? [] : [];
      const templateDefault = templateFileTypeConfigDefaults[fileType];
      const templateValid =
        templateDefault && options.some((cfg) => String(cfg.id) === String(templateDefault));
      const defaultConfigId = templateValid
        ? String(templateDefault)
        : options.length === 1
          ? String(options[0].id)
          : "";
      const assigneeAll = defaultAssigneeId || "";
      const rulesetAll = RULESET_INHERIT;
      const engineAll = ENGINE_INHERIT;
      next.push({
        localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        usage: "translatable",
        fileType,
        fileTypeConfigId: defaultConfigId,
        uploadState: "pending",
        uploadError: null,
        serverFileId: null,
        createdSegments: null,
        translationTargets: defaultTargets,
        sameAssignee: true,
        assigneeAll,
        assignments: buildAssignments(defaultTargets, undefined, {
          forceAssignee: Boolean(assigneeAll),
          defaultAssigneeId: assigneeAll,
          sameAssignee: true
        }),
        rulesetAll,
        rulesetAssignments: buildRulesetAssignments(defaultTargets, undefined),
        engineAll,
        engineAssignments: buildEngineAssignments(defaultTargets, undefined)
      });
    }

    return next;
  });
}

useEffect(() => {
  if (!fileTypeConfigsLoaded) return;
  setPendingFiles((prev) =>
    prev.map((entry) => {
      if (entry.uploadState === "uploading" || entry.uploadState === "uploaded") return entry;
      if (entry.fileType === "other") return entry;
      if (entry.fileTypeConfigId) return entry;
      const options = fileTypeConfigsByType.get(entry.fileType) ?? [];
      const templateDefault = templateFileTypeConfigDefaults[entry.fileType];
      if (templateDefault && options.some((cfg) => String(cfg.id) === String(templateDefault))) {
        return { ...entry, fileTypeConfigId: String(templateDefault) };
      }
      if (options.length === 1) return { ...entry, fileTypeConfigId: String(options[0].id) };
      return entry;
    })
  );
}, [fileTypeConfigsByType, fileTypeConfigsLoaded, templateFileTypeConfigDefaults]);

function removePendingFile(localId: string) {
  setPendingFiles((prev) => prev.filter((p) => p.localId !== localId));
}

function updatePendingFile(localId: string, patch: Partial<PendingProjectFile>) {
  setPendingFiles((prev) =>
    prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p))
  );
}

function handleProjectTargetsChange(nextTargets: string[]) {
  const normalized = normalizeTargetList(nextTargets);
  if (normalized.join("|") === projectTargetLangs.join("|")) return;

  if (pendingFiles.length > 0) {
    let applyAll = translationPlanMode === "simple";
    if (!applyAll) {
      applyAll = window.confirm("Apply changes to all files?");
    }
    setPendingFiles((prev) =>
      prev.map((entry) => {
        if (applyAll) return syncFileTargets(entry, normalized);
        const filtered = entry.translationTargets.filter((lang) => normalized.includes(lang));
        return syncFileTargets(entry, filtered);
      })
    );
  }

  setProjectTargetLangs(normalized);
}

function handleFileTargetsChange(fileId: string, targets: string[]) {
  const allowed = new Set(projectTargetLangs);
  const filtered = normalizeTargetList(targets).filter((lang) => allowed.has(lang));
  setPendingFiles((prev) =>
    prev.map((entry) => (entry.localId === fileId ? syncFileTargets(entry, filtered) : entry))
  );
}

function handleAssignmentChange(fileId: string, targetLang: string, patch: Partial<TranslationPlanAssignment>) {
  setPendingFiles((prev) =>
    prev.map((entry) => {
      if (entry.localId !== fileId) return entry;
      const existing = entry.assignments[targetLang] || { assigneeId: "" };
      return {
        ...entry,
        assignments: {
          ...entry.assignments,
          [targetLang]: {
            ...existing,
            ...patch
          }
        }
      };
    })
  );
}

function handleCopyDefaults(fileId: string, targetLang: string) {
  handleAssignmentChange(fileId, targetLang, {
    assigneeId: defaultAssigneeId || ""
  });
}

function handleFileAssigneeAllChange(fileId: string, assigneeId: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => (entry.localId === fileId ? { ...entry, assigneeAll: assigneeId } : entry))
  );
}

function applyAssigneeToFile(fileId: string, assigneeId: string) {
  if (!assigneeId) return;
  setPendingFiles((prev) =>
    prev.map((entry) => {
      if (entry.localId !== fileId) return entry;
      const nextAssignments = buildAssignments(entry.translationTargets, entry.assignments, {
        forceAssignee: true,
        defaultAssigneeId: assigneeId,
        sameAssignee: true
      });
      return { ...entry, assigneeAll: assigneeId, assignments: nextAssignments };
    })
  );
}

function applyAssigneeToAll(assigneeId: string) {
  if (!assigneeId) return;
  setPendingFiles((prev) =>
    prev.map((entry) => {
      const nextAssignments = buildAssignments(entry.translationTargets, entry.assignments, {
        forceAssignee: true,
        defaultAssigneeId: assigneeId,
        sameAssignee: true
      });
      return { ...entry, assigneeAll: assigneeId, assignments: nextAssignments };
    })
  );
}

function handleRulesetAssignmentChange(fileId: string, targetLang: string, rulesetValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => {
      if (entry.localId !== fileId) return entry;
      const existing = entry.rulesetAssignments[targetLang] || { rulesetId: RULESET_INHERIT };
      return {
        ...entry,
        rulesetAssignments: {
          ...entry.rulesetAssignments,
          [targetLang]: { ...existing, rulesetId: rulesetValue }
        }
      };
    })
  );
}

function handleEngineAssignmentChange(fileId: string, targetLang: string, engineValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => {
      if (entry.localId !== fileId) return entry;
      const existing = entry.engineAssignments[targetLang] || { engineId: ENGINE_INHERIT };
      return {
        ...entry,
        engineAssignments: {
          ...entry.engineAssignments,
          [targetLang]: { ...existing, engineId: engineValue }
        }
      };
    })
  );
}

function handleFileRulesetAllChange(fileId: string, rulesetValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => (entry.localId === fileId ? { ...entry, rulesetAll: rulesetValue } : entry))
  );
}

function handleFileEngineAllChange(fileId: string, engineValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => (entry.localId === fileId ? { ...entry, engineAll: engineValue } : entry))
  );
}

function applyRulesetToFile(fileId: string, rulesetValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => {
      if (entry.localId !== fileId) return entry;
      const nextAssignments: Record<string, RulesetAssignment> = {};
      entry.translationTargets.forEach((target) => {
        nextAssignments[target] = { rulesetId: rulesetValue };
      });
      return { ...entry, rulesetAll: rulesetValue, rulesetAssignments: nextAssignments };
    })
  );
}

function applyEngineToFile(fileId: string, engineValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => {
      if (entry.localId !== fileId) return entry;
      const nextAssignments: Record<string, EngineAssignment> = {};
      entry.translationTargets.forEach((target) => {
        nextAssignments[target] = { engineId: engineValue };
      });
      return { ...entry, engineAll: engineValue, engineAssignments: nextAssignments };
    })
  );
}

function applyRulesetToAll(rulesetValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => {
      const nextAssignments: Record<string, RulesetAssignment> = {};
      entry.translationTargets.forEach((target) => {
        nextAssignments[target] = { rulesetId: rulesetValue };
      });
      return { ...entry, rulesetAll: rulesetValue, rulesetAssignments: nextAssignments };
    })
  );
}

function applyEngineToAll(engineValue: string) {
  setPendingFiles((prev) =>
    prev.map((entry) => {
      const nextAssignments: Record<string, EngineAssignment> = {};
      entry.translationTargets.forEach((target) => {
        nextAssignments[target] = { engineId: engineValue };
      });
      return { ...entry, engineAll: engineValue, engineAssignments: nextAssignments };
    })
  );
}

function resetRulesetDefaults(fileId: string) {
  setPendingFiles((prev) =>
    prev.map((entry) =>
      entry.localId === fileId
        ? {
            ...entry,
            rulesetAll: RULESET_INHERIT,
            rulesetAssignments: buildRulesetAssignments(entry.translationTargets, undefined)
          }
        : entry
    )
  );
}

function resetEngineDefaults(fileId: string) {
  setPendingFiles((prev) =>
    prev.map((entry) =>
      entry.localId === fileId
        ? {
            ...entry,
            engineAll: ENGINE_INHERIT,
            engineAssignments: buildEngineAssignments(entry.translationTargets, undefined)
          }
        : entry
    )
  );
}

function resetFileDefaults(fileId: string) {
  const assigneeAll = defaultAssigneeId || "";
  setPendingFiles((prev) =>
    prev.map((entry) =>
      entry.localId === fileId
        ? syncFileTargets(entry, projectTargetLangs, {
            forceAssignee: true,
            sameAssignee: true,
            defaultAssigneeId: assigneeAll
          })
        : entry
    )
  );
}

const previousDepartmentRef = useRef<string | null>(null);
useEffect(() => {
  if (previousDepartmentRef.current === null) {
    previousDepartmentRef.current = departmentId;
    return;
  }
  if (previousDepartmentRef.current !== departmentId) {
    const nextAssignee = assignableUsers[0]?.username ? String(assignableUsers[0].username) : "";
    setDefaultAssigneeId(nextAssignee);
    setPendingFiles((prev) =>
      prev.map((entry) => ({
        ...entry,
        assigneeAll: nextAssignee,
        assignments: buildAssignments(entry.translationTargets, undefined, {
          forceAssignee: true,
          defaultAssigneeId: nextAssignee,
          sameAssignee: true
        })
      }))
    );
  }
  previousDepartmentRef.current = departmentId;
}, [assignableUsers, departmentId]);

const previousDefaultsRef = useRef({
  assigneeId: defaultAssigneeId
});

useEffect(() => {
  const previous = previousDefaultsRef.current;
  if (defaultAssigneeId !== previous.assigneeId && useSameAssignee) {
    setPendingFiles((prev) =>
      prev.map((entry) => {
        const nextAssignments: Record<string, TranslationPlanAssignment> = {};
        entry.translationTargets.forEach((lang) => {
          const existing = entry.assignments[lang] || { assigneeId: "" };
          const shouldUpdate = !existing.assigneeId || existing.assigneeId === previous.assigneeId;
          nextAssignments[lang] = {
            ...existing,
            assigneeId: shouldUpdate ? defaultAssigneeId : existing.assigneeId
          };
        });
        const shouldUpdateAll = !entry.assigneeAll || entry.assigneeAll === previous.assigneeId;
        return {
          ...entry,
          assigneeAll: shouldUpdateAll ? defaultAssigneeId : entry.assigneeAll,
          assignments: nextAssignments
        };
      })
    );
  }
  previousDefaultsRef.current = { assigneeId: defaultAssigneeId };
}, [defaultAssigneeId, useSameAssignee]);

const previousBehaviorRef = useRef({
  useSameAssignee
});

useEffect(() => {
  const previous = previousBehaviorRef.current;
  if (useSameAssignee && !previous.useSameAssignee) {
    applyAssigneeToAll(defaultAssigneeId);
  }
  previousBehaviorRef.current = { useSameAssignee };
}, [defaultAssigneeId, useSameAssignee]);

useEffect(() => {
  if (translationPlanMode !== "advanced") return;
  setPendingFiles((prev) =>
    prev.map((entry) => {
      const filtered = entry.translationTargets.filter((lang) => projectTargetLangs.includes(lang));
      return filtered.length === entry.translationTargets.length ? entry : syncFileTargets(entry, filtered);
    })
  );
}, [projectTargetLangs, translationPlanMode]);

function setTmxForTarget(target: string, tmxId: number | null) {
  const key = normalizeTargetKey(target);
  if (!key) return;
  setTmxByTargetLang((prev) => ({
    ...prev,
    [key]: tmxId
  }));
}

function applyDefaultTmxToAllTargets() {
  if (defaultTmxId == null) return;
  setTmxByTargetLang((prev) => {
    const next = { ...prev };
    projectTargetLangs.forEach((target) => {
      const key = normalizeTargetKey(target);
      if (key) next[key] = defaultTmxId;
    });
    return next;
  });
}

function setRulesetForTarget(target: string, rulesetValue: string) {
  const key = normalizeTargetKey(target);
  if (!key) return;
  setRulesetByTargetLang((prev) => {
    if (rulesetValue === RULESET_INHERIT) {
      const next = { ...prev };
      delete next[key];
      return next;
    }
    if (!rulesetValue) {
      return { ...prev, [key]: null };
    }
    const parsed = Number(rulesetValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return prev;
    return { ...prev, [key]: parsed };
  });
}

function setTranslationEngineForTarget(target: string, engineValue: string) {
  const key = normalizeTargetKey(target);
  if (!key) return;
  setTranslationEngineByTargetLang((prev) => {
    if (engineValue === ENGINE_INHERIT) {
      const next = { ...prev };
      delete next[key];
      return next;
    }
    if (!engineValue) {
      return { ...prev, [key]: null };
    }
    const parsed = Number(engineValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return prev;
    return { ...prev, [key]: parsed };
  });
}

function applyDefaultRulesetToAllTargets() {
  const parsed = resolveRulesetIdValue(rulesetId);
  setRulesetByTargetLang(() => {
    const next: Record<string, number | null> = {};
    projectTargetLangs.forEach((target) => {
      const key = normalizeTargetKey(target);
      if (!key) return;
      next[key] = parsed ?? null;
    });
    return next;
  });
}

function applyDefaultEngineToAllTargets() {
  const parsed = resolveEngineIdValue(translationEngineId);
  setTranslationEngineByTargetLang(() => {
    const next: Record<string, number | null> = {};
    projectTargetLangs.forEach((target) => {
      const key = normalizeTargetKey(target);
      if (!key) return;
      next[key] = parsed ?? null;
    });
    return next;
  });
}

function clearRulesetOverrides() {
  setRulesetByTargetLang({});
}

function clearEngineOverrides() {
  setTranslationEngineByTargetLang({});
}

function setMtSeedingEnabledValue(value: boolean) {
  setMtSeedingEnabled(value);
}

function setTerminologyEnabled(value: boolean) {
  setTermbaseEnabled(value);
  setGlossaryEnabled(value);
}

function setGlossaryForTarget(target: string, glossaryValue: string) {
  const key = normalizeTargetKey(target);
  if (!key) return;
  setGlossaryByTargetLang((prev) => {
    if (glossaryValue === RULESET_INHERIT) {
      const next = { ...prev };
      delete next[key];
      return next;
    }
    if (!glossaryValue) {
      return { ...prev, [key]: null };
    }
    const parsed = Number(glossaryValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return prev;
    return { ...prev, [key]: parsed };
  });
}

function applyDefaultGlossaryToAllTargets() {
  const parsed = resolveGlossaryIdValue(glossaryId);
  setGlossaryByTargetLang(() => {
    const next: Record<string, number | null> = {};
    projectTargetLangs.forEach((target) => {
      const key = normalizeTargetKey(target);
      if (!key) return;
      next[key] = parsed ?? null;
    });
    return next;
  });
}

function clearGlossaryOverrides() {
  setGlossaryByTargetLang({});
}

  return {
    applyTemplateDefaults,
    handleProjectTemplateChange,
    addFiles,
    removePendingFile,
    updatePendingFile,
    handleProjectTargetsChange,
    handleFileTargetsChange,
    handleAssignmentChange,
    handleCopyDefaults,
    handleFileAssigneeAllChange,
    applyAssigneeToFile,
    applyAssigneeToAll,
    handleRulesetAssignmentChange,
    handleEngineAssignmentChange,
    handleFileRulesetAllChange,
    handleFileEngineAllChange,
    applyRulesetToFile,
    applyEngineToFile,
    applyRulesetToAll,
    applyEngineToAll,
    resetRulesetDefaults,
    resetEngineDefaults,
    resetFileDefaults,
    setTmxForTarget,
    applyDefaultTmxToAllTargets,
    setRulesetForTarget,
    setTranslationEngineForTarget,
    applyDefaultRulesetToAllTargets,
    applyDefaultEngineToAllTargets,
    clearRulesetOverrides,
    clearEngineOverrides,
    setMtSeedingEnabledValue,
    setTerminologyEnabled,
    setGlossaryForTarget,
    applyDefaultGlossaryToAllTargets,
    clearGlossaryOverrides
  };
}
