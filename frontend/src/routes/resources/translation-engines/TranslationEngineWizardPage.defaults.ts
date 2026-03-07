import { normalizeLocale } from "../../../lib/i18n/locale";

export type TranslationEngineLanguageOption = {
  canonical: string;
  label: string;
};

export function resolveTranslationEngineStarterPair(params: {
  sourceOptions: TranslationEngineLanguageOption[];
  targetOptions: TranslationEngineLanguageOption[];
  defaultSource?: string;
  defaultTargets?: string[];
}) {
  const sourceOptions = params.sourceOptions.filter((entry) => entry.canonical);
  const targetOptions = params.targetOptions.filter((entry) => entry.canonical);
  const sourceByTag = new Map(sourceOptions.map((entry) => [entry.canonical, entry]));
  const targetByTag = new Map(targetOptions.map((entry) => [entry.canonical, entry]));

  const defaultSource = normalizeLocale(String(params.defaultSource || "")).canonical;
  const defaultTargets = Array.isArray(params.defaultTargets)
    ? params.defaultTargets
        .map((value) => normalizeLocale(String(value || "")).canonical)
        .filter(Boolean)
    : [];

  const sourceLang =
    (defaultSource && sourceByTag.has(defaultSource) ? defaultSource : "") || sourceOptions[0]?.canonical || "";
  const targetLang =
    defaultTargets.find((value) => value !== sourceLang && targetByTag.has(value)) ||
    targetOptions.find((entry) => entry.canonical !== sourceLang)?.canonical ||
    targetOptions[0]?.canonical ||
    "";

  return {
    sourceLang,
    targetLang
  };
}

function fallbackLanguageLabel(tag: string) {
  const locale = normalizeLocale(tag);
  const languageTag = locale.language || locale.canonical;
  if (!languageTag) return "";
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    return display.of(languageTag) || languageTag;
  } catch {
    return languageTag;
  }
}

export function resolveTranslationEngineLanguageLabel(
  tag: string,
  options: TranslationEngineLanguageOption[]
) {
  const canonical = normalizeLocale(tag).canonical;
  if (!canonical) return "";
  const exact = options.find((entry) => entry.canonical === canonical);
  if (exact?.label) return exact.label;
  const language = normalizeLocale(canonical).language;
  if (language) {
    const byLanguage = options.find((entry) => normalizeLocale(entry.canonical).language === language);
    if (byLanguage?.label) return byLanguage.label;
  }
  return fallbackLanguageLabel(canonical);
}

export function buildTranslationEngineStarterDefaults(params: {
  sourceLang: string;
  targetLang: string;
  languageOptions: TranslationEngineLanguageOption[];
}) {
  const sourceLabel = resolveTranslationEngineLanguageLabel(params.sourceLang, params.languageOptions) || "the source language";
  const targetLabel = resolveTranslationEngineLanguageLabel(params.targetLang, params.languageOptions) || "the target language";
  const instruction = `Translate from ${sourceLabel} to ${targetLabel}.`;
  return {
    sourceLabel,
    targetLabel,
    instruction,
    systemPrompt:
      "You are a professional translation engine. Translate accurately, preserve meaning, terminology, formatting, placeholders, and structure.",
    userPromptTemplate: `${instruction}\n\nSource:\n{source_text}`,
    temperatureRaw: "0.7",
    maxTokensRaw: "4096"
  };
}
