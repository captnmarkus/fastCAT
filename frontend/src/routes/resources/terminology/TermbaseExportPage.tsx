import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { exportTermbase } from "../../../api";
import { triggerFileDownload } from "../../../utils/download";
import type { TermbaseShellContext } from "./TermbaseShellPage";

export default function TermbaseExportPage() {
  const { termbaseId, meta, canEdit } = useOutletContext<TermbaseShellContext>();
  const [format, setFormat] = useState<"csv" | "tbx">("csv");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (!Number.isFinite(termbaseId) || termbaseId <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await exportTermbase(termbaseId, format);
      const filename = `${meta?.name || `termbase-${termbaseId}`}.${format}`;
      triggerFileDownload(blob, filename);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to export termbase.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-3">
      <div className="fw-semibold mb-2">Export termbase</div>
      <div className="text-muted small mb-3">
        Choose a format and download the full termbase.
      </div>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      {!canEdit && (
        <div className="alert alert-warning py-2">
          You do not have permission to export this termbase.
        </div>
      )}
      <div className="d-flex align-items-center gap-2">
        <select
          className="form-select form-select-sm"
          value={format}
          onChange={(e) => setFormat(e.target.value === "tbx" ? "tbx" : "csv")}
          style={{ width: 120 }}
          disabled={!canEdit || loading}
        >
          <option value="csv">CSV</option>
          <option value="tbx">TBX</option>
        </select>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleExport}
          disabled={!canEdit || loading}
        >
          {loading ? "Exporting..." : "Export"}
        </button>
      </div>
    </div>
  );
}
