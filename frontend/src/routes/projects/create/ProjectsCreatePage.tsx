import { STEP_ORDER, useProjectCreateWizard } from "./useProjectCreateWizard";
import type { AuthUser } from "../../../types/app";
import Step1_BasicsAndFiles from "./Step1_BasicsAndFiles";
import Step2_TMX from "./Step2_TMX";
import Step3_TranslationEngine from "./Step3_TranslationEngine";
import Step4_Rules from "./Step4_Rules";
import Step5_Glossary from "./Step5_Glossary";
import Step4_ReviewAndSave from "./Step4_ReviewAndSave";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";

export default function ProjectsCreatePage({ currentUser }: { currentUser: AuthUser }) {
  const wizard = useProjectCreateWizard({ currentUser });
  const { state, ui, actions, derived } = wizard;

  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Projects"
        title="New Project"
        onCancel={actions.cancel}
        cancelDisabled={ui.creating}
        steps={STEP_ORDER}
        currentStep={state.step}
        onStepSelect={actions.goToStep}
        canSelectStep={(key, index, currentIndex) => !ui.creating && (index < currentIndex || key === state.step)}
        alerts={
          <>
            {ui.error ? <WarningBanner messages={[ui.error]} tone="error" /> : null}
            {ui.creating && ui.creationStep ? <WarningBanner messages={[ui.creationStep]} tone="info" /> : null}
          </>
        }
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={actions.goBack}
              disabled={ui.creating || state.step === "basics"}
            >
              Back
            </button>
            {state.step === "review" ? (
              <button
                type="button"
                className="btn btn-primary fw-semibold"
                onClick={actions.handleSaveProject}
                disabled={ui.creating}
              >
                {ui.creating ? "Saving..." : "Save Project"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-dark"
                onClick={actions.goNext}
                disabled={ui.creating || !derived.canProceed}
              >
                Next
              </button>
            )}
          </div>
        }
      >
        <div className="row g-3">
          {state.step === "basics" ? <Step1_BasicsAndFiles wizard={wizard} /> : null}
          {state.step === "tmx" ? <Step2_TMX wizard={wizard} /> : null}
          {state.step === "engine" ? <Step3_TranslationEngine wizard={wizard} /> : null}
          {state.step === "rules" ? <Step4_Rules wizard={wizard} /> : null}
          {state.step === "glossary" ? <Step5_Glossary wizard={wizard} /> : null}
          {state.step === "review" ? <Step4_ReviewAndSave wizard={wizard} /> : null}
        </div>
      </WizardShell>
    </div>
  );
}
