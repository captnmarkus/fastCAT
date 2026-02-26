import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { deleteNmtProvider, listNmtProviders, type NmtProvider } from "../../../api";
import { normalizeQuery } from "../../projects/shared/format";
import { formatDateTime } from "../../../utils/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

const VENDOR_OPTIONS = [
  { value: "openai-compatible", label: "OpenAI-compatible" }
] as const;

type ProviderFilters = {
  vendor: string;
  enabledOnly: boolean;
};

const DEFAULT_FILTERS: ProviderFilters = {
  vendor: "",
  enabledOnly: false
};

function isDefaultFilters(filters: ProviderFilters) {
  return filters.vendor === "" && !filters.enabledOnly;
}

export default function NmtProvidersPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:nmt-providers`;
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
  const [filters, setFilters] = useState<ProviderFilters>(DEFAULT_FILTERS);

  const [items, setItems] = useState<NmtProvider[]>([]);
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
      const list = await listNmtProviders();
      setItems(list);
    } catch (err: any) {
      setItems([]);
      setError(err?.userMessage || err?.message || "Failed to load LLM providers.");
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
    const vendor = String(filters.vendor || "").trim().toLowerCase();
    return items.filter((item) => {
      if (filters.enabledOnly && !item.enabled) return false;
      if (vendor && String(item.vendor || "").toLowerCase() !== vendor) return false;
      if (q) {
        const hay = normalizeQuery(`${item.title}\n${item.vendor}\n${item.model}\n${item.description}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filters.enabledOnly, filters.vendor, items, searchQuery]);

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
    const ok = window.confirm(`Delete ${selectedCount} provider${selectedCount === 1 ? "" : "s"}?`);
    if (!ok) return;
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await deleteNmtProvider(id);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete provider.");
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
      <div>
        <div className="fw-semibold small text-uppercase text-muted mb-2">Vendor</div>
        <select
          className="form-select"
          value={filters.vendor}
          onChange={(e) => setFilters((prev) => ({ ...prev, vendor: e.target.value }))}
        >
          <option value="">All</option>
          {VENDOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-check">
        <input
          id="nmtprov-enabled"
          type="checkbox"
          className="form-check-input"
          checked={filters.enabledOnly}
          onChange={(e) => setFilters((prev) => ({ ...prev, enabledOnly: e.target.checked }))}
        />
        <label className="form-check-label small" htmlFor="nmtprov-enabled">
          Enabled only
        </label>
      </div>
    </div>
  );

  const selectedSingleId = selectedCount === 1 ? Array.from(selectedIds)[0] : null;
  const selectedItem = selectedSingleId != null ? items.find((entry) => entry.id === selectedSingleId) ?? null : null;

  async function handleCopyProviderId() {
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
      ariaLabel="Provider details"
      empty={selectedCount === 0 || (!selectedItem && selectedCount <= 1)}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      actions={
        selectedItem ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopyProviderId}>
            <i className="bi bi-clipboard me-1" aria-hidden="true" />
            Copy ID
          </button>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} providers selected</div>
          <div className="text-muted small">Select a single item to view metadata.</div>
        </div>
      ) : selectedItem ? (
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex align-items-start justify-content-between gap-2">
              <div className="fw-semibold">{selectedItem.title}</div>
              <span className={`badge ${selectedItem.enabled ? "text-bg-success" : "text-bg-secondary"}`}>
                {selectedItem.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="text-muted small">Provider #{selectedItem.id}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Vendor</dt>
            <dd>{String(selectedItem.vendor || "").toUpperCase() || "-"}</dd>
            <dt>Model</dt>
            <dd>{selectedItem.model || "-"}</dd>
            <dt>Base URL</dt>
            <dd>{selectedItem.baseUrlMasked || "-"}</dd>
            <dt>Description</dt>
            <dd>{selectedItem.description || "-"}</dd>
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
      searchPlaceholder="Search providers"
      primaryLabel="New Provider"
      onPrimary={() => nav("/resources/nmt-providers/create")}
      primaryDisabled={loading || refreshing}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && <div className="alert alert-danger mx-2">{error}</div>}
      {loading ? (
        <div className="text-muted p-3">Loading providers...</div>
      ) : filteredItems.length === 0 ? (
        <div className="p-3">
          <div className="mb-2 fw-semibold">No providers found</div>
          <div className="small text-muted">Adjust filters/search or create a new provider.</div>
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
                <th>Title</th>
                <th>Vendor</th>
                <th>Model</th>
                <th>Base URL</th>
                <th>Status</th>
                <th className="text-nowrap">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((prov) => {
                const selected = selectedIds.has(prov.id);
                return (
                  <tr
                    key={prov.id}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => toggleSelected(prov.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSelected(prov.id);
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
                        onChange={() => toggleSelected(prov.id)}
                        aria-label={`Select ${prov.title}`}
                      />
                    </td>
                    <td className="fw-semibold">{prov.title}</td>
                    <td className="text-muted small">{String(prov.vendor || "").toUpperCase()}</td>
                    <td className="text-muted small">{prov.model || "-"}</td>
                    <td className="text-muted small">{prov.baseUrlMasked || "-"}</td>
                    <td className="text-muted small">{prov.enabled ? "Enabled" : "Disabled"}</td>
                    <td className="text-muted small">{formatDateTime(prov.updatedAt) || "-"}</td>
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
