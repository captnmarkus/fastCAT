import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { LanguagePairLabel } from "../../../components/LanguageLabel";
import {
  copyProjectTemplate,
  deleteProjectTemplate,
  listProjectTemplates,
  type ProjectTemplate
} from "../../../api";
import { parseDateEnd, parseDateStart } from "../../projects/shared/dates";
import { normalizeQuery } from "../../projects/shared/format";
import { formatDateTime } from "../../../utils/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import LanguageSelect from "../../../features/languages/LanguageSelect";
import { useLanguages } from "../../../features/languages/hooks";
import { normalizeLocale } from "../../../lib/i18n/locale";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

type TemplateFilters = {
  srcLang: string;
  targetLangs: string[];
  updatedStart: string;
  updatedEnd: string;
};

const DEFAULT_FILTERS: TemplateFilters = {
  srcLang: "",
  targetLangs: [],
  updatedStart: "",
  updatedEnd: ""
};

function isDefaultFilters(filters: TemplateFilters) {
  return (
    filters.srcLang === DEFAULT_FILTERS.srcLang &&
    filters.targetLangs.length === 0 &&
    filters.updatedStart === DEFAULT_FILTERS.updatedStart &&
    filters.updatedEnd === DEFAULT_FILTERS.updatedEnd
  );
}

function TemplateLanguagesCell({ src, targets }: { src: string; targets: string[] }) {
  const first = targets[0];
  if (!src || !first) return <span className="text-muted">-</span>;
  return (
    <div className="d-inline-flex align-items-center gap-2" style={{ whiteSpace: "nowrap" }}>
      <LanguagePairLabel source={src} target={first} compact />
      {targets.length > 1 && <span className="text-muted small">+{targets.length - 1}</span>}
    </div>
  );
}

export default function ProjectTemplatesPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:project-templates`;
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
  const [filters, setFilters] = useState<TemplateFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    activeSourceLanguages,
    activeTargetLanguages,
    loading: languageLoading,
    error: languageError
  } = useLanguages();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    safeLocalStorageSet(detailsCollapsedStorageKey, detailsCollapsed ? "1" : "0");
  }, [detailsCollapsed, detailsCollapsedStorageKey]);

  async function load() {
    setError(null);
    try {
      const list = await listProjectTemplates();
      setItems(list);
    } catch (err: any) {
      setItems([]);
      setError(err?.userMessage || err?.message || "Failed to load project templates.");
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
    const src = normalizeLocale(filters.srcLang || "").canonical;
    const targets = new Set(
      filters.targetLangs
        .map((v) => normalizeLocale(String(v)).canonical)
        .filter(Boolean)
    );
    const updatedStartMs = parseDateStart(filters.updatedStart);
    const updatedEndMs = parseDateEnd(filters.updatedEnd);

    return items.filter((item) => {
      if (q) {
        const hay = normalizeQuery(`${item.name}\n${item.description}\n${item.scope}`);
        if (!hay.includes(q)) return false;
      }
      if (src) {
        const itemSource = normalizeLocale(String(item.languages?.src || "")).canonical;
        if (itemSource !== src) return false;
      }
      if (targets.size > 0) {
        const itemTargets = (item.languages?.targets || [])
          .map((v) => normalizeLocale(String(v)).canonical)
          .filter(Boolean);
        const hit = itemTargets.some((t) => targets.has(t));
        if (!hit) return false;
      }
      if (updatedStartMs != null || updatedEndMs != null) {
        const updatedMs = new Date(item.updatedAt).getTime();
        if (Number.isFinite(updatedStartMs as any) && updatedStartMs != null && updatedMs < updatedStartMs) return false;
        if (Number.isFinite(updatedEndMs as any) && updatedEndMs != null && updatedMs > updatedEndMs) return false;
      }
      return true;
    });
  }, [filters.srcLang, filters.targetLangs, filters.updatedEnd, filters.updatedStart, items, searchQuery]);

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
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
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
    const ok = window.confirm(`Delete ${selectedCount} project template${selectedCount === 1 ? "" : "s"}?`);
    if (!ok) return;
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await deleteProjectTemplate(id);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to delete project template.");
    }
  }

  async function handleCopy() {
    if (!selectedItem) return;
    setError(null);
    try {
      const created = await copyProjectTemplate(selectedItem.id);
      await load();
      setSelectedIds(new Set([created.id]));
      nav(`/resources/templates/${created.id}`);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to copy project template.");
    }
  }

  function openCreate() {
    nav("/resources/templates/new");
  }

  function openEdit() {
    if (!selectedItem) return;
    nav(`/resources/templates/${selectedItem.id}/edit`);
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

  async function handleCopyTemplateId() {
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
      ariaLabel="Project template details"
      empty={selectedCount === 0 || (!selectedItem && selectedCount <= 1)}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      onOpenFullDetails={selectedItem ? () => nav(`/resources/templates/${selectedItem.id}`) : undefined}
      actions={
        selectedItem ? (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopyTemplateId}>
            <i className="bi bi-clipboard me-1" aria-hidden="true" />
            Copy ID
          </button>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} templates selected</div>
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
            <div className="text-muted small">Template #{selectedItem.id}</div>
          </div>

          <dl className="fc-project-drawer-dl">
            <dt>Source</dt>
            <dd>{selectedItem.languages?.src || "-"}</dd>
            <dt>Targets</dt>
            <dd>{(selectedItem.languages?.targets || []).join(", ") || "-"}</dd>
            <dt>Scope</dt>
            <dd>{selectedItem.scope || "-"}</dd>
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
            <div className="fw-semibold small text-uppercase text-muted mb-2">Languages</div>
            <label className="form-label small text-muted mb-1">Source language</label>
            <LanguageSelect
              kind="source"
              value={filters.srcLang}
              onChange={(value) => setFilters((prev) => ({ ...prev, srcLang: value }))}
              includeEmpty
              emptyLabel="Any"
              className="form-select form-select-sm mb-2"
              disabled={languageLoading}
            />

            <div className="d-flex align-items-center justify-content-between">
              <label className="form-label small text-muted mb-1">Target languages</label>
              {filters.targetLangs.length > 0 && (
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none"
                  onClick={() => setFilters((prev) => ({ ...prev, targetLangs: [] }))}
                >
                  Clear all
                </button>
              )}
            </div>
            <LanguageSelect
              kind="target"
              multi
              values={filters.targetLangs}
              onChange={(values) => setFilters((prev) => ({ ...prev, targetLangs: values }))}
              sourceValue={filters.srcLang}
              disabled={languageLoading}
              containerClassName="fc-filter-options"
              optionClassName="form-check"
            />
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
      }
      onReset={resetFilters}
      resetDisabled={isDefaultFilters(filters)}
      actionsLeft={actions}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search project templates"
      primaryLabel="New Project Template"
      onPrimary={openCreate}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {languageError && <div className="alert alert-warning">{languageError}</div>}

      {loading ? (
        <div className="text-muted p-3">Loading project templates...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No project templates found</div>
          <div className="small">Adjust filters/search or create a new template.</div>
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
                <th>Languages</th>
                <th>Status</th>
                <th>Description</th>
                <th>Location</th>
                <th>Created</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((tpl) => {
                const selected = selectedIds.has(tpl.id);
                return (
                  <tr
                    key={tpl.id}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => toggleSelected(tpl.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSelected(tpl.id);
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
                        onChange={() => toggleSelected(tpl.id)}
                        aria-label={`Select ${tpl.name}`}
                      />
                    </td>
                    <td className="fw-semibold">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold"
                        onClick={(event) => {
                          event.stopPropagation();
                          nav(`/resources/templates/${tpl.id}`);
                        }}
                      >
                        {tpl.name}
                      </button>
                    </td>
                    <td>
                      <TemplateLanguagesCell src={tpl.languages.src} targets={tpl.languages.targets} />
                    </td>
                    <td>
                      <span className={`badge ${tpl.disabled ? "text-bg-secondary" : "text-bg-success"}`}>
                        {tpl.disabled ? "Disabled" : "Enabled"}
                      </span>
                    </td>
                    <td className="text-muted small">{tpl.description || "-"}</td>
                    <td className="text-muted small">{tpl.scope || "-"}</td>
                    <td className="text-muted small">{formatDateTime(tpl.createdAt) || "-"}</td>
                    <td className="text-muted small">{formatDateTime(tpl.updatedAt) || "-"}</td>
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
