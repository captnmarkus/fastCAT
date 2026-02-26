type TaskProvisionFlagsRow = {
  ruleset_id: number | null;
  glossary_id: number | null;
};

export type ProvisionStepKey = "import" | "tmx" | "llm" | "rules" | "glossary" | "finalize";
type ProvisionStepStatus = "pending" | "running" | "done" | "failed";

export const PROVISION_STEPS: Array<{ key: ProvisionStepKey; code: string; label: string }> = [
  { key: "import", code: "IMPORT_FILES", label: "Import files" },
  { key: "tmx", code: "TMX_SEEDING", label: "TMX seeding" },
  { key: "llm", code: "LLM_SEEDING", label: "LLM seeding" },
  { key: "rules", code: "APPLY_RULES", label: "Apply rules" },
  { key: "glossary", code: "APPLY_GLOSSARY", label: "Apply glossary" },
  { key: "finalize", code: "FINALIZE", label: "Finalize" }
];

export function normalizeTmLangTag(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/_/g, "-").toLowerCase();
  const primary = cleaned.split("-")[0] || cleaned;
  return primary;
}

export function parseOptionalBool(value: any): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return null;
}

export function parseOptionalInt(value: any): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveRulesEnabled(projectSettings: Record<string, any>, tasks: TaskProvisionFlagsRow[]) {
  const flag = parseOptionalBool(projectSettings.rules_enabled ?? projectSettings.rulesEnabled ?? null);
  if (flag != null) return flag;
  const projectRulesetId = parseOptionalInt(
    projectSettings.language_processing_ruleset_id ??
      projectSettings.languageProcessingRulesetId ??
      projectSettings.rulesetId ??
      projectSettings.defaultRulesetId ??
      projectSettings.default_ruleset_id
  );
  return projectRulesetId != null || tasks.some((task) => task.ruleset_id != null);
}

export function resolveTerminologyEnabled(projectSettings: Record<string, any>, tasks: TaskProvisionFlagsRow[]) {
  const termbaseFlag = parseOptionalBool(projectSettings.termbase_enabled ?? projectSettings.termbaseEnabled ?? null);
  const glossaryFlag = parseOptionalBool(projectSettings.glossary_enabled ?? projectSettings.glossaryEnabled ?? null);
  if (termbaseFlag === false || glossaryFlag === false) return false;
  if (termbaseFlag === true || glossaryFlag === true) return true;
  const projectGlossaryId = parseOptionalInt(
    projectSettings.glossary_id ??
      projectSettings.glossaryId ??
      projectSettings.defaultGlossaryId ??
      projectSettings.default_glossary_id ??
      projectSettings.termbaseId ??
      projectSettings.termbase_id
  );
  return projectGlossaryId != null || tasks.some((task) => task.glossary_id != null);
}

export function normalizeProjectSettings(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
    } catch {
      return {};
    }
  }
  return {};
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function toProvisionStepCode(stepKey: ProvisionStepKey): string {
  return PROVISION_STEPS.find((step) => step.key === stepKey)?.code ?? "IMPORT_FILES";
}

export function buildProgress(params: {
  stepKey: ProvisionStepKey;
  stepPercent?: number;
  detail?: Record<string, any> | null;
  statusOverride?: "failed" | "done";
  previous?: any;
  message?: string | null;
  nowIso?: string;
}) {
  const stepIndex = Math.max(0, PROVISION_STEPS.findIndex((step) => step.key === params.stepKey));
  const stepPercent = clampPercent(params.stepPercent ?? 0);
  const totalSteps = PROVISION_STEPS.length;
  const nowIso = params.nowIso || new Date().toISOString();

  const previousSteps = new Map<string, any>();
  const previousStepsRaw = Array.isArray(params.previous?.steps) ? params.previous.steps : [];
  previousStepsRaw.forEach((step: any) => {
    const key = String(step?.key || "").trim();
    if (!key) return;
    previousSteps.set(key, step);
  });

  const steps = PROVISION_STEPS.map((step, idx) => {
    const prev = previousSteps.get(step.code);
    let status: ProvisionStepStatus = "pending";
    if (params.statusOverride === "failed" && idx === stepIndex) {
      status = "failed";
    } else if (idx < stepIndex) {
      status = "done";
    } else if (idx === stepIndex) {
      status = params.statusOverride === "done" ? "done" : "running";
    }

    const percent =
      status === "done"
        ? 100
        : status === "running"
          ? Math.round(stepPercent * 100)
          : status === "failed"
            ? Math.max(0, Math.min(100, Number(prev?.percent ?? Math.round(stepPercent * 100))))
          : 0;

    const isActive = idx === stepIndex;
    const startedAt =
      status === "running" || status === "done" || status === "failed"
        ? String(prev?.startedAt || nowIso)
        : prev?.startedAt ?? null;
    const finishedAt =
      status === "done" || status === "failed"
        ? String(prev?.finishedAt || nowIso)
        : null;
    const updatedAt =
      status === "pending"
        ? prev?.updatedAt ?? null
        : String(nowIso);
    const message =
      isActive && params.message !== undefined
        ? params.message
        : (prev?.message ?? null);

    return {
      key: step.code,
      label: step.label,
      status,
      percent,
      message: message ?? null,
      startedAt,
      updatedAt,
      finishedAt
    };
  });

  const overall =
    params.statusOverride === "done"
      ? 100
      : params.statusOverride === "failed"
        ? Math.round(((stepIndex + stepPercent) / totalSteps) * 100)
        : Math.round(((stepIndex + stepPercent) / totalSteps) * 100);

  return {
    percent: overall,
    step: toProvisionStepCode(params.stepKey),
    stepKey: params.stepKey,
    steps,
    detail: params.detail ?? params.previous?.detail ?? null,
    updatedAt: nowIso,
    message: params.message ?? null
  };
}
