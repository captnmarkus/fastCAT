import React, { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../types/app";
import LanguageSelect from "../features/languages/LanguageSelect";
import { saveLanguagesBulk } from "../features/languages/api";
import { invalidateLanguages, useLanguages } from "../features/languages/hooks";
import type { LanguageDefaults, LanguageEntry } from "../features/languages/types";
import { formatLanguageEntryLabel, languageFlagTag, mergeLanguageEntries, normalizeDefaults } from "../features/languages/utils";
import { normalizeLocale } from "../lib/i18n/locale";

type WizardStepKey = "sources" | "targets" | "defaultSource" | "defaultTargets" | "review";

const WIZARD_STEPS: { key: WizardStepKey; label: string }[] = [
  { key: "sources", label: "Allowed Sources" },
  { key: "targets", label: "Allowed Targets" },
  { key: "defaultSource", label: "Default Source" },
  { key: "defaultTargets", label: "Default Targets" },
  { key: "review", label: "Review" }
];

function areDefaultsEqual(a: LanguageDefaults, b: LanguageDefaults) {
  const srcA = a.defaultSource || "";
  const srcB = b.defaultSource || "";
  const targetsA = a.defaultTargets || [];
  const targetsB = b.defaultTargets || [];
  if (srcA !== srcB) return false;
  if (targetsA.length !== targetsB.length) return false;
  for (let i = 0; i < targetsA.length; i += 1) {
    if (targetsA[i] !== targetsB[i]) return false;
  }
  return true;
}

function sanitizeDefaults(defaults: LanguageDefaults, entries: LanguageEntry[]) {
  const allowedSources = new Set(
    entries.filter((entry) => entry.active && entry.allowedAsSource).map((entry) => entry.canonical)
  );
  const allowedTargets = new Set(
    entries.filter((entry) => entry.active && entry.allowedAsTarget).map((entry) => entry.canonical)
  );

  const source = defaults.defaultSource && allowedSources.has(defaults.defaultSource) ? defaults.defaultSource : "";
  const targets = Array.from(
    new Set(
      (defaults.defaultTargets || []).filter(
        (value) => allowedTargets.has(value) && value !== source
      )
    )
  );

  return {
    defaultSource: source || undefined,
    defaultTargets: targets
  };
}

function AddLanguageInput({
  existingCanonicals,
  onAdd,
  disabled
}: {
  existingCanonicals: Set<string>;
  onAdd: (locale: ReturnType<typeof normalizeLocale>) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const normalized = normalizeLocale(value);
  const canonical = normalized.canonical;
  const isDuplicate = Boolean(canonical && existingCanonicals.has(canonical));
  const canAdd = Boolean(canonical) && !isDuplicate;

  return (
    <div className="d-grid gap-2">
      <div className="d-flex flex-wrap gap-2">
        <input
          className="form-control"
          placeholder="Add language code (e.g., de, de-DE, pt_BR)"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => {
            if (!canAdd) return;
            onAdd(normalized);
            setValue("");
          }}
          disabled={disabled || !canAdd}
        >
          Add
        </button>
      </div>
      {value.trim() && (
        <div className="text-muted small">
          Canonical:{" "}
          <span className={isDuplicate ? "text-warning" : "text-muted"}>
            {canonical || "Invalid code"}
          </span>
          {isDuplicate && <span className="ms-2">Already added</span>}
        </div>
      )}
    </div>
  );
}

function LanguageWizard({
  initialEntries,
  onComplete
}: {
  initialEntries: LanguageEntry[];
  onComplete: (entries: LanguageEntry[], defaults: LanguageDefaults) => Promise<void>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [entries, setEntries] = useState<LanguageEntry[]>(() => mergeLanguageEntries(initialEntries));
  const [allowedSources, setAllowedSources] = useState<string[]>(() =>
    initialEntries.filter((entry) => entry.active && entry.allowedAsSource).map((entry) => entry.canonical)
  );
  const [allowedTargets, setAllowedTargets] = useState<string[]>(() =>
    initialEntries.filter((entry) => entry.active && entry.allowedAsTarget).map((entry) => entry.canonical)
  );
  const [defaultSource, setDefaultSource] = useState("");
  const [defaultTargets, setDefaultTargets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableCanonicals = useMemo(() => new Set(entries.map((entry) => entry.canonical)), [entries]);

  const allowedSourceEntries = useMemo(
    () => entries.filter((entry) => allowedSources.includes(entry.canonical)),
    [entries, allowedSources]
  );

  const allowedTargetEntries = useMemo(
    () => entries.filter((entry) => allowedTargets.includes(entry.canonical)),
    [entries, allowedTargets]
  );

  useEffect(() => {
    if (defaultSource && !allowedSources.includes(defaultSource)) {
      setDefaultSource("");
    }
  }, [allowedSources, defaultSource]);

  useEffect(() => {
    setDefaultTargets((prev) =>
      prev.filter((value) => allowedTargets.includes(value) && value !== defaultSource)
    );
  }, [allowedTargets, defaultSource]);

  const stepKey = WIZARD_STEPS[stepIndex]?.key ?? "sources";
  const isFinalStep = stepIndex === WIZARD_STEPS.length - 1;
  const canContinue =
    (stepKey === "sources" && allowedSources.length > 0) ||
    (stepKey === "targets" && allowedTargets.length > 0) ||
    stepKey === "defaultSource" ||
    stepKey === "defaultTargets" ||
    stepKey === "review";

  async function handleConfirm() {
    setError(null);
    setSaving(true);
    try {
      const updatedEntries = entries.map((entry) => {
        const isSource = allowedSources.includes(entry.canonical);
        const isTarget = allowedTargets.includes(entry.canonical);
        const active = isSource || isTarget;
        return {
          ...entry,
          active,
          allowedAsSource: isSource,
          allowedAsTarget: isTarget
        };
      });
      const defaults = {
        defaultSource: defaultSource || undefined,
        defaultTargets: defaultTargets.filter((value) => value !== defaultSource)
      };
      await onComplete(updatedEntries, defaults);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to save language settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-enterprise p-4">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <div className="text-muted small">First run setup</div>
          <h3 className="mb-0">Language settings wizard</h3>
        </div>
        <div className="text-muted small">{WIZARD_STEPS[stepIndex]?.label}</div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {stepKey === "sources" && (
        <div className="d-grid gap-3">
          <p className="mb-0 text-muted">Pick one or more languages that can be used as sources.</p>
          <AddLanguageInput
            existingCanonicals={availableCanonicals}
            onAdd={(locale) =>
              setEntries((prev) =>
                mergeLanguageEntries([
                  ...prev,
                  {
                    canonical: locale.canonical,
                    language: locale.language,
                    region: locale.region,
                    active: true,
                    allowedAsSource: true,
                    allowedAsTarget: true
                  }
                ])
              )
            }
            disabled={saving}
          />
          <LanguageSelect
            kind="source"
            multi
            values={allowedSources}
            onChange={setAllowedSources}
            optionsOverride={entries}
            disabled={saving}
            containerClassName="d-flex flex-wrap gap-3"
          />
        </div>
      )}

      {stepKey === "targets" && (
        <div className="d-grid gap-3">
          <p className="mb-0 text-muted">Pick one or more languages that can be used as targets.</p>
          <AddLanguageInput
            existingCanonicals={availableCanonicals}
            onAdd={(locale) =>
              setEntries((prev) =>
                mergeLanguageEntries([
                  ...prev,
                  {
                    canonical: locale.canonical,
                    language: locale.language,
                    region: locale.region,
                    active: true,
                    allowedAsSource: true,
                    allowedAsTarget: true
                  }
                ])
              )
            }
            disabled={saving}
          />
          <LanguageSelect
            kind="target"
            multi
            values={allowedTargets}
            onChange={setAllowedTargets}
            optionsOverride={entries}
            disabled={saving}
            containerClassName="d-flex flex-wrap gap-3"
          />
        </div>
      )}

      {stepKey === "defaultSource" && (
        <div className="d-grid gap-3">
          <p className="mb-0 text-muted">Optionally pick a default source language.</p>
          <LanguageSelect
            kind="source"
            value={defaultSource}
            onChange={setDefaultSource}
            includeEmpty
            emptyLabel="No default"
            optionsOverride={allowedSourceEntries}
            disabled={saving}
          />
        </div>
      )}

      {stepKey === "defaultTargets" && (
        <div className="d-grid gap-3">
          <p className="mb-0 text-muted">Optionally pick default target languages.</p>
          <LanguageSelect
            kind="target"
            multi
            values={defaultTargets}
            onChange={setDefaultTargets}
            optionsOverride={allowedTargetEntries}
            sourceValue={defaultSource}
            disabled={saving}
            containerClassName="d-flex flex-wrap gap-3"
          />
        </div>
      )}

      {stepKey === "review" && (
        <div className="d-grid gap-2">
          <div className="fw-semibold">Review selections</div>
          <div className="text-muted small">
            Sources: {allowedSources.length ? allowedSources.join(", ") : "None"}
          </div>
          <div className="text-muted small">
            Targets: {allowedTargets.length ? allowedTargets.join(", ") : "None"}
          </div>
          <div className="text-muted small">
            Default source: {defaultSource || "None"}
          </div>
          <div className="text-muted small">
            Default targets: {defaultTargets.length ? defaultTargets.join(", ") : "None"}
          </div>
        </div>
      )}

      <div className="d-flex align-items-center justify-content-between mt-4">
        <div className="text-muted small">
          Step {stepIndex + 1} of {WIZARD_STEPS.length}
        </div>
        <div className="d-flex gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setStepIndex((idx) => Math.max(0, idx - 1))}
              disabled={saving}
            >
              Back
            </button>
          )}
          {!isFinalStep ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStepIndex((idx) => Math.min(WIZARD_STEPS.length - 1, idx + 1))}
              disabled={!canContinue || saving}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={saving}
            >
              {saving ? "Saving..." : "Confirm"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminLanguagesPage({ currentUser }: { currentUser: AuthUser }) {
  const { allLanguages, defaults, allowSingleLanguage, loading, error } = useLanguages();
  const [entries, setEntries] = useState<LanguageEntry[]>([]);
  const [entryEdits, setEntryEdits] = useState<Record<string, boolean>>({});
  const [draftDefaults, setDraftDefaults] = useState<LanguageDefaults>({});
  const [draftAllowSingle, setDraftAllowSingle] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const activeLanguages = entries.filter((entry) => entry.active);
  const activeSourceLanguages = entries.filter((entry) => entry.active && entry.allowedAsSource);
  const activeTargetLanguages = entries.filter((entry) => entry.active && entry.allowedAsTarget);

  useEffect(() => {
    void invalidateLanguages();
  }, [currentUser?.id]);

  useEffect(() => {
    if (loading || dirty) return;
    const merged = mergeLanguageEntries(allLanguages);
    setEntries(merged);
    setDraftDefaults(normalizeDefaults(defaults));
    setDraftAllowSingle(Boolean(allowSingleLanguage));
  }, [allowSingleLanguage, allLanguages, defaults, dirty, loading]);

  useEffect(() => {
    const nextDefaults = sanitizeDefaults(draftDefaults, entries);
    if (!areDefaultsEqual(nextDefaults, draftDefaults)) {
      setDraftDefaults(nextDefaults);
      setDirty(true);
    }
  }, [draftDefaults, entries]);

  useEffect(() => {
    if (!saveNotice) return;
    const timer = window.setTimeout(() => setSaveNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    if (loading) return;
    const noLanguages = allLanguages.length === 0;
    const noActive = allLanguages.every((entry) => !entry.active);
    if (noLanguages || noActive) {
      setShowWizard(true);
    } else {
      setShowWizard(false);
    }
  }, [allLanguages, loading]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => formatLanguageEntryLabel(a).localeCompare(formatLanguageEntryLabel(b)));
  }, [entries]);

  const existingCanonicals = useMemo(
    () => new Set(entries.map((entry) => entry.canonical)),
    [entries]
  );

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (activeLanguages.length === 0) errors.push("Select at least one active language.");
    if (activeSourceLanguages.length === 0) errors.push("Select at least one allowed source language.");
    if (activeTargetLanguages.length === 0) errors.push("Select at least one allowed target language.");

    if (draftDefaults.defaultSource && !activeSourceLanguages.some((entry) => entry.canonical === draftDefaults.defaultSource)) {
      errors.push("Default source language must be allowed as a source.");
    }
    if ((draftDefaults.defaultTargets || []).some((value) => value === draftDefaults.defaultSource)) {
      errors.push("Default targets must differ from the source language.");
    }
    if ((draftDefaults.defaultTargets || []).some((value) => !activeTargetLanguages.some((entry) => entry.canonical === value))) {
      errors.push("Default targets must be allowed as targets.");
    }

    if (!draftAllowSingle && activeLanguages.length > 0 && activeLanguages.length < 2) {
      errors.push("Enable at least two languages or allow single-language termbases.");
    }
    return errors;
  }, [activeLanguages, activeSourceLanguages, activeTargetLanguages, draftAllowSingle, draftDefaults]);

  async function handleSave() {
    if (saving || validationErrors.length > 0) return;
    setSaveError(null);
    setSaving(true);
    try {
      const mergedEntries = mergeLanguageEntries(entries);
      const sanitizedDefaults = sanitizeDefaults(draftDefaults, mergedEntries);
      await saveLanguagesBulk(mergedEntries, sanitizedDefaults, draftAllowSingle);
      await invalidateLanguages();
      setDirty(false);
      setSaveNotice("Saved.");
    } catch (err: any) {
      console.error("Failed to save language settings", err);
      setSaveError(err?.userMessage || err?.message || "Failed to save language settings.");
    } finally {
      setSaving(false);
    }
  }

  function updateEntries(updater: (prev: LanguageEntry[]) => LanguageEntry[]) {
    setEntries((prev) => updater(prev));
    setDirty(true);
  }

  function setEntryField(canonical: string, updates: Partial<LanguageEntry>) {
    updateEntries((prev) =>
      prev.map((entry) => (entry.canonical === canonical ? { ...entry, ...updates } : entry))
    );
  }

  function toggleActive(entry: LanguageEntry) {
    const nextActive = !entry.active;
    setEntryField(entry.canonical, {
      active: nextActive,
      allowedAsSource:
        nextActive && !entry.allowedAsSource && !entry.allowedAsTarget ? true : entry.allowedAsSource,
      allowedAsTarget:
        nextActive && !entry.allowedAsSource && !entry.allowedAsTarget ? true : entry.allowedAsTarget
    });
    if (!nextActive && draftDefaults.defaultSource === entry.canonical) {
      setDraftDefaults((prev) => ({ ...prev, defaultSource: undefined }));
    }
    if (!nextActive && (draftDefaults.defaultTargets || []).includes(entry.canonical)) {
      setDraftDefaults((prev) => ({
        ...prev,
        defaultTargets: (prev.defaultTargets || []).filter((value) => value !== entry.canonical)
      }));
    }
  }

  function toggleAllowedSource(entry: LanguageEntry) {
    const nextAllowed = !entry.allowedAsSource;
    setEntryField(entry.canonical, { allowedAsSource: nextAllowed });
    if (!nextAllowed && draftDefaults.defaultSource === entry.canonical) {
      setDraftDefaults((prev) => ({ ...prev, defaultSource: undefined }));
    }
  }

  function toggleAllowedTarget(entry: LanguageEntry) {
    const nextAllowed = !entry.allowedAsTarget;
    setEntryField(entry.canonical, { allowedAsTarget: nextAllowed });
    if (!nextAllowed && (draftDefaults.defaultTargets || []).includes(entry.canonical)) {
      setDraftDefaults((prev) => ({
        ...prev,
        defaultTargets: (prev.defaultTargets || []).filter((value) => value !== entry.canonical)
      }));
    }
  }

  if (showWizard) {
    return (
      <div className="py-3">
        <LanguageWizard
          initialEntries={allLanguages}
          onComplete={async (wizardEntries, wizardDefaults) => {
            await saveLanguagesBulk(wizardEntries, wizardDefaults, draftAllowSingle);
            await invalidateLanguages();
            setDirty(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="py-3">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <div className="text-muted small">Admin</div>
          <h2 className="mb-0">Language settings</h2>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || loading || validationErrors.length > 0}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {saveError && <div className="alert alert-danger">{saveError}</div>}
      {saveNotice && <div className="alert alert-success py-2">{saveNotice}</div>}
      {loading && <div className="text-muted">Loading language settings...</div>}

      {!loading && (
        <div className="card-enterprise p-4">
          <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
            <div className="fw-semibold">Configured languages</div>
            <span className="text-muted small">{activeLanguages.length} active</span>
          </div>

          <AddLanguageInput
            existingCanonicals={existingCanonicals}
            onAdd={(locale) =>
              updateEntries((prev) =>
                mergeLanguageEntries([
                  ...prev,
                  {
                    canonical: locale.canonical,
                    language: locale.language,
                    region: locale.region,
                    active: true,
                    allowedAsSource: true,
                    allowedAsTarget: true
                  }
                ])
              )
            }
            disabled={saving}
          />

          <div className="table-responsive mt-3">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th style={{ width: "5%" }}>Flag</th>
                  <th>Display name</th>
                  <th>Canonical</th>
                  <th className="text-center">Active</th>
                  <th className="text-center">Allowed as Source</th>
                  <th className="text-center">Allowed as Target</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => {
                  const flag = languageFlagTag(entry);
                  const isEditing = entryEdits[entry.canonical] ?? false;
                  const rowId = entry.canonical.replace(/[^a-z0-9]/gi, "-");
                  return (
                    <tr key={entry.canonical}>
                      <td>
                        {flag ? (
                          <span className={`flag-icon fi fi-${flag}`} aria-hidden="true" />
                        ) : (
                          <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-control form-control-sm"
                            value={entry.displayName || ""}
                            onChange={(event) =>
                              setEntryField(entry.canonical, { displayName: event.target.value })
                            }
                            placeholder={formatLanguageEntryLabel(entry)}
                            disabled={saving}
                          />
                        ) : (
                          <span>{formatLanguageEntryLabel(entry)}</span>
                        )}
                      </td>
                      <td className="text-muted small">{entry.canonical}</td>
                      <td className="text-center">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`active-${rowId}`}
                          checked={entry.active}
                          onChange={() => toggleActive(entry)}
                          disabled={saving}
                        />
                      </td>
                      <td className="text-center">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`source-${rowId}`}
                          checked={entry.allowedAsSource}
                          onChange={() => toggleAllowedSource(entry)}
                          disabled={saving || !entry.active}
                        />
                      </td>
                      <td className="text-center">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`target-${rowId}`}
                          checked={entry.allowedAsTarget}
                          onChange={() => toggleAllowedTarget(entry)}
                          disabled={saving || !entry.active}
                        />
                      </td>
                      <td className="text-end">
                        <div className="btn-group btn-group-sm">
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() =>
                              setEntryEdits((prev) => ({
                                ...prev,
                                [entry.canonical]: !isEditing
                              }))
                            }
                            disabled={saving}
                          >
                            {isEditing ? "Done" : "Edit"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            onClick={() => toggleActive(entry)}
                            disabled={saving}
                          >
                            {entry.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sortedEntries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-muted text-center py-3">
                      No languages configured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="row g-4 mt-2">
            <div className="col-lg-6">
              <label className="form-label">Default source language (optional)</label>
              <LanguageSelect
                kind="source"
                value={draftDefaults.defaultSource || ""}
                onChange={(value) => {
                  setDraftDefaults((prev) => ({ ...prev, defaultSource: value || undefined }));
                  setDirty(true);
                }}
                includeEmpty
                emptyLabel="No default"
                optionsOverride={activeSourceLanguages}
                disabled={saving}
              />
            </div>
            <div className="col-lg-6">
              <label className="form-label d-flex align-items-center justify-content-between">
                <span>Default target languages (optional)</span>
                {(draftDefaults.defaultTargets || []).length > 0 && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0"
                    onClick={() => {
                      setDraftDefaults((prev) => ({ ...prev, defaultTargets: [] }));
                      setDirty(true);
                    }}
                  >
                    Clear all
                  </button>
                )}
              </label>
              <LanguageSelect
                kind="target"
                multi
                values={draftDefaults.defaultTargets || []}
                onChange={(values) => {
                  setDraftDefaults((prev) => ({ ...prev, defaultTargets: values }));
                  setDirty(true);
                }}
                optionsOverride={activeTargetLanguages}
                sourceValue={draftDefaults.defaultSource}
                disabled={saving}
                containerClassName="d-flex flex-wrap gap-3"
              />
            </div>
          </div>

          <div className="form-check mt-3">
            <input
              id="allow-single-language"
              className="form-check-input"
              type="checkbox"
              checked={draftAllowSingle}
              onChange={(event) => {
                setDraftAllowSingle(event.target.checked);
                setDirty(true);
              }}
              disabled={saving}
            />
            <label className="form-check-label" htmlFor="allow-single-language">
              Allow single-language termbases
            </label>
          </div>

          {validationErrors.length > 0 && (
            <div className="alert alert-warning mt-3 mb-0">
              {validationErrors.map((msg) => (
                <div key={msg}>{msg}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
