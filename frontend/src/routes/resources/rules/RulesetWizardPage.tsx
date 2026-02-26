import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import {
  checkLanguageProcessingRulesetName,
  createLanguageProcessingRuleset,
  getLanguageProcessingRulesetDetails,
  testLanguageProcessingRules,
  updateLanguageProcessingRuleset
} from "../../../api";
import RulesetRuleBuilder from "./RulesetRuleBuilder";
import {
  normalizeRulesFromApi,
  serializeRulesForApi,
  validateRulesetRules,
  type RulesetRule
} from "./rulesetUtils";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";

type WizardStepKey = "basics" | "rules" | "test" | "review";
type NameCheckStatus = "idle" | "checking" | "available" | "duplicate" | "error";

const STEP_ORDER: Array<{ key: WizardStepKey; label: string }> = [
  { key: "basics", label: "Basics" },
  { key: "rules", label: "Build rules" },
  { key: "test", label: "Test harness" },
  { key: "review", label: "Review & Save" }
];

function stepIndexForKey(key: WizardStepKey) {
  return Math.max(0, STEP_ORDER.findIndex((s) => s.key === key));
}

export default function RulesetWizardPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const location = useLocation();
  const params = useParams();
  const rulesetId = Number(params.id);
  const isEdit = Number.isFinite(rulesetId) && rulesetId > 0;

  const [step, setStep] = useState<WizardStepKey>("basics");
  const [showValidation, setShowValidation] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [rules, setRules] = useState<RulesetRule[]>([]);
  const [changeSummary, setChangeSummary] = useState("");

  const [nameTouched, setNameTouched] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameCheckStatus>("idle");
  const nameCheckSeq = useRef(0);

  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [testApplied, setTestApplied] = useState<number | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const rulesErrors = useMemo(() => validateRulesetRules(rules), [rules]);
  const rulesValid = useMemo(() => Object.keys(rulesErrors).length === 0, [rulesErrors]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await getLanguageProcessingRulesetDetails(rulesetId);
        if (cancelled) return;
        setName(res.item?.name || "");
        setDescription(res.item?.description || "");
        setDisabled(Boolean(res.item?.disabled));
        setRules(normalizeRulesFromApi(res.item?.rules || []));
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.userMessage || err?.message || "Failed to load ruleset.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, rulesetId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get("step") as WizardStepKey | null;
    if (!requested) return;
    if (STEP_ORDER.some((s) => s.key === requested)) {
      setStep(requested);
    }
  }, [location.search]);

  useEffect(() => {
    setNameStatus("idle");
  }, [name]);

  const nameError = useMemo(() => {
    if (!name.trim()) return "Name is required.";
    if (nameStatus === "duplicate") return "A ruleset with this name already exists.";
    if (nameStatus === "error") return "Could not verify name availability.";
    return null;
  }, [name, nameStatus]);

  const ruleCount = rules.length;
  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;

  async function runNameCheck(value: string) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      setNameStatus("idle");
      return "empty";
    }
    const seq = ++nameCheckSeq.current;
    setNameStatus("checking");
    try {
      const exists = await checkLanguageProcessingRulesetName(trimmed, isEdit ? { excludeId: rulesetId } : undefined);
      if (seq !== nameCheckSeq.current) return null;
      setNameStatus(exists ? "duplicate" : "available");
      return exists ? "duplicate" : "available";
    } catch {
      if (seq !== nameCheckSeq.current) return null;
      setNameStatus("error");
      return "error";
    }
  }

  function goToStep(next: WizardStepKey) {
    setStep(next);
  }

  async function goNext() {
    setShowValidation(true);
    if (step === "basics") {
      if (!name.trim()) return;
      const status = await runNameCheck(name);
      if (status === "duplicate" || status === "error") return;
      return goToStep("rules");
    }
    if (step === "rules") {
      if (!rulesValid) return;
      return goToStep("test");
    }
    if (step === "test") {
      return goToStep("review");
    }
  }

  function goBack() {
    if (step === "basics") return;
    const idx = stepIndexForKey(step);
    const prev = STEP_ORDER[idx - 1]?.key;
    if (prev) goToStep(prev);
  }

  async function runTest() {
    setError(null);
    setTestLoading(true);
    try {
      const result = await testLanguageProcessingRules({
        input: testInput,
        rules: serializeRulesForApi(rules)
      });
      setTestOutput(result.output || "");
      setTestApplied(result.applied ?? null);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to run test.");
    } finally {
      setTestLoading(false);
    }
  }

  async function handleSave() {
    setShowValidation(true);
    setError(null);
    if (!name.trim()) {
      goToStep("basics");
      return;
    }
    const status = await runNameCheck(name);
    if (status === "duplicate" || status === "error") {
      goToStep("basics");
      return;
    }
    if (!rulesValid) {
      goToStep("rules");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        disabled,
        rules: serializeRulesForApi(rules),
        summary: changeSummary.trim() || undefined
      };
      const next = isEdit
        ? await updateLanguageProcessingRuleset(rulesetId, payload)
        : await createLanguageProcessingRuleset(payload);
      nav(`/resources/rules/${next.id}`, { replace: true });
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to save ruleset.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-muted p-3">Loading ruleset...</div>;
  }

  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Resources / Rules"
        title={isEdit ? "Edit Ruleset" : "New Ruleset"}
        onCancel={() => nav(isEdit ? `/resources/rules/${rulesetId}` : "/resources/rules")}
        cancelDisabled={saving}
        topActions={
          step === "review" ? (
            <button type="button" className="btn btn-primary fw-semibold" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Save changes" : "Create ruleset"}
            </button>
          ) : null
        }
        steps={STEP_ORDER}
        currentStep={step}
        onStepSelect={goToStep}
        canSelectStep={(_key, index, currentIndex) => index < currentIndex && !saving}
        alerts={error ? <WarningBanner tone="error" messages={[error]} /> : null}
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button type="button" className="btn btn-outline-secondary" onClick={goBack} disabled={saving || step === "basics"}>
              Back
            </button>
            <button type="button" className="btn btn-dark" onClick={goNext} disabled={saving || step === "review"}>
              Next
            </button>
          </div>
        }
      >
        {step === "basics" && (
          <div className="row g-3">
            <div className="col-lg-7">
              <label className="form-label">Name</label>
              <input
                className={`form-control ${((showValidation || nameTouched) && nameError) ? "is-invalid" : ""}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  setNameTouched(true);
                  if (name.trim()) runNameCheck(name);
                }}
                disabled={saving}
                placeholder="Customer ruleset"
              />
              {((showValidation || nameTouched) && nameError) ? <div className="invalid-feedback">{nameError}</div> : null}
              {nameStatus === "checking" ? <div className="form-text text-muted">Checking name availability...</div> : null}
            </div>
            <div className="col-lg-5">
              <label className="form-label">Status</label>
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
            <div className="col-12">
              <label className="form-label">Created by</label>
              <div className="form-control-plaintext">{currentUser.displayName || currentUser.username}</div>
            </div>
          </div>
        )}

        {step === "rules" && (
          <RulesetRuleBuilder
            rules={rules}
            onChange={setRules}
            showValidation={showValidation}
            disabled={saving}
          />
        )}

        {step === "test" && (
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">Input text</label>
              <textarea
                className="form-control"
                rows={6}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Paste sample text..."
              />
            </div>
            <div className="col-md-6">
              <label className="form-label d-flex align-items-center justify-content-between">
                <span>Output preview</span>
                {testApplied != null ? <span className="text-muted small">{testApplied} rule(s) applied</span> : null}
              </label>
              <textarea className="form-control" rows={6} value={testOutput} readOnly />
            </div>
            <div className="col-12">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={runTest}
                disabled={testLoading}
              >
                <i className={`bi ${testLoading ? "bi-arrow-repeat" : "bi-play"} me-1`} aria-hidden="true" />
                {testLoading ? "Running..." : "Run"}
              </button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="row g-3">
            <div className="col-md-6">
              <div className="text-muted small">Name</div>
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
            <div className="col-md-6">
              <div className="text-muted small">Rules</div>
              <div className="fw-semibold">
                {ruleCount} total, {enabledRuleCount} enabled
              </div>
            </div>
            <div className="col-12">
              <label className="form-label">Change summary (optional)</label>
              <textarea
                className="form-control"
                rows={2}
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="Optional note about this version..."
                disabled={saving}
              />
            </div>
            <div className="col-12">
              <div className="text-muted small mb-2">Rule preview</div>
              {rules.length === 0 ? (
                <div className="text-muted small">No rules configured.</div>
              ) : (
                <div className="d-flex flex-column gap-1">
                  {rules.slice(0, 6).map((rule) => (
                    <div key={rule.id} className="d-flex align-items-center gap-2">
                      <span className={`badge ${rule.enabled ? "text-bg-success" : "text-bg-secondary"}`}>
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span className="fw-semibold">{rule.name}</span>
                      <span className="text-muted small">{rule.type === "preset" ? "Preset" : "Regex"}</span>
                    </div>
                  ))}
                  {rules.length > 6 ? <div className="text-muted small">...and {rules.length - 6} more</div> : null}
                </div>
              )}
            </div>
          </div>
        )}
      </WizardShell>
    </div>
  );
}
