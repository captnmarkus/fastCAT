import React from "react";
import type { SaveIndicatorState } from "../state/useEditorFile";

export default function EditorTopBar(props: {
  projectName: string;
  fileName: string;
  saveLabel: string;
  saveTone: SaveIndicatorState;
  onComplete: () => void | Promise<void>;
  onDownload: () => void | Promise<void>;
  onDownloadXliff?: () => void | Promise<void>;
  onClose: () => void;
  completeDisabled?: boolean;
  downloadDisabled?: boolean;
  downloadXliffDisabled?: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  modernUiEnabled?: boolean;
  onToggleModernUi?: () => void;
}) {
  const tone =
    props.saveTone === "saved"
      ? "text-success"
      : props.saveTone === "saving"
      ? "text-muted"
      : props.saveTone === "offline"
      ? "text-warning"
      : "text-danger";

  return (
    <header className="fc-editor-topbar">
      <div className="fc-editor-topbar-inner">
        <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
          <div className="fw-semibold text-truncate">FastCAT Editor</div>
          <div className="text-muted">/</div>
          <div className="text-truncate fw-semibold" title={props.fileName}>
            {props.fileName}
          </div>
          {props.projectName ? (
            <div className="d-none d-md-inline text-muted small text-truncate" title={props.projectName}>
              {props.projectName}
            </div>
          ) : null}
        </div>

        <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end">
          <div className={`small ${tone} d-flex align-items-center gap-1`} title={props.saveLabel}>
            <i
              className={`bi ${
                props.saveTone === "saved"
                  ? "bi-check-circle"
                  : props.saveTone === "saving"
                  ? "bi-cloud-arrow-up"
                  : props.saveTone === "offline"
                  ? "bi-wifi-off"
                  : "bi-exclamation-triangle"
              }`}
              aria-hidden="true"
            />
            <span className="d-none d-sm-inline">{props.saveLabel}</span>
          </div>

          <div className="vr d-none d-md-block" />

          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={props.onComplete}
            disabled={props.completeDisabled}
          >
            Complete
          </button>

          <button
            type="button"
            className="btn btn-dark btn-sm"
            onClick={props.onDownload}
            disabled={props.downloadDisabled}
            title="Download translated file"
          >
            <i className="bi bi-download me-1" aria-hidden="true" />
            Download
          </button>

          {props.onDownloadXliff ? (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={props.onDownloadXliff}
              disabled={props.downloadXliffDisabled}
              title="Download bilingual XLIFF"
            >
              XLIFF
            </button>
          ) : null}

          {props.onToggleModernUi ? (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={props.onToggleModernUi}
              title="Switch editor mode"
            >
              {props.modernUiEnabled ? "Classic" : "Modern UI (beta)"}
            </button>
          ) : null}

          <button
            type="button"
            className={`btn btn-outline-secondary btn-sm ${props.sidebarOpen ? "active" : ""}`}
            onClick={props.onToggleSidebar}
            title="Toggle panels"
          >
            <i className="bi bi-layout-sidebar-inset-reverse" aria-hidden="true" />
          </button>

          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={props.onClose} title="Close">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
