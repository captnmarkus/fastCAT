export type FileIngestionTemplateKind = "html" | "xml";

function safeLang(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function safeExt(filename: string) {
  const raw = String(filename || "").trim();
  const lastDot = raw.lastIndexOf(".");
  const ext = lastDot >= 0 ? raw.slice(lastDot).toLowerCase() : "";
  if (!ext || ext.length > 10) return ".bin";
  if (!/^\.[a-z0-9]+$/.test(ext)) return ".bin";
  return ext;
}

function safeFileName(filename: string, fallback = "file") {
  const raw = String(filename || "").trim();
  const ext = safeExt(raw);
  const base = raw.replace(/\.[^/.\\]+$/, "");
  const safeBase = base
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return `${safeBase || fallback}${ext}`;
}

export function keyProjectManifest(params: { departmentId: number; projectId: number }) {
  return `departments/${params.departmentId}/projects/${params.projectId}/manifest.json`;
}

export function keyProjectSourceOriginal(params: {
  departmentId: number;
  projectId: number;
  fileId: number;
  originalFilename: string;
}) {
  const ext = safeExt(params.originalFilename);
  return `departments/${params.departmentId}/projects/${params.projectId}/files/${params.fileId}/source/original${ext}`;
}

export function keyProjectDerivedExtraction(params: { departmentId: number; projectId: number; fileId: number }) {
  return `departments/${params.departmentId}/projects/${params.projectId}/files/${params.fileId}/derived/extraction.json`;
}

export function keyProjectDerivedSegmentsXliff(params: { departmentId: number; projectId: number; fileId: number }) {
  return `departments/${params.departmentId}/projects/${params.projectId}/files/${params.fileId}/derived/segments.xliff`;
}

function safeIdSegment(input: string, maxLen = 80) {
  const safe = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, maxLen);
  return safe || "run";
}

export function keyProjectDerivedSegmentsXliffRun(params: {
  departmentId: number;
  projectId: number;
  fileId: number;
  runId: string;
}) {
  const run = safeIdSegment(params.runId, 80);
  return `departments/${params.departmentId}/projects/${params.projectId}/files/${params.fileId}/derived/segments/${run}.xliff`;
}

export function keyProjectTargetOutput(params: {
  departmentId: number;
  projectId: number;
  fileId: number;
  targetLang: string;
  outputExtension: string;
}) {
  const lang = safeLang(params.targetLang) || "target";
  const ext = safeExt(`file${params.outputExtension.startsWith(".") ? params.outputExtension : `.${params.outputExtension}`}`);
  return `departments/${params.departmentId}/projects/${params.projectId}/files/${params.fileId}/target/${lang}/output${ext}`;
}

export function keyProjectTargetOutputRun(params: {
  departmentId: number;
  projectId: number;
  fileId: number;
  targetLang: string;
  outputExtension: string;
  runId: string;
}) {
  const lang = safeLang(params.targetLang) || "target";
  const ext = safeExt(`file${params.outputExtension.startsWith(".") ? params.outputExtension : `.${params.outputExtension}`}`);
  const run = safeIdSegment(params.runId, 80);
  return `departments/${params.departmentId}/projects/${params.projectId}/files/${params.fileId}/target/${lang}/runs/${run}/output${ext}`;
}

export function keyProjectRenderedPreviewRun(params: {
  departmentId: number;
  projectId: number;
  fileId: number;
  targetLang: string;
  previewMethod: string;
  outputExtension: string;
  runId: string;
}) {
  const lang = safeLang(params.targetLang) || "target";
  const method = safeIdSegment(params.previewMethod, 40);
  const ext = safeExt(`file${params.outputExtension.startsWith(".") ? params.outputExtension : `.${params.outputExtension}`}`);
  const run = safeIdSegment(params.runId, 80);
  return `departments/${params.departmentId}/projects/${params.projectId}/files/${params.fileId}/preview/${lang}/${method}/runs/${run}/output${ext}`;
}

export function keyProjectExportBundle(params: { departmentId: number; projectId: number; exportId: string }) {
  const safeId = String(params.exportId || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  return `departments/${params.departmentId}/projects/${params.projectId}/exports/${safeId}/translated_bundle.zip`;
}

export function keyProjectRunLog(params: { departmentId: number; projectId: number; runId: string }) {
  const safeId = String(params.runId || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  return `departments/${params.departmentId}/projects/${params.projectId}/logs/${safeId}.jsonl`;
}

export function keyFileIngestionTemplateJson(params: {
  kind: FileIngestionTemplateKind;
  templateId: number;
  version: number;
}) {
  const folder = params.kind === "xml" ? "xml" : "xhtml";
  return `root/templates/file-ingestion-templates/${folder}/${params.templateId}/v${params.version}/template.json`;
}

export function keyFileIngestionTemplateUploadJson(params: { kind: FileIngestionTemplateKind; uploadId: number }) {
  const folder = params.kind === "xml" ? "xml" : "xhtml";
  return `root/templates/file-ingestion-templates/${folder}/uploads/${params.uploadId}/source.json`;
}

export function keyProjectTemplateJson(params: { templateId: number; version: number }) {
  return `root/templates/project-templates/${params.templateId}/v${params.version}/template.json`;
}

export function keyTmxUpload(params: { tmxUploadId: number; versionTag?: string }) {
  const safeTag =
    String(params.versionTag || "source")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 80) || "source";
  return `root/tmx/uploads/${params.tmxUploadId}/${safeTag}.tmx`;
}

export function keyTerminologyUpload(params: { uploadId: number; filename?: string | null }) {
  const ext = safeExt(params.filename || ".csv");
  return `root/terminology/uploads/${params.uploadId}/source${ext}`;
}

export function keyTerminologyImportSource(params: { importId: number; filename?: string | null }) {
  const ext = safeExt(params.filename || ".bin");
  return `root/terminology/imports/${params.importId}/source${ext}`;
}

export function keyTerminologyImportImage(params: { importId: number; filename: string }) {
  const safeName = safeFileName(params.filename, "image");
  return `root/terminology/imports/${params.importId}/images/${safeName}`;
}

export function keyTerminologyImage(params: { glossaryId: number; filename: string }) {
  const safeName = safeFileName(params.filename, "image");
  return `root/terminology/glossaries/${params.glossaryId}/images/${safeName}`;
}
