import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import {
  requireAuth,
  getRequestUser,
  requestUserId,
  requestUserDepartmentId,
  ensureProjectAccess,
  ensureProjectReady,
  isAdminUser,
  isManagerUser,
  canAssignProjects,
  requireManagerOrAdmin
} from "../middleware/auth.js";
import type { JwtPayload } from "../middleware/auth.js";
import { parseXliffSegments } from "../lib/xliff.js";
import { fillHtmlTemplate } from "../lib/html.js";
import { segmentHtmlWithTemplate } from "../lib/html-segmentation.js";
import { normalizeParsingTemplateConfig } from "../lib/parsing-templates.js";
import { segmentPlainText, toText } from "../utils.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";
import {
  normalizeEngineDefaultsByTarget,
  normalizeEngineOverrides,
  resolveEngineSelection
} from "../lib/translation-engine-settings.js";
import { enqueuePretranslateJobs } from "../lib/pretranslate-queue.js";
import { enqueueProvisionJob } from "../lib/provision-queue.js";
import { retryProvisionJob } from "../lib/provision-worker.js";
import officeParser from "officeparser";
import { load as loadHtml } from "cheerio";
import path from "path";
import { getRedisClient } from "../redis.js";
import {
  deleteObject,
  getS3Bucket,
  getObjectBuffer,
  presignGetObject,
  presignPutObject,
  putObjectBuffer,
  sha256Hex
} from "../lib/s3.js";
import {
  keyProjectDerivedSegmentsXliff,
  keyProjectDerivedSegmentsXliffRun,
  keyProjectSourceOriginal,
  keyProjectTargetOutput,
  keyProjectTargetOutputRun
} from "../lib/storage-keys.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import {
  addFileToAssigned,
  addProjectToAssigned,
  addProjectToCreated,
  ensureUserBucketsInitialized,
  removeProjectFromAssigned,
  touchProjectForUsers,
  userFilesAssignedKey,
  userProjectsAssignedKey,
  userProjectsCreatedKey
} from "../lib/user-buckets.js";
import {
  normalizeOriginDetails,
  normalizeRichTextRuns,
  normalizeSegmentContext
} from "../lib/rich-text.js";

export type ProjectRow = {
  id: number;
  name: string;
  description?: string | null;
  src_lang: string;
  tgt_lang: string;
  target_langs?: any;
  status: string;
  published_at?: string | null;
  init_error?: string | null;
  provisioning_started_at?: string | null;
  provisioning_updated_at?: string | null;
  provisioning_finished_at?: string | null;
  provisioning_progress?: number | null;
  provisioning_current_step?: string | null;
  created_by: string | null;
  assigned_user: string | null;
  tm_sample: string | null;
  tm_sample_tm_id: number | null;
  glossary_id: number | null;
  department_id?: number | null;
  department_name?: string | null;
  project_settings?: any;
  created_at: string;
  last_modified_at?: string | null;
  error_count?: number | null;
};

export type SegmentRow = {
  id: number;
  project_id: number;
  file_id: number;
  seg_index: number;
  src: string;
  tgt: string | null;
  src_runs?: any;
  tgt_runs?: any;
  segment_context?: any;
  origin_details?: any;
  status: string;
  version: number;
  source_type?: string | null;
  source_score?: number | null;
  source_match_id?: string | null;
};

export type SegmentSourceType = "tmx" | "nmt" | "ntm_draft" | "llm" | "manual" | "none";

export type TermbaseEntryRow = {
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
  updated_at: string | null;
  created_at: string | null;
};

export type TermbaseAudit = {
  createdAt?: string | null;
  createdBy?: string | null;
  modifiedAt?: string | null;
  modifiedBy?: string | null;
};

export type TermbaseMatchTerm = {
  termId: string;
  text: string;
  status: "preferred" | "allowed" | "forbidden";
  notes: string | null;
  partOfSpeech: string | null;
  fields?: Record<string, any> | null;
  updatedAt: string | null;
  audit?: TermbaseAudit | null;
};

export type TermbaseMatchSection = {
  language: string;
  terms: TermbaseMatchTerm[];
  fields?: Record<string, any> | null;
};

export type TermbaseMatchEntry = {
  entryId: string;
  entry: {
    fields?: Record<string, any> | null;
    audit?: TermbaseAudit | null;
  };
  source?: TermbaseMatchSection | null;
  target?: TermbaseMatchSection | null;
  illustration?: { filename: string; url: string | null } | null;
};

export type TermbaseFieldMap = Record<string, any>;
export type TermbaseLanguageFields = Record<string, TermbaseFieldMap>;
export type TermbaseTermFields = Record<string, Record<string, TermbaseFieldMap>>;
export type TermbaseTermAudit = Record<string, Record<string, TermbaseAudit>>;

export function parseSourceType(input: any): SegmentSourceType | null {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;
  if (value === "tmx" || value === "tm") return "tmx";
  if (value === "nmt" || value === "mt") return "nmt";
  if (value === "ntm_draft" || value === "ntm draft" || value === "ntm-draft") return "ntm_draft";
  if (value === "llm" || value === "llm_draft" || value === "llm draft" || value === "llm-draft") return "llm";
  if (value === "manual" || value === "human") return "manual";
  if (value === "none" || value === "-") return "none";
  return null;
}

export function coerceSourceType(input: any): SegmentSourceType {
  return parseSourceType(input) ?? "none";
}

export async function resolveUserRef(value: unknown): Promise<string | null> {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    if (!Number.isFinite(id)) return null;
    const res = await db.query<{ username: string }>(
      "SELECT username FROM users WHERE id = $1",
      [id]
    );
    const username = res.rows[0]?.username;
    return username ? String(username).trim() : null;
  }

  const normalized = raw.toLowerCase();
  const res = await db.query<{ username: string }>(
    "SELECT username FROM users WHERE username = $1",
    [normalized]
  );
  const username = res.rows[0]?.username;
  return username ? String(username).trim() : null;
}

export async function requesterMatchesUser(requester: JwtPayload | undefined, assigned: string | null): Promise<boolean> {
  if (!assigned) return false;
  const requesterId = requestUserId(requester);
  if (!requesterId) return false;
  const normalizedAssigned = String(assigned).trim().toLowerCase();
  const normalizedRequester = String(requesterId).trim().toLowerCase();
  if (!normalizedAssigned || !normalizedRequester) return false;
  if (normalizedAssigned === normalizedRequester) return true;
  const resolved = await resolveUserRef(requesterId);
  return resolved ? normalizedAssigned === String(resolved).trim().toLowerCase() : false;
}

export async function resolveUserDepartmentId(username: string): Promise<number | null> {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return null;
  const res = await db.query<{ department_id: number | null }>(
    "SELECT department_id FROM users WHERE username = $1",
    [normalized]
  );
  const raw = res.rows[0]?.department_id;
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function resolveUserRole(username: string): Promise<string | null> {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return null;
  const res = await db.query<{ role: string | null }>(
    "SELECT role FROM users WHERE username = $1",
    [normalized]
  );
  const raw = res.rows[0]?.role;
  const normalizedRole = raw ? String(raw).trim().toLowerCase() : null;
  if (normalizedRole === "user") return "reviewer";
  return normalizedRole;
}

export function normalizeJsonObject(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

export function parseOptionalInt(value: any): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function parseOptionalBool(value: any): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return null;
}

export function normalizeLang(value: any): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeLangList(value: any): string[] {
  if (!value) return [];
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = normalizeLang(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function normalizeTermbaseLang(value: any): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return normalizeLanguageTag(raw);
}

export function normalizeTermbaseMeta(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

export function normalizeFieldMap(value: any): TermbaseFieldMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: TermbaseFieldMap = {};
  Object.entries(value as Record<string, any>).forEach(([key, val]) => {
    const name = String(key ?? "").trim();
    if (!name) return;
    result[name] = val;
  });
  return result;
}

export function mergeFieldMap(target: TermbaseFieldMap, patch: TermbaseFieldMap) {
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    target[key] = value;
  });
}

export function normalizeLanguageFields(value: any): TermbaseLanguageFields {
  const raw = normalizeFieldMap(value);
  const result: TermbaseLanguageFields = {};
  Object.entries(raw).forEach(([lang, fields]) => {
    const normalizedLang = normalizeTermbaseLang(lang);
    if (!normalizedLang) return;
    result[normalizedLang] = normalizeFieldMap(fields);
  });
  return result;
}

export function normalizeTermFields(value: any): TermbaseTermFields {
  const raw = normalizeFieldMap(value);
  const result: TermbaseTermFields = {};
  Object.entries(raw).forEach(([lang, terms]) => {
    const normalizedLang = normalizeTermbaseLang(lang);
    if (!normalizedLang) return;
    const rawTerms = normalizeFieldMap(terms);
    const termMap: Record<string, TermbaseFieldMap> = {};
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

export function normalizeAuditMeta(value: any): TermbaseAudit {
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
  const audit: TermbaseAudit = {};
  if (createdAt) audit.createdAt = createdAt;
  if (createdBy) audit.createdBy = createdBy;
  if (modifiedAt) audit.modifiedAt = modifiedAt;
  if (modifiedBy) audit.modifiedBy = modifiedBy;
  return audit;
}

export function normalizeTermAuditMap(value: any): TermbaseTermAudit {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: TermbaseTermAudit = {};
  Object.entries(value as Record<string, any>).forEach(([lang, terms]) => {
    const normalizedLang = normalizeTermbaseLang(lang);
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

export function mergeAudit(primary: TermbaseAudit, fallback: TermbaseAudit): TermbaseAudit {
  const audit: TermbaseAudit = {};
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

export function hasAudit(audit: TermbaseAudit): boolean {
  return Boolean(audit.createdAt || audit.createdBy || audit.modifiedAt || audit.modifiedBy);
}

export function toIsoOrNull(value: any): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function auditFromRow(row: TermbaseEntryRow): TermbaseAudit {
  const audit: TermbaseAudit = {};
  const createdAt = toIsoOrNull(row.created_at);
  const modifiedAt = toIsoOrNull(row.updated_at);
  if (createdAt) audit.createdAt = createdAt;
  if (row.created_by) audit.createdBy = row.created_by;
  if (modifiedAt) audit.modifiedAt = modifiedAt;
  if (row.updated_by) audit.modifiedBy = row.updated_by;
  return audit;
}

export function mergeAuditAggregate(current: TermbaseAudit | null | undefined, incoming: TermbaseAudit): TermbaseAudit {
  const merged: TermbaseAudit = { ...(current ?? {}) };
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

export function statusFromMeta(meta: Record<string, any>): "preferred" | "allowed" | "forbidden" {
  if (meta.forbidden === true) return "forbidden";
  if (meta.preferred === true) return "preferred";
  return "allowed";
}

export function toBase64Url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function encodeTermKey(params: { glossaryId: number; conceptId: string; lang: string; text: string }) {
  return `t_${toBase64Url(JSON.stringify(params))}`;
}

export function conceptKeyForRow(row: { concept_id: string | null; id: number }) {
  return row.concept_id ? String(row.concept_id) : `row-${row.id}`;
}

export function uniqueTerms(
  rows: TermbaseEntryRow[],
  glossaryId: number,
  termFields?: TermbaseTermFields,
  termAudit?: TermbaseTermAudit
) {
  const languageMap = new Map<string, Map<string, TermbaseMatchTerm & { metaPriority: number }>>();

  const addTerm = (lang: string, text: string, row: TermbaseEntryRow, priority: number) => {
    const normalized = normalizeTermbaseLang(lang);
    const trimmed = String(text ?? "").trim();
    if (!normalized || !trimmed) return;
    let byText = languageMap.get(normalized);
    if (!byText) {
      byText = new Map();
      languageMap.set(normalized, byText);
    }
    const meta = normalizeTermbaseMeta(row.meta_json);
    const status = statusFromMeta(meta);
    const partOfSpeech = meta.partOfSpeech ? String(meta.partOfSpeech) : null;
    const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : null;
    const termCustom = termFields?.[normalized]?.[trimmed];
    const fields = termCustom ? normalizeFieldMap(termCustom) : {};
    const auditFromMeta = termAudit?.[normalized]?.[trimmed] ?? {};
    const auditCandidate = mergeAudit(auditFromMeta, auditFromRow(row));
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
        fields: Object.keys(fields).length > 0 ? fields : null,
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
    if (Object.keys(fields).length > 0) {
      const merged = normalizeFieldMap(existing.fields);
      mergeFieldMap(merged, fields);
      existing.fields = Object.keys(merged).length > 0 ? merged : null;
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

export function aggregateCustomFields(rows: TermbaseEntryRow[]) {
  const entryFields: TermbaseFieldMap = {};
  const languageFields: TermbaseLanguageFields = {};
  const termFields: TermbaseTermFields = {};

  rows.forEach((row) => {
    const meta = normalizeTermbaseMeta(row.meta_json);
    mergeFieldMap(entryFields, normalizeFieldMap(meta.entry_fields));
    const langFields = normalizeLanguageFields(meta.language_fields);
    Object.entries(langFields).forEach(([lang, fields]) => {
      const current = languageFields[lang] ?? {};
      mergeFieldMap(current, fields);
      languageFields[lang] = current;
    });
    const termFieldMap = normalizeTermFields(meta.term_fields);
    Object.entries(termFieldMap).forEach(([lang, terms]) => {
      const currentLang = termFields[lang] ?? {};
      Object.entries(terms).forEach(([term, fields]) => {
        const currentTerm = currentLang[term] ?? {};
        mergeFieldMap(currentTerm, fields);
        currentLang[term] = currentTerm;
      });
      termFields[lang] = currentLang;
    });
  });

  return { entryFields, languageFields, termFields };
}

export function aggregateEntryAudit(rows: TermbaseEntryRow[]): TermbaseAudit | null {
  let explicit: TermbaseAudit = {};
  rows.forEach((row) => {
    const meta = normalizeTermbaseMeta(row.meta_json);
    const rowAudit = normalizeAuditMeta(meta.audit ?? meta.entry_audit ?? meta.entryAudit ?? null);
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

  const fallback: TermbaseAudit = {};
  if (earliestAt) fallback.createdAt = earliestAt;
  if (earliestBy) fallback.createdBy = earliestBy;
  if (latestAt) fallback.modifiedAt = latestAt;
  if (latestBy) fallback.modifiedBy = latestBy;

  const merged = mergeAudit(explicit, fallback);
  return hasAudit(merged) ? merged : null;
}

export function aggregateTermAudit(rows: TermbaseEntryRow[]): TermbaseTermAudit {
  const termAudit: TermbaseTermAudit = {};
  rows.forEach((row) => {
    const meta = normalizeTermbaseMeta(row.meta_json);
    const normalized = normalizeTermAuditMap(meta.term_audit ?? meta.termAudit ?? null);
    Object.entries(normalized).forEach(([lang, terms]) => {
      const currentLang = termAudit[lang] ?? {};
      Object.entries(terms).forEach(([term, audit]) => {
        const existing = currentLang[term] ?? {};
        currentLang[term] = mergeAudit(existing, audit);
      });
      termAudit[lang] = currentLang;
    });
  });
  return termAudit;
}

export function getFileTypeConfigParsingTemplateId(cfg: any, fileType: "html" | "xml"): number | null {
  const root = normalizeJsonObject(cfg);
  const section = fileType === "xml" ? normalizeJsonObject(root.xml) : normalizeJsonObject(root.html);
  return parseOptionalInt(
    section.parsingTemplateId ?? root.parsingTemplateId ?? root.htmlParsingTemplateId ?? root.parsing_template_id
  );
}

export function resolveUploadFileType(filename: string): "html" | "xml" | "pdf" | "docx" | "pptx" | "xlsx" | null {
  const ext = path.extname(filename || "").toLowerCase();
  if (!ext) return null;
  if (ext === ".html" || ext === ".htm" || ext === ".xhtml" || ext === ".xtml") return "html";
  if (ext === ".xml" || ext === ".xlf" || ext === ".xliff") return "xml";
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc" || ext === ".docx") return "docx";
  if (ext === ".ppt" || ext === ".pptx") return "pptx";
  if (ext === ".xls" || ext === ".xlsx") return "xlsx";
  return null;
}

export function projectDepartmentId(row: any): number {
  const raw = (row as any)?.department_id;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 1;
}

export async function rowToProject(row: ProjectRow) {
  const rawTargets = Array.isArray((row as any).target_langs) ? (row as any).target_langs : [];
  const targetLangs = rawTargets
    .map((lang: any) => String(lang || "").trim().toLowerCase())
    .filter(Boolean);
  const effectiveTargets = targetLangs.length > 0 ? targetLangs : [row.tgt_lang].filter(Boolean);
  const projectSettings = normalizeJsonObject((row as any).project_settings);
  const dueAtRaw = projectSettings.dueAt ?? projectSettings.due_at ?? null;
  const dueAt = dueAtRaw ? new Date(String(dueAtRaw)) : null;
  const dueAtIso = dueAt && !Number.isNaN(dueAt.valueOf()) ? dueAt.toISOString() : null;
  const departmentId = projectDepartmentId(row);
  let departmentName = row.department_name ?? null;
  if (!departmentName && row.department_id != null) {
    const deptRes = await db.query<{ name: string }>(
      "SELECT name FROM departments WHERE id = $1",
      [departmentId]
    );
    departmentName = deptRes.rows[0]?.name ?? null;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    srcLang: row.src_lang,
    tgtLang: row.tgt_lang,
    targetLangs: effectiveTargets,
    status: row.status,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    initError: row.init_error ?? null,
    provisioningStartedAt: row.provisioning_started_at ? new Date(row.provisioning_started_at).toISOString() : null,
    provisioningUpdatedAt: row.provisioning_updated_at ? new Date(row.provisioning_updated_at).toISOString() : null,
    provisioningFinishedAt: row.provisioning_finished_at ? new Date(row.provisioning_finished_at).toISOString() : null,
    provisioningProgress:
      row.provisioning_progress != null && Number.isFinite(Number(row.provisioning_progress))
        ? Number(row.provisioning_progress)
        : null,
    provisioningCurrentStep: row.provisioning_current_step ? String(row.provisioning_current_step) : null,
    createdBy: row.created_by ?? null,
    assignedUser: row.assigned_user ?? null,
    tmSample: row.tm_sample ?? null,
    tmSampleTmId: row.tm_sample_tm_id ?? null,
    tmSampleSeeded: Boolean(row.tm_sample_tm_id),
    glossaryId: row.glossary_id ?? null,
    departmentId,
    departmentName,
    createdAt: new Date(row.created_at).toISOString(),
    dueAt: dueAtIso,
    lastModifiedAt: row.last_modified_at ? new Date(row.last_modified_at).toISOString() : null,
    errorCount: row.error_count != null ? Number(row.error_count) : null,
    htmlFiles: await listProjectHtmlFiles(row.id)
  };
}

export function listProjectHtmlFiles(projectId: number) {
  return db
    .query<{ id: number; original_name: string }>(
      `SELECT pf.id, pf.original_name
       FROM project_file_html_templates h
       JOIN project_files pf ON pf.id = h.file_id
       WHERE pf.project_id = $1
       ORDER BY pf.created_at`,
      [projectId]
    )
    .then((res) =>
      res.rows.map((row) => ({
        id: Number(row.id),
        originalName: row.original_name
      }))
    );
}

export type ProjectFileListRow = {
  id: number;
  original_name: string;
  created_at: string;
  total: number | null;
  draft: number | null;
  under_review: number | null;
  reviewed: number | null;
};

export type ProjectTaskRow = {
  id: number;
  file_id: number;
  target_lang: string;
  translator_user: string;
  status: string;
  total: number | null;
  draft: number | null;
  under_review: number | null;
  reviewed: number | null;
};

export async function listProjectFiles(projectId: number) {
  const tasksRes = await db.query<ProjectTaskRow>(
    `SELECT t.id,
            t.file_id,
            t.target_lang,
            t.translator_user,
            t.status,
            COALESCE(s.total, 0)::int AS total,
            COALESCE(s.draft, 0)::int AS draft,
            COALESCE(s.under_review, 0)::int AS under_review,
            COALESCE(s.reviewed, 0)::int AS reviewed
     FROM translation_tasks t
     LEFT JOIN (
       SELECT task_id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
              COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
       FROM segments
       WHERE task_id IS NOT NULL
       GROUP BY task_id
     ) s ON s.task_id = t.id
     WHERE t.project_id = $1
     ORDER BY t.file_id ASC, t.target_lang ASC`,
    [projectId]
  );
  const tasksByFileId = new Map<
    number,
    Array<{
      taskId: number;
      targetLang: string;
      assigneeId: string;
      status: string;
      segmentStats: { total: number; draft: number; underReview: number; reviewed: number };
    }>
  >();
  for (const row of tasksRes.rows) {
    const total = Number(row.total ?? 0) || 0;
    const reviewed = Number(row.reviewed ?? 0) || 0;
    const underReview = Number(row.under_review ?? 0) || 0;
    const draft = Number(row.draft ?? 0) || 0;
    let taskStatus: "draft" | "under_review" | "reviewed" | "error" = "draft";
    if (total > 0) {
      if (reviewed >= total) taskStatus = "reviewed";
      else if (underReview > 0 || reviewed > 0) taskStatus = "under_review";
      else if (draft > 0) taskStatus = "draft";
    } else {
      const raw = String(row.status || "").trim().toLowerCase();
      if (raw === "reviewed" || raw === "approved") taskStatus = "reviewed";
      else if (raw === "under_review" || raw === "in_review" || raw === "in_progress") taskStatus = "under_review";
      else if (raw === "error") taskStatus = "error";
    }
    const list = tasksByFileId.get(row.file_id) ?? [];
    list.push({
      taskId: Number(row.id),
      targetLang: String(row.target_lang || "").trim(),
      assigneeId: String(row.translator_user || "").trim(),
      status: taskStatus,
      segmentStats: {
        total,
        draft,
        underReview,
        reviewed
      }
    });
    tasksByFileId.set(row.file_id, list);
  }

  function normalizeTaskStatus(value: string) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "reviewed" || raw === "approved") return "reviewed";
    if (raw === "under_review" || raw === "in_review" || raw === "in_progress") return "under_review";
    if (raw === "error") return "error";
    return "draft";
  }

  function deriveTaskStatus(tasks: Array<{ status: string }>) {
    if (tasks.length === 0) return null;
    const statuses = tasks.map((task) => normalizeTaskStatus(task.status));
    if (statuses.some((status) => status === "error")) return "error";
    if (statuses.every((status) => status === "reviewed")) return "reviewed";
    if (statuses.some((status) => status === "under_review" || status === "reviewed")) return "under_review";
    return "draft";
  }

  const res = await db.query<ProjectFileListRow>(
    `SELECT f.id,
            f.original_name,
            f.created_at,
            COALESCE(s.total, 0)::int AS total,
            COALESCE(s.draft, 0)::int AS draft,
            COALESCE(s.under_review, 0)::int AS under_review,
            COALESCE(s.reviewed, 0)::int AS reviewed
     FROM project_files f
     LEFT JOIN (
       SELECT file_id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
              COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
       FROM segments
       WHERE project_id = $1 AND task_id IS NULL
       GROUP BY file_id
     ) s ON s.file_id = f.id
     WHERE f.project_id = $1
     ORDER BY f.created_at ASC`,
    [projectId]
  );

  return res.rows.map((row) => {
    const filename = String(row.original_name || "");
    const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
    const total = Number(row.total ?? 0) || 0;
    const reviewed = Number(row.reviewed ?? 0) || 0;
    const underReview = Number(row.under_review ?? 0) || 0;
    const draft = Number(row.draft ?? 0) || 0;
    const tasks = tasksByFileId.get(Number(row.id)) ?? [];
    const taskStatus = deriveTaskStatus(tasks);

    let status: "draft" | "under_review" | "reviewed" | "error" = "draft";
    if (taskStatus) {
      status = taskStatus;
    } else if (total === 0) status = "error";
    else if (reviewed >= total) status = "reviewed";
    else if (underReview > 0 || reviewed > 0) status = "under_review";
    else if (draft > 0) status = "draft";

    return {
      fileId: Number(row.id),
      originalFilename: filename,
      type: ext || "file",
      usage: "translatable",
      status,
      createdAt: new Date(row.created_at).toISOString(),
      tasks,
      segmentStats: {
        total,
        draft,
        underReview,
        reviewed
      }
    };
  });
}

export function getProjectRow(projectId: number) {
  return db
    .query<ProjectRow>(
      `SELECT p.id,
              p.name,
              p.description,
              p.src_lang,
              p.tgt_lang,
              p.target_langs,
              p.status,
              p.published_at,
              p.init_error,
              p.provisioning_started_at,
              p.provisioning_updated_at,
              p.provisioning_finished_at,
              p.provisioning_progress,
              p.provisioning_current_step,
              p.created_by,
              p.assigned_user,
              p.tm_sample,
              p.tm_sample_tm_id,
              p.glossary_id,
              p.department_id,
              d.name AS department_name,
              p.project_settings,
              p.created_at
       FROM projects p
       LEFT JOIN departments d ON d.id = p.department_id
       WHERE p.id = $1`,
      [projectId]
    )
    .then((res) => res.rows[0]);
}

export function rowToSegment(row: SegmentRow) {
  const src = String(row.src ?? "");
  const tgt = row.tgt == null ? null : String(row.tgt);
  const srcRuns = normalizeRichTextRuns(row.src_runs, src);
  const tgtRuns = normalizeRichTextRuns(row.tgt_runs, tgt ?? "");
  return {
    id: row.id,
    index: row.seg_index,
    src,
    tgt,
    srcRuns,
    tgtRuns,
    segmentContext: normalizeSegmentContext(row.segment_context ?? {}),
    originDetails: normalizeOriginDetails(row.origin_details ?? {}),
    status: row.status,
    version: row.version ?? 0,
    sourceType: coerceSourceType(row.source_type),
    sourceScore:
      row.source_score == null ? null : Number.isFinite(Number(row.source_score)) ? Number(row.source_score) : null,
    sourceMatchId: row.source_match_id ?? null
  };
}
export {
  DOCX_CONTENT_TYPES_XML,
  DOCX_RELS_XML,
  INLINE_TOKEN_RE,
  OFFICE_UPLOAD_TYPES,
  buildDocxBuffer,
  buildOfficeParserConfig,
  buildPptxBuffer,
  buildTargetFilename,
  buildXlsxBuffer,
  buildXmlOutput,
  contentTypeForExtension,
  escapeXml,
  formatOfficeParseError,
  hasElementChildren,
  isRequestError,
  isTextLikeContentType,
  isUploadError,
  makeRequestError,
  makeUploadError,
  parseNodePath,
  resolveOutputExtension,
  resolveSegmentText,
  safeDispositionFilename,
  sanitizeSegments,
  sanitizeTextForDb,
  selectElementByPath,
  truncateErrorMessage,
  withTimeout
} from "./projects.helpers.output.js";
export type {
  RequestError,
  UploadError,
  UploadType
} from "./projects.helpers.output.js";


