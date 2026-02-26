import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Step4_Rules from "./Step4_Rules";
import Step5_Glossary from "./Step5_Glossary";

function buildWizard(overrides: Record<string, any> = {}) {
  return {
    state: {
      assignments: { planMode: "simple" },
      engine: {
        rulesEnabled: false,
        termbaseEnabled: false,
        glossaryEnabled: false,
        rulesetId: "",
        glossaryId: "",
        rulesetByTargetLang: {},
        glossaryByTargetLang: {},
        translationEngineByTargetLang: {},
        mtSeedingEnabled: false
      },
      languages: { targetLangs: [] },
      showValidation: false,
      ...overrides.state
    },
    ui: { creating: false, ...overrides.ui },
    data: { rulesets: [], glossaries: [], ...overrides.data },
    derived: {
      rulesetPlanFiles: [],
      selectedRuleset: null,
      selectedGlossary: null,
      targetMetaByTag: new Map(),
      rulesValidation: { blockingErrors: [], rowErrors: {} },
      glossaryValidation: { blockingErrors: [], rowErrors: {} },
      ...overrides.derived
    },
    flags: { rulesetsLoaded: true, glossariesLoaded: true, isReviewer: false, ...overrides.flags },
    actions: {
      setRulesEnabled: () => {},
      setTerminologyEnabled: () => {},
      setRulesetId: () => {},
      applyDefaultRulesetToAllTargets: () => {},
      clearRulesetOverrides: () => {},
      setRulesetForTarget: () => {},
      applyRulesetToAll: () => {},
      applyRulesetToFile: () => {},
      handleFileRulesetAllChange: () => {},
      handleRulesetAssignmentChange: () => {},
      resetRulesetDefaults: () => {},
      setTranslationPlanMode: () => {},
      setGlossaryId: () => {},
      applyDefaultGlossaryToAllTargets: () => {},
      clearGlossaryOverrides: () => {},
      setGlossaryForTarget: () => {},
      ...overrides.actions
    }
  } as any;
}

describe("Project create toggles", () => {
  it("hides rules UI when rules are disabled", () => {
    const wizard = buildWizard();
    const html = renderToStaticMarkup(<Step4_Rules wizard={wizard} />);
    expect(html).toContain("Rules are disabled.");
    expect(html).not.toContain("Rules (optional)");
    expect(html).not.toContain("Ruleset defaults by target");
  });

  it("hides termbase/glossary selectors when terminology is disabled", () => {
    const wizard = buildWizard();
    const html = renderToStaticMarkup(<Step5_Glossary wizard={wizard} />);
    expect(html).toContain("Termbase is disabled.");
    expect(html).toContain("Glossary is disabled.");
    expect(html).not.toContain("Default termbase");
  });
});
