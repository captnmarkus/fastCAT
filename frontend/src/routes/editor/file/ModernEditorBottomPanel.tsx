import React from "react";
import type { RenderedPreviewDetailsResponse, Segment } from "../../../api";

type BottomTab = "history" | "qa" | "segment_comments" | "document_comments" | "rendered_preview" | "rendered_status";

function renderedPreviewBusy(status: string, loading: boolean) {
  if (loading) return true;
  return status === "queued" || status === "running";
}

function renderedPreviewViewerType(
  details: RenderedPreviewDetailsResponse | null,
  configuredMethod: string | null
): "pdf" | "images" | "html" | "xml" | "unknown" {
  const contentType = String(details?.contentType || "").toLowerCase();
  const kind = String(details?.kind || "").toLowerCase();
  const method = String(details?.methodUsed || details?.methodRequested || configuredMethod || "").toLowerCase();
  if (kind === "pdf" || contentType.includes("application/pdf") || method === "pdf") return "pdf";
  if (kind === "images" || contentType.startsWith("image/") || method === "images") return "images";
  if (kind === "xml" || contentType.includes("xml") || method === "xml_raw_pretty") return "xml";
  if (kind === "html" || contentType.includes("text/html") || method === "html" || method === "xml_xslt") return "html";
  return "unknown";
}

export default function ModernEditorBottomPanel(props: {
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
  setBottomPanelOpen: (value: boolean) => void;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  historyLoading: boolean;
  historyError: string | null;
  historyEntries: Array<{ id: number; updatedBy?: string | null; createdAt: string; oldTgt?: string | null; newTgt?: string | null }>;
  editor: any;
  previewEnabled: boolean;
  previewLayout: "split" | "side";
  renderedPreviewSupported: boolean;
  renderedPreviewStatus: string;
  renderedPreviewLoading: boolean;
  renderedPreviewPreviewId: string | null;
  renderedPreviewConfiguredMethod: string | null;
  renderedPreviewRevisionId: string | null;
  renderedPreviewDetails: RenderedPreviewDetailsResponse | null;
  renderedPreviewError: string | null;
  renderedPreviewErrorDetails: string | null;
  renderedPreviewWarnings: string[];
  renderedPreviewLogs: string[];
  onRenderedPreviewRefresh: () => void;
  onRenderedPreviewOpenNewTab: () => void;
  showTags: boolean;
  showWhitespace: boolean;
  segmentTargetValue: (segment: Segment, draftById: Record<number, string>) => string;
  previewBlockMeta: (source: string) => { kind: "heading" | "paragraph"; level: number };
  renderWithTags: (value: string, glossary?: any, options?: { showWhitespace?: boolean }) => React.ReactNode;
  renderPlainText: (value: string, options?: { showWhitespace?: boolean }) => React.ReactNode;
}) {
  if (!props.bottomPanelOpen) {
    return (
      <div className="fc-modern-bottom-collapsed">
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => props.setBottomPanelOpen(true)}>
          Expand panel
        </button>
      </div>
    );
  }

  const busy = renderedPreviewBusy(props.renderedPreviewStatus, props.renderedPreviewLoading);
  const historyEntries = Array.isArray(props.historyEntries) ? props.historyEntries : [];
  const signedUrl = props.renderedPreviewDetails?.signedUrl ? String(props.renderedPreviewDetails.signedUrl) : "";
  const viewerType = renderedPreviewViewerType(props.renderedPreviewDetails, props.renderedPreviewConfiguredMethod);
  const methodUsed =
    props.renderedPreviewDetails?.methodUsed ||
    props.renderedPreviewDetails?.methodRequested ||
    props.renderedPreviewConfiguredMethod ||
    null;

  return (
    <section className="fc-modern-bottom" style={{ height: `${props.bottomPanelHeight}px` }}>
      <div
        className="fc-modern-bottom-resizer"
        onMouseDown={props.onResizeStart}
        role="separator"
        aria-label="Resize bottom panel"
        aria-orientation="horizontal"
      />

      <div className="fc-modern-bottom-tabs">
        <button type="button" className={`fc-modern-tab ${props.bottomTab === "history" ? "active" : ""}`} onClick={() => props.setBottomTab("history")}>
          History
        </button>
        <button type="button" className={`fc-modern-tab ${props.bottomTab === "qa" ? "active" : ""}`} onClick={() => props.setBottomTab("qa")}>
          QA
        </button>
        <button
          type="button"
          className={`fc-modern-tab ${props.bottomTab === "segment_comments" ? "active" : ""}`}
          onClick={() => props.setBottomTab("segment_comments")}
        >
          Segment comments
        </button>
        <button
          type="button"
          className={`fc-modern-tab ${props.bottomTab === "document_comments" ? "active" : ""}`}
          onClick={() => props.setBottomTab("document_comments")}
        >
          Document comments
        </button>
        {props.renderedPreviewSupported ? (
          <>
            <button
              type="button"
              className={`fc-modern-tab ${props.bottomTab === "rendered_preview" ? "active" : ""}`}
              onClick={() => props.setBottomTab("rendered_preview")}
            >
              Rendered Preview
            </button>
            <button
              type="button"
              className={`fc-modern-tab ${props.bottomTab === "rendered_status" ? "active" : ""}`}
              onClick={() => props.setBottomTab("rendered_status")}
            >
              Logs/Status
            </button>
          </>
        ) : null}
        <div className="ms-auto d-flex gap-2">
          {props.renderedPreviewSupported ? (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={props.onRenderedPreviewRefresh}
                disabled={props.renderedPreviewLoading}
                title="Refresh rendered preview"
              >
                Refresh preview
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={props.onRenderedPreviewOpenNewTab}
                disabled={!signedUrl}
                title="Open preview artifact in a new browser tab"
              >
                Open in new tab
              </button>
            </>
          ) : null}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => props.setBottomPanelOpen(false)}>
            Collapse
          </button>
        </div>
      </div>

      <div className="fc-modern-bottom-body">
        {props.bottomTab === "history" ? (
          props.historyLoading ? (
            <div className="text-muted small">Loading segment history...</div>
          ) : props.historyError ? (
            <div className="text-danger small">{props.historyError}</div>
          ) : historyEntries.length === 0 ? (
            <div className="text-muted small">No history entries for this segment.</div>
          ) : (
            <div className="fc-modern-history-list">
              {historyEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="fc-modern-history-item"
                  onClick={() => props.editor.active && props.editor.setActiveId(props.editor.active.id)}
                >
                  <div className="fc-modern-history-head">
                    <span className="fw-semibold">{entry.updatedBy || "system"}</span>
                    <span className="text-muted small">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="small text-muted">Old: {entry.oldTgt || "Empty"}</div>
                  <div className="small">New: {entry.newTgt || "Empty"}</div>
                </button>
              ))}
            </div>
          )
        ) : null}

        {props.bottomTab === "qa" ? (
          props.editor.issuesList.length === 0 ? (
            <div className="text-muted small">No QA issues in this document.</div>
          ) : (
            <div className="fc-modern-history-list">
              {props.editor.issuesList.map((issue: any, idx: number) => (
                <button
                  key={`${issue.segmentId}:${issue.code}:${idx}`}
                  type="button"
                  className="fc-modern-history-item"
                  onClick={() => props.editor.jumpToIssue(issue.segmentId)}
                >
                  <div className="fc-modern-history-head">
                    <span className={`badge text-bg-${issue.severity === "error" ? "danger" : "warning"}`}>{issue.severity}</span>
                    <span className="small text-muted">Segment #{issue.segmentNo}</span>
                  </div>
                  <div className="small fw-semibold">{issue.code}</div>
                  <div className="small">{issue.message}</div>
                </button>
              ))}
            </div>
          )
        ) : null}

        {props.bottomTab === "segment_comments" ? (
          <div className="text-muted small">Segment comments backend is not configured in this build. Tab kept for migration parity.</div>
        ) : null}

        {props.bottomTab === "document_comments" ? (
          <div className="text-muted small">Document comments backend is not configured in this build. Tab kept for migration parity.</div>
        ) : null}

        {props.bottomTab === "rendered_preview" ? (
          !props.renderedPreviewSupported ? (
            <div className="text-muted small">Rendered preview is disabled for this file type configuration.</div>
          ) : props.renderedPreviewError ? (
            <div className="fc-modern-rendered-error">
              <div className="fw-semibold">Rendered preview failed.</div>
              <div className="small mt-1">{props.renderedPreviewError}</div>
              {props.renderedPreviewErrorDetails ? (
                <details className="mt-2">
                  <summary className="small">Show details</summary>
                  <pre className="fc-modern-rendered-details">{props.renderedPreviewErrorDetails}</pre>
                </details>
              ) : null}
            </div>
          ) : busy && !signedUrl ? (
            <div className="fc-modern-rendered-loading">
              <div className="spinner-border spinner-border-sm" role="status" aria-hidden />
              <span>Generating rendered preview ({props.renderedPreviewStatus || "running"})...</span>
            </div>
          ) : !signedUrl ? (
            <div className="text-muted small">Rendered preview not generated yet. Click Refresh preview.</div>
          ) : (
            <div className="fc-modern-rendered-shell">
              {props.renderedPreviewWarnings.length > 0 ? (
                <div className="fc-modern-rendered-warning">
                  <div className="fw-semibold small">Preview warnings</div>
                  <ul className="mb-0">
                    {props.renderedPreviewWarnings.map((warning, idx) => (
                      <li key={`${warning}:${idx}`} className="small">
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="fc-modern-rendered-meta small text-muted">
                <span>Status: {props.renderedPreviewStatus || "ready"}</span>
                <span>Method: {methodUsed || "n/a"}</span>
                {props.renderedPreviewDetails?.createdAt ? (
                  <span>Updated: {new Date(props.renderedPreviewDetails.createdAt).toLocaleString()}</span>
                ) : null}
              </div>

              <div className="fc-modern-rendered-viewer">
                {viewerType === "pdf" ? (
                  <iframe src={signedUrl} title="Rendered preview PDF" className="fc-modern-rendered-frame" />
                ) : null}
                {viewerType === "images" ? (
                  <div className="fc-modern-rendered-image-wrap">
                    <img src={signedUrl} alt="Rendered preview" className="fc-modern-rendered-image" loading="lazy" />
                  </div>
                ) : null}
                {viewerType === "html" || viewerType === "xml" ? (
                  <iframe
                    src={signedUrl}
                    title="Rendered file preview"
                    className="fc-modern-rendered-frame"
                    sandbox="allow-downloads"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                {viewerType === "unknown" ? (
                  <div className="fc-modern-rendered-fallback">
                    <div className="small text-muted">Preview type is not embeddable in-panel. Open it in a new tab.</div>
                    <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-secondary mt-2">
                      Open artifact
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : null}

        {props.bottomTab === "rendered_status" ? (
          !props.renderedPreviewSupported ? (
            <div className="text-muted small">Rendered preview is disabled for this file type configuration.</div>
          ) : (
            <div className="fc-modern-rendered-status-list">
              <div className="fc-modern-rendered-status-item">
                <span className="text-muted small">Status</span>
                <span className="fw-semibold">{props.renderedPreviewStatus || "idle"}</span>
              </div>
              <div className="fc-modern-rendered-status-item">
                <span className="text-muted small">Preview ID</span>
                <span className="fw-semibold">{props.renderedPreviewPreviewId || "-"}</span>
              </div>
              <div className="fc-modern-rendered-status-item">
                <span className="text-muted small">Configured method</span>
                <span className="fw-semibold">{props.renderedPreviewConfiguredMethod || "-"}</span>
              </div>
              <div className="fc-modern-rendered-status-item">
                <span className="text-muted small">Used method</span>
                <span className="fw-semibold">{methodUsed || "-"}</span>
              </div>
              <div className="fc-modern-rendered-status-item">
                <span className="text-muted small">Draft revision</span>
                <span className="fw-semibold">{props.renderedPreviewRevisionId || "-"}</span>
              </div>
              {props.renderedPreviewWarnings.length > 0 ? (
                <div className="fc-modern-rendered-status-block">
                  <div className="fw-semibold small mb-1">Warnings</div>
                  <ul className="mb-0">
                    {props.renderedPreviewWarnings.map((warning, idx) => (
                      <li key={`${warning}:${idx}`} className="small">
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {props.renderedPreviewLogs.length > 0 ? (
                <div className="fc-modern-rendered-status-block">
                  <div className="fw-semibold small mb-1">Logs</div>
                  <pre className="fc-modern-rendered-details">{props.renderedPreviewLogs.join("\n")}</pre>
                </div>
              ) : (
                <div className="text-muted small">No renderer logs yet.</div>
              )}
              {props.renderedPreviewError ? (
                <div className="fc-modern-rendered-error">
                  <div className="fw-semibold small">Error</div>
                  <div className="small">{props.renderedPreviewError}</div>
                  {props.renderedPreviewErrorDetails ? (
                    <details className="mt-2">
                      <summary className="small">Show details</summary>
                      <pre className="fc-modern-rendered-details">{props.renderedPreviewErrorDetails}</pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
