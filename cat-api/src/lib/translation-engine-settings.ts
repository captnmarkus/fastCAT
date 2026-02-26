import { normalizeLanguageTag } from "./language-catalog.js";

export type EngineSettingValue = number | null;
export type EngineDefaultsByTarget = Record<string, EngineSettingValue>;
export type EngineOverridesByFile = Record<string, Record<string, EngineSettingValue>>;

function normalizeTargetKey(value: string) {
  const normalized = normalizeLanguageTag(String(value ?? "").trim());
  return normalized ? normalized.toLowerCase() : "";
}

function parseEngineSettingValue(input: any): EngineSettingValue | undefined {
  if (input == null) return null;
  if (typeof input === "string") {
    const raw = input.trim().toLowerCase();
    if (!raw) return null;
    if (raw === "inherit" || raw === "__inherit__") return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return undefined;
    return input;
  }
  if (typeof input === "boolean") return undefined;
  return undefined;
}

export function normalizeEngineDefaultsByTarget(
  raw: any,
  allowedTargets?: Set<string>
): EngineDefaultsByTarget {
  const out: EngineDefaultsByTarget = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.entries(raw).forEach(([key, value]) => {
    const normalized = normalizeTargetKey(String(key || ""));
    if (!normalized) return;
    if (allowedTargets && !allowedTargets.has(normalized)) return;
    const parsed = parseEngineSettingValue(value);
    if (parsed === undefined) return;
    out[normalized] = parsed;
  });
  return out;
}

export function normalizeEngineOverrides(
  raw: any,
  allowedTargets?: Set<string>
): EngineOverridesByFile {
  const out: EngineOverridesByFile = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.entries(raw).forEach(([fileKey, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const targetMap: Record<string, EngineSettingValue> = {};
    Object.entries(value as Record<string, any>).forEach(([targetKey, engineValue]) => {
      const normalized = normalizeTargetKey(String(targetKey || ""));
      if (!normalized) return;
      if (allowedTargets && !allowedTargets.has(normalized)) return;
      const parsed = parseEngineSettingValue(engineValue);
      if (parsed === undefined) return;
      targetMap[normalized] = parsed;
    });
    if (Object.keys(targetMap).length > 0) {
      out[String(fileKey)] = targetMap;
    }
  });
  return out;
}

export function resolveEngineSelection(params: {
  projectDefaultId: number | null;
  defaultsByTarget?: EngineDefaultsByTarget;
  overridesByFile?: EngineOverridesByFile;
  fileId?: number | string | null;
  targetLang: string;
}): number | null {
  const targetKey = normalizeTargetKey(params.targetLang);
  if (!targetKey) return params.projectDefaultId ?? null;
  const fileKey = params.fileId != null ? String(params.fileId) : "";
  const overrides = params.overridesByFile?.[fileKey];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, targetKey)) {
    return overrides[targetKey] ?? null;
  }
  const defaults = params.defaultsByTarget;
  if (defaults && Object.prototype.hasOwnProperty.call(defaults, targetKey)) {
    return defaults[targetKey] ?? null;
  }
  return params.projectDefaultId ?? null;
}
