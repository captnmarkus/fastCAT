import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { initializeSetup, login } from "../api";
import type { AuthUser } from "../types/app";
import { normalizeLocale } from "../lib/i18n/locale";

const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.";

const DEFAULT_LANGUAGE_TAGS = [
  "de-DE",
  "en-GB",
  "fr-FR",
  "it-IT",
  "es-ES",
  "pt-PT",
  "nl-NL",
  "pl-PL",
  "sv-SE",
  "da-DK",
  "fi-FI",
  "no-NO",
  "is-IS",
  "cs-CZ",
  "sk-SK",
  "sl-SI",
  "hr-HR",
  "hu-HU",
  "ro-RO",
  "bg-BG",
  "el-GR",
  "et-EE",
  "lv-LV",
  "lt-LT",
  "ga-IE",
  "uk-UA",
  "tr-TR",
  "sq-AL",
  "mk-MK",
  "sr-RS",
  "bs-BA",
  "ru-RU"
];

const DEFAULT_SOURCE = "de-DE";
const DEFAULT_TARGETS = ["en-GB"];
const DEFAULT_DEPARTMENTS = ["General"];
const SETUP_STEPS = ["Admin", "Languages", "App Agent", "Departments"] as const;

function splitList(input: string): string[] {
  return String(input || "")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseLanguageList(input: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of splitList(input)) {
    const locale = normalizeLocale(entry);
    if (!locale.canonical) continue;
    const key = locale.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(locale.canonical);
  }
  return values;
}

function parseDepartmentList(input: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of splitList(input)) {
    const name = entry.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(name);
  }
  return values;
}

function validatePassword(value: string): string | null {
  const password = String(value || "");
  if (password.length < 12) return PASSWORD_POLICY_MESSAGE;
  if (/\s/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/[a-z]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/[A-Z]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/[0-9]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/[^A-Za-z0-9]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  return null;
}

function isValidUrl(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export default function SetupWizardPage({
  onConfigured
}: {
  onConfigured: (user?: AuthUser | null) => void;
}) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyConfigured, setAlreadyConfigured] = useState(false);
  const [admin, setAdmin] = useState({
    username: "",
    password: "",
    email: "",
    displayName: ""
  });
  const [languageText, setLanguageText] = useState(DEFAULT_LANGUAGE_TAGS.join("\n"));
  const [defaultSource, setDefaultSource] = useState(DEFAULT_SOURCE);
  const [defaultTargets, setDefaultTargets] = useState(DEFAULT_TARGETS.join(", "));
  const [appAgentMode, setAppAgentMode] = useState<"configure_now" | "finish_later">("finish_later");
  const [appAgent, setAppAgent] = useState({
    modelName: "",
    endpoint: "",
    providerApiKey: "",
    providerOrg: "",
    providerProject: "",
    providerRegion: "",
    systemPrompt: ""
  });
  const [departmentsText, setDepartmentsText] = useState(DEFAULT_DEPARTMENTS.join("\n"));

  const languageList = useMemo(() => parseLanguageList(languageText), [languageText]);
  const departmentList = useMemo(() => parseDepartmentList(departmentsText), [departmentsText]);
  const canonicalDefaultSource = useMemo(
    () => normalizeLocale(defaultSource).canonical,
    [defaultSource]
  );
  const defaultTargetList = useMemo(() => {
    const parsed = parseLanguageList(defaultTargets);
    return canonicalDefaultSource ? parsed.filter((tag) => tag !== canonicalDefaultSource) : parsed;
  }, [canonicalDefaultSource, defaultTargets]);

  const passwordError = validatePassword(admin.password);
  const canContinueAdmin =
    Boolean(admin.username.trim()) && Boolean(admin.password) && !passwordError;

  const defaultSourceValid =
    Boolean(canonicalDefaultSource) && languageList.includes(canonicalDefaultSource);
  const defaultTargetsValid = defaultTargetList.every((tag) => languageList.includes(tag));
  const canContinueLanguages =
    languageList.length > 0 &&
    defaultSourceValid &&
    defaultTargetList.length > 0 &&
    defaultTargetsValid;

  const trimmedAgentEndpoint = appAgent.endpoint.trim();
  const agentEndpointValid = !trimmedAgentEndpoint || isValidUrl(trimmedAgentEndpoint);
  const canContinueAgent =
    appAgentMode === "finish_later" ||
    (Boolean(appAgent.modelName.trim()) && Boolean(trimmedAgentEndpoint) && agentEndpointValid);

  const canFinish =
    departmentList.length > 0 &&
    languageList.length > 0 &&
    defaultSourceValid &&
    defaultTargetsValid &&
    canContinueAgent;

  async function handleFinish() {
    if (!canFinish || saving) return;
    setSaving(true);
    setError(null);
    setAlreadyConfigured(false);
    try {
      await initializeSetup({
        admin: {
          username: admin.username.trim(),
          password: admin.password,
          email: admin.email.trim() || undefined,
          displayName: admin.displayName.trim() || undefined
        },
        languages: languageList,
        defaults: {
          defaultSource: canonicalDefaultSource,
          defaultTargets: defaultTargetList
        },
        appAgent: {
          mode: appAgentMode,
          modelName: appAgent.modelName.trim() || undefined,
          endpoint: trimmedAgentEndpoint || undefined,
          providerApiKey: appAgent.providerApiKey.trim() || undefined,
          providerOrg: appAgent.providerOrg.trim() || undefined,
          providerProject: appAgent.providerProject.trim() || undefined,
          providerRegion: appAgent.providerRegion.trim() || undefined,
          systemPrompt: appAgent.systemPrompt.trim() || undefined
        },
        departments: departmentList
      });

      let signedInUser: AuthUser | null = null;
      try {
        signedInUser = (await login(admin.username.trim(), admin.password)) as AuthUser;
      } catch {
        signedInUser = null;
      }

      onConfigured(signedInUser);
      navigate(signedInUser ? "/dashboard" : "/projects", { replace: true });
    } catch (err: any) {
      if (err?.status === 409) {
        setAlreadyConfigured(true);
        setError(err?.userMessage || "Setup already completed.");
      } else {
        setError(err?.userMessage || "Failed to complete setup.");
      }
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    if (stepIndex === 0 && !canContinueAdmin) return;
    if (stepIndex === 1 && !canContinueLanguages) return;
    if (stepIndex === 2 && !canContinueAgent) return;
    setStepIndex((prev) => Math.min(SETUP_STEPS.length - 1, prev + 1));
  }

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light px-3">
      <div className="card shadow-sm border-0" style={{ width: 820, maxWidth: "100%" }}>
        <div className="card-body p-4">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-3">
            <div>
              <div className="text-muted small">First run</div>
              <h3 className="mb-0">Global Setup</h3>
            </div>
            <div className="text-muted small">Step {stepIndex + 1} of {SETUP_STEPS.length}</div>
          </div>

          <div className="d-flex flex-wrap gap-2 mb-4">
            {SETUP_STEPS.map((label, index) => {
              const active = index === stepIndex;
              const complete = index < stepIndex;
              const className = active
                ? "badge text-bg-dark px-3 py-2"
                : complete
                  ? "badge text-bg-success-subtle text-success-emphasis px-3 py-2"
                  : "badge text-bg-light px-3 py-2";
              return (
                <span key={label} className={className}>
                  {index + 1}. {label}
                </span>
              );
            })}
          </div>

          {error ? <div className="alert alert-danger">{error}</div> : null}
          {alreadyConfigured ? (
            <div className="alert alert-warning d-flex align-items-center justify-content-between gap-2">
              <div>Setup is already complete. Continue to sign in.</div>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => {
                  onConfigured(null);
                  navigate("/projects", { replace: true });
                }}
              >
                Go to login
              </button>
            </div>
          ) : null}

          {stepIndex === 0 ? (
            <div className="d-grid gap-3">
              <p className="text-muted mb-0">
                Create the first admin account. This account will complete setup and manage the app-wide assistant later.
              </p>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Username</label>
                  <input
                    className="form-control"
                    value={admin.username}
                    onChange={(e) => setAdmin((prev) => ({ ...prev, username: e.target.value }))}
                    disabled={saving}
                    autoFocus
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Email (optional)</label>
                  <input
                    className="form-control"
                    value={admin.email}
                    onChange={(e) => setAdmin((prev) => ({ ...prev, email: e.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Password</label>
                  <input
                    type="password"
                    className={`form-control${passwordError ? " is-invalid" : ""}`}
                    value={admin.password}
                    onChange={(e) => setAdmin((prev) => ({ ...prev, password: e.target.value }))}
                    disabled={saving}
                  />
                  {passwordError ? <div className="invalid-feedback d-block">{passwordError}</div> : null}
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Display name (optional)</label>
                  <input
                    className="form-control"
                    value={admin.displayName}
                    onChange={(e) => setAdmin((prev) => ({ ...prev, displayName: e.target.value }))}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="text-muted small">{PASSWORD_POLICY_MESSAGE}</div>
            </div>
          ) : null}

          {stepIndex === 1 ? (
            <div className="d-grid gap-3">
              <p className="text-muted mb-0">
                Configure the global language list before anyone starts creating projects. Only enabled languages will be available later in the agent flow.
              </p>
              <div className="row g-3">
                <div className="col-md-7">
                  <label className="form-label small text-uppercase text-muted">Enabled languages</label>
                  <textarea
                    className="form-control"
                    rows={11}
                    value={languageText}
                    onChange={(e) => setLanguageText(e.target.value)}
                    disabled={saving}
                  />
                  <div className="form-text">
                    {languageList.length} languages enabled. Use one language tag per line.
                  </div>
                </div>
                <div className="col-md-5 d-grid gap-3">
                  <div>
                    <label className="form-label small text-uppercase text-muted">Default source</label>
                    <input
                      className={`form-control${!defaultSourceValid ? " is-invalid" : ""}`}
                      value={defaultSource}
                      onChange={(e) => setDefaultSource(e.target.value)}
                      disabled={saving}
                    />
                    {!defaultSourceValid ? (
                      <div className="invalid-feedback d-block">Default source must be in the enabled list.</div>
                    ) : null}
                  </div>
                  <div>
                    <label className="form-label small text-uppercase text-muted">Default targets</label>
                    <input
                      className={`form-control${!defaultTargetsValid || defaultTargetList.length === 0 ? " is-invalid" : ""}`}
                      value={defaultTargets}
                      onChange={(e) => setDefaultTargets(e.target.value)}
                      disabled={saving}
                    />
                    {!defaultTargetsValid || defaultTargetList.length === 0 ? (
                      <div className="invalid-feedback d-block">
                        Add at least one enabled target language.
                      </div>
                    ) : null}
                    <div className="form-text">Comma-separated language tags.</div>
                  </div>
                  <div className="card bg-light border-0">
                    <div className="card-body py-3">
                      <div className="fw-semibold mb-1">Why this matters</div>
                      <div className="text-muted small mb-0">
                        The app-wide agent will only offer target languages that are enabled here.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {stepIndex === 2 ? (
            <div className="d-grid gap-3">
              <p className="text-muted mb-0">
                Decide whether to configure the app-wide agent now. This step is mandatory, but you can intentionally finish the live setup later and the dashboard will show a clean placeholder until then.
              </p>
              <div className="d-grid gap-3">
                <label className="card border-0 shadow-sm">
                  <div className="card-body d-flex gap-3">
                    <input
                      className="form-check-input mt-1"
                      type="radio"
                      name="app-agent-mode"
                      checked={appAgentMode === "finish_later"}
                      onChange={() => setAppAgentMode("finish_later")}
                      disabled={saving}
                    />
                    <div>
                      <div className="fw-semibold">Finish live agent setup later</div>
                      <div className="text-muted small">
                        Recommended if you still need to create a provider or collect credentials. Users will see a placeholder until the agent is fully configured in Admin &gt; App Agent.
                      </div>
                    </div>
                  </div>
                </label>

                <label className="card border-0 shadow-sm">
                  <div className="card-body d-flex gap-3">
                    <input
                      className="form-check-input mt-1"
                      type="radio"
                      name="app-agent-mode"
                      checked={appAgentMode === "configure_now"}
                      onChange={() => setAppAgentMode("configure_now")}
                      disabled={saving}
                    />
                    <div className="w-100">
                      <div className="fw-semibold">Configure a live endpoint now</div>
                      <div className="text-muted small mb-3">
                        Use a custom OpenAI-compatible endpoint now. You can still switch to a managed provider later in the admin panel.
                      </div>

                      {appAgentMode === "configure_now" ? (
                        <div className="row g-3">
                          <div className="col-md-6">
                            <label className="form-label small text-uppercase text-muted">Model name</label>
                            <input
                              className={`form-control${!appAgent.modelName.trim() ? " is-invalid" : ""}`}
                              value={appAgent.modelName}
                              onChange={(e) => setAppAgent((prev) => ({ ...prev, modelName: e.target.value }))}
                              placeholder="gpt-4.1-mini"
                              disabled={saving}
                            />
                            {!appAgent.modelName.trim() ? (
                              <div className="invalid-feedback d-block">Model name is required for live setup.</div>
                            ) : null}
                          </div>
                          <div className="col-md-6">
                            <label className="form-label small text-uppercase text-muted">Endpoint URL</label>
                            <input
                              className={`form-control${!trimmedAgentEndpoint || !agentEndpointValid ? " is-invalid" : ""}`}
                              value={appAgent.endpoint}
                              onChange={(e) => setAppAgent((prev) => ({ ...prev, endpoint: e.target.value }))}
                              placeholder="https://provider.example/v1"
                              disabled={saving}
                            />
                            {!trimmedAgentEndpoint || !agentEndpointValid ? (
                              <div className="invalid-feedback d-block">Enter a valid endpoint URL.</div>
                            ) : null}
                          </div>
                          <div className="col-md-6">
                            <label className="form-label small text-uppercase text-muted">API key (optional)</label>
                            <input
                              type="password"
                              className="form-control"
                              value={appAgent.providerApiKey}
                              onChange={(e) =>
                                setAppAgent((prev) => ({ ...prev, providerApiKey: e.target.value }))
                              }
                              placeholder="Leave blank for local or unauthenticated endpoints"
                              disabled={saving}
                            />
                          </div>
                          <div className="col-md-2">
                            <label className="form-label small text-uppercase text-muted">Org</label>
                            <input
                              className="form-control"
                              value={appAgent.providerOrg}
                              onChange={(e) => setAppAgent((prev) => ({ ...prev, providerOrg: e.target.value }))}
                              disabled={saving}
                            />
                          </div>
                          <div className="col-md-2">
                            <label className="form-label small text-uppercase text-muted">Project</label>
                            <input
                              className="form-control"
                              value={appAgent.providerProject}
                              onChange={(e) =>
                                setAppAgent((prev) => ({ ...prev, providerProject: e.target.value }))
                              }
                              disabled={saving}
                            />
                          </div>
                          <div className="col-md-2">
                            <label className="form-label small text-uppercase text-muted">Region</label>
                            <input
                              className="form-control"
                              value={appAgent.providerRegion}
                              onChange={(e) =>
                                setAppAgent((prev) => ({ ...prev, providerRegion: e.target.value }))
                              }
                              disabled={saving}
                            />
                          </div>
                          <div className="col-12">
                            <label className="form-label small text-uppercase text-muted">System prompt (optional)</label>
                            <textarea
                              className="form-control"
                              rows={4}
                              value={appAgent.systemPrompt}
                              onChange={(e) =>
                                setAppAgent((prev) => ({ ...prev, systemPrompt: e.target.value }))
                              }
                              disabled={saving}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          ) : null}

          {stepIndex === 3 ? (
            <div className="d-grid gap-3">
              <p className="text-muted mb-0">
                Define the departments before users begin creating projects. Managers and standard users will be scoped by these departments later.
              </p>
              <div>
                <label className="form-label small text-uppercase text-muted">Departments</label>
                <textarea
                  className={`form-control${departmentList.length === 0 ? " is-invalid" : ""}`}
                  rows={8}
                  value={departmentsText}
                  onChange={(e) => setDepartmentsText(e.target.value)}
                  disabled={saving}
                />
                {departmentList.length === 0 ? (
                  <div className="invalid-feedback d-block">Add at least one department.</div>
                ) : null}
                <div className="form-text">{departmentList.length} departments configured.</div>
              </div>
            </div>
          ) : null}

          <div className="d-flex align-items-center justify-content-between mt-4">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
              disabled={saving || stepIndex === 0}
            >
              Back
            </button>

            {stepIndex < SETUP_STEPS.length - 1 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleNext}
                disabled={
                  saving ||
                  (stepIndex === 0 && !canContinueAdmin) ||
                  (stepIndex === 1 && !canContinueLanguages) ||
                  (stepIndex === 2 && !canContinueAgent)
                }
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleFinish}
                disabled={!canFinish || saving}
              >
                {saving ? "Saving..." : "Finish setup"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
