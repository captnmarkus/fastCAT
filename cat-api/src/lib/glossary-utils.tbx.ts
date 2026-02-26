import { toIsoOrNull, toText, xmlEscape } from "../utils.js";
import { normalizeLanguageTag } from "./language-catalog.js";
import { LANGUAGE_NAME_MAP } from "./language-normalization.js";
import { normalizeStructureFields } from "./termbase-import.js";
import type { ParsedGlossaryEntry } from "./glossary-utils.js";
type ExportStructureField = { name: string };
type ExportStructure = {
  entry: ExportStructureField[];
  language: ExportStructureField[];
  term: ExportStructureField[];
};

type CustomFieldMap = Record<string, any>;
type LanguageFieldMap = Record<string, CustomFieldMap>;
type TermFieldMap = Record<string, Record<string, CustomFieldMap>>;
export type AuditMeta = {
  createdAt?: string | null;
  createdBy?: string | null;
  modifiedAt?: string | null;
  modifiedBy?: string | null;
};
export type TermAuditMap = Record<string, Record<string, AuditMeta>>;

export function normalizeAuditValue(value: any): string | null {
  const text = toText(value).trim();
  return text ? text : null;
}

function normalizeAuditMeta(value: any): AuditMeta {
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

function auditFromOriginMeta(meta: Record<string, any>): AuditMeta {
  const createdAt = normalizeAuditValue(meta.originDate ?? meta.origin_date ?? meta.originCreatedAt ?? meta.origin_created_at);
  const createdBy = normalizeAuditValue(meta.originAuthor ?? meta.origin_author ?? meta.originator ?? meta.origin_by);
  const audit: AuditMeta = {};
  if (createdAt) audit.createdAt = createdAt;
  if (createdBy) audit.createdBy = createdBy;
  return audit;
}

function normalizeTermAuditMap(value: any): TermAuditMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: TermAuditMap = {};
  Object.entries(value as Record<string, any>).forEach(([lang, terms]) => {
    const normalizedLang = normalizeLanguageTag(String(lang ?? ""));
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

export function hasAudit(audit: AuditMeta): boolean {
  return Boolean(audit.createdAt || audit.createdBy || audit.modifiedAt || audit.modifiedBy);
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

function normalizeMeta(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function normalizeFieldMap(value: any): CustomFieldMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: CustomFieldMap = {};
  Object.entries(value as Record<string, any>).forEach(([key, val]) => {
    const name = String(key ?? "").trim();
    if (!name) return;
    result[name] = val;
  });
  return result;
}

function normalizeLanguageFields(value: any): LanguageFieldMap {
  const raw = normalizeFieldMap(value);
  const result: LanguageFieldMap = {};
  Object.entries(raw).forEach(([lang, fields]) => {
    const normalizedLang = normalizeLanguageTag(String(lang ?? ""));
    if (!normalizedLang) return;
    result[normalizedLang] = normalizeFieldMap(fields);
  });
  return result;
}

function normalizeTermFields(value: any): TermFieldMap {
  const raw = normalizeFieldMap(value);
  const result: TermFieldMap = {};
  Object.entries(raw).forEach(([lang, terms]) => {
    const normalizedLang = normalizeLanguageTag(String(lang ?? ""));
    if (!normalizedLang) return;
    const rawTerms = normalizeFieldMap(terms);
    const termMap: Record<string, CustomFieldMap> = {};
    Object.entries(rawTerms).forEach(([term, fields]) => {
      const termKey = String(term ?? "").trim();
      if (!termKey) return;
      termMap[termKey] = normalizeFieldMap(fields);
    });
    result[normalizedLang] = termMap;
  });
  return result;
}

function normalizeFieldKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeAuditKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function auditKeyFromAdminType(value: string): keyof AuditMeta | null {
  const key = normalizeAuditKey(value);
  if (!key) return null;
  if (
    key === "creationdate" ||
    key === "createdate" ||
    key === "createdatetime" ||
    key === "createdat" ||
    key === "createdon" ||
    key === "creationtime" ||
    key === "creationtimestamp"
  ) {
    return "createdAt";
  }
  if (
    key === "createdby" ||
    key === "creator" ||
    key === "author" ||
    key === "createdbyname" ||
    key === "originator"
  ) {
    return "createdBy";
  }
  if (
    key === "modificationdate" ||
    key === "modifieddate" ||
    key === "lastmodifieddate" ||
    key === "lastmodificationdate" ||
    key === "modifiedat" ||
    key === "updatedat" ||
    key === "modificationtime" ||
    key === "modificationtimestamp"
  ) {
    return "modifiedAt";
  }
  if (
    key === "modifiedby" ||
    key === "lastmodifiedby" ||
    key === "lastmodificationby" ||
    key === "updatedby" ||
    key === "modifier" ||
    key === "lastmodifier"
  ) {
    return "modifiedBy";
  }
  return null;
}

export function auditKindFromTransacType(value: string): "created" | "modified" | null {
  const key = normalizeAuditKey(value);
  if (!key) return null;
  if (key.includes("origin") || key.includes("create")) return "created";
  if (key.includes("modif") || key.includes("update")) return "modified";
  return null;
}

function isStatusField(value: string): boolean {
  return normalizeFieldKey(value) === "status";
}

function isPartOfSpeechField(value: string): boolean {
  const normalized = normalizeFieldKey(value);
  return normalized === "partofspeech" || normalized === "pos";
}

function statusFromMeta(meta: Record<string, any>) {
  if (meta.forbidden === true) return "forbidden";
  if (meta.preferred === true) return "preferred";
  return "allowed";
}

function buildDescripBlocks(params: {
  fields: ExportStructureField[];
  values: CustomFieldMap;
  indent: string;
  fallback?: (fieldName: string) => unknown;
}): string {
  return params.fields
    .map((field) => {
      const raw =
        params.values[field.name] !== undefined
          ? params.values[field.name]
          : params.fallback
            ? params.fallback(field.name)
            : undefined;
      const text = toText(raw);
      if (!text.trim()) return "";
      return `${params.indent}<descrip type="${xmlEscape(field.name)}">${xmlEscape(text)}</descrip>`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildAdminBlocks(audit: AuditMeta, indent: string): string {
  if (!hasAudit(audit)) return "";
  const blocks: string[] = [];
  if (audit.createdAt) {
    blocks.push(`${indent}<admin type="creationDate">${xmlEscape(audit.createdAt)}</admin>`);
  }
  if (audit.createdBy) {
    blocks.push(`${indent}<admin type="createdBy">${xmlEscape(audit.createdBy)}</admin>`);
  }
  if (audit.modifiedAt) {
    blocks.push(`${indent}<admin type="modificationDate">${xmlEscape(audit.modifiedAt)}</admin>`);
  }
  if (audit.modifiedBy) {
    blocks.push(`${indent}<admin type="modifiedBy">${xmlEscape(audit.modifiedBy)}</admin>`);
  }
  return blocks.join("\n");
}

export function buildGlossaryTbx(
  entries: any[],
  options?: { structure?: any }
): string {
  const normalizedStructure: ExportStructure = normalizeStructureFields(options?.structure);
  const entryFieldDefs = normalizedStructure.entry || [];
  const languageFieldDefs = normalizedStructure.language || [];
  const termFieldDefs = (normalizedStructure.term || []).filter(
    (field) => !isStatusField(field.name)
  );

  const body = entries
    .map((entry, idx) => {
      const srcLang = String(entry.source_lang ?? "").trim();
      const tgtLang = String(entry.target_lang ?? "").trim();
      if (!srcLang || !tgtLang) return "";

      const meta = normalizeMeta(entry.meta_json);
      const entryFieldMap = normalizeFieldMap(meta.entry_fields);
      const languageFieldMap = normalizeLanguageFields(meta.language_fields);
      const termFieldMap = normalizeTermFields(meta.term_fields);
      const entryAuditRaw = normalizeAuditMeta(meta.audit ?? meta.entry_audit ?? meta.entryAudit ?? null);
      const entryAudit = mergeAudit(
        entryAuditRaw,
        mergeAudit(auditFromOriginMeta(meta), {
          createdAt: toIsoOrNull(entry.created_at),
          createdBy: entry.created_by ?? null,
          modifiedAt: toIsoOrNull(entry.updated_at),
          modifiedBy: entry.updated_by ?? null
        })
      );
      const termAuditMap = normalizeTermAuditMap(meta.term_audit ?? meta.termAudit ?? null);
      const status = statusFromMeta(meta);

      const entryDescrips = buildDescripBlocks({
        fields: entryFieldDefs,
        values: entryFieldMap,
        indent: "          "
      });
      const entryDescripBlock = entryDescrips ? `\n${entryDescrips}` : "";
      const entryAdmin = buildAdminBlocks(entryAudit, "          ");
      const entryAdminBlock = entryAdmin ? `\n${entryAdmin}` : "";

      const sourceKey = normalizeLanguageTag(srcLang);
      const targetKey = normalizeLanguageTag(tgtLang);
      const sourceTerm = String(entry.term ?? "").trim();
      const targetTerm = String(entry.translation ?? "").trim();

      const sourceLanguageFields = sourceKey ? languageFieldMap[sourceKey] ?? {} : {};
      const targetLanguageFields = targetKey ? languageFieldMap[targetKey] ?? {} : {};
      const sourceTermFields =
        sourceKey && sourceTerm ? termFieldMap[sourceKey]?.[sourceTerm] ?? {} : {};
      const targetTermFields =
        targetKey && targetTerm ? termFieldMap[targetKey]?.[targetTerm] ?? {} : {};

      const termFallback = (fieldName: string) => {
        if (isPartOfSpeechField(fieldName)) return meta.partOfSpeech;
        return undefined;
      };

      const entryId = entry.concept_id ? String(entry.concept_id) : String(entry.id || idx + 1);
      const originAuthor = toText(entry.origin_author || meta.originAuthor || entryAudit.createdBy || entry.created_by || "system").trim() || "system";
      const originDate = toText(entry.origin_date || meta.originDate || entryAudit.createdAt || entry.created_at || new Date().toISOString()).trim() || new Date().toISOString();
      const lastAuthor = toText(entryAudit.modifiedBy || entry.created_by || originAuthor).trim() || originAuthor;
      const lastDate = toText(entryAudit.modifiedAt || entry.created_at || originDate).trim() || originDate;
      const needsModificationBlock =
        String(entry.source_type || "").toLowerCase() === "modification" ||
        lastAuthor !== originAuthor;

      const modificationBlock = needsModificationBlock
        ? `\n          <transacGrp>\n            <transac type="modification">${xmlEscape(
            lastAuthor
          )}</transac>\n            <date>${xmlEscape(lastDate)}</date>\n          </transacGrp>`
        : "";

      return `      <conceptGrp>
        <concept id="entry-${xmlEscape(entryId)}">
          <transacGrp>
            <transac type="origination">${xmlEscape(originAuthor)}</transac>
            <date>${xmlEscape(originDate)}</date>
          </transacGrp>${modificationBlock}${entryAdminBlock}${entryDescripBlock}
        </concept>
        ${buildLanguageGroup({
        code: srcLang,
        term: sourceTerm,
        status,
        languageFieldDefs,
        termFieldDefs,
        languageFields: sourceLanguageFields,
        termFields: sourceTermFields,
        termFallback,
        termAudit: mergeAudit(
          termAuditMap[sourceKey ?? ""]?.[sourceTerm] ?? {},
          entryAudit
        )
      })}
        ${buildLanguageGroup({
        code: tgtLang,
        term: targetTerm,
        status,
        languageFieldDefs,
        termFieldDefs,
        languageFields: targetLanguageFields,
        termFields: targetTermFields,
        termFallback,
        termAudit: mergeAudit(
          termAuditMap[targetKey ?? ""]?.[targetTerm] ?? {},
          entryAudit
        )
      })}
      </conceptGrp>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<martif type="TBX" xml:lang="en">
  <text>
    <body>
${body}
    </body>
  </text>
</martif>`;
}

function buildLanguageGroup(params: {
  code: string;
  term: string;
  status: string;
  languageFieldDefs: ExportStructureField[];
  termFieldDefs: ExportStructureField[];
  languageFields: CustomFieldMap;
  termFields: CustomFieldMap;
  termFallback?: (fieldName: string) => unknown;
  termAudit?: AuditMeta;
}): string {
  const termValue = String(params.term ?? "").trim();
  if (!termValue) return "";

  const normalizedTag = normalizeLanguageTag(params.code) || String(params.code ?? "").trim();
  const displayCode = normalizedTag ? normalizedTag.toUpperCase() : "UN";

  const languageDescrips = buildDescripBlocks({
    fields: params.languageFieldDefs,
    values: params.languageFields,
    indent: "          "
  });
  const termDescrips = buildDescripBlocks({
    fields: params.termFieldDefs,
    values: params.termFields,
    indent: "            ",
    fallback: params.termFallback
  });
  const termAdmin = buildAdminBlocks(params.termAudit ?? {}, "            ");

  const statusValue = toText(params.status);
  const statusBlock = statusValue.trim()
    ? `\n            <termNote type="status">${xmlEscape(statusValue)}</termNote>`
    : "";
  const languageBlock = languageDescrips ? `\n${languageDescrips}` : "";
  const termBlock = termDescrips ? `\n${termDescrips}` : "";
  const termAdminBlock = termAdmin ? `\n${termAdmin}` : "";

  return `        <languageGrp>
          <language type="${displayCode}" lang="${displayCode}"/>${languageBlock}
          <termGrp>
            <term>${xmlEscape(termValue)}</term>${statusBlock}${termBlock}${termAdminBlock}
          </termGrp>
        </languageGrp>`;
}



