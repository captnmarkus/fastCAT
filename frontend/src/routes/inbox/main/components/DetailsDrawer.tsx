import React from "react";
import type { ProjectBucketMeta } from "../../../../api";
import { formatDateTimeShort } from "../../../projects/shared/dates";
import { formatBytes } from "../../../projects/shared/format";
import LanguagePair from "../../../projects/shared/components/LanguagePair";
import ProgressBar from "../../../projects/shared/components/ProgressBar";
import StatusPill from "../../../projects/shared/components/StatusPill";
import type { InboxRow } from "../types";
import { labelForInboxStatus, toneForInboxStatus } from "../../shared/status";
import { normalizeLocale } from "../../../../lib/i18n/locale";
import { buildTargetOutputFilename } from "../../../../utils/outputFilename";
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
    const key = normalizeLangKey(file.lang);
    if (!map.has(key)) map.set(key, file);
  }
  return Array.from(map.values());
}

function normalizeReviewGateStatus(value: string | null | undefined): "draft" | "under_review" | "reviewed" | "error" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
  if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
    return "under_review";
  }
  if (raw === "error") return "error";
  return "draft";
}

type Props = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  rows: InboxRow[];
  selectedIds: Set<number>;
  selectedSingleId: number | null;
  canOpenProject: boolean;
  bucketMeta: ProjectBucketMeta | null;
  bucketLoading: boolean;
  bucketError: string | null;
  bucketDownloading: string | null;
  onOpen: () => void;
  onDownloadSource: (projectId: number, fileId: number, filename: string) => void;
  onDownloadOutput: (projectId: number, fileId: number, lang: string, filename: string) => void;
  onOpenProjectDetails: (projectId: number) => void;
};

export default function DetailsDrawer({
  collapsed,
  onCollapsedChange,
  rows,
  selectedIds,
  selectedSingleId,
  bucketMeta,
  bucketLoading,
  bucketError,
  bucketDownloading,
  canOpenProject,
  onOpen,
  onDownloadSource,
  onDownloadOutput,
  onOpenProjectDetails
}: Props) {
  const selectedCount = selectedIds.size;
  const row = selectedSingleId != null ? rows.find((r) => r.taskId === selectedSingleId) ?? null : null;
  const bucket = row && bucketMeta?.projectId === row.projectId ? bucketMeta : null;
  const sourceFiles = bucket?.source?.filter((file) => file.fileId === row?.fileId) ?? [];
  const outputFiles = dedupeOutputFiles(
    bucket?.output?.filter((file) => file.fileId === row?.fileId) ?? []
  );
  const expectedOutputFilename = row ? buildTargetOutputFilename(row.originalFilename, row.tgtLang) : "";
  const outputDownloadReady = (() => {
    if (!row) return false;
    const byTaskStatus = normalizeReviewGateStatus(row.taskStatus) === "reviewed";
    const byUiStatus = normalizeReviewGateStatus(row.status) === "reviewed";
    const total = Number(row.segmentStats?.total ?? 0) || 0;
    const reviewed = Number(row.segmentStats?.reviewed ?? 0) || 0;
    const bySegmentStats = total > 0 && reviewed >= total;
    const byProgress = Number(row.progressPct ?? 0) >= 100;
    return byTaskStatus || byUiStatus || bySegmentStats || byProgress;
  })();
  const outputMatch = row
    ? outputFiles.find((file) => normalizeLangKey(file.lang) === normalizeLangKey(row.tgtLang))
    : null;
  const panelEmpty = selectedCount === 0 || (!row && selectedCount <= 1);

  async function handleCopyTaskId() {
    if (!row || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(row.taskId));
    } catch {
      // no-op
    }
  }

  return (
    <DetailsPanel
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      title="Details"
      ariaLabel="Inbox item details"
      empty={panelEmpty}
      emptyState={<div className="text-muted small">Select an item to see details.</div>}
      onOpenFullDetails={row ? onOpen : undefined}
      openFullDetailsLabel="Open full details"
      actions={
        row ? (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleCopyTaskId}
              aria-label="Copy task ID"
            >
              <i className="bi bi-clipboard me-1" aria-hidden="true" />
              Copy ID
            </button>
            {canOpenProject ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => row && onOpenProjectDetails(row.projectId)}
              >
                <i className="bi bi-folder2-open me-1" aria-hidden="true" />
                Project
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      {selectedCount > 1 ? (
        <div className="d-flex flex-column gap-2">
          <div className="fw-semibold">{selectedCount} tasks selected</div>
          <div className="text-muted small">Select a single item to view metadata.</div>
        </div>
      ) : row ? (
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex align-items-start justify-content-between gap-2">
              <div className="fw-semibold">{row.originalFilename}</div>
              <StatusPill label={labelForInboxStatus(row.status)} tone={toneForInboxStatus(row.status)} />
            </div>
            <div className="text-muted small">File #{row.fileId} - {row.type.toUpperCase()}</div>
          </div>

          <div>
            <div className="d-flex align-items-center justify-content-between">
              <div>
                <div className="fw-semibold">{row.projectName}</div>
                <div className="text-muted small">Project #{row.projectId}</div>
              </div>
            </div>
          </div>

          <div className="d-flex flex-column gap-2">
            <LanguagePair srcLang={row.srcLang} tgtLang={row.tgtLang} />
            <ProgressBar percent={row.progressPct} />
          </div>

          <dl className="fc-project-drawer-dl">
            <dt>Status</dt>
            <dd>{labelForInboxStatus(row.status)}</dd>
            <dt>Usage</dt>
            <dd>{row.usage}</dd>
            <dt>Assigned</dt>
            <dd>{row.assignedTo || "unassigned"}</dd>
            <dt>Created</dt>
            <dd>{formatDateTimeShort(row.createdAt)}</dd>
            <dt>Last modified</dt>
            <dd>{formatDateTimeShort(row.modifiedAt || row.createdAt)}</dd>
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
                    <div className="text-muted small">No source file stored.</div>
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
                            onClick={() => onDownloadSource(row.projectId, file.fileId, file.filename)}
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
                  {!expectedOutputFilename ? (
                    <div className="text-muted small">No output file available.</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      <div
                        key={`out:${row.fileId}:${row.tgtLang}:${expectedOutputFilename}`}
                        className="d-flex align-items-center justify-content-between gap-2"
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="fw-semibold small text-truncate">
                            {expectedOutputFilename}
                            {!filenameHasLang(expectedOutputFilename, row.tgtLang) ? (
                              <span className="text-muted"> ({String(row.tgtLang).toUpperCase()})</span>
                            ) : null}
                          </div>
                          <div className="text-muted small">
                            {outputMatch
                              ? `${formatBytes(outputMatch.sizeBytes)} - ${formatDateTimeShort(outputMatch.createdAt)}`
                              : outputDownloadReady
                              ? "Generated (ready to download)"
                              : "Not generated yet"}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => onDownloadOutput(row.projectId, row.fileId, row.tgtLang, expectedOutputFilename)}
                          disabled={bucketDownloading === expectedOutputFilename || !outputDownloadReady}
                          aria-label={`Download ${expectedOutputFilename}`}
                          title={outputDownloadReady ? "Download" : "Download available after Done"}
                        >
                          <i className="bi bi-download" aria-hidden="true" />
                        </button>
                      </div>
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
