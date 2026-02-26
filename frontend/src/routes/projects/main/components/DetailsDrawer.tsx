import React from "react";
import type { ProjectBucketMeta } from "../../../../api";
import { formatDateTimeShort } from "../../shared/dates";
import { formatBytes } from "../../shared/format";
import LanguagePair from "../../shared/components/LanguagePair";
import ProgressBar from "../../shared/components/ProgressBar";
import StatusPill from "../../shared/components/StatusPill";
import type { ProjectRow } from "../types";
import { normalizeLocale } from "../../../../lib/i18n/locale";
import IssuesPanel from "../../../../components/ui/IssuesPanel";
import DetailsPanel from "../../../../components/ui/DetailsPanel";

function normalizeLangKey(value: string) {
  const normalized = normalizeLocale(String(value || ""));
  return normalized.canonical ? normalized.canonical.toLowerCase() : String(value || "").trim().toLowerCase();
}

function filenameHasLang(filename: string, lang: string) {
  const normalized = normalizeLangKey(lang);
  if (!normalized) return false;
  return String(filename || "").toLowerCase().includes(normalized);
}

function dedupeOutputFiles(files: ProjectBucketMeta["output"]) {
  const sorted = [...files].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const map = new Map<string, ProjectBucketMeta["output"][number]>();
  for (const file of sorted) {
    const key = `${file.fileId}:${normalizeLangKey(file.lang)}`;
    if (!map.has(key)) map.set(key, file);
  }
  return Array.from(map.values());
}

type Props = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  rows: ProjectRow[];
  selectedIds: Set<number>;
  selectedSingleId: number | null;
  canOpenSelected: boolean;
  canDeleteSelected: boolean;
  bucketMeta: ProjectBucketMeta | null;
  bucketLoading: boolean;
  bucketError: string | null;
  bucketDownloading: string | null;
  onOpen: () => void;
  onOpenProvisioning?: () => void;
  onDeleteSelected: () => void;
  onDownloadSource: (projectId: number, fileId: number, filename: string) => void;
  onDownloadOutput: (projectId: number, fileId: number, lang: string, filename: string) => void;
};

export default function DetailsDrawer({
  collapsed,
  onCollapsedChange,
  rows,
  selectedIds,
  selectedSingleId,
  canOpenSelected,
  canDeleteSelected,
  bucketMeta,
  bucketLoading,
  bucketError,
  bucketDownloading,
  onOpen,
  onOpenProvisioning,
  onDeleteSelected,
  onDownloadSource,
  onDownloadOutput
}: Props) {
  const selectedCount = selectedIds.size;
  const row = selectedSingleId != null ? rows.find((r) => r.project.id === selectedSingleId) ?? null : null;
  const project = row?.project ?? null;
  const bucket = project && bucketMeta?.projectId === project.id ? bucketMeta : null;
  const sourceFiles = bucket?.source ?? [];
  const outputFiles = dedupeOutputFiles(bucket?.output ?? []);
  const outputPreview = outputFiles.slice(0, 5);
  const panelEmpty = selectedCount === 0 || (!row && selectedCount <= 1);
  const isProvisioningProject = Boolean(project && String(project.status || "").trim().toLowerCase() === "provisioning");
  const canOpenFullDetails = Boolean(row && canOpenSelected);
  const openFullDetailsAction = isProvisioningProject && onOpenProvisioning ? onOpenProvisioning : canOpenFullDetails ? onOpen : undefined;
  const openFullDetailsLabel = isProvisioningProject ? "Open provisioning view" : "Open full details";

  function formatProvisioningStep(value: string | null | undefined) {
    const raw = String(value || "").trim();
    if (!raw) return "Preparing...";
    return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  async function handleCopyProjectId() {
    if (!project || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(project.id));
    } catch {
      // no-op
    }
  }

  return (
    <DetailsPanel
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      title="Details"
      ariaLabel="Project details"
      empty={panelEmpty}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      onOpenFullDetails={openFullDetailsAction}
      openFullDetailsLabel={openFullDetailsLabel}
      actions={
        row ? (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleCopyProjectId}
              aria-label="Copy project ID"
            >
              <i className="bi bi-clipboard me-1" aria-hidden="true" />
              Copy ID
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={!canDeleteSelected}
              onClick={onDeleteSelected}
            >
              <i className="bi bi-trash me-1" aria-hidden="true" />
              Delete
            </button>
          </>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} projects selected</div>
          <div className="text-muted small">Select a single item to view metadata.</div>
        </div>
      ) : row && project ? (
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex align-items-start justify-content-between gap-2">
              <div className="fw-semibold">{project.name}</div>
              <StatusPill label={row.statusLabel} tone={row.statusTone} />
            </div>
            <div className="text-muted small">Project #{project.id}</div>
          </div>

          <div className="d-flex flex-column gap-2">
            <LanguagePair srcLang={project.srcLang} tgtLang={project.tgtLang} targetLangs={project.targetLangs} />
            <ProgressBar percent={row.progressPct} />
          </div>

          <dl className="fc-project-drawer-dl">
            <dt>Status</dt>
            <dd>{row.statusLabel}</dd>
            <dt>Owner</dt>
            <dd>{row.ownerLabel}</dd>
            <dt>Due</dt>
            <dd>{formatDateTimeShort(row.dueAt)}</dd>
            <dt>Last modified</dt>
            <dd>{formatDateTimeShort(row.lastModifiedAt)}</dd>
            <dt>Tasks</dt>
            <dd>{row.meta ? `${row.meta.total - row.meta.pending}/${row.meta.total}` : "-"}</dd>
            <dt>Errors</dt>
            <dd>{row.errorCount > 0 ? row.errorCount : "0"}</dd>
            {isProvisioningProject ? (
              <>
                <dt>Current step</dt>
                <dd>{formatProvisioningStep(row.provisioningStep)}</dd>
                <dt>Last update</dt>
                <dd>{formatDateTimeShort(row.provisioningUpdatedAt)}</dd>
                <dt>Started</dt>
                <dd>{formatDateTimeShort(project.provisioningStartedAt ?? null)}</dd>
                <dt>Progress</dt>
                <dd>{row.progressPct}%</dd>
              </>
            ) : null}
          </dl>

          <div className="fc-project-drawer-section">
            <div className="fc-project-drawer-section-title">Files</div>
            {bucketLoading ? (
              <div className="text-muted small">Loading files...</div>
            ) : bucketError ? (
              <IssuesPanel issues={[bucketError]} tone="danger" />
            ) : (
              <div className="d-flex flex-column gap-3">
                <div>
                  <div className="small fw-semibold text-muted mb-1">Source</div>
                  {sourceFiles.length === 0 ? (
                    <div className="text-muted small">No source files stored.</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {sourceFiles.map((file) => (
                        <div
                          key={`src:${file.fileId}:${file.filename}`}
                          className="d-flex align-items-center justify-content-between gap-2"
                        >
                          <div style={{ minWidth: 0 }}>
                            <div className="fw-semibold small text-truncate">{file.filename}</div>
                            <div className="text-muted small">
                              {formatBytes(file.sizeBytes)} - {formatDateTimeShort(file.uploadedAt)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => onDownloadSource(project.id, file.fileId, file.filename)}
                            disabled={bucketDownloading === file.filename}
                            aria-label={`Download ${file.filename}`}
                            title="Download"
                          >
                            <i className="bi bi-download" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="small fw-semibold text-muted mb-1">Outputs</div>
                  {outputFiles.length === 0 ? (
                    <div className="text-muted small">No output files stored.</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {outputPreview.map((file) => (
                        <div
                          key={`out:${file.fileId}:${file.lang}:${file.filename}`}
                          className="d-flex align-items-center justify-content-between gap-2"
                        >
                          <div style={{ minWidth: 0 }}>
                            <div className="fw-semibold small text-truncate">
                              {file.filename}
                              {!filenameHasLang(file.filename, file.lang) ? (
                                <span className="text-muted"> ({String(file.lang).toUpperCase()})</span>
                              ) : null}
                            </div>
                            <div className="text-muted small">
                              {formatBytes(file.sizeBytes)} - {formatDateTimeShort(file.createdAt)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => onDownloadOutput(project.id, file.fileId, file.lang, file.filename)}
                            disabled={bucketDownloading === file.filename}
                            aria-label={`Download ${file.filename}`}
                            title="Download"
                          >
                            <i className="bi bi-download" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                      {outputFiles.length > outputPreview.length ? (
                        <div className="text-muted small">+{outputFiles.length - outputPreview.length} more</div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </DetailsPanel>
  );
}
