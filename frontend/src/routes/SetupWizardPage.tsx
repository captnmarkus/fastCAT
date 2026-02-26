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
  const canFinish =
    languageList.length > 0 &&
    departmentList.length > 0 &&
    defaultSourceValid &&
    defaultTargetsValid;

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
        departments: departmentList
      });

      let signedInUser: AuthUser | null = null;
      try {
        signedInUser = (await login(admin.username.trim(), admin.password)) as AuthUser;
      } catch {
        signedInUser = null;
      }

      onConfigured(signedInUser);
      if (signedInUser) {
        navigate("/admin/users", { replace: true });
      } else {
        navigate("/projects", { replace: true });
      }
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

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light px-3">
      <div className="card shadow-sm border-0" style={{ width: 720, maxWidth: "100%" }}>
        <div className="card-body p-4">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <div className="text-muted small">First run</div>
              <h3 className="mb-0">Global Setup</h3>
            </div>
            <div className="text-muted small">Step {stepIndex + 1} of 2</div>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
          {alreadyConfigured && (
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
          )}

          {stepIndex === 0 && (
            <div className="d-grid gap-3">
              <p className="text-muted mb-0">
                Create the first admin account. You will use this account to complete FastCAT setup.
              </p>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Username</label>
                  <input
                    className="form-control"
                    value={admin.username}
                    onChange={(e) => setAdmin((p) => ({ ...p, username: e.target.value }))}
                    disabled={saving}
                    autoFocus
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Email (optional)</label>
                  <input
                    className="form-control"
                    value={admin.email}
                    onChange={(e) => setAdmin((p) => ({ ...p, email: e.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Password</label>
                  <input
                    type="password"
                    className={`form-control${passwordError ? " is-invalid" : ""}`}
                    value={admin.password}
                    onChange={(e) => setAdmin((p) => ({ ...p, password: e.target.value }))}
                    disabled={saving}
                  />
                  {passwordError && <div className="invalid-feedback d-block">{passwordError}</div>}
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-uppercase text-muted">Display name (optional)</label>
                  <input
                    className="form-control"
                    value={admin.displayName}
                    onChange={(e) => setAdmin((p) => ({ ...p, displayName: e.target.value }))}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="text-muted small">{PASSWORD_POLICY_MESSAGE}</div>
            </div>
          )}

          {stepIndex === 1 && (
            <div className="d-grid gap-3">
              <p className="text-muted mb-0">
                Review the default languages and departments. Serbo-Croatian is supported via Serbian, Croatian, and
                Bosnian.
              </p>
              <div className="row g-3">
                <div className="col-md-7">
                  <label className="form-label small text-uppercase text-muted">Enabled languages</label>
                  <textarea
                    className="form-control"
                    rows={10}
                    value={languageText}
                    onChange={(e) => setLanguageText(e.target.value)}
                    disabled={saving}
                  />
                  <div className="form-text">
                    {languageList.length} languages enabled. Use one tag per line (e.g., fr-FR, sr-RS).
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
                    {!defaultSourceValid && (
                      <div className="invalid-feedback d-block">Default source must be in the enabled list.</div>
                    )}
                  </div>
                  <div>
                    <label className="form-label small text-uppercase text-muted">Default targets</label>
                    <input
                      className={`form-control${!defaultTargetsValid ? " is-invalid" : ""}`}
                      value={defaultTargets}
                      onChange={(e) => setDefaultTargets(e.target.value)}
                      disabled={saving}
                    />
                    {!defaultTargetsValid && (
                      <div className="invalid-feedback d-block">Default targets must be enabled languages.</div>
                    )}
                    <div className="form-text">Comma-separated language tags.</div>
                  </div>
                  <div>
                    <label className="form-label small text-uppercase text-muted">Departments</label>
                    <textarea
                      className="form-control"
                      rows={6}
                      value={departmentsText}
                      onChange={(e) => setDepartmentsText(e.target.value)}
                      disabled={saving}
                    />
                    <div className="form-text">{departmentList.length} departments configured.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="d-flex align-items-center justify-content-between mt-4">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
              disabled={saving || stepIndex === 0}
            >
              Back
            </button>
            {stepIndex === 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStepIndex(1)}
                disabled={!canContinueAdmin || saving}
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
