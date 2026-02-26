import { normalizeLanguageTag, primarySubtag } from "./language-catalog.js";

export const LANGUAGE_NAME_MAP: Record<string, string> = {
  czech: "cs",
  danish: "da",
  german: "de",
  english: "en",
  spanish: "es",
  finnish: "fi",
  french: "fr",
  hungarian: "hu",
  italian: "it",
  dutch: "nl",
  norwegian: "no",
  polish: "pl",
  portuguese: "pt",
  romanian: "ro",
  russian: "ru",
  croatian: "hr",
  slovak: "sk",
  slovenian: "sl",
  swedish: "sv",
  turkish: "tr",
  "serbo-croatian": "sh",
  "serbo croatian": "sh",
  serbocroatian: "sh"
};

export const LANGUAGE_CODE_ALIASES: Record<string, string[]> = Object.entries(LANGUAGE_NAME_MAP).reduce(
  (acc, [name, code]) => {
    const key = code.toLowerCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(name);
    return acc;
  },
  {} as Record<string, string[]>
);

export function normalizeLanguageInput(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const lowered = raw.toLowerCase();
  const simplified = lowered.replace(/[\s_-]+/g, " ").trim();
  const mapped = LANGUAGE_NAME_MAP[lowered] || LANGUAGE_NAME_MAP[simplified];
  const candidate = mapped || raw;
  return normalizeLanguageTag(candidate);
}

export function buildLanguageCandidates(input: string): string[] {
  const normalized = normalizeLanguageInput(input);
  if (!normalized) return [];
  const normalizedLower = normalized.toLowerCase();
  const candidates = new Set<string>([normalizedLower]);
  const primary = primarySubtag(normalized);
  if (primary) candidates.add(primary.toLowerCase());
  const aliases = LANGUAGE_CODE_ALIASES[primary] ?? [];
  aliases.forEach((alias) => candidates.add(alias.toLowerCase()));
  return Array.from(candidates);
}

export function normalizeLanguageListInput(value: any): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((v) => normalizeLanguageInput(String(v ?? ""))).filter(Boolean)));
  }
  if (value && typeof value === "object") {
    const arr = Array.isArray((value as any).languages) ? (value as any).languages : value;
    if (Array.isArray(arr)) {
      return Array.from(new Set(arr.map((v) => normalizeLanguageInput(String(v ?? ""))).filter(Boolean)));
    }
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((v) => normalizeLanguageInput(String(v ?? ""))).filter(Boolean)));
      }
    } catch {
      return Array.from(
        new Set(
          value
            .split(/[,;|]/)
            .map((v) => normalizeLanguageInput(v))
            .filter(Boolean)
        )
      );
    }
  }
  return [];
}
