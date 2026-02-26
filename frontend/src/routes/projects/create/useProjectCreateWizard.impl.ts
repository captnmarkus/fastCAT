import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  adminListUsers,
  adminListDepartments,
  listLanguageProcessingRulesets,
  listGlossaries,
  listDepartments,
  listProjectTemplates,
  listTranslationEngines,
  listEnabledFileTypeConfigs,
  listTmSamples,
  listUsersForAssignment,
  type AdminUser,
  type Department,
  type FileTypeConfig,
  type LanguageProcessingRuleset,
  type GlossaryOption,
  type ProjectTemplate,
  type SampleAsset,
  type TranslationEngine
} from "../../../api";
import type { AuthUser } from "../../../types/app";
import { safeLocalStorageGet, safeLocalStorageSet } from "../shared/storage";
import { type TranslationPlanFile } from "../shared/components/TranslationPlan";
import { useLanguages } from "../../../features/languages/hooks";
import { formatLanguageEntryLabel, languageFlagTag } from "../../../features/languages/utils";
import { normalizeLocale } from "../../../lib/i18n/locale";
import { resolveByNumericId } from "../../../utils/ids";
import {
  DEFAULT_CREATE_STATE,
  parsePersistedCreateState,
  type PersistedCreateState
} from "./useProjectCreateWizard.helpers";
import { type PendingProjectFile } from "./useProjectCreateWizard.logic";
import { useProjectCreateWizardAssignments } from "./useProjectCreateWizard.assignments";
import { useProjectCreateWizardComputed } from "./useProjectCreateWizard.computed";
import { useProjectCreateWizardActions } from "./useProjectCreateWizard.actions";
import { useProjectCreateWizardSubmit } from "./useProjectCreateWizard.submit";

export type WizardStepKey = "basics" | "tmx" | "engine" | "rules" | "glossary" | "review";

export const STEP_ORDER: { key: WizardStepKey; label: string }[] = [
  { key: "basics", label: "Basics + Files" },
  { key: "tmx", label: "Translation Memory (TMX)" },
  { key: "engine", label: "Translation Engine" },
  { key: "rules", label: "Rules" },
  { key: "glossary", label: "Termbase / Glossary" },
  { key: "review", label: "Review & Save" }
];

export const RULESET_INHERIT = "__inherit__";
export const ENGINE_INHERIT = "__inherit__";

export function stepIndexForKey(key: WizardStepKey) {
  return Math.max(0, STEP_ORDER.findIndex((s) => s.key === key));
}

export function useProjectCreateWizard({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createIdempotencyKeyRef = useRef<string>("");
  const isAdmin = currentUser?.role === "admin";
  const isManager = currentUser?.role === "manager";
  const isReviewer = currentUser?.role === "reviewer";
  const canAssign = isAdmin || isManager;

  const currentUserId = currentUser ? String(currentUser.id) : "";
  const currentUsername = currentUser?.username ? String(currentUser.username) : "";
  const currentUserKey = currentUsername || currentUserId;
  const storagePrefix = currentUserKey ? `fc:${currentUserKey}:projects` : "fc:projects";
  const createStorageKey = `${storagePrefix}:createDefaults`;

  const persisted = useMemo(
    () => parsePersistedCreateState(safeLocalStorageGet(createStorageKey)),
    [createStorageKey]
  );

  const [step, setStep] = useState<WizardStepKey>("basics");
  const [showValidation, setShowValidation] = useState(false);

  const [departmentId, setDepartmentId] = useState(persisted.departmentId);
  const [projectOwnerId, setProjectOwnerId] = useState(persisted.projectOwnerId);
  const [dueDate, setDueDate] = useState(persisted.dueDate);
  const [dueTime, setDueTime] = useState(persisted.dueTime);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectTemplateId, setProjectTemplateId] = useState(persisted.projectTemplateId);
  const [templateFileTypeConfigDefaults, setTemplateFileTypeConfigDefaults] = useState<Record<string, string>>({});
  const [srcLang, setSrcLang] = useState(persisted.srcLang);
  const [projectTargetLangs, setProjectTargetLangs] = useState<string[]>(persisted.targetLangs || []);
  const [glossaryId, setGlossaryId] = useState(persisted.glossaryId);
  const [tmxEnabled, setTmxEnabled] = useState(persisted.tmxEnabled);
  const [rulesEnabled, setRulesEnabled] = useState(persisted.rulesEnabled);
  const [termbaseEnabled, setTermbaseEnabled] = useState(persisted.termbaseEnabled);
  const [glossaryEnabled, setGlossaryEnabled] = useState(persisted.glossaryEnabled);
  const terminologyEnabled = termbaseEnabled || glossaryEnabled;
  const [defaultTmxId, setDefaultTmxId] = useState<number | null>(persisted.defaultTmxId ?? null);
  const [tmxByTargetLang, setTmxByTargetLang] = useState<Record<string, number | null>>(
    persisted.tmxByTargetLang || {}
  );
  const [rulesetByTargetLang, setRulesetByTargetLang] = useState<Record<string, number | null>>(
    persisted.rulesetByTargetLang || {}
  );
  const [glossaryByTargetLang, setGlossaryByTargetLang] = useState<Record<string, number | null>>(
    persisted.glossaryByTargetLang || {}
  );
  const [translationEngineByTargetLang, setTranslationEngineByTargetLang] = useState<Record<string, number | null>>(
    persisted.translationEngineByTargetLang || {}
  );
  const [translationEngineId, setTranslationEngineId] = useState(persisted.translationEngineId);
  const [mtSeedingEnabled, setMtSeedingEnabled] = useState(
    typeof persisted.mtSeedingEnabled === "boolean" ? persisted.mtSeedingEnabled : false
  );
  const [rulesetId, setRulesetId] = useState(persisted.rulesetId);
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(persisted.defaultAssigneeId || "");
  const [useSameAssignee, setUseSameAssignee] = useState(persisted.useSameAssignee);
  const [translationPlanMode, setTranslationPlanMode] = useState(persisted.planMode);
  const [pendingFiles, setPendingFiles] = useState<PendingProjectFile[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const legacyTmxRef = useRef({
    defaultFilename: persisted.legacyTmSample ?? "",
    selections: persisted.legacyTmxSelections ?? {}
  });

  const [tmSamples, setTmSamples] = useState<SampleAsset[]>([]);
  const [glossaries, setGlossaries] = useState<GlossaryOption[]>([]);
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplate[]>([]);
  const [translationEngines, setTranslationEngines] = useState<TranslationEngine[]>([]);
  const [rulesets, setRulesets] = useState<LanguageProcessingRuleset[]>([]);
  const [fileTypeConfigs, setFileTypeConfigs] = useState<FileTypeConfig[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projectTemplatesLoaded, setProjectTemplatesLoaded] = useState(false);
  const [fileTypeConfigsLoaded, setFileTypeConfigsLoaded] = useState(false);
  const [translationEnginesLoaded, setTranslationEnginesLoaded] = useState(false);
  const [glossariesLoaded, setGlossariesLoaded] = useState(false);
  const [rulesetsLoaded, setRulesetsLoaded] = useState(false);
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);

  const {
    activeSourceLanguages,
    activeTargetLanguages,
    defaults: languageDefaults,
    loading: languagesLoading
  } = useLanguages();

  const [creating, setCreating] = useState(false);
  const [creationStep, setCreationStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null);
  const [nameChecking, setNameChecking] = useState(false);
  const [nameCheckError, setNameCheckError] = useState<string | null>(null);

  const selectedProjectTemplate = useMemo(
    () => resolveByNumericId(projectTemplates, projectTemplateId),
    [projectTemplateId, projectTemplates]
  );

  const selectedTranslationEngine = useMemo(
    () => resolveByNumericId(translationEngines, translationEngineId),
    [translationEngineId, translationEngines]
  );

  const selectedRuleset = useMemo(
    () => resolveByNumericId(rulesets, rulesetId),
    [rulesetId, rulesets]
  );

  const selectedGlossary = useMemo(
    () => resolveByNumericId(glossaries, glossaryId),
    [glossaryId, glossaries]
  );

  const sourceOptions = useMemo(
    () => activeSourceLanguages.map((entry) => entry.canonical),
    [activeSourceLanguages]
  );
  const targetOptions = useMemo(
    () => activeTargetLanguages.map((entry) => entry.canonical),
    [activeTargetLanguages]
  );
  const targetMetaByTag = useMemo(() => {
    const map = new Map<string, { label: string; flag?: string }>();
    activeTargetLanguages.forEach((entry) => {
      map.set(entry.canonical, {
        label: formatLanguageEntryLabel(entry),
        flag: languageFlagTag(entry)
      });
    });
    return map;
  }, [activeTargetLanguages]);
  const sourceCanonical = useMemo(() => normalizeLocale(srcLang).canonical || srcLang, [srcLang]);
  const availableTargets = useMemo(
    () => targetOptions.filter((value) => value !== sourceCanonical),
    [sourceCanonical, targetOptions]
  );
  const templateTargetLangs = useMemo(() => {
    const raw = selectedProjectTemplate?.languages?.targets ?? [];
    const normalized = Array.isArray(raw)
      ? raw.map((value) => normalizeLocale(String(value || "")).canonical).filter(Boolean)
      : [];
    return normalized.filter((value) => availableTargets.includes(value));
  }, [availableTargets, selectedProjectTemplate]);
  const allowedProjectTargets = templateTargetLangs.length > 0 ? templateTargetLangs : availableTargets;
  const activeDepartments = useMemo(() => departments.filter((dept) => !dept.disabled), [departments]);
  const departmentOptions = useMemo(() => {
    if (isAdmin) return departments;
    if (!currentUser?.departmentId) return [];
    return departments.filter((dept) => dept.id === currentUser.departmentId);
  }, [currentUser?.departmentId, departments, isAdmin]);
  const selectedDepartment = useMemo(
    () => departments.find((dept) => String(dept.id) === String(departmentId)) ?? null,
    [departments, departmentId]
  );
  const managerOwners = useMemo(() => {
    const deptValue = Number(departmentId);
    if (!Number.isFinite(deptValue) || deptValue <= 0) return [];
    return users.filter(
      (user) => !user.disabled && user.role === "manager" && user.departmentId === deptValue
    );
  }, [departmentId, users]);
  const projectOwnerOptions = useMemo(() => {
    if (!isAdmin) return [];
    const options: AdminUser[] = [];
    const selfRecord =
      users.find(
        (user) =>
          String(user.username) === String(currentUsername) || String(user.id) === String(currentUserId)
      ) ?? null;
    if (selfRecord) {
      options.push(selfRecord);
    } else if (currentUser) {
      options.push({
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        departmentId: currentUser.departmentId ?? null,
        displayName: currentUser.displayName ?? null,
        email: currentUser.email ?? null,
        disabled: false,
        mustChangePassword: Boolean(currentUser.mustChangePassword),
        createdAt: "",
        lastLoginAt: null,
        failedAttempts: 0,
        locked: false,
        lockExpiresAt: null
      });
    }
    managerOwners.forEach((user) => {
      if (!options.some((option) => option.username === user.username)) {
        options.push(user);
      }
    });
    return options;
  }, [currentUser, currentUserId, currentUsername, isAdmin, managerOwners, users]);
  const dueAt = useMemo(() => {
    if (!dueDate) return "";
    const timeValue = dueTime ? `${dueTime}:00` : "00:00:00";
    const parsed = new Date(`${dueDate}T${timeValue}`);
    if (Number.isNaN(parsed.valueOf())) return "";
    return parsed.toISOString();
  }, [dueDate, dueTime]);
  const dueAtDisplay = useMemo(() => {
    if (!dueDate) return "";
    return dueTime ? `${dueDate} ${dueTime}` : dueDate;
  }, [dueDate, dueTime]);
  const projectOwnerLabel = useMemo(() => {
    if (!projectOwnerId) return "";
    const match = users.find(
      (user) => String(user.username) === String(projectOwnerId) || String(user.id) === String(projectOwnerId)
    );
    if (match) return match.displayName || match.username;
    if (projectOwnerId === currentUserKey) {
      return currentUser.displayName || currentUser.username || projectOwnerId;
    }
    return projectOwnerId;
  }, [currentUser.displayName, currentUser.username, currentUserKey, projectOwnerId, users]);

  useEffect(() => {
    if (languagesLoading) return;
    if (!srcLang && sourceOptions.length > 0) {
      const fallback =
        languageDefaults.defaultSource && sourceOptions.includes(languageDefaults.defaultSource)
          ? languageDefaults.defaultSource
          : sourceOptions[0];
      if (fallback) setSrcLang(fallback);
      return;
    }
    const normalized = normalizeLocale(srcLang).canonical;
    if (normalized && sourceOptions.includes(normalized) && normalized !== srcLang) {
      setSrcLang(normalized);
    }
  }, [languageDefaults.defaultSource, languagesLoading, sourceOptions, srcLang]);

  useEffect(() => {
    if (languagesLoading) return;
    const normalized = Array.from(
      new Set(
        projectTargetLangs
          .map((value) => normalizeLocale(value).canonical)
          .filter(Boolean)
      )
    ).filter((value) => allowedProjectTargets.includes(value));

    if (normalized.length === 0) {
      const fallbackTargets =
        (languageDefaults.defaultTargets || []).filter((value) => allowedProjectTargets.includes(value)) ||
        [];
      const fallback = fallbackTargets.length > 0 ? fallbackTargets : allowedProjectTargets.slice(0, 1);
      if (fallback.length > 0) setProjectTargetLangs(fallback);
      return;
    }

    if (normalized.join("|") !== projectTargetLangs.join("|")) {
      setProjectTargetLangs(normalized);
    }
  }, [allowedProjectTargets, languageDefaults.defaultTargets, languagesLoading, projectTargetLangs]);

  useEffect(() => {
    if (isAdmin) return;
    const deptId = currentUser?.departmentId;
    if (deptId && String(deptId) !== String(departmentId)) {
      setDepartmentId(String(deptId));
    }
  }, [currentUser?.departmentId, departmentId, isAdmin]);

  useEffect(() => {
    if (isManager || isReviewer) {
      if (currentUserKey && projectOwnerId !== currentUserKey) {
        setProjectOwnerId(currentUserKey);
      }
      return;
    }
    if (!isAdmin) return;
    const ownerSet = new Set(projectOwnerOptions.map((user) => String(user.username)));
    if (projectOwnerId && ownerSet.has(projectOwnerId)) return;
    const fallbackOwner = currentUserKey || projectOwnerOptions[0]?.username || "";
    if (fallbackOwner && projectOwnerId !== fallbackOwner) {
      setProjectOwnerId(fallbackOwner);
    }
  }, [currentUserKey, isAdmin, isManager, projectOwnerId, projectOwnerOptions]);

  useEffect(() => {
    if (!departmentsLoaded || !isAdmin) return;
    if (selectedDepartment && !selectedDepartment.disabled) return;
    const fallback = activeDepartments[0];
    if (fallback) setDepartmentId(String(fallback.id));
  }, [activeDepartments, departmentsLoaded, isAdmin, selectedDepartment]);

  useEffect(() => {
    const next: PersistedCreateState = {
      projectTemplateId,
      departmentId,
      projectOwnerId,
      dueDate,
      dueTime,
      srcLang,
      targetLangs: projectTargetLangs,
      glossaryId,
      tmxEnabled,
      rulesEnabled,
      termbaseEnabled,
      glossaryEnabled,
      defaultTmxId,
      tmxByTargetLang,
      rulesetByTargetLang,
      glossaryByTargetLang,
      translationEngineByTargetLang,
      translationEngineId,
      rulesetId,
      defaultAssigneeId,
      useSameAssignee,
      planMode: translationPlanMode,
      mtSeedingEnabled
    };
    safeLocalStorageSet(createStorageKey, JSON.stringify(next));
  }, [
    createStorageKey,
    defaultAssigneeId,
    departmentId,
    glossaryId,
    glossaryEnabled,
    glossaryByTargetLang,
    rulesEnabled,
    termbaseEnabled,
    translationEngineByTargetLang,
    projectTemplateId,
    projectOwnerId,
    projectTargetLangs,
    rulesetId,
    rulesetByTargetLang,
    srcLang,
    defaultTmxId,
    tmxEnabled,
    tmxByTargetLang,
    dueDate,
    dueTime,
    translationEngineId,
    translationPlanMode,
    useSameAssignee,
    mtSeedingEnabled
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setProjectTemplatesLoaded(false);
        setFileTypeConfigsLoaded(false);
        setTranslationEnginesLoaded(false);
        setGlossariesLoaded(false);
        setRulesetsLoaded(false);
        setDepartmentsLoaded(false);
        const [tmList, glossaryList, templateList, fileTypeList, engineList, rulesetList, deptList] = await Promise.all([
          listTmSamples().catch(() => [] as SampleAsset[]),
          listGlossaries().catch(() => [] as GlossaryOption[]),
          listProjectTemplates().catch(() => [] as ProjectTemplate[]),
          listEnabledFileTypeConfigs().catch(() => [] as FileTypeConfig[]),
          listTranslationEngines().catch(() => [] as TranslationEngine[]),
          listLanguageProcessingRulesets().catch(() => [] as LanguageProcessingRuleset[]),
          (isAdmin ? adminListDepartments() : listDepartments()).catch(() => [] as Department[])
        ]);
        if (cancelled) return;
        const enabledGlossaries = glossaryList.filter((glossary) => !glossary.disabled);
        const enabledTemplates = templateList.filter((tpl) => !tpl.disabled);
        setTmSamples(tmList);
        setGlossaries(enabledGlossaries);
        setProjectTemplates(enabledTemplates);
        setFileTypeConfigs(fileTypeList);
        setTranslationEngines(engineList.filter((engine) => !engine.disabled && engine.llmProviderId != null));
        setRulesets(rulesetList.filter((ruleset) => !ruleset.disabled));
        setDepartments(deptList);
        setProjectTemplatesLoaded(true);
        setFileTypeConfigsLoaded(true);
        setTranslationEnginesLoaded(true);
        setGlossariesLoaded(true);
        setRulesetsLoaded(true);
        setDepartmentsLoaded(true);
        setDefaultTmxId((prev) => {
          if (prev == null) return prev;
          return tmList.some((sample) => Number(sample.tmId) === Number(prev)) ? prev : null;
        });
        setTmxByTargetLang((prev) => {
          const next: Record<string, number | null> = {};
          Object.entries(prev).forEach(([key, value]) => {
            const id = value != null ? Number(value) : null;
            if (id != null && tmList.some((sample) => Number(sample.tmId) === id)) {
              next[key] = id;
            }
          });
          return next;
        });
        setGlossaryId((prev) => {
          const stored = String(prev || "").trim();
          if (stored && enabledGlossaries.some((glossary) => String(glossary.id) === stored)) return stored;
          return "";
        });
        setTranslationEngineId((prev) => {
          const stored = String(prev || "").trim();
          if (stored && engineList.some((engine) => String(engine.id) === stored && !engine.disabled)) return stored;
          return "";
        });
        setRulesetId((prev) => {
          const stored = String(prev || "").trim();
          if (stored && rulesetList.some((ruleset) => String(ruleset.id) === stored && !ruleset.disabled)) return stored;
          return "";
        });
        setProjectTemplateId((prev) => {
          const stored = String(prev || "").trim();
          if (stored && enabledTemplates.some((tpl) => String(tpl.id) === stored)) return stored;
          return "";
        });
        setRulesetByTargetLang((prev) => {
          const next: Record<string, number | null> = {};
          Object.entries(prev).forEach(([key, value]) => {
            if (value == null) {
              next[key] = null;
              return;
            }
            const id = Number(value);
            if (Number.isFinite(id) && rulesetList.some((ruleset) => Number(ruleset.id) === id && !ruleset.disabled)) {
              next[key] = id;
            }
          });
          return next;
        });
        setTranslationEngineByTargetLang((prev) => {
          const next: Record<string, number | null> = {};
          Object.entries(prev).forEach(([key, value]) => {
            if (value == null) {
              next[key] = null;
              return;
            }
            const id = Number(value);
            if (Number.isFinite(id) && engineList.some((engine) => Number(engine.id) === id && !engine.disabled)) {
              next[key] = id;
            }
          });
          return next;
        });
        setGlossaryByTargetLang((prev) => {
          const next: Record<string, number | null> = {};
          Object.entries(prev).forEach(([key, value]) => {
            if (value == null) {
              next[key] = null;
              return;
            }
            const id = Number(value);
            if (Number.isFinite(id) && enabledGlossaries.some((glossary) => Number(glossary.id) === id)) {
              next[key] = id;
            }
          });
          return next;
        });
      } catch (err) {
        console.error("load create defaults failed", err);
        if (!cancelled) {
          setTmSamples([]);
          setGlossaries([]);
          setProjectTemplates([]);
          setTranslationEngines([]);
          setRulesets([]);
          setFileTypeConfigs([]);
          setDepartments([]);
          setProjectTemplatesLoaded(true);
          setFileTypeConfigsLoaded(true);
          setTranslationEnginesLoaded(true);
          setGlossariesLoaded(true);
          setRulesetsLoaded(true);
          setDepartmentsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!canAssign) {
      setUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = isAdmin ? await adminListUsers() : await listUsersForAssignment();
        if (!cancelled) setUsers(list);
      } catch (err) {
        console.error("load users failed", err);
        if (!cancelled) setUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canAssign, isAdmin]);

  const {
    assignmentUsers,
    assignableUsers,
    translationPlanUsers,
    tmSampleByFilename,
    tmSampleById
  } = useProjectCreateWizardAssignments({
    canAssign,
    currentUser,
    currentUserKey,
    defaultAssigneeId,
    defaultTmxId,
    departmentId,
    isAdmin,
    isReviewer,
    legacyTmxRef,
    projectTargetLangs,
    setDefaultAssigneeId,
    setDefaultTmxId,
    setGlossaryByTargetLang,
    setRulesetByTargetLang,
    setTmxByTargetLang,
    setTranslationPlanMode,
    setUseSameAssignee,
    tmSamples,
    tmxByTargetLang,
    translationPlanMode,
    useSameAssignee,
    users
  });
  const {
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
  } = useProjectCreateWizardComputed({
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
  });

  const {
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
  } = useProjectCreateWizardActions({
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
  });

  const {
    validateBasicsStep,
    validateTmxStep,
    validateEngineStep,
    validateRulesStep,
    validateGlossaryStep,
    handleSaveProject
  } = useProjectCreateWizardSubmit({
    createIdempotencyKeyRef,
    currentUser,
    currentUserKey,
    defaultAssigneeId,
    departmentId,
    departments,
    description,
    dueAt,
    engineValidation,
    fileTypeConfigsByType,
    glossariesLoaded,
    glossaryEnabled,
    glossaryId,
    glossaryValidation,
    isAdmin,
    isManager,
    isReviewer,
    missingAssignments,
    missingFileTypeConfigMessage,
    mtSeedingEnabled,
    nameAvailable,
    nameCheckError,
    nameChecking,
    nav,
    pendingFiles,
    projectOwnerId,
    projectTargetLangs,
    projectTemplateId,
    resolvedTmxByTarget,
    rulesEnabled,
    rulesValidation,
    rulesetId,
    rulesetsLoaded,
    setCreating,
    setCreationStep,
    setError,
    setNameAvailable,
    setNameCheckError,
    setNameChecking,
    setPendingFiles,
    setShowValidation,
    srcLang,
    termbaseEnabled,
    tmxEnabled,
    tmxValidation,
    translationEngineByTargetLang,
    translationEngineId,
    translationEnginesLoaded,
    translationOverrides,
    translationPlanMode,
    trimmedName,
    updatePendingFile,
    tmSampleById,
    terminologyEnabled
  });
  function goToStep(next: WizardStepKey) {
    setError(null);
    setShowValidation(false);
    setStep(next);
  }

  function goNext() {
    const idx = stepIndexForKey(step);
    const next = STEP_ORDER[idx + 1]?.key;
    if (!next) return;

    if (step === "basics") {
      const basicsError = validateBasicsStep();
      if (basicsError) {
        setError(basicsError);
        setShowValidation(true);
        return;
      }
    }

    if (step === "tmx") {
      const tmxError = validateTmxStep();
      if (tmxError) {
        setError(tmxError);
        setShowValidation(true);
        return;
      }
    }
    if (step === "engine") {
      const engineError = validateEngineStep();
      if (engineError) {
        setError(engineError);
        setShowValidation(true);
        return;
      }
    }
    if (step === "rules") {
      const rulesError = validateRulesStep();
      if (rulesError) {
        setError(rulesError);
        setShowValidation(true);
        return;
      }
    }
    if (step === "glossary") {
      const glossaryError = validateGlossaryStep();
      if (glossaryError) {
        setError(glossaryError);
        setShowValidation(true);
        return;
      }
    }

    goToStep(next);
  }

  function goBack() {
    const idx = stepIndexForKey(step);
    const prev = STEP_ORDER[idx - 1]?.key;
    if (prev) goToStep(prev);
  }

  const state = {
    step,
    showValidation,
    basics: { name, description, departmentId, projectOwnerId, dueDate, dueTime, projectTemplateId },
    languages: { sourceLang: srcLang, targetLangs: projectTargetLangs },
    files: { pending: pendingFiles, fileSearch, templateFileTypeConfigDefaults },
    assignments: { defaultAssigneeId, useSameAssignee, planMode: translationPlanMode },
    engine: {
      translationEngineId, rulesEnabled, rulesetId, termbaseEnabled, glossaryEnabled, glossaryId,
      rulesetByTargetLang, glossaryByTargetLang, translationEngineByTargetLang, mtSeedingEnabled
    },
    tmx: { enabled: tmxEnabled, defaultTmxId, tmxByTargetLang },
    derived: { tasksDraft: translationTasks }
  };

  const ui = { creating, creationStep, error, nameAvailable, nameChecking, nameCheckError };
  const data = { tmSamples, glossaries, projectTemplates, translationEngines, rulesets, fileTypeConfigs, users, departments };
  const derived = {
    selectedProjectTemplate, selectedTranslationEngine, selectedRuleset, selectedGlossary,
    sourceOptions, targetOptions, availableTargets, allowedProjectTargets, templateTargetLangs, targetMetaByTag,
    departmentOptions, selectedDepartment, departmentInvalid, projectOwnerOptions, projectOwnerLabel, dueAt, dueAtDisplay, trimmedName,
    translationPlanUsers, translationPlanFiles, rulesetPlanFiles, enginePlanFiles, translationTasks, missingAssignments,
    assigneeLabelById, taskSummaryByFile, hasRulesetOverrides, hasEngineOverrides, hasRulesetTargetOverrides,
    hasEngineTargetOverrides, hasGlossaryTargetOverrides, rulesetSummaryLabel, engineSummaryLabel, glossarySummaryLabel,
    fileTypeConfigsByType, filteredPendingFiles, missingFileTypeConfigMessage, missingTmxTargets, resolvedTmxByTarget,
    resolvedRulesetByTarget, resolvedEngineByTarget, resolvedGlossaryByTarget, tmSampleById, hasEngineSelection,
    tmxValidation, engineValidation, rulesValidation, glossaryValidation, canProceed
  };
  const flags = {
    isAdmin, isManager, isReviewer, canAssign, projectTemplatesLoaded,
    fileTypeConfigsLoaded, translationEnginesLoaded, glossariesLoaded, rulesetsLoaded, departmentsLoaded
  };
  const actions = {
    setStep, setShowValidation, goToStep, goNext, goBack, handleSaveProject, setDepartmentId, setProjectOwnerId, setDueDate, setDueTime,
    setName, setDescription, setProjectTemplateId: handleProjectTemplateChange, applyTemplateDefaults, setSrcLang, setProjectTargetLangs,
    handleProjectTargetsChange, setDefaultAssigneeId, setUseSameAssignee, setTranslationPlanMode, setFileSearch, addFiles, removePendingFile,
    updatePendingFile, handleFileTargetsChange, handleAssignmentChange, handleRulesetAssignmentChange, handleEngineAssignmentChange,
    handleCopyDefaults, handleFileAssigneeAllChange, applyAssigneeToFile, handleFileRulesetAllChange, handleFileEngineAllChange,
    applyRulesetToFile, applyEngineToFile, applyRulesetToAll, applyEngineToAll, resetFileDefaults, resetRulesetDefaults, resetEngineDefaults,
    setTmxEnabled, setRulesEnabled, setTerminologyEnabled, setDefaultTmxId, setTmxForTarget, applyDefaultTmxToAllTargets, setRulesetForTarget,
    applyDefaultRulesetToAllTargets, clearRulesetOverrides, setTranslationEngineForTarget, applyDefaultEngineToAllTargets, clearEngineOverrides,
    setTranslationEngineId, setMtSeedingEnabled: setMtSeedingEnabledValue, setRulesetId, setGlossaryId, setGlossaryForTarget,
    applyDefaultGlossaryToAllTargets, clearGlossaryOverrides, cancel: () => nav("/projects"),
    openFileTypeConfig: (fileType: string) => nav(`/resources/file-types/create?type=${encodeURIComponent(fileType)}`)
  };
  const refs = { fileInputRef };

  return {
    state,
    ui,
    data,
    derived,
    flags,
    actions,
    refs,
    currentUser
  };
}

export type ProjectCreateWizard = ReturnType<typeof useProjectCreateWizard>;
