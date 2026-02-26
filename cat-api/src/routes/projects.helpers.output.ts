import AdmZip from "adm-zip";
import XLSX from "xlsx";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import path from "path";
import {
  type RichTextRun,
  type SegmentContainerContext,
  type SegmentOriginDetails,
  normalizeOriginDetails,
  normalizeRichTextRuns,
  normalizeSegmentContext
} from "../lib/rich-text.js";

import { extractXmlSegmentsWithTemplate } from "../lib/xml-extraction.js";
import { normalizeXmlParsingTemplateConfig } from "../lib/parsing-templates.js";

function normalizeJsonObjectLocal(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

export function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

export function safeDispositionFilename(value: string) {
  return String(value || "file")
    .replace(/[\r\n]+/g, " ")
    .replace(/["]/g, "");
}

export const DOCX_CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n</Types>\n`;

export const DOCX_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n</Relationships>\n`;

export const INLINE_TOKEN_RE = /<\/?\d+>/;

export function resolveOutputExtension(originalName: string, fileType: string | null): string {
  const ext = path.extname(String(originalName || "")).trim();
  if (ext) return ext;
  if (fileType) return `.${fileType}`;
  return ".txt";
}

export function contentTypeForExtension(ext: string): string {
  const normalized = ext.toLowerCase();
  switch (normalized) {
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".html":
    case ".htm":
      return "text/html";
    case ".xhtml":
    case ".xtml":
      return "application/xhtml+xml";
    case ".xml":
      return "application/xml";
    case ".csv":
      return "text/csv";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export function buildTargetFilename(originalName: string, targetLang: string, outputExtension: string) {
  const parsed = path.parse(String(originalName || "").trim() || "file");
  const base = parsed.name || "file";
  const suffix = targetLang ? ` (${targetLang})` : "";
  const ext = outputExtension || parsed.ext || "";
  return `${base}${suffix}${ext}`;
}

export function resolveSegmentText(segment: { src: string; tgt: string | null }) {
  const tgt = segment.tgt != null ? String(segment.tgt) : "";
  if (tgt.trim().length > 0) return tgt;
  return String(segment.src ?? "");
}

export function buildDocxBuffer(lines: string[]): Buffer {
  const paragraphs = lines
    .map((line) => {
      const parts = String(line ?? "").split(/\r?\n/);
      const runs = parts
        .map((part) => `<w:t xml:space="preserve">${escapeXml(String(part ?? ""))}</w:t>`)
        .join("<w:br/>");
      return `<w:p><w:r>${runs}</w:r></w:p>`;
    })
    .join("");

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n  <w:body>\n    ${paragraphs || "<w:p><w:r><w:t></w:t></w:r></w:p>"}\n  </w:body>\n</w:document>\n`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(DOCX_CONTENT_TYPES_XML, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(DOCX_RELS_XML, "utf8"));
  zip.addFile("word/document.xml", Buffer.from(docXml, "utf8"));
  return zip.toBuffer();
}

export async function buildPptxBuffer(lines: string[]): Promise<Buffer> {
  const mod: any = await import("pptxgenjs");
  const PptxGenJS = mod?.default ?? mod;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const slide = pptx.addSlide();
  const text = lines.join("\n").trim() || " ";
  slide.addText(text, {
    x: 0.5,
    y: 0.5,
    w: 9.0,
    h: 5.0,
    fontSize: 18,
    color: "333333",
    valign: "top"
  });
  const buf = await pptx.write("nodebuffer");
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

export function buildXlsxBuffer(lines: string[]): Buffer {
  const rows = lines.length > 0 ? lines.map((line) => [line]) : [[""]];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Translations");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

export function hasElementChildren(node: Element): boolean {
  const children = Array.from((node as any).childNodes || []);
  return children.some((child) => (child as any).nodeType === 1);
}

export function parseNodePath(pathValue: string) {
  const parts = String(pathValue || "")
    .split("/")
    .filter(Boolean);
  let attr: string | null = null;
  if (parts.length > 0 && parts[parts.length - 1]!.startsWith("@")) {
    const last = parts.pop()!;
    attr = last.slice(1);
  }
  const nodes = parts.map((part) => {
    const match = /^([^\[]+)(?:\[(\d+)\])?$/.exec(part);
    const name = match ? match[1] : part;
    const index = match && match[2] ? Number(match[2]) : 1;
    return { name, index: Number.isFinite(index) && index > 0 ? index : 1 };
  });
  return { nodes, attr };
}

export function selectElementByPath(
  doc: Document,
  pathValue: string
): { element: Element | null; attr: string | null } {
  const parsed = parseNodePath(pathValue);
  let current: Element | null = null;
  let context: Node = doc as any;
  for (const part of parsed.nodes) {
    const children = Array.from((context as any).childNodes || []).filter(
      (node) => (node as any).nodeType === 1 && String((node as any).nodeName || "") === part.name
    );
    const target = children[part.index - 1] as Element | undefined;
    if (!target) return { element: null, attr: parsed.attr };
    current = target;
    context = target;
  }
  return { element: current, attr: parsed.attr };
}

export function buildXmlOutput(params: {
  sourceBuffer: Buffer;
  template: ReturnType<typeof normalizeXmlParsingTemplateConfig>;
  segmenter: "lines" | "sentences";
  preserveWhitespace: boolean;
  segments: { src: string; tgt: string | null }[];
}) {
  const extracted = extractXmlSegmentsWithTemplate({
    fileBuffer: params.sourceBuffer,
    template: params.template,
    segmenter: params.segmenter,
    preserveWhitespace: params.preserveWhitespace
  });

  if (extracted.segments.length !== params.segments.length) {
    throw new Error("XML export cannot be generated because the segment count does not match the source template.");
  }

  if (extracted.segments.some((seg) => INLINE_TOKEN_RE.test(seg.taggedText))) {
    throw new Error("XML export is not available for files that contain inline tag placeholders.");
  }

  const parser = new DOMParser({
    errorHandler: {
      warning() {},
      error(msg) {
        throw new Error(String(msg || "Invalid XML"));
      },
      fatalError(msg) {
        throw new Error(String(msg || "Invalid XML"));
      }
    }
  });
  const xmlText = params.sourceBuffer.toString("utf8");
  const doc = parser.parseFromString(xmlText, "text/xml");
  const grouped = new Map<string, string[]>();

  extracted.segments.forEach((seg, idx) => {
    const replacement = resolveSegmentText(params.segments[idx]!);
    const list = grouped.get(seg.path) ?? [];
    list.push(replacement);
    grouped.set(seg.path, list);
  });

  for (const [pathValue, values] of grouped.entries()) {
    const { element, attr } = selectElementByPath(doc, pathValue);
    if (!element) {
      throw new Error(`XML export failed to locate node for path ${pathValue}.`);
    }
    const joiner = params.segmenter === "lines" ? "\n" : " ";
    const replacement = values.join(joiner);
    if (attr) {
      (element as any).setAttribute(attr, replacement);
      continue;
    }
    if (hasElementChildren(element)) {
      throw new Error("XML export is not available for elements that contain nested tags.");
    }
    while ((element as any).firstChild) {
      (element as any).removeChild((element as any).firstChild);
    }
    (element as any).appendChild(doc.createTextNode(replacement));
  }

  const serialized = new XMLSerializer().serializeToString(doc);
  return serialized.startsWith("<?xml") ? serialized : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

export type UploadType = "html" | "xml" | "pdf" | "docx" | "pptx" | "xlsx" | null;

export type UploadError = Error & {
  status: number;
  code: string;
  detail?: string;
};

export type RequestError = Error & {
  status: number;
};

export const OFFICE_UPLOAD_TYPES = new Set<NonNullable<UploadType>>(["docx", "pptx", "xlsx", "pdf"]);

export function makeUploadError(
  status: number,
  code: string,
  message: string,
  detail?: string,
  cause?: unknown
): UploadError {
  const err = new Error(message) as UploadError;
  err.status = status;
  err.code = code;
  if (detail) err.detail = detail;
  if (cause) (err as any).cause = cause;
  return err;
}

export function isUploadError(err: unknown): err is UploadError {
  return Boolean(err && typeof err === "object" && typeof (err as any).status === "number");
}

export function makeRequestError(status: number, message: string): RequestError {
  const err = new Error(message) as RequestError;
  err.status = status;
  return err;
}

export function isRequestError(err: unknown): err is RequestError {
  return Boolean(err && typeof err === "object" && typeof (err as any).status === "number");
}

export function sanitizeTextForDb(value: string): string {
  return String(value ?? "").replace(/\u0000/g, "");
}

export type UploadSegmentInput = {
  src: string;
  tgt?: string | null;
  srcRuns?: RichTextRun[] | null;
  tgtRuns?: RichTextRun[] | null;
  segmentContext?: SegmentContainerContext | null;
  originDetails?: SegmentOriginDetails | null;
};

function sanitizeRunsText(runs: RichTextRun[] | null | undefined): RichTextRun[] {
  const normalized = normalizeRichTextRuns(runs, "");
  return normalized.map((run) => ({
    ...run,
    text: sanitizeTextForDb(run.text)
  }));
}

export function sanitizeSegments(segs: UploadSegmentInput[]) {
  return segs.map((seg) => ({
    src: sanitizeTextForDb(seg.src),
    tgt: seg.tgt == null ? seg.tgt : sanitizeTextForDb(seg.tgt),
    srcRuns: sanitizeRunsText(seg.srcRuns ?? null),
    tgtRuns: sanitizeRunsText(seg.tgtRuns ?? null),
    segmentContext: normalizeSegmentContext(seg.segmentContext ?? {}),
    originDetails: normalizeOriginDetails(seg.originDetails ?? {})
  }));
}

export function truncateErrorMessage(value: string, max = 240): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}...` : trimmed;
}

export function isTextLikeContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return value.startsWith("text/") || value.includes("xml") || value.includes("json");
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

export function buildOfficeParserConfig(uploadType: NonNullable<UploadType>, fileTypeConfig: { config: any } | null) {
  const cfg = normalizeJsonObjectLocal(fileTypeConfig?.config);
  const config: any = { newlineDelimiter: "\n" };

  if (uploadType === "pptx") {
    const pptxCfg = normalizeJsonObjectLocal(cfg.pptx);
    if (pptxCfg.includeSpeakerNotes === false) config.ignoreNotes = true;
    if (pptxCfg.putNotesAtLast === true) config.putNotesAtLast = true;
  }

  return config;
}

export function formatOfficeParseError(err: unknown) {
  const message =
    typeof err === "string"
      ? err
      : err && typeof (err as any).message === "string"
        ? (err as any).message
        : "";
  return truncateErrorMessage(message || "Unknown parsing error.");
}
