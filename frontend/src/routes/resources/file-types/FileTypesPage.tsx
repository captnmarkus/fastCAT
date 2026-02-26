import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { copyFileTypeConfig, deleteFileTypeConfig, listFileTypeConfigs, type FileTypeConfig } from "../../../api";
import { formatDateTime } from "../../../utils/format";
import { normalizeQuery } from "../../projects/shared/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

const FILE_TYPE_OPTIONS = [
  { value: "html", label: "HTML" },
  { value: "xml", label: "XML" },
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "DOC/DOCX" },
  { value: "pptx", label: "PPT/PPTX" },
  { value: "xlsx", label: "XLS/XLSX" }
] as const;

type FileTypeFilters = {
  types: string[];
  disabledOnly: boolean;
};

const DEFAULT_FILTERS: FileTypeFilters = {
  types: [],
  disabledOnly: false
};

function isDefaultFilters(filters: FileTypeFilters) {
  return filters.types.length === 0 && !filters.disabledOnly;
}

function getConfigTypes(config: Record<string, any>) {
  const out: string[] = [];
  const direct = typeof (config as any)?.fileType === "string" ? String((config as any).fileType).trim().toLowerCase() : "";
  if (direct) out.push(direct);
  const legacy = Array.isArray((config as any)?.fileTypes) ? ((config as any).fileTypes as any[]) : [];
  legacy.forEach((t) => {
    const v = String(t || "").trim().toLowerCase();
    if (v) out.push(v);
  });
  return Array.from(new Set(out));
}

function TypesCell({ config }: { config: Record<string, any> }) {
  const types = getConfigTypes(config);
  if (types.length === 0) return <span className="text-muted">-</span>;
  return (
    <div className="d-flex flex-wrap gap-1">
      {types.slice(0, 6).map((t) => (
        <span key={t} className="badge text-bg-light text-dark">
          {String(t).toUpperCase()}
        </span>
      ))}
      {types.length > 6 && <span className="text-muted small">+{types.length - 6}</span>}
    </div>
  );
}

export default function FileTypesPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const location = useLocation();

  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:file-types`;
  const detailsCollapsedStorageKey = `${storageKey}:detailsCollapsed`;
  const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(detailsCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });
  const { viewMode, setViewMode } = useCollectionViewMode({
    storageKey: `${storageKey}:view`,
    defaultMode: "list"
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FileTypeFilters>(DEFAULT_FILTERS);

  const [items, setItems] = useState<FileTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    safeLocalStorageSet(detailsCollapsedStorageKey, detailsCollapsed ? "1" : "0");
  }, [detailsCollapsed, detailsCollapsedStorageKey]);

  async function load() {
    setError(null);
    try {
      const list = await listFileTypeConfigs();
      setItems(list);
    } catch (err: any) {
      setItems([]);
      setError(err?.userMessage || err?.message || "Failed to load file type configurations.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  useEffect(() => {
    const raw = (location.state as any)?.highlightId;
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!items.some((item) => item.id === id)) return;
    setSelectedIds(new Set([id]));
    nav(location.pathname, { replace: true, state: null });
  }, [items, location.pathname, location.state, nav]);

  const filteredItems = useMemo(() => {
    const q = normalizeQuery(searchQuery);
    const types = new Set(filters.types.map((t) => String(t).trim().toLowerCase()).filter(Boolean));
    return items.filter((item) => {
      if (filters.disabledOnly && !item.disabled) return false;
      if (q) {
        const hay = normalizeQuery(`${item.name}\n${item.description}`);
        if (!hay.includes(q)) return false;
      }
      if (types.size > 0) {
        const cfgTypes = getConfigTypes(item.config);
        if (!cfgTypes.some((t) => types.has(t))) return false;
      }
      return true;
    });
  }, [filters.disabledOnly, filters.types, items, searchQuery]);

  const selectedCount = selectedIds.size;
  const selectedSingleId = selectedCount === 1 ? Array.from(selectedIds)[0] : null;
  const selectedItem = selectedSingleId != null ? items.find((i) => i.id === selectedSingleId) ?? null : null;

  const canDelete = selectedCount > 0;
  const canEdit = selectedCount === 1;
  const canCopy = selectedCount === 1;

  const visibleIds = filteredItems.map((i) => i.id);
  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    const someSelected = visibleIds.some((id) => selectedIds.has(id));
    el.checked = allSelected;
    el.indeterminate = someSelected && !allSelected;
  }, [selectedIds, visibleIds]);

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

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    if (!canDelete) return;
    const ok = window.confirm(`Delete ${selectedCount} file type configuration${selectedCount === 1 ? "" : "s"}?`);
    if (!ok) return;
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await deleteFileTypeConfig(id);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete file type configuration.");
    }
  }

  async function handleCopy() {
    if (!selectedItem) return;
    setError(null);
    try {
      const created = await copyFileTypeConfig(selectedItem.id);
      await load();
      setSelectedIds(new Set([created.id]));
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to copy file type configuration.");
    }
  }

  const actions = useMemo(() => {
    const delLabel = `Delete${canDelete ? ` (${selectedCount})` : " (0)"}`;
    return [
      {
        label: refreshing ? "Refreshing..." : "Refresh",
        icon: refreshing ? "bi-arrow-repeat" : "bi-arrow-clockwise",
        onClick: handleRefresh,
        disabled: loading || refreshing
      },
      {
        label: delLabel,
        icon: "bi-trash",
        onClick: handleDelete,
        disabled: !canDelete,
        tone: "danger" as const
      },
      {
        label: "Edit",
        icon: "bi-pencil",
        onClick: () => canEdit && selectedSingleId && nav(`/resources/file-types/${selectedSingleId}`),
        disabled: !canEdit
      },
      {
        label: "Copy",
        icon: "bi-files",
        onClick: handleCopy,
        disabled: !canCopy
      }
    ];
  }, [canCopy, canDelete, canEdit, handleCopy, handleDelete, handleRefresh, loading, nav, refreshing, selectedCount, selectedSingleId]);

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  async function handleCopyConfigId() {
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
      ariaLabel="File type configuration details"
      empty={selectedCount === 0 || (!selectedItem && selectedCount <= 1)}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      onOpenFullDetails={selectedItem ? () => nav(`/resources/file-types/${selectedItem.id}`) : undefined}
      actions={
        selectedItem ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopyConfigId}>
            <i className="bi bi-clipboard me-1" aria-hidden="true" />
            Copy ID
          </button>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} configurations selected</div>
          <div className="text-muted small">Select a single item to view metadata.</div>
        </div>
      ) : selectedItem ? (
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex align-items-start justify-content-between gap-2">
              <div className="fw-semibold">{selectedItem.name}</div>
              <span className={`badge ${selectedItem.disabled ? "text-bg-secondary" : "text-bg-success"}`}>
                {selectedItem.disabled ? "Disabled" : "Enabled"}
              </span>
            </div>
            <div className="text-muted small">Config #{selectedItem.id}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Type</dt>
            <dd>{getConfigTypes(selectedItem.config).join(", ").toUpperCase() || "-"}</dd>
            <dt>Description</dt>
            <dd>{selectedItem.description || "-"}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(selectedItem.createdAt) || "-"}</dd>
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
      filters={
        <>
          <div className="mb-3">
            <div className="fw-semibold small text-uppercase text-muted mb-2">File types</div>
            <div className="fc-filter-options">
              {FILE_TYPE_OPTIONS.map((opt) => {
                const checked = filters.types.includes(opt.value);
                return (
                  <div className="form-check" key={opt.value}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`ftflt-${opt.value}`}
                      checked={checked}
                      onChange={() => {
                        const next = new Set(filters.types);
                        if (next.has(opt.value)) next.delete(opt.value);
                        else next.add(opt.value);
                        setFilters((prev) => ({ ...prev, types: Array.from(next) }));
                      }}
                    />
                    <label className="form-check-label small" htmlFor={`ftflt-${opt.value}`}>
                      {opt.label}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mb-3">
            <div className="fw-semibold small text-uppercase text-muted mb-2">Status</div>
            <div className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                id="ftflt-disabled"
                checked={filters.disabledOnly}
                onChange={(e) => setFilters((prev) => ({ ...prev, disabledOnly: e.target.checked }))}
              />
              <label className="form-check-label small" htmlFor="ftflt-disabled">
                Disabled only
              </label>
            </div>
          </div>
        </>
      }
      onReset={resetFilters}
      resetDisabled={isDefaultFilters(filters)}
      actionsLeft={actions}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search file type configurations"
      primaryLabel="New File Type Configuration"
      onPrimary={() => nav("/resources/file-types/create")}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="text-muted p-3">Loading file type configurations...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No file type configurations found</div>
          <div className="small">Adjust filters/search or create a new configuration.</div>
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
                <th>Type</th>
                <th>Description</th>
                <th>Status</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((cfg) => {
                const selected = selectedIds.has(cfg.id);
                return (
                  <tr
                    key={cfg.id}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => toggleSelected(cfg.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSelected(cfg.id);
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
                        onChange={() => toggleSelected(cfg.id)}
                        aria-label={`Select ${cfg.name}`}
                      />
                    </td>
                    <td className="fw-semibold">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSelected(cfg.id);
                        }}
                      >
                        {cfg.name}
                      </button>
                    </td>
                    <td>
                      <TypesCell config={cfg.config} />
                    </td>
                    <td className="text-muted small">{cfg.description || "-"}</td>
                    <td className="text-muted small">{cfg.disabled ? "Disabled" : "Enabled"}</td>
                    <td className="text-muted small">{formatDateTime(cfg.updatedAt) || "-"}</td>
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
