import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectsCreatePage from "./ProjectsCreatePage";
import type { AuthUser } from "../../../types/app";

let wizardStub: any;

vi.mock("./useProjectCreateWizard", async () => {
  const actual = await vi.importActual<typeof import("./useProjectCreateWizard")>("./useProjectCreateWizard");
  return {
    ...actual,
    useProjectCreateWizard: () => wizardStub
  };
});

const currentUser = {
  id: 1,
  username: "tester",
  role: "admin"
} as AuthUser;

function buildWizard(overrides: Record<string, any> = {}) {
  return {
    state: {
      step: "engine",
      assignments: { planMode: "simple" },
      engine: {
        mtSeedingEnabled: true,
        translationEngineId: "",
        translationEngineByTargetLang: {},
        rulesEnabled: false,
        rulesetId: "",
        termbaseEnabled: false,
        glossaryEnabled: false,
        glossaryId: "",
        rulesetByTargetLang: {},
        glossaryByTargetLang: {}
      },
      languages: { targetLangs: ["fr-FR"] },
      showValidation: false,
      ...overrides.state
    },
    ui: {
      creating: false,
      error: null,
      creationStep: "",
      ...overrides.ui
    },
    data: {
      translationEngines: [],
      rulesets: [],
      glossaries: [],
      ...overrides.data
    },
    derived: {
      enginePlanFiles: [],
      targetMetaByTag: new Map(),
      selectedTranslationEngine: null,
      engineValidation: { blockingErrors: [], rowErrors: {} },
      canProceed: true,
      ...overrides.derived
    },
    flags: {
      translationEnginesLoaded: true,
      isReviewer: false,
      ...overrides.flags
    },
    actions: {
      cancel: () => {},
      goToStep: () => {},
      goNext: () => {},
      goBack: () => {},
      handleSaveProject: () => {},
      setMtSeedingEnabled: () => {},
      setTranslationEngineId: () => {},
      applyDefaultEngineToAllTargets: () => {},
      clearEngineOverrides: () => {},
      setTranslationEngineForTarget: () => {},
      setTranslationPlanMode: () => {},
      applyEngineToAll: () => {},
      applyEngineToFile: () => {},
      handleFileEngineAllChange: () => {},
      resetEngineDefaults: () => {},
      handleEngineAssignmentChange: () => {},
      ...overrides.actions
    }
  } as any;
}

describe("Project create seeding validation", () => {
  it("shows banner and disables Next when no engines exist", () => {
    wizardStub = buildWizard({
      data: { translationEngines: [] },
      derived: {
        engineValidation: {
          blockingErrors: ["No Translation Engines available.", "Disable seeding or create an asset first."],
          rowErrors: {}
        },
        canProceed: false
      }
    });

    const html = renderToStaticMarkup(<ProjectsCreatePage currentUser={currentUser} />);
    expect(html).toContain("No Translation Engines available.");
    expect(html).toMatch(/btn btn-dark[^>]*disabled/);
  });

  it("shows row errors and disables Next when selection is missing", () => {
    wizardStub = buildWizard({
      data: { translationEngines: [{ id: 1, name: "FastCAT MT" }] },
      derived: {
        engineValidation: {
          blockingErrors: ["MT/LLM seeding is enabled but no engine is selected."],
          rowErrors: { "fr-FR": "Engine required for this language (or disable MT/LLM seeding)." }
        },
        canProceed: false
      }
    });

    const html = renderToStaticMarkup(<ProjectsCreatePage currentUser={currentUser} />);
    expect(html).toContain("Engine required for this language (or disable MT/LLM seeding).");
    expect(html).toMatch(/is-invalid/);
    expect(html).toMatch(/btn btn-dark[^>]*disabled/);
  });

  it("enables Next when seeding config is valid", () => {
    wizardStub = buildWizard({
      data: { translationEngines: [{ id: 1, name: "FastCAT MT" }] },
      derived: {
        engineValidation: { blockingErrors: [], rowErrors: {} },
        canProceed: true
      }
    });

    const html = renderToStaticMarkup(<ProjectsCreatePage currentUser={currentUser} />);
    expect(html).not.toContain("alert alert-danger");
    expect(html).toMatch(/btn btn-dark[^>]*>Next/);
    expect(html).not.toMatch(/btn btn-dark[^>]*disabled/);
  });
});
