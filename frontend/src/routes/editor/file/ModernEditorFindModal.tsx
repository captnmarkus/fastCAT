import React from "react";

export default function ModernEditorFindModal(props: {
  open: boolean;
  mode: "find" | "replace";
  onClose: () => void;
  editor: any;
  findMatchCount: number;
}) {
  if (!props.open) return null;

  return (
    <div className="fc-modern-modal-backdrop" role="dialog" aria-modal="true" aria-label="Find and replace">
      <div className="fc-modern-modal">
        <div className="fc-modern-modal-header">
          <div className="fw-semibold">{props.mode === "replace" ? "Find / Replace" : "Find"}</div>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={props.onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="fc-modern-modal-body">
          <label className="form-label">Find</label>
          <input
            type="text"
            className="form-control form-control-sm mb-2"
            value={props.editor.findQuery}
            onChange={(e) => props.editor.setFindQuery(e.target.value)}
            autoFocus
          />

          {props.mode === "replace" ? (
            <>
              <label className="form-label">Replace with</label>
              <input
                type="text"
                className="form-control form-control-sm mb-2"
                value={props.editor.replaceQuery}
                onChange={(e) => props.editor.setReplaceQuery(e.target.value)}
              />
            </>
          ) : null}

          <div className="row g-2">
            <div className="col-sm-6">
              <label className="form-label">Scope</label>
              <select
                className="form-select form-select-sm"
                value={props.editor.findScope}
                onChange={(e) => props.editor.setFindScope(e.target.value as "source" | "target" | "both")}
              >
                <option value="source">Source</option>
                <option value="target">Target</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="col-sm-6 d-flex align-items-end">
              <label className="form-check mb-1">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={props.editor.findUseRegex}
                  onChange={(e) => props.editor.setFindUseRegex(e.target.checked)}
                />
                <span className="form-check-label">Regex</span>
              </label>
            </div>
          </div>

          <div className="text-muted small mt-2">{props.findMatchCount} matches</div>
        </div>
        <div className="fc-modern-modal-footer">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => props.editor.goToMatch(-1)}>
            Previous
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => props.editor.goToMatch(1)}>
            Next
          </button>
          {props.mode === "replace" ? (
            <button type="button" className="btn btn-sm btn-dark" onClick={() => props.editor.replaceAllInTarget()}>
              Replace all
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
