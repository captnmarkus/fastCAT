import type { ProjectCreateWizard } from "./useProjectCreateWizard";
import { RULESET_INHERIT } from "./useProjectCreateWizard";
import { normalizeLocale } from "../../../lib/i18n/locale";
import SeedingWarningBanner from "./SeedingWarningBanner";
import EmptyState from "../../../components/ui/EmptyState";
import SectionCard from "../../../components/ui/SectionCard";
import Toggle from "../../../components/ui/Toggle";
import InlineSelect from "../../../components/ui/InlineSelect";
import BadgePill from "../../../components/ui/BadgePill";

export default function Step5_Glossary({ wizard }: { wizard: ProjectCreateWizard }) {
  const { state, ui, data, derived, flags, actions } = wizard;
  const terminologyEnabled = state.engine.termbaseEnabled || state.engine.glossaryEnabled;
  const validation = derived.glossaryValidation;
  const glossariesAvailable = flags.glossariesLoaded && data.glossaries.length > 0;
  const glossarySelectOptions = data.glossaries.map((glossary) => ({
    value: String(glossary.id),
    label: glossary.label
  }));
  const glossaryOverrideOptions = [
    { value: RULESET_INHERIT, label: "Inherit default" },
    { value: "", label: "None" },
    ...glossarySelectOptions
  ];

  return (
    <>
      <div className="col-12">
        <SectionCard
          title="Termbase / Glossary"
          description="Apply enforced terminology during seeding."
          actions={
            <Toggle
              id="terminology-enabled"
              label="Enable seeding"
              checked={terminologyEnabled}
              onChange={actions.setTerminologyEnabled}
              disabled={ui.creating}
              size="sm"
            />
          }
        >
          {!terminologyEnabled ? (
            <EmptyState
              title="Termbase is disabled."
              description="Glossary is disabled."
              iconClassName="bi bi-book"
            />
          ) : (
            <>
              {validation.blockingErrors.length > 0 ? <SeedingWarningBanner messages={validation.blockingErrors} /> : null}
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Default termbase (optional)</label>
                  <select
                    className="form-select"
                    value={state.engine.glossaryId}
                    onChange={(e) => actions.setGlossaryId(e.target.value)}
                    disabled={ui.creating || !flags.glossariesLoaded || !glossariesAvailable}
                  >
                    <option value="">None</option>
                    {data.glossaries.map((glossary) => (
                      <option key={glossary.id} value={String(glossary.id)}>
                        {glossary.label}
                      </option>
                    ))}
                  </select>
                  {!flags.glossariesLoaded ? (
                    <div className="form-text text-muted">Loading terminology...</div>
                  ) : data.glossaries.length === 0 ? (
                    <div className="form-text text-muted">No glossaries available.</div>
                  ) : null}
                </div>
                <div className="col-md-6 d-flex align-items-end">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={actions.applyDefaultGlossaryToAllTargets}
                      disabled={ui.creating || !glossariesAvailable || state.languages.targetLangs.length === 0}
                    >
                      Apply default to all targets
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={actions.clearGlossaryOverrides}
                      disabled={
                        ui.creating || !glossariesAvailable || Object.keys(state.engine.glossaryByTargetLang || {}).length === 0
                      }
                    >
                      Clear overrides
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                {state.languages.targetLangs.length === 0 ? (
                  <EmptyState
                    title="No target languages"
                    description="Pick target languages in Basics before setting terminology defaults."
                    iconClassName="bi bi-translate"
                  />
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <thead>
                        <tr>
                          <th style={{ width: "40%" }}>Target language</th>
                          <th style={{ width: "60%" }}>Termbase</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.languages.targetLangs.map((target) => {
                          const key = normalizeLocale(String(target)).canonical || target;
                          const meta = derived.targetMetaByTag.get(key) ?? derived.targetMetaByTag.get(target);
                          const hasOverride = Object.prototype.hasOwnProperty.call(
                            state.engine.glossaryByTargetLang || {},
                            key
                          );
                          const overrideValue = hasOverride ? state.engine.glossaryByTargetLang?.[key] ?? null : undefined;
                          const selectValue =
                            overrideValue === undefined
                              ? RULESET_INHERIT
                              : overrideValue == null
                                ? ""
                                : String(overrideValue);
                          const rowError = validation.rowErrors[key];
                          return (
                            <tr key={target} className={rowError ? "table-warning" : ""}>
                              <td>
                                <BadgePill>
                                  {meta?.flag ? (
                                    <span className={`flag-icon fi fi-${meta.flag} me-1`} aria-hidden="true" />
                                  ) : (
                                    <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" />
                                  )}
                                  {meta?.label || key}
                                </BadgePill>
                              </td>
                              <td>
                                <InlineSelect
                                  value={selectValue}
                                  onChange={(value) => actions.setGlossaryForTarget(key, value)}
                                  options={glossaryOverrideOptions}
                                  placeholder="Inherit default"
                                  disabled={ui.creating || !flags.glossariesLoaded || !glossariesAvailable}
                                  invalid={Boolean(rowError)}
                                  ariaLabel={`Termbase for ${meta?.label || key}`}
                                />
                                {rowError ? <div className="invalid-feedback d-block">{rowError}</div> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </>
  );
}
