import React from "react";
import { buildTargetOutputFilename } from "../../../utils/outputFilename";
import { formatDateTimeShort } from "../shared/dates";
import { formatBytes } from "../shared/format";

export default function ProjectsDetailsFilesTable(props: any) {
  const {
    visibleFiles,
    isReviewer,
    isTaskAssignedToUser,
    deriveRollupStatus,
    computeProgressPct,
    statusToneClass,
    sourceByFileId,
    expandedFiles,
    toggleFileExpanded,
    canDownloadSource,
    handleDownloadSource,
    handleDownloadOutput,
    isProjectReady,
    bucketDownloading,
    resolveTaskMeta,
    normalizeTaskStatus,
    formatTaskStatus,
    rowImportKey,
    outputByFileLang,
    isProjectOwner,
    rowImportState,
    importingRowKey,
    openImportDialog,
    nav
  } = props;

  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0 fc-table-compact">
        <thead>
          <tr>
            <th>File</th>
            <th style={{ width: 140 }}>Tasks</th>
            <th style={{ width: 120 }}>Status</th>
            <th style={{ width: 160 }}>Progress</th>
            <th style={{ width: 190 }}>Outputs</th>
            <th style={{ width: 180 }} />
          </tr>
        </thead>
        <tbody>
          {visibleFiles.map((file: any) => {
            const tasks = file.tasks ?? [];
            const visibleTasks = isReviewer ? tasks.filter(isTaskAssignedToUser) : tasks;
            const status = deriveRollupStatus(visibleTasks, file.status);
            const pct = computeProgressPct(visibleTasks, file.segmentStats);
            const statusClass = statusToneClass(status);
            const sourceEntry = sourceByFileId.get(file.fileId);
            const sizeLabel = sourceEntry ? formatBytes(sourceEntry.sizeBytes) : "-";
            const typeLabel = file.type ? String(file.type).toUpperCase() : "FILE";
            const fileMetaLabel = sizeLabel !== "-" ? `${typeLabel} | ${sizeLabel}` : typeLabel;
            const isExpanded = Boolean(expandedFiles[file.fileId]);
            const outputsCount = visibleTasks.length;
            const outputsLabel = `${outputsCount} output${outputsCount === 1 ? "" : "s"}`;

            return (
              <React.Fragment key={file.fileId}>
                <tr>
                  <td>
                    <div className="d-flex align-items-start gap-2">
                      {visibleTasks.length > 0 ? (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 text-decoration-none"
                          onClick={() => toggleFileExpanded(file.fileId)}
                          aria-expanded={isExpanded}
                          aria-label={`Toggle ${file.originalFilename}`}
                        >
                          <i className={`bi ${isExpanded ? "bi-chevron-down" : "bi-chevron-right"}`} aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="text-muted small" style={{ width: 18 }} />
                      )}
                      <div>
                        <div className="fw-semibold">{file.originalFilename}</div>
                        <div className="text-muted small">{fileMetaLabel}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-muted small">
                    {visibleTasks.length === 0 ? "-" : `${visibleTasks.length} language${visibleTasks.length === 1 ? "" : "s"}`}
                  </td>
                  <td>
                    <span className={`badge fc-status-pill ${statusClass}`}>
                      {String(status).replace(/_/g, " ").toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <div className="progress flex-grow-1" style={{ height: 6, minWidth: 70 }}>
                        <div
                          className="progress-bar bg-dark"
                          role="progressbar"
                          style={{ width: `${pct}%` }}
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                      </div>
                      <div className="text-muted small" style={{ width: 42, textAlign: "right" }}>
                        {pct}%
                      </div>
                    </div>
                  </td>
                  <td className="text-muted small">
                    {outputsCount > 0 ? (
                      <div className="d-flex flex-column gap-1">
                        <span>{outputsLabel}</span>
                        <span className="text-muted">Expand to download</span>
                      </div>
                    ) : (
                      <span className="text-muted">No outputs</span>
                    )}
                  </td>
                  <td className="text-end">
                    <div className="d-flex justify-content-end gap-2">
                      {canDownloadSource ? (
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => handleDownloadSource(file.fileId, file.originalFilename)}
                          disabled={!isProjectReady || bucketDownloading === file.originalFilename}
                          aria-label={`Download ${file.originalFilename}`}
                          title={isProjectReady ? "Download source" : "Available when provisioning is complete"}
                        >
                          <i className="bi bi-download" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr className="fc-file-subrow">
                    <td colSpan={6}>
                      <div className="fc-file-subtable">
                        <table className="table table-sm align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Target language</th>
                              <th style={{ width: 160 }}>Assignee</th>
                              <th style={{ width: 140 }}>Task status</th>
                              <th style={{ width: 160 }}>Progress</th>
                              <th style={{ width: 140 }}>Output</th>
                              <th style={{ width: 140 }} />
                            </tr>
                          </thead>
                          <tbody>
                            {visibleTasks.map((task: any) => {
                              const meta = resolveTaskMeta(task.targetLang);
                              const label = meta?.label || task.targetLang.toUpperCase();
                              const taskStatus = normalizeTaskStatus(task.status);
                              const taskStatusLabel = formatTaskStatus(task.status);
                              const taskStatusClass = statusToneClass(taskStatus);
                              const taskPct = computeProgressPct([task], null);
                              const outputKey = rowImportKey(file.fileId, task.targetLang);
                              const hasOutput = outputByFileLang.has(outputKey);
                              const canImportToTm = isProjectReady && isProjectOwner && taskStatus === "reviewed" && hasOutput;
                              const importState = rowImportState[outputKey];
                              const isImporting = importingRowKey === outputKey;
                              const outputFilename = buildTargetOutputFilename(file.originalFilename, task.targetLang);
                              return (
                                <tr key={`${file.fileId}:${task.taskId}`}>
                                  <td>
                                    <div className="d-flex align-items-center gap-2">
                                      {meta?.flag ? (
                                        <span className={`flag-icon fi fi-${meta.flag}`} aria-hidden="true" />
                                      ) : (
                                        <i className="bi bi-flag-fill text-muted" aria-hidden="true" />
                                      )}
                                      <span className="fw-semibold">{label}</span>
                                    </div>
                                  </td>
                                  <td className="text-muted small">{task.assigneeId || "unassigned"}</td>
                                  <td>
                                    <span className={`badge fc-status-pill ${taskStatusClass}`}>{taskStatusLabel}</span>
                                  </td>
                                  <td>
                                    <div className="d-flex align-items-center gap-2">
                                      <div className="progress flex-grow-1" style={{ height: 6, minWidth: 70 }}>
                                        <div
                                          className="progress-bar bg-dark"
                                          role="progressbar"
                                          style={{ width: `${taskPct}%` }}
                                          aria-valuenow={taskPct}
                                          aria-valuemin={0}
                                          aria-valuemax={100}
                                        />
                                      </div>
                                      <div className="text-muted small" style={{ width: 42, textAlign: "right" }}>
                                        {taskPct}%
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    {hasOutput ? (
                                      <button
                                        type="button"
                                        className="btn btn-link btn-sm p-0 text-decoration-none"
                                        onClick={() => handleDownloadOutput(file.fileId, task.targetLang, outputFilename)}
                                        disabled={!isProjectReady || bucketDownloading === outputFilename}
                                        title={isProjectReady ? "Download output" : "Available when provisioning is complete"}
                                      >
                                        <i className="bi bi-download me-1" aria-hidden="true" />
                                        Output
                                      </button>
                                    ) : (
                                      <span className="text-muted small">Not generated</span>
                                    )}
                                  </td>
                                  <td className="text-end">
                                    <div className="d-flex justify-content-end gap-2">
                                      {canImportToTm ? (
                                        <button
                                          type="button"
                                          className="btn btn-outline-secondary btn-sm"
                                          onClick={() =>
                                            openImportDialog({
                                              fileId: file.fileId,
                                              fileName: file.originalFilename,
                                              targetLang: task.targetLang,
                                              targetLabel: label
                                            })
                                          }
                                          disabled={isImporting || importState?.status === "imported"}
                                          title="Import finished translation to TM"
                                        >
                                          {isImporting ? (
                                            <>
                                              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
                                              Importing...
                                            </>
                                          ) : importState?.status === "imported" ? (
                                            "Imported to TM"
                                          ) : importState?.status === "error" ? (
                                            "Retry Import"
                                          ) : (
                                            "Import to TM"
                                          )}
                                        </button>
                                      ) : null}
                                      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => nav(`/editor/${task.taskId}`)}>
                                        Open task
                                      </button>
                                    </div>
                                    {importState?.status === "imported" ? (
                                      <div className="text-success small mt-1">Imported {formatDateTimeShort(importState.importedAt)}</div>
                                    ) : null}
                                    {importState?.status === "error" && !isImporting ? (
                                      <div className="text-danger small mt-1">{importState.message || "Import failed"}</div>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
