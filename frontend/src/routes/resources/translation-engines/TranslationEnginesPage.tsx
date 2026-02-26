import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { deleteTranslationEngine, listTranslationEngines, type TranslationEngine } from "../../../api";
import { normalizeQuery } from "../../projects/shared/format";
import { formatDateTime } from "../../../utils/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

type EngineFilters = {
  disabledOnly: boolean;
};

const DEFAULT_FILTERS: EngineFilters = {
  disabledOnly: false
};

function isDefaultFilters(filters: EngineFilters) {
  return !filters.disabledOnly;
}

export default function TranslationEnginesPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();

  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:translation-engines`;
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
  const [filters, setFilters] = useState<EngineFilters>(DEFAULT_FILTERS);

  const [items, setItems] = useState<TranslationEngine[]>([]);
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
      const list = await listTranslationEngines();
      setItems(list);
    } catch (err: any) {
      setItems([]);
      setError(err?.userMessage || err?.message || "Failed to load translation engines.");
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

  const filteredItems = useMemo(() => {
    const q = normalizeQuery(searchQuery);
    return items.filter((engine) => {
      if (filters.disabledOnly && !engine.disabled) return false;
      if (q) {
        const hay = normalizeQuery(`${engine.name}\n${engine.description}\n${engine.llmProviderName}\n${engine.llmProviderModel}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filters.disabledOnly, items, searchQuery]);

  const selectedCount = selectedIds.size;
  const canDelete = selectedCount > 0;

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
    const ok = window.confirm(`Delete ${selectedCount} translation engine${selectedCount === 1 ? "" : "s"}?`);
    if (!ok) return;
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await deleteTranslationEngine(id);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete translation engine.");
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
      }
    ];
  }, [canDelete, handleDelete, loading, refreshing, selectedCount]);

  const filtersPanel = (
    <div className="d-flex flex-column gap-3">
      <div className="form-check">
        <input
          id="te-disabledOnly"
          type="checkbox"
          className="form-check-input"
          checked={filters.disabledOnly}
          onChange={(e) => setFilters((prev) => ({ ...prev, disabledOnly: e.target.checked }))}
        />
        <label className="form-check-label small" htmlFor="te-disabledOnly">
          Disabled only
        </label>
      </div>
    </div>
  );

  const selectedSingleId = selectedCount === 1 ? Array.from(selectedIds)[0] : null;
  const selectedItem = selectedSingleId != null ? items.find((entry) => entry.id === selectedSingleId) ?? null : null;

  async function handleCopyEngineId() {
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
      ariaLabel="Translation engine details"
      empty={selectedCount === 0 || (!selectedItem && selectedCount <= 1)}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      actions={
        selectedItem ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopyEngineId}>
            <i className="bi bi-clipboard me-1" aria-hidden="true" />
            Copy ID
          </button>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} engines selected</div>
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
            <div className="text-muted small">Engine #{selectedItem.id}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Provider</dt>
            <dd>{selectedItem.llmProviderName || "-"}</dd>
            <dt>Model</dt>
            <dd>{selectedItem.llmProviderModel || "-"}</dd>
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
      filters={filtersPanel}
      resetDisabled={loading || refreshing || isDefaultFilters(filters)}
      onReset={() => setFilters(DEFAULT_FILTERS)}
      actionsLeft={actions}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search translation engines"
      primaryLabel="New Translation Engine"
      onPrimary={() => nav("/resources/translation-engines/create")}
      primaryDisabled={loading || refreshing}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && <div className="alert alert-danger mx-2">{error}</div>}
      {loading ? (
        <div className="text-muted p-3">Loading translation engines...</div>
      ) : filteredItems.length === 0 ? (
        <div className="p-3">
          <div className="mb-2 fw-semibold">No translation engines found</div>
          <div className="small text-muted">Adjust filters/search or create a new engine.</div>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="form-check-input"
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all visible"
                  />
                </th>
                <th>Name</th>
                <th>LLM Provider</th>
                <th>Model</th>
                <th>Status</th>
                <th className="text-nowrap">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((engine) => {
                const selected = selectedIds.has(engine.id);
                return (
                  <tr
                    key={engine.id}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => toggleSelected(engine.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSelected(engine.id);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selected}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={selected}
                        onChange={() => toggleSelected(engine.id)}
                        aria-label={`Select ${engine.name}`}
                      />
                    </td>
                    <td className="fw-semibold">{engine.name}</td>
                    <td className="text-muted small">{engine.llmProviderName || "-"}</td>
                    <td className="text-muted small">{engine.llmProviderModel || "-"}</td>
                    <td className="text-muted small">{engine.disabled ? "Disabled" : "Enabled"}</td>
                    <td className="text-muted small">{formatDateTime(engine.updatedAt) || "-"}</td>
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
