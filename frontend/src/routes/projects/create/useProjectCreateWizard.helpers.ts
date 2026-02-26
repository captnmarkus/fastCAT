export type PersistedCreateState = {
  projectTemplateId: string;
  departmentId: string;
  projectOwnerId: string;
  dueDate: string;
  dueTime: string;
  srcLang: string;
  targetLangs: string[];
  glossaryId: string;
  tmxEnabled: boolean;
  rulesEnabled: boolean;
  termbaseEnabled: boolean;
  glossaryEnabled: boolean;
  defaultTmxId: number | null;
  tmxByTargetLang: Record<string, number | null>;
  rulesetByTargetLang: Record<string, number | null>;
  glossaryByTargetLang: Record<string, number | null>;
  translationEngineByTargetLang: Record<string, number | null>;
  legacyTmSample?: string;
  legacyTmxSelections?: Record<string, string>;
  translationEngineId: string;
  rulesetId: string;
  defaultAssigneeId: string;
  useSameAssignee: boolean;
  planMode: "simple" | "advanced";
  mtSeedingEnabled?: boolean;
};

export const DEFAULT_CREATE_STATE: PersistedCreateState = {
  projectTemplateId: "",
  departmentId: "",
  projectOwnerId: "",
  dueDate: "",
  dueTime: "",
  srcLang: "",
  targetLangs: [],
  glossaryId: "",
  tmxEnabled: false,
  rulesEnabled: false,
  termbaseEnabled: false,
  glossaryEnabled: false,
  defaultTmxId: null,
  tmxByTargetLang: {},
  rulesetByTargetLang: {},
  glossaryByTargetLang: {},
  translationEngineByTargetLang: {},
  translationEngineId: "",
  rulesetId: "",
  defaultAssigneeId: "",
  useSameAssignee: true,
  planMode: "simple",
  mtSeedingEnabled: false
};

function toPositiveIntOrNull(value: unknown): number | null {
  const parsed = value != null && String(value).trim() !== "" ? Number(value) : null;
  if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeIdMap(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [String(key), toPositiveIntOrNull(item)])
  );
}

export function parsePersistedCreateState(raw: string | null): PersistedCreateState {
  if (!raw) return DEFAULT_CREATE_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedCreateState> & {
      tgtLang?: string;
      assignedUserId?: string;
      defaultTranslatorId?: string;
      useSameTranslator?: boolean;
      tmxSelections?: unknown;
      tmSample?: unknown;
      default_tmx_id?: unknown;
      tmx_by_target_lang?: unknown;
      ruleset_by_target_lang?: unknown;
      glossary_by_target_lang?: unknown;
      termBaseByTargetLang?: unknown;
      termbaseByTargetLang?: unknown;
      translation_engine_by_target_lang?: unknown;
      translationEngineDefaultsByTarget?: unknown;
      translation_engine_defaults_by_target?: unknown;
      rules_enabled?: unknown;
      termbase_enabled?: unknown;
      glossary_enabled?: unknown;
      mt_seeding_enabled?: unknown;
      translationEngineSeedingEnabled?: unknown;
    };

    const legacyTarget =
      typeof parsed.tgtLang === "string" && parsed.tgtLang.trim()
        ? [parsed.tgtLang.trim()]
        : [];

    const legacyTmSample = typeof parsed.tmSample === "string" ? String(parsed.tmSample).trim() : "";
    const legacyTmxSelections =
      parsed.tmxSelections && typeof parsed.tmxSelections === "object" && !Array.isArray(parsed.tmxSelections)
        ? Object.fromEntries(
            Object.entries(parsed.tmxSelections as Record<string, unknown>).filter(
              ([key, value]) => typeof key === "string" && typeof value === "string"
            )
          )
        : {};

    const defaultTmxIdRaw = parsed.defaultTmxId ?? parsed.default_tmx_id ?? null;
    const defaultTmxId = toPositiveIntOrNull(defaultTmxIdRaw);

    const tmxByTargetLang =
      normalizeIdMap(parsed.tmxByTargetLang ?? parsed.tmx_by_target_lang ?? null) ||
      DEFAULT_CREATE_STATE.tmxByTargetLang;

    const rulesetByTargetLang =
      normalizeIdMap(parsed.rulesetByTargetLang ?? parsed.ruleset_by_target_lang ?? null) ||
      DEFAULT_CREATE_STATE.rulesetByTargetLang;

    const glossaryByTargetLang =
      normalizeIdMap(
        parsed.glossaryByTargetLang ??
          parsed.glossary_by_target_lang ??
          parsed.termBaseByTargetLang ??
          parsed.termbaseByTargetLang ??
          null
      ) || DEFAULT_CREATE_STATE.glossaryByTargetLang;

    const translationEngineByTargetLang =
      normalizeIdMap(
        parsed.translationEngineByTargetLang ??
          parsed.translation_engine_by_target_lang ??
          parsed.translationEngineDefaultsByTarget ??
          parsed.translation_engine_defaults_by_target ??
          null
      ) || DEFAULT_CREATE_STATE.translationEngineByTargetLang;

    const legacyHasTmx =
      Boolean(legacyTmSample) || Object.keys(legacyTmxSelections).length > 0;

    const glossaryId =
      typeof parsed.glossaryId === "string" ? parsed.glossaryId : DEFAULT_CREATE_STATE.glossaryId;
    const rulesetId = typeof parsed.rulesetId === "string" ? parsed.rulesetId : DEFAULT_CREATE_STATE.rulesetId;

    const hasRulesSelection =
      String(rulesetId || "").trim() !== "" || Object.keys(rulesetByTargetLang).length > 0;
    const hasGlossarySelection =
      String(glossaryId || "").trim() !== "" || Object.keys(glossaryByTargetLang).length > 0;

    const rulesEnabledRaw = parsed.rulesEnabled ?? parsed.rules_enabled ?? null;
    const termbaseEnabledRaw = parsed.termbaseEnabled ?? parsed.termbase_enabled ?? null;
    const glossaryEnabledRaw = parsed.glossaryEnabled ?? parsed.glossary_enabled ?? null;

    const rulesEnabled = typeof rulesEnabledRaw === "boolean" ? rulesEnabledRaw : hasRulesSelection;
    const termbaseEnabled =
      typeof termbaseEnabledRaw === "boolean"
        ? termbaseEnabledRaw
        : typeof glossaryEnabledRaw === "boolean"
          ? glossaryEnabledRaw
          : hasGlossarySelection;
    const glossaryEnabled =
      typeof glossaryEnabledRaw === "boolean"
        ? glossaryEnabledRaw
        : typeof termbaseEnabledRaw === "boolean"
          ? termbaseEnabledRaw
          : hasGlossarySelection;

    return {
      projectTemplateId:
        typeof parsed.projectTemplateId === "string" ? parsed.projectTemplateId : DEFAULT_CREATE_STATE.projectTemplateId,
      departmentId: typeof parsed.departmentId === "string" ? parsed.departmentId : DEFAULT_CREATE_STATE.departmentId,
      projectOwnerId:
        typeof parsed.projectOwnerId === "string" ? parsed.projectOwnerId : DEFAULT_CREATE_STATE.projectOwnerId,
      dueDate: typeof parsed.dueDate === "string" ? parsed.dueDate : DEFAULT_CREATE_STATE.dueDate,
      dueTime: typeof parsed.dueTime === "string" ? parsed.dueTime : DEFAULT_CREATE_STATE.dueTime,
      srcLang: typeof parsed.srcLang === "string" ? parsed.srcLang : DEFAULT_CREATE_STATE.srcLang,
      targetLangs: Array.isArray(parsed.targetLangs)
        ? parsed.targetLangs.filter((value): value is string => typeof value === "string")
        : legacyTarget,
      glossaryId,
      tmxEnabled:
        typeof parsed.tmxEnabled === "boolean"
          ? parsed.tmxEnabled
          : defaultTmxId != null || Object.keys(tmxByTargetLang).length > 0 || legacyHasTmx,
      rulesEnabled,
      termbaseEnabled,
      glossaryEnabled,
      defaultTmxId,
      tmxByTargetLang,
      rulesetByTargetLang,
      glossaryByTargetLang,
      translationEngineByTargetLang,
      legacyTmSample: legacyTmSample || undefined,
      legacyTmxSelections: Object.keys(legacyTmxSelections).length > 0 ? legacyTmxSelections : undefined,
      translationEngineId:
        typeof parsed.translationEngineId === "string"
          ? parsed.translationEngineId
          : DEFAULT_CREATE_STATE.translationEngineId,
      rulesetId,
      defaultAssigneeId:
        typeof parsed.defaultAssigneeId === "string"
          ? parsed.defaultAssigneeId
          : typeof parsed.defaultTranslatorId === "string"
            ? parsed.defaultTranslatorId
            : typeof parsed.assignedUserId === "string"
              ? parsed.assignedUserId
              : DEFAULT_CREATE_STATE.defaultAssigneeId,
      useSameAssignee:
        typeof parsed.useSameAssignee === "boolean"
          ? parsed.useSameAssignee
          : typeof parsed.useSameTranslator === "boolean"
            ? parsed.useSameTranslator
            : DEFAULT_CREATE_STATE.useSameAssignee,
      planMode:
        parsed.planMode === "advanced" || parsed.planMode === "simple"
          ? parsed.planMode
          : DEFAULT_CREATE_STATE.planMode,
      mtSeedingEnabled:
        typeof parsed.mtSeedingEnabled === "boolean"
          ? parsed.mtSeedingEnabled
          : typeof parsed.mt_seeding_enabled === "boolean"
            ? parsed.mt_seeding_enabled
            : typeof parsed.translationEngineSeedingEnabled === "boolean"
              ? parsed.translationEngineSeedingEnabled
              : DEFAULT_CREATE_STATE.mtSeedingEnabled
    };
  } catch {
    return DEFAULT_CREATE_STATE;
  }
}

export type UploadFileType = "html" | "xml" | "pdf" | "docx" | "pptx" | "xlsx" | "other";

export function detectUploadFileType(candidate: File): UploadFileType {
  const name = String(candidate?.name || "").toLowerCase();
  if (name.endsWith(".xlf") || name.endsWith(".xliff") || name.endsWith(".xml")) return "xml";
  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".xhtml") || name.endsWith(".xtml")) {
    return "html";
  }
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".doc") || name.endsWith(".docx")) return "docx";
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return "xlsx";
  return "other";
}

export function fileFingerprint(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
