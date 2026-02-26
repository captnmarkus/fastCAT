import React, { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../../../types/app";
import {
  adminListUsers,
  deleteTmLibraryEntry,
  downloadTmLibraryEntry,
  downloadTmLibraryVersion,
  fetchTmLibrary,
  fetchTmLibraryVersions,
  listUsersForAssignment,
  updateTmLibraryEntry,
  uploadTmLibraryTmx,
  type AdminUser,
  type TmLibraryEntry,
  type TmLibraryVersion
} from "../../../api";
import { formatActorLabel } from "../../../utils/actors";
import Modal from "../../../components/Modal";
import { triggerFileDownload } from "../../../utils/download";
import { formatBytes, formatDateTime } from "../../../utils/format";
import { buildUserLabelMap } from "../../../utils/userLabels";

export default function TmxManagementTab({ currentUser }: { currentUser: AuthUser }) {
  const isAdmin = currentUser.role === "admin";
  const isManager = currentUser.role === "manager";

  const [tmLibrary, setTmLibrary] = useState<TmLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const [tmUploadLabel, setTmUploadLabel] = useState("");
  const [tmUploadComment, setTmUploadComment] = useState("");
  const [tmUploadFile, setTmUploadFile] = useState<File | null>(null);
  const [tmUploading, setTmUploading] = useState(false);

  const [tmHistoryEntry, setTmHistoryEntry] = useState<TmLibraryEntry | null>(null);
  const [tmVersions, setTmVersions] = useState<TmLibraryVersion[]>([]);
  const [tmVersionsLoading, setTmVersionsLoading] = useState(false);
  const [tmVersionsError, setTmVersionsError] = useState<string | null>(null);

  const userLabelMap = useMemo(() => buildUserLabelMap(users), [users]);

  async function refreshTmList() {
    setError(null);
    try {
      const list = await fetchTmLibrary();
      setTmLibrary(list);
    } catch (err: any) {
      setError(err?.message || "Failed to load TM library");
    }
  }

  async function refreshUsers() {
    try {
      if (isAdmin) {
        setUsers(await adminListUsers());
      } else if (isManager) {
        setUsers(await listUsersForAssignment());
      } else {
        setUsers([]);
      }
    } catch {
      setUsers([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await Promise.all([refreshUsers(), refreshTmList()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleTmUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!tmUploadLabel.trim()) {
      setError("Name is required.");
      return;
    }
    if (!tmUploadFile) {
      setError("Select a TMX file to upload.");
      return;
    }
    setError(null);
    setTmUploading(true);
    try {
      await uploadTmLibraryTmx({
        file: tmUploadFile,
        label: tmUploadLabel.trim(),
        comment: tmUploadComment.trim() || undefined
      });
      setTmUploadFile(null);
      setTmUploadLabel("");
      setTmUploadComment("");
      await refreshTmList();
    } catch (err: any) {
      setError(err?.message || "Failed to upload TMX");
    } finally {
      setTmUploading(false);
    }
  }

  async function handleTmToggle(entry: TmLibraryEntry) {
    setError(null);
    try {
      await updateTmLibraryEntry(entry.id, {
        disabled: !entry.disabled,
        historyComment: entry.disabled ? "enable" : "disable"
      });
      await refreshTmList();
    } catch (err: any) {
      setError(err?.message || "Failed to update TMX");
    }
  }

  async function handleTmDelete(entry: TmLibraryEntry) {
    const ok = window.confirm(`Delete TMX "${entry.label}"?`);
    if (!ok) return;
    setError(null);
    try {
      await deleteTmLibraryEntry(entry.id);
      await refreshTmList();
    } catch (err: any) {
      setError(err?.message || "Failed to delete TMX");
    }
  }

  async function handleTmDownload(entry: TmLibraryEntry) {
    setError(null);
    try {
      const blob = await downloadTmLibraryEntry(entry.id);
      triggerFileDownload(blob, entry.filename || `${entry.label}.tmx`);
    } catch (err: any) {
      setError(err?.message || "Failed to download TMX");
    }
  }

  async function openTmHistory(entry: TmLibraryEntry) {
    setTmHistoryEntry(entry);
    setTmVersions([]);
    setTmVersionsError(null);
    setTmVersionsLoading(true);
    try {
      const versions = await fetchTmLibraryVersions(entry.id);
      setTmVersions(versions);
    } catch (err: any) {
      setTmVersionsError(err?.message || "Failed to load TMX history");
    } finally {
      setTmVersionsLoading(false);
    }
  }

  function closeTmHistory() {
    setTmHistoryEntry(null);
    setTmVersions([]);
    setTmVersionsError(null);
    setTmVersionsLoading(false);
  }

  async function handleDownloadTmVersion(version: TmLibraryVersion) {
    setTmVersionsError(null);
    try {
      const blob = await downloadTmLibraryVersion(version.versionId);
      triggerFileDownload(blob, version.filename || `tmx-version-${version.versionId}.tmx`);
    } catch (err: any) {
      setTmVersionsError(err?.message || "Failed to download TMX version");
    }
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start gap-3 mb-3">
          <div>
            <div className="fw-bold">TMX management</div>
            <div className="text-muted small">Upload TMX files while FastCAT is running.</div>
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={refreshTmList}>
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form className="row g-2 align-items-end mb-4" onSubmit={handleTmUpload}>
          <div className="col-md-3">
            <label className="form-label small text-muted">Name</label>
            <input
              className="form-control form-control-sm"
              placeholder="Customer TMX"
              value={tmUploadLabel}
              onChange={(e) => setTmUploadLabel(e.target.value)}
            />
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted">Comment (optional)</label>
            <input
              className="form-control form-control-sm"
              placeholder="Reason / notes"
              value={tmUploadComment}
              onChange={(e) => setTmUploadComment(e.target.value)}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted">TMX file</label>
            <input
              type="file"
              accept=".tmx,application/xml,text/xml"
              className="form-control form-control-sm"
              onChange={(e) => setTmUploadFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="col-md-2 d-grid">
            <button className="btn btn-dark btn-sm" type="submit" disabled={tmUploading || !tmUploadFile || !tmUploadLabel.trim()}>
              {tmUploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>

        {loading ? (
          <div className="text-center text-muted py-4">
            <span className="spinner-border" />
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr className="text-muted small">
                  <th>Label</th>
                  <th>Origin</th>
                  <th>Filename</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th>Uploaded by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tmLibrary.map((entry) => (
                  <tr key={entry.id}>
                    <td className="fw-semibold">{entry.label}</td>
                    <td>
                      <span className="badge text-bg-light text-dark text-capitalize">{entry.origin || "upload"}</span>
                      {entry.disabled && <span className="badge text-bg-secondary ms-2">Disabled</span>}
                    </td>
                    <td>
                      <code>{entry.filename}</code>
                    </td>
                    <td>{formatBytes(entry.sizeBytes)}</td>
                    <td>{formatDateTime(entry.uploadedAt ?? entry.createdAt) || "-"}</td>
                    <td>{formatActorLabel(entry.uploadedBy, userLabelMap)}</td>
                    <td className="text-end">
                      <div className="btn-group btn-group-sm">
                        <button type="button" className="btn btn-outline-secondary" onClick={() => handleTmDownload(entry)}>
                          Download
                        </button>
                        <button type="button" className="btn btn-outline-secondary" onClick={() => openTmHistory(entry)}>
                          History
                        </button>
                        {isAdmin && (
                          <button type="button" className="btn btn-outline-secondary" onClick={() => handleTmToggle(entry)}>
                            {entry.disabled ? "Enable" : "Disable"}
                          </button>
                        )}
                        {isAdmin && (
                          <button type="button" className="btn btn-outline-danger" onClick={() => handleTmDelete(entry)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {tmLibrary.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-muted small">
                      No TMX files uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tmHistoryEntry && (
          <Modal
            title={
              <>
                TMX history: <span className="text-muted">{tmHistoryEntry.label}</span>
              </>
            }
            onClose={closeTmHistory}
            footer={
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={closeTmHistory}>
                Close
              </button>
            }
          >
            {tmVersionsError && <div className="alert alert-danger py-2">{tmVersionsError}</div>}
            {tmVersionsLoading ? (
              <div className="text-muted d-flex align-items-center gap-2">
                <span className="spinner-border spinner-border-sm" />
                <span>Loading history...</span>
              </div>
            ) : tmVersions.length === 0 ? (
              <div className="text-muted small">No versions found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr className="text-muted small">
                      <th>Version</th>
                      <th>Created</th>
                      <th>By</th>
                      <th>Comment</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tmVersions.map((version, idx) => (
                      <tr key={version.versionId}>
                        <td>
                          <code>{version.versionId}</code>
                          {idx === 0 && <span className="badge text-bg-light text-dark ms-2">Current</span>}
                        </td>
                        <td>{formatDateTime(version.createdAt) || "-"}</td>
                        <td>{formatActorLabel(version.createdBy, userLabelMap)}</td>
                        <td className="text-muted small">{version.comment || "-"}</td>
                        <td className="text-end">
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => handleDownloadTmVersion(version)}
                          >
                            Download
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Modal>
        )}
      </div>
    </div>
  );
}
