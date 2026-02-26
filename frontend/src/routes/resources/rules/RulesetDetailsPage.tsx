import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import {
  checkLanguageProcessingRulesetName,
  copyLanguageProcessingRuleset,
  deleteLanguageProcessingRuleset,
  getLanguageProcessingRulesetDetails,
  updateLanguageProcessingRuleset,
  type LanguageProcessingRuleset,
  type LanguageProcessingRulesetVersion
} from "../../../api";
import { formatDateTime } from "../../../utils/format";
import RulesetRuleBuilder from "./RulesetRuleBuilder";
import {
  normalizeRulesFromApi,
  serializeRulesForApi,
  validateRulesetRules,
  type RulesetRule
} from "./rulesetUtils";

type NameCheckStatus = "idle" | "checking" | "available" | "duplicate" | "error";

function statusBadge(disabled: boolean) {
  return disabled ? "text-bg-secondary" : "text-bg-success";
}

export default function RulesetDetailsPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const params = useParams();
  const rulesetId = Number(params.id);

  const [entry, setEntry] = useState<LanguageProcessingRuleset | null>(null);
  const [history, setHistory] = useState<LanguageProcessingRulesetVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [editRulesOpen, setEditRulesOpen] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDisabled, setEditDisabled] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editTouched, setEditTouched] = useState(false);
  const [editStatus, setEditStatus] = useState<NameCheckStatus>("idle");
  const editCheckSeq = useRef(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [rulesDraft, setRulesDraft] = useState<RulesetRule[]>([]);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const [rulesSummary, setRulesSummary] = useState("");

  const rulesValidation = useMemo(() => validateRulesetRules(rulesDraft), [rulesDraft]);
  const rulesValid = useMemo(() => Object.keys(rulesValidation).length === 0, [rulesValidation]);

  const normalizedRules = useMemo(() => normalizeRulesFromApi(entry?.rules || []), [entry?.rules]);

  async function refresh() {
    if (!Number.isFinite(rulesetId) || rulesetId <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getLanguageProcessingRulesetDetails(rulesetId);
      setEntry(res.item);
      setHistory(res.history || []);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to load ruleset.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(rulesetId) || rulesetId <= 0) {
      setError("Invalid ruleset id.");
      setLoading(false);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesetId]);

  useEffect(() => {
    if (!entry) return;
    setEditName(entry.name || "");
    setEditDescription(entry.description || "");
    setEditDisabled(Boolean(entry.disabled));
    setRulesDraft(normalizeRulesFromApi(entry.rules || []));
    setEditTouched(false);
    setEditStatus("idle");
    setEditSummary("");
    setRulesSummary("");
  }, [entry?.id]);

  useEffect(() => {
    if (normalizedRules.length === 0) {
      if (openRuleId) setOpenRuleId(null);
      return;
    }
    if (openRuleId && normalizedRules.some((rule) => rule.id === openRuleId)) return;
    setOpenRuleId(normalizedRules[0].id);
  }, [normalizedRules, openRuleId]);

  useEffect(() => {
    setEditStatus("idle");
  }, [editName]);

  const editNameError = useMemo(() => {
    if (!editName.trim()) return "Name is required.";
    if (editStatus === "duplicate") return "A ruleset with this name already exists.";
    if (editStatus === "error") return "Could not verify name availability.";
    return null;
  }, [editName, editStatus]);

  async function runEditNameCheck(value: string) {
    if (!entry) return null;
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      setEditStatus("idle");
      return "empty";
    }
    const seq = ++editCheckSeq.current;
    setEditStatus("checking");
    try {
      const exists = await checkLanguageProcessingRulesetName(trimmed, { excludeId: entry.id });
      if (seq !== editCheckSeq.current) return null;
      setEditStatus(exists ? "duplicate" : "available");
      return exists ? "duplicate" : "available";
    } catch {
      if (seq !== editCheckSeq.current) return null;
      setEditStatus("error");
      return "error";
    }
  }

  async function handleSaveMetadata() {
    if (!entry) return;
    setEditTouched(true);
    setEditSaving(true);
    setEditError(null);
    const status = await runEditNameCheck(editName);
    if (!editName.trim() || status === "duplicate" || status === "error") {
      setEditSaving(false);
      return;
    }
    try {
      await updateLanguageProcessingRuleset(entry.id, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        disabled: editDisabled,
        summary: editSummary.trim() || undefined
      });
      setEditMetaOpen(false);
      setEditSummary("");
      await refresh();
    } catch (err: any) {
      setEditError(err?.userMessage || err?.message || "Failed to update ruleset.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSaveRules() {
    if (!entry) return;
    setRulesError(null);
    setRulesSaving(true);
    if (!rulesValid) {
      setRulesError("Fix invalid rules before saving.");
      setRulesSaving(false);
      return;
    }
    try {
      await updateLanguageProcessingRuleset(entry.id, {
        rules: serializeRulesForApi(rulesDraft),
        summary: rulesSummary.trim() || undefined
      });
      setEditRulesOpen(false);
      setRulesSummary("");
      await refresh();
    } catch (err: any) {
      setRulesError(err?.userMessage || err?.message || "Failed to update rules.");
    } finally {
      setRulesSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    const confirmed = window.confirm(`Delete ruleset "${entry.name}"?`);
    if (!confirmed) return;
    try {
      await deleteLanguageProcessingRuleset(entry.id);
      nav("/resources/rules");
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to delete ruleset.");
    }
  }

  async function handleDuplicate() {
    if (!entry) return;
    try {
      const copied = await copyLanguageProcessingRuleset(entry.id);
      nav(`/resources/rules/${copied.id}`);
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to duplicate ruleset.");
    }
  }

  if (loading) {
    return <div className="text-muted p-3">Loading ruleset...</div>;
  }

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-danger mb-0">{error}</div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="p-3">
        <div className="alert alert-warning mb-0">Ruleset not found.</div>
      </div>
    );
  }

  const lastModifiedLabel = formatDateTime(entry.updatedAt) || "-";
  const createdLabel = formatDateTime(entry.createdAt) || "-";
  const createdByLabel = entry.createdBy || "-";
  const updatedByLabel = entry.updatedBy || "-";

  return (
    <div className="d-flex flex-column gap-3">
      <div className="card-enterprise p-3">
        <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav("/resources/rules")}>
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            Back to Rules
          </button>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() =>
                setEditMetaOpen((v) => {
                  const next = !v;
                  if (next) setEditSummary("");
                  return next;
                })
              }
            >
              <i className="bi bi-pencil me-1" aria-hidden="true" />
              Edit metadata
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                setEditRulesOpen((v) => {
                  const next = !v;
                  if (next) {
                    setRulesDraft(normalizeRulesFromApi(entry.rules || []));
                    setRulesError(null);
                    setRulesSummary("");
                  }
                  return next;
                });
              }}
            >
              <i className="bi bi-sliders me-1" aria-hidden="true" />
              Edit rules
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleDuplicate}>
              <i className="bi bi-files me-1" aria-hidden="true" />
              Duplicate
            </button>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={handleDelete}>
              <i className="bi bi-trash me-1" aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap mt-3">
          <h2 className="mb-0">{entry.name}</h2>
          <span className={`badge ${statusBadge(entry.disabled)}`}>{entry.disabled ? "Disabled" : "Enabled"}</span>
        </div>
        <div className="text-muted small mt-1">Last modified {lastModifiedLabel}</div>
      </div>

      {editMetaOpen ? (
        <div className="card-enterprise p-3">
          <div className="fw-semibold mb-2">Edit metadata</div>
          {editError ? <div className="alert alert-danger py-2">{editError}</div> : null}
          <div className="row g-3">
            <div className="col-lg-6">
              <label className="form-label">Name</label>
              <input
                className={`form-control ${((editTouched || editSaving) && editNameError) ? "is-invalid" : ""}`}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => {
                  setEditTouched(true);
                  if (editName.trim()) runEditNameCheck(editName);
                }}
                disabled={editSaving}
              />
              {((editTouched || editSaving) && editNameError) ? <div className="invalid-feedback">{editNameError}</div> : null}
              {editStatus === "checking" ? <div className="form-text text-muted">Checking name availability...</div> : null}
            </div>
            <div className="col-lg-6">
              <label className="form-label">Status</label>
              <select
                className="form-select"
                value={editDisabled ? "disabled" : "enabled"}
                onChange={(e) => setEditDisabled(e.target.value === "disabled")}
                disabled={editSaving}
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <div className="col-12">
              <label className="form-label">Description</label>
              <textarea
                className="form-control"
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                disabled={editSaving}
              />
            </div>
            <div className="col-12">
              <label className="form-label">Change summary (optional)</label>
              <input
                className="form-control"
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                disabled={editSaving}
              />
            </div>
          </div>
          <div className="mt-3 d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                setEditMetaOpen(false);
                setEditSummary("");
              }}
              disabled={editSaving}
            >
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveMetadata} disabled={editSaving}>
              {editSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}

      {editRulesOpen ? (
        <div className="card-enterprise p-3">
          <div className="fw-semibold mb-2">Edit rules</div>
          {rulesError ? <div className="alert alert-danger py-2">{rulesError}</div> : null}
          <div className="mb-3">
            <label className="form-label">Change summary (optional)</label>
            <input
              className="form-control"
              value={rulesSummary}
              onChange={(e) => setRulesSummary(e.target.value)}
              disabled={rulesSaving}
            />
          </div>
          <RulesetRuleBuilder
            rules={rulesDraft}
            onChange={setRulesDraft}
            showValidation
            disabled={rulesSaving}
          />
          <div className="mt-3 d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                setEditRulesOpen(false);
                setRulesSummary("");
              }}
              disabled={rulesSaving}
            >
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveRules} disabled={rulesSaving}>
              {rulesSaving ? "Saving..." : "Save rules"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card-enterprise p-3">
            <div className="fw-semibold mb-2">Metadata</div>
            <dl className="fc-project-drawer-dl">
              <dt>Name</dt>
              <dd>{entry.name}</dd>
              <dt>Description</dt>
              <dd>{entry.description || "-"}</dd>
              <dt>Status</dt>
              <dd>{entry.disabled ? "Disabled" : "Enabled"}</dd>
              <dt>Created by</dt>
              <dd>{createdByLabel}</dd>
              <dt>Created at</dt>
              <dd>{createdLabel}</dd>
              <dt>Last modified</dt>
              <dd>{lastModifiedLabel}</dd>
              <dt>Updated by</dt>
              <dd>{updatedByLabel}</dd>
            </dl>
          </div>

          <div className="card-enterprise p-3 mt-3">
            <div className="fw-semibold mb-2">Rules</div>
            {normalizedRules.length === 0 ? (
              <div className="text-muted small">No rules configured.</div>
            ) : (
              <div className="accordion">
                {normalizedRules.map((rule) => {
                  const isOpen = openRuleId === rule.id;
                  return (
                    <div className="accordion-item" key={rule.id}>
                      <h2 className="accordion-header">
                        <button
                          className={`accordion-button${isOpen ? "" : " collapsed"}`}
                          type="button"
                          onClick={() => setOpenRuleId(isOpen ? null : rule.id)}
                          aria-expanded={isOpen}
                        >
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <span className={`badge ${rule.enabled ? "text-bg-success" : "text-bg-secondary"}`}>
                              {rule.enabled ? "Enabled" : "Disabled"}
                            </span>
                            <span className="fw-semibold">{rule.name}</span>
                            <span className="text-muted small">{rule.type === "preset" ? "Preset" : "Regex"}</span>
                          </div>
                        </button>
                      </h2>
                      <div className={`accordion-collapse collapse${isOpen ? " show" : ""}`}>
                        <div className="accordion-body">
                          {rule.type === "regex" ? (
                            <div className="text-muted small">
                              <div>
                                <strong>Pattern:</strong> {(rule.config as any).pattern || "-"}
                              </div>
                              <div>
                                <strong>Replace:</strong> {(rule.config as any).replace ?? "-"}
                              </div>
                              <div>
                                <strong>Flags:</strong> {(rule.config as any).flags || "g"}
                              </div>
                              <div>
                                <strong>Scope:</strong> {(rule.config as any).scope || "target"}
                              </div>
                            </div>
                          ) : (
                            <div className="text-muted small">
                              <div>
                                <strong>Preset:</strong> {(rule.config as any).presetId}
                              </div>
                              <div className="mt-2">
                                <pre className="mb-0">{JSON.stringify(rule.config, null, 2)}</pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card-enterprise p-3 mt-3">
            <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
              <div className="fw-semibold">History</div>
              <div className="text-muted small">{history.length} versions</div>
            </div>
            {history.length === 0 ? (
              <div className="text-muted small">No versions found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr className="text-muted small">
                      <th>Version</th>
                      <th>Date</th>
                      <th>User</th>
                      <th>Summary</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((version, idx) => (
                      <tr key={version.id}>
                        <td>
                          <span className="fw-semibold">v{version.version}</span>
                          {idx === 0 ? <span className="badge text-bg-light text-dark ms-2">Current</span> : null}
                        </td>
                        <td>{formatDateTime(version.createdAt) || "-"}</td>
                        <td>{version.createdBy || "-"}</td>
                        <td
                          className="text-muted small text-truncate"
                          style={{ maxWidth: 260 }}
                          title={version.summary || ""}
                        >
                          {version.summary || "-"}
                        </td>
                        <td className="text-end">
                          <div className="d-flex justify-content-end gap-2">
                            <button type="button" className="btn btn-outline-secondary btn-sm" disabled>
                              View
                            </button>
                            <button type="button" className="btn btn-outline-secondary btn-sm" disabled>
                              Restore
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card-enterprise p-3 h-100">
            <div className="fw-semibold mb-2">Usage</div>
            <div className="text-muted small">Usage insights will appear here in a future update.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
