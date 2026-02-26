import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import {
  copyLanguageProcessingRuleset,
  deleteLanguageProcessingRuleset,
  listLanguageProcessingRulesets,
  type LanguageProcessingRuleset
} from "../../../api";
import { normalizeQuery } from "../../projects/shared/format";
import { formatDateTime } from "../../../utils/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

type RuleFilters = {
  disabledOnly: boolean;
};

const DEFAULT_FILTERS: RuleFilters = { disabledOnly: false };

function isDefaultFilters(filters: RuleFilters) {
  return !filters.disabledOnly;
}

export default function RulesListPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:rules`;
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
  const [filters, setFilters] = useState<RuleFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<LanguageProcessingRuleset[]>([]);
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
      const list = await listLanguageProcessingRulesets();
      setItems(list);
    } catch (err: any) {
      setItems([]);
      setError(err?.userMessage || err?.message || "Failed to load rulesets.");
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
    return items.filter((item) => {
      if (filters.disabledOnly && !item.disabled) return false;
      if (!q) return true;
      const hay = normalizeQuery(`${item.name}\n${item.description}`);
      return hay.includes(q);
    });
  }, [filters.disabledOnly, items, searchQuery]);

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
    const ok = window.confirm(`Delete ${selectedCount} ruleset${selectedCount === 1 ? "" : "s"}?`);
    if (!ok) return;
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await deleteLanguageProcessingRuleset(id);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete rulesets.");
    }
  }

  async function handleCopy() {
    if (!selectedItem) return;
    setError(null);
    try {
      const created = await copyLanguageProcessingRuleset(selectedItem.id);
      await load();
      setSelectedIds(new Set([created.id]));
      nav(`/resources/rules/${created.id}`);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to copy ruleset.");
    }
  }

  function openCreate() {
    nav("/resources/rules/new");
  }

  function openEdit() {
    if (!selectedItem) return;
    nav(`/resources/rules/${selectedItem.id}`);
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
        label: "View",
        icon: "bi-eye",
        onClick: openEdit,
        disabled: !canEdit
      },
      {
        label: "Copy",
        icon: "bi-files",
        onClick: handleCopy,
        disabled: !canCopy
      }
    ];
  }, [canCopy, canDelete, canEdit, handleCopy, handleDelete, handleRefresh, loading, refreshing, selectedCount]);

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  async function handleCopyRulesetId() {
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
      ariaLabel="Ruleset details"
      empty={selectedCount === 0 || (!selectedItem && selectedCount <= 1)}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      onOpenFullDetails={selectedItem ? () => nav(`/resources/rules/${selectedItem.id}`) : undefined}
      actions={
        selectedItem ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopyRulesetId}>
            <i className="bi bi-clipboard me-1" aria-hidden="true" />
            Copy ID
          </button>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} rulesets selected</div>
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
            <div className="text-muted small">Ruleset #{selectedItem.id}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Description</dt>
            <dd>{selectedItem.description || "-"}</dd>
            <dt>Rules</dt>
            <dd>{Array.isArray(selectedItem.rules) ? selectedItem.rules.length : 0}</dd>
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
        <div className="mb-3">
          <div className="fw-semibold small text-uppercase text-muted mb-2">Status</div>
          <div className="form-check">
            <input
              className="form-check-input"
              type="checkbox"
              id="lrflt-disabled"
              checked={filters.disabledOnly}
              onChange={(e) => setFilters({ disabledOnly: e.target.checked })}
            />
            <label className="form-check-label small" htmlFor="lrflt-disabled">
              Disabled only
            </label>
          </div>
        </div>
      }
      onReset={resetFilters}
      resetDisabled={isDefaultFilters(filters)}
      actionsLeft={actions}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search rulesets"
      primaryLabel="New Ruleset"
      onPrimary={openCreate}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="text-muted p-3">Loading rulesets...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No rulesets found</div>
          <div className="small">Adjust filters/search or create a new ruleset.</div>
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
                <th>Description</th>
                <th>Status</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((ruleset) => {
                const selected = selectedIds.has(ruleset.id);
                const count = Array.isArray(ruleset.rules) ? ruleset.rules.length : 0;
                return (
                  <tr
                    key={ruleset.id}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => toggleSelected(ruleset.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSelected(ruleset.id);
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
                        onChange={() => toggleSelected(ruleset.id)}
                        aria-label={`Select ${ruleset.name}`}
                      />
                    </td>
                    <td className="fw-semibold">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold"
                        onClick={(event) => {
                          event.stopPropagation();
                          nav(`/resources/rules/${ruleset.id}`);
                        }}
                      >
                        {ruleset.name}
                      </button>
                      <span className="text-muted small ms-2">{count} rule(s)</span>
                    </td>
                    <td className="text-muted small">{ruleset.description || "-"}</td>
                    <td className="text-muted small">{ruleset.disabled ? "Disabled" : "Enabled"}</td>
                    <td className="text-muted small">{formatDateTime(ruleset.updatedAt) || "-"}</td>
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
