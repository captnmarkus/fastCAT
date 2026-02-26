import { normalizeLocale } from "../../../lib/i18n/locale";
import type { UploadFileType } from "./useProjectCreateWizard.helpers";
import type { TranslationPlanAssignment } from "../shared/components/TranslationPlan";

export const RULESET_INHERIT = "__inherit__";
export const ENGINE_INHERIT = "__inherit__";

export type PendingProjectFile = {
  localId: string;
  file: File;
  usage: "translatable" | "reference";
  fileType: UploadFileType;
  fileTypeConfigId: string;
  uploadState: "pending" | "uploading" | "uploaded" | "error";
  uploadError: string | null;
  serverFileId: number | null;
  createdSegments: number | null;
  translationTargets: string[];
  sameAssignee: boolean;
  assigneeAll: string;
  assignments: Record<string, TranslationPlanAssignment>;
  rulesetAll: string;
  rulesetAssignments: Record<string, RulesetAssignment>;
  engineAll: string;
  engineAssignments: Record<string, EngineAssignment>;
};

export type RulesetAssignment = { rulesetId: string };
export type EngineAssignment = { engineId: string };

export type TranslationTaskDraft = {
  fileLocalId: string;
  fileName: string;
  sourceLang: string;
  targetLang: string;
  assigneeId: string;
  tmxId?: number | null;
  engineId?: number | null;
  rulesetId?: number | null;
  glossaryId?: number | null;
};

export type TranslationTaskOverrides = {
  fileTargets: Record<string, string[]>;
  assignments: Record<string, Record<string, TranslationPlanAssignment>>;
  rulesetAssignments: Record<string, Record<string, RulesetAssignment>>;
  engineAssignments: Record<string, Record<string, EngineAssignment>>;
};

export function normalizeTargetKey(value: string) {
  return normalizeLocale(String(value || "")).canonical;
}

export function normalizeTargetList(values: string[], allowedProjectTargets: string[]) {
  const normalized = Array.from(new Set(values.map((value) => normalizeTargetKey(value)).filter(Boolean)));
  return normalized.filter((value) => allowedProjectTargets.includes(value));
}

export function normalizeTargetForPayload(value: string) {
  const canonical = normalizeTargetKey(value) || String(value || "").trim();
  return canonical.toLowerCase();
}

export function resolveRulesetIdValue(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveEngineIdValue(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveGlossaryIdValue(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveOverrideSelection(
  baseId: number | null,
  selection: string | undefined,
  inheritToken: string
) {
  if (selection === undefined || selection === inheritToken) return baseId;
  if (selection === "") return null;
  const parsed = Number(selection);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function buildTasks(params: {
  files: PendingProjectFile[];
  sourceLang: string;
  projectTargets: string[];
  mode: "simple" | "advanced";
  defaults: { assigneeId: string };
  overrides?: TranslationTaskOverrides;
  tmxByTargetLang?: Record<string, number | null>;
  engineId?: number | null;
  engineByTargetLang?: Record<string, number | null>;
  rulesetId?: number | null;
  rulesetByTargetLang?: Record<string, number | null>;
  glossaryId?: number | null;
  glossaryByTargetLang?: Record<string, number | null>;
}): TranslationTaskDraft[] {
  const normalizedProjectTargets = params.projectTargets.map(normalizeTargetKey).filter(Boolean);
  const projectTargetSet = new Set(normalizedProjectTargets);
  const normalizedSourceLang = normalizeTargetKey(params.sourceLang) || String(params.sourceLang || "").trim();
  const tasks: TranslationTaskDraft[] = [];

  params.files.forEach((file) => {
    if (file.usage !== "translatable") return;
    const overrideTargets = params.overrides?.fileTargets?.[file.localId];
    const rawTargets = params.mode === "simple" ? params.projectTargets : overrideTargets ?? file.translationTargets;
    const normalizedTargets = rawTargets
      .map(normalizeTargetKey)
      .filter((lang) => lang && projectTargetSet.has(lang));
    if (normalizedTargets.length === 0) return;

    const assignmentMap = new Map<string, TranslationPlanAssignment>();
    const rulesetMap = new Map<string, RulesetAssignment>();
    const engineMap = new Map<string, EngineAssignment>();
    if (params.mode === "advanced") {
      const assignmentOverrides = params.overrides?.assignments?.[file.localId] ?? file.assignments;
      Object.entries(assignmentOverrides || {}).forEach(([lang, assignment]) => {
        const normalized = normalizeTargetKey(lang);
        if (normalized) assignmentMap.set(normalized, assignment);
      });
      const rulesetOverrides = params.overrides?.rulesetAssignments?.[file.localId] ?? file.rulesetAssignments;
      Object.entries(rulesetOverrides || {}).forEach(([lang, assignment]) => {
        const normalized = normalizeTargetKey(lang);
        if (normalized) rulesetMap.set(normalized, assignment);
      });
      const engineOverrides = params.overrides?.engineAssignments?.[file.localId] ?? file.engineAssignments;
      Object.entries(engineOverrides || {}).forEach(([lang, assignment]) => {
        const normalized = normalizeTargetKey(lang);
        if (normalized) engineMap.set(normalized, assignment);
      });
    }

    normalizedTargets.forEach((targetLang) => {
      const assignment = assignmentMap.get(targetLang);
      const assigneeId = params.mode === "simple" ? params.defaults.assigneeId || "" : assignment?.assigneeId ?? "";
      const tmxId = params.tmxByTargetLang?.[targetLang] ?? null;
      const hasEngineOverride =
        params.engineByTargetLang &&
        Object.prototype.hasOwnProperty.call(params.engineByTargetLang, targetLang);
      const baseEngineId =
        hasEngineOverride && params.engineByTargetLang
          ? params.engineByTargetLang[targetLang] ?? null
          : params.engineId ?? null;
      const engineAssignment = engineMap.get(targetLang);
      const engineSelection = engineAssignment?.engineId;
      let resolvedEngineId: number | null = baseEngineId;
      if (params.mode === "advanced") {
        if (engineSelection === ENGINE_INHERIT || engineSelection === undefined) {
          resolvedEngineId = baseEngineId;
        } else if (engineSelection === "") {
          resolvedEngineId = null;
        } else {
          resolvedEngineId = resolveEngineIdValue(engineSelection);
        }
      }
      const hasRulesetOverride =
        params.rulesetByTargetLang &&
        Object.prototype.hasOwnProperty.call(params.rulesetByTargetLang, targetLang);
      const baseRulesetId =
        hasRulesetOverride && params.rulesetByTargetLang
          ? params.rulesetByTargetLang[targetLang] ?? null
          : params.rulesetId ?? null;
      const rulesetAssignment = rulesetMap.get(targetLang);
      const rulesetSelection = rulesetAssignment?.rulesetId;
      let resolvedRulesetId: number | null = baseRulesetId;
      if (params.mode === "advanced") {
        if (rulesetSelection === RULESET_INHERIT || rulesetSelection === undefined) {
          resolvedRulesetId = baseRulesetId;
        } else if (rulesetSelection === "") {
          resolvedRulesetId = null;
        } else {
          resolvedRulesetId = resolveRulesetIdValue(rulesetSelection);
        }
      }
      const hasGlossaryOverride =
        params.glossaryByTargetLang &&
        Object.prototype.hasOwnProperty.call(params.glossaryByTargetLang, targetLang);
      const resolvedGlossaryId =
        hasGlossaryOverride && params.glossaryByTargetLang
          ? params.glossaryByTargetLang[targetLang] ?? null
          : params.glossaryId ?? null;
      tasks.push({
        fileLocalId: file.localId,
        fileName: file.file.name,
        sourceLang: normalizedSourceLang,
        targetLang,
        assigneeId,
        tmxId,
        engineId: resolvedEngineId,
        rulesetId: resolvedRulesetId,
        glossaryId: resolvedGlossaryId
      });
    });
  });

  return tasks;
}

export function buildAssignments(
  targets: string[],
  existing?: Record<string, TranslationPlanAssignment>,
  opts?: {
    forceAssignee?: boolean;
    defaultAssigneeId?: string;
    sameAssignee?: boolean;
    useSameAssignee?: boolean;
  }
) {
  const next: Record<string, TranslationPlanAssignment> = {};
  const baseAssigneeId = opts?.defaultAssigneeId ?? "";
  const sameAssignee = Boolean(opts?.sameAssignee);
  const applyAll = Boolean(opts?.forceAssignee || sameAssignee);
  targets.forEach((target) => {
    const prev = existing?.[target];
    let assigneeId = prev?.assigneeId || "";
    if (applyAll) {
      assigneeId = baseAssigneeId || "";
    } else if (!assigneeId && opts?.useSameAssignee) {
      assigneeId = baseAssigneeId || "";
    }
    next[target] = {
      assigneeId: assigneeId || ""
    };
  });
  return next;
}

export function buildRulesetAssignments(
  targets: string[],
  existing?: Record<string, RulesetAssignment>
) {
  const next: Record<string, RulesetAssignment> = {};
  targets.forEach((target) => {
    const prev = existing?.[target];
    const rulesetId = prev?.rulesetId !== undefined ? prev.rulesetId : RULESET_INHERIT;
    next[target] = { rulesetId };
  });
  return next;
}

export function buildEngineAssignments(
  targets: string[],
  existing?: Record<string, EngineAssignment>
) {
  const next: Record<string, EngineAssignment> = {};
  targets.forEach((target) => {
    const prev = existing?.[target];
    const engineId = prev?.engineId !== undefined ? prev.engineId : ENGINE_INHERIT;
    next[target] = { engineId };
  });
  return next;
}

export function resolveDisplayAssignments(
  targets: string[],
  existing?: Record<string, TranslationPlanAssignment>,
  opts?: { fallbackToDefault?: boolean; defaultAssigneeId?: string }
) {
  const next: Record<string, TranslationPlanAssignment> = {};
  const fallbackAssignee = opts?.fallbackToDefault ? opts?.defaultAssigneeId ?? "" : "";
  targets.forEach((target) => {
    const prev = existing?.[target];
    next[target] = {
      assigneeId: prev?.assigneeId ?? fallbackAssignee
    };
  });
  return next;
}

export function resolveRulesetAssignments(
  targets: string[],
  existing?: Record<string, RulesetAssignment>
) {
  const next: Record<string, RulesetAssignment> = {};
  targets.forEach((target) => {
    const prev = existing?.[target];
    const rulesetId = prev?.rulesetId !== undefined ? prev.rulesetId : RULESET_INHERIT;
    next[target] = { rulesetId };
  });
  return next;
}

export function resolveEngineAssignments(
  targets: string[],
  existing?: Record<string, EngineAssignment>
) {
  const next: Record<string, EngineAssignment> = {};
  targets.forEach((target) => {
    const prev = existing?.[target];
    const engineId = prev?.engineId !== undefined ? prev.engineId : ENGINE_INHERIT;
    next[target] = { engineId };
  });
  return next;
}

export function syncFileTargets(
  entry: PendingProjectFile,
  targets: string[],
  opts: {
    allowedProjectTargets: string[];
    defaultAssigneeId: string;
    useSameAssignee: boolean;
    forceAssignee?: boolean;
    sameAssignee?: boolean;
    assigneeAll?: string;
    rulesetAll?: string;
    engineAll?: string;
  }
): PendingProjectFile {
  const normalizedTargets = normalizeTargetList(targets, opts.allowedProjectTargets);
  const sameAssignee = opts.sameAssignee ?? entry.sameAssignee ?? true;
  const assigneeAll = opts.assigneeAll ?? entry.assigneeAll ?? opts.defaultAssigneeId;
  const rulesetAll = opts.rulesetAll ?? entry.rulesetAll ?? RULESET_INHERIT;
  const engineAll = opts.engineAll ?? entry.engineAll ?? ENGINE_INHERIT;
  return {
    ...entry,
    translationTargets: normalizedTargets,
    sameAssignee,
    assigneeAll,
    rulesetAll,
    engineAll,
    assignments: buildAssignments(normalizedTargets, entry.assignments, {
      forceAssignee: opts.forceAssignee,
      sameAssignee,
      defaultAssigneeId: assigneeAll,
      useSameAssignee: opts.useSameAssignee
    }),
    rulesetAssignments: buildRulesetAssignments(normalizedTargets, entry.rulesetAssignments),
    engineAssignments: buildEngineAssignments(normalizedTargets, entry.engineAssignments)
  };
}

export function normalizeOverrideMapKeys(map: Record<string, number | null>) {
  const next: Record<string, number | null> = {};
  Object.entries(map).forEach(([key, value]) => {
    const normalized = normalizeTargetForPayload(key);
    if (!normalized) return;
    next[normalized] = value ?? null;
  });
  return next;
}
