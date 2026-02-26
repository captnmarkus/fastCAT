
import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { db, withTransaction } from "../db.js";
import { buildGlossaryTbx } from "../lib/glossary-utils.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";
import {
  LANGUAGE_CODE_ALIASES,
  LANGUAGE_NAME_MAP,
  buildLanguageCandidates,
  normalizeLanguageInput,
  normalizeLanguageListInput
} from "../lib/language-normalization.js";
import { presignGetObject } from "../lib/s3.js";
import { keyTerminologyImage } from "../lib/storage-keys.js";
import { normalizeStructureFields } from "../lib/termbase-import.js";
import { getRequestUser, requireAuth, requireManagerOrAdmin, requestUserId } from "../middleware/auth.js";
import { toIsoOrNull as toIsoOrNullValue, toText } from "../utils.js";
export {
  MATCH_WEIGHTS,
  bigramSimilarity,
  boundaryMatch,
  concordanceTokens,
  escapeRegExp,
  matchConcordanceTerm,
  normalizeConcordanceText,
  prefixMatch,
  scoreMatch,
  tokenOverlap
} from "./termbases.concordance.helpers.js";

export type GlossaryRow = {
  id: number;
  label: string;
  languages: any;
  default_source_lang?: string | null;
  default_target_lang?: string | null;
  structure_json?: any;
  updated_at: string;
};

export type GlossaryEntryRow = {
  id: number;
  glossary_id: number;
  concept_id: string | null;
  source_lang: string;
  target_lang: string;
  term: string;
  translation: string;
  notes: string | null;
  meta_json?: any;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

export type TermKey = {
  glossaryId: number;
  conceptId: string;
  lang: string;
  text: string;
};

export type TermDetail = {
  termId: string;
  text: string;
  status: TermStatus;
  notes: string | null;
  partOfSpeech: string | null;
  customFields?: Record<string, any> | null;
  updatedAt: string | null;
  audit?: AuditMeta | null;
};

export type TermbaseIllustration = {
  filename: string;
  url: string | null;
};

export type TermbaseField = {
  name: string;
  type: "text" | "textarea" | "picklist";
  values?: string[];
  multiline?: boolean;
};

export type TermbaseStructure = {
  template?: string | null;
  entry: TermbaseField[];
  language: TermbaseField[];
  term: TermbaseField[];
};

export type CustomFields = Record<string, any>;
export type LanguageFieldsMap = Record<string, CustomFields>;
export type TermFieldsMap = Record<string, Record<string, CustomFields>>;
export type AuditMeta = {
  createdAt?: string | null;
  createdBy?: string | null;
  modifiedAt?: string | null;
  modifiedBy?: string | null;
};
export type TermAuditMap = Record<string, Record<string, AuditMeta>>;
export type ConcordanceMatchType = "exact" | "boundary" | "prefix" | "overlap" | "fuzzy";
export type ConcordanceMatch = {
  term: string;
  lang: "source" | "target";
  type: ConcordanceMatchType;
  ratio?: number;
  value?: string | null;
  score: number;
  status: TermStatus;
};

export const TERM_STATUS_VALUES = ["preferred", "allowed", "forbidden"] as const;
export type TermStatus = (typeof TERM_STATUS_VALUES)[number];
export const TERM_STATUS_ERROR = "Invalid status. Allowed: preferred, allowed, forbidden";
export { LANGUAGE_CODE_ALIASES, LANGUAGE_NAME_MAP };

export function normalizeLang(input: string) {
  return normalizeLanguageInput(input);
}

export function buildLangCandidates(input: string): string[] {
  return buildLanguageCandidates(input);
}

export function normalizeLanguages(value: any): string[] {
  return normalizeLanguageListInput(value);
}

export function normalizeMeta(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

export function normalizeFieldMap(value: any): CustomFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: CustomFields = {};
  Object.entries(value as Record<string, any>).forEach(([key, val]) => {
    const name = String(key ?? "").trim();
    if (!name) return;
    result[name] = val;
  });
  return result;
}

export function mergeFieldMap(target: CustomFields, patch: CustomFields) {
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    target[key] = value;
  });
}

export function normalizeLanguageFields(value: any): LanguageFieldsMap {
  const raw = normalizeFieldMap(value);
  const result: LanguageFieldsMap = {};
  Object.entries(raw).forEach(([lang, fields]) => {
    const normalizedLang = normalizeLang(lang);
    if (!normalizedLang) return;
    result[normalizedLang] = normalizeFieldMap(fields);
  });
  return result;
}

export function normalizeTermFields(value: any): TermFieldsMap {
  const raw = normalizeFieldMap(value);
  const result: TermFieldsMap = {};
  Object.entries(raw).forEach(([lang, terms]) => {
    const normalizedLang = normalizeLang(lang);
    if (!normalizedLang) return;
    const rawTerms = normalizeFieldMap(terms);
    const termMap: Record<string, CustomFields> = {};
    Object.entries(rawTerms).forEach(([term, fields]) => {
      const termKey = String(term ?? "").trim();
      if (!termKey) return;
      termMap[termKey] = normalizeFieldMap(fields);
    });
    result[normalizedLang] = termMap;
  });
  return result;
}

export function normalizeAuditValue(value: any): string | null {
  const text = toText(value).trim();
  return text ? text : null;
}

export function normalizeAuditMeta(value: any): AuditMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, any>;
  const createdAt = normalizeAuditValue(raw.createdAt ?? raw.created_at ?? raw.creationDate ?? raw.creation_date);
  const createdBy = normalizeAuditValue(raw.createdBy ?? raw.created_by ?? raw.createdby ?? raw.creator ?? raw.author);
  const modifiedAt = normalizeAuditValue(
    raw.modifiedAt ??
      raw.modified_at ??
      raw.modificationDate ??
      raw.modification_date ??
      raw.updatedAt ??
      raw.updated_at ??
      raw.lastModifiedAt ??
      raw.last_modified_at
  );
  const modifiedBy = normalizeAuditValue(
    raw.modifiedBy ??
      raw.modified_by ??
      raw.modifiedby ??
      raw.updatedBy ??
      raw.updated_by ??
      raw.lastModifiedBy ??
      raw.last_modified_by ??
      raw.modifier
  );
  const audit: AuditMeta = {};
  if (createdAt) audit.createdAt = createdAt;
  if (createdBy) audit.createdBy = createdBy;
  if (modifiedAt) audit.modifiedAt = modifiedAt;
  if (modifiedBy) audit.modifiedBy = modifiedBy;
  return audit;
}

export function auditFromOriginMeta(meta: Record<string, any>): AuditMeta {
  const createdAt = normalizeAuditValue(meta.originDate ?? meta.origin_date ?? meta.originCreatedAt ?? meta.origin_created_at);
  const createdBy = normalizeAuditValue(meta.originAuthor ?? meta.origin_author ?? meta.originator ?? meta.origin_by);
  const audit: AuditMeta = {};
  if (createdAt) audit.createdAt = createdAt;
  if (createdBy) audit.createdBy = createdBy;
  return audit;
}

export function normalizeTermAuditMap(value: any): TermAuditMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: TermAuditMap = {};
  Object.entries(value as Record<string, any>).forEach(([lang, terms]) => {
    const normalizedLang = normalizeLang(lang);
    if (!normalizedLang) return;
    if (!terms || typeof terms !== "object" || Array.isArray(terms)) return;
    Object.entries(terms as Record<string, any>).forEach(([term, auditValue]) => {
      const termKey = String(term ?? "").trim();
      if (!termKey) return;
      const audit = normalizeAuditMeta(auditValue);
      if (Object.keys(audit).length === 0) return;
      if (!result[normalizedLang]) result[normalizedLang] = {};
      result[normalizedLang]![termKey] = audit;
    });
  });
  return result;
}

export function mergeAudit(primary: AuditMeta, fallback: AuditMeta): AuditMeta {
  const audit: AuditMeta = {};
  const createdAt = primary.createdAt ?? fallback.createdAt ?? null;
  const createdBy = primary.createdBy ?? fallback.createdBy ?? null;
  const modifiedAt = primary.modifiedAt ?? fallback.modifiedAt ?? null;
  const modifiedBy = primary.modifiedBy ?? fallback.modifiedBy ?? null;
  if (createdAt) audit.createdAt = createdAt;
  if (createdBy) audit.createdBy = createdBy;
  if (modifiedAt) audit.modifiedAt = modifiedAt;
  if (modifiedBy) audit.modifiedBy = modifiedBy;
  return audit;
}

export function hasAudit(audit: AuditMeta): boolean {
  return Boolean(audit.createdAt || audit.createdBy || audit.modifiedAt || audit.modifiedBy);
}

export function mergeTermAuditMap(target: TermAuditMap, patch: any) {
  const normalized = normalizeTermAuditMap(patch);
  Object.entries(normalized).forEach(([lang, terms]) => {
    const currentLang = target[lang] ?? {};
    Object.entries(terms).forEach(([term, audit]) => {
      const existing = currentLang[term] ?? {};
      currentLang[term] = mergeAudit(existing, audit);
    });
    target[lang] = currentLang;
  });
}

export function toIsoOrNull(value: any): string | null {
  return toIsoOrNullValue(value);
}

export function auditFromRow(row: GlossaryEntryRow): AuditMeta {
  const audit: AuditMeta = {};
  const createdAt = toIsoOrNull(row.created_at);
  const modifiedAt = toIsoOrNull(row.updated_at);
  if (createdAt) audit.createdAt = createdAt;
  if (row.created_by) audit.createdBy = row.created_by;
  if (modifiedAt) audit.modifiedAt = modifiedAt;
  if (row.updated_by) audit.modifiedBy = row.updated_by;
  return audit;
}

export function mergeAuditAggregate(current: AuditMeta | null | undefined, incoming: AuditMeta): AuditMeta {
  const merged: AuditMeta = { ...(current ?? {}) };
  if (incoming.createdAt && (!merged.createdAt || incoming.createdAt < merged.createdAt)) {
    merged.createdAt = incoming.createdAt;
    if (incoming.createdBy) merged.createdBy = incoming.createdBy;
  }
  if (!merged.createdBy && incoming.createdBy) {
    merged.createdBy = incoming.createdBy;
  }
  if (incoming.modifiedAt && (!merged.modifiedAt || incoming.modifiedAt > merged.modifiedAt)) {
    merged.modifiedAt = incoming.modifiedAt;
    if (incoming.modifiedBy) merged.modifiedBy = incoming.modifiedBy;
  }
  if (!merged.modifiedBy && incoming.modifiedBy) {
    merged.modifiedBy = incoming.modifiedBy;
  }
  return merged;
}

export function ensureSourceAudit(meta: Record<string, any>) {
  if (meta.source_audit || meta.sourceAudit) return;
  const existing = normalizeAuditMeta(meta.audit ?? meta.entry_audit ?? meta.entryAudit ?? null);
  if (hasAudit(existing)) {
    meta.source_audit = existing;
  }
}

export function touchEntryAudit(meta: Record<string, any>, row: GlossaryEntryRow, actor: string, nowIso: string) {
  ensureSourceAudit(meta);
  const current = normalizeAuditMeta(meta.audit ?? meta.entry_audit ?? meta.entryAudit ?? null);
  if (!current.createdAt) {
    const createdAt = toIsoOrNull(row.created_at);
    if (createdAt) current.createdAt = createdAt;
  }
  if (!current.createdBy && row.created_by) current.createdBy = row.created_by;
  current.modifiedAt = nowIso;
  current.modifiedBy = actor;
  meta.audit = current;
}

export function getTermAuditMap(meta: Record<string, any>) {
  return normalizeTermAuditMap(meta.term_audit ?? meta.termAudit ?? null);
}

export function setTermAuditMap(meta: Record<string, any>, map: TermAuditMap) {
  meta.term_audit = map;
}

export function ensureSourceTermAudit(
  meta: Record<string, any>,
  lang: string,
  termText: string,
  existing: AuditMeta
) {
  if (!hasAudit(existing)) return;
  const normalizedLang = normalizeLang(lang);
  const termKey = String(termText ?? "").trim();
  if (!normalizedLang || !termKey) return;
  const source = normalizeTermAuditMap(meta.source_term_audit ?? meta.sourceTermAudit ?? null);
  if (source[normalizedLang]?.[termKey]) return;
  if (!source[normalizedLang]) source[normalizedLang] = {};
  source[normalizedLang]![termKey] = existing;
  meta.source_term_audit = source;
}

export function renameTermAudit(meta: Record<string, any>, lang: string, fromText: string, toText: string) {
  const normalizedLang = normalizeLang(lang);
  const fromKey = String(fromText ?? "").trim();
  const toKey = String(toText ?? "").trim();
  if (!normalizedLang || !fromKey || !toKey || fromKey === toKey) return;

  const current = getTermAuditMap(meta);
  const existing = current[normalizedLang]?.[fromKey];
  if (existing) {
    if (!current[normalizedLang]) current[normalizedLang] = {};
    current[normalizedLang]![toKey] = existing;
    delete current[normalizedLang]![fromKey];
    setTermAuditMap(meta, current);
  }

  const source = normalizeTermAuditMap(meta.source_term_audit ?? meta.sourceTermAudit ?? null);
  const sourceExisting = source[normalizedLang]?.[fromKey];
  if (sourceExisting) {
    if (!source[normalizedLang]) source[normalizedLang] = {};
    source[normalizedLang]![toKey] = sourceExisting;
    delete source[normalizedLang]![fromKey];
    meta.source_term_audit = source;
  }
}

export function touchTermAudit(
  meta: Record<string, any>,
  lang: string,
  termText: string,
  row: GlossaryEntryRow,
  actor: string,
  nowIso: string
) {
  const normalizedLang = normalizeLang(lang);
  const termKey = String(termText ?? "").trim();
  if (!normalizedLang || !termKey) return;
  const current = getTermAuditMap(meta);
  const existing = current[normalizedLang]?.[termKey] ?? {};
  ensureSourceTermAudit(meta, normalizedLang, termKey, existing);
  const next: AuditMeta = { ...existing };
  if (!next.createdAt) {
    const createdAt = toIsoOrNull(row.created_at);
    if (createdAt) next.createdAt = createdAt;
  }
  if (!next.createdBy && row.created_by) next.createdBy = row.created_by;
  next.modifiedAt = nowIso;
  next.modifiedBy = actor;
  if (!current[normalizedLang]) current[normalizedLang] = {};
  current[normalizedLang]![termKey] = next;
  setTermAuditMap(meta, current);
}

export function mergeLanguageFields(target: LanguageFieldsMap, patch: any) {
  const normalized = normalizeLanguageFields(patch);
  Object.entries(normalized).forEach(([lang, fields]) => {
    const current = target[lang] ?? {};
    mergeFieldMap(current, fields);
    target[lang] = current;
  });
}

export function mergeTermFields(target: TermFieldsMap, patch: any) {
  const normalized = normalizeTermFields(patch);
  Object.entries(normalized).forEach(([lang, terms]) => {
    const currentLang = target[lang] ?? {};
    Object.entries(terms).forEach(([term, fields]) => {
      const currentTerm = currentLang[term] ?? {};
      mergeFieldMap(currentTerm, fields);
      currentLang[term] = currentTerm;
    });
    target[lang] = currentLang;
  });
}

export function applyEntryFields(meta: Record<string, any>, patch: any) {
  const updates = normalizeFieldMap(patch);
  if (Object.keys(updates).length === 0) return;
  const current = normalizeFieldMap(meta.entry_fields);
  mergeFieldMap(current, updates);
  meta.entry_fields = current;
}

export function applyLanguageFields(meta: Record<string, any>, patch: any) {
  const updates = normalizeLanguageFields(patch);
  if (Object.keys(updates).length === 0) return;
  const current = normalizeLanguageFields(meta.language_fields);
  Object.entries(updates).forEach(([lang, fields]) => {
    const existing = current[lang] ?? {};
    mergeFieldMap(existing, fields);
    current[lang] = existing;
  });
  meta.language_fields = current;
}

export function applyTermFields(meta: Record<string, any>, lang: string, termText: string, patch: any) {
  const updates = normalizeFieldMap(patch);
  if (Object.keys(updates).length === 0) return;
  const normalizedLang = normalizeLang(lang);
  const normalizedTerm = String(termText ?? "").trim();
  if (!normalizedLang || !normalizedTerm) return;
  const current = normalizeTermFields(meta.term_fields);
  const currentLang = current[normalizedLang] ?? {};
  const currentTerm = currentLang[normalizedTerm] ?? {};
  mergeFieldMap(currentTerm, updates);
  currentLang[normalizedTerm] = currentTerm;
  current[normalizedLang] = currentLang;
  meta.term_fields = current;
}

export function renameTermFields(meta: Record<string, any>, lang: string, fromText: string, toText: string) {
  const normalizedLang = normalizeLang(lang);
  const fromKey = String(fromText ?? "").trim();
  const toKey = String(toText ?? "").trim();
  if (!normalizedLang || !fromKey || !toKey || fromKey === toKey) return;
  const current = normalizeTermFields(meta.term_fields);
  const currentLang = current[normalizedLang];
  if (!currentLang || !currentLang[fromKey]) return;
  currentLang[toKey] = currentLang[fromKey];
  delete currentLang[fromKey];
  current[normalizedLang] = currentLang;
  meta.term_fields = current;
}

export function parseDateParam(value: any, endOfDay: boolean): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed.toISOString();
}

export function normalizeStructure(raw: any, template: string): TermbaseStructure {
  const normalizeField = (field: any): TermbaseField | null => {
    if (!field || typeof field !== "object") return null;
    const name = String(field.name ?? field.label ?? "").trim();
    if (!name) return null;
    const typeRaw = String(field.type ?? "").trim().toLowerCase();
    const multiline = Boolean(field.multiline ?? field.multiLine ?? field.textarea ?? false);
    let type: TermbaseField["type"] = "text";
    if (typeRaw === "picklist") type = "picklist";
    if (typeRaw === "textarea") type = "textarea";
    if (type !== "picklist" && multiline) type = "textarea";
    const values = Array.isArray(field.values)
      ? field.values.map((value: any) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (type === "picklist") {
      return { name, type, values };
    }
    return type === "textarea" ? { name, type, multiline: true } : { name, type };
  };

  const base = raw && typeof raw === "object" ? raw : {};
  const entry = Array.isArray(base.entry) ? base.entry.map(normalizeField).filter(Boolean) as TermbaseField[] : [];
  const language = Array.isArray(base.language) ? base.language.map(normalizeField).filter(Boolean) as TermbaseField[] : [];
  const term = Array.isArray(base.term) ? base.term.map(normalizeField).filter(Boolean) as TermbaseField[] : [];

  return {
    template: template || null,
    entry,
    language,
    term
  };
}

export function defaultStructure(template: string): TermbaseStructure {
  if (template === "advanced") {
    return {
      template,
      entry: [
        { name: "Subject", type: "picklist" },
        { name: "Note", type: "text" }
      ],
      language: [
        { name: "Definition", type: "text" },
        { name: "Context", type: "text" },
        { name: "Note", type: "text" }
      ],
      term: [
        { name: "Status", type: "picklist", values: ["Preferred", "Allowed", "Forbidden"] },
        { name: "Part of speech", type: "text" },
        { name: "Note", type: "text" }
      ]
    };
  }
  return {
    template: "basic",
    entry: [
      { name: "Subject", type: "picklist" },
      { name: "Note", type: "text" }
    ],
    language: [
      { name: "Definition", type: "text" },
      { name: "Note", type: "text" }
    ],
    term: [
      { name: "Status", type: "picklist", values: ["Preferred", "Allowed", "Forbidden"] },
      { name: "Note", type: "text" }
    ]
  };
}

export function statusFromMeta(meta: Record<string, any>) {
  if (meta.forbidden === true) return "forbidden";
  if (meta.preferred === true) return "preferred";
  return "allowed";
}

export function parseStatusInput(value: any): { status: TermStatus | null; error?: string } {
  if (value === undefined || value === null) return { status: null };
  let normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return { status: null, error: TERM_STATUS_ERROR };
  }
  if (normalized === "deprecated") normalized = "allowed";
  if (!TERM_STATUS_VALUES.includes(normalized as TermStatus)) {
    return { status: null, error: TERM_STATUS_ERROR };
  }
  return { status: normalized as TermStatus };
}

export function applyStatus(meta: Record<string, any>, status: TermStatus | null | undefined) {
  if (!status || status === "allowed") {
    delete meta.preferred;
    delete meta.forbidden;
    return;
  }
  if (status === "preferred") {
    meta.preferred = true;
    meta.forbidden = false;
    return;
  }
  if (status === "forbidden") {
    meta.forbidden = true;
    meta.preferred = false;
  }
}

export function applyPartOfSpeech(meta: Record<string, any>, value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    delete meta.partOfSpeech;
    return;
  }
  meta.partOfSpeech = trimmed;
}

export function toBase64Url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function fromBase64Url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function encodeTermKey(key: TermKey) {
  return `t_${toBase64Url(JSON.stringify(key))}`;
}

export function decodeTermKey(raw: string): TermKey | null {
  const trimmed = raw.startsWith("t_") ? raw.slice(2) : raw;
  try {
    const json = fromBase64Url(trimmed);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const glossaryId = Number(parsed.glossaryId);
    const conceptId = String(parsed.conceptId ?? "").trim();
    const lang = normalizeLang(String(parsed.lang ?? ""));
    const text = String(parsed.text ?? "").trim();
    if (!Number.isFinite(glossaryId) || !conceptId || !lang || !text) return null;
    return { glossaryId, conceptId, lang, text };
  } catch {
    return null;
  }
}

export function conceptKeyForRow(row: { concept_id: string | null; id: number }) {
  return row.concept_id ? String(row.concept_id) : `row-${row.id}`;
}

export function toCsvLine(fields: string[]) {
  return (
    fields
      .map((value) => {
        const str = String(value ?? "");
        const needsQuotes = /[",\n\r]/.test(str);
        const escaped = str.replace(/"/g, '""');
        return needsQuotes ? `"${escaped}"` : escaped;
      })
      .join(",") + "\n"
  );
}

export type ExportStructure = ReturnType<typeof normalizeStructureFields>;

export function normalizeExportFieldKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeLookupFieldKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function getEntryFieldValue(fields: Record<string, any> | null | undefined, names: string[]): string | null {
  if (!fields) return null;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      const text = toText((fields as any)[name]);
      if (text.trim()) return text;
    }
  }
  const normalizedMap = new Map<string, string>();
  Object.keys(fields).forEach((key) => {
    const normalized = normalizeLookupFieldKey(key);
    if (!normalized || normalizedMap.has(normalized)) return;
    normalizedMap.set(normalized, key);
  });
  for (const name of names) {
    const normalized = normalizeLookupFieldKey(name);
    const key = normalizedMap.get(normalized);
    if (!key) continue;
    const text = toText((fields as any)[key]);
    if (text.trim()) return text;
  }
  return null;
}

export function parseBooleanParam(value: any, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(raw)) return true;
  if (["false", "0", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

export function clampInt(value: any, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

export function isStatusExportField(name: string): boolean {
  return normalizeExportFieldKey(name) === "status";
}

export function isPartOfSpeechExportField(name: string): boolean {
  const normalized = normalizeExportFieldKey(name);
  return normalized === "partofspeech" || normalized === "pos";
}

export function buildTermbaseCsvExport(params: {
  entries: GlossaryEntryRow[];
  structure: ExportStructure;
}): string {
  const entryFieldDefs = params.structure.entry ?? [];
  const languageFieldDefs = params.structure.language ?? [];
  const termFieldDefs = (params.structure.term ?? []).filter(
    (field) => !isStatusExportField(field.name)
  );

  const headers = [
    "entry_id",
    "concept_id",
    "language",
    "term",
    "status",
    "entry_created_at",
    "entry_created_by",
    "entry_modified_at",
    "entry_modified_by",
    "term_created_at",
    "term_created_by",
    "term_modified_at",
    "term_modified_by",
    ...entryFieldDefs.map((field) => `entry__${field.name}`),
    ...languageFieldDefs.map((field) => `lang__${field.name}`),
    ...termFieldDefs.map((field) => `term__${field.name}`)
  ];

  let csv = "";
  csv += toCsvLine(headers);

  for (const row of params.entries) {
    const meta = normalizeMeta(row.meta_json);
    const entryAuditRaw = normalizeAuditMeta(meta.audit ?? meta.entry_audit ?? meta.entryAudit ?? null);
    const entryAudit = mergeAudit(entryAuditRaw, mergeAudit(auditFromOriginMeta(meta), auditFromRow(row)));
    const termAuditMap = normalizeTermAuditMap(meta.term_audit ?? meta.termAudit ?? null);
    const status = statusFromMeta(meta);
    const entryFields = normalizeFieldMap(meta.entry_fields);
    const languageFields = normalizeLanguageFields(meta.language_fields);
    const termFields = normalizeTermFields(meta.term_fields);
    const entryValues = entryFieldDefs.map((field) => toText(entryFields[field.name] ?? ""));

    const appendRow = (langRaw: string, termRaw: string) => {
      const termText = String(termRaw ?? "").trim();
      if (!termText) return;
      const langKey = normalizeLang(langRaw);
      if (!langKey) return;
      const languageTag = normalizeLanguageTag(langRaw) || langKey;
      const langValues = languageFieldDefs.map((field) =>
        toText((languageFields[langKey] ?? {})[field.name] ?? "")
      );
      const termCustomFields = termFields[langKey]?.[termText] ?? {};
      const termAuditRaw = termAuditMap[langKey]?.[termText] ?? {};
      const termAudit = mergeAudit(termAuditRaw, entryAudit);
      const termValues = termFieldDefs.map((field) => {
        let raw = termCustomFields[field.name];
        if (raw === undefined && isPartOfSpeechExportField(field.name) && meta.partOfSpeech) {
          raw = meta.partOfSpeech;
        }
        return toText(raw ?? "");
      });

      csv += toCsvLine([
        String(row.id ?? ""),
        String(row.concept_id ?? ""),
        languageTag,
        termText,
        status,
        entryAudit.createdAt ?? "",
        entryAudit.createdBy ?? "",
        entryAudit.modifiedAt ?? "",
        entryAudit.modifiedBy ?? "",
        termAudit.createdAt ?? "",
        termAudit.createdBy ?? "",
        termAudit.modifiedAt ?? "",
        termAudit.modifiedBy ?? "",
        ...entryValues,
        ...langValues,
        ...termValues
      ]);
    };

    appendRow(row.source_lang, row.term);
    appendRow(row.target_lang, row.translation);
  }

  return csv;
}

export function pickPrimaryTerm(terms: TermDetail[]): string | null {
  if (!terms || terms.length === 0) return null;
  const preferred = terms.find((term) => term.status === "preferred");
  return preferred?.text || terms[0]?.text || null;
}

export function uniqueTerms(
  rows: GlossaryEntryRow[],
  glossaryId: number,
  termFields?: TermFieldsMap,
  termAudit?: TermAuditMap
) {
  const languageMap = new Map<
    string,
    Map<
      string,
      TermDetail & { metaPriority: number }
    >
  >();

  const addTerm = (lang: string, text: string, row: GlossaryEntryRow, priority: number) => {
    const normalized = normalizeLang(lang);
    const trimmed = String(text ?? "").trim();
    if (!normalized || !trimmed) return;
    let byText = languageMap.get(normalized);
    if (!byText) {
      byText = new Map();
      languageMap.set(normalized, byText);
    }
    const meta = normalizeMeta(row.meta_json);
    const status = statusFromMeta(meta);
    const partOfSpeech = meta.partOfSpeech ? String(meta.partOfSpeech) : null;
    const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : null;
    const termCustom = termFields?.[normalized]?.[trimmed];
    const customFields = termCustom ? normalizeFieldMap(termCustom) : {};
    const auditFromMeta = termAudit?.[normalized]?.[trimmed] ?? {};
    const entryAudit = mergeAudit(
      normalizeAuditMeta(meta.audit ?? meta.entry_audit ?? meta.entryAudit ?? null),
      mergeAudit(auditFromOriginMeta(meta), auditFromRow(row))
    );
    const auditCandidate = mergeAudit(auditFromMeta, entryAudit);
    const auditValue = hasAudit(auditCandidate) ? auditCandidate : null;
    const existing = byText.get(trimmed);
    if (!existing) {
      byText.set(trimmed, {
        termId: encodeTermKey({
          glossaryId,
          conceptId: conceptKeyForRow(row),
          lang: normalized,
          text: trimmed
        }),
        text: trimmed,
        status,
        notes: row.notes ?? null,
        partOfSpeech,
        customFields: Object.keys(customFields).length > 0 ? customFields : null,
        updatedAt,
        audit: auditValue,
        metaPriority: priority
      });
      return;
    }
    if (priority > existing.metaPriority) {
      existing.status = status;
      existing.partOfSpeech = partOfSpeech;
      if (row.notes) existing.notes = row.notes;
      existing.metaPriority = priority;
    } else {
      if (!existing.notes && row.notes) existing.notes = row.notes;
      if (!existing.partOfSpeech && partOfSpeech) existing.partOfSpeech = partOfSpeech;
      if (existing.status === "allowed" && status !== "allowed") {
        existing.status = status;
      }
    }
    if (Object.keys(customFields).length > 0) {
      const merged = normalizeFieldMap(existing.customFields);
      mergeFieldMap(merged, customFields);
      existing.customFields = Object.keys(merged).length > 0 ? merged : null;
    }
    if (auditValue) {
      existing.audit = mergeAuditAggregate(existing.audit ?? {}, auditValue);
    }
    if (updatedAt && (!existing.updatedAt || updatedAt > existing.updatedAt)) {
      existing.updatedAt = updatedAt;
    }
  };

  for (const row of rows) {
    addTerm(row.source_lang, row.term, row, 2);
    addTerm(row.target_lang, row.translation, row, 1);
  }

  const sections = Array.from(languageMap.entries()).map(([lang, termsMap]) => {
    const terms = Array.from(termsMap.values())
      .sort((a, b) => a.text.localeCompare(b.text))
      .map(({ metaPriority, ...term }) => term);
    return { language: lang, terms };
  });

  return sections.sort((a, b) => a.language.localeCompare(b.language));
}

export function aggregateCustomFields(rows: GlossaryEntryRow[]) {
  const entryFields: CustomFields = {};
  const languageFields: LanguageFieldsMap = {};
  const termFields: TermFieldsMap = {};

  rows.forEach((row) => {
    const meta = normalizeMeta(row.meta_json);
    mergeFieldMap(entryFields, normalizeFieldMap(meta.entry_fields));
    mergeLanguageFields(languageFields, meta.language_fields);
    mergeTermFields(termFields, meta.term_fields);
  });

  return { entryFields, languageFields, termFields };
}

export function aggregateEntryAudit(rows: GlossaryEntryRow[]): AuditMeta | null {
  let explicit: AuditMeta = {};
  rows.forEach((row) => {
    const meta = normalizeMeta(row.meta_json);
    const rowAudit = mergeAudit(
      normalizeAuditMeta(meta.audit ?? meta.entry_audit ?? meta.entryAudit ?? null),
      auditFromOriginMeta(meta)
    );
    explicit = mergeAudit(explicit, rowAudit);
  });

  let earliestAt: string | null = null;
  let earliestBy: string | null = null;
  let latestAt: string | null = null;
  let latestBy: string | null = null;
  rows.forEach((row) => {
    const createdAt = toIsoOrNull(row.created_at);
    if (createdAt && (!earliestAt || createdAt < earliestAt)) {
      earliestAt = createdAt;
      earliestBy = row.created_by ?? earliestBy;
    }
    const updatedAt = toIsoOrNull(row.updated_at);
    if (updatedAt && (!latestAt || updatedAt > latestAt)) {
      latestAt = updatedAt;
      latestBy = row.updated_by ?? latestBy;
    }
  });

  const fallback: AuditMeta = {};
  if (earliestAt) fallback.createdAt = earliestAt;
  if (earliestBy) fallback.createdBy = earliestBy;
  if (latestAt) fallback.modifiedAt = latestAt;
  if (latestBy) fallback.modifiedBy = latestBy;

  const merged = mergeAudit(explicit, fallback);
  return hasAudit(merged) ? merged : null;
}

export function aggregateTermAudit(rows: GlossaryEntryRow[]): TermAuditMap {
  const termAudit: TermAuditMap = {};
  rows.forEach((row) => {
    const meta = normalizeMeta(row.meta_json);
    mergeTermAuditMap(termAudit, meta.term_audit ?? meta.termAudit ?? null);
  });
  return termAudit;
}

export async function ensureConceptId(glossaryId: number, entryId: string) {
  if (!entryId.startsWith("row-")) return;
  await db.query(
    `UPDATE glossary_entries
     SET concept_id = $1
     WHERE glossary_id = $2
       AND concept_id IS NULL
       AND CONCAT('row-', id) = $1`,
    [entryId, glossaryId]
  );
}

export async function ensureGlossaryLanguages(glossaryId: number, languages: string[], actor: string | null) {
  if (languages.length === 0) return;
  const res = await db.query<GlossaryRow>(
    `SELECT id, languages FROM glossaries WHERE id = $1`,
    [glossaryId]
  );
  const row = res.rows[0];
  if (!row) return;
  const current = normalizeLanguages(row.languages);
  const next = Array.from(new Set([...current, ...languages.map(normalizeLang).filter(Boolean)])).filter(Boolean);
  if (next.length === current.length) return;
  await db.query(
    `UPDATE glossaries
     SET languages = $1, updated_by = COALESCE($2, updated_by), updated_at = NOW()
     WHERE id = $3`,
    [JSON.stringify(next), actor, glossaryId]
  );
}

export async function loadEntryIllustration(glossaryId: number, entryId: string): Promise<TermbaseIllustration | null> {
  const mediaRes = await db.query<{ storage_path: string; original_filename: string | null }>(
    `SELECT storage_path, original_filename
     FROM glossary_entry_media
     WHERE glossary_id = $1
       AND (
         concept_id = $2
         OR entry_id IN (
           SELECT id FROM glossary_entries
           WHERE glossary_id = $1
             AND (concept_id = $2 OR (concept_id IS NULL AND CONCAT('row-', id) = $2))
         )
       )
     ORDER BY id ASC
     LIMIT 1`,
    [glossaryId, entryId]
  );
  const row = mediaRes.rows[0];
  if (!row || !row.storage_path) return null;
  const filename = row.original_filename
    ? String(row.original_filename)
    : String(row.storage_path).split("/").pop() || "illustration";
  try {
    const presigned = await presignGetObject({ key: row.storage_path, downloadFilename: filename });
    return { filename, url: presigned.url };
  } catch {
    return { filename, url: null };
  }
}

export function parseIllustrationValue(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const first = raw
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)[0];
  return first ?? null;
}

export function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

export async function resolveIllustrationFromField(
  glossaryId: number,
  value: string
): Promise<TermbaseIllustration | null> {
  const cleaned = parseIllustrationValue(value);
  if (!cleaned) return null;
  if (isLikelyUrl(cleaned)) {
    return { filename: cleaned, url: cleaned };
  }
  const key = keyTerminologyImage({ glossaryId, filename: cleaned });
  try {
    const presigned = await presignGetObject({ key, downloadFilename: cleaned });
    return { filename: cleaned, url: presigned.url };
  } catch {
    return { filename: cleaned, url: null };
  }
}


