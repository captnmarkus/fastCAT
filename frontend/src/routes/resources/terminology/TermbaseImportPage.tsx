import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  commitTermbaseImport,
  parseTermbaseImport,
  startTermbaseImport,
  type GlossaryImportParseResult,
  type GlossaryImportReport,
  type GlossaryImportSettings
} from "../../../api";
import { triggerFileDownload } from "../../../utils/download";
import { formatBytes } from "../../../utils/format";
import type { TermbaseShellContext } from "./TermbaseShellPage";

type ImportType = "csv" | "xlsx" | "tbx" | "mtf_xml" | "xml";

const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  csv: "CSV",
  xlsx: "XLSX",
  tbx: "TBX",
  mtf_xml: "MTF XML",
  xml: "XML"
};

const DEFAULT_IMPORT_SETTINGS: GlossaryImportSettings = {
  synonymSeparator: "|",
  multiValueSeparator: ";",
  multiLanguageDelimiter: "||",
  strictImport: true
};

function decodeUtf16Be(bytes: Uint8Array): string {
  const evenLength = bytes.length - (bytes.length % 2);
  const swapped = new Uint8Array(evenLength);
  for (let i = 0; i < evenLength; i += 2) {
    swapped[i] = bytes[i + 1];
    swapped[i + 1] = bytes[i];
  }
  return new TextDecoder("utf-16le").decode(swapped);
}

function decodeGlossaryBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    const b0 = bytes[0];
    const b1 = bytes[1];
    if (b0 === 0xff && b1 === 0xfe) {
      return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    }
    if (b0 === 0xfe && b1 === 0xff) {
      return decodeUtf16Be(bytes.subarray(2));
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 4) {
    if (bytes[0] === 0x00 && bytes[1] === 0x3c && bytes[2] === 0x00 && bytes[3] === 0x3f) {
      return decodeUtf16Be(bytes);
    }
    if (bytes[0] === 0x3c && bytes[1] === 0x00 && bytes[2] === 0x3f && bytes[3] === 0x00) {
      return new TextDecoder("utf-16le").decode(bytes);
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function findRootTagName(xmlText: string): string | null {
  const text = xmlText.replace(/^\uFEFF/, "");
  let idx = 0;
  while (idx < text.length) {
    const lt = text.indexOf("<", idx);
    if (lt === -1) return null;
    const next = text[lt + 1];
    if (next === "?") {
      const end = text.indexOf(">", lt + 2);
      if (end === -1) return null;
      idx = end + 1;
      continue;
    }
    if (next === "!") {
      if (text.startsWith("<!--", lt)) {
        const end = text.indexOf("-->", lt + 4);
        if (end === -1) return null;
        idx = end + 3;
        continue;
      }
      const end = text.indexOf(">", lt + 2);
      if (end === -1) return null;
      idx = end + 1;
      continue;
    }
    if (next === "/") {
      idx = lt + 2;
      continue;
    }
    const match = text.slice(lt + 1).match(/^([A-Za-z][A-Za-z0-9:_-]*)/);
    if (match) return match[1].toLowerCase();
    idx = lt + 1;
  }
  return null;
}

function detectXmlImportType(xmlText: string): ImportType | null {
  const trimmed = xmlText.trimStart();
  if (!trimmed.startsWith("<")) return null;
  const rootName = findRootTagName(trimmed);
  const lower = trimmed.toLowerCase();
  if (rootName === "mtf") return "mtf_xml";
  const hasTbxNamespace = /xmlns(:\w+)?=["'][^"']*tbx[^"']*["']/.test(lower);
  const hasTbxMarker = rootName === "tbx" || /<\s*tbx\b/.test(lower);
  const hasTermEntry = /<\s*termentry\b/.test(lower);
  if (hasTbxMarker || hasTbxNamespace || hasTermEntry) return "tbx";
  return "xml";
}

async function detectImportTypeFromFile(file: File): Promise<ImportType | null> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) return "csv";
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) return "xlsx";
  if (lowerName.endsWith(".tbx")) return "tbx";
  const isXmlExtension = lowerName.endsWith(".xml") || lowerName.endsWith(".mtf");
  const chunk = await file.slice(0, 128 * 1024).arrayBuffer();
  const text = decodeGlossaryBytes(new Uint8Array(chunk));
  const detected = detectXmlImportType(text);
  if (detected) return detected;
  return isXmlExtension ? "xml" : null;
}

function buildReportFromParse(parseResult: GlossaryImportParseResult): GlossaryImportReport {
  return {
    processed: parseResult.stats?.rowCount ?? parseResult.preview.entryCount ?? 0,
    imported: 0,
    skipped: parseResult.stats?.skippedRows ?? 0,
    errors: parseResult.validation.errors ?? [],
    warnings: parseResult.validation.warnings ?? []
  };
}

function csvEscape(value: string) {
  if (value.includes("\"") || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/\"/g, "\"\"")}"`;
  }
  return value;
}

function buildReportCsv(report: GlossaryImportReport) {
  const rows = [
    ["type", "message"],
    ...report.errors.map((message) => ["error", message]),
    ...report.warnings.map((message) => ["warning", message])
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

export default function TermbaseImportPage() {
  const nav = useNavigate();
  const { termbaseId, meta, refreshMeta } = useOutletContext<TermbaseShellContext>();

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [strictImages, setStrictImages] = useState(false);
  const [strictImport, setStrictImport] = useState(true);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "merge" | "overwrite">("skip");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [report, setReport] = useState<GlossaryImportReport | null>(null);
  const [detectedType, setDetectedType] = useState<ImportType | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const detectSeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const settings = useMemo<GlossaryImportSettings>(
    () => ({ ...DEFAULT_IMPORT_SETTINGS, strictImport }),
    [strictImport]
  );

  const defaultLanguages = useMemo(() => {
    const langs: string[] = [];
    if (meta?.defaultSourceLang) langs.push(meta.defaultSourceLang);
    if (meta?.defaultTargetLang && meta.defaultTargetLang !== meta.defaultSourceLang) {
      langs.push(meta.defaultTargetLang);
    }
    return langs;
  }, [meta?.defaultSourceLang, meta?.defaultTargetLang]);

  useEffect(() => {
    if (!sourceFile) {
      setDetectedType(null);
      return;
    }
    const seq = ++detectSeq.current;
    detectImportTypeFromFile(sourceFile)
      .then((detected) => {
        if (detectSeq.current !== seq) return;
        setDetectedType(detected);
      })
      .catch(() => {
        if (detectSeq.current !== seq) return;
        setDetectedType(null);
      });
  }, [sourceFile]);

  const handleFileChange = useCallback((file: File | null) => {
    setSourceFile(file);
    setReport(null);
    setImportError(null);
  }, []);

  const handleImport = useCallback(async () => {
    if (!sourceFile) return;
    setImporting(true);
    setImportError(null);
    setReport(null);
    try {
      const importType = await detectImportTypeFromFile(sourceFile);
      if (!importType) {
        setImportError("Unsupported file type. Use TBX, XML, XLSX, or CSV.");
        return;
      }
      const start = await startTermbaseImport({
        importType,
        languages: defaultLanguages,
        settings
      });
      const parseResult = await parseTermbaseImport({
        importId: start.importId,
        file: sourceFile,
        images: imageFiles,
        languages: defaultLanguages,
        strictImages,
        settings
      });
      if (parseResult.validation.errors.length > 0) {
        setReport(buildReportFromParse(parseResult));
        return;
      }
      const commitResult = await commitTermbaseImport(termbaseId, {
        importId: start.importId,
        duplicateStrategy,
        strictImages,
        settings,
        languages: defaultLanguages
      });
      setReport(commitResult.report ?? buildReportFromParse(parseResult));
      await refreshMeta();
    } catch (err: any) {
      setImportError(err?.userMessage || err?.message || "Failed to import termbase.");
    } finally {
      setImporting(false);
    }
  }, [
    defaultLanguages,
    duplicateStrategy,
    imageFiles,
    refreshMeta,
    settings,
    sourceFile,
    strictImages,
    termbaseId
  ]);

  const canImport = Boolean(sourceFile) && !importing;
  const detectedLabel = detectedType ? IMPORT_TYPE_LABELS[detectedType] : "Unknown";

  return (
    <div className="p-3">
      <div className="card-enterprise p-4 mb-3">
        <div className="fw-semibold mb-1">Import termbase</div>
        <div className="text-muted small mb-3">Supported formats: .tbx, .xml, .xlsx, .csv</div>

        <div
          className={`fc-termbase-import-dropzone${isDragging ? " is-dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            const file = event.dataTransfer.files?.[0] ?? null;
            handleFileChange(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="d-none"
            accept=".csv,.xlsx,.xls,.tbx,.xml,.mtf"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              handleFileChange(file);
            }}
          />
          {sourceFile ? (
            <div className="d-grid gap-1">
              <div className="fw-semibold">{sourceFile.name}</div>
              <div className="text-muted small">{formatBytes(sourceFile.size)} - {detectedLabel}</div>
              <div className="text-muted small">Click or drop another file to replace.</div>
            </div>
          ) : (
            <div className="d-grid gap-1">
              <div className="fw-semibold">Drop your termbase file here</div>
              <div className="text-muted small">or click to browse</div>
            </div>
          )}
        </div>

        <div className="row g-3 mt-3">
          <div className="col-12">
            <label className="form-label">Images (optional)</label>
            <input
              type="file"
              className="form-control"
              multiple
              onChange={(e) => setImageFiles(Array.from(e.target.files || []))}
            />
            <div className="form-text">Upload a zip or multiple image files referenced by entries.</div>
          </div>
          {imageFiles.length > 0 && (
            <div className="col-12 text-muted small">
              {imageFiles.length} file(s) selected - {formatBytes(imageFiles.reduce((sum, file) => sum + file.size, 0))}
            </div>
          )}
          <div className="col-12">
            <div className="form-check">
              <input
                id="strict-images"
                type="checkbox"
                className="form-check-input"
                checked={strictImages}
                onChange={(e) => setStrictImages(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="strict-images">
                Require all referenced images (strict mode)
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="card-enterprise p-4 mb-3">
        <div className="fw-semibold mb-3">Import settings</div>
        <div className="form-check mb-3">
          <input
            id="strict-import"
            type="checkbox"
            className="form-check-input"
            checked={strictImport}
            onChange={(e) => setStrictImport(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="strict-import">
            Strict import (exact language code match)
          </label>
        </div>
        <div>
          <div className="form-label">Duplicate handling</div>
          <div className="d-grid gap-2">
            {(
              [
                { value: "skip", label: "Ignore duplicates" },
                { value: "merge", label: "Merge entries" },
                { value: "overwrite", label: "Overwrite existing" }
              ] as Array<{ value: "skip" | "merge" | "overwrite"; label: string }>
            ).map((option) => (
              <div key={option.value} className="form-check">
                <input
                  className="form-check-input"
                  type="radio"
                  name="duplicate-strategy"
                  id={`duplicate-${option.value}`}
                  checked={duplicateStrategy === option.value}
                  onChange={() => setDuplicateStrategy(option.value)}
                />
                <label className="form-check-label" htmlFor={`duplicate-${option.value}`}>
                  {option.label}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {importError && (
        <div className="alert alert-danger py-2">{importError}</div>
      )}

      {report && (
        <div className="card-enterprise p-4 mb-3">
          <div className="fw-semibold mb-3">Import report</div>
          <div className="row g-3 mb-3">
            <div className="col-sm-6 col-lg-3">
              <div className="text-muted small">Processed</div>
              <div className="fw-semibold">{report.processed}</div>
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="text-muted small">Imported</div>
              <div className="fw-semibold">{report.imported}</div>
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="text-muted small">Updated</div>
              <div className="fw-semibold">{report.updated ?? 0}</div>
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="text-muted small">Skipped</div>
              <div className="fw-semibold">{report.skipped}</div>
            </div>
          </div>

          {report.errors.length > 0 && (
            <div className="alert alert-danger py-2">
              {report.errors.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="alert alert-warning py-2">
              {report.warnings.map((warn) => (
                <div key={warn}>{warn}</div>
              ))}
            </div>
          )}

          <div className="d-flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
                triggerFileDownload(blob, `termbase-import-report-${termbaseId}.json`);
              }}
            >
              Download JSON
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                const csv = buildReportCsv(report);
                const blob = new Blob([csv], { type: "text/csv" });
                triggerFileDownload(blob, `termbase-import-report-${termbaseId}.csv`);
              }}
            >
              Download CSV
            </button>
          </div>
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center">
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => nav(`/resources/termbases/${termbaseId}/entries`)}
          disabled={importing}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-dark"
          onClick={() => void handleImport()}
          disabled={!canImport}
        >
          {importing ? "Importing..." : "Import"}
        </button>
      </div>
    </div>
  );
}
