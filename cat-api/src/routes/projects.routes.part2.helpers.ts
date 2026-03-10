import { resolveEngineSelection } from "../lib/translation-engine-settings.js";
import type { SegmentSourceType } from "./projects.helpers.js";

type ParseOptionalInt = (value: any) => number | null;
type NormalizeLang = (value: any) => string;
type NormalizeLangList = (value: any) => string[];
type NormalizeJsonObject = (value: any) => Record<string, any>;

const TRANSLATOR_ASSIGNMENT_KEYS = [
  "translatorUserId",
  "assigneeId",
  "assigneeUserId",
  "assignee_user_id",
  "assignee",
  "translator",
  "translatorUser",
  "translatorId"
] as const;

const REVIEWER_ASSIGNMENT_KEYS = [
  "reviewerUserId",
  "reviewer",
  "reviewerUser",
  "reviewerId"
] as const;

const TMX_ASSIGNMENT_KEYS = [
  "tmxId",
  "tmx_id",
  "tmSampleTmId",
  "tm_sample_tm_id",
  "tmId",
  "tm_id"
] as const;

const ENGINE_ASSIGNMENT_KEYS = [
  "engineId",
  "engine_id",
  "translationEngineId",
  "translation_engine_id"
] as const;

const RULESET_ASSIGNMENT_KEYS = [
  "rulesetId",
  "ruleSetId",
  "ruleset_id",
  "languageProcessingRulesetId",
  "language_processing_ruleset_id"
] as const;

const GLOSSARY_ASSIGNMENT_KEYS = [
  "glossaryId",
  "glossary_id",
  "termbaseId",
  "termbase_id",
  "termBaseId",
  "term_base_id"
] as const;

export const RULESET_SELECTION_KEYS = [...RULESET_ASSIGNMENT_KEYS];
export const GLOSSARY_SELECTION_KEYS = [...GLOSSARY_ASSIGNMENT_KEYS];

type AssignmentRecord = Record<string, any>;

function hasOwn(record: AssignmentRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pickByPresence(
  assignment: AssignmentRecord,
  keys: readonly string[]
): { hasKey: boolean; value: any } {
  for (const key of keys) {
    if (!hasOwn(assignment, key)) continue;
    return { hasKey: true, value: assignment[key] };
  }
  return { hasKey: false, value: undefined };
}

function pickFirstValue(assignment: AssignmentRecord, keys: readonly string[]): any {
  for (const key of keys) {
    const value = assignment[key];
    if (value != null) return value;
  }
  return null;
}

export type TranslationPlanEntry = {
  fileId: number | null;
  tempKey: string;
  targetLangs: string[];
  assignments: Record<string, any>;
};

export type TranslationTaskDraft = {
  fileId: number;
  targetLang: string;
  translator: string;
  reviewer: string | null;
  tmxId: number | null;
  seedSource: SegmentSourceType;
  engineId: number | null;
  rulesetId: number | null;
  glossaryId: number | null;
};

export function hasAssignmentSelection(
  assignment: any,
  keys: readonly string[],
  parseOptionalInt: ParseOptionalInt
): boolean {
  if (!assignment || typeof assignment !== "object") return false;
  const record = assignment as AssignmentRecord;
  for (const key of keys) {
    if (!hasOwn(record, key)) continue;
    const raw = record[key];
    if (raw == null || String(raw).trim() === "") return false;
    return parseOptionalInt(raw) != null;
  }
  return false;
}

export function hasSelectionInPlan(
  translationPlanRaw: any[],
  keys: readonly string[],
  normalizeJsonObject: NormalizeJsonObject,
  parseOptionalInt: ParseOptionalInt
): boolean {
  if (!translationPlanRaw.length) return false;
  return translationPlanRaw.some((entry: any) => {
    const assignments = normalizeJsonObject(entry?.assignments ?? entry?.assignmentMap ?? {});
    return Object.values(assignments).some((assignment) =>
      hasAssignmentSelection(assignment, keys, parseOptionalInt)
    );
  });
}

export function hasNumericOverrideValues(raw: any, parseOptionalInt: ParseOptionalInt): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.values(raw).some((value) => parseOptionalInt(value) != null);
}

export function parseOptionalNumericOverride(value: any): { value: number | null; invalid: boolean } {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { value: null, invalid: false };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { value: null, invalid: true };
  }
  return { value: parsed, invalid: false };
}

export function normalizeTranslationPlan(
  translationPlanRaw: any[],
  parseOptionalInt: ParseOptionalInt,
  normalizeLang: NormalizeLang,
  normalizeLangList: NormalizeLangList,
  normalizeJsonObject: NormalizeJsonObject
): TranslationPlanEntry[] {
  return translationPlanRaw.map((entry: any) => {
    const rawAssignments = normalizeJsonObject(entry?.assignments ?? entry?.assignmentMap ?? {});
    const assignments = Object.entries(rawAssignments).reduce<Record<string, any>>((acc, [targetLang, assignment]) => {
      const normalizedTargetLang = normalizeLang(targetLang);
      if (!normalizedTargetLang) return acc;
      acc[normalizedTargetLang] = normalizeJsonObject(assignment);
      return acc;
    }, {});
    return {
      fileId: parseOptionalInt(entry?.fileId ?? entry?.file_id),
      tempKey: String(entry?.tempKey ?? entry?.temp_key ?? "").trim(),
      targetLangs: normalizeLangList(entry?.targetLangs ?? entry?.target_langs ?? entry?.targets),
      assignments
    };
  });
}

export function normalizeTemplateOverrideMap(
  raw: any,
  projectTargetLangs: readonly string[],
  normalizeLang: NormalizeLang,
  parseOptionalInt: ParseOptionalInt
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const targetSet = new Set(projectTargetLangs);
  Object.entries(raw).forEach(([key, value]) => {
    const lang = normalizeLang(key);
    if (!lang || !targetSet.has(lang)) return;
    if (value === null || String(value).trim() === "") {
      out.set(lang, null);
      return;
    }
    const parsed = parseOptionalInt(value);
    if (parsed != null) out.set(lang, parsed);
  });
  return out;
}

export function collectEngineIdsToValidate(
  effectiveTranslationEngineId: number | null,
  engineDefaultsByTarget: Record<string, number | null>,
  engineOverridesRawMap: Record<string, Record<string, number | null>>
): Set<number> {
  const engineIds = new Set<number>();
  if (effectiveTranslationEngineId != null) engineIds.add(effectiveTranslationEngineId);
  Object.values(engineDefaultsByTarget).forEach((value) => {
    if (value != null) engineIds.add(Number(value));
  });
  Object.values(engineOverridesRawMap).forEach((targetMap) => {
    Object.values(targetMap).forEach((value) => {
      if (value != null) engineIds.add(Number(value));
    });
  });
  return engineIds;
}

export function mapEngineOverridesToFileIds(
  engineOverridesRawMap: Record<string, Record<string, number | null>>,
  fileMap: Map<string, number>,
  parseOptionalInt: ParseOptionalInt
): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {};
  Object.entries(engineOverridesRawMap).forEach(([fileKey, targetMap]) => {
    const mappedFileId = parseOptionalInt(fileKey) ?? fileMap.get(fileKey) ?? null;
    if (!mappedFileId) return;
    out[String(mappedFileId)] = targetMap;
  });
  return out;
}

type BuildTranslationTasksArgs = {
  translationPlan: TranslationPlanEntry[];
  fileMap: Map<string, number>;
  projectTargetLangs: string[];
  srcLang: string;
  departmentId: number;
  creatorId: string;
  canAssign: boolean;
  requesterIsAdmin: boolean;
  requesterMatchesUser: (assigned: string | null) => Promise<boolean>;
  resolveUserRef: (value: unknown) => Promise<string | null>;
  resolveUserDepartmentId: (username: string) => Promise<number | null>;
  resolveUserRole: (username: string) => Promise<string | null>;
  resolveEngineMeta: (engineId: number) => Promise<{ disabled: boolean } | null>;
  resolveRulesetMeta: (rulesetId: number) => Promise<{ disabled: boolean } | null>;
  resolveGlossaryMeta: (glossaryId: number) => Promise<{ disabled: boolean } | null>;
  makeRequestError: (status: number, message: string) => Error;
  normalizeLang: NormalizeLang;
  normalizeLangList: NormalizeLangList;
  normalizeJsonObject: NormalizeJsonObject;
  parseOptionalInt: ParseOptionalInt;
  effectiveTranslationEngineId: number | null;
  engineDefaultsByTarget: Record<string, number | null>;
  engineOverridesByFileId: Record<string, Record<string, number | null>>;
  resolvedRulesEnabled: boolean;
  terminologyEnabled: boolean;
  rulesetId: number | null;
  projectGlossaryOverride: number | null;
  templateTmxByTarget: Map<string, number | null>;
  templateRulesetByTarget: Map<string, number | null>;
  templateGlossaryByTarget: Map<string, number | null>;
  templateDefaultTmxId: number | null;
  templateDefaultRulesetId: number | null;
  templateDefaultGlossaryId: number | null;
};

export async function buildTranslationTasks(args: BuildTranslationTasksArgs): Promise<TranslationTaskDraft[]> {
  const {
    translationPlan,
    fileMap,
    projectTargetLangs,
    srcLang,
    departmentId,
    creatorId,
    canAssign,
    requesterIsAdmin,
    requesterMatchesUser,
    resolveUserRef,
    resolveUserDepartmentId,
    resolveUserRole,
    resolveEngineMeta,
    resolveRulesetMeta,
    resolveGlossaryMeta,
    makeRequestError,
    normalizeLang,
    normalizeLangList,
    normalizeJsonObject,
    parseOptionalInt,
    effectiveTranslationEngineId,
    engineDefaultsByTarget,
    engineOverridesByFileId,
    resolvedRulesEnabled,
    terminologyEnabled,
    rulesetId,
    projectGlossaryOverride,
    templateTmxByTarget,
    templateRulesetByTarget,
    templateGlossaryByTarget,
    templateDefaultTmxId,
    templateDefaultRulesetId,
    templateDefaultGlossaryId
  } = args;

  const resolvedUserCache = new Map<string, string>();
  const departmentCache = new Map<string, number | null>();
  const roleCache = new Map<string, string | null>();
  const engineCache = new Map<number, { disabled: boolean } | null>();
  const rulesetCache = new Map<number, { disabled: boolean } | null>();
  const glossaryCache = new Map<number, { disabled: boolean } | null>();
  const taskKeys = new Set<string>();
  const tasks: TranslationTaskDraft[] = [];

  const resolveUserCached = async (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (resolvedUserCache.has(raw)) return resolvedUserCache.get(raw) ?? null;
    const resolved = await resolveUserRef(raw);
    if (resolved) resolvedUserCache.set(raw, resolved);
    return resolved;
  };

  const resolveDepartmentCached = async (username: string) => {
    if (departmentCache.has(username)) return departmentCache.get(username) ?? null;
    const dept = await resolveUserDepartmentId(username);
    departmentCache.set(username, dept);
    return dept;
  };

  const resolveRoleCached = async (username: string) => {
    if (roleCache.has(username)) return roleCache.get(username) ?? null;
    const role = await resolveUserRole(username);
    roleCache.set(username, role);
    return role;
  };

  const resolveEngineCached = async (engineId: number) => {
    if (engineCache.has(engineId)) return engineCache.get(engineId) ?? null;
    const row = await resolveEngineMeta(engineId);
    engineCache.set(engineId, row);
    return row;
  };

  const resolveRulesetCached = async (rulesetIdValue: number) => {
    if (rulesetCache.has(rulesetIdValue)) return rulesetCache.get(rulesetIdValue) ?? null;
    const row = await resolveRulesetMeta(rulesetIdValue);
    rulesetCache.set(rulesetIdValue, row);
    return row;
  };

  const resolveGlossaryCached = async (glossaryIdValue: number) => {
    if (glossaryCache.has(glossaryIdValue)) return glossaryCache.get(glossaryIdValue) ?? null;
    const row = await resolveGlossaryMeta(glossaryIdValue);
    glossaryCache.set(glossaryIdValue, row);
    return row;
  };

  for (const plan of translationPlan) {
    const resolvedFileId = plan.fileId ?? (plan.tempKey ? fileMap.get(plan.tempKey) : null);
    if (!resolvedFileId) {
      throw makeRequestError(400, "translationPlan fileId/tempKey not found");
    }

    const planTargets = plan.targetLangs.length > 0 ? plan.targetLangs : projectTargetLangs;
    const normalizedTargets = normalizeLangList(planTargets).filter((lang) => lang !== srcLang);
    if (normalizedTargets.length === 0) {
      throw makeRequestError(400, "translationPlan targetLangs are required");
    }
    const invalidTargets = normalizedTargets.filter((lang) => !projectTargetLangs.includes(lang));
    if (invalidTargets.length > 0) {
      throw makeRequestError(400, "translationPlan targetLangs must be within project targets");
    }

    for (const targetLang of normalizedTargets) {
      const assignment = normalizeJsonObject(
        plan.assignments[targetLang] ?? plan.assignments[normalizeLang(targetLang)]
      );

      const translatorRaw = pickFirstValue(assignment, TRANSLATOR_ASSIGNMENT_KEYS);
      if (!translatorRaw) {
        throw makeRequestError(400, "Translator is required for every task");
      }
      const translator = await resolveUserCached(translatorRaw);
      if (!translator) {
        throw makeRequestError(400, "Invalid translator assignment");
      }
      const translatorRole = await resolveRoleCached(translator);
      const translatorIsSelfAdmin =
        translatorRole === "admin" &&
        requesterIsAdmin &&
        (await requesterMatchesUser(translator));
      if (translatorRole !== "reviewer" && translatorRole !== "manager" && !translatorIsSelfAdmin) {
        throw makeRequestError(400, "Assignee must be a reviewer or manager");
      }
      if (!canAssign && translator !== creatorId) {
        throw makeRequestError(403, "Manager privileges required to assign users");
      }
      if (!translatorIsSelfAdmin) {
        const translatorDept = await resolveDepartmentCached(translator);
        if (translatorDept == null || translatorDept !== departmentId) {
          throw makeRequestError(403, "Assigned user must belong to the project department");
        }
      }

      const reviewerRaw = pickFirstValue(assignment, REVIEWER_ASSIGNMENT_KEYS);
      let reviewer: string | null = null;
      if (reviewerRaw) {
        const resolvedReviewer = await resolveUserCached(reviewerRaw);
        if (!resolvedReviewer) {
          throw makeRequestError(400, "Invalid reviewer assignment");
        }
        if (!canAssign && resolvedReviewer !== creatorId) {
          throw makeRequestError(403, "Manager privileges required to assign users");
        }
        const reviewerDept = await resolveDepartmentCached(resolvedReviewer);
        if (reviewerDept == null || reviewerDept !== departmentId) {
          throw makeRequestError(403, "Assigned user must belong to the project department");
        }
        reviewer = resolvedReviewer;
      }

      const { hasKey: hasTmxKey, value: tmxIdRaw } = pickByPresence(assignment, TMX_ASSIGNMENT_KEYS);
      const tmxIdParsed = tmxIdRaw != null && String(tmxIdRaw).trim() !== "" ? parseOptionalInt(tmxIdRaw) : null;
      if (tmxIdRaw != null && tmxIdParsed == null) {
        throw makeRequestError(400, "Invalid TMX selection");
      }
      let tmxId: number | null = null;
      if (hasTmxKey) {
        tmxId = tmxIdParsed;
      } else if (templateTmxByTarget.has(targetLang)) {
        tmxId = templateTmxByTarget.get(targetLang) ?? null;
      } else if (templateDefaultTmxId != null) {
        tmxId = templateDefaultTmxId;
      }

      const { hasKey: hasEngineKey, value: engineIdRaw } = pickByPresence(assignment, ENGINE_ASSIGNMENT_KEYS);
      const engineIdParsed = engineIdRaw != null && String(engineIdRaw).trim() !== "" ? parseOptionalInt(engineIdRaw) : null;
      if (engineIdRaw != null && engineIdParsed == null) {
        throw makeRequestError(400, "Invalid translation engine");
      }
      let engineId: number | null = null;
      if (hasEngineKey) {
        engineId = engineIdParsed;
      } else {
        engineId = resolveEngineSelection({
          projectDefaultId: effectiveTranslationEngineId ?? null,
          defaultsByTarget: engineDefaultsByTarget,
          overridesByFile: engineOverridesByFileId,
          fileId: resolvedFileId,
          targetLang
        });
      }
      if (engineId != null) {
        const engineRow = await resolveEngineCached(engineId);
        if (!engineRow) {
          throw makeRequestError(400, "Selected translation engine not found.");
        }
        if (engineRow.disabled) {
          throw makeRequestError(400, "Selected translation engine is disabled.");
        }
      }

      let effectiveRulesetId: number | null = null;
      if (resolvedRulesEnabled) {
        const { hasKey: hasRulesetKey, value: rulesetIdRaw } = pickByPresence(assignment, RULESET_ASSIGNMENT_KEYS);
        const rulesetIdParsed =
          rulesetIdRaw != null && String(rulesetIdRaw).trim() !== "" ? parseOptionalInt(rulesetIdRaw) : null;
        if (rulesetIdRaw != null && rulesetIdParsed == null) {
          throw makeRequestError(400, "Invalid ruleset selection");
        }
        if (hasRulesetKey) {
          effectiveRulesetId = rulesetIdParsed;
        } else if (rulesetId != null) {
          effectiveRulesetId = rulesetId;
        } else if (templateRulesetByTarget.has(targetLang)) {
          effectiveRulesetId = templateRulesetByTarget.get(targetLang) ?? null;
        } else if (templateDefaultRulesetId != null) {
          effectiveRulesetId = templateDefaultRulesetId;
        }
        if (effectiveRulesetId != null) {
          const rulesetRow = await resolveRulesetCached(effectiveRulesetId);
          if (!rulesetRow) {
            throw makeRequestError(400, "Selected ruleset not found.");
          }
          if (rulesetRow.disabled) {
            throw makeRequestError(400, "Selected ruleset is disabled.");
          }
        }
      }

      const { hasKey: hasGlossaryKey, value: glossaryIdRaw } = pickByPresence(assignment, GLOSSARY_ASSIGNMENT_KEYS);
      const glossaryIdParsed =
        glossaryIdRaw != null && String(glossaryIdRaw).trim() !== "" ? parseOptionalInt(glossaryIdRaw) : null;
      if (terminologyEnabled && glossaryIdRaw != null && glossaryIdParsed == null) {
        throw makeRequestError(400, "Invalid termbase selection");
      }
      let effectiveGlossaryId: number | null = null;
      if (terminologyEnabled) {
        if (hasGlossaryKey) {
          effectiveGlossaryId = glossaryIdParsed;
        } else if (projectGlossaryOverride != null) {
          effectiveGlossaryId = projectGlossaryOverride;
        } else if (templateGlossaryByTarget.has(targetLang)) {
          effectiveGlossaryId = templateGlossaryByTarget.get(targetLang) ?? null;
        } else if (templateDefaultGlossaryId != null) {
          effectiveGlossaryId = templateDefaultGlossaryId;
        }
        if (effectiveGlossaryId != null) {
          const glossaryRow = await resolveGlossaryCached(effectiveGlossaryId);
          if (!glossaryRow) {
            throw makeRequestError(400, "Selected termbase not found.");
          }
          if (glossaryRow.disabled) {
            throw makeRequestError(400, "Selected termbase is disabled.");
          }
        }
      }

      const seedSource: SegmentSourceType = tmxId != null ? "tmx" : engineId != null ? "nmt" : "none";
      const key = `${resolvedFileId}:${targetLang}`;
      if (taskKeys.has(key)) {
        throw makeRequestError(400, "Duplicate translation task detected");
      }
      taskKeys.add(key);
      tasks.push({
        fileId: resolvedFileId,
        targetLang,
        translator,
        reviewer,
        tmxId,
        seedSource,
        engineId,
        rulesetId: effectiveRulesetId ?? null,
        glossaryId: effectiveGlossaryId ?? null
      });
    }
  }

  return tasks;
}
