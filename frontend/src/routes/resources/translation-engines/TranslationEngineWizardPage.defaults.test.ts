import { describe, expect, it } from "vitest";
import {
  buildTranslationEngineStarterDefaults,
  resolveTranslationEngineStarterPair,
  type TranslationEngineLanguageOption
} from "./TranslationEngineWizardPage.defaults";

const SOURCE_OPTIONS: TranslationEngineLanguageOption[] = [
  { canonical: "de-DE", label: "German" },
  { canonical: "en-GB", label: "English" }
];

const TARGET_OPTIONS: TranslationEngineLanguageOption[] = [
  { canonical: "fr-FR", label: "French" },
  { canonical: "da-DK", label: "Danish" }
];

describe("translation engine starter defaults", () => {
  it("uses organization default languages when available", () => {
    const pair = resolveTranslationEngineStarterPair({
      sourceOptions: SOURCE_OPTIONS,
      targetOptions: TARGET_OPTIONS,
      defaultSource: "de-DE",
      defaultTargets: ["fr-FR"]
    });

    expect(pair).toEqual({
      sourceLang: "de-DE",
      targetLang: "fr-FR"
    });
  });

  it("builds helpful prompt defaults and generation values", () => {
    const defaults = buildTranslationEngineStarterDefaults({
      sourceLang: "de-DE",
      targetLang: "fr-FR",
      languageOptions: [...SOURCE_OPTIONS, ...TARGET_OPTIONS]
    });

    expect(defaults.instruction).toBe("Translate from German to French.");
    expect(defaults.userPromptTemplate).toContain("Translate from German to French.");
    expect(defaults.userPromptTemplate).toContain("{source_text}");
    expect(defaults.systemPrompt).toContain("preserve meaning");
    expect(defaults.maxTokensRaw).toBe("4096");
    expect(defaults.temperatureRaw).toBe("0.7");
  });

  it("updates the starter instruction when the language pair changes", () => {
    const defaults = buildTranslationEngineStarterDefaults({
      sourceLang: "de-DE",
      targetLang: "da-DK",
      languageOptions: [...SOURCE_OPTIONS, ...TARGET_OPTIONS]
    });

    expect(defaults.instruction).toBe("Translate from German to Danish.");
  });
});
