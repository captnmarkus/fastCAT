import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import {
  checkProjectTemplateNameAvailable,
  createProjectTemplate,
  getProjectTemplate,
  listEnabledFileTypeConfigs,
  listGlossaries,
  listLanguageProcessingRulesets,
  listTmSamples,
  listTranslationEngines,
  updateProjectTemplate,
  type FileTypeConfig,
  type GlossaryOption,
  type LanguageProcessingRuleset,
  type ProjectTemplate,
  type SampleAsset,
  type TranslationEngine
} from "../../../api";
import LanguageSelect from "../../../features/languages/LanguageSelect";
import TargetLanguagesMultiSelect from "../../projects/shared/components/TargetLanguagesMultiSelect";
import { LanguagePairLabel } from "../../../components/LanguageLabel";
import { normalizeLocale } from "../../../lib/i18n/locale";
import { formatLanguageEntryLabel, languageFlagTag } from "../../../features/languages/utils";
import { useLanguages } from "../../../features/languages/hooks";
import { parsePositiveInt } from "../../../utils/ids";
import {
  normalizeTargetKey,
  normalizeTargetList,
  parseOptionalInt,
  sanitizeOverrideMap
} from "./ProjectTemplateWizard.helpers";
import ProjectTemplateOverridesTable from "./ProjectTemplateOverridesTable";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";
type WizardStepKey = "basics" | "languages" | "defaults" | "policy" | "review";
type NameCheckStatus = "idle" | "checking" | "available" | "duplicate" | "error";
const STEP_ORDER: Array<{ key: WizardStepKey; label: string }> = [
  { key: "basics", label: "Basics" },
  { key: "languages", label: "Languages" },
  { key: "defaults", label: "Defaults" },
  { key: "policy", label: "Permissions & policy" },
  { key: "review", label: "Review & Save" }
];
const DEFAULT_SETTINGS = {
  canEditSource: false,
  canDownloadSource: false,
  canDownloadTranslated: true,
  canExportIntermediate: false,
  autoCreateInboxItems: true,
  completionPolicy: "assignee"
};
const INHERIT_VALUE = "__inherit__";
function stepIndexForKey(key: WizardStepKey) {
  return Math.max(0, STEP_ORDER.findIndex((s) => s.key === key));
}
export default function ProjectTemplateWizardPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const params = useParams();
  const templateId = parsePositiveInt(params.id);
  const isEdit = templateId != null;
  const [step, setStep] = useState<WizardStepKey>("basics");
  const [showValidation, setShowValidation] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [sourceLang, setSourceLang] = useState("");
  const [targetLangs, setTargetLangs] = useState<string[]>([]);
  const [translationEngineIdRaw, setTranslationEngineIdRaw] = useState("");
  const [fileTypeConfigIdRaw, setFileTypeConfigIdRaw] = useState("");
  const [defaultTmxIdRaw, setDefaultTmxIdRaw] = useState("");
  const [defaultRulesetIdRaw, setDefaultRulesetIdRaw] = useState("");
  const [defaultGlossaryIdRaw, setDefaultGlossaryIdRaw] = useState("");
  const [tmxByTargetLang, setTmxByTargetLang] = useState<Record<string, number | null>>({});
  const [rulesetByTargetLang, setRulesetByTargetLang] = useState<Record<string, number | null>>({});
  const [glossaryByTargetLang, setGlossaryByTargetLang] = useState<Record<string, number | null>>({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tmSamples, setTmSamples] = useState<SampleAsset[]>([]);
  const [glossaries, setGlossaries] = useState<GlossaryOption[]>([]);
  const [rulesets, setRulesets] = useState<LanguageProcessingRuleset[]>([]);
  const [translationEngines, setTranslationEngines] = useState<TranslationEngine[]>([]);
  const [fileTypeConfigs, setFileTypeConfigs] = useState<FileTypeConfig[]>([]);
  const [nameStatus, setNameStatus] = useState<NameCheckStatus>("idle");
  const nameCheckSeq = useRef(0);
  const { activeTargetLanguages } = useLanguages();
  const targetMetaByTag = useMemo(() => {
    const map = new Map<string, { label: string; flag?: string }>();
    activeTargetLanguages.forEach((entry) => {
      map.set(entry.canonical, {
        label: formatLanguageEntryLabel(entry),
        flag: languageFlagTag(entry)
      });
    });
    return map;
  }, [activeTargetLanguages]);
  const translationEngineId = useMemo(() => parseOptionalInt(translationEngineIdRaw), [translationEngineIdRaw]);
  const fileTypeConfigId = useMemo(() => parseOptionalInt(fileTypeConfigIdRaw), [fileTypeConfigIdRaw]);
  const defaultTmxId = useMemo(() => parseOptionalInt(defaultTmxIdRaw), [defaultTmxIdRaw]);
  const defaultRulesetId = useMemo(() => parseOptionalInt(defaultRulesetIdRaw), [defaultRulesetIdRaw]);
  const defaultGlossaryId = useMemo(() => parseOptionalInt(defaultGlossaryIdRaw), [defaultGlossaryIdRaw]);
  const tmSampleById = useMemo(() => {
    const map = new Map<number, SampleAsset>();
    tmSamples.forEach((sample) => {
      const id = parsePositiveInt(sample.tmId);
      if (id != null) {
        map.set(id, sample);
      }
    });
    return map;
  }, [tmSamples]);
  const rulesetById = useMemo(() => new Map(rulesets.map((entry) => [entry.id, entry])), [rulesets]);
  const glossaryById = useMemo(() => new Map(glossaries.map((entry) => [entry.id, entry])), [glossaries]);
  const engineById = useMemo(() => new Map(translationEngines.map((entry) => [entry.id, entry])), [translationEngines]);
  const fileTypeById = useMemo(() => new Map(fileTypeConfigs.map((entry) => [entry.id, entry])), [fileTypeConfigs]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [
          tmList,
          glossaryList,
          rulesetList,
          engineList,
          fileTypeList,
          templateRes
        ] = await Promise.all([
          listTmSamples().catch(() => [] as SampleAsset[]),
          listGlossaries().catch(() => [] as GlossaryOption[]),
          listLanguageProcessingRulesets().catch(() => [] as LanguageProcessingRuleset[]),
          listTranslationEngines().catch(() => [] as TranslationEngine[]),
          listEnabledFileTypeConfigs().catch(() => [] as FileTypeConfig[]),
          isEdit ? getProjectTemplate(templateId) : Promise.resolve(null)
        ]);
        if (cancelled) return;
        setTmSamples(tmList);
        setGlossaries(glossaryList.filter((g) => !g.disabled));
        setRulesets(rulesetList.filter((r) => !r.disabled));
        setTranslationEngines(engineList.filter((engine) => !engine.disabled));
        setFileTypeConfigs(fileTypeList);
        if (templateRes) {
          const tpl = templateRes as ProjectTemplate;
          setName(tpl.name || "");
          setDescription(tpl.description || "");
          setScope(tpl.scope || "");
          setDisabled(Boolean(tpl.disabled));
          const src = normalizeLocale(String(tpl.languages?.src || "")).canonical;
          setSourceLang(src);
          const targets = normalizeTargetList(tpl.languages?.targets || []);
          setTargetLangs(targets);
          setTranslationEngineIdRaw(tpl.translationEngineId != null ? String(tpl.translationEngineId) : "");
          setFileTypeConfigIdRaw(tpl.fileTypeConfigId != null ? String(tpl.fileTypeConfigId) : "");
          setDefaultTmxIdRaw(tpl.defaultTmxId != null ? String(tpl.defaultTmxId) : "");
          setDefaultRulesetIdRaw(tpl.defaultRulesetId != null ? String(tpl.defaultRulesetId) : "");
          setDefaultGlossaryIdRaw(tpl.defaultGlossaryId != null ? String(tpl.defaultGlossaryId) : "");
          setSettings({ ...DEFAULT_SETTINGS, ...(tpl.settings || {}) });
          const tmxIds = new Set<number>();
          tmList.forEach((sample) => {
            if (sample.tmId != null) tmxIds.add(Number(sample.tmId));
          });
          const rulesetIds = new Set(rulesetList.filter((r) => !r.disabled).map((entry) => entry.id));
          const glossaryIds = new Set(glossaryList.filter((g) => !g.disabled).map((entry) => entry.id));
          setTmxByTargetLang(sanitizeOverrideMap(tpl.tmxByTargetLang || {}, targets, tmxIds));
          setRulesetByTargetLang(sanitizeOverrideMap(tpl.rulesetByTargetLang || {}, targets, rulesetIds));
          setGlossaryByTargetLang(sanitizeOverrideMap(tpl.glossaryByTargetLang || {}, targets, glossaryIds));
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.userMessage || err?.message || "Failed to load template wizard.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, templateId]);
  useEffect(() => {
    setNameStatus("idle");
  }, [name]);
  useEffect(() => {
    if (!name.trim()) {
      setNameStatus("idle");
      return;
    }
    const seq = ++nameCheckSeq.current;
    setNameStatus("checking");
    const handle = window.setTimeout(() => {
      (async () => {
        try {
          const available = await checkProjectTemplateNameAvailable({
            name: name.trim(),
            excludeId: isEdit ? templateId : null
          });
          if (seq !== nameCheckSeq.current) return;
          setNameStatus(available ? "available" : "duplicate");
        } catch {
          if (seq !== nameCheckSeq.current) return;
          setNameStatus("error");
        }
      })();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [isEdit, name, templateId]);
  useEffect(() => {
    const normalizedTargets = normalizeTargetList(targetLangs);
    if (normalizedTargets.join("|") !== targetLangs.join("|")) {
      setTargetLangs(normalizedTargets);
      return;
    }
    const tmxIds = new Set(Array.from(tmSampleById.keys()));
    const rulesetIds = new Set(rulesets.map((entry) => entry.id));
    const glossaryIds = new Set(glossaries.map((entry) => entry.id));
    setTmxByTargetLang((prev) => sanitizeOverrideMap(prev, normalizedTargets, tmxIds));
    setRulesetByTargetLang((prev) => sanitizeOverrideMap(prev, normalizedTargets, rulesetIds));
    setGlossaryByTargetLang((prev) => sanitizeOverrideMap(prev, normalizedTargets, glossaryIds));
  }, [glossaries, rulesets, targetLangs, tmSampleById]);
  const nameError = useMemo(() => {
    if (!name.trim()) return "Template name is required.";
    if (nameStatus === "duplicate") return "A template with this name already exists.";
    if (nameStatus === "error") return "Could not verify name availability.";
    return null;
  }, [name, nameStatus]);
  const languageSummary = useMemo(() => {
    if (!sourceLang || targetLangs.length === 0) return null;
    const first = targetLangs[0];
    return { source: sourceLang, target: first, extra: Math.max(0, targetLangs.length - 1) };
  }, [sourceLang, targetLangs]);
  const defaultEngine = translationEngineId != null ? engineById.get(translationEngineId) ?? null : null;
  const defaultRuleset = defaultRulesetId != null ? rulesetById.get(defaultRulesetId) ?? null : null;
  const defaultGlossary = defaultGlossaryId != null ? glossaryById.get(defaultGlossaryId) ?? null : null;
  const defaultTmx = defaultTmxId != null ? tmSampleById.get(defaultTmxId) ?? null : null;
  const overridesCount = useMemo(() => {
    const tmxCount = Object.keys(tmxByTargetLang).length;
    const rulesCount = Object.keys(rulesetByTargetLang).length;
    const glossaryCount = Object.keys(glossaryByTargetLang).length;
    return { tmxCount, rulesCount, glossaryCount };
  }, [glossaryByTargetLang, rulesetByTargetLang, tmxByTargetLang]);
  const completionPolicyLabel = settings.completionPolicy === "reviewer"
    ? "Reviewer/admin only"
    : "Assignee can mark complete";
  async function runNameCheck() {
    if (!name.trim()) {
      setNameStatus("idle");
      return "empty";
    }
    const seq = ++nameCheckSeq.current;
    setNameStatus("checking");
    try {
      const available = await checkProjectTemplateNameAvailable({
        name: name.trim(),
        excludeId: isEdit ? templateId : null
      });
      if (seq !== nameCheckSeq.current) return null;
      setNameStatus(available ? "available" : "duplicate");
      return available ? "available" : "duplicate";
    } catch {
      if (seq !== nameCheckSeq.current) return null;
      setNameStatus("error");
      return "error";
    }
  }
  async function validateBasics(): Promise<string | null> {
    const status = await runNameCheck();
    if (!name.trim()) return "Template name is required.";
    if (status === "duplicate") return "A template with this name already exists.";
    if (status === "error") return "Could not verify name availability.";
    return null;
  }
  function validateLanguages(): string | null {
    if (!sourceLang) return "Source language is required.";
    if (targetLangs.length === 0) return "Select at least one target language.";
    return null;
  }
  async function goNext() {
    const idx = stepIndexForKey(step);
    const next = STEP_ORDER[idx + 1]?.key;
    if (!next) return;
    setError(null);
    if (step === "basics") {
      const basicsError = await validateBasics();
      if (basicsError) {
        setShowValidation(true);
        setError(basicsError);
        return;
      }
    }
    if (step === "languages") {
      const langError = validateLanguages();
      if (langError) {
        setShowValidation(true);
        setError(langError);
        return;
      }
    }
    setStep(next);
  }
  function goBack() {
    const idx = stepIndexForKey(step);
    const prev = STEP_ORDER[idx - 1]?.key;
    if (prev) setStep(prev);
  }
  function setOverrideValue(
    target: string,
    rawValue: string,
    setter: React.Dispatch<React.SetStateAction<Record<string, number | null>>>
  ) {
    const key = normalizeTargetKey(target);
    if (!key) return;
    setter((prev) => {
      if (rawValue === INHERIT_VALUE) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (!rawValue) {
        return { ...prev, [key]: null };
      }
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed <= 0) return prev;
      return { ...prev, [key]: parsed };
    });
  }
  function applyGlobalDefaults() {
    const nextTargets = normalizeTargetList(targetLangs);
    setTmxByTargetLang(() => {
      const next: Record<string, number | null> = {};
      nextTargets.forEach((target) => {
        next[target] = defaultTmxId ?? null;
      });
      return next;
    });
    setRulesetByTargetLang(() => {
      const next: Record<string, number | null> = {};
      nextTargets.forEach((target) => {
        next[target] = defaultRulesetId ?? null;
      });
      return next;
    });
    setGlossaryByTargetLang(() => {
      const next: Record<string, number | null> = {};
      nextTargets.forEach((target) => {
        next[target] = defaultGlossaryId ?? null;
      });
      return next;
    });
  }
  function clearAllOverrides() {
    setTmxByTargetLang({});
    setRulesetByTargetLang({});
    setGlossaryByTargetLang({});
  }
  async function handleSave() {
    setShowValidation(true);
    setError(null);
    const basicsError = await validateBasics();
    if (basicsError) {
      setError(basicsError);
      setStep("basics");
      return;
    }
    const langError = validateLanguages();
    if (langError) {
      setError(langError);
      setStep("languages");
      return;
    }
    const normalizedTargets = normalizeTargetList(targetLangs);
    const tmxIds = new Set(Array.from(tmSampleById.keys()));
    const rulesetIds = new Set(rulesets.map((entry) => entry.id));
    const glossaryIds = new Set(glossaries.map((entry) => entry.id));
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      scope: scope.trim() || undefined,
      disabled,
      languages: {
        src: sourceLang,
        targets: normalizedTargets
      },
      translationEngineId,
      fileTypeConfigId,
      defaultTmxId,
      defaultRulesetId,
      defaultGlossaryId,
      tmxByTargetLang: sanitizeOverrideMap(tmxByTargetLang, normalizedTargets, tmxIds),
      rulesetByTargetLang: sanitizeOverrideMap(rulesetByTargetLang, normalizedTargets, rulesetIds),
      glossaryByTargetLang: sanitizeOverrideMap(glossaryByTargetLang, normalizedTargets, glossaryIds),
      settings: settings
    };
    setSaving(true);
    try {
      const saved = isEdit
        ? await updateProjectTemplate(templateId, payload)
        : await createProjectTemplate(payload);
      nav(`/resources/templates/${saved.id}`);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to save project template.");
    } finally {
      setSaving(false);
    }
  }
  const headerTitle = isEdit ? "Edit Project Template" : "New Project Template";
  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Project Templates"
        title={headerTitle}
        onCancel={() => nav("/resources/templates")}
        cancelDisabled={saving}
        steps={STEP_ORDER}
        currentStep={step}
        onStepSelect={setStep}
        canSelectStep={(_key, index, currentIndex) => index < currentIndex && !saving}
        alerts={error ? <WarningBanner tone="error" messages={[error]} /> : null}
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={goBack}
              disabled={saving || step === "basics"}
            >
              Back
            </button>
            {step === "review" ? (
              <button
                type="button"
                className="btn btn-primary fw-semibold"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Template"}
              </button>
            ) : (
              <button type="button" className="btn btn-dark" onClick={() => void goNext()} disabled={saving}>
                Next
              </button>
            )}
          </div>
        }
      >
        {loading ? (
        <div className="text-muted p-3">Loading template wizard...</div>
      ) : (
        <div className="card-enterprise p-4">
          <div className="row g-3">
            {step === "basics" && (
              <>
                <div className="col-md-8">
                  <label className="form-label small text-uppercase text-muted">Name</label>
                  <input
                    className={`form-control${showValidation && nameError ? " is-invalid" : ""}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => void runNameCheck()}
                    disabled={saving}
                  />
                  {nameStatus === "checking" && <div className="form-text text-muted">Checking name...</div>}
                  {showValidation && nameError && <div className="invalid-feedback d-block">{nameError}</div>}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-uppercase text-muted">Scope / Location</label>
                  <input
                    className="form-control"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="e.g. Root"
                    disabled={saving}
                  />
                </div>
                <div className="col-12">
                  <label className="form-label small text-uppercase text-muted">Description (optional)</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-uppercase text-muted">Status</label>
                  <select
                    className="form-select"
                    value={disabled ? "disabled" : "enabled"}
                    onChange={(e) => setDisabled(e.target.value === "disabled")}
                    disabled={saving}
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <div className="col-md-8">
                  <label className="form-label small text-uppercase text-muted">File Type Configuration (optional)</label>
                  <select
                    className="form-select"
                    value={fileTypeConfigIdRaw}
                    onChange={(e) => setFileTypeConfigIdRaw(e.target.value)}
                    disabled={saving || fileTypeConfigs.length === 0}
                  >
                    <option value="">None</option>
                    {fileTypeConfigs.map((cfg) => (
                      <option key={cfg.id} value={String(cfg.id)}>
                        {cfg.name}
                      </option>
                    ))}
                  </select>
                  {fileTypeConfigs.length === 0 && (
                    <div className="form-text text-muted">No file type configurations available.</div>
                  )}
                </div>
              </>
            )}
            {step === "languages" && (
              <>
                <div className="col-md-4">
                  <label className="form-label small text-uppercase text-muted">Source language</label>
                  <LanguageSelect
                    kind="source"
                    value={sourceLang}
                    onChange={(value) => setSourceLang(value)}
                    disabled={saving}
                    className={`form-select${showValidation && !sourceLang ? " is-invalid" : ""}`}
                  />
                  {showValidation && !sourceLang && (
                    <div className="invalid-feedback d-block">Source language is required.</div>
                  )}
                </div>
                <div className="col-md-8">
                  <label className="form-label small text-uppercase text-muted">Allowed target languages</label>
                  <TargetLanguagesMultiSelect
                    value={targetLangs}
                    onChange={setTargetLangs}
                    sourceLang={sourceLang}
                    disabled={saving}
                  />
                  {showValidation && targetLangs.length === 0 && (
                    <div className="text-danger small mt-1">Select at least one target language.</div>
                  )}
                </div>
                {languageSummary && (
                  <div className="col-12">
                    <div className="text-muted small">Summary</div>
                    <div className="d-flex align-items-center gap-2">
                      <LanguagePairLabel source={languageSummary.source} target={languageSummary.target} />
                      {languageSummary.extra > 0 && (
                        <span className="text-muted small">+{languageSummary.extra}</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {step === "defaults" && (
              <>
                <div className="col-12">
                  <div className="card-enterprise">
                    <div className="card-body">
                      <div className="fw-semibold mb-2">Global defaults</div>
                      <div className="row g-3">
                        <div className="col-md-6">
                          <label className="form-label small text-uppercase text-muted">Default translation engine</label>
                          <select
                            className="form-select"
                            value={translationEngineIdRaw}
                            onChange={(e) => setTranslationEngineIdRaw(e.target.value)}
                            disabled={saving}
                          >
                            <option value="">None</option>
                            {translationEngines.map((engine) => (
                              <option key={engine.id} value={String(engine.id)}>
                                {engine.name}
                                {engine.disabled ? " (disabled)" : ""}
                              </option>
                            ))}
                          </select>
                          {translationEngines.length === 0 && (
                            <div className="form-text text-muted">No translation engines available.</div>
                          )}
                        </div>
                        <div className="col-md-6">
                          <label className="form-label small text-uppercase text-muted">Default TMX</label>
                          <select
                            className="form-select"
                            value={defaultTmxIdRaw}
                            onChange={(e) => setDefaultTmxIdRaw(e.target.value)}
                            disabled={saving}
                          >
                            <option value="">None</option>
                            {tmSamples.map((sample) => (
                              <option key={sample.id || sample.filename} value={String(sample.tmId ?? "")}>
                                {sample.label}
                                {sample.seeded ? "" : " (seeding...)"}
                              </option>
                            ))}
                          </select>
                          {tmSamples.length === 0 && <div className="form-text text-muted">No TMX assets available.</div>}
                        </div>
                        <div className="col-md-6">
                          <label className="form-label small text-uppercase text-muted">Default ruleset</label>
                          <select
                            className="form-select"
                            value={defaultRulesetIdRaw}
                            onChange={(e) => setDefaultRulesetIdRaw(e.target.value)}
                            disabled={saving}
                          >
                            <option value="">None</option>
                            {rulesets.map((ruleset) => (
                              <option key={ruleset.id} value={String(ruleset.id)}>
                                {ruleset.name}
                                {ruleset.disabled ? " (disabled)" : ""}
                              </option>
                            ))}
                          </select>
                          {rulesets.length === 0 && <div className="form-text text-muted">No rulesets available.</div>}
                        </div>
                        <div className="col-md-6">
                          <label className="form-label small text-uppercase text-muted">Default termbase</label>
                          <select
                            className="form-select"
                            value={defaultGlossaryIdRaw}
                            onChange={(e) => setDefaultGlossaryIdRaw(e.target.value)}
                            disabled={saving}
                          >
                            <option value="">None</option>
                            {glossaries.map((glossary) => (
                              <option key={glossary.id} value={String(glossary.id)}>
                                {glossary.label}
                                {glossary.disabled ? " (disabled)" : ""}
                              </option>
                            ))}
                          </select>
                          {glossaries.length === 0 && <div className="form-text text-muted">No termbases available.</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-12">
                  <div className="card-enterprise">
                    <div className="card-body">
                      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                        <div>
                          <div className="fw-semibold">Per-target overrides</div>
                          <div className="text-muted small">Override defaults per target language.</div>
                        </div>
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={applyGlobalDefaults}
                            disabled={saving || targetLangs.length === 0}
                          >
                            Apply global defaults to all languages
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={clearAllOverrides}
                            disabled={
                              saving ||
                              (Object.keys(tmxByTargetLang).length === 0 &&
                                Object.keys(rulesetByTargetLang).length === 0 &&
                                Object.keys(glossaryByTargetLang).length === 0)
                            }
                          >
                            Clear all overrides
                          </button>
                        </div>
                      </div>
                      {targetLangs.length === 0 ? (
                        <div className="text-muted small mt-2">Select target languages first.</div>
                      ) : (
                        <div className="table-responsive mt-3">
                          <table className="table table-sm align-middle mb-0">
                            <thead>
                              <tr>
                                <th style={{ width: "28%" }}>Target language</th>
                                <th style={{ width: "24%" }}>TMX</th>
                                <th style={{ width: "24%" }}>Rules</th>
                                <th style={{ width: "24%" }}>Termbase</th>
                              </tr>
                            </thead>
                            <tbody>
                              {targetLangs.map((target) => {
                                const key = normalizeTargetKey(target) || target;
                                const meta = targetMetaByTag.get(key) ?? targetMetaByTag.get(target);
                                const hasTmx = Object.prototype.hasOwnProperty.call(tmxByTargetLang, key);
                                const hasRules = Object.prototype.hasOwnProperty.call(rulesetByTargetLang, key);
                                const hasGlossary = Object.prototype.hasOwnProperty.call(glossaryByTargetLang, key);
                                const tmxValue = hasTmx ? tmxByTargetLang[key] ?? null : undefined;
                                const rulesValue = hasRules ? rulesetByTargetLang[key] ?? null : undefined;
                                const glossaryValue = hasGlossary ? glossaryByTargetLang[key] ?? null : undefined;
                                const tmxSelectValue =
                                  tmxValue === undefined ? INHERIT_VALUE : tmxValue == null ? "" : String(tmxValue);
                                const rulesSelectValue =
                                  rulesValue === undefined ? INHERIT_VALUE : rulesValue == null ? "" : String(rulesValue);
                                const glossarySelectValue =
                                  glossaryValue === undefined ? INHERIT_VALUE : glossaryValue == null ? "" : String(glossaryValue);
                                return (
                                  <tr key={target}>
                                    <td>
                                      <span className="badge text-bg-light text-dark">
                                        {meta?.flag ? (
                                          <span className={`flag-icon fi fi-${meta.flag} me-1`} aria-hidden="true" />
                                        ) : (
                                          <i className="bi bi-flag-fill text-muted me-1" aria-hidden="true" />
                                        )}
                                        {meta?.label || key}
                                      </span>
                                    </td>
                                    <td>
                                      <select
                                        className="form-select form-select-sm"
                                        value={tmxSelectValue}
                                        onChange={(e) => setOverrideValue(key, e.target.value, setTmxByTargetLang)}
                                        disabled={saving}
                                      >
                                        <option value={INHERIT_VALUE}>Inherit global default</option>
                                        <option value="">None</option>
                                        {tmSamples.map((sample) => (
                                          <option key={sample.id || sample.filename} value={String(sample.tmId ?? "")}>
                                            {sample.label}
                                            {sample.seeded ? "" : " (seeding...)"}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td>
                                      <select
                                        className="form-select form-select-sm"
                                        value={rulesSelectValue}
                                        onChange={(e) => setOverrideValue(key, e.target.value, setRulesetByTargetLang)}
                                        disabled={saving}
                                      >
                                        <option value={INHERIT_VALUE}>Inherit global default</option>
                                        <option value="">None</option>
                                        {rulesets.map((ruleset) => (
                                          <option key={ruleset.id} value={String(ruleset.id)}>
                                            {ruleset.name}
                                            {ruleset.disabled ? " (disabled)" : ""}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td>
                                      <select
                                        className="form-select form-select-sm"
                                        value={glossarySelectValue}
                                        onChange={(e) => setOverrideValue(key, e.target.value, setGlossaryByTargetLang)}
                                        disabled={saving}
                                      >
                                        <option value={INHERIT_VALUE}>Inherit global default</option>
                                        <option value="">None</option>
                                        {glossaries.map((glossary) => (
                                          <option key={glossary.id} value={String(glossary.id)}>
                                            {glossary.label}
                                            {glossary.disabled ? " (disabled)" : ""}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            {step === "policy" && (
              <>
                <div className="col-12">
                  <div className="card-enterprise">
                    <div className="card-body">
                      <div className="fw-semibold">File permissions</div>
                      <div className="row g-2 mt-1">
                        <div className="col-md-6">
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="template-can-edit-source"
                              checked={settings.canEditSource}
                              onChange={(e) => setSettings((prev) => ({ ...prev, canEditSource: e.target.checked }))}
                              disabled={saving}
                            />
                            <label className="form-check-label" htmlFor="template-can-edit-source">
                              Allow assignees to edit source
                            </label>
                          </div>
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="template-can-download-source"
                              checked={settings.canDownloadSource}
                              onChange={(e) => setSettings((prev) => ({ ...prev, canDownloadSource: e.target.checked }))}
                              disabled={saving}
                            />
                            <label className="form-check-label" htmlFor="template-can-download-source">
                              Allow downloading source files
                            </label>
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="template-can-download-output"
                              checked={settings.canDownloadTranslated}
                              onChange={(e) => setSettings((prev) => ({ ...prev, canDownloadTranslated: e.target.checked }))}
                              disabled={saving}
                            />
                            <label className="form-check-label" htmlFor="template-can-download-output">
                              Allow downloading translated output
                            </label>
                          </div>
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="template-can-export-intermediate"
                              checked={settings.canExportIntermediate}
                              onChange={(e) => setSettings((prev) => ({ ...prev, canExportIntermediate: e.target.checked }))}
                              disabled={saving}
                            />
                            <label className="form-check-label" htmlFor="template-can-export-intermediate">
                              Allow export of intermediate formats
                            </label>
                          </div>
                        </div>
                      </div>
                      <div className="fw-semibold mt-3">Workflow options</div>
                      <div className="form-check mt-1">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="template-auto-inbox"
                          checked={settings.autoCreateInboxItems}
                          onChange={(e) => setSettings((prev) => ({ ...prev, autoCreateInboxItems: e.target.checked }))}
                          disabled={saving}
                        />
                        <label className="form-check-label" htmlFor="template-auto-inbox">
                          Auto-create inbox items on project creation
                        </label>
                      </div>
                      <div className="fw-semibold mt-3">Completion policy</div>
                      <select
                        className="form-select"
                        value={settings.completionPolicy}
                        onChange={(e) => setSettings((prev) => ({ ...prev, completionPolicy: e.target.value }))}
                        disabled={saving}
                      >
                        <option value="assignee">Assignee can mark complete</option>
                        <option value="reviewer">Reviewer/admin only</option>
                      </select>
                      <div className="form-text text-muted">
                        Choose who is allowed to mark projects as completed.
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
            {step === "review" && (
              <>
                <div className="col-12">
                  <div className="card-enterprise">
                    <div className="card-body">
                      <div className="fw-semibold mb-2">Template summary</div>
                      <dl className="fc-project-drawer-dl">
                        <dt>Name</dt>
                        <dd>{name.trim() || "-"}</dd>
                        <dt>Status</dt>
                        <dd>{disabled ? "Disabled" : "Enabled"}</dd>
                        <dt>Description</dt>
                        <dd>{description.trim() || "-"}</dd>
                        <dt>Scope / Location</dt>
                        <dd>{scope.trim() || "-"}</dd>
                        <dt>Languages</dt>
                        <dd>
                          {languageSummary ? (
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <LanguagePairLabel source={languageSummary.source} target={languageSummary.target} />
                              {languageSummary.extra > 0 && (
                                <span className="text-muted small">+{languageSummary.extra}</span>
                              )}
                            </div>
                          ) : (
                            "-"
                          )}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
                <div className="col-12">
                  <div className="card-enterprise">
                    <div className="card-body">
                      <div className="fw-semibold mb-2">Defaults</div>
                      <dl className="fc-project-drawer-dl">
                        <dt>Default translation engine</dt>
                        <dd>{defaultEngine?.name || "None"}</dd>
                        <dt>Default TMX</dt>
                        <dd>{defaultTmx ? defaultTmx.label : defaultTmxId != null ? `TMX #${defaultTmxId}` : "None"}</dd>
                        <dt>Default ruleset</dt>
                        <dd>{defaultRuleset?.name || (defaultRulesetId != null ? `Ruleset #${defaultRulesetId}` : "None")}</dd>
                        <dt>Default termbase</dt>
                        <dd>{defaultGlossary?.label || (defaultGlossaryId != null ? `Termbase #${defaultGlossaryId}` : "None")}</dd>
                        <dt>File type configuration</dt>
                        <dd>{fileTypeById.get(fileTypeConfigId || 0)?.name || (fileTypeConfigId ? `Config #${fileTypeConfigId}` : "None")}</dd>
                        <dt>Overrides set</dt>
                        <dd>
                          TMX {overridesCount.tmxCount} · Rules {overridesCount.rulesCount} · Termbase {overridesCount.glossaryCount}
                        </dd>
                      </dl>
                      <ProjectTemplateOverridesTable
                        targetLangs={targetLangs}
                        targetMetaByTag={targetMetaByTag}
                        tmxByTargetLang={tmxByTargetLang}
                        rulesetByTargetLang={rulesetByTargetLang}
                        glossaryByTargetLang={glossaryByTargetLang}
                        tmSampleById={tmSampleById}
                        rulesetById={rulesetById}
                        glossaryById={glossaryById}
                      />
                    </div>
                  </div>
                </div>
                <div className="col-12">
                  <div className="card-enterprise">
                    <div className="card-body">
                      <div className="fw-semibold mb-2">Permissions & policy</div>
                      <ul className="list-unstyled small mb-0">
                        <li>Source editing: {settings.canEditSource ? "Allowed" : "Not allowed"}</li>
                        <li>Download source files: {settings.canDownloadSource ? "Allowed" : "Not allowed"}</li>
                        <li>Download translated output: {settings.canDownloadTranslated ? "Allowed" : "Not allowed"}</li>
                        <li>Export intermediate formats: {settings.canExportIntermediate ? "Allowed" : "Not allowed"}</li>
                        <li>Auto-create inbox items: {settings.autoCreateInboxItems ? "Enabled" : "Disabled"}</li>
                        <li>Completion policy: {completionPolicyLabel}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </WizardShell>
    </div>
  );
}
