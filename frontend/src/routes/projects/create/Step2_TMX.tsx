import type { ProjectCreateWizard } from "./useProjectCreateWizard";
import SeedingWarningBanner from "./SeedingWarningBanner";
import { normalizeLocale } from "../../../lib/i18n/locale";
import EmptyState from "../../../components/ui/EmptyState";
import SectionCard from "../../../components/ui/SectionCard";
import Toggle from "../../../components/ui/Toggle";
import InlineSelect from "../../../components/ui/InlineSelect";
import BadgePill from "../../../components/ui/BadgePill";

export default function Step2_TMX({ wizard }: { wizard: ProjectCreateWizard }) {
  const { state, ui, data, derived, actions } = wizard;
  const validation = derived.tmxValidation;
  const tmxOptions = data.tmSamples
    .filter((sample) => sample.tmId != null)
    .map((sample) => ({
      value: String(sample.tmId),
      label: sample.label
    }));

  return (
    <div className="col-12">
      <SectionCard
        title="Translation Memory (TMX)"
        description="Select TMX per target language."
        actions={
          <Toggle
            id="tmxEnabled"
            label="Enable seeding"
            checked={state.tmx.enabled}
            onChange={actions.setTmxEnabled}
            disabled={ui.creating}
            size="sm"
          />
        }
      >
        {!state.tmx.enabled ? (
          <EmptyState
            title="TMX seeding is off"
            description="Enable seeding to assign defaults and per-target TMX assets."
            iconClassName="bi bi-database"
          />
        ) : (
          <>
            <SeedingWarningBanner messages={validation.blockingErrors} />
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label small text-uppercase text-muted">Default TMX</label>
                <select
                  className="form-select"
                  value={state.tmx.defaultTmxId != null ? String(state.tmx.defaultTmxId) : ""}
                  onChange={(e) => {
                    const value = e.target.value.trim();
                    actions.setDefaultTmxId(value ? Number(value) : null);
                  }}
                  disabled={ui.creating || data.tmSamples.length === 0}
                >
                  <option value="">Select TMX...</option>
                  {data.tmSamples.map((sample) => (
                    <option key={sample.filename} value={String(sample.tmId ?? "")}>
                      {sample.label}
                      {sample.seeded ? "" : " (seeding...)"}
                    </option>
                  ))}
                </select>
                {data.tmSamples.length === 0 ? <div className="form-text text-muted">No TMX assets available.</div> : null}
              </div>
              <div className="col-md-6 d-flex align-items-end">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={actions.applyDefaultTmxToAllTargets}
                  disabled={ui.creating || state.tmx.defaultTmxId == null || state.languages.targetLangs.length === 0}
                >
                  Apply to all targets
                </button>
              </div>
            </div>

            <div className="mt-3">
              {state.languages.targetLangs.length === 0 ? (
                <EmptyState
                  title="No target languages"
                  description="Choose target languages in Basics before assigning TMX."
                  iconClassName="bi bi-translate"
                />
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "40%" }}>Target language</th>
                        <th style={{ width: "60%" }}>TMX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.languages.targetLangs.map((target) => {
                        const meta = derived.targetMetaByTag.get(target);
                        const selectionId = derived.resolvedTmxByTarget[target] ?? null;
                        const rowError = validation.rowErrors[normalizeLocale(String(target)).canonical || target];
                        return (
                          <tr key={target} className={rowError ? "table-warning" : ""}>
                            <td>
                              <BadgePill>
                                {meta?.flag ? (
                                  <span className={`flag-icon fi fi-${meta.flag} me-1`} aria-hidden="true" />
                                ) : (
                                  <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" />
                                )}
                                {meta?.label || target}
                              </BadgePill>
                            </td>
                            <td>
                              <InlineSelect
                                value={selectionId != null ? String(selectionId) : ""}
                                onChange={(value) => actions.setTmxForTarget(target, value ? Number(value) : null)}
                                options={tmxOptions}
                                placeholder="No TMX"
                                disabled={ui.creating || tmxOptions.length === 0}
                                invalid={Boolean(rowError)}
                                ariaLabel={`TMX for ${meta?.label || target}`}
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
  );
}
