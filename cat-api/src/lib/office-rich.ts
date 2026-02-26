import AdmZip from "adm-zip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  type RichTextRun,
  type RichTextStyle,
  type SegmentContainerContext,
  dominantRunStyle,
  mergeAdjacentRuns,
  normalizeRichTextRuns,
  normalizeRichTextStyle,
  projectTextToTemplateRuns,
  runsToPlainText
} from "./rich-text.js";

export type OfficeFileType = "docx" | "pptx" | "xlsx";

export type OfficeRichSegment = {
  src: string;
  tgt?: string | null;
  srcRuns?: RichTextRun[];
  tgtRuns?: RichTextRun[];
  segmentContext?: SegmentContainerContext;
};

type XmlDocument = Document;
type XmlElement = Element;

function localNameOf(name: string | null | undefined) {
  const raw = String(name ?? "");
  const idx = raw.indexOf(":");
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

function elementChildren(node: Node | null | undefined): XmlElement[] {
  if (!node) return [];
  const out: XmlElement[] = [];
  const children = (node as any).childNodes as NodeListOf<ChildNode> | undefined;
  if (!children) return out;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i] as Node;
    if ((child as any).nodeType === 1) out.push(child as unknown as XmlElement);
  }
  return out;
}

function firstChildByLocalName(node: Node | null | undefined, targetLocal: string): XmlElement | null {
  const target = targetLocal.toLowerCase();
  const children = elementChildren(node);
  for (const child of children) {
    if (localNameOf(child.nodeName).toLowerCase() === target) return child;
  }
  return null;
}

function childrenByLocalName(node: Node | null | undefined, targetLocal: string): XmlElement[] {
  const target = targetLocal.toLowerCase();
  return elementChildren(node).filter((child) => localNameOf(child.nodeName).toLowerCase() === target);
}

function attributeByLocalName(node: XmlElement | null | undefined, targetLocal: string): string | null {
  if (!node || !node.attributes) return null;
  const target = targetLocal.toLowerCase();
  for (let i = 0; i < node.attributes.length; i += 1) {
    const attr = node.attributes.item(i);
    if (!attr) continue;
    if (localNameOf(attr.name).toLowerCase() === target) {
      const value = String(attr.value ?? "").trim();
      return value || null;
    }
  }
  return null;
}

function setAttributeKeepingNamespace(node: XmlElement, qualifiedName: string, value: string) {
  try {
    node.setAttribute(qualifiedName, value);
  } catch {
    node.setAttribute(localNameOf(qualifiedName), value);
  }
}

function boolFromWordValue(value: string | null | undefined, defaultValue = true): boolean {
  if (value == null || value === "") return defaultValue;
  const raw = String(value).trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "none") return false;
  return true;
}

function normalizeHexColor(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return raw.slice(2).toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.slice(1).toUpperCase();
  if (/^#[0-9a-fA-F]{8}$/.test(raw)) return raw.slice(3).toUpperCase();
  return null;
}

function parseXml(xmlText: string): XmlDocument {
  return new DOMParser({
    errorHandler: {
      warning() {
        // ignore
      },
      error(message) {
        throw new Error(String(message || "Invalid XML"));
      },
      fatalError(message) {
        throw new Error(String(message || "Invalid XML"));
      }
    }
  }).parseFromString(xmlText, "text/xml");
}

function serializeXml(doc: XmlDocument): string {
  return new XMLSerializer().serializeToString(doc);
}

function shouldPreserveXmlSpace(text: string) {
  return /^\s/.test(text) || /\s$/.test(text) || /  /.test(text);
}

function splitTextWithNewlines(text: string) {
  return String(text ?? "").split("\n");
}

function parseDocxRunStyle(runNode: XmlElement): RichTextStyle | undefined {
  const rPr = firstChildByLocalName(runNode, "rPr");
  if (!rPr) return undefined;
  const style: RichTextStyle = {};

  const rFonts = firstChildByLocalName(rPr, "rFonts");
  const fontFamily =
    attributeByLocalName(rFonts, "ascii") ??
    attributeByLocalName(rFonts, "hAnsi") ??
    attributeByLocalName(rFonts, "cs") ??
    attributeByLocalName(rFonts, "eastAsia");
  if (fontFamily) style.fontFamily = fontFamily;

  const size = attributeByLocalName(firstChildByLocalName(rPr, "sz"), "val");
  if (size) {
    const halfPoints = Number(size);
    if (Number.isFinite(halfPoints) && halfPoints > 0) {
      style.fontSizePt = Math.round((halfPoints / 2) * 100) / 100;
    }
  }

  const boldNode = firstChildByLocalName(rPr, "b");
  if (boldNode) {
    style.bold = boolFromWordValue(attributeByLocalName(boldNode, "val"), true);
  }

  const italicNode = firstChildByLocalName(rPr, "i");
  if (italicNode) {
    style.italic = boolFromWordValue(attributeByLocalName(italicNode, "val"), true);
  }

  const underlineNode = firstChildByLocalName(rPr, "u");
  if (underlineNode) {
    const uVal = attributeByLocalName(underlineNode, "val");
    style.underline = boolFromWordValue(uVal, true) && String(uVal ?? "").toLowerCase() !== "none";
  }

  const colorNode = firstChildByLocalName(rPr, "color");
  const color = normalizeHexColor(attributeByLocalName(colorNode, "val"));
  if (color) style.color = color;

  return normalizeRichTextStyle(style);
}

function parseDocxRunText(runNode: XmlElement): string {
  const parts: string[] = [];
  for (const child of elementChildren(runNode)) {
    const local = localNameOf(child.nodeName).toLowerCase();
    if (local === "t" || local === "instrtext" || local === "deltext") {
      parts.push(String(child.textContent ?? ""));
      continue;
    }
    if (local === "tab") {
      parts.push("\t");
      continue;
    }
    if (local === "br" || local === "cr") {
      parts.push("\n");
      continue;
    }
  }
  return parts.join("");
}

function collectDocxRunsFromNode(node: Node, output: RichTextRun[]) {
  for (const child of elementChildren(node)) {
    const local = localNameOf(child.nodeName).toLowerCase();
    if (local === "r") {
      const text = parseDocxRunText(child);
      if (!text) continue;
      const style = parseDocxRunStyle(child);
      output.push({
        text,
        ...(style ? { style } : {})
      });
      continue;
    }
    if (local === "br" || local === "cr") {
      output.push({ text: "\n" });
      continue;
    }
    if (local === "tab") {
      output.push({ text: "\t" });
      continue;
    }
    if (
      local === "hyperlink" ||
      local === "smarttag" ||
      local === "sdt" ||
      local === "fldsimple" ||
      local === "ins" ||
      local === "del" ||
      local === "prooferr"
    ) {
      collectDocxRunsFromNode(child, output);
      continue;
    }
  }
}

function parseDocxParagraphRuns(paragraphNode: XmlElement): RichTextRun[] {
  const runs: RichTextRun[] = [];
  collectDocxRunsFromNode(paragraphNode, runs);
  return mergeAdjacentRuns(normalizeRichTextRuns(runs, ""));
}

function parseDocxParagraphContext(paragraphNode: XmlElement, paragraphIndex: number): SegmentContainerContext {
  const pPr = firstChildByLocalName(paragraphNode, "pPr");
  const pStyle = firstChildByLocalName(pPr, "pStyle");
  const numPr = firstChildByLocalName(pPr, "numPr");
  const ilvlNode = firstChildByLocalName(numPr, "ilvl");
  const numIdNode = firstChildByLocalName(numPr, "numId");

  const context: SegmentContainerContext = {
    fileType: "docx",
    partPath: "word/document.xml",
    paragraphIndex
  };

  const styleId = attributeByLocalName(pStyle, "val");
  if (styleId) context.paragraphStyleId = styleId;
  const ilvl = attributeByLocalName(ilvlNode, "val");
  if (ilvl != null) context.listLevel = Number.isFinite(Number(ilvl)) ? Number(ilvl) : ilvl;
  const numId = attributeByLocalName(numIdNode, "val");
  if (numId != null) context.listNumId = Number.isFinite(Number(numId)) ? Number(numId) : numId;

  return context;
}

function parseDocxSegments(buffer: Buffer): OfficeRichSegment[] {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return [];
  const xml = zip.readAsText(entry, "utf8");
  const doc = parseXml(xml);
  const paragraphNodes = Array.from(doc.getElementsByTagName("w:p")) as XmlElement[];
  const segments: OfficeRichSegment[] = [];

  for (let i = 0; i < paragraphNodes.length; i += 1) {
    const paragraph = paragraphNodes[i]!;
    const runs = parseDocxParagraphRuns(paragraph);
    const text = runsToPlainText(runs);
    if (!text.trim()) continue;
    segments.push({
      src: text,
      srcRuns: runs,
      segmentContext: parseDocxParagraphContext(paragraph, i)
    });
  }

  return segments;
}

function parsePptxRunStyle(runNode: XmlElement): RichTextStyle | undefined {
  const rPr = firstChildByLocalName(runNode, "rPr") ?? runNode;
  const style: RichTextStyle = {};

  const fontSizeRaw = attributeByLocalName(rPr, "sz");
  if (fontSizeRaw) {
    const hundredthPt = Number(fontSizeRaw);
    if (Number.isFinite(hundredthPt) && hundredthPt > 0) {
      style.fontSizePt = Math.round((hundredthPt / 100) * 100) / 100;
    }
  }

  const boldRaw = attributeByLocalName(rPr, "b");
  if (boldRaw != null) style.bold = boolFromWordValue(boldRaw, false);
  const italicRaw = attributeByLocalName(rPr, "i");
  if (italicRaw != null) style.italic = boolFromWordValue(italicRaw, false);
  const underlineRaw = attributeByLocalName(rPr, "u");
  if (underlineRaw != null) {
    style.underline = String(underlineRaw).toLowerCase() !== "none";
  }

  const latin = firstChildByLocalName(rPr, "latin");
  const typeface = attributeByLocalName(latin, "typeface");
  if (typeface) style.fontFamily = typeface;

  const solidFill = firstChildByLocalName(rPr, "solidFill");
  const srgb = firstChildByLocalName(solidFill, "srgbClr");
  const color = normalizeHexColor(attributeByLocalName(srgb, "val"));
  if (color) style.color = color;

  return normalizeRichTextStyle(style);
}

function parsePptxParagraphRuns(paragraphNode: XmlElement): RichTextRun[] {
  const runs: RichTextRun[] = [];
  for (const child of elementChildren(paragraphNode)) {
    const local = localNameOf(child.nodeName).toLowerCase();
    if (local === "r") {
      const text = String(firstChildByLocalName(child, "t")?.textContent ?? "");
      if (!text) continue;
      const style = parsePptxRunStyle(firstChildByLocalName(child, "rPr") ?? child);
      runs.push({
        text,
        ...(style ? { style } : {})
      });
      continue;
    }
    if (local === "fld") {
      const text = String(firstChildByLocalName(child, "t")?.textContent ?? "");
      if (!text) continue;
      const style = parsePptxRunStyle(firstChildByLocalName(child, "rPr") ?? child);
      runs.push({
        text,
        ...(style ? { style } : {})
      });
      continue;
    }
    if (local === "br") {
      runs.push({ text: "\n" });
      continue;
    }
  }

  return mergeAdjacentRuns(normalizeRichTextRuns(runs, ""));
}

function parsePptxSegments(buffer: Buffer): OfficeRichSegment[] {
  const zip = new AdmZip(buffer);
  const slideEntries = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((entryName) => /^ppt\/slides\/slide\d+\.xml$/i.test(entryName))
    .sort((a, b) => {
      const aNum = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const bNum = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return aNum - bNum;
    });

  const segments: OfficeRichSegment[] = [];

  for (let slideIndex = 0; slideIndex < slideEntries.length; slideIndex += 1) {
    const slidePath = slideEntries[slideIndex]!;
    const slideEntry = zip.getEntry(slidePath);
    if (!slideEntry) continue;
    const doc = parseXml(zip.readAsText(slideEntry, "utf8"));
    const shapes = Array.from(doc.getElementsByTagName("p:sp")) as XmlElement[];

    let shapeOrdinal = 0;
    for (const shape of shapes) {
      const txBody = firstChildByLocalName(shape, "txBody");
      if (!txBody) continue;
      const paragraphs = childrenByLocalName(txBody, "p");
      const shapeId = attributeByLocalName(firstChildByLocalName(firstChildByLocalName(shape, "nvSpPr"), "cNvPr"), "id");

      for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
        const paragraph = paragraphs[paragraphIndex]!;
        const runs = parsePptxParagraphRuns(paragraph);
        const text = runsToPlainText(runs);
        if (!text.trim()) continue;
        const pPr = firstChildByLocalName(paragraph, "pPr");
        const alignment = attributeByLocalName(pPr, "algn");
        const bullet = firstChildByLocalName(pPr, "buChar") != null || firstChildByLocalName(pPr, "buAutoNum") != null;
        segments.push({
          src: text,
          srcRuns: runs,
          segmentContext: {
            fileType: "pptx",
            partPath: slidePath,
            slideIndex,
            shapeIndex: shapeOrdinal,
            paragraphIndex,
            shapeId: shapeId ?? null,
            alignment: alignment ?? null,
            bullet
          }
        });
      }
      shapeOrdinal += 1;
    }
  }

  return segments;
}

type XlsxCellFont = RichTextStyle & {
  numberFormat?: string | null;
  wrapText?: boolean | null;
  alignment?: string | null;
};

type XlsxSharedStringEntry = {
  text: string;
  runs: RichTextRun[];
  richText: boolean;
};

function parseXlsxRunStyleFromRPr(rPr: XmlElement | null | undefined): RichTextStyle | undefined {
  if (!rPr) return undefined;
  const style: RichTextStyle = {};

  const fontName = attributeByLocalName(firstChildByLocalName(rPr, "rFont"), "val");
  if (fontName) style.fontFamily = fontName;

  const fontSize = attributeByLocalName(firstChildByLocalName(rPr, "sz"), "val");
  if (fontSize != null) {
    const parsed = Number(fontSize);
    if (Number.isFinite(parsed) && parsed > 0) style.fontSizePt = parsed;
  }

  if (firstChildByLocalName(rPr, "b")) style.bold = true;
  if (firstChildByLocalName(rPr, "i")) style.italic = true;
  if (firstChildByLocalName(rPr, "u")) style.underline = true;

  const colorRaw =
    attributeByLocalName(firstChildByLocalName(rPr, "color"), "rgb") ??
    attributeByLocalName(firstChildByLocalName(rPr, "color"), "indexed");
  const color = normalizeHexColor(colorRaw);
  if (color) style.color = color;

  return normalizeRichTextStyle(style);
}

function parseXlsxFontStyle(fontNode: XmlElement | null | undefined): RichTextStyle | undefined {
  if (!fontNode) return undefined;
  const style: RichTextStyle = {};
  const name = attributeByLocalName(firstChildByLocalName(fontNode, "name"), "val");
  if (name) style.fontFamily = name;
  const size = attributeByLocalName(firstChildByLocalName(fontNode, "sz"), "val");
  if (size != null) {
    const parsed = Number(size);
    if (Number.isFinite(parsed) && parsed > 0) style.fontSizePt = parsed;
  }
  if (firstChildByLocalName(fontNode, "b")) style.bold = true;
  if (firstChildByLocalName(fontNode, "i")) style.italic = true;
  if (firstChildByLocalName(fontNode, "u")) style.underline = true;
  const color = normalizeHexColor(attributeByLocalName(firstChildByLocalName(fontNode, "color"), "rgb"));
  if (color) style.color = color;
  return normalizeRichTextStyle(style);
}

function parseSharedStrings(doc: XmlDocument): XlsxSharedStringEntry[] {
  const sis = Array.from(doc.getElementsByTagName("si")) as XmlElement[];
  const out: XlsxSharedStringEntry[] = [];
  for (const si of sis) {
    const richRuns = childrenByLocalName(si, "r");
    if (richRuns.length > 0) {
      const runs: RichTextRun[] = [];
      for (const run of richRuns) {
        const text = String(firstChildByLocalName(run, "t")?.textContent ?? "");
        if (!text) continue;
        const style = parseXlsxRunStyleFromRPr(firstChildByLocalName(run, "rPr"));
        runs.push({
          text,
          ...(style ? { style } : {})
        });
      }
      const normalized = mergeAdjacentRuns(normalizeRichTextRuns(runs, ""));
      out.push({
        text: runsToPlainText(normalized),
        runs: normalized,
        richText: true
      });
      continue;
    }

    const text = String(firstChildByLocalName(si, "t")?.textContent ?? "");
    out.push({
      text,
      runs: text ? [{ text }] : [],
      richText: false
    });
  }
  return out;
}

function parseXlsxCellRunsFromInlineString(isNode: XmlElement | null | undefined): RichTextRun[] {
  if (!isNode) return [];
  const richRuns = childrenByLocalName(isNode, "r");
  if (richRuns.length > 0) {
    const runs: RichTextRun[] = [];
    for (const run of richRuns) {
      const text = String(firstChildByLocalName(run, "t")?.textContent ?? "");
      if (!text) continue;
      const style = parseXlsxRunStyleFromRPr(firstChildByLocalName(run, "rPr"));
      runs.push({
        text,
        ...(style ? { style } : {})
      });
    }
    return mergeAdjacentRuns(normalizeRichTextRuns(runs, ""));
  }
  const text = String(firstChildByLocalName(isNode, "t")?.textContent ?? "");
  return text ? [{ text }] : [];
}

function resolveWorkbookRelationships(zip: AdmZip): Map<string, string> {
  const relMap = new Map<string, string>();
  const relEntry = zip.getEntry("xl/_rels/workbook.xml.rels");
  if (!relEntry) return relMap;
  const relDoc = parseXml(zip.readAsText(relEntry, "utf8"));
  const rels = Array.from(relDoc.getElementsByTagName("Relationship")) as XmlElement[];
  for (const rel of rels) {
    const id = attributeByLocalName(rel, "id");
    const target = attributeByLocalName(rel, "target");
    if (!id || !target) continue;
    const normalizedTarget = target.startsWith("/")
      ? target.replace(/^\/+/, "")
      : target.startsWith("xl/")
      ? target
      : `xl/${target.replace(/^\.?\//, "")}`;
    relMap.set(id, normalizedTarget);
  }
  return relMap;
}

function parseXlsxStyles(zip: AdmZip): { cellStyles: XlsxCellFont[] } {
  const styleEntry = zip.getEntry("xl/styles.xml");
  if (!styleEntry) return { cellStyles: [] };
  const styleDoc = parseXml(zip.readAsText(styleEntry, "utf8"));

  const numFmtById = new Map<number, string>();
  const numFmtsNode = firstChildByLocalName(styleDoc.documentElement, "numFmts");
  if (numFmtsNode) {
    for (const numFmt of childrenByLocalName(numFmtsNode, "numFmt")) {
      const idRaw = attributeByLocalName(numFmt, "numFmtId");
      const code = attributeByLocalName(numFmt, "formatCode");
      const id = Number(idRaw);
      if (!Number.isFinite(id) || !code) continue;
      numFmtById.set(id, code);
    }
  }

  const fontsNode = firstChildByLocalName(styleDoc.documentElement, "fonts");
  const fonts = fontsNode ? childrenByLocalName(fontsNode, "font").map((font) => parseXlsxFontStyle(font)) : [];

  const cellStyles: XlsxCellFont[] = [];
  const cellXfs = firstChildByLocalName(styleDoc.documentElement, "cellXfs");
  if (cellXfs) {
    for (const xf of childrenByLocalName(cellXfs, "xf")) {
      const fontIdRaw = attributeByLocalName(xf, "fontId");
      const fontId = Number(fontIdRaw);
      const style = Number.isFinite(fontId) && fontId >= 0 ? fonts[fontId] : undefined;
      const numFmtId = Number(attributeByLocalName(xf, "numFmtId"));
      const alignmentNode = firstChildByLocalName(xf, "alignment");
      const horizontal = attributeByLocalName(alignmentNode, "horizontal");
      const vertical = attributeByLocalName(alignmentNode, "vertical");
      const wrapText = boolFromWordValue(attributeByLocalName(alignmentNode, "wrapText"), false);
      const alignment = horizontal && vertical ? `${horizontal}/${vertical}` : horizontal ?? vertical ?? null;
      cellStyles.push({
        ...(style ? style : {}),
        numberFormat: Number.isFinite(numFmtId) ? numFmtById.get(numFmtId) ?? `numFmt:${numFmtId}` : null,
        wrapText: alignmentNode ? wrapText : null,
        alignment
      });
    }
  }

  return { cellStyles };
}

function isNumericLike(value: string) {
  return /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value.trim());
}

function parseXlsxSegments(buffer: Buffer): OfficeRichSegment[] {
  const zip = new AdmZip(buffer);
  const workbookEntry = zip.getEntry("xl/workbook.xml");
  if (!workbookEntry) return [];

  const workbookDoc = parseXml(zip.readAsText(workbookEntry, "utf8"));
  const sheetNodes = Array.from(workbookDoc.getElementsByTagName("sheet")) as XmlElement[];
  const relMap = resolveWorkbookRelationships(zip);
  const sharedStringsEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry ? parseSharedStrings(parseXml(zip.readAsText(sharedStringsEntry, "utf8"))) : [];
  const styles = parseXlsxStyles(zip);

  const segments: OfficeRichSegment[] = [];

  for (const sheetNode of sheetNodes) {
    const sheetName = attributeByLocalName(sheetNode, "name") ?? "";
    const relId = attributeByLocalName(sheetNode, "id");
    if (!relId) continue;
    const sheetPath = relMap.get(relId);
    if (!sheetPath) continue;
    const sheetEntry = zip.getEntry(sheetPath);
    if (!sheetEntry) continue;

    const sheetDoc = parseXml(zip.readAsText(sheetEntry, "utf8"));
    const cells = Array.from(sheetDoc.getElementsByTagName("c")) as XmlElement[];
    for (const cell of cells) {
      const hasFormula = firstChildByLocalName(cell, "f") != null;
      if (hasFormula) continue;

      const ref = attributeByLocalName(cell, "r");
      if (!ref) continue;

      const cellType = attributeByLocalName(cell, "t");
      const styleIdRaw = attributeByLocalName(cell, "s");
      const styleId = Number(styleIdRaw);
      const cellStyle = Number.isFinite(styleId) && styleId >= 0 ? styles.cellStyles[styleId] : undefined;

      let text = "";
      let runs: RichTextRun[] = [];
      let richText = false;

      if (cellType === "s") {
        const indexRaw = String(firstChildByLocalName(cell, "v")?.textContent ?? "").trim();
        const index = Number(indexRaw);
        if (!Number.isFinite(index) || index < 0 || index >= sharedStrings.length) continue;
        const entry = sharedStrings[index]!;
        text = entry.text;
        runs = normalizeRichTextRuns(entry.runs, text);
        richText = entry.richText;
      } else if (cellType === "inlineStr") {
        runs = parseXlsxCellRunsFromInlineString(firstChildByLocalName(cell, "is"));
        text = runsToPlainText(runs);
        richText = runs.length > 1;
      } else if (cellType === "str") {
        text = String(firstChildByLocalName(cell, "v")?.textContent ?? "");
        runs = text ? [{ text }] : [];
      } else if (!cellType || cellType === "n") {
        const raw = String(firstChildByLocalName(cell, "v")?.textContent ?? "");
        if (!raw.trim() || isNumericLike(raw)) continue;
        text = raw;
        runs = text ? [{ text }] : [];
      } else {
        continue;
      }

      if (!text.trim()) continue;
      if (runs.length === 0 && text) runs = [{ text }];

      if (!richText && cellStyle) {
        runs = runs.map((run) => ({
          ...run,
          style: normalizeRichTextStyle(run.style ?? cellStyle)
        }));
      }

      segments.push({
        src: text,
        srcRuns: mergeAdjacentRuns(normalizeRichTextRuns(runs, text)),
        segmentContext: {
          fileType: "xlsx",
          partPath: sheetPath,
          sheetName,
          cellRef: ref,
          styleId: Number.isFinite(styleId) ? styleId : null,
          numberFormat: cellStyle?.numberFormat ?? null,
          wrapText: cellStyle?.wrapText ?? null,
          alignment: cellStyle?.alignment ?? null,
          richText
        }
      });
    }
  }

  return segments;
}

function appendDocxRuns(paragraphNode: XmlElement, runs: RichTextRun[], doc: XmlDocument) {
  const pPr = firstChildByLocalName(paragraphNode, "pPr");
  while (paragraphNode.firstChild) {
    paragraphNode.removeChild(paragraphNode.firstChild);
  }
  if (pPr) paragraphNode.appendChild(pPr);

  const safeRuns = runs.length > 0 ? runs : [{ text: "" }];
  for (const run of safeRuns) {
    const normalizedStyle = normalizeRichTextStyle(run.style);
    const chunks = splitTextWithNewlines(String(run.text ?? ""));
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      if (chunk.length > 0 || (chunks.length === 1 && i === 0)) {
        const runNode = doc.createElement("w:r");
        if (normalizedStyle) {
          const rPr = doc.createElement("w:rPr");
          if (normalizedStyle.fontFamily) {
            const rFonts = doc.createElement("w:rFonts");
            setAttributeKeepingNamespace(rFonts, "w:ascii", normalizedStyle.fontFamily);
            setAttributeKeepingNamespace(rFonts, "w:hAnsi", normalizedStyle.fontFamily);
            rPr.appendChild(rFonts);
          }
          if (normalizedStyle.fontSizePt != null) {
            const halfPoints = Math.max(1, Math.round(normalizedStyle.fontSizePt * 2));
            const sz = doc.createElement("w:sz");
            setAttributeKeepingNamespace(sz, "w:val", String(halfPoints));
            rPr.appendChild(sz);
            const szCs = doc.createElement("w:szCs");
            setAttributeKeepingNamespace(szCs, "w:val", String(halfPoints));
            rPr.appendChild(szCs);
          }
          if (normalizedStyle.bold) rPr.appendChild(doc.createElement("w:b"));
          if (normalizedStyle.italic) rPr.appendChild(doc.createElement("w:i"));
          if (normalizedStyle.underline) {
            const u = doc.createElement("w:u");
            setAttributeKeepingNamespace(u, "w:val", "single");
            rPr.appendChild(u);
          }
          if (normalizedStyle.color) {
            const color = doc.createElement("w:color");
            setAttributeKeepingNamespace(color, "w:val", normalizedStyle.color);
            rPr.appendChild(color);
          }
          if (rPr.childNodes.length > 0) runNode.appendChild(rPr);
        }

        const t = doc.createElement("w:t");
        if (shouldPreserveXmlSpace(chunk)) {
          setAttributeKeepingNamespace(t, "xml:space", "preserve");
        }
        t.appendChild(doc.createTextNode(chunk));
        runNode.appendChild(t);
        paragraphNode.appendChild(runNode);
      }
      if (i < chunks.length - 1) {
        const breakRun = doc.createElement("w:r");
        const br = doc.createElement("w:br");
        breakRun.appendChild(br);
        paragraphNode.appendChild(breakRun);
      }
    }
  }
}

function appendPptxRuns(paragraphNode: XmlElement, runs: RichTextRun[], doc: XmlDocument) {
  const pPr = firstChildByLocalName(paragraphNode, "pPr");
  const endParaRPr = firstChildByLocalName(paragraphNode, "endParaRPr");
  while (paragraphNode.firstChild) {
    paragraphNode.removeChild(paragraphNode.firstChild);
  }
  if (pPr) paragraphNode.appendChild(pPr);

  const safeRuns = runs.length > 0 ? runs : [{ text: "" }];
  for (const run of safeRuns) {
    const style = normalizeRichTextStyle(run.style);
    const chunks = splitTextWithNewlines(String(run.text ?? ""));
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      if (chunk.length > 0 || (chunks.length === 1 && i === 0)) {
        const runNode = doc.createElement("a:r");
        const rPr = doc.createElement("a:rPr");
        if (style?.fontSizePt != null) {
          setAttributeKeepingNamespace(rPr, "sz", String(Math.max(1, Math.round(style.fontSizePt * 100))));
        }
        if (style?.bold) setAttributeKeepingNamespace(rPr, "b", "1");
        if (style?.italic) setAttributeKeepingNamespace(rPr, "i", "1");
        if (style?.underline) setAttributeKeepingNamespace(rPr, "u", "sng");
        if (style?.fontFamily) {
          const latin = doc.createElement("a:latin");
          setAttributeKeepingNamespace(latin, "typeface", style.fontFamily);
          rPr.appendChild(latin);
        }
        if (style?.color) {
          const solidFill = doc.createElement("a:solidFill");
          const srgb = doc.createElement("a:srgbClr");
          setAttributeKeepingNamespace(srgb, "val", style.color);
          solidFill.appendChild(srgb);
          rPr.appendChild(solidFill);
        }
        runNode.appendChild(rPr);
        const t = doc.createElement("a:t");
        if (shouldPreserveXmlSpace(chunk)) setAttributeKeepingNamespace(t, "xml:space", "preserve");
        t.appendChild(doc.createTextNode(chunk));
        runNode.appendChild(t);
        paragraphNode.appendChild(runNode);
      }
      if (i < chunks.length - 1) {
        paragraphNode.appendChild(doc.createElement("a:br"));
      }
    }
  }

  if (endParaRPr) paragraphNode.appendChild(endParaRPr);
}

function appendXlsxRunsToInlineString(cellNode: XmlElement, runs: RichTextRun[], doc: XmlDocument) {
  while (cellNode.firstChild) {
    cellNode.removeChild(cellNode.firstChild);
  }
  setAttributeKeepingNamespace(cellNode, "t", "inlineStr");
  const isNode = doc.createElement("is");
  const safeRuns = runs.length > 0 ? runs : [{ text: "" }];
  for (const run of safeRuns) {
    const style = normalizeRichTextStyle(run.style);
    const text = String(run.text ?? "");
    if (!style || Object.keys(style).length === 0) {
      const t = doc.createElement("t");
      if (shouldPreserveXmlSpace(text)) setAttributeKeepingNamespace(t, "xml:space", "preserve");
      t.appendChild(doc.createTextNode(text));
      isNode.appendChild(t);
      continue;
    }

    const r = doc.createElement("r");
    const rPr = doc.createElement("rPr");
    if (style.fontFamily) {
      const rFont = doc.createElement("rFont");
      setAttributeKeepingNamespace(rFont, "val", style.fontFamily);
      rPr.appendChild(rFont);
    }
    if (style.fontSizePt != null) {
      const sz = doc.createElement("sz");
      setAttributeKeepingNamespace(sz, "val", String(style.fontSizePt));
      rPr.appendChild(sz);
    }
    if (style.bold) rPr.appendChild(doc.createElement("b"));
    if (style.italic) rPr.appendChild(doc.createElement("i"));
    if (style.underline) rPr.appendChild(doc.createElement("u"));
    if (style.color) {
      const color = doc.createElement("color");
      setAttributeKeepingNamespace(color, "rgb", `FF${style.color}`);
      rPr.appendChild(color);
    }
    r.appendChild(rPr);

    const t = doc.createElement("t");
    if (shouldPreserveXmlSpace(text)) setAttributeKeepingNamespace(t, "xml:space", "preserve");
    t.appendChild(doc.createTextNode(text));
    r.appendChild(t);
    isNode.appendChild(r);
  }
  cellNode.appendChild(isNode);
}

function collectFontsFromRuns(runs: RichTextRun[]): string[] {
  const fonts = new Set<string>();
  for (const run of runs) {
    const family = String(run.style?.fontFamily ?? "").trim();
    if (family) fonts.add(family);
  }
  return Array.from(fonts.values());
}

function resolveSegmentOutputRuns(segment: OfficeRichSegment): RichTextRun[] | null {
  const tgt = String(segment.tgt ?? "");
  if (!tgt.trim()) return null;
  const sourceRuns = normalizeRichTextRuns(segment.srcRuns, segment.src ?? "");
  const targetRuns = Array.isArray(segment.tgtRuns) ? normalizeRichTextRuns(segment.tgtRuns, tgt) : [];
  if (targetRuns.length > 0 && runsToPlainText(targetRuns) === tgt) {
    return targetRuns;
  }
  const projected = projectTextToTemplateRuns({
    text: tgt,
    templateRuns: targetRuns.length > 0 ? targetRuns : sourceRuns,
    fallbackRuns: sourceRuns
  });
  if (projected.length > 0) return projected;
  const dominant = dominantRunStyle(sourceRuns);
  return [{ text: tgt, ...(dominant ? { style: dominant } : {}) }];
}

function updateDocxZipWithSegments(zip: AdmZip, segments: OfficeRichSegment[]) {
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return { warnings: ["DOCX source does not contain word/document.xml."], fonts: [] as string[] };
  const doc = parseXml(zip.readAsText(entry, "utf8"));
  const paragraphs = Array.from(doc.getElementsByTagName("w:p")) as XmlElement[];
  const fonts = new Set<string>();

  for (const segment of segments) {
    const ctx = segment.segmentContext ?? {};
    if (String(ctx.fileType ?? "").toLowerCase() !== "docx") continue;
    const paragraphIndex = Number(ctx.paragraphIndex);
    if (!Number.isFinite(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= paragraphs.length) continue;
    const runs = resolveSegmentOutputRuns(segment);
    if (!runs) continue;
    collectFontsFromRuns(runs).forEach((font) => fonts.add(font));
    appendDocxRuns(paragraphs[paragraphIndex]!, runs, doc);
  }

  zip.updateFile("word/document.xml", Buffer.from(serializeXml(doc), "utf8"));
  return { warnings: [] as string[], fonts: Array.from(fonts.values()) };
}

function updatePptxZipWithSegments(zip: AdmZip, segments: OfficeRichSegment[]) {
  const bySlide = new Map<string, OfficeRichSegment[]>();
  for (const segment of segments) {
    const ctx = segment.segmentContext ?? {};
    if (String(ctx.fileType ?? "").toLowerCase() !== "pptx") continue;
    const path = String(ctx.partPath ?? "").trim();
    if (!path) continue;
    const list = bySlide.get(path) ?? [];
    list.push(segment);
    bySlide.set(path, list);
  }

  const warnings: string[] = [];
  const fonts = new Set<string>();

  for (const [slidePath, slideSegments] of bySlide.entries()) {
    const entry = zip.getEntry(slidePath);
    if (!entry) {
      warnings.push(`Missing PPTX slide part: ${slidePath}`);
      continue;
    }
    const doc = parseXml(zip.readAsText(entry, "utf8"));
    const shapes = Array.from(doc.getElementsByTagName("p:sp")) as XmlElement[];
    const byShapeParagraph = new Map<string, OfficeRichSegment>();
    for (const segment of slideSegments) {
      const ctx = segment.segmentContext ?? {};
      const shapeIndex = Number(ctx.shapeIndex);
      const paragraphIndex = Number(ctx.paragraphIndex);
      if (!Number.isFinite(shapeIndex) || !Number.isFinite(paragraphIndex)) continue;
      byShapeParagraph.set(`${shapeIndex}:${paragraphIndex}`, segment);
    }

    let shapeOrdinal = 0;
    for (const shape of shapes) {
      const txBody = firstChildByLocalName(shape, "txBody");
      if (!txBody) continue;
      const paragraphs = childrenByLocalName(txBody, "p");
      for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
        const segment = byShapeParagraph.get(`${shapeOrdinal}:${paragraphIndex}`);
        if (!segment) continue;
        const runs = resolveSegmentOutputRuns(segment);
        if (!runs) continue;
        collectFontsFromRuns(runs).forEach((font) => fonts.add(font));
        appendPptxRuns(paragraphs[paragraphIndex]!, runs, doc);
      }
      shapeOrdinal += 1;
    }

    zip.updateFile(slidePath, Buffer.from(serializeXml(doc), "utf8"));
  }

  return { warnings, fonts: Array.from(fonts.values()) };
}

function updateXlsxZipWithSegments(zip: AdmZip, segments: OfficeRichSegment[]) {
  const bySheet = new Map<string, OfficeRichSegment[]>();
  for (const segment of segments) {
    const ctx = segment.segmentContext ?? {};
    if (String(ctx.fileType ?? "").toLowerCase() !== "xlsx") continue;
    const path = String(ctx.partPath ?? "").trim();
    if (!path) continue;
    const list = bySheet.get(path) ?? [];
    list.push(segment);
    bySheet.set(path, list);
  }

  const warnings: string[] = [];
  const fonts = new Set<string>();

  for (const [sheetPath, sheetSegments] of bySheet.entries()) {
    const entry = zip.getEntry(sheetPath);
    if (!entry) {
      warnings.push(`Missing XLSX worksheet part: ${sheetPath}`);
      continue;
    }
    const doc = parseXml(zip.readAsText(entry, "utf8"));
    const cells = Array.from(doc.getElementsByTagName("c")) as XmlElement[];
    const byRef = new Map<string, OfficeRichSegment>();
    for (const segment of sheetSegments) {
      const ref = String(segment.segmentContext?.cellRef ?? "").trim();
      if (!ref) continue;
      byRef.set(ref, segment);
    }

    for (const cell of cells) {
      const ref = attributeByLocalName(cell, "r");
      if (!ref) continue;
      const segment = byRef.get(ref);
      if (!segment) continue;
      const runs = resolveSegmentOutputRuns(segment);
      if (!runs) continue;
      collectFontsFromRuns(runs).forEach((font) => fonts.add(font));
      appendXlsxRunsToInlineString(cell, runs, doc);
    }

    zip.updateFile(sheetPath, Buffer.from(serializeXml(doc), "utf8"));
  }

  return { warnings, fonts: Array.from(fonts.values()) };
}

export function parseOfficeRichSegments(params: {
  buffer: Buffer;
  fileType: OfficeFileType;
}): { segments: OfficeRichSegment[]; warnings: string[] } {
  try {
    if (params.fileType === "docx") {
      return { segments: parseDocxSegments(params.buffer), warnings: [] };
    }
    if (params.fileType === "pptx") {
      return { segments: parsePptxSegments(params.buffer), warnings: [] };
    }
    if (params.fileType === "xlsx") {
      return { segments: parseXlsxSegments(params.buffer), warnings: [] };
    }
    return { segments: [], warnings: ["Unsupported office type for rich parsing."] };
  } catch (err: any) {
    return {
      segments: [],
      warnings: [String(err?.message || "Failed to parse office rich segments.")]
    };
  }
}

export function rebuildOfficeFromRichSegments(params: {
  sourceBuffer: Buffer;
  fileType: OfficeFileType;
  segments: OfficeRichSegment[];
}): { buffer: Buffer; warnings: string[]; fontsUsed: string[] } {
  const zip = new AdmZip(params.sourceBuffer);
  if (params.fileType === "docx") {
    const updated = updateDocxZipWithSegments(zip, params.segments);
    return { buffer: zip.toBuffer(), warnings: updated.warnings, fontsUsed: updated.fonts };
  }
  if (params.fileType === "pptx") {
    const updated = updatePptxZipWithSegments(zip, params.segments);
    return { buffer: zip.toBuffer(), warnings: updated.warnings, fontsUsed: updated.fonts };
  }
  if (params.fileType === "xlsx") {
    const updated = updateXlsxZipWithSegments(zip, params.segments);
    return { buffer: zip.toBuffer(), warnings: updated.warnings, fontsUsed: updated.fonts };
  }
  return {
    buffer: params.sourceBuffer,
    warnings: ["Unsupported office type for rich export."],
    fontsUsed: []
  };
}
