import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { createTranslationEngine, listNmtProviders, type NmtProvider } from "../../../api";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";

type WizardStepKey = "basics" | "prompts" | "review";

const STEP_ORDER: Array<{ key: WizardStepKey; label: string }> = [
  { key: "basics", label: "Engine Basics" },
  { key: "prompts", label: "Prompts + LLM" },
  { key: "review", label: "Review & Save" }
];

const PLACEHOLDERS: Array<{ key: string; label: string }> = [
  { key: "{source_language}", label: "Source language code/name" },
  { key: "{target_language}", label: "Target language code/name" },
  { key: "{source_text}", label: "Source segment text" },
  { key: "{file_name}", label: "File name (optional)" },
  { key: "{project_name}", label: "Project name (optional)" }
];

function parseOptionalNumber(value: string) {
  const v = String(value || "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value: string) {
  const n = parseOptionalNumber(value);
  if (n == null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
}

export default function TranslationEngineWizardPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();

  const [step, setStep] = useState<WizardStepKey>("basics");
  const [showValidation, setShowValidation] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [providers, setProviders] = useState<NmtProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [disabled, setDisabled] = useState(false);

  const [llmProviderIdRaw, setLlmProviderIdRaw] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPromptTemplate, setUserPromptTemplate] = useState("");

  const [temperatureRaw, setTemperatureRaw] = useState("");
  const [maxTokensRaw, setMaxTokensRaw] = useState("");
  const [topPRaw, setTopPRaw] = useState("");

  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);
    setProvidersError(null);
    (async () => {
      try {
        const list = await listNmtProviders();
        if (cancelled) return;
        setProviders(list.filter((p) => p.enabled));
      } catch (err: any) {
        if (!cancelled) {
          setProviders([]);
          setProvidersError(err?.userMessage || err?.message || "Failed to load providers.");
        }
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const llmProviderId = useMemo(() => {
    const raw = String(llmProviderIdRaw || "").trim();
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [llmProviderIdRaw]);

  const selectedProvider = useMemo(() => {
    if (!llmProviderId) return null;
    return providers.find((p) => p.id === llmProviderId) ?? null;
  }, [llmProviderId, providers]);

  const basicsErrors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!name.trim()) out.name = "Engine name is required.";
    return out;
  }, [name]);

  const promptsErrors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!llmProviderId) out.llmProviderId = "LLM provider is required.";
    if (!systemPrompt.trim()) out.systemPrompt = "System prompt is required.";
    if (!userPromptTemplate.trim()) out.userPromptTemplate = "User prompt template is required.";

    const t = parseOptionalNumber(temperatureRaw);
    if (temperatureRaw.trim() && (t == null || t < 0 || t > 2)) out.temperature = "Temperature must be between 0 and 2.";

    const mt = parseOptionalInt(maxTokensRaw);
    if (maxTokensRaw.trim() && (mt == null || mt < 1 || mt > 32000)) out.maxTokens = "Max tokens must be a positive integer.";

    const tp = parseOptionalNumber(topPRaw);
    if (topPRaw.trim() && (tp == null || tp < 0 || tp > 1)) out.topP = "Top P must be between 0 and 1.";

    return out;
  }, [llmProviderId, maxTokensRaw, systemPrompt, temperatureRaw, topPRaw, userPromptTemplate]);

  const canProceed = useMemo(() => {
    if (step === "basics") return Object.keys(basicsErrors).length === 0;
    if (step === "prompts") return Object.keys(promptsErrors).length === 0;
    return true;
  }, [basicsErrors, promptsErrors, step]);

  function goToStep(next: WizardStepKey) {
    setStep(next);
  }

  function goNext() {
    if (step === "review") return;
    setShowValidation(true);
    if (!canProceed) return;
    if (step === "basics") return goToStep("prompts");
    if (step === "prompts") return goToStep("review");
  }

  function goBack() {
    if (step === "basics") return;
    if (step === "prompts") return goToStep("basics");
    return goToStep("prompts");
  }

  async function handleSave() {
    setSaveError(null);
    setShowValidation(true);

    if (Object.keys(basicsErrors).length > 0) {
      goToStep("basics");
      return;
    }
    if (Object.keys(promptsErrors).length > 0) {
      goToStep("prompts");
      return;
    }
    if (!llmProviderId) {
      goToStep("prompts");
      return;
    }

    const temperature = parseOptionalNumber(temperatureRaw);
    const maxTokens = parseOptionalInt(maxTokensRaw);
    const topP = parseOptionalNumber(topPRaw);

    setSaving(true);
    try {
      await createTranslationEngine({
        name: name.trim(),
        description: description.trim() || undefined,
        disabled,
        llmProviderId,
        systemPrompt: systemPrompt.trimEnd(),
        userPromptTemplate: userPromptTemplate.trimEnd(),
        temperature,
        maxTokens,
        topP
      });
      nav("/resources/translation-engines");
    } catch (err: any) {
      setSaveError(err?.userMessage || err?.message || "Failed to save translation engine.");
      goToStep("prompts");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Resources / Translation Engines"
        title="New Translation Engine"
        onCancel={() => nav("/resources/translation-engines")}
        cancelDisabled={saving}
        topActions={
          step === "review" ? (
            <button type="button" className="btn btn-primary fw-semibold" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          ) : null
        }
        steps={STEP_ORDER}
        currentStep={step}
        onStepSelect={goToStep}
        canSelectStep={(_key, index, currentIndex) => index < currentIndex}
        alerts={
          <>
            {saveError ? <WarningBanner tone="error" messages={[saveError]} /> : null}
            {providersError ? <WarningBanner tone="warning" messages={[providersError]} /> : null}
          </>
        }
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button type="button" className="btn btn-outline-secondary" onClick={goBack} disabled={step === "basics" || saving}>
              Back
            </button>
            <button type="button" className="btn btn-dark" onClick={goNext} disabled={step === "review" || saving || !canProceed}>
              Next
            </button>
          </div>
        }
      >
        {step === "basics" && (
          <>
            <div className="fw-semibold mb-3">Engine basics</div>
            <div className="row g-3">
              <div className="col-lg-8">
                <label className="form-label">Engine name</label>
                <input
                  className={`form-control ${showValidation && basicsErrors.name ? "is-invalid" : ""}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                />
                {showValidation && basicsErrors.name ? <div className="invalid-feedback">{basicsErrors.name}</div> : null}
              </div>
              <div className="col-lg-4">
                <label className="form-label">Status</label>
                <div className="form-check mt-2">
                  <input
                    id="tewiz-disabled"
                    type="checkbox"
                    className="form-check-input"
                    checked={disabled}
                    onChange={(e) => setDisabled(e.target.checked)}
                    disabled={saving}
                  />
                  <label className="form-check-label" htmlFor="tewiz-disabled">
                    Disabled
                  </label>
                </div>
              </div>
              <div className="col-12">
                <label className="form-label">Description (optional)</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          </>
        )}

        {step === "prompts" && (
          <>
            <div className="fw-semibold mb-2">Prompts + LLM selection</div>
            <div className="text-muted small mb-3">
              LLM selection is mandatory. Language pair is injected at runtime from the project/file.
            </div>
            <div className="row g-3">
              <div className="col-lg-8">
                <label className="form-label">LLM Provider</label>
                <select
                  className={`form-select ${showValidation && promptsErrors.llmProviderId ? "is-invalid" : ""}`}
                  value={llmProviderIdRaw}
                  onChange={(e) => setLlmProviderIdRaw(e.target.value)}
                  disabled={saving || providersLoading}
                >
                  <option value="">{providersLoading ? "Loading..." : "Select a provider"}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.title} — {p.model}
                    </option>
                  ))}
                </select>
                {showValidation && promptsErrors.llmProviderId ? <div className="invalid-feedback">{promptsErrors.llmProviderId}</div> : null}
                {selectedProvider ? (
                  <div className="form-text text-muted">
                    Vendor: {selectedProvider.vendor} • Base URL: {selectedProvider.baseUrlMasked} • API Key: {selectedProvider.apiKeyMasked}
                  </div>
                ) : (
                  <div className="form-text text-muted">
                    Create providers under Resources → NMT/LLM Providers.
                  </div>
                )}
              </div>

              <div className="col-lg-4">
                <div className="border rounded p-3 bg-white h-100">
                  <div className="fw-semibold mb-2">Available placeholders</div>
                  <div className="d-flex flex-column gap-1">
                    {PLACEHOLDERS.map((p) => (
                      <div key={p.key} className="small">
                        <span className="font-monospace">{p.key}</span> <span className="text-muted">— {p.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="col-12">
                <label className="form-label">System prompt</label>
                <textarea
                  className={`form-control ${showValidation && promptsErrors.systemPrompt ? "is-invalid" : ""}`}
                  rows={5}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  disabled={saving}
                />
                {showValidation && promptsErrors.systemPrompt ? <div className="invalid-feedback">{promptsErrors.systemPrompt}</div> : null}
              </div>

              <div className="col-12">
                <label className="form-label">User prompt template</label>
                <textarea
                  className={`form-control ${showValidation && promptsErrors.userPromptTemplate ? "is-invalid" : ""}`}
                  rows={6}
                  value={userPromptTemplate}
                  onChange={(e) => setUserPromptTemplate(e.target.value)}
                  disabled={saving}
                  placeholder={`Translate from {source_language} to {target_language}.\n\nSource:\n{source_text}`}
                />
                {showValidation && promptsErrors.userPromptTemplate ? <div className="invalid-feedback">{promptsErrors.userPromptTemplate}</div> : null}
              </div>

              <div className="col-12">
                <div className="fw-semibold mb-2">Generation settings (optional)</div>
                <div className="row g-2">
                  <div className="col-md-4">
                    <label className="form-label">Temperature</label>
                    <input
                      className={`form-control ${showValidation && promptsErrors.temperature ? "is-invalid" : ""}`}
                      value={temperatureRaw}
                      onChange={(e) => setTemperatureRaw(e.target.value)}
                      placeholder="e.g. 0.2"
                      disabled={saving}
                    />
                    {showValidation && promptsErrors.temperature ? <div className="invalid-feedback">{promptsErrors.temperature}</div> : null}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Max tokens</label>
                    <input
                      className={`form-control ${showValidation && promptsErrors.maxTokens ? "is-invalid" : ""}`}
                      value={maxTokensRaw}
                      onChange={(e) => setMaxTokensRaw(e.target.value)}
                      placeholder="e.g. 512"
                      disabled={saving}
                    />
                    {showValidation && promptsErrors.maxTokens ? <div className="invalid-feedback">{promptsErrors.maxTokens}</div> : null}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Top P</label>
                    <input
                      className={`form-control ${showValidation && promptsErrors.topP ? "is-invalid" : ""}`}
                      value={topPRaw}
                      onChange={(e) => setTopPRaw(e.target.value)}
                      placeholder="e.g. 1"
                      disabled={saving}
                    />
                    {showValidation && promptsErrors.topP ? <div className="invalid-feedback">{promptsErrors.topP}</div> : null}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <div className="fw-semibold mb-2">Review</div>
            <div className="text-muted small mb-3">Save is only available on this step.</div>

            <div className="row g-3">
              <div className="col-md-6">
                <div className="text-muted small">Engine name</div>
                <div className="fw-semibold">{name.trim() || "-"}</div>
              </div>
              <div className="col-md-6">
                <div className="text-muted small">Status</div>
                <div className="fw-semibold">{disabled ? "Disabled" : "Enabled"}</div>
              </div>
              <div className="col-12">
                <div className="text-muted small">Description</div>
                <div className="fw-semibold">{description.trim() || "-"}</div>
              </div>

              <div className="col-12">
                <div className="text-muted small">LLM provider</div>
                <div className="fw-semibold">
                  {selectedProvider ? `${selectedProvider.title} — ${selectedProvider.model}` : "-"}
                </div>
                <div className="text-muted small">
                  {selectedProvider ? `Vendor: ${selectedProvider.vendor} • API Key: ${selectedProvider.apiKeyMasked}` : ""}
                </div>
              </div>

              <div className="col-12">
                <div className="text-muted small mb-1">System prompt (preview)</div>
                <div className="border rounded p-2 bg-white small" style={{ whiteSpace: "pre-wrap" }}>
                  {systemPrompt.trim() ? systemPrompt.trim().slice(0, 600) : "-"}
                  {systemPrompt.trim().length > 600 ? "…" : ""}
                </div>
              </div>
              <div className="col-12">
                <div className="text-muted small mb-1">User prompt template (preview)</div>
                <div className="border rounded p-2 bg-white small" style={{ whiteSpace: "pre-wrap" }}>
                  {userPromptTemplate.trim() ? userPromptTemplate.trim().slice(0, 800) : "-"}
                  {userPromptTemplate.trim().length > 800 ? "…" : ""}
                </div>
              </div>

              <div className="col-12">
                <div className="text-muted small">Created by</div>
                <div className="fw-semibold">{currentUser.displayName || currentUser.username}</div>
              </div>
            </div>
          </>
        )}
      </WizardShell>
    </div>
  );
}
