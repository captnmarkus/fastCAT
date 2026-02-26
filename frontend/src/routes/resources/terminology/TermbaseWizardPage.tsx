import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createTermbase, type TermbaseStructure } from "../../../api";
import LanguageSelect from "../../../features/languages/LanguageSelect";
import { useLanguages } from "../../../features/languages/hooks";
import { formatLanguageEntryLabel, languageFlagTag } from "../../../features/languages/utils";
import { normalizeLocale } from "../../../lib/i18n/locale";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";

type WizardStepKey = "basics" | "languages" | "structure" | "summary";

const STEP_ORDER: { key: WizardStepKey; label: string }[] = [
  { key: "basics", label: "Basics" },
  { key: "languages", label: "Languages" },
  { key: "structure", label: "Fields & structure" },
  { key: "summary", label: "Summary" }
];

function stepIndexForKey(key: WizardStepKey) {
  return Math.max(0, STEP_ORDER.findIndex((s) => s.key === key));
}

type StructureFieldDraft = {
  id: string;
  name: string;
  type: "text" | "picklist";
  valuesText: string;
};

type StructureDraft = {
  entry: StructureFieldDraft[];
  language: StructureFieldDraft[];
  term: StructureFieldDraft[];
};

type StructureSectionKey = keyof StructureDraft;

type WizardState = {
  name: string;
  description: string;
  visibility: string;
  includedLanguages: string[];
  defaultSourceLanguage: string | null;
  defaultTargetLanguage: string | null;
  allowSingleLanguage: boolean;
  templateChoice: "basic" | "advanced";
  structureDraft: StructureDraft;
};

function newFieldId() {
  return Math.random().toString(36).slice(2, 10);
}

function buildFieldDraft(name: string, type: "text" | "picklist", valuesText = ""): StructureFieldDraft {
  return { id: newFieldId(), name, type, valuesText };
}

function buildStructureDraft(template: "basic" | "advanced"): StructureDraft {
  if (template === "advanced") {
    return {
      entry: [buildFieldDraft("Subject", "picklist"), buildFieldDraft("Note", "text")],
      language: [
        buildFieldDraft("Definition", "text"),
        buildFieldDraft("Context", "text"),
        buildFieldDraft("Note", "text")
      ],
      term: [
        buildFieldDraft("Status", "picklist", "Preferred, Allowed, Forbidden"),
        buildFieldDraft("Part of speech", "text"),
        buildFieldDraft("Note", "text")
      ]
    };
  }
  return {
    entry: [buildFieldDraft("Subject", "picklist"), buildFieldDraft("Note", "text")],
    language: [buildFieldDraft("Definition", "text"), buildFieldDraft("Note", "text")],
    term: [
      buildFieldDraft("Status", "picklist", "Preferred, Allowed, Forbidden"),
      buildFieldDraft("Note", "text")
    ]
  };
}

function parsePicklistValues(input: string): string[] {
  return String(input || "")
    .split(/[,;|]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function toStructurePayload(draft: StructureDraft, template: "basic" | "advanced"): TermbaseStructure {
  const toField = (field: StructureFieldDraft) => {
    const name = field.name.trim();
    if (!name) return null;
    if (field.type === "picklist") {
      const values = parsePicklistValues(field.valuesText);
      return values.length > 0 ? { name, type: "picklist" as const, values } : { name, type: "picklist" as const };
    }
    return { name, type: "text" as const };
  };
  return {
    template,
    entry: draft.entry.map(toField).filter(Boolean) as TermbaseStructure["entry"],
    language: draft.language.map(toField).filter(Boolean) as TermbaseStructure["language"],
    term: draft.term.map(toField).filter(Boolean) as TermbaseStructure["term"]
  };
}

function isStructureDraftValid(draft: StructureDraft) {
  const fields = [...draft.entry, ...draft.language, ...draft.term];
  return fields.every((field) => {
    if (!field.name.trim()) return false;
    if (field.type === "picklist") {
      return parsePicklistValues(field.valuesText).length > 0;
    }
    return true;
  });
}

export default function TermbaseWizardPage() {
  const nav = useNavigate();

  const [step, setStep] = useState<WizardStepKey>("basics");
  const [languageSearch, setLanguageSearch] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [didInitLanguages, setDidInitLanguages] = useState(false);
  const {
    activeLanguages,
    activeSourceLanguages,
    activeTargetLanguages,
    defaults,
    allowSingleLanguage: orgAllowsSingleLanguage,
    loading: languageLoading,
    error: languageError
  } = useLanguages();

  const [wizard, setWizard] = useState<WizardState>(() => ({
    name: "",
    description: "",
    visibility: "managers",
    includedLanguages: [],
    defaultSourceLanguage: null,
    defaultTargetLanguage: null,
    allowSingleLanguage: false,
    templateChoice: "basic",
    structureDraft: buildStructureDraft("basic")
  }));

  const {
    name,
    description,
    visibility,
    includedLanguages,
    defaultSourceLanguage,
    defaultTargetLanguage,
    allowSingleLanguage,
    templateChoice,
    structureDraft
  } = wizard;

  const activeTags = useMemo(
    () => activeLanguages.map((entry) => entry.canonical),
    [activeLanguages]
  );
  const sourceTagSet = useMemo(
    () => new Set(activeSourceLanguages.map((entry) => entry.canonical)),
    [activeSourceLanguages]
  );
  const targetTagSet = useMemo(
    () => new Set(activeTargetLanguages.map((entry) => entry.canonical)),
    [activeTargetLanguages]
  );
  const orgDefaultSource = defaults.defaultSource ?? "";
  const orgDefaultTargets = defaults.defaultTargets ?? [];

  const languageOptions = useMemo(() => {
    return activeLanguages.map((entry) => ({
      entry,
      label: formatLanguageEntryLabel(entry)
    }));
  }, [activeLanguages]);

  const languageLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    languageOptions.forEach((opt) => {
      map.set(opt.entry.canonical, opt.label);
    });
    return map;
  }, [languageOptions]);

  const filteredLanguageOptions = useMemo(() => {
    const q = languageSearch.trim().toLowerCase();
    if (!q) return languageOptions;
    return languageOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.entry.canonical.toLowerCase().includes(q)
    );
  }, [languageOptions, languageSearch]);

  const selectedLanguageOptions = useMemo(() => {
    return includedLanguages.map((code) => ({
      value: code,
      label: languageLabelByCode.get(code) ?? code
    }));
  }, [includedLanguages, languageLabelByCode]);

  const allowedSourceOptions = useMemo(
    () => activeSourceLanguages.filter((entry) => includedLanguages.includes(entry.canonical)),
    [activeSourceLanguages, includedLanguages]
  );
  const allowedTargetOptions = useMemo(
    () => activeTargetLanguages.filter((entry) => includedLanguages.includes(entry.canonical)),
    [activeTargetLanguages, includedLanguages]
  );

  useEffect(() => {
    if (languageLoading || didInitLanguages) return;
    const allowSingleDefault = orgAllowsSingleLanguage && activeTags.length <= 1;
    let included = Array.from(new Set([orgDefaultSource, ...orgDefaultTargets].filter(Boolean)));
    included = included.filter((tag) => activeTags.includes(tag));
    if (included.length === 0) {
      included = activeTags.slice(0, allowSingleDefault ? 1 : 2);
    }
    const allowedSources = included.filter((tag) => sourceTagSet.has(tag));
    const resolvedSource =
      (orgDefaultSource && allowedSources.includes(orgDefaultSource) ? orgDefaultSource : allowedSources[0]) || null;
    let resolvedTarget: string | null = null;
    if (!allowSingleDefault) {
      const allowedTargets = included.filter(
        (tag) => tag !== resolvedSource && targetTagSet.has(tag)
      );
      const preferredTargets = orgDefaultTargets.filter(
        (tag) => tag !== resolvedSource && allowedTargets.includes(tag)
      );
      resolvedTarget = preferredTargets[0] ?? allowedTargets[0] ?? null;
    }
    setWizard((prev) => ({
      ...prev,
      includedLanguages: included,
      defaultSourceLanguage: resolvedSource,
      defaultTargetLanguage: resolvedTarget,
      allowSingleLanguage: allowSingleDefault
    }));
    setDidInitLanguages(true);
  }, [
    activeTags,
    didInitLanguages,
    languageLoading,
    orgAllowsSingleLanguage,
    orgDefaultSource,
    orgDefaultTargets,
    sourceTagSet,
    targetTagSet
  ]);

  useEffect(() => {
    if (languageLoading) return;
    setWizard((prev) => {
      const filtered = prev.includedLanguages.filter((tag) => activeTags.includes(tag));
      if (filtered.length === prev.includedLanguages.length) return prev;
      return { ...prev, includedLanguages: filtered };
    });
  }, [activeTags, languageLoading]);

  useEffect(() => {
    if (!allowSingleLanguage || includedLanguages.length <= 1) return;
    setWizard((prev) => ({ ...prev, includedLanguages: prev.includedLanguages.slice(0, 1) }));
  }, [allowSingleLanguage, includedLanguages]);

  useEffect(() => {
    if (orgAllowsSingleLanguage || !allowSingleLanguage) return;
    setWizard((prev) => ({ ...prev, allowSingleLanguage: false }));
  }, [allowSingleLanguage, orgAllowsSingleLanguage]);

  useEffect(() => {
    setWizard((prev) => {
      const included = prev.includedLanguages;
      const allowedSources = included.filter((tag) => sourceTagSet.has(tag));
      const allowedTargets = included.filter((tag) => targetTagSet.has(tag));
      let nextSource = prev.defaultSourceLanguage;
      let nextTarget = prev.defaultTargetLanguage;

      if (allowedSources.length === 0) {
        nextSource = null;
      } else if (!nextSource || !allowedSources.includes(nextSource)) {
        const fallbackSource =
          (orgDefaultSource && allowedSources.includes(orgDefaultSource)) ? orgDefaultSource : allowedSources[0];
        nextSource = fallbackSource ?? null;
      }

      if (prev.allowSingleLanguage || allowedTargets.length === 0) {
        nextTarget = null;
      } else if (!nextTarget || !allowedTargets.includes(nextTarget) || nextTarget === nextSource) {
        const preferredTargets = orgDefaultTargets.filter(
          (tag) => tag !== nextSource && allowedTargets.includes(tag)
        );
        nextTarget = preferredTargets[0] ?? allowedTargets.find((lang) => lang !== nextSource) ?? null;
      }

      if (nextSource === prev.defaultSourceLanguage && nextTarget === prev.defaultTargetLanguage) {
        return prev;
      }
      return { ...prev, defaultSourceLanguage: nextSource, defaultTargetLanguage: nextTarget };
    });
  }, [allowSingleLanguage, includedLanguages, orgDefaultSource, orgDefaultTargets, sourceTagSet, targetTagSet]);

  const basicsValid = Boolean(name.trim());
  const structureValid = isStructureDraftValid(structureDraft);
  const languagesValid = useMemo(() => {
    if (includedLanguages.length === 0 || !defaultSourceLanguage) return false;
    if (!sourceTagSet.has(defaultSourceLanguage)) return false;
    if (!includedLanguages.includes(defaultSourceLanguage)) return false;
    if (allowSingleLanguage) return includedLanguages.length === 1;
    if (includedLanguages.length < 2) return false;
    if (!defaultTargetLanguage) return false;
    if (defaultTargetLanguage === defaultSourceLanguage) return false;
    if (!targetTagSet.has(defaultTargetLanguage)) return false;
    return includedLanguages.includes(defaultTargetLanguage);
  }, [
    allowSingleLanguage,
    defaultSourceLanguage,
    defaultTargetLanguage,
    includedLanguages,
    sourceTagSet,
    targetTagSet
  ]);
  const summaryValid = basicsValid && languagesValid && structureValid;

  const canProceed = useMemo(() => {
    if (step === "basics") return basicsValid;
    if (step === "languages") return languagesValid;
    if (step === "structure") return structureValid;
    if (step === "summary") return summaryValid;
    return false;
  }, [basicsValid, languagesValid, structureValid, summaryValid, step]);

  const validationMessages = useMemo(() => {
    const messages: string[] = [];
    if (step === "basics") {
      if (!basicsValid) messages.push("Enter a termbase name.");
    } else if (step === "languages") {
      if (includedLanguages.length === 0) messages.push("Pick at least one language.");
      if (!allowSingleLanguage && includedLanguages.length < 2) {
        messages.push("Pick at least two languages.");
      }
      if (allowSingleLanguage && includedLanguages.length > 1) {
        messages.push("Single-language termbases can include only one language.");
      }
      if (!defaultSourceLanguage) messages.push("Select a default source language.");
      if (!allowSingleLanguage) {
        if (includedLanguages.length >= 2 && !defaultTargetLanguage) {
          messages.push("Select a default target language.");
        }
        if (defaultTargetLanguage && defaultTargetLanguage === defaultSourceLanguage) {
          messages.push("Target language must differ from source.");
        }
      }
    } else if (step === "structure") {
      if (!structureValid) messages.push("Fill out field names and picklist values.");
    } else if (step === "summary") {
      if (!basicsValid) messages.push("Termbase name is required.");
      if (!languagesValid) messages.push("Language settings are incomplete.");
      if (!structureValid) messages.push("Structure fields are incomplete.");
    }
    return messages;
  }, [
    allowSingleLanguage,
    basicsValid,
    defaultSourceLanguage,
    defaultTargetLanguage,
    includedLanguages.length,
    languagesValid,
    step,
    structureValid
  ]);

  const sidePanel = useMemo(() => {
    if (step === "basics") {
      return {
        title: "Basics",
        tips: [
          "Give the termbase a clear, searchable name.",
          "Visibility controls who can access and edit it.",
          "Default source language is set in the Languages step."
        ]
      };
    }
    if (step === "languages") {
      return {
        title: "Language setup",
        tips: [
          "Included languages define the termbase scope.",
          "Default source drives the entry list and search.",
          allowSingleLanguage ? "Single-language mode skips the target language." : "Pick a target different from source."
        ]
      };
    }
    if (step === "structure") {
      return {
        title: "Structure",
        tips: [
          "Start with a template, then adjust field names.",
          "Picklists need comma-separated values.",
          "Entry, language, and term fields show in the editor."
        ]
      };
    }
    return {
      title: "Summary",
      tips: ["Review the details, then create the termbase."]
    };
  }, [allowSingleLanguage, step]);

  function toggleLanguage(value: string) {
    const normalized = normalizeLocale(value).canonical;
    if (!normalized) return;
    setWizard((prev) => {
      const isSelected = prev.includedLanguages.includes(normalized);
      let nextLanguages: string[];
      if (prev.allowSingleLanguage) {
        nextLanguages = isSelected ? [] : [normalized];
      } else {
        nextLanguages = isSelected
          ? prev.includedLanguages.filter((lang) => lang !== normalized)
          : [...prev.includedLanguages, normalized];
      }
      return { ...prev, includedLanguages: nextLanguages };
    });
  }

  function updateDraft(section: StructureSectionKey, fieldId: string, patch: Partial<StructureFieldDraft>) {
    setWizard((prev) => ({
      ...prev,
      structureDraft: {
        ...prev.structureDraft,
        [section]: prev.structureDraft[section].map((field) =>
          field.id === fieldId ? { ...field, ...patch } : field
        )
      }
    }));
  }

  function addField(section: StructureSectionKey) {
    setWizard((prev) => ({
      ...prev,
      structureDraft: {
        ...prev.structureDraft,
        [section]: [...prev.structureDraft[section], buildFieldDraft("New field", "text")]
      }
    }));
  }

  function removeField(section: StructureSectionKey, fieldId: string) {
    setWizard((prev) => ({
      ...prev,
      structureDraft: {
        ...prev.structureDraft,
        [section]: prev.structureDraft[section].filter((field) => field.id !== fieldId)
      }
    }));
  }

  async function handleCreate() {
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      visibility,
      languages: includedLanguages,
      defaultSourceLang: defaultSourceLanguage,
      defaultTargetLang: allowSingleLanguage ? null : defaultTargetLanguage,
      allowSingleLanguage,
      template: templateChoice,
      structure: toStructurePayload(structureDraft, templateChoice)
    };

    setCreateLoading(true);
    setCreateError(null);
    try {
      const created = await createTermbase(payload);
      nav(`/resources/termbases/${created.id}/entries`, { replace: true });
    } catch (err: any) {
      setCreateError(err?.userMessage || err?.message || "Failed to create termbase.");
    } finally {
      setCreateLoading(false);
    }
  }

  function goToStep(next: WizardStepKey) {
    setCreateError(null);
    setStep(next);
  }

  function handleNext() {
    const index = stepIndexForKey(step);
    const next = STEP_ORDER[index + 1]?.key;
    if (!next || !canProceed) return;
    goToStep(next);
  }

  function handleBack() {
    const index = stepIndexForKey(step);
    const prev = STEP_ORDER[index - 1]?.key;
    if (!prev) return;
    goToStep(prev);
  }

  function formatLanguageCodeLabel(code: string | null) {
    if (!code) return "-";
    return languageLabelByCode.get(code) ?? code;
  }

  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Terminology"
        title="New Termbase"
        onCancel={() => nav("/resources/terminology")}
        cancelDisabled={createLoading}
        steps={STEP_ORDER}
        currentStep={step}
        onStepSelect={goToStep}
        canSelectStep={(_key, index, currentIndex) => index < currentIndex && !createLoading}
        alerts={
          <>
            {createError ? <WarningBanner tone="error" messages={[createError]} /> : null}
            {createLoading ? <WarningBanner tone="info" messages={["Creating termbase..."]} /> : null}
          </>
        }
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={handleBack}
              disabled={createLoading || step === "basics"}
            >
              Back
            </button>
            {step === "summary" ? (
              <button
                type="button"
                className="btn btn-primary fw-semibold"
                onClick={handleCreate}
                disabled={!summaryValid || createLoading}
              >
                {createLoading ? "Creating..." : "Create termbase"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-dark"
                onClick={handleNext}
                disabled={!canProceed || createLoading}
              >
                Next
              </button>
            )}
          </div>
        }
      >
        <div className="row g-4">
          <div className="col-lg-8">
            {step === "basics" && (
              <>
                <div className="fw-semibold mb-2">Basics</div>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label small text-uppercase text-muted">Termbase name</label>
                    <input
                      className="form-control"
                      value={name}
                      onChange={(e) => setWizard((prev) => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label small text-uppercase text-muted">Description (optional)</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={description}
                      onChange={(e) => setWizard((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small text-uppercase text-muted">Visibility</label>
                    <select
                      className="form-select"
                      value={visibility}
                      onChange={(e) => setWizard((prev) => ({ ...prev, visibility: e.target.value }))}
                    >
                      <option value="managers">Managers & Admins</option>
                      <option value="admins">Admins only</option>
                      <option value="private">Private</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {step === "languages" && (
              <>
                <div className="fw-semibold mb-2">Languages</div>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label small text-uppercase text-muted mb-2">Included languages</label>
                    <input
                      className="form-control form-control-sm mb-2"
                      placeholder="Search languages"
                      value={languageSearch}
                      onChange={(e) => setLanguageSearch(e.target.value)}
                      disabled={languageLoading}
                    />
                    <div className="border rounded p-2 bg-white" style={{ maxHeight: 260, overflow: "auto" }}>
                      {languageLoading && <div className="text-muted small">Loading languages...</div>}
                      {!languageLoading &&
                        filteredLanguageOptions.map((opt) => {
                          const code = opt.entry.canonical;
                          const flag = languageFlagTag(opt.entry);
                          return (
                            <div key={code} className="form-check">
                              <input
                                id={`lang-${code}`}
                                type="checkbox"
                                className="form-check-input"
                                checked={includedLanguages.includes(code)}
                                onChange={() => toggleLanguage(code)}
                              />
                              <label className="form-check-label d-flex align-items-center gap-2" htmlFor={`lang-${code}`}>
                                {flag ? (
                                  <span className={`flag-icon fi fi-${flag}`} aria-hidden="true" />
                                ) : (
                                  <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
                                )}
                                <span>{opt.label}</span>
                                <span className="text-muted small">{code}</span>
                              </label>
                            </div>
                          );
                        })}
                      {!languageLoading && filteredLanguageOptions.length === 0 && (
                        <div className="text-muted small">No languages match your search.</div>
                      )}
                    </div>
                  </div>
                  {languageError && (
                    <div className="col-12">
                      <div className="alert alert-warning py-2">{languageError}</div>
                    </div>
                  )}
                  {orgAllowsSingleLanguage && (
                    <div className="col-12">
                      <div className="form-check">
                        <input
                          id="allow-single-language"
                          type="checkbox"
                          className="form-check-input"
                          checked={allowSingleLanguage}
                          onChange={(e) =>
                            setWizard((prev) => ({
                              ...prev,
                              allowSingleLanguage: e.target.checked,
                              includedLanguages: e.target.checked
                                ? prev.includedLanguages.slice(0, 1)
                                : prev.includedLanguages
                            }))
                          }
                        />
                        <label className="form-check-label" htmlFor="allow-single-language">
                          Single-language termbase
                        </label>
                      </div>
                    </div>
                  )}
                  <div className="col-md-6">
                    <label className="form-label small text-uppercase text-muted">Default source language</label>
                    <LanguageSelect
                      kind="source"
                      value={defaultSourceLanguage ?? ""}
                      onChange={(value) =>
                        setWizard((prev) => ({
                          ...prev,
                          defaultSourceLanguage: value || null
                        }))
                      }
                      includeEmpty
                      emptyLabel="Select source"
                      optionsOverride={allowedSourceOptions}
                      disabled={includedLanguages.length === 0 || languageLoading}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small text-uppercase text-muted">Default target language</label>
                    <LanguageSelect
                      kind="target"
                      value={defaultTargetLanguage ?? ""}
                      onChange={(value) =>
                        setWizard((prev) => ({
                          ...prev,
                          defaultTargetLanguage: value || null
                        }))
                      }
                      includeEmpty
                      emptyLabel="Select target"
                      optionsOverride={allowedTargetOptions}
                      sourceValue={defaultSourceLanguage ?? ""}
                      disabled={allowSingleLanguage || includedLanguages.length < 2 || languageLoading}
                    />
                  </div>
                </div>
              </>
            )}

            {step === "structure" && (
              <>
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                  <div>
                    <div className="fw-semibold">Fields & structure</div>
                    <div className="text-muted small">
                      Start from a template and customize entry, language, and term fields.
                    </div>
                  </div>
                  <select
                    className="form-select form-select-sm"
                    style={{ width: 160 }}
                    value={templateChoice}
                    onChange={(e) =>
                      setWizard((prev) => {
                        const next = e.target.value === "advanced" ? "advanced" : "basic";
                        return { ...prev, templateChoice: next, structureDraft: buildStructureDraft(next) };
                      })
                    }
                  >
                    <option value="basic">Basic</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
                {(["entry", "language", "term"] as StructureSectionKey[]).map((section) => (
                  <div key={section} className="mb-3">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <div className="fw-semibold text-capitalize">{section} fields</div>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => addField(section)}
                      >
                        Add field
                      </button>
                    </div>
                    <div className="d-grid gap-2">
                      {structureDraft[section].map((field) => (
                        <div key={field.id} className="border rounded p-2 bg-white">
                          <div className="row g-2 align-items-center m-0">
                            <div className="col-md-4 px-1">
                              <input
                                className="form-control form-control-sm"
                                value={field.name}
                                onChange={(e) => updateDraft(section, field.id, { name: e.target.value })}
                              />
                            </div>
                            <div className="col-md-3 px-1">
                              <select
                                className="form-select form-select-sm"
                                value={field.type}
                                onChange={(e) =>
                                  updateDraft(section, field.id, {
                                    type: e.target.value === "picklist" ? "picklist" : "text"
                                  })
                                }
                              >
                                <option value="text">Text</option>
                                <option value="picklist">Picklist</option>
                              </select>
                            </div>
                            <div className="col-md-3 px-1">
                              {field.type === "picklist" ? (
                                <input
                                  className="form-control form-control-sm"
                                  placeholder="Comma separated values"
                                  value={field.valuesText}
                                  onChange={(e) => updateDraft(section, field.id, { valuesText: e.target.value })}
                                />
                              ) : (
                                <div className="text-muted small">Text field</div>
                              )}
                            </div>
                            <div className="col-md-2 px-1 text-end">
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                onClick={() => removeField(section, field.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {structureDraft[section].length === 0 && (
                        <div className="text-muted small">No fields defined.</div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            {step === "summary" && (
              <>
                <div className="fw-semibold mb-2">Summary</div>
                <div className="row g-3">
                  <div className="col-lg-6">
                    <div className="text-muted small">Termbase name</div>
                    <div className="fw-semibold">{name.trim() || "-"}</div>
                  </div>
                  <div className="col-lg-6">
                    <div className="text-muted small">Visibility</div>
                    <div className="fw-semibold">{visibility}</div>
                  </div>
                  <div className="col-12">
                    <div className="text-muted small">Languages</div>
                    <div className="fw-semibold">
                      {selectedLanguageOptions.map((opt) => opt.label).join(", ") || "-"}
                    </div>
                  </div>
                  <div className="col-lg-6">
                    <div className="text-muted small">Default source</div>
                    <div className="fw-semibold">{formatLanguageCodeLabel(defaultSourceLanguage)}</div>
                  </div>
                  <div className="col-lg-6">
                    <div className="text-muted small">Default target</div>
                    <div className="fw-semibold">
                      {allowSingleLanguage ? "-" : formatLanguageCodeLabel(defaultTargetLanguage)}
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="text-muted small">Template</div>
                    <div className="fw-semibold">{templateChoice}</div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="col-lg-4">
            <div className="border rounded p-3 bg-light h-100">
              <div className="fw-semibold mb-2">{sidePanel.title}</div>
              {validationMessages.length > 0 && (
                <div className="alert alert-warning py-2">
                  {validationMessages.map((msg) => (
                    <div key={msg} className="small">
                      {msg}
                    </div>
                  ))}
                </div>
              )}
              {sidePanel.tips.map((tip) => (
                <div key={tip} className="text-muted small mb-2">
                  {tip}
                </div>
              ))}
            </div>
          </div>
        </div>
      </WizardShell>
    </div>
  );
}
