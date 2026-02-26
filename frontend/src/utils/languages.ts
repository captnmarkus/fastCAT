import type { LanguageCatalogEntry } from "../api";

const FALLBACK_FLAG_BY_PRIMARY: Record<string, string> = {
  de: "DE",
  en: "GB",
  fr: "FR",
  it: "IT",
  es: "ES",
  pt: "PT",
  nl: "NL",
  sv: "SE",
  no: "NO",
  da: "DK",
  fi: "FI",
  pl: "PL",
  cs: "CZ",
  sk: "SK",
  sl: "SI",
  hu: "HU",
  ro: "RO",
  bg: "BG",
  el: "GR",
  ru: "RU",
  uk: "UA",
  hr: "HR",
  sh: "RS",
  sr: "RS",
  bs: "BA",
  et: "EE",
  lv: "LV",
  lt: "LT",
  ga: "IE",
  is: "IS",
  mt: "MT",
  sq: "AL",
  mk: "MK",
  tr: "TR",
  ja: "JP",
  zh: "CN",
  ko: "KR",
  hi: "IN",
  bn: "BD",
  ta: "IN",
  mr: "IN"
};

export function canonicalizeLanguageTag(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/_/g, "-").trim();
  if (!cleaned) return "";
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      if (/^\d{3}$/.test(part) || part.length === 2) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

export function primarySubtag(tag: string): string {
  const normalized = canonicalizeLanguageTag(tag);
  return normalized.split("-")[0] || "";
}

export function buildCatalogByTag(catalog: LanguageCatalogEntry[]): Map<string, LanguageCatalogEntry> {
  const map = new Map<string, LanguageCatalogEntry>();
  catalog.forEach((entry) => {
    map.set(entry.tag, entry);
  });
  return map;
}

export function formatLanguageLabel(entry: LanguageCatalogEntry): string {
  const english = String(entry.englishName || entry.tag).trim();
  const native = String(entry.nativeName || "").trim();
  if (!native || native.toLowerCase() === english.toLowerCase()) return english;
  return `${english} (${native})`;
}

export function getFlagIcon(
  tag: string,
  catalogByTag?: Map<string, LanguageCatalogEntry>
): string | null {
  const normalized = canonicalizeLanguageTag(tag);
  if (!normalized) return null;
  const parts = normalized.split("-");
  const region = parts.find((part, idx) => idx > 0 && (/^\d{3}$/.test(part) || part.length === 2));
  if (region) return region.toLowerCase();

  const primary = primarySubtag(normalized);
  if (catalogByTag) {
    const entry = catalogByTag.get(normalized) || catalogByTag.get(primary);
    const defaultRegion = entry?.defaultRegionForFlag;
    if (defaultRegion) return String(defaultRegion).toLowerCase();
  }

  const fallback = FALLBACK_FLAG_BY_PRIMARY[primary];
  return fallback ? fallback.toLowerCase() : null;
}
