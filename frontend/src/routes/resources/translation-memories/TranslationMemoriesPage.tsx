import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import {
  adminListUsers,
  deleteTmLibraryEntry,
  downloadTmLibraryEntry,
  fetchTmLibrary,
  listUsersForAssignment,
  uploadTmLibraryTmx,
  type AdminUser,
  type TmLibraryEntry
} from "../../../api";
import { formatActorLabel } from "../../../utils/actors";
import { formatBytes, formatDateTime } from "../../../utils/format";
import { buildUserLabelMap } from "../../../utils/userLabels";
import { parseDateEnd, parseDateStart } from "../../projects/shared/dates";
import { normalizeQuery } from "../../projects/shared/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

type TmFilters = {
  status: "" | "enabled" | "disabled";
  origin: string;
  uploadedBy: string;
  uploadedStart: string;
  uploadedEnd: string;
};

const DEFAULT_FILTERS: TmFilters = {
  status: "",
  origin: "",
  uploadedBy: "",
  uploadedStart: "",
  uploadedEnd: ""
};

function isDefaultFilters(filters: TmFilters) {
  return (
    filters.status === DEFAULT_FILTERS.status &&
    filters.origin === DEFAULT_FILTERS.origin &&
    filters.uploadedBy === DEFAULT_FILTERS.uploadedBy &&
    filters.uploadedStart === DEFAULT_FILTERS.uploadedStart &&
    filters.uploadedEnd === DEFAULT_FILTERS.uploadedEnd
  );
}

function getEntryUploadedIso(entry: TmLibraryEntry) {
  return entry.uploadedAt ?? entry.createdAt ?? null;
}

function getEntryLastModifiedIso(entry: TmLibraryEntry) {
  return entry.updatedAt ?? entry.uploadedAt ?? entry.createdAt ?? null;
}

export default function TranslationMemoriesPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:translation-memories`;
  const detailsCollapsedStorageKey = `${storageKey}:detailsCollapsed`;
  const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(detailsCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });
  const { viewMode, setViewMode } = useCollectionViewMode({
    storageKey: `${storageKey}:view`,
    defaultMode: "list"
  });

  const [items, setItems] = useState<TmLibraryEntry[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const userLabelMap = useMemo(() => buildUserLabelMap(users), [users]);

  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<TmFilters>({ ...DEFAULT_FILTERS });
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    safeLocalStorageSet(detailsCollapsedStorageKey, detailsCollapsed ? "1" : "0");
  }, [detailsCollapsed, detailsCollapsedStorageKey]);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const isAdmin = currentUser.role === "admin";
      const isManager = currentUser.role === "manager";
      const [nextItems, nextUsers] = await Promise.all([
        fetchTmLibrary(),
        isAdmin ? adminListUsers() : isManager ? listUsersForAssignment() : Promise.resolve([])
      ]);
      setItems(nextItems);
      setUsers(nextUsers);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to load translation memories.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const q = normalizeQuery(searchQuery);
    const start = parseDateStart(filters.uploadedStart);
    const end = parseDateEnd(filters.uploadedEnd);

    return items.filter((entry) => {
      const disabled = Boolean(entry.disabled);
      if (filters.status === "enabled" && disabled) return false;
      if (filters.status === "disabled" && !disabled) return false;
      if (filters.origin && String(entry.origin || "upload") !== filters.origin) return false;
      if (filters.uploadedBy && String(entry.uploadedBy || "") !== filters.uploadedBy) return false;

      const uploadedIso = getEntryUploadedIso(entry);
      const uploadedMs = uploadedIso ? new Date(uploadedIso).getTime() : NaN;
      if (start != null && Number.isFinite(uploadedMs) && uploadedMs < start) return false;
      if (end != null && Number.isFinite(uploadedMs) && uploadedMs > end) return false;

      if (q) {
        const hay = normalizeQuery(
          [
            entry.label,
            entry.filename,
            entry.origin || "upload",
            formatActorLabel(entry.uploadedBy, userLabelMap)
          ].join(" ")
        );
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [filters, items, searchQuery, userLabelMap]);

  const visibleIds = useMemo(() => filteredItems.map((i) => i.id), [filteredItems]);
  const visibleSelectedCount = useMemo(
    () => visibleIds.reduce((sum, id) => sum + (selectedIds.has(id) ? 1 : 0), 0),
    [selectedIds, visibleIds]
  );

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    if (visibleIds.length === 0) {
      el.indeterminate = false;
      el.checked = false;
      return;
    }
    el.checked = visibleSelectedCount === visibleIds.length;
    el.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;
  }, [visibleIds, visibleSelectedCount]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setDetailsCollapsed(false);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else {
        visibleIds.forEach((id) => next.add(id));
        if (visibleIds.length > 0) setDetailsCollapsed(false);
      }
      return next;
    });
  }

  function resetFilters() {
    setFilters({ ...DEFAULT_FILTERS });
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = window.confirm(`Delete ${ids.length} translation ${ids.length === 1 ? "memory" : "memories"}?`);
    if (!ok) return;
    setMutating(true);
    setError(null);
    try {
      await Promise.all(ids.map((id) => deleteTmLibraryEntry(id)));
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete translation memories.");
    } finally {
      setMutating(false);
    }
  }

  async function handleCopySelected() {
    const ids = Array.from(selectedIds);
    if (ids.length !== 1) return;
    const src = items.find((i) => i.id === ids[0]);
    if (!src) return;

    setMutating(true);
    setError(null);
    try {
      const blob = await downloadTmLibraryEntry(src.id);
      const file = new File([blob], src.filename || `${src.label}.tmx`, { type: "application/xml" });
      const res = await uploadTmLibraryTmx({
        file,
        label: `Copy of ${src.label}`.slice(0, 200),
        comment: `Copied from ${src.label}`.slice(0, 500)
      });
      await load();
      if (res.entry?.id) setSelectedIds(new Set([res.entry.id]));
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to copy translation memory.");
    } finally {
      setMutating(false);
    }
  }

  const actions = useMemo(() => {
    const selectedCount = selectedIds.size;
    const canOpen = selectedCount === 1;
    const canDelete = selectedCount > 0;
    const selectedId = Array.from(selectedIds)[0];
    return [
      { label: "Refresh", icon: "bi-arrow-clockwise", onClick: load, disabled: loading || mutating },
      {
        label: `Delete (${selectedCount})`,
        icon: "bi-trash",
        onClick: handleDeleteSelected,
        disabled: loading || mutating || !canDelete,
        tone: "danger" as const
      },
      {
        label: "Open",
        icon: "bi-box-arrow-up-right",
        onClick: () => selectedId && nav(`/resources/translation-memories/${selectedId}`),
        disabled: loading || mutating || !canOpen
      },
      {
        label: "Copy",
        icon: "bi-files",
        onClick: handleCopySelected,
        disabled: loading || mutating || !canOpen
      }
    ];
  }, [handleCopySelected, loading, mutating, nav, selectedIds]);

  const originOptions = useMemo(() => {
    const seen = new Set<string>();
    items.forEach((i) => seen.add(String(i.origin || "upload")));
    return Array.from(seen).sort();
  }, [items]);

  const filtersUi = (
    <>
      <div className="mb-3">
        <div className="fw-semibold small text-uppercase text-muted mb-2">Status</div>
        <select
          className="form-select form-select-sm"
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as any }))}
        >
          <option value="">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      <div className="mb-3">
        <div className="fw-semibold small text-uppercase text-muted mb-2">Origin</div>
        <select
          className="form-select form-select-sm"
          value={filters.origin}
          onChange={(e) => setFilters((prev) => ({ ...prev, origin: e.target.value }))}
        >
          <option value="">All</option>
          {originOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <div className="fw-semibold small text-uppercase text-muted mb-2">Uploaded by</div>
        <select
          className="form-select form-select-sm"
          value={filters.uploadedBy}
          onChange={(e) => setFilters((prev) => ({ ...prev, uploadedBy: e.target.value }))}
        >
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName || u.email || u.id}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <div className="fw-semibold small text-uppercase text-muted mb-2">Uploaded date</div>
        <div className="d-flex gap-2">
          <input
            type="date"
            className="form-control form-control-sm"
            value={filters.uploadedStart}
            onChange={(e) => setFilters((prev) => ({ ...prev, uploadedStart: e.target.value }))}
            aria-label="Uploaded start date"
          />
          <input
            type="date"
            className="form-control form-control-sm"
            value={filters.uploadedEnd}
            onChange={(e) => setFilters((prev) => ({ ...prev, uploadedEnd: e.target.value }))}
            aria-label="Uploaded end date"
          />
        </div>
      </div>
    </>
  );

  const selectedCount = selectedIds.size;
  const selectedSingleId = selectedCount === 1 ? Array.from(selectedIds)[0] : null;
  const selectedItem = selectedSingleId != null ? items.find((entry) => entry.id === selectedSingleId) ?? null : null;

  async function handleCopySelectedId() {
    if (!selectedItem || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(selectedItem.id));
    } catch {
      // no-op
    }
  }

  const detailsPanel = (
    <DetailsPanel
      collapsed={detailsCollapsed}
      onCollapsedChange={setDetailsCollapsed}
      title="Details"
      ariaLabel="Translation memory details"
      empty={selectedCount === 0 || (!selectedItem && selectedCount <= 1)}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      onOpenFullDetails={selectedItem ? () => nav(`/resources/translation-memories/${selectedItem.id}`) : undefined}
      actions={
        selectedItem ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopySelectedId}>
            <i className="bi bi-clipboard me-1" aria-hidden="true" />
            Copy ID
          </button>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} memories selected</div>
          <div className="text-muted small">Select a single item to view metadata.</div>
        </div>
      ) : selectedItem ? (
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex align-items-start justify-content-between gap-2">
              <div className="fw-semibold">{selectedItem.label}</div>
              {Boolean(selectedItem.disabled) ? <span className="badge text-bg-secondary">Disabled</span> : null}
            </div>
            <div className="text-muted small">TM #{selectedItem.id}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Origin</dt>
            <dd>{selectedItem.origin || "upload"}</dd>
            <dt>Filename</dt>
            <dd>{selectedItem.filename || "-"}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(selectedItem.sizeBytes)}</dd>
            <dt>Uploaded by</dt>
            <dd>{formatActorLabel(selectedItem.uploadedBy, userLabelMap)}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(selectedItem.createdAt) || "-"}</dd>
            <dt>Last modified</dt>
            <dd>{formatDateTime(getEntryLastModifiedIso(selectedItem)) || "-"}</dd>
          </dl>
        </div>
      ) : null}
    </DetailsPanel>
  );

  return (
    <ResourcesTabLayout
      storageKey={storageKey}
      filters={filtersUi}
      onReset={resetFilters}
      resetDisabled={isDefaultFilters(filters)}
      actionsLeft={actions}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search translation memories"
      primaryLabel="New Translation Memory"
      onPrimary={() => nav("/resources/translation-memories/new")}
      primaryDisabled={loading || mutating}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && (
        <div className="alert alert-danger d-flex align-items-center justify-content-between">
          <div>{error}</div>
          <button type="button" className="btn btn-outline-light btn-sm" onClick={load} disabled={loading}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-muted p-3">Loading translation memories...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No translation memories found</div>
          <div className="small">Adjust filters/search or upload a new TMX file.</div>
        </div>
      ) : (
        <div className="table-responsive card-enterprise">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr className="text-muted small">
                <th style={{ width: 44 }}>
                  <input
                    ref={selectAllRef}
                    className="form-check-input"
                    type="checkbox"
                    aria-label="Select all visible"
                    onChange={toggleSelectAllVisible}
                  />
                </th>
                <th>Name</th>
                <th>Origin</th>
                <th>Filename</th>
                <th>Size</th>
                <th>Created</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((entry) => {
                const selected = selectedIds.has(entry.id);
                const lastModifiedIso = getEntryLastModifiedIso(entry);
                return (
                  <tr
                    key={entry.id}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => toggleSelected(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSelected(entry.id);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selected}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(entry.id)}
                        aria-label={`Select ${entry.label}`}
                      />
                    </td>
                    <td className="fw-semibold">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold"
                        onClick={(event) => {
                          event.stopPropagation();
                          nav(`/resources/translation-memories/${entry.id}`);
                        }}
                      >
                        {entry.label}
                      </button>
                      {Boolean(entry.disabled) && <span className="badge text-bg-secondary ms-2">Disabled</span>}
                    </td>
                    <td className="text-muted small">
                      <span className="badge text-bg-light text-dark text-capitalize">{entry.origin || "upload"}</span>
                    </td>
                    <td className="text-muted small">
                      <code>{entry.filename}</code>
                    </td>
                    <td className="text-muted small">{formatBytes(entry.sizeBytes)}</td>
                    <td className="text-muted small">{formatDateTime(entry.createdAt) || "-"}</td>
                    <td className="text-muted small">{formatDateTime(lastModifiedIso) || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </ResourcesTabLayout>
  );
}
