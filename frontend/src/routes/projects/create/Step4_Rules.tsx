import { useEffect, useState } from "react";
import type { ProjectCreateWizard } from "./useProjectCreateWizard";
import { RULESET_INHERIT } from "./useProjectCreateWizard";
import { normalizeLocale } from "../../../lib/i18n/locale";
import SeedingWarningBanner from "./SeedingWarningBanner";
import EmptyState from "../../../components/ui/EmptyState";
import SectionCard from "../../../components/ui/SectionCard";
import WarningBanner from "../../../components/ui/WarningBanner";
import Toggle from "../../../components/ui/Toggle";
import InlineSelect from "../../../components/ui/InlineSelect";
import BadgePill from "../../../components/ui/BadgePill";

export default function Step4_Rules({ wizard }: { wizard: ProjectCreateWizard }) {
  const { state, ui, data, derived, flags, actions } = wizard;
  const isAdvanced = state.assignments.planMode === "advanced";
  const hasRulesetFiles = derived.rulesetPlanFiles.length > 0;
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [bulkRulesetValue, setBulkRulesetValue] = useState<string>(RULESET_INHERIT);

  useEffect(() => {
    if (!isAdvanced) return;
    if (derived.rulesetPlanFiles.length === 0) {
      if (openFileId) setOpenFileId(null);
      return;
    }
    if (openFileId && derived.rulesetPlanFiles.some((file) => file.id === openFileId)) return;
    setOpenFileId(derived.rulesetPlanFiles[0].id);
  }, [derived.rulesetPlanFiles, isAdvanced, openFileId]);

  const rulesEnabled = state.engine.rulesEnabled;
  const rulesetOptions = data.rulesets;
  const validation = derived.rulesValidation;
  const rulesetsAvailable = flags.rulesetsLoaded && rulesetOptions.length > 0;
  const rulesetSelectOptions = rulesetOptions.map((ruleset) => ({
    value: String(ruleset.id),
    label: ruleset.name
  }));
  const rulesetOverrideOptions = [
    { value: RULESET_INHERIT, label: "Inherit project default" },
    { value: "", label: "None" },
    ...rulesetSelectOptions
  ];

  return (
    <>
      <div className="col-12">
        <SectionCard
          title="Rules"
          description="Apply rule sets during seeding and postprocessing."
          actions={
            <Toggle
              id="rules-enabled"
              label="Enable seeding"
              checked={rulesEnabled}
              onChange={actions.setRulesEnabled}
              disabled={ui.creating}
              size="sm"
            />
          }
        >
          {!rulesEnabled ? (
            <EmptyState
              title="Rules are disabled."
              description="Enable rules to apply language processing defaults and overrides."
              iconClassName="bi bi-shield-check"
            />
          ) : null}
        </SectionCard>
      </div>

      {rulesEnabled ? (
        <>
          {validation.blockingErrors.length > 0 ? (
            <div className="col-12">
              <SeedingWarningBanner messages={validation.blockingErrors} />
            </div>
          ) : null}
          <div className="col-md-6">
            <label className="form-label small text-uppercase text-muted">Rules (optional)</label>
            <select
              className="form-select"
              value={state.engine.rulesetId}
              onChange={(e) => actions.setRulesetId(e.target.value)}
              disabled={ui.creating || !flags.rulesetsLoaded || !rulesetsAvailable}
            >
              <option value="">None</option>
              {data.rulesets.map((ruleset) => (
                <option key={ruleset.id} value={String(ruleset.id)}>
                  {ruleset.name}
                </option>
              ))}
            </select>
            {!flags.rulesetsLoaded ? (
              <div className="form-text text-muted">Loading rules...</div>
            ) : data.rulesets.length === 0 ? (
              <div className="form-text text-muted">No rule sets available.</div>
            ) : derived.selectedRuleset?.description ? (
              <div className="form-text text-muted">{derived.selectedRuleset.description}</div>
            ) : (
              <div className="form-text text-muted">Optional: apply language processing rules to seeded drafts.</div>
            )}
          </div>

          <div className="col-12">
            <SectionCard
              className="mt-3"
              title="Ruleset defaults by target"
              description="Apply default rulesets per target language."
              actions={
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={actions.applyDefaultRulesetToAllTargets}
                    disabled={ui.creating || !rulesetsAvailable || state.languages.targetLangs.length === 0}
                  >
                    Apply project default
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={actions.clearRulesetOverrides}
                    disabled={
                      ui.creating ||
                      !rulesetsAvailable ||
                      Object.keys(state.engine.rulesetByTargetLang || {}).length === 0
                    }
                  >
                    Clear overrides
                  </button>
                </div>
              }
            >
              {state.languages.targetLangs.length === 0 ? (
                <EmptyState
                  title="No target languages"
                  description="Pick target languages in Basics before setting ruleset defaults."
                  iconClassName="bi bi-translate"
                />
              ) : (
                <div className="table-responsive mt-1">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "40%" }}>Target language</th>
                        <th style={{ width: "60%" }}>Ruleset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.languages.targetLangs.map((target) => {
                        const key = normalizeLocale(String(target)).canonical || target;
                        const meta = derived.targetMetaByTag.get(key) ?? derived.targetMetaByTag.get(target);
                        const hasOverride = Object.prototype.hasOwnProperty.call(
                          state.engine.rulesetByTargetLang || {},
                          key
                        );
                        const overrideValue = hasOverride ? state.engine.rulesetByTargetLang?.[key] ?? null : undefined;
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
                                onChange={(value) => actions.setRulesetForTarget(key, value)}
                                options={rulesetOverrideOptions}
                                placeholder="Inherit project default"
                                disabled={ui.creating || !flags.rulesetsLoaded || !rulesetsAvailable}
                                invalid={Boolean(rowError)}
                                ariaLabel={`Ruleset for ${meta?.label || key}`}
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
            </SectionCard>
          </div>

      {!isAdvanced && hasRulesetFiles ? (
        <div className="col-12">
          <WarningBanner
            className="mt-3 mb-0"
            tone="info"
            messages={["Advanced ruleset overrides are available in Advanced translation plan mode."]}
            title="Advanced mode available"
          />
          <div className="mt-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => actions.setTranslationPlanMode("advanced")}
              disabled={ui.creating || flags.isReviewer}
            >
              Switch to Advanced
            </button>
          </div>
        </div>
      ) : null}

      {isAdvanced && hasRulesetFiles ? (
        <div className="col-12">
          <SectionCard
            className="mt-3"
            title="Ruleset overrides"
            description="Override rulesets per file and target language."
            actions={
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="text-muted small">Apply to all</span>
                <select
                  className="form-select form-select-sm"
                  value={bulkRulesetValue}
                  onChange={(e) => setBulkRulesetValue(e.target.value)}
                  disabled={ui.creating || !flags.rulesetsLoaded || !rulesetsAvailable}
                >
                  <option value={RULESET_INHERIT}>Inherit project default</option>
                  <option value="">None</option>
                  {rulesetOptions.map((ruleset) => (
                    <option key={ruleset.id} value={String(ruleset.id)}>
                      {ruleset.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => actions.applyRulesetToAll(bulkRulesetValue)}
                  disabled={ui.creating || !rulesetsAvailable}
                >
                  Apply to all files & languages
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => actions.applyRulesetToAll(RULESET_INHERIT)}
                  disabled={ui.creating || !rulesetsAvailable}
                >
                  Reset to project default
                </button>
              </div>
            }
          >
            <div className="accordion mt-1">
              {derived.rulesetPlanFiles.map((file) => {
                const isOpen = openFileId === file.id;
                const fileLabel = `${file.targetLangs.length} target language${file.targetLangs.length === 1 ? "" : "s"}`;
                return (
                  <div className="accordion-item" key={file.id}>
                    <h2 className="accordion-header">
                      <button
                        className={`accordion-button${isOpen ? "" : " collapsed"}`}
                        type="button"
                        onClick={() => setOpenFileId(isOpen ? null : file.id)}
                        aria-expanded={isOpen}
                      >
                        <div className="d-flex flex-column">
                          <span className="fw-semibold">{file.name}</span>
                          <span className="text-muted small">{fileLabel}</span>
                        </div>
                      </button>
                    </h2>
                    <div className={`accordion-collapse collapse${isOpen ? " show" : ""}`}>
                      <div className="accordion-body">
                        <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
                          <span className="text-muted small">Apply ruleset to all languages</span>
                          <select
                            className="form-select form-select-sm"
                            value={file.rulesetAll}
                            onChange={(e) => actions.handleFileRulesetAllChange(file.id, e.target.value)}
                            disabled={ui.creating || !flags.rulesetsLoaded || !rulesetsAvailable}
                          >
                            <option value={RULESET_INHERIT}>Inherit project default</option>
                            <option value="">None</option>
                            {rulesetOptions.map((ruleset) => (
                              <option key={ruleset.id} value={String(ruleset.id)}>
                                {ruleset.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => actions.applyRulesetToFile(file.id, file.rulesetAll)}
                            disabled={ui.creating || !rulesetsAvailable}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm ms-auto"
                            onClick={() => actions.resetRulesetDefaults(file.id)}
                            disabled={ui.creating || !rulesetsAvailable}
                          >
                            Reset to project default
                          </button>
                        </div>

                        {file.targetLangs.length === 0 ? (
                          <div className="text-muted small">No target languages selected for this file.</div>
                        ) : (
                          <div className="d-flex flex-column gap-2">
                            {file.targetLangs.map((targetLang) => {
                              const assignment = file.rulesetAssignments[targetLang] || { rulesetId: RULESET_INHERIT };
                              const meta = derived.targetMetaByTag.get(targetLang);
                              return (
                                <div key={targetLang} className="border rounded p-2">
                                  <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                                    <div className="d-flex align-items-center gap-2">
                                      {meta?.flag ? (
                                        <span className={`flag-icon fi fi-${meta.flag}`} aria-hidden="true" />
                                      ) : (
                                        <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
                                      )}
                                      <span className="fw-semibold small">{meta?.label || targetLang}</span>
                                    </div>
                                    <div className="d-flex align-items-center gap-2">
                                      <span className="text-muted small">Ruleset</span>
                                      <InlineSelect
                                        value={assignment.rulesetId}
                                        onChange={(value) =>
                                          actions.handleRulesetAssignmentChange(file.id, targetLang, value)
                                        }
                                        options={rulesetOverrideOptions}
                                        placeholder="Inherit project default"
                                        disabled={ui.creating || !flags.rulesetsLoaded || !rulesetsAvailable}
                                        ariaLabel={`Ruleset for ${meta?.label || targetLang}`}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      ) : null}
        </>
      ) : null}
    </>
  );
}
