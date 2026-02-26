// @ts-nocheck
import {
  checkProjectNameAvailable,
  provisionProject,
  uploadProjectFile
} from "../../../api";
import { parsePositiveInt } from "../../../utils/ids";
import {
  ENGINE_INHERIT,
  buildTasks,
  normalizeTargetForPayload,
  normalizeTargetKey
} from "./useProjectCreateWizard.logic";

export function useProjectCreateWizardSubmit(ctx: any) {
  const {
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
  } = ctx;
function validateBasicsStep(): string | null {
  const dept = Number(departmentId);
  if (!Number.isFinite(dept) || dept <= 0) return "Department is required.";
  const deptRecord = departments.find((entry) => entry.id === dept);
  if (!deptRecord) return "Selected department not found.";
  if (deptRecord.disabled) return "Selected department is disabled.";
  if (!isAdmin && currentUser.departmentId && dept !== currentUser.departmentId) {
    return "You can only create projects for your department.";
  }
  if (!projectOwnerId) return "Project owner is required.";
  if ((isManager || isReviewer) && projectOwnerId !== currentUserKey) {
    return "Project owner must be you.";
  }
  if (!trimmedName) return "Project title required.";
  if (!srcLang) return "Source language required.";
  if (projectTargetLangs.length === 0) return "Select at least one target language.";
  if (projectTargetLangs.some((lang) => lang === srcLang)) {
    return "Source and target language must be different.";
  }
  if (nameAvailable === false) return "A project with this title already exists.";
  if (pendingFiles.length === 0) return "Add at least one file.";
  if (pendingFiles.some((entry) => entry.file.name.toLowerCase().endsWith(".tmx"))) {
    return "TMX files cannot be uploaded as project files. Use the TMX library instead.";
  }

  for (const entry of pendingFiles) {
    if (entry.fileType === "other") continue;
    const options = fileTypeConfigsByType.get(entry.fileType) ?? [];
    if (options.length === 0) return missingFileTypeConfigMessage;
    if (!entry.fileTypeConfigId) return "Select a File Type Configuration for every file.";
  }

  const translatableFiles = pendingFiles.filter((entry) => entry.usage === "translatable");
  if (translatableFiles.length === 0) {
    return "Add at least one translatable file.";
  }

  for (const entry of translatableFiles) {
    const fileTargets = translationPlanMode === "simple" ? projectTargetLangs : entry.translationTargets;
    if (fileTargets.length === 0) {
      return "Select target languages for every file.";
    }
    for (const lang of fileTargets) {
      if (!projectTargetLangs.includes(lang)) {
        return "File target languages must be within project targets.";
      }
    }
  }
  if (missingAssignments.size > 0) {
    return "Assignee required for each language/task.";
  }

  return null;
}

function validateTmxStep(): string | null {
  if (!tmxEnabled) return null;
  if (projectTargetLangs.length === 0) return "Select target languages before configuring TMX.";
  return tmxValidation.blockingErrors[0] ?? null;
}

function validateEngineStep(): string | null {
  if (!mtSeedingEnabled || !translationEnginesLoaded) return null;
  return engineValidation.blockingErrors[0] ?? null;
}

function validateRulesStep(): string | null {
  if (!rulesEnabled || !rulesetsLoaded) return null;
  return rulesValidation.blockingErrors[0] ?? null;
}

function validateGlossaryStep(): string | null {
  if (!terminologyEnabled || !glossariesLoaded) return null;
  return glossaryValidation.blockingErrors[0] ?? null;
}

function normalizeOverrideMapKeys(map: Record<string, number | null>) {
  const next: Record<string, number | null> = {};
  Object.entries(map).forEach(([key, value]) => {
    const normalized = normalizeTargetForPayload(key);
    if (!normalized) return;
    next[normalized] = value ?? null;
  });
  return next;
}

function buildEngineOverridesPayload(params: { files: PendingProjectFile[]; mode: "simple" | "advanced" }) {
  const result: Record<string, Record<string, number | null | "inherit">> = {};
  if (params.mode !== "advanced") return result;
  params.files.forEach((file) => {
    if (file.usage !== "translatable") return;
    const entry: Record<string, number | null | "inherit"> = {};
    Object.entries(file.engineAssignments || {}).forEach(([lang, assignment]) => {
      const targetKey = normalizeTargetForPayload(lang);
      if (!targetKey) return;
      const selection = assignment.engineId;
      if (selection === ENGINE_INHERIT || selection === undefined) {
        entry[targetKey] = "inherit";
        return;
      }
      if (selection === "") {
        entry[targetKey] = null;
        return;
      }
      const parsed = parsePositiveInt(selection);
      if (parsed != null) {
        entry[targetKey] = parsed;
      }
    });
    if (Object.keys(entry).length > 0) {
      result[file.localId] = entry;
    }
  });
  return result;
}

function getOrCreateIdempotencyKey() {
  const existing = String(createIdempotencyKeyRef.current || "").trim();
  if (existing) return existing;
  const generated = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  createIdempotencyKeyRef.current = generated;
  return generated;
}

function buildCreateProjectPayload(params: {
  idempotencyKey: string;
  name: string;
  description?: string;
  departmentId: number;
  srcLang: string;
  projectTargetLangs: string[];
  projectOwnerId: string;
  dueAt?: string | null;
  templateId: number | null;
  translationEngineId: number | null;
  translationEngineByTargetLang: Record<string, number | null>;
  translationEngineOverrides: Record<string, Record<string, number | null | "inherit">>;
  mtSeedingEnabled: boolean;
  rulesEnabled: boolean;
  rulesetId: number | null;
  termbaseEnabled: boolean;
  glossaryEnabled: boolean;
  glossaryId: string;
  pendingFiles: PendingProjectFile[];
  tasks: TranslationTaskDraft[];
  primaryTmxSample: SampleAsset | null;
}) {
  const planMap = new Map<
    string,
    {
      tempKey: string;
      targetLangs: string[];
      assignments: Record<
        string,
        {
          translatorUserId: string;
          tmxId?: number | null;
          seedSource?: string;
          engineId?: number | null;
          rulesetId?: number | null;
          glossaryId?: number | null;
        }
      >;
    }
  >();

  params.tasks.forEach((task) => {
    const targetKey = normalizeTargetForPayload(task.targetLang);
    const existing = planMap.get(task.fileLocalId) || {
      tempKey: task.fileLocalId,
      targetLangs: [],
      assignments: {} as Record<
        string,
        {
          translatorUserId: string;
          tmxId?: number | null;
          seedSource?: string;
          engineId?: number | null;
          rulesetId?: number | null;
          glossaryId?: number | null;
        }
      >
    };
    if (!existing.assignments[targetKey]) {
      existing.targetLangs.push(targetKey);
    }
    existing.assignments[targetKey] = {
      translatorUserId: task.assigneeId,
      tmxId: task.tmxId ?? null,
      seedSource: task.tmxId ? "tmx" : task.engineId != null ? "nmt" : "none",
      engineId: task.engineId ?? null,
      rulesetId: task.rulesetId ?? null,
      glossaryId: task.glossaryId ?? null
    };
    planMap.set(task.fileLocalId, existing);
  });

  const translationPlanPayload = Array.from(planMap.values());
  const filesPayload = params.pendingFiles.map((entry) => ({
    tempKey: entry.localId,
    filename: entry.file.name,
    fileTypeConfigId:
      entry.fileType !== "other" && entry.fileTypeConfigId ? Number(entry.fileTypeConfigId) : null
  }));

  const primaryTarget = params.projectTargetLangs[0] || "";

  return {
    idempotencyKey: params.idempotencyKey,
    name: params.name,
    projectTemplateId: params.templateId ?? undefined,
    description: params.description?.trim() || undefined,
    departmentId: params.departmentId,
    srcLang: params.srcLang,
    tgtLang: primaryTarget || undefined,
    projectTargetLangs: params.projectTargetLangs,
    projectOwnerId: params.projectOwnerId,
    dueAt: params.dueAt || undefined,
    files: filesPayload,
    translationPlan: translationPlanPayload,
    tmSample: params.primaryTmxSample?.filename || undefined,
    tmSampleTmId: params.primaryTmxSample?.tmId ?? null,
    glossaryId: params.glossaryId ? Number(params.glossaryId) : null,
    rulesEnabled: params.rulesEnabled,
    termbaseEnabled: params.termbaseEnabled,
    glossaryEnabled: params.glossaryEnabled,
    translationEngineId: params.translationEngineId,
    translationEngineDefaultsByTarget: params.translationEngineByTargetLang,
    translationEngineOverrides: params.translationEngineOverrides,
    mtSeedingEnabled: params.mtSeedingEnabled,
    rulesetId: params.rulesetId
  };
}

async function handleSaveProject() {
  setShowValidation(true);

  const basicsError = validateBasicsStep();
  if (basicsError) {
    setError(basicsError);
    return;
  }
  const tmxError = validateTmxStep();
  if (tmxError) {
    setError(tmxError);
    return;
  }
  const engineError = validateEngineStep();
  if (engineError) {
    setError(engineError);
    return;
  }
  const rulesError = validateRulesStep();
  if (rulesError) {
    setError(rulesError);
    return;
  }
  const glossaryError = validateGlossaryStep();
  if (glossaryError) {
    setError(glossaryError);
    return;
  }

  const dept = Number(departmentId);
  const ownerRef = projectOwnerId || currentUserKey;

  let available = nameAvailable;
  if (nameChecking || available === null || nameCheckError) {
    try {
      setNameChecking(true);
      setNameCheckError(null);
      available = await checkProjectNameAvailable({
        name: trimmedName,
        projectOwnerId: ownerRef
      });
      setNameAvailable(available);
    } catch (err: any) {
      setNameCheckError(err?.message || "Failed to validate project name");
    } finally {
      setNameChecking(false);
    }
  }

  if (available === false) {
    setError("A project with this title already exists.");
    return;
  }

  setCreating(true);
  setCreationStep("Initializing project...");
  setError(null);

  try {
    const translationEngineIdRaw = String(translationEngineId || "").trim();
    const resolvedTranslationEngineId = parsePositiveInt(translationEngineIdRaw);

    const rulesetIdRaw = String(rulesetId || "").trim();
    const resolvedRulesetId = parsePositiveInt(rulesetIdRaw);
    const effectiveRulesetId = rulesEnabled ? resolvedRulesetId : null;

    const templateIdRaw = String(projectTemplateId || "").trim();
    const resolvedTemplateId = parsePositiveInt(templateIdRaw);

    const taskOverrides = rulesEnabled ? translationOverrides : { ...translationOverrides, rulesetAssignments: {} };
    const tasksForSubmit = buildTasks({
      files: pendingFiles,
      sourceLang: srcLang,
      projectTargets: projectTargetLangs,
      mode: translationPlanMode,
      defaults: { assigneeId: defaultAssigneeId },
      overrides: taskOverrides,
      tmxByTargetLang: resolvedTmxByTarget,
      rulesetId: effectiveRulesetId
    });
    if (tasksForSubmit.some((task) => !task.assigneeId)) {
      throw new Error("Assignee required for each language/task.");
    }
    const primaryTarget = projectTargetLangs[0] || "";
    const primaryTargetKey = normalizeTargetKey(primaryTarget);
    const primaryTmxId = tmxEnabled && primaryTargetKey ? resolvedTmxByTarget[primaryTargetKey] ?? null : null;
    const primaryTmxSample = primaryTmxId != null ? tmSampleById.get(primaryTmxId) ?? null : null;
    const engineDefaultsByTargetPayload = normalizeOverrideMapKeys(translationEngineByTargetLang);
    const engineOverridesPayload = buildEngineOverridesPayload({
      files: pendingFiles,
      mode: translationPlanMode
    });
    const resolvedMtSeedingEnabled = mtSeedingEnabled;

    const glossaryIdForPayload = terminologyEnabled ? glossaryId : "";
    const idempotencyKey = getOrCreateIdempotencyKey();
    const payload = buildCreateProjectPayload({
      idempotencyKey,
      name: trimmedName,
      description,
      departmentId: dept,
      srcLang,
      projectTargetLangs,
      projectOwnerId: ownerRef,
      dueAt,
      templateId: resolvedTemplateId,
      translationEngineId: resolvedTranslationEngineId,
      translationEngineByTargetLang: engineDefaultsByTargetPayload,
      translationEngineOverrides: engineOverridesPayload,
      mtSeedingEnabled: resolvedMtSeedingEnabled,
      rulesEnabled,
      rulesetId: effectiveRulesetId,
      termbaseEnabled: termbaseEnabled,
      glossaryEnabled: glossaryEnabled,
      glossaryId: glossaryIdForPayload,
      pendingFiles,
      tasks: tasksForSubmit,
      primaryTmxSample
    });

    const { projectId, files: createdFiles } = await provisionProject(payload);

    // Reset any previous upload state
    const fileIdMap = new Map(
      (createdFiles || []).map((entry) => [String(entry.tempKey), Number(entry.fileId)])
    );
    setPendingFiles((prev) =>
      prev.map((p) => ({
        ...p,
        uploadState: "pending",
        uploadError: null,
        serverFileId: fileIdMap.get(String(p.localId)) ?? null,
        createdSegments: null
      }))
    );

    const filesToUpload = pendingFiles;
    for (let i = 0; i < filesToUpload.length; i += 1) {
      const entry = filesToUpload[i];
      const idxLabel = `${i + 1}/${filesToUpload.length}`;
      setCreationStep(`Uploading files... (${idxLabel})`);
      updatePendingFile(entry.localId, { uploadState: "uploading", uploadError: null });
      try {
        const fileTypeConfigId =
          entry.fileType !== "other" && entry.fileTypeConfigId ? Number(entry.fileTypeConfigId) : null;
        const fileId = fileIdMap.get(String(entry.localId)) ?? entry.serverFileId ?? null;
        const uploaded = await uploadProjectFile(projectId, entry.file, { fileTypeConfigId, fileId });
        updatePendingFile(entry.localId, {
          uploadState: "uploaded",
          serverFileId: uploaded.fileId,
          createdSegments: uploaded.createdSegments
        });
      } catch (err: any) {
        const userMessage = err?.userMessage || err?.message || "Upload failed";
        updatePendingFile(entry.localId, {
          uploadState: "error",
          uploadError: userMessage
        });
        throw err;
      }
    }

    setCreationStep("Preparing project...");
    try {
      window.dispatchEvent(new CustomEvent("fc:inbox:refresh"));
    } catch {
      // ignore (non-browser env)
    }
    nav(`/projects/${projectId}/provisioning`);
  } catch (err: any) {
    setError(err?.message || "Failed to create project");
  } finally {
    setCreating(false);
    setCreationStep("");
  }
}

  return {
    validateBasicsStep,
    validateTmxStep,
    validateEngineStep,
    validateRulesStep,
    validateGlossaryStep,
    handleSaveProject
  };
}
