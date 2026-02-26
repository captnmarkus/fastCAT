import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WizardShell from "./WizardShell";
import { GLOBAL_STYLES_UI } from "../../config/global-styles-ui";

type StepKey = "basics" | "review";

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: "basics", label: "Basics" },
  { key: "review", label: "Review" }
];

describe("WizardShell layout", () => {
  it("renders a separate header row above the main card without gutter cards", () => {
    const html = renderToStaticMarkup(
      <WizardShell
        eyebrow="Projects"
        title="New Project"
        onCancel={() => {}}
        steps={STEPS}
        currentStep="basics"
        footer={<div>Footer</div>}
      >
        <div>Step body</div>
      </WizardShell>
    );

    expect(html).toContain("fc-wizard-steps-rail");
    expect(html).not.toContain("fc-wizard-gutter-card");
    expect(html).toContain("fc-wizard-main-header");
    expect(html).toContain("fc-wizard-main");
    expect(html).toMatch(/fc-wizard-main-header[\s\S]*fc-wizard-header[\s\S]*fc-wizard-main[\s\S]*fc-wizard-surface/);
  });

  it("defines a wider main card and responsive single-column collapse", () => {
    expect(GLOBAL_STYLES_UI).toContain("--fc-wizard-main-max: 1080px;");
    expect(GLOBAL_STYLES_UI).toContain(
      "grid-template-columns: minmax(220px, var(--fc-wizard-stepper-width)) minmax(0, var(--fc-wizard-main-max));"
    );
    expect(GLOBAL_STYLES_UI).toContain('"steps main"');
    expect(GLOBAL_STYLES_UI).not.toContain("fc-wizard-gutter-card");
    expect(GLOBAL_STYLES_UI).toMatch(/@media \(max-width: 992px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
