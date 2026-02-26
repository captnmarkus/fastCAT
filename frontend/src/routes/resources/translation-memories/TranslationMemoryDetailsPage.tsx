import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import {
  adminListUsers,
  checkTmLibraryName,
  deleteTmLibraryEntry,
  downloadTmLibraryVersion,
  fetchTmLibraryVersions,
  getTmLibraryEntry,
  listUsersForAssignment,
  replaceTmLibraryTmx,
  updateTmLibraryEntry,
  type AdminUser,
  type TmLibraryEntry,
  type TmLibraryVersion
} from "../../../api";
import { formatActorLabel } from "../../../utils/actors";
import { triggerFileDownload } from "../../../utils/download";
import { formatBytes, formatDateTime } from "../../../utils/format";
import { buildUserLabelMap } from "../../../utils/userLabels";

type NameCheckStatus = "idle" | "checking" | "available" | "duplicate" | "error";

function isValidTmxFile(file: File | null) {
  if (!file) return false;
  return file.name.toLowerCase().endsWith(".tmx");
}

function deriveStatus(entry: TmLibraryEntry) {
  if (entry.disabled) return { label: "Error", tone: "danger" };
  if (!entry.tmProxyId) return { label: "Processing", tone: "warning" };
  return { label: "Ready", tone: "success" };
}

function statusClass(tone: "success" | "warning" | "danger") {
  if (tone === "success") return "text-bg-success";
  if (tone === "warning") return "text-bg-warning text-dark";
  return "text-bg-danger";
}

export default function TranslationMemoryDetailsPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const params = useParams();
  const tmId = Number(params.id);

  const [entry, setEntry] = useState<TmLibraryEntry | null>(null);
  const [versions, setVersions] = useState<TmLibraryVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const userLabelMap = useMemo(() => buildUserLabelMap(users), [users]);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editComment, setEditComment] = useState("");
  const [editTouched, setEditTouched] = useState(false);
  const [editStatus, setEditStatus] = useState<NameCheckStatus>("idle");
  const editCheckSeq = useRef(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceFileKey, setReplaceFileKey] = useState(0);
  const [replaceNote, setReplaceNote] = useState("");
  const [replaceTouched, setReplaceTouched] = useState(false);
  const [replaceSaving, setReplaceSaving] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!Number.isFinite(tmId) || tmId <= 0) {
      setError("Invalid translation memory id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [nextEntry, nextVersions] = await Promise.all([
          getTmLibraryEntry(tmId),
          fetchTmLibraryVersions(tmId)
        ]);
        if (cancelled) return;
        setEntry(nextEntry);
        setVersions(nextVersions);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.userMessage || err?.message || "Failed to load translation memory.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tmId]);

  useEffect(() => {
    let cancelled = false;
    const isAdmin = currentUser.role === "admin";
    const isManager = currentUser.role === "manager";
    (async () => {
      try {
        const nextUsers = isAdmin ? await adminListUsers() : isManager ? await listUsersForAssignment() : [];
        if (!cancelled) setUsers(nextUsers);
      } catch {
        if (!cancelled) setUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser.role]);

  useEffect(() => {
    if (!entry) return;
    setEditName(entry.label || "");
    setEditComment(entry.comment || "");
  }, [entry?.id]);

  useEffect(() => {
    setEditStatus("idle");
  }, [editName]);

  async function refresh() {
    if (!Number.isFinite(tmId) || tmId <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const [nextEntry, nextVersions] = await Promise.all([
        getTmLibraryEntry(tmId),
        fetchTmLibraryVersions(tmId)
      ]);
      setEntry(nextEntry);
      setVersions(nextVersions);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to reload translation memory.");
    } finally {
      setLoading(false);
    }
  }

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
      const exists = await checkTmLibraryName(trimmed, { excludeId: entry.id });
      if (seq !== editCheckSeq.current) return null;
      setEditStatus(exists ? "duplicate" : "available");
      return exists ? "duplicate" : "available";
    } catch {
      if (seq !== editCheckSeq.current) return null;
      setEditStatus("error");
      return "error";
    }
  }

  const editNameError = useMemo(() => {
    if (!editName.trim()) return "Name is required.";
    if (editStatus === "duplicate") return "A translation memory with this name already exists.";
    if (editStatus === "error") return "Could not verify name availability.";
    return null;
  }, [editName, editStatus]);

  const replaceFileError = useMemo(() => {
    if (!replaceFile) return "TMX file is required.";
    if (!isValidTmxFile(replaceFile)) return "Only .tmx files are supported.";
    return null;
  }, [replaceFile]);

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
      await updateTmLibraryEntry(entry.id, {
        label: editName.trim(),
        comment: editComment.trim()
      });
      setEditOpen(false);
      await refresh();
    } catch (err: any) {
      setEditError(err?.userMessage || err?.message || "Failed to update translation memory.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleReplaceFile() {
    if (!entry) return;
    setReplaceTouched(true);
    setReplaceSaving(true);
    setReplaceError(null);
    if (replaceFileError) {
      setReplaceSaving(false);
      return;
    }
    try {
      await replaceTmLibraryTmx(entry.id, {
        file: replaceFile as File,
        comment: replaceNote.trim() || undefined
      });
      setReplaceFile(null);
      setReplaceFileKey((k) => k + 1);
      setReplaceNote("");
      setReplaceOpen(false);
      await refresh();
    } catch (err: any) {
      setReplaceError(err?.userMessage || err?.message || "Failed to replace TMX.");
    } finally {
      setReplaceSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    const confirmed = window.confirm(`Delete translation memory "${entry.label}"?`);
    if (!confirmed) return;
    try {
      await deleteTmLibraryEntry(entry.id);
      nav("/resources/translation-memories");
    } catch (err: any) {
      window.alert(err?.userMessage || err?.message || "Failed to delete translation memory.");
    }
  }

  async function handleDownloadVersion(version: TmLibraryVersion) {
    setHistoryError(null);
    try {
      const blob = await downloadTmLibraryVersion(version.versionId);
      triggerFileDownload(blob, version.filename || `${version.label}.tmx`);
    } catch (err: any) {
      setHistoryError(err?.userMessage || err?.message || "Failed to download TMX version.");
    }
  }

  if (loading) {
    return <div className="text-muted p-3">Loading translation memory...</div>;
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
        <div className="alert alert-warning mb-0">Translation memory not found.</div>
      </div>
    );
  }

  const status = deriveStatus(entry);
  const lastModifiedLabel = formatDateTime(entry.updatedAt ?? entry.uploadedAt ?? entry.createdAt) || "-";
  const createdLabel = formatDateTime(entry.createdAt) || "-";
  const uploadedByLabel = formatActorLabel(entry.uploadedBy, userLabelMap);
  const commentLabel = String(entry.comment || "").trim();
  const originLabel = String(entry.origin || "upload").toLowerCase() === "upload" ? "Upload" : "Import";

  return (
    <div className="d-flex flex-column gap-3">
      <div className="card-enterprise p-3">
        <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav("/resources/translation-memories")}>
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            Back to Translation Memories
          </button>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEditOpen((v) => !v)}>
              <i className="bi bi-pencil me-1" aria-hidden="true" />
              Edit metadata
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() =>
                setReplaceOpen((v) => {
                  const next = !v;
                  if (next) {
                    setReplaceTouched(false);
                    setReplaceError(null);
                  }
                  return next;
                })
              }
            >
              <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
              Replace TMX file
            </button>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={handleDelete}>
              <i className="bi bi-trash me-1" aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap mt-3">
          <h2 className="mb-0">{entry.label}</h2>
          <span className={`badge ${statusClass(status.tone)}`}>{status.label}</span>
          {entry.disabled ? <span className="badge text-bg-secondary">Disabled</span> : null}
        </div>
        <div className="text-muted small mt-1">
          Last modified {lastModifiedLabel}
        </div>
      </div>

      {editOpen ? (
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
              <label className="form-label">Comment / Description</label>
              <textarea
                className="form-control"
                rows={2}
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                disabled={editSaving}
              />
            </div>
          </div>
          <div className="mt-3 d-flex justify-content-end gap-2">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveMetadata} disabled={editSaving}>
              {editSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}

      {replaceOpen ? (
        <div className="card-enterprise p-3">
          <div className="fw-semibold mb-2">Replace TMX file</div>
          {replaceError ? <div className="alert alert-danger py-2">{replaceError}</div> : null}
          <div className="row g-3">
            <div className="col-lg-7">
              <label className="form-label">TMX file</label>
              {replaceFile ? (
                <div className="border rounded p-3 bg-white d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div>
                    <div className="fw-semibold">{replaceFile.name}</div>
                    <div className="text-muted small">{formatBytes(replaceFile.size)}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => {
                      setReplaceFile(null);
                      setReplaceFileKey((k) => k + 1);
                    }}
                    disabled={replaceSaving}
                  >
                    Replace file
                  </button>
                </div>
              ) : (
                <>
                  <input
                    key={replaceFileKey}
                    type="file"
                    className={`form-control ${replaceTouched && replaceFileError ? "is-invalid" : ""}`}
                    accept=".tmx,application/xml,text/xml"
                    onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
                    disabled={replaceSaving}
                  />
                  {replaceTouched && replaceFileError ? <div className="invalid-feedback">{replaceFileError}</div> : null}
                </>
              )}
            </div>
            <div className="col-lg-5">
              <label className="form-label">Version note (optional)</label>
              <input
                className="form-control"
                value={replaceNote}
                onChange={(e) => setReplaceNote(e.target.value)}
                disabled={replaceSaving}
                placeholder="e.g. replaced file"
              />
            </div>
          </div>
          <div className="mt-3 d-flex justify-content-end gap-2">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setReplaceOpen(false)} disabled={replaceSaving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleReplaceFile} disabled={replaceSaving}>
              {replaceSaving ? "Replacing..." : "Replace file"}
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
              <dd>{entry.label}</dd>
              <dt>Comment</dt>
              <dd>{commentLabel || "-"}</dd>
              <dt>Origin</dt>
              <dd>{originLabel}</dd>
              <dt>Created by</dt>
              <dd>{uploadedByLabel}</dd>
              <dt>Created at</dt>
              <dd>{createdLabel}</dd>
              <dt>Last modified</dt>
              <dd>{lastModifiedLabel}</dd>
              <dt>Size / filename</dt>
              <dd>
                <code>{entry.filename}</code> ({formatBytes(entry.sizeBytes)})
              </dd>
            </dl>
          </div>

          <div className="card-enterprise p-3 mt-3">
            <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
              <div className="fw-semibold">History</div>
              <div className="text-muted small">{versions.length} versions</div>
            </div>
            {historyError ? <div className="alert alert-danger py-2">{historyError}</div> : null}
            {versions.length === 0 ? (
              <div className="text-muted small">No versions found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr className="text-muted small">
                      <th>Version</th>
                      <th>Date</th>
                      <th>User</th>
                      <th>Filename</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((version, idx) => {
                      const versionLabel = version.versionNumber ? `v${version.versionNumber}` : `#${version.versionId}`;
                      return (
                        <tr key={version.versionId}>
                          <td>
                            <span className="fw-semibold">{versionLabel}</span>
                            {idx === 0 ? <span className="badge text-bg-light text-dark ms-2">Current</span> : null}
                          </td>
                          <td>{formatDateTime(version.createdAt) || "-"}</td>
                          <td>{formatActorLabel(version.createdBy, userLabelMap)}</td>
                          <td>
                            <div>
                              <code>{version.filename}</code>
                            </div>
                            <div className="text-muted small">{formatBytes(version.sizeBytes)}</div>
                            {version.comment ? <div className="text-muted small">Note: {version.comment}</div> : null}
                          </td>
                          <td className="text-end">
                            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => handleDownloadVersion(version)}>
                              Download
                            </button>
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

        <div className="col-lg-5">
          <div className="card-enterprise p-3 h-100">
            <div className="fw-semibold mb-2">Usage / Linked tasks</div>
            <div className="text-muted small">
              Linked tasks and usage insights will appear here in a future update.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
