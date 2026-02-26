import { normalizeLocale } from "../../../lib/i18n/locale";
import { parsePositiveInt } from "../../../utils/ids";

export function parseOptionalInt(value: string | number | null | undefined) {
  return parsePositiveInt(value);
}

export function normalizeTargetKey(value: string) {
  return normalizeLocale(String(value || "")).canonical;
}

export function normalizeTargetList(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const key = normalizeTargetKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

export function sanitizeOverrideMap(
  raw: Record<string, number | null>,
  allowedTargets: string[],
  validIds?: Set<number>
) {
  const allowedSet = new Set(allowedTargets);
  const next: Record<string, number | null> = {};
  Object.entries(raw).forEach(([key, value]) => {
    const target = normalizeTargetKey(key);
    if (!target || !allowedSet.has(target)) return;
    if (value == null) {
      next[target] = null;
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (validIds && !validIds.has(parsed)) return;
    next[target] = parsed;
  });
  return next;
}
