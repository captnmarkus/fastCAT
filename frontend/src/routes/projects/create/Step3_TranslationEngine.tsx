import { useEffect, useState } from "react";
import type { ProjectCreateWizard } from "./useProjectCreateWizard";
import { ENGINE_INHERIT } from "./useProjectCreateWizard";
import { normalizeLocale } from "../../../lib/i18n/locale";
import SeedingWarningBanner from "./SeedingWarningBanner";
import EmptyState from "../../../components/ui/EmptyState";
import SectionCard from "../../../components/ui/SectionCard";
import WarningBanner from "../../../components/ui/WarningBanner";
import Toggle from "../../../components/ui/Toggle";
import InlineSelect from "../../../components/ui/InlineSelect";
import BadgePill from "../../../components/ui/BadgePill";

export default function Step3_TranslationEngine({ wizard }: { wizard: ProjectCreateWizard }) {
  const { state, ui, data, derived, flags, actions } = wizard;
  const isAdvanced = state.assignments.planMode === "advanced";
  const hasEngineFiles = derived.enginePlanFiles.length > 0;
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [bulkEngineValue, setBulkEngineValue] = useState<string>(ENGINE_INHERIT);

  useEffect(() => {
    if (!isAdvanced) return;
    if (derived.enginePlanFiles.length === 0) {
      if (openFileId) setOpenFileId(null);
      return;
    }
    if (openFileId && derived.enginePlanFiles.some((file) => file.id === openFileId)) return;
    setOpenFileId(derived.enginePlanFiles[0].id);
  }, [derived.enginePlanFiles, isAdvanced, openFileId]);

  const engineOptions = data.translationEngines;
  const seedingEnabled = state.engine.mtSeedingEnabled;
  const validation = derived.engineValidation;
  const engineAssetsAvailable = flags.translationEnginesLoaded && engineOptions.length > 0;
  const engineSelectOptions = engineOptions.map((engine) => ({
    value: String(engine.id),
    label: engine.name
  }));
  const engineOverrideOptions = [
    { value: ENGINE_INHERIT, label: "Inherit target default" },
    { value: "", label: "None" },
    ...engineSelectOptions
  ];

  return (
    <>
      <div className="col-12">
        <SectionCard
          title="Translation Engine (MT/LLM)"
          description="Configure MT/LLM seeding per project, target, and file."
          actions={
            <Toggle
              id="mt-seeding-enabled"
              label="Enable seeding"
              checked={seedingEnabled}
              onChange={actions.setMtSeedingEnabled}
              disabled={ui.creating}
              size="sm"
            />
          }
        >
          {!seedingEnabled ? (
            <EmptyState
              title="MT/LLM seeding is off"
              description="Enable seeding to set project defaults, target overrides, and file-level behavior."
              iconClassName="bi bi-cpu"
            />
          ) : null}
        </SectionCard>
      </div>

      {seedingEnabled ? (
        <>
          {validation.blockingErrors.length > 0 ? (
            <div className="col-12">
              <SeedingWarningBanner messages={validation.blockingErrors} />
            </div>
          ) : null}
          <div className="col-md-6">
            <label className="form-label small text-uppercase text-muted">Translation engine (optional)</label>
            <select
              className="form-select"
              value={state.engine.translationEngineId}
              onChange={(e) => actions.setTranslationEngineId(e.target.value)}
              disabled={ui.creating || !flags.translationEnginesLoaded || !engineAssetsAvailable}
            >
              <option value="">None</option>
              {engineOptions.map((engine) => (
                <option key={engine.id} value={String(engine.id)}>
                  {engine.name}
                </option>
              ))}
            </select>
            {!flags.translationEnginesLoaded ? (
              <div className="form-text text-muted">Loading engines...</div>
            ) : engineOptions.length === 0 ? (
              <div className="form-text text-muted">No translation engines available.</div>
            ) : derived.selectedTranslationEngine?.description ? (
              <div className="form-text text-muted">{derived.selectedTranslationEngine.description}</div>
            ) : (
              <div className="form-text text-muted">Optional: use MT/LLM to prefill translations.</div>
            )}
          </div>

      <div className="col-12">
        <SectionCard
          className="mt-3"
          title="Engine defaults by target"
          description="Apply default engines per target language."
          actions={
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={actions.applyDefaultEngineToAllTargets}
                disabled={ui.creating || !engineAssetsAvailable || state.languages.targetLangs.length === 0}
              >
                Apply project default
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={actions.clearEngineOverrides}
                disabled={
                  ui.creating || !engineAssetsAvailable || Object.keys(state.engine.translationEngineByTargetLang || {}).length === 0
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
              description="Pick target languages in Basics before setting engine defaults."
              iconClassName="bi bi-translate"
            />
          ) : (
            <div className="table-responsive mt-1">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "40%" }}>Target language</th>
                    <th style={{ width: "60%" }}>Engine</th>
                  </tr>
                </thead>
                <tbody>
                  {state.languages.targetLangs.map((target) => {
                    const key = normalizeLocale(String(target)).canonical || target;
                    const meta = derived.targetMetaByTag.get(key) ?? derived.targetMetaByTag.get(target);
                    const hasOverride = Object.prototype.hasOwnProperty.call(
                      state.engine.translationEngineByTargetLang || {},
                      key
                    );
                    const overrideValue = hasOverride ? state.engine.translationEngineByTargetLang?.[key] ?? null : undefined;
                    const selectValue =
                      overrideValue === undefined
                        ? ENGINE_INHERIT
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
                            onChange={(value) => actions.setTranslationEngineForTarget(key, value)}
                            options={engineOverrideOptions}
                            placeholder="Inherit target default"
                            disabled={ui.creating || !flags.translationEnginesLoaded || !engineAssetsAvailable}
                            invalid={Boolean(rowError)}
                            ariaLabel={`Engine for ${meta?.label || key}`}
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

      {!isAdvanced && hasEngineFiles ? (
        <div className="col-12">
          <WarningBanner
            className="mt-3 mb-0"
            tone="info"
            messages={["Advanced engine overrides are available in Advanced translation plan mode."]}
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

      {isAdvanced && hasEngineFiles ? (
        <div className="col-12">
          <SectionCard
            className="mt-3"
            title="Engine overrides"
            description="Override engines per file and target language."
            actions={
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="text-muted small">Apply to all</span>
                <select
                  className="form-select form-select-sm"
                  value={bulkEngineValue}
                  onChange={(e) => setBulkEngineValue(e.target.value)}
                  disabled={ui.creating || !flags.translationEnginesLoaded || !engineAssetsAvailable}
                >
                  <option value={ENGINE_INHERIT}>Inherit target default</option>
                  <option value="">None</option>
                  {engineOptions.map((engine) => (
                    <option key={engine.id} value={String(engine.id)}>
                      {engine.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => actions.applyEngineToAll(bulkEngineValue)}
                  disabled={ui.creating || !engineAssetsAvailable}
                >
                  Apply to all files & languages
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => actions.applyEngineToAll(ENGINE_INHERIT)}
                  disabled={ui.creating || !engineAssetsAvailable}
                >
                  Reset to project default
                </button>
              </div>
            }
          >
            <div className="accordion mt-1">
              {derived.enginePlanFiles.map((file) => {
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
                          <span className="text-muted small">Apply engine to all languages</span>
                          <select
                            className="form-select form-select-sm"
                            value={file.engineAll}
                            onChange={(e) => actions.handleFileEngineAllChange(file.id, e.target.value)}
                            disabled={ui.creating || !flags.translationEnginesLoaded || !engineAssetsAvailable}
                          >
                            <option value={ENGINE_INHERIT}>Inherit target default</option>
                            <option value="">None</option>
                            {engineOptions.map((engine) => (
                              <option key={engine.id} value={String(engine.id)}>
                                {engine.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => actions.applyEngineToFile(file.id, file.engineAll)}
                            disabled={ui.creating || !engineAssetsAvailable}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm ms-auto"
                            onClick={() => actions.resetEngineDefaults(file.id)}
                            disabled={ui.creating || !engineAssetsAvailable}
                          >
                            Reset to project default
                          </button>
                        </div>

                        {file.targetLangs.length === 0 ? (
                          <div className="text-muted small">No target languages selected for this file.</div>
                        ) : (
                          <div className="d-flex flex-column gap-2">
                            {file.targetLangs.map((targetLang) => {
                              const assignment = file.engineAssignments[targetLang] || { engineId: ENGINE_INHERIT };
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
                                      <span className="text-muted small">Engine</span>
                                      <InlineSelect
                                        value={assignment.engineId}
                                        onChange={(value) => actions.handleEngineAssignmentChange(file.id, targetLang, value)}
                                        options={engineOverrideOptions}
                                        placeholder="Inherit target default"
                                        disabled={ui.creating || !flags.translationEnginesLoaded || !engineAssetsAvailable}
                                        ariaLabel={`Engine for ${meta?.label || targetLang}`}
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
