import { getCatalogByTag, normalizeLanguageTag, primarySubtag } from "./language-catalog.js";

const CATALOG_BY_TAG = getCatalogByTag();

export function formatLanguageNameForPrompt(input: string): string {
  const normalized = normalizeLanguageTag(String(input ?? ""));
  if (!normalized) return "";

  const primary = primarySubtag(normalized);
  const baseEntry = primary ? CATALOG_BY_TAG.get(primary) : undefined;
  if (baseEntry?.englishName) return baseEntry.englishName;

  const exactEntry = CATALOG_BY_TAG.get(normalized);
  if (exactEntry?.englishName) {
    return exactEntry.englishName.replace(/\s*\([^)]*\)\s*$/, "").trim() || exactEntry.englishName;
  }

  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    const fallback = display.of(primary || normalized);
    if (fallback) return fallback;
  } catch {
    // Ignore environment-specific Intl availability.
  }

  return normalized.replace(/[-_]+/g, " ").trim();
}
