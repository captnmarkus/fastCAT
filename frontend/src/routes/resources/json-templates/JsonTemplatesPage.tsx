import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { downloadParsingTemplateJson, listFileTypeConfigs, listParsingTemplates, type FileTypeConfig, type ParsingTemplate } from "../../../api";
import { triggerFileDownload } from "../../../utils/download";
import { formatDateTime } from "../../../utils/format";
import { normalizeQuery } from "../../projects/shared/format";
import ResourcesTabLayout from "../_components/ResourcesTabLayout";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../projects/shared/storage";
import useCollectionViewMode from "../../../components/ui/useCollectionViewMode";
import DetailsPanel from "../../../components/ui/DetailsPanel";

type JsonTemplateRow = {
  templateId: number;
  templateName: string;
  templateKind: "html" | "xml";
  templateUpdatedAt: string | null;
  fileTypeConfigId: number;
  fileTypeConfigName: string;
  fileType: "html" | "xml";
  configUpdatedAt: string | null;
};

function safeFilename(name: string) {
  const base = String(name || "").trim() || "template";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseOptionalInt(value: any): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function normalizeFileType(value: any): "html" | "xml" | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "html" || v === "xml") return v;
  return null;
}

function getConfigFileType(config: Record<string, any>): "html" | "xml" | null {
  const direct = normalizeFileType((config as any)?.fileType);
  if (direct) return direct;
  const legacy = Array.isArray((config as any)?.fileTypes) ? ((config as any).fileTypes as any[]) : [];
  for (const item of legacy) {
    const t = normalizeFileType(item);
    if (t) return t;
  }
  return null;
}

function getAttachedParsingTemplateId(config: Record<string, any>, fileType: "html" | "xml"): number | null {
  const html = config && typeof (config as any).html === "object" && !Array.isArray((config as any).html) ? (config as any).html : {};
  const xml = config && typeof (config as any).xml === "object" && !Array.isArray((config as any).xml) ? (config as any).xml : {};
  const fallback = (config as any).parsingTemplateId ?? (config as any).htmlParsingTemplateId ?? (config as any).parsing_template_id;
  if (fileType === "html") return parseOptionalInt(html.parsingTemplateId ?? fallback);
  return parseOptionalInt(xml.parsingTemplateId ?? fallback);
}

function templateKindLabel(kind: "html" | "xml") {
  return kind === "xml" ? "XML" : "HTML/XHTML";
}

function buildRows(args: { configs: FileTypeConfig[]; templates: ParsingTemplate[] }): JsonTemplateRow[] {
  const templateById = new Map<number, ParsingTemplate>();
  args.templates.forEach((t) => templateById.set(t.id, t));

  const rows: JsonTemplateRow[] = [];
  for (const cfg of args.configs) {
    const fileType = getConfigFileType(cfg.config);
    if (!fileType) continue;

    const templateId = getAttachedParsingTemplateId(cfg.config, fileType);
    if (!templateId) continue;

    const tpl = templateById.get(templateId) ?? null;
    const tplKind = (tpl?.kind === "xml" ? "xml" : "html") as "html" | "xml";
    rows.push({
      templateId,
      templateName: tpl?.name ? String(tpl.name) : `Template #${templateId}`,
      templateKind: tplKind,
      templateUpdatedAt: tpl?.updatedAt ? String(tpl.updatedAt) : null,
      fileTypeConfigId: cfg.id,
      fileTypeConfigName: cfg.name,
      fileType,
      configUpdatedAt: cfg.updatedAt ? String(cfg.updatedAt) : null
    });
  }

  rows.sort((a, b) => {
    const aTs = new Date(a.templateUpdatedAt || a.configUpdatedAt || 0).getTime();
    const bTs = new Date(b.templateUpdatedAt || b.configUpdatedAt || 0).getTime();
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return bTs - aTs;
    return b.templateId - a.templateId;
  });

  return rows;
}

export default function JsonTemplatesPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();
  const storageKey = `fc:${currentUser.username || currentUser.id}:resources:json-templates`;
  const detailsCollapsedStorageKey = `${storageKey}:detailsCollapsed`;
  const [detailsCollapsed, setDetailsCollapsed] = useState<boolean>(() => {
    const raw = safeLocalStorageGet(detailsCollapsedStorageKey);
    return raw === "1" || raw === "true";
  });
  const { viewMode, setViewMode } = useCollectionViewMode({
    storageKey: `${storageKey}:view`,
    defaultMode: "list"
  });
  const [items, setItems] = useState<JsonTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    safeLocalStorageSet(detailsCollapsedStorageKey, detailsCollapsed ? "1" : "0");
  }, [detailsCollapsed, detailsCollapsedStorageKey]);

  async function load() {
    setError(null);
    try {
      const [configs, templates] = await Promise.all([listFileTypeConfigs(), listParsingTemplates()]);
      const rows = buildRows({ configs, templates });
      setItems(rows);
    } catch (err: any) {
      setItems([]);
      setError(err?.userMessage || err?.message || "Failed to load JSON templates.");
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
      const hay = normalizeQuery(`${item.templateName}\n${item.fileTypeConfigName}\n${item.fileTypeConfigId}`);
      return hay.includes(q);
    });
  }, [items, searchQuery]);

  useEffect(() => {
    if (!selectedKey) return;
    if (!filteredItems.some((item) => `${item.fileTypeConfigId}:${item.templateId}` === selectedKey)) {
      setSelectedKey(null);
    }
  }, [filteredItems, selectedKey]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDownload(row: JsonTemplateRow) {
    setError(null);
    setDownloadingId(row.templateId);
    try {
      const blob = await downloadParsingTemplateJson(row.templateId);
      triggerFileDownload(blob, `${safeFilename(row.templateName)}-${row.templateId}.json`);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to download template JSON.");
    } finally {
      setDownloadingId(null);
    }
  }

  const selectedItem = selectedKey
    ? filteredItems.find((row) => `${row.fileTypeConfigId}:${row.templateId}` === selectedKey) ?? null
    : null;

  async function handleCopyTemplateId() {
    if (!selectedItem || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(selectedItem.templateId));
    } catch {
      // no-op
    }
  }

  const detailsPanel = (
    <DetailsPanel
      collapsed={detailsCollapsed}
      onCollapsedChange={setDetailsCollapsed}
      title="Details"
      ariaLabel="JSON template details"
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
              disabled={downloadingId === selectedItem.templateId}
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
            <div className="fw-semibold">{selectedItem.templateName}</div>
            <div className="text-muted small">Template #{selectedItem.templateId}</div>
          </div>
          <dl className="fc-project-drawer-dl">
            <dt>Kind</dt>
            <dd>{templateKindLabel(selectedItem.fileType)}</dd>
            <dt>Attached to</dt>
            <dd>
              {selectedItem.fileTypeConfigName} (ID {selectedItem.fileTypeConfigId})
            </dd>
            <dt>Template modified</dt>
            <dd>{formatDateTime(selectedItem.templateUpdatedAt || "") || "-"}</dd>
            <dt>Config modified</dt>
            <dd>{formatDateTime(selectedItem.configUpdatedAt || "") || "-"}</dd>
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
      searchPlaceholder="Search JSON templates..."
      primaryLabel="File Type Configs"
      onPrimary={() => nav("/resources/file-types")}
      primaryDisabled={loading}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      detailsPanel={detailsPanel}
    >
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <div className="text-muted p-3">Loading JSON templates...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-muted card-enterprise p-5">
          <div className="mb-2 fw-semibold">No JSON templates found</div>
          <div className="small">Only templates attached to HTML/XML file type configurations appear here.</div>
        </div>
      ) : (
        <div className="table-responsive card-enterprise">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr className="text-muted small">
                <th>Name</th>
                <th style={{ width: 140 }}>Type</th>
                <th>Attached to</th>
                <th style={{ width: 200 }}>Last modified</th>
                <th style={{ width: 160 }} />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((row) => {
                const rowKey = `${row.fileTypeConfigId}:${row.templateId}`;
                const selected = rowKey === selectedKey;
                const lastModified = formatDateTime(row.templateUpdatedAt || row.configUpdatedAt || "");
                return (
                  <tr
                    key={rowKey}
                    className={`fc-table-row${selected ? " selected table-active" : ""}`}
                    onClick={() => {
                      setSelectedKey(rowKey);
                      setDetailsCollapsed(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedKey(rowKey);
                        setDetailsCollapsed(false);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selected}
                  >
                    <td className="fw-semibold">{row.templateName}</td>
                    <td>
                      <span className={`badge ${row.fileType === "xml" ? "text-bg-primary" : "text-bg-secondary"}`}>
                        {templateKindLabel(row.fileType)}
                      </span>
                    </td>
                    <td className="text-muted small">
                      {row.fileTypeConfigName} (ID {row.fileTypeConfigId})
                    </td>
                    <td className="text-muted small">{lastModified || "-"}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        disabled={downloadingId === row.templateId}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDownload(row);
                        }}
                      >
                        <i className="bi bi-download me-1" aria-hidden="true" />
                        {downloadingId === row.templateId ? "Downloading..." : "Download JSON"}
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
