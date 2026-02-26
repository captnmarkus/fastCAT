import React from "react";
import { renderWithTags } from "../../../utils/tags";

export default function FileTypeConfigWizardPreviewStep(props: any) {
  const {
    setPreviewFile,
    handleRunPreview,
    previewLoading,
    payloadConfig,
    previewError,
    previewResult,
    previewShowTags,
    setPreviewShowTags
  } = props;

  return (
    <>
      <div className="fw-semibold mb-2">Preview / Test</div>
      <div className="row g-3 align-items-end">
        <div className="col-lg-8">
          <label className="form-label">Sample file</label>
          <input type="file" className="form-control" onChange={(e) => setPreviewFile(e.target.files?.[0] || null)} />
        </div>
        <div className="col-lg-4 d-grid">
          <button type="button" className="btn btn-outline-secondary" onClick={handleRunPreview} disabled={previewLoading || !payloadConfig}>
            {previewLoading ? "Running..." : "Run preview"}
          </button>
        </div>
      </div>
      {previewError && <div className="alert alert-danger py-2 mt-3">{previewError}</div>}
      {previewResult && (
        <div className="mt-3">
          <div className="d-flex align-items-center justify-content-between">
            <div className="fw-semibold">Preview</div>
            <div className="text-muted small">
              {previewResult.total} segments ({previewResult.kind})
            </div>
          </div>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-2">
            <div className="text-muted small">
              {previewResult.debug?.inlinePlaceholderCount != null ? (
                <>
                  Inline placeholders: <span className="fw-semibold">{previewResult.debug.inlinePlaceholderCount}</span>
                </>
              ) : null}
            </div>
            <div className="form-check m-0">
              <input
                id="preview-show-tags"
                type="checkbox"
                className="form-check-input"
                checked={previewShowTags}
                onChange={(e) => setPreviewShowTags(e.target.checked)}
              />
              <label className="form-check-label small" htmlFor="preview-show-tags">
                Show tags/placeholders
              </label>
            </div>
          </div>
          {previewResult.stats ? (
            <div className="text-muted small mt-1">
              Block matches: <span className="fw-semibold">{previewResult.stats.blockMatches}</span> Ð–Ñš Inline matches:{" "}
              <span className="fw-semibold">{previewResult.stats.inlineMatches}</span> Ð–Ñš Ignored matches:{" "}
              <span className="fw-semibold">{previewResult.stats.ignoredMatches}</span>
            </div>
          ) : null}
          {previewResult.debug?.errors?.length ? (
            <div className="alert alert-danger py-2 mt-2 mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {previewResult.debug.errors.join("\n")}
            </div>
          ) : null}
          {previewResult.debug?.warnings?.length ? (
            <div className="alert alert-warning py-2 mt-2 mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {previewResult.debug.warnings.join("\n")}
            </div>
          ) : null}
          <div className="table-responsive card-enterprise mt-2">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr className="text-muted small">
                  <th style={{ width: 64 }}>#</th>
                  <th>Extracted segment</th>
                  <th style={{ width: "38%" }}>{previewResult.kind === "xml" ? "Node path" : "Location"}</th>
                </tr>
              </thead>
              <tbody>
                {previewResult.segments.slice(0, 50).map((seg: any) => {
                  const loc = seg.location ?? null;
                  const locLabel =
                    previewResult.kind === "xml"
                      ? String(seg.path || "")
                      : loc && loc.kind === "attr"
                      ? `${loc.selector} @${loc.attribute}`
                      : loc && loc.kind === "html"
                      ? loc.selector
                      : "";
                  return (
                    <tr key={seg.id}>
                      <td className="text-muted small">{seg.id}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{renderWithTags(previewShowTags ? seg.taggedText : seg.sourceText)}</td>
                      <td className="text-muted small" style={{ wordBreak: "break-word" }}>
                        {locLabel || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
