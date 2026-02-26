import { normalizeLocale } from "../../lib/i18n/locale";
import type { LanguageEntry, LanguageDefaults } from "./types";

function normalizeDisplayName(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeLanguageEntry(input: Partial<LanguageEntry>): LanguageEntry | null {
  const candidate = String(input.canonical || input.language || "").trim();
  const locale = normalizeLocale(candidate);
  if (!locale.canonical) return null;

  const active = Boolean(input.active);
  const allowedAsSource = input.allowedAsSource ?? (active ? true : false);
  const allowedAsTarget = input.allowedAsTarget ?? (active ? true : false);

  return {
    canonical: locale.canonical,
    language: locale.language,
    region: locale.region,
    displayName: normalizeDisplayName(input.displayName),
    active,
    allowedAsSource: Boolean(allowedAsSource),
    allowedAsTarget: Boolean(allowedAsTarget),
    isDefaultSource: input.isDefaultSource,
    isDefaultTarget: input.isDefaultTarget
  };
}

export function mergeLanguageEntries(entries: Array<Partial<LanguageEntry>>): LanguageEntry[] {
  const map = new Map<string, LanguageEntry>();
  entries.forEach((raw) => {
    const normalized = normalizeLanguageEntry(raw);
    if (!normalized) return;
    const existing = map.get(normalized.canonical);
    if (!existing) {
      map.set(normalized.canonical, normalized);
      return;
    }
    map.set(normalized.canonical, {
      ...existing,
      active: existing.active || normalized.active,
      allowedAsSource: existing.allowedAsSource || normalized.allowedAsSource,
      allowedAsTarget: existing.allowedAsTarget || normalized.allowedAsTarget,
      displayName: existing.displayName || normalized.displayName,
      isDefaultSource: existing.isDefaultSource || normalized.isDefaultSource,
      isDefaultTarget: existing.isDefaultTarget || normalized.isDefaultTarget
    });
  });
  return Array.from(map.values());
}

export function normalizeDefaults(input: LanguageDefaults | undefined): LanguageDefaults {
  if (!input) return {};
  const defaultSource = normalizeLocale(String(input.defaultSource || "")).canonical || "";
  const defaultTargets = Array.isArray(input.defaultTargets)
    ? Array.from(
        new Set(
          input.defaultTargets
            .map((value) => normalizeLocale(String(value || "")).canonical)
            .filter(Boolean)
        )
      )
    : [];
  return {
    defaultSource: defaultSource || undefined,
    defaultTargets
  };
}

export function formatLanguageEntryLabel(entry: LanguageEntry): string {
  if (entry.displayName) {
    const sanitized = entry.displayName.replace(/\s*\([^)]*\)/g, "").trim();
    if (sanitized) return sanitized;
  }
  const locale = normalizeLocale(entry.canonical || entry.language || "");
  const baseTag = locale.language || entry.canonical;
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    const name = display.of(baseTag);
    if (name) return name;
  } catch {
    // ignore
  }
  return baseTag || entry.canonical;
}

export function languageFlagTag(entry: LanguageEntry): string | undefined {
  return entry.region ? entry.region.toLowerCase() : undefined;
}
