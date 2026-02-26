import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { downloadParsingTemplateJson, listParsingTemplates, type ParsingTemplate } from "../../../api";
import { triggerFileDownload } from "../../../utils/download";
import { formatDateTime } from "../../../utils/format";
import { normalizeQuery } from "../../projects/shared/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

function safeFilename(name: string) {
  const base = String(name || "").trim() || "template";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default function ExtractionTemplatesPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:extraction-templates`;
  const detailsCollapsedStorageKey = `${storageKey}:detailsCollapsed`;
  const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(detailsCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });
  const { viewMode, setViewMode } = useCollectionViewMode({
    storageKey: `${storageKey}:view`,
    defaultMode: "list"
  });

  const [items, setItems] = useState<ParsingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    safeLocalStorageSet(detailsCollapsedStorageKey, detailsCollapsed ? "1" : "0");
  }, [detailsCollapsed, detailsCollapsedStorageKey]);

  async function load() {
    setError(null);
    try {
      const list = await listParsingTemplates();
      setItems(list);
    } catch (err: any) {
      setItems([]);
      setError(err?.userMessage || err?.message || "Failed to load extraction templates.");
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
      if (!q) return true;
      const hay = normalizeQuery(`${item.name}\n${item.description}`);
      return hay.includes(q);
    });
  }, [items, searchQuery]);

  useEffect(() => {
    if (selectedId == null) return;
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredItems, selectedId]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDownload(tpl: ParsingTemplate) {
    setError(null);
    setDownloadingId(tpl.id);
    try {
      const blob = await downloadParsingTemplateJson(tpl.id);
      triggerFileDownload(blob, `${safeFilename(tpl.name)}-${tpl.id}.json`);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to download template JSON.");
    } finally {
      setDownloadingId(null);
    }
  }

  function handleCreate() {
    nav("/resources/file-types/create?type=html");
  }

  const selectedItem = selectedId != null ? filteredItems.find((entry) => entry.id === selectedId) ?? null : null;

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
      ariaLabel="Extraction template details"
      empty={!selectedItem}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      actions={
        selectedItem ? (
          <>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCopyTemplateId}>
              <i className="bi bi-clipboard me-1" aria-hidden="true" />
              Copy ID
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={downloadingId === selectedItem.id}
              onClick={() => void handleDownload(selectedItem)}
            >
              <i className="bi bi-download me-1" aria-hidden="true" />
              Download JSON
            </button>
          </>
        ) : null
      }
    >
      {selectedItem ? (
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="fw-semibold">{selectedItem.name}</div>
            <div className="text-muted small">Template #{selectedItem.id}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Description</dt>
            <dd>{selectedItem.description || "-"}</dd>
            <dt>Kind</dt>
            <dd>{selectedItem.kind ? String(selectedItem.kind).toUpperCase() : "-"}</dd>
            <dt>Last modified</dt>
            <dd>{selectedItem.updatedAt ? formatDateTime(selectedItem.updatedAt) : "-"}</dd>
          </dl>
        </div>
      ) : null}
    </DetailsPanel>
  );

  return (
    <ResourcesTabLayout
      storageKey={storageKey}
      filterTitle="Filters"
      filters={<div className="text-muted small">No filters yet.</div>}
      actionsLeft={[
        {
          label: refreshing ? "Refreshing..." : "Refresh",
          icon: "bi-arrow-repeat",
          onClick: () => void handleRefresh(),
          disabled: loading || refreshing
        }
      ]}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search templates..."
      primaryLabel="New template"
      onPrimary={handleCreate}
      primaryDisabled={loading}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && <div className="alert alert-danger py-2">{error}</div>}
      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-muted">No extraction templates found.</div>
      ) : (
        <div className="table-responsive card-enterprise">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr className="text-muted small">
                <th style={{ width: 72 }}>ID</th>
                <th>Name</th>
                <th>Description</th>
                <th style={{ width: 200 }}>Updated</th>
                <th style={{ width: 160 }} />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((tpl) => {
                const selected = tpl.id === selectedId;
                return (
                <tr
                  key={tpl.id}
                  className={`fc-table-row${selected ? " selected table-active" : ""}`}
                  onClick={() => {
                    setSelectedId(tpl.id);
                    setDetailsCollapsed(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(tpl.id);
                      setDetailsCollapsed(false);
                    }
                  }}
                  tabIndex={0}
                  aria-selected={selected}
                >
                  <td className="text-muted small">{tpl.id}</td>
                  <td className="fw-semibold">{tpl.name}</td>
                  <td className="text-muted small">{tpl.description || "-"}</td>
                  <td className="text-muted small">{tpl.updatedAt ? formatDateTime(tpl.updatedAt) : "-"}</td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      disabled={downloadingId === tpl.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownload(tpl);
                      }}
                    >
                      <i className="bi bi-download me-1" aria-hidden="true" />
                      {downloadingId === tpl.id ? "Downloading..." : "Download JSON"}
                    </button>
                  </td>
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
