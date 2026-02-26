import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import Modal from "../../../components/Modal";
import {
  adminDeleteGlossary,
  adminExportGlossary,
  adminListGlossaries,
  adminListUsers,
  adminUpdateGlossary,
  listUsersForAssignment,
  type AdminUser,
  type GlossaryListItem
} from "../../../api";
import { formatActorLabel } from "../../../utils/actors";
import { triggerFileDownload } from "../../../utils/download";
import { formatDateTime } from "../../../utils/format";
import { buildUserLabelMap } from "../../../utils/userLabels";
import { parseDateEnd, parseDateStart } from "../../projects/shared/dates";
import { normalizeQuery } from "../../projects/shared/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

type TermFilters = {
  status: "" | "enabled" | "disabled";
  uploadedBy: string;
  updatedBy: string;
  updatedStart: string;
  updatedEnd: string;
};

const DEFAULT_FILTERS: TermFilters = {
  status: "",
  uploadedBy: "",
  updatedBy: "",
  updatedStart: "",
  updatedEnd: ""
};

function isDefaultFilters(filters: TermFilters) {
  return (
    filters.status === DEFAULT_FILTERS.status &&
    filters.uploadedBy === DEFAULT_FILTERS.uploadedBy &&
    filters.updatedBy === DEFAULT_FILTERS.updatedBy &&
    filters.updatedStart === DEFAULT_FILTERS.updatedStart &&
    filters.updatedEnd === DEFAULT_FILTERS.updatedEnd
  );
}

function TermEditModal(props: {
  glossary: GlossaryListItem;
  userLabelMap: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(() => String(props.glossary.label || ""));
  const [disabled, setDisabled] = useState(() => Boolean(props.glossary.disabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminUpdateGlossary(props.glossary.id, { label: trimmed, disabled });
      props.onSaved();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to update termbase.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadBackup() {
    setError(null);
    try {
      const blob = await adminExportGlossary(props.glossary.id);
      triggerFileDownload(blob, props.glossary.filename || `${props.glossary.label}.csv`);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to download backup.");
    }
  }

  return (
    <Modal
      title={
        <>
          Edit <span className="text-muted">{props.glossary.label}</span>
        </>
      }
      onClose={props.onClose}
      closeDisabled={saving}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={props.onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="d-flex flex-wrap gap-2 mb-3">
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleDownloadBackup} disabled={saving}>
          Download backup
        </button>
      </div>

      <div className="mb-3">
        <label className="form-label">Name</label>
        <input className="form-control" value={label} onChange={(e) => setLabel(e.target.value)} disabled={saving} />
      </div>
      <div className="mb-3">
        <div className="form-check">
          <input
            className="form-check-input"
            id="termbase-disabled"
            type="checkbox"
            checked={disabled}
            onChange={(e) => setDisabled(e.target.checked)}
            disabled={saving}
          />
          <label className="form-check-label" htmlFor="termbase-disabled">
            Disabled
          </label>
        </div>
      </div>

      <div className="small text-muted">
        <div>
          File: <code>{props.glossary.filename || "-"}</code>
        </div>
        <div>Entries: {props.glossary.entryCount}</div>
        <div>
          Uploaded: {formatDateTime(props.glossary.uploadedAt) || "-"} by{" "}
          {formatActorLabel(props.glossary.uploadedBy, props.userLabelMap)}
        </div>
        <div>
          Last modified: {formatDateTime(props.glossary.updatedAt) || "-"} by{" "}
          {formatActorLabel(props.glossary.updatedBy, props.userLabelMap)}
        </div>
      </div>
    </Modal>
  );
}

export default function TerminologyPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const location = useLocation();
  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:terminology`;
  const detailsCollapsedStorageKey = `${storageKey}:detailsCollapsed`;
  const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(detailsCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });
  const { viewMode, setViewMode } = useCollectionViewMode({
    storageKey: `${storageKey}:view`,
    defaultMode: "list"
  });

  const [items, setItems] = useState<GlossaryListItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const userLabelMap = useMemo(() => buildUserLabelMap(users), [users]);

  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<TermFilters>({ ...DEFAULT_FILTERS });
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const [editId, setEditId] = useState<number | null>(null);
  const editGlossary = useMemo(() => items.find((i) => i.id === editId) ?? null, [items, editId]);

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
        adminListGlossaries(),
        isAdmin ? adminListUsers() : isManager ? listUsersForAssignment() : Promise.resolve([])
      ]);
      setItems(nextItems);
      setUsers(nextUsers);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to load terminology.");
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
    const start = parseDateStart(filters.updatedStart);
    const end = parseDateEnd(filters.updatedEnd);

    return items.filter((g) => {
      const disabled = Boolean(g.disabled);
      if (filters.status === "enabled" && disabled) return false;
      if (filters.status === "disabled" && !disabled) return false;
      if (filters.uploadedBy && String(g.uploadedBy || "") !== filters.uploadedBy) return false;
      if (filters.updatedBy && String(g.updatedBy || "") !== filters.updatedBy) return false;

      const updatedMs = g.updatedAt ? new Date(g.updatedAt).getTime() : NaN;
      if (start != null && Number.isFinite(updatedMs) && updatedMs < start) return false;
      if (end != null && Number.isFinite(updatedMs) && updatedMs > end) return false;

      if (q) {
        const hay = normalizeQuery(
          [
            g.label,
            g.filename,
            formatActorLabel(g.uploadedBy, userLabelMap),
            formatActorLabel(g.updatedBy, userLabelMap)
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

  useEffect(() => {
    const raw = (location.state as any)?.highlightId;
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!items.some((item) => item.id === id)) return;
    setSelectedIds(new Set([id]));
    nav(location.pathname, { replace: true, state: null });
  }, [items, location.pathname, location.state, nav]);

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
    const ok = window.confirm(`Delete ${ids.length} term${ids.length === 1 ? "base" : "bases"}?`);
    if (!ok) return;
    setMutating(true);
    setError(null);
    try {
      await Promise.all(ids.map((id) => adminDeleteGlossary(id)));
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete termbases.");
    } finally {
      setMutating(false);
    }
  }

  const actions = useMemo(() => {
    const selectedCount = selectedIds.size;
    const canEdit = selectedCount === 1;
    const canDelete = selectedCount > 0;
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
        label: "Edit",
        icon: "bi-pencil",
        onClick: () => setEditId(Array.from(selectedIds)[0] || null),
        disabled: loading || mutating || !canEdit
      }
    ];
  }, [loading, mutating, selectedIds]);

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
        <div className="fw-semibold small text-uppercase text-muted mb-2">Updated by</div>
        <select
          className="form-select form-select-sm"
          value={filters.updatedBy}
          onChange={(e) => setFilters((prev) => ({ ...prev, updatedBy: e.target.value }))}
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
        <div className="fw-semibold small text-uppercase text-muted mb-2">Last modified</div>
        <div className="d-flex gap-2">
          <input
            type="date"
            className="form-control form-control-sm"
            value={filters.updatedStart}
            onChange={(e) => setFilters((prev) => ({ ...prev, updatedStart: e.target.value }))}
            aria-label="Last modified start date"
          />
          <input
            type="date"
            className="form-control form-control-sm"
            value={filters.updatedEnd}
            onChange={(e) => setFilters((prev) => ({ ...prev, updatedEnd: e.target.value }))}
            aria-label="Last modified end date"
          />
        </div>
      </div>
    </>
  );

  const selectedCount = selectedIds.size;
  const selectedSingleId = selectedCount === 1 ? Array.from(selectedIds)[0] : null;
  const selectedItem = selectedSingleId != null ? items.find((entry) => entry.id === selectedSingleId) ?? null : null;

  async function handleCopyGlossaryId() {
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
      ariaLabel="Termbase details"
      empty={selectedCount === 0 || (!selectedItem && selectedCount <= 1)}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      onOpenFullDetails={selectedItem ? () => nav(`/resources/termbases/${selectedItem.id}`) : undefined}
      actions={
        selectedItem ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopyGlossaryId}>
            <i className="bi bi-clipboard me-1" aria-hidden="true" />
            Copy ID
          </button>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} termbases selected</div>
          <div className="text-muted small">Select a single item to view metadata.</div>
        </div>
      ) : selectedItem ? (
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex align-items-start justify-content-between gap-2">
              <div className="fw-semibold">{selectedItem.label}</div>
              {Boolean(selectedItem.disabled) ? <span className="badge text-bg-secondary">Disabled</span> : null}
            </div>
            <div className="text-muted small">Termbase #{selectedItem.id}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Filename</dt>
            <dd>{selectedItem.filename || "-"}</dd>
            <dt>Entries</dt>
            <dd>{selectedItem.entryCount}</dd>
            <dt>Uploaded by</dt>
            <dd>{formatActorLabel(selectedItem.uploadedBy, userLabelMap)}</dd>
            <dt>Uploaded at</dt>
            <dd>{formatDateTime(selectedItem.uploadedAt) || "-"}</dd>
            <dt>Updated by</dt>
            <dd>{formatActorLabel(selectedItem.updatedBy, userLabelMap)}</dd>
            <dt>Last modified</dt>
            <dd>{formatDateTime(selectedItem.updatedAt) || "-"}</dd>
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
      searchPlaceholder="Search terminology"
      primaryLabel="New Termbase"
      onPrimary={() => nav("/resources/terminology/create")}
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
        <div className="text-muted p-3">Loading terminology...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No termbases found</div>
          <div className="small">Adjust filters/search or create a new termbase.</div>
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
                <th>Filename</th>
                <th>Entries</th>
                <th>Uploaded</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((g) => {
                const selected = selectedIds.has(g.id);
                return (
                  <tr
                    key={g.id}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => toggleSelected(g.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSelected(g.id);
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
                        onChange={() => toggleSelected(g.id)}
                        aria-label={`Select ${g.label}`}
                      />
                    </td>
                    <td className="fw-semibold">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold"
                        onClick={(event) => {
                          event.stopPropagation();
                          nav(`/resources/termbases/${g.id}`);
                        }}
                      >
                        {g.label}
                      </button>
                      {Boolean(g.disabled) && <span className="badge text-bg-secondary ms-2">Disabled</span>}
                    </td>
                    <td className="text-muted small">
                      <code>{g.filename || "-"}</code>
                    </td>
                    <td className="text-muted small">{g.entryCount}</td>
                    <td className="text-muted small">
                      <div className="text-truncate">{formatActorLabel(g.uploadedBy, userLabelMap)}</div>
                      <div>{formatDateTime(g.uploadedAt) || "-"}</div>
                    </td>
                    <td className="text-muted small">
                      <div className="text-truncate">{formatActorLabel(g.updatedBy, userLabelMap)}</div>
                      <div>{formatDateTime(g.updatedAt) || "-"}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editGlossary && (
        <TermEditModal
          glossary={editGlossary}
          userLabelMap={userLabelMap}
          onClose={() => setEditId(null)}
          onSaved={async () => {
            setEditId(null);
            await load();
            setSelectedIds(new Set([editGlossary.id]));
          }}
        />
      )}
    </ResourcesTabLayout>
  );
}
