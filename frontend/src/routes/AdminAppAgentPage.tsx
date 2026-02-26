import React, { useEffect, useMemo, useState } from "react";
import {
  getAppAgentAdminConfig,
  updateAppAgentAdminConfig,
  type AppAgentAdminConfig,
  type AppAgentToolName
} from "../api";
import type { AuthUser } from "../types/app";

const TOOL_LABELS: Record<AppAgentToolName, string> = {
  translate_snippet: "Translate Snippet",
  create_project: "Create Project",
  list_projects: "List Projects",
  get_project_status: "Get Project Status"
};

const TOOL_DESCRIPTIONS: Record<AppAgentToolName, string> = {
  translate_snippet: "Translate small snippets with max-length enforcement.",
  create_project: "Create a project for the current user (requires file IDs).",
  list_projects: "List projects for the current user.",
  get_project_status: "Read project progress for the current user."
};

export default function AdminAppAgentPage({ currentUser }: { currentUser: AuthUser }) {
  const [config, setConfig] = useState<AppAgentAdminConfig | null>(null);
  const [providerOptions, setProviderOptions] = useState<Array<{ id: number; name: string; model: string; enabled: boolean }>>([]);
  const [allowlistedTools, setAllowlistedTools] = useState<AppAgentToolName[]>([]);
  const [replaceProviderKey, setReplaceProviderKey] = useState(false);
  const [clearProviderKey, setClearProviderKey] = useState(false);
  const [providerKeyInput, setProviderKeyInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getAppAgentAdminConfig();
        if (cancelled) return;
        setConfig(res.config);
        setProviderOptions(res.providers || []);
        setAllowlistedTools(res.allowlistedTools || []);
        setReplaceProviderKey(false);
        setClearProviderKey(false);
        setProviderKeyInput("");
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.userMessage || err?.message || "Failed to load App Agent config.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleTools = useMemo(() => {
    if (allowlistedTools.length > 0) return allowlistedTools;
    return Object.keys(TOOL_LABELS) as AppAgentToolName[];
  }, [allowlistedTools]);

  if (loading || !config) {
    return (
      <div className="py-3">
        <h2 className="mb-3">App Agent</h2>
        <div className="text-muted">Loading App Agent settings...</div>
      </div>
    );
  }

  return (
    <div className="py-3">
      <h2 className="mb-3">App Agent</h2>
      <div className="card-enterprise p-4 d-grid gap-3">
        {error ? <div className="alert alert-danger mb-0">{error}</div> : null}
        {success ? <div className="alert alert-success mb-0">{success}</div> : null}

        <div className="form-check form-switch">
          <input
            id="app-agent-enabled"
            className="form-check-input"
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig((prev) => (prev ? { ...prev, enabled: event.target.checked } : prev))}
          />
          <label className="form-check-label fw-semibold" htmlFor="app-agent-enabled">
            Enable App Agent
          </label>
        </div>

        <div className="row g-3">
          <div className="col-lg-4">
            <label className="form-label">Connection Provider</label>
            <select
              className="form-select"
              value={config.connectionProvider}
              onChange={(event) =>
                setConfig((prev) =>
                  prev
                    ? {
                        ...prev,
                        connectionProvider: event.target.value === "gateway" ? "gateway" : "mock"
                      }
                    : prev
                )
              }
            >
              <option value="mock">Mock (deterministic)</option>
              <option value="gateway">Gateway Provider</option>
            </select>
          </div>
          <div className="col-lg-4">
            <label className="form-label">Provider</label>
            <select
              className="form-select"
              value={config.providerId ?? ""}
              onChange={(event) =>
                setConfig((prev) =>
                  prev
                    ? {
                        ...prev,
                        providerId: event.target.value ? Number(event.target.value) : null
                      }
                    : prev
                )
              }
            >
              <option value="">Use default provider</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.enabled}>
                  {provider.name}
                  {provider.model ? ` (${provider.model})` : ""}
                  {!provider.enabled ? " - disabled" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="col-lg-4">
            <label className="form-label">Model Name Override</label>
            <input
              className="form-control"
              value={config.modelName || ""}
              onChange={(event) =>
                setConfig((prev) => (prev ? { ...prev, modelName: event.target.value } : prev))
              }
              placeholder="e.g. gpt-4.1-mini"
            />
          </div>
          <div className="col-12">
            <label className="form-label">Endpoint Override</label>
            <input
              className="form-control"
              value={config.endpoint || ""}
              onChange={(event) =>
                setConfig((prev) => (prev ? { ...prev, endpoint: event.target.value } : prev))
              }
              placeholder="https://provider.example/v1"
            />
            <div className="form-text">Optional. Leave empty to use the selected provider endpoint.</div>
          </div>
          <div className="col-lg-6">
            <label className="form-label">Provider API Key</label>
            <div className="d-grid gap-2">
              <div className="small text-muted">
                {config.providerApiKeyConfigured
                  ? `Configured (${config.providerApiKeyMasked || "masked"})`
                  : "No API key configured"}
              </div>
              <div className="d-flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`btn btn-sm ${replaceProviderKey ? "btn-dark" : "btn-outline-secondary"}`}
                  onClick={() => {
                    setReplaceProviderKey((prev) => {
                      const next = !prev;
                      if (!next) setProviderKeyInput("");
                      return next;
                    });
                    if (!replaceProviderKey) setClearProviderKey(false);
                  }}
                >
                  {replaceProviderKey ? "Cancel replace" : "Replace key"}
                </button>
                {config.providerApiKeyConfigured ? (
                  <label className="form-check m-0 d-flex align-items-center gap-2">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={clearProviderKey}
                      onChange={(event) => setClearProviderKey(event.target.checked)}
                    />
                    <span className="form-check-label small">Clear stored key on save</span>
                  </label>
                ) : null}
              </div>
              {replaceProviderKey ? (
                <input
                  className="form-control"
                  type="password"
                  value={providerKeyInput}
                  onChange={(event) => setProviderKeyInput(event.target.value)}
                  placeholder="Enter new API key"
                  autoComplete="off"
                />
              ) : null}
            </div>
          </div>
          <div className="col-lg-2">
            <label className="form-label">Provider Org</label>
            <input
              className="form-control"
              value={config.providerOrg || ""}
              onChange={(event) =>
                setConfig((prev) => (prev ? { ...prev, providerOrg: event.target.value || null } : prev))
              }
              placeholder="Optional"
            />
          </div>
          <div className="col-lg-2">
            <label className="form-label">Provider Project</label>
            <input
              className="form-control"
              value={config.providerProject || ""}
              onChange={(event) =>
                setConfig((prev) => (prev ? { ...prev, providerProject: event.target.value || null } : prev))
              }
              placeholder="Optional"
            />
          </div>
          <div className="col-lg-2">
            <label className="form-label">Provider Region</label>
            <input
              className="form-control"
              value={config.providerRegion || ""}
              onChange={(event) =>
                setConfig((prev) => (prev ? { ...prev, providerRegion: event.target.value || null } : prev))
              }
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="form-check form-switch">
          <input
            id="app-agent-mock-mode"
            className="form-check-input"
            type="checkbox"
            checked={config.mockMode}
            onChange={(event) => setConfig((prev) => (prev ? { ...prev, mockMode: event.target.checked } : prev))}
          />
          <label className="form-check-label" htmlFor="app-agent-mock-mode">
            Mock mode (deterministic responses, no external LLM call)
          </label>
        </div>

        <div>
          <label className="form-label">System Prompt</label>
          <textarea
            className="form-control"
            rows={6}
            value={config.systemPrompt || ""}
            onChange={(event) => setConfig((prev) => (prev ? { ...prev, systemPrompt: event.target.value } : prev))}
          />
          <div className="form-text">Visible only to admins. Not exposed to clients.</div>
        </div>

        <div>
          <label className="form-label">Enabled Tools</label>
          <div className="d-grid gap-2">
            {visibleTools.map((tool) => {
              const checked = config.enabledTools.includes(tool);
              return (
                <label key={tool} className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextSet = new Set(config.enabledTools);
                      if (event.target.checked) {
                        nextSet.add(tool);
                      } else {
                        nextSet.delete(tool);
                      }
                      setConfig((prev) => (prev ? { ...prev, enabledTools: Array.from(nextSet) as AppAgentToolName[] } : prev));
                    }}
                  />
                  <span className="form-check-label">
                    <span className="fw-semibold">{TOOL_LABELS[tool] || tool}</span>
                    <span className="text-muted small ms-2">{TOOL_DESCRIPTIONS[tool] || ""}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="form-text mt-2">
            Language pairs are taken automatically from the global Language Settings admin tab.
          </div>
        </div>

        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div className="text-muted small">
            Changes apply via hot reload. Updated by {config.updatedBy || currentUser.username}.
          </div>
          <button
            type="button"
            className="btn btn-dark"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              setSuccess(null);
              try {
                const payload: Partial<AppAgentAdminConfig> = {
                  enabled: config.enabled,
                  connectionProvider: config.connectionProvider,
                  providerId: config.providerId,
                  modelName: config.modelName,
                  endpoint: config.endpoint,
                  mockMode: config.mockMode,
                  systemPrompt: config.systemPrompt,
                  enabledTools: config.enabledTools,
                  providerOrg: config.providerOrg || null,
                  providerProject: config.providerProject || null,
                  providerRegion: config.providerRegion || null
                };
                if (clearProviderKey) {
                  payload.clearProviderApiKey = true;
                  payload.providerApiKey = null;
                } else if (replaceProviderKey && providerKeyInput.trim()) {
                  payload.providerApiKey = providerKeyInput.trim();
                }
                const res = await updateAppAgentAdminConfig(payload);
                setConfig(res.config);
                setReplaceProviderKey(false);
                setClearProviderKey(false);
                setProviderKeyInput("");
                setSuccess("App Agent configuration updated.");
              } catch (err: any) {
                setError(err?.userMessage || err?.message || "Failed to update App Agent config.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save App Agent Config"}
          </button>
        </div>
      </div>
    </div>
  );
}
