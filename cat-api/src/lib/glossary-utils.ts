import { XMLParser } from "fast-xml-parser";
import fs from "fs";
import path from "path";
import { toIsoOrNull } from "../utils.js";
import { normalizeLanguageTag } from "./language-catalog.js";
import { LANGUAGE_NAME_MAP } from "./language-normalization.js";
import sax from "sax";
import { auditKeyFromAdminType, auditKindFromTransacType, hasAudit, mergeAudit, normalizeAuditValue } from "./glossary-utils.tbx.js";
import type { AuditMeta, TermAuditMap } from "./glossary-utils.tbx.js";
export { buildGlossaryTbx } from "./glossary-utils.tbx.js";
const tbxParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true, allowBooleanAttributes: true });

function decodeUtf16Be(buffer: Buffer): string {
  const evenLength = buffer.length - (buffer.length % 2);
  const swapped = Buffer.allocUnsafe(evenLength);
  for (let i = 0; i < evenLength; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString("utf16le");
}

export function decodeGlossaryBuffer(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) return "";
  if (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    if (b0 === 0xff && b1 === 0xfe) {
      return buffer.subarray(2).toString("utf16le");
    }
    if (b0 === 0xfe && b1 === 0xff) {
      return decodeUtf16Be(buffer.subarray(2));
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 4) {
    if (buffer[0] === 0x00 && buffer[1] === 0x3c && buffer[2] === 0x00 && buffer[3] === 0x3f) {
      return decodeUtf16Be(buffer);
    }
    if (buffer[0] === 0x3c && buffer[1] === 0x00 && buffer[2] === 0x3f && buffer[3] === 0x00) {
      return buffer.toString("utf16le");
    }
  }
  return buffer.toString("utf8");
}

export type ParsedGlossaryEntry = {
  term: string;
  translation: string;
  sourceLang?: string | null;
  targetLang?: string | null;
  sourceType?: string | null;
  origin?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  originAuthor?: string | null;
  originDate?: string | null;
  conceptId?: string | null;
  entryDescrips?: Record<string, string>;
  languageDescrips?: Record<string, Record<string, string>>;
  termDescrips?: Record<string, Record<string, Record<string, string>>>;
  entryAudit?: AuditMeta;
  termAudit?: Record<string, Record<string, AuditMeta>>;
};

export async function parseGlossaryFile(filePath: string): Promise<ParsedGlossaryEntry[]> {
  const data = await fs.promises.readFile(filePath);
  const text = decodeGlossaryBuffer(data);
  return parseGlossaryContent({ filename: filePath, data: text });
}

export function parseGlossaryContent(params: {
  filename?: string | null;
  data: string;
}): ParsedGlossaryEntry[] {
  const name = params.filename ? String(params.filename) : "";
  const ext = name ? path.extname(name).toLowerCase() : "";
  const trimmed = params.data.trim();
  if (ext === ".xml" || ext === ".tbx" || trimmed.startsWith("<")) {
    const preferStream = params.data.length > 5_000_000;
    if (preferStream) {
      return parseGlossaryXmlStream(params.data);
    }
    try {
      const doc = tbxParser.parse(params.data);
      return parseGlossaryXml(doc);
    } catch (err: any) {
      const message = String(err?.message || "");
      if (err instanceof RangeError || /call stack/i.test(message)) {
        return parseGlossaryXmlStream(params.data);
      }
      throw err;
    }
  }
  throw new Error("Unsupported glossary format");
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function readAttribute(node: Record<string, any>, keys: string[]): string | null {
  if (!node || typeof node !== "object") {
    return null;
  }
  for (const key of keys) {
    const raw = node[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function nodeText(value: any): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "object") {
    const raw =
      value["#text"] ??
      value["$text"] ??
      value.text ??
      value.value ??
      value._ ??
      null;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed.length ? trimmed : null;
    }
  }
  return null;
}

function collectConceptGroups(node: any): any[] {
  const groups: any[] = [];
  const stack: any[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if ((current as any).conceptGrp) {
      groups.push(...ensureArray((current as any).conceptGrp));
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          for (const item of value) stack.push(item);
        } else {
          stack.push(value);
        }
      }
    }
  }
  return groups;
}

function splitTermVariants(text: string): string[] {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const pipeSplit = trimmed.split("|");
  const orSplit = pipeSplit.flatMap((value) => value.split(/\s+or\s+/i));
  return orSplit.map((value) => value.trim()).filter(Boolean);
}

type ConceptContext = {
  conceptId: string | null;
  langTerms: Map<string, Set<string>>;
  entryDescrips: Record<string, string[]>;
  languageDescrips: Map<string, Record<string, string[]>>;
  termDescrips: Map<string, Map<string, Record<string, string[]>>>;
  entryAudit: AuditMeta;
  termAudit: Map<string, Map<string, AuditMeta>>;
};

type DescripListMap = Record<string, string[]>;
type DescripMap = Record<string, string>;
type LanguageDescripMap = Record<string, DescripMap>;
type TermDescripMap = Record<string, Record<string, DescripMap>>;

function addDescripValue(target: DescripListMap, rawType: string | null, rawValue: string | null) {
  const type = String(rawType ?? "").trim();
  const value = String(rawValue ?? "").trim();
  if (!type || !value) return;
  if (!target[type]) target[type] = [];
  target[type].push(value);
}

function mergeDescripLists(target: DescripListMap, source: DescripListMap) {
  Object.entries(source).forEach(([key, values]) => {
    if (!target[key]) target[key] = [];
    target[key].push(...values);
  });
}

function finalizeDescripMap(raw: DescripListMap): DescripMap {
  const out: DescripMap = {};
  Object.entries(raw).forEach(([key, values]) => {
    const cleaned = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    const unique = Array.from(new Set(cleaned));
    out[key] = unique.join("\n");
  });
  return out;
}

function finalizeLanguageDescrips(raw: Map<string, DescripListMap>): LanguageDescripMap {
  const out: LanguageDescripMap = {};
  raw.forEach((map, lang) => {
    const finalized = finalizeDescripMap(map);
    if (Object.keys(finalized).length > 0) out[lang] = finalized;
  });
  return out;
}

function finalizeTermDescrips(raw: Map<string, Map<string, DescripListMap>>): TermDescripMap {
  const out: TermDescripMap = {};
  raw.forEach((termMap, lang) => {
    termMap.forEach((descrips, term) => {
      const finalized = finalizeDescripMap(descrips);
      if (Object.keys(finalized).length === 0) return;
      if (!out[lang]) out[lang] = {};
      out[lang]![term] = finalized;
    });
  });
  return out;
}

function finalizeTermAudit(raw: Map<string, Map<string, AuditMeta>>): TermAuditMap {
  const out: TermAuditMap = {};
  raw.forEach((termMap, lang) => {
    termMap.forEach((audit, term) => {
      if (!hasAudit(audit)) return;
      if (!out[lang]) out[lang] = {};
      out[lang]![term] = audit;
    });
  });
  return out;
}

function readLangFromAttrs(attrs: Record<string, any> | undefined): string | null {
  if (!attrs || typeof attrs !== "object") return null;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const v = String(value ?? "").trim();
    if (!v) continue;
    values[key.toLowerCase()] = v;
  }
  return values["xml:lang"] || values.lang || values.type || null;
}

function readDescripTypeFromAttrs(attrs: Record<string, any> | undefined): string | null {
  if (!attrs || typeof attrs !== "object") return null;
  for (const [key, value] of Object.entries(attrs)) {
    if (key.toLowerCase() !== "type") continue;
    const raw = String(value ?? "").trim();
    if (raw) return raw;
  }
  return null;
}

function resolveLanguageGroupCode(group: any): string | null {
  if (!group || typeof group !== "object") return null;
  const rawLanguageNode = group.language || group.Language || {};
  const languageNode = Array.isArray(rawLanguageNode)
    ? rawLanguageNode[0]
    : rawLanguageNode;
  let langAttr: string | null = null;
  if (typeof languageNode === "string") {
    langAttr = languageNode.trim();
  } else {
    langAttr =
      readAttribute(languageNode, [
        "@_lang",
        "@_xml:lang",
        "@_type",
        "lang",
        "xml:lang",
        "type"
      ]) ?? null;
  }
  if (!langAttr) {
    langAttr =
      readAttribute(group, ["@_lang", "@_xml:lang", "@_type", "lang", "xml:lang", "type"]) ??
      null;
  }
  const code = langAttr ? normalizeLangCode(String(langAttr)) : null;
  return code || null;
}

function nodeTextDeep(value: any): string | null {
  const parts: string[] = [];
  const visit = (node: any) => {
    if (node == null) return;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      const str = String(node);
      if (str.trim()) parts.push(str);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "object") {
      const raw =
        node["#text"] ??
        node["$text"] ??
        node.text ??
        node.value ??
        node._ ??
        null;
      if (typeof raw === "string" && raw.trim()) parts.push(raw);
      Object.entries(node).forEach(([key, val]) => {
        if (key.startsWith("@_")) return;
        if (key === "#text" || key === "$text" || key === "text" || key === "value" || key === "_") return;
        visit(val);
      });
    }
  };
  visit(value);
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined || null;
}

function collectDescripListMap(container: any): DescripListMap {
  const result: DescripListMap = {};
  if (!container || typeof container !== "object") return result;

  const descripNodes: any[] = [];
  if ((container as any).descrip) {
    descripNodes.push(...ensureArray((container as any).descrip));
  }
  const descripGroups = ensureArray((container as any).descripGrp);
  descripGroups.forEach((group) => {
    if (!group || typeof group !== "object") return;
    if ((group as any).descrip) {
      descripNodes.push(...ensureArray((group as any).descrip));
    }
  });

  descripNodes.forEach((node) => {
    const type =
      typeof node === "object"
        ? readAttribute(node as Record<string, any>, ["@_type", "type", "@_Type", "Type"])
        : null;
    const value = nodeTextDeep(node);
    addDescripValue(result, type, value);
  });

  return result;
}

function collectTransacGroups(container: any): any[] {
  if (!container || typeof container !== "object") return [];
  const groups: any[] = [];
  if ((container as any).transacGrp) {
    groups.push(...ensureArray((container as any).transacGrp));
  }
  const systemNodes = ensureArray((container as any).system ?? (container as any).System ?? (container as any).systemGrp ?? (container as any).SystemGrp);
  systemNodes.forEach((node) => {
    if (!node || typeof node !== "object") return;
    if ((node as any).transacGrp) {
      groups.push(...ensureArray((node as any).transacGrp));
    }
  });
  return groups;
}

function extractAdminAudit(container: any): AuditMeta {
  const audit: AuditMeta = {};
  if (!container || typeof container !== "object") return audit;
  const adminNodes: any[] = [];
  if ((container as any).admin) {
    adminNodes.push(...ensureArray((container as any).admin));
  }
  const adminGroups = ensureArray(
    (container as any).adminGrp ??
      (container as any).adminGroup ??
      (container as any).AdminGrp ??
      (container as any).AdminGroup
  );
  adminGroups.forEach((group) => {
    if (!group || typeof group !== "object") return;
    if ((group as any).admin) {
      adminNodes.push(...ensureArray((group as any).admin));
    }
  });
  adminNodes.forEach((node) => {
    let typeRaw: string | null = null;
    let value: string | null = null;
    if (typeof node === "string") {
      value = node;
    } else if (node && typeof node === "object") {
      typeRaw = readAttribute(node as Record<string, any>, ["@_type", "type", "@_Type", "Type"]);
      value = nodeTextDeep(node);
    }
    const key = typeRaw ? auditKeyFromAdminType(typeRaw) : null;
    if (!key) return;
    const normalized = normalizeAuditValue(value);
    if (normalized) {
      audit[key] = normalized;
    }
  });
  return audit;
}

function extractTransacAudit(container: any): AuditMeta {
  const audit: AuditMeta = {};
  const groups = collectTransacGroups(container);
  if (groups.length === 0) return audit;
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const groupDate = normalizeAuditValue(nodeText(group.date || group.Date));
    const transacNodes = ensureArray((group as any).transac || (group as any).Transac);
    for (const node of transacNodes) {
      if (!node || typeof node !== "object") continue;
      const typeRaw = readAttribute(node as Record<string, any>, ["@_type", "type", "@_Type", "Type"]) ?? "";
      const kind = auditKindFromTransacType(typeRaw);
      if (!kind) continue;
      const actor = normalizeAuditValue(nodeText(node));
      if (kind === "created") {
        if (actor) audit.createdBy = actor;
        if (groupDate) audit.createdAt = groupDate;
      } else {
        if (actor) audit.modifiedBy = actor;
        if (groupDate) audit.modifiedAt = groupDate;
      }
    }
  }
  return audit;
}

function extractTermTexts(termGroup: any): string[] {
  const terms: string[] = [];
  const termNodes = ensureArray((termGroup as any)?.term ?? (termGroup as any)?.Term);
  termNodes.forEach((node) => {
    if (typeof node === "string") {
      terms.push(node);
      return;
    }
    if (node && typeof node === "object") {
      const value = nodeTextDeep(node);
      if (value) terms.push(value);
    }
  });
  const variants = terms.flatMap((value) => splitTermVariants(value));
  const unique = Array.from(new Set(variants.map((value) => value.trim()).filter(Boolean)));
  return unique;
}

function readIdFromAttrs(attrs: Record<string, any> | undefined): string | null {
  if (!attrs || typeof attrs !== "object") return null;
  for (const [key, value] of Object.entries(attrs)) {
    const k = key.toLowerCase();
    if (k === "id" || k === "xml:id") {
      const v = String(value ?? "").trim();
      if (v) return v;
    }
  }
  return null;
}

function normalizeLangCode(input: string | null): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  const simplified = lowered.replace(/[\s_-]+/g, " ").trim();
  const mapped = LANGUAGE_NAME_MAP[lowered] || LANGUAGE_NAME_MAP[simplified];
  if (mapped) return mapped;
  return lowered.split(/[-_]/, 1)[0] || null;
}

function flushConceptEntries(
  concept: ConceptContext,
  entries: ParsedGlossaryEntry[],
  seen: Set<string>
) {
  const entryDescrips = finalizeDescripMap(concept.entryDescrips);
  const languageDescrips = finalizeLanguageDescrips(concept.languageDescrips);
  const termDescrips = finalizeTermDescrips(concept.termDescrips);
  const entryAudit = hasAudit(concept.entryAudit) ? concept.entryAudit : undefined;
  const termAudit = finalizeTermAudit(concept.termAudit);
  const hasTermAudit = Object.keys(termAudit).length > 0;
  const hasEntryDescrips = Object.keys(entryDescrips).length > 0;
  const hasLanguageDescrips = Object.keys(languageDescrips).length > 0;
  const hasTermDescrips = Object.keys(termDescrips).length > 0;
  const codes = Array.from(concept.langTerms.keys());
  for (const src of codes) {
    for (const tgt of codes) {
      if (src === tgt) continue;
      const srcTerms = concept.langTerms.get(src);
      const tgtTerms = concept.langTerms.get(tgt);
      if (!srcTerms || !tgtTerms) continue;
      for (const term of srcTerms) {
        for (const translation of tgtTerms) {
          if (!term || !translation) continue;
          const key = `${src}\u0000${term}\u0000${tgt}\u0000${translation}`;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({
            term,
            translation,
            sourceLang: src,
            targetLang: tgt,
            conceptId: concept.conceptId,
            entryDescrips: hasEntryDescrips ? entryDescrips : undefined,
            languageDescrips: hasLanguageDescrips ? languageDescrips : undefined,
            termDescrips: hasTermDescrips ? termDescrips : undefined,
            entryAudit,
            termAudit: hasTermAudit ? termAudit : undefined
          });
        }
      }
    }
  }
}

function parseGlossaryXmlStream(xmlText: string): ParsedGlossaryEntry[] {
  const entries: ParsedGlossaryEntry[] = [];
  const seen = new Set<string>();
  const conceptStack: ConceptContext[] = [];
  const langStack: Array<{ tag: string; lang: string | null; descrips: DescripListMap }> = [];
  const termGroupStack: Array<{ descrips: DescripListMap; termTexts: string[]; audit: AuditMeta }> = [];
  const transacGroupStack: Array<{
    scope: "entry" | "term" | null;
    date: string | null;
    transacs: Array<{ type: string | null; value: string | null }>;
  }> = [];
  let termBuffer = "";
  let inTerm = false;
  let parseError: Error | null = null;
  let inDescrip = false;
  let descripBuffer = "";
  let descripType: string | null = null;
  let descripScope: "entry" | "language" | "term" | null = null;
  let inAdmin = false;
  let adminBuffer = "";
  let adminType: string | null = null;
  let adminScope: "entry" | "term" | null = null;
  let inTransac = false;
  let transacBuffer = "";
  let transacType: string | null = null;
  let inDate = false;
  let dateBuffer = "";

  const parser = sax.parser(true, { trim: false, normalize: false });

  parser.onopentag = (node) => {
    const tag = String(node.name || "").toLowerCase();
    if (tag === "conceptgrp" || tag === "termentry") {
      const conceptId = readIdFromAttrs(node.attributes);
      conceptStack.push({
        conceptId,
        langTerms: new Map(),
        entryDescrips: {},
        languageDescrips: new Map(),
        termDescrips: new Map(),
        entryAudit: {},
        termAudit: new Map()
      });
      return;
    }

    if (tag === "concept") {
      const concept = conceptStack[conceptStack.length - 1];
      if (concept && !concept.conceptId) {
        const conceptId = readIdFromAttrs(node.attributes);
        if (conceptId) concept.conceptId = conceptId;
      }
      return;
    }

    if (tag === "languagegrp" || tag === "langset") {
      const lang = normalizeLangCode(readLangFromAttrs(node.attributes));
      langStack.push({ tag, lang, descrips: {} });
      return;
    }

    if (tag === "language") {
      const lang = normalizeLangCode(readLangFromAttrs(node.attributes));
      if (langStack.length > 0) {
        const top = langStack[langStack.length - 1];
        if (!top.lang && lang) top.lang = lang;
      } else if (lang) {
        langStack.push({ tag: "language", lang, descrips: {} });
      }
      return;
    }

    if (tag === "termgrp") {
      termGroupStack.push({ descrips: {}, termTexts: [], audit: {} });
      return;
    }

    if (tag === "term") {
      inTerm = true;
      termBuffer = "";
      return;
    }

    if (tag === "descrip") {
      inDescrip = true;
      descripBuffer = "";
      descripType = readDescripTypeFromAttrs(node.attributes) || null;
      if (termGroupStack.length > 0) descripScope = "term";
      else if (langStack.length > 0) descripScope = "language";
      else if (conceptStack.length > 0) descripScope = "entry";
      else descripScope = null;
      return;
    }

    if (tag === "admin") {
      inAdmin = true;
      adminBuffer = "";
      adminType = readAttribute(node.attributes as Record<string, any>, ["type", "Type", "@_type", "@_Type"]) || null;
      if (termGroupStack.length > 0) adminScope = "term";
      else if (conceptStack.length > 0) adminScope = "entry";
      else adminScope = null;
      return;
    }

    if (tag === "transacgrp") {
      const scope = termGroupStack.length > 0 ? "term" : conceptStack.length > 0 ? "entry" : null;
      transacGroupStack.push({ scope, date: null, transacs: [] });
      return;
    }

    if (tag === "transac") {
      if (transacGroupStack.length === 0) return;
      inTransac = true;
      transacBuffer = "";
      transacType = readAttribute(node.attributes as Record<string, any>, ["type", "Type", "@_type", "@_Type"]) || null;
      return;
    }

    if (tag === "date") {
      if (transacGroupStack.length === 0) return;
      inDate = true;
      dateBuffer = "";
      return;
    }
  };

  parser.ontext = (text) => {
    if (inTerm) termBuffer += text;
    if (inDescrip) descripBuffer += text;
    if (inAdmin) adminBuffer += text;
    if (inTransac) transacBuffer += text;
    if (inDate) dateBuffer += text;
  };

  parser.oncdata = (text) => {
    if (inTerm) termBuffer += text;
    if (inDescrip) descripBuffer += text;
    if (inAdmin) adminBuffer += text;
    if (inTransac) transacBuffer += text;
    if (inDate) dateBuffer += text;
  };

  parser.onclosetag = (name) => {
    const tag = String(name || "").toLowerCase();
    if (tag === "admin") {
      inAdmin = false;
      const value = normalizeAuditValue(adminBuffer);
      const key = adminType ? auditKeyFromAdminType(adminType) : null;
      const concept = conceptStack[conceptStack.length - 1];
      const termGroup = termGroupStack[termGroupStack.length - 1];
      if (key && value) {
        if (adminScope === "term" && termGroup) {
          termGroup.audit[key] = value;
        } else if (adminScope === "entry" && concept) {
          concept.entryAudit[key] = value;
        }
      }
      adminBuffer = "";
      adminType = null;
      adminScope = null;
      return;
    }

    if (tag === "transac") {
      inTransac = false;
      const value = normalizeAuditValue(transacBuffer);
      const group = transacGroupStack[transacGroupStack.length - 1];
      if (group && (transacType || value)) {
        group.transacs.push({ type: transacType, value });
      }
      transacBuffer = "";
      transacType = null;
      return;
    }

    if (tag === "date") {
      inDate = false;
      const value = normalizeAuditValue(dateBuffer);
      const group = transacGroupStack[transacGroupStack.length - 1];
      if (group && value) {
        group.date = value;
      }
      dateBuffer = "";
      return;
    }

    if (tag === "transacgrp") {
      const group = transacGroupStack.pop();
      if (group) {
        const concept = conceptStack[conceptStack.length - 1];
        const termGroup = termGroupStack[termGroupStack.length - 1];
        const target =
          group.scope === "term"
            ? termGroup?.audit
            : group.scope === "entry"
              ? concept?.entryAudit
              : null;
        if (target) {
          group.transacs.forEach((transac) => {
            const kind = auditKindFromTransacType(transac.type ?? "");
            if (!kind) return;
            const actor = normalizeAuditValue(transac.value);
            if (kind === "created") {
              if (actor) target.createdBy = actor;
              if (group.date) target.createdAt = group.date;
            } else {
              if (actor) target.modifiedBy = actor;
              if (group.date) target.modifiedAt = group.date;
            }
          });
        }
      }
      return;
    }

    if (tag === "descrip") {
      inDescrip = false;
      const value = descripBuffer.trim().replace(/\s+/g, " ").trim();
      const concept = conceptStack[conceptStack.length - 1];
      if (concept && descripType && value) {
        if (descripScope === "term" && termGroupStack.length > 0) {
          addDescripValue(termGroupStack[termGroupStack.length - 1].descrips, descripType, value);
        } else if (descripScope === "language" && langStack.length > 0) {
          addDescripValue(langStack[langStack.length - 1].descrips, descripType, value);
        } else if (descripScope === "entry") {
          addDescripValue(concept.entryDescrips, descripType, value);
        }
      }
      descripBuffer = "";
      descripType = null;
      descripScope = null;
      return;
    }

    if (tag === "term") {
      inTerm = false;
      const raw = termBuffer.trim();
      termBuffer = "";
      if (!raw) return;
      const concept = conceptStack[conceptStack.length - 1];
      const topLang = langStack.length > 0 ? langStack[langStack.length - 1].lang : null;
      if (!concept || !topLang) return;
      const lang = normalizeLangCode(topLang);
      if (!lang) return;
      const variants = splitTermVariants(raw);
      if (variants.length === 0) return;
      let set = concept.langTerms.get(lang);
      if (!set) {
        set = new Set();
        concept.langTerms.set(lang, set);
      }
      variants.forEach((variant) => set!.add(variant));
      if (termGroupStack.length > 0) {
        termGroupStack[termGroupStack.length - 1].termTexts.push(raw);
      }
      return;
    }

    if (tag === "termgrp") {
      const context = termGroupStack.pop();
      const concept = conceptStack[conceptStack.length - 1];
      const topLang = langStack.length > 0 ? langStack[langStack.length - 1].lang : null;
      const lang = normalizeLangCode(topLang);
      if (!context || !concept || !lang) return;
      const hasDescrips = Object.keys(context.descrips).length > 0;
      const hasAuditValues = hasAudit(context.audit);
      if (!hasDescrips && !hasAuditValues) return;
      if (context.termTexts.length === 0) return;
      if (hasDescrips) {
        const langTerms = concept.termDescrips.get(lang) ?? new Map<string, DescripListMap>();
        context.termTexts.forEach((termText) => {
          splitTermVariants(termText).forEach((variant) => {
            if (!variant) return;
            const existing = langTerms.get(variant) ?? {};
            mergeDescripLists(existing, context.descrips);
            langTerms.set(variant, existing);
          });
        });
        concept.termDescrips.set(lang, langTerms);
      }
      if (hasAuditValues) {
        const langAudit = concept.termAudit.get(lang) ?? new Map<string, AuditMeta>();
        context.termTexts.forEach((termText) => {
          splitTermVariants(termText).forEach((variant) => {
            if (!variant) return;
            const existing = langAudit.get(variant) ?? {};
            langAudit.set(variant, mergeAudit(existing, context.audit));
          });
        });
        concept.termAudit.set(lang, langAudit);
      }
      return;
    }

    if (tag === "languagegrp" || tag === "langset") {
      const closed = langStack.pop();
      const concept = conceptStack[conceptStack.length - 1];
      if (closed && concept && closed.lang && Object.keys(closed.descrips).length > 0) {
        const lang = normalizeLangCode(closed.lang);
        if (lang) {
          const existing = concept.languageDescrips.get(lang) ?? {};
          mergeDescripLists(existing, closed.descrips);
          concept.languageDescrips.set(lang, existing);
        }
      }
      return;
    }

    if (tag === "language") {
      const top = langStack[langStack.length - 1];
      if (top && top.tag === "language") {
        const closed = langStack.pop();
        const concept = conceptStack[conceptStack.length - 1];
        if (closed && concept && closed.lang && Object.keys(closed.descrips).length > 0) {
          const lang = normalizeLangCode(closed.lang);
          if (lang) {
            const existing = concept.languageDescrips.get(lang) ?? {};
            mergeDescripLists(existing, closed.descrips);
            concept.languageDescrips.set(lang, existing);
          }
        }
      }
      return;
    }

    if (tag === "conceptgrp" || tag === "termentry") {
      const concept = conceptStack.pop();
      if (concept) {
        flushConceptEntries(concept, entries, seen);
      }
    }
  };

  parser.onerror = (err) => {
    parseError = err;
    parser.resume();
  };

  parser.write(xmlText).close();

  if (parseError) {
    throw parseError;
  }

  while (conceptStack.length > 0) {
    const concept = conceptStack.pop();
    if (concept) flushConceptEntries(concept, entries, seen);
  }

  return entries;
}

function extractLanguageTerms(concept: any): Record<string, string[]> {
  const result: Record<string, Set<string>> = {};
  const languageGroups = ensureArray(concept.languageGrp);
  for (const group of languageGroups) {
    const code = resolveLanguageGroupCode(group);
    if (!code) continue;
    const termGroups = ensureArray(group.termGrp);
    for (const termGroup of termGroups) {
      const rawTermNode = termGroup.term || termGroup.Term;
      const termNode = Array.isArray(rawTermNode) ? rawTermNode[0] : rawTermNode;
      if (typeof termNode === "string") {
        const variants = splitTermVariants(termNode);
        if (variants.length > 0) {
          result[code] = result[code] ?? new Set();
          variants.forEach((variant) => result[code].add(variant));
        }
      } else if (termNode && typeof termNode === "object") {
        const textValue =
          termNode.text ?? termNode["#text"] ?? termNode["$text"];
        if (typeof textValue === "string" && textValue.trim()) {
          const variants = splitTermVariants(textValue);
          if (variants.length > 0) {
            result[code] = result[code] ?? new Set();
            variants.forEach((variant) => result[code].add(variant));
          }
        }
      }
    }
  }
  const out: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(result)) {
    out[key] = Array.from(values);
  }
  return out;
}

function extractConceptId(concept: any): string | null {
  if (!concept || typeof concept !== "object") return null;
  const conceptNode = concept.concept ?? concept.Concept ?? concept.termEntry ?? concept.TermEntry ?? null;
  const node = Array.isArray(conceptNode) ? conceptNode[0] : conceptNode;
  if (node && typeof node === "object") {
    return readAttribute(node, ["@_id", "@_ID", "id", "ID"]);
  }
  return null;
}

type ConceptTransactionMeta = {
  originAuthor: string | null;
  originDate: string | null;
  lastAuthor: string | null;
  lastDate: string | null;
  lastType: "origination" | "modification";
};

function extractConceptTransactionMeta(concept: any): ConceptTransactionMeta {
  const groups = ensureArray(concept.transacGrp);
  const meta: ConceptTransactionMeta = {
    originAuthor: null,
    originDate: null,
    lastAuthor: null,
    lastDate: null,
    lastType: "origination"
  };
  for (const group of groups) {
    const transacNodes = ensureArray(group.transac || group.Transac);
    const groupDate = nodeText(group.date || group.Date);
    for (const node of transacNodes) {
      const typeRaw = readAttribute(node, ["@_type", "type"])?.toLowerCase() ?? null;
      const actor = nodeText(node);
      if (typeRaw === "origination" && !meta.originAuthor) {
        meta.originAuthor = actor || "system";
        meta.originDate = groupDate || new Date().toISOString();
      }
      if (actor) {
        meta.lastAuthor = actor;
      }
      if (groupDate) {
        meta.lastDate = groupDate;
      }
      if (typeRaw === "modification") {
        meta.lastType = "modification";
      }
    }
  }
  if (!meta.originAuthor && meta.lastAuthor) {
    meta.originAuthor = meta.lastAuthor;
    meta.originDate = meta.lastDate;
  }
  if (!meta.lastAuthor && meta.originAuthor) {
    meta.lastAuthor = meta.originAuthor;
    meta.lastDate = meta.originDate;
  }
  return meta;
}

function parseGlossaryXml(doc: any): ParsedGlossaryEntry[] {
  const concepts = collectConceptGroups(doc);
  const entries: ParsedGlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const concept of concepts) {
    const conceptMeta = extractConceptTransactionMeta(concept);
    const conceptId = extractConceptId(concept);
    const langTerms = extractLanguageTerms(concept);
    const entryAudit = mergeAudit(extractAdminAudit(concept), extractTransacAudit(concept));
    const entryDescripsRaw = collectDescripListMap(concept);
    const languageDescripsRaw: Map<string, DescripListMap> = new Map();
    const termDescripsRaw: Map<string, Map<string, DescripListMap>> = new Map();
    const termAuditRaw: Map<string, Map<string, AuditMeta>> = new Map();
    const languageGroups = ensureArray(concept.languageGrp);
    for (const group of languageGroups) {
      const code = resolveLanguageGroupCode(group);
      if (!code) continue;
      const languageDescrips = collectDescripListMap(group);
      if (Object.keys(languageDescrips).length > 0) {
        const existing = languageDescripsRaw.get(code) ?? {};
        mergeDescripLists(existing, languageDescrips);
        languageDescripsRaw.set(code, existing);
      }
      const termGroups = ensureArray(group.termGrp);
      for (const termGroup of termGroups) {
        const termDescrips = collectDescripListMap(termGroup);
        const termAudit = mergeAudit(extractAdminAudit(termGroup), extractTransacAudit(termGroup));
        const hasTermDescrips = Object.keys(termDescrips).length > 0;
        const hasTermAudit = hasAudit(termAudit);
        if (!hasTermDescrips && !hasTermAudit) continue;
        const terms = extractTermTexts(termGroup);
        if (terms.length === 0) continue;
        if (hasTermDescrips) {
          const langTermsMap = termDescripsRaw.get(code) ?? new Map<string, DescripListMap>();
          terms.forEach((term) => {
            const existing = langTermsMap.get(term) ?? {};
            mergeDescripLists(existing, termDescrips);
            langTermsMap.set(term, existing);
          });
          termDescripsRaw.set(code, langTermsMap);
        }
        if (hasTermAudit) {
          const langAuditMap = termAuditRaw.get(code) ?? new Map<string, AuditMeta>();
          terms.forEach((term) => {
            const existing = langAuditMap.get(term) ?? {};
            langAuditMap.set(term, mergeAudit(existing, termAudit));
          });
          termAuditRaw.set(code, langAuditMap);
        }
      }
    }
    const entryDescrips = finalizeDescripMap(entryDescripsRaw);
    const languageDescrips = finalizeLanguageDescrips(languageDescripsRaw);
    const termDescrips = finalizeTermDescrips(termDescripsRaw);
    const termAudit = finalizeTermAudit(termAuditRaw);
    const hasEntryAudit = hasAudit(entryAudit);
    const hasTermAudit = Object.keys(termAudit).length > 0;
    const hasEntryDescrips = Object.keys(entryDescrips).length > 0;
    const hasLanguageDescrips = Object.keys(languageDescrips).length > 0;
    const hasTermDescrips = Object.keys(termDescrips).length > 0;
    const codes = Object.keys(langTerms);
    for (const src of codes) {
      for (const tgt of codes) {
        if (src === tgt) continue;
        const terms = langTerms[src] || [];
        const translations = langTerms[tgt] || [];
        if (terms.length === 0 || translations.length === 0) continue;
        for (const term of terms) {
          for (const translation of translations) {
            if (!term || !translation) continue;
            const key = `${src}\u0000${term}\u0000${tgt}\u0000${translation}`;
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({
              term,
              translation,
              sourceLang: src.toLowerCase(),
              targetLang: tgt.toLowerCase(),
              sourceType: conceptMeta.lastType,
              createdBy: conceptMeta.lastAuthor ?? conceptMeta.originAuthor ?? null,
              createdAt: conceptMeta.lastDate ?? conceptMeta.originDate ?? null,
              origin: null,
              originAuthor: conceptMeta.originAuthor ?? null,
              originDate: conceptMeta.originDate ?? null,
              conceptId,
              entryDescrips: hasEntryDescrips ? entryDescrips : undefined,
              languageDescrips: hasLanguageDescrips ? languageDescrips : undefined,
              termDescrips: hasTermDescrips ? termDescrips : undefined,
              entryAudit: hasEntryAudit ? entryAudit : undefined,
              termAudit: hasTermAudit ? termAudit : undefined
            });
          }
        }
      }
    }
  }
  return entries;
}

