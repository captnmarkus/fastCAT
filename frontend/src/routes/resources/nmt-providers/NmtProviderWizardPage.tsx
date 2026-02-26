import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { createNmtProvider, testNmtProviderConnection } from "../../../api";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";

type WizardStepKey = "details" | "review";

const STEP_ORDER: Array<{ key: WizardStepKey; label: string }> = [
  { key: "details", label: "Provider Details" },
  { key: "review", label: "Review & Save" }
];

const VENDOR_OPTIONS = [
  { value: "openai-compatible", label: "OpenAI-compatible" }
] as const;

export default function NmtProviderWizardPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();

  const [step, setStep] = useState<WizardStepKey>("details");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [vendor, setVendor] = useState<string>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");

  const [showValidation, setShowValidation] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!title.trim()) out.title = "Title is required.";
    if (!String(vendor || "").trim()) out.vendor = "Vendor is required.";
    if (!baseUrl.trim()) out.baseUrl = "Base URL is required.";
    if (!model.trim()) out.model = "Model is required.";
    return out;
  }, [apiKey, baseUrl, model, title, vendor]);

  const canProceed = step === "details" ? Object.keys(errors).length === 0 : true;

  function goToStep(next: WizardStepKey) {
    setStep(next);
  }

  function goNext() {
    if (step === "review") return;
    if (!canProceed) {
      setShowValidation(true);
      return;
    }
    goToStep("review");
  }

  function goBack() {
    if (step === "details") return;
    goToStep("details");
  }

  async function handleTestConnection() {
    setTestResult(null);
    setSaveError(null);
    setShowValidation(true);
    if (Object.keys(errors).length > 0) return;
    setTesting(true);
    try {
      const res = await testNmtProviderConnection({
        vendor: vendor.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim()
      });
      if (res.ok) {
        setTestResult({ ok: true, message: `Connected (${res.latencyMs ?? "?"} ms)` });
      } else {
        setTestResult({ ok: false, message: res.error || "Connection failed." });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.userMessage || err?.message || "Connection failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaveError(null);
    setShowValidation(true);
    if (Object.keys(errors).length > 0) {
      goToStep("details");
      return;
    }

    setSaving(true);
    try {
      await createNmtProvider({
        title: title.trim(),
        vendor: vendor.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        description: description.trim() || undefined
      });
      setApiKey("");
      nav("/resources/nmt-providers");
    } catch (err: any) {
      setSaveError(err?.userMessage || err?.message || "Failed to save provider.");
      goToStep("details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Resources / NMT/LLM Providers"
        title="New Provider"
        onCancel={() => nav("/resources/nmt-providers")}
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
        alerts={saveError ? <WarningBanner tone="error" messages={[saveError]} /> : null}
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button type="button" className="btn btn-outline-secondary" onClick={goBack} disabled={step === "details" || saving}>
              Back
            </button>
            <button type="button" className="btn btn-dark" onClick={goNext} disabled={step === "review" || saving || !canProceed}>
              Next
            </button>
          </div>
        }
      >
        {step === "details" && (
          <>
            <div className="fw-semibold mb-3">Provider details</div>
            <div className="row g-3">
              <div className="col-lg-8">
                <label className="form-label">Title</label>
                <input
                  className={`form-control ${showValidation && errors.title ? "is-invalid" : ""}`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={saving}
                />
                {showValidation && errors.title ? <div className="invalid-feedback">{errors.title}</div> : null}
              </div>

              <div className="col-lg-4">
                <label className="form-label">Vendor</label>
                <select
                  className={`form-select ${showValidation && errors.vendor ? "is-invalid" : ""}`}
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  disabled={true}
                >
                  {VENDOR_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {showValidation && errors.vendor ? <div className="invalid-feedback">{errors.vendor}</div> : null}
              </div>

              <div className="col-12">
                <label className="form-label">Base URL</label>
                <input
                  className={`form-control ${showValidation && errors.baseUrl ? "is-invalid" : ""}`}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  disabled={saving}
                />
                {showValidation && errors.baseUrl ? <div className="invalid-feedback">{errors.baseUrl}</div> : null}
                <div className="form-text">
                  Stored encrypted at rest. Use `http://localhost:8000/v1` for a local OpenAI-compatible server.
                </div>
              </div>

              <div className="col-lg-8">
                <label className="form-label">API Key (optional)</label>
                <div className="input-group">
                  <input
                    type={showApiKey ? "text" : "password"}
                    className="form-control"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowApiKey((prev) => !prev)}
                    disabled={saving}
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                    title={showApiKey ? "Hide" : "Show"}
                  >
                    <i className={`bi ${showApiKey ? "bi-eye-slash" : "bi-eye"}`} aria-hidden="true" />
                  </button>
                </div>
                <div className="form-text">
                  Stored encrypted at rest. Leave empty for local models that don't require a key.
                </div>
              </div>

              <div className="col-lg-4">
                <label className="form-label">Model</label>
                <input
                  className={`form-control ${showValidation && errors.model ? "is-invalid" : ""}`}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini (or your local model id)"
                  disabled={saving}
                />
                {showValidation && errors.model ? <div className="invalid-feedback">{errors.model}</div> : null}
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

              <div className="col-12 d-flex flex-wrap align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={handleTestConnection}
                  disabled={saving || testing || Object.keys(errors).length > 0}
                >
                  {testing ? "Testing..." : "Test connection"}
                </button>
                {testResult ? (
                  <div className={`small ${testResult.ok ? "text-success" : "text-danger"}`}>
                    {testResult.message}
                  </div>
                ) : (
                  <div className="small text-muted">Does not persist.</div>
                )}
              </div>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <div className="fw-semibold mb-2">Review</div>
            <div className="text-muted small mb-3">Secrets will be stored encrypted at rest. API key is masked when provided.</div>
            <div className="row g-3">
              <div className="col-md-6">
                <div className="text-muted small">Title</div>
                <div className="fw-semibold">{title.trim() || "-"}</div>
              </div>
              <div className="col-md-6">
                <div className="text-muted small">Vendor</div>
                <div className="fw-semibold">
                  {VENDOR_OPTIONS.find((o) => o.value === vendor)?.label || vendor}
                </div>
              </div>
              <div className="col-md-6">
                <div className="text-muted small">Base URL</div>
                <div className="fw-semibold">{baseUrl.trim() || "-"}</div>
              </div>
              <div className="col-md-6">
                <div className="text-muted small">API key</div>
                <div className="fw-semibold">{apiKey.trim() ? "••••••••••••••••" : "(none)"}</div>
              </div>
              <div className="col-md-6">
                <div className="text-muted small">Model</div>
                <div className="fw-semibold">{model.trim() || "-"}</div>
              </div>
              <div className="col-12">
                <div className="text-muted small">Description</div>
                <div className="fw-semibold">{description.trim() || "-"}</div>
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
