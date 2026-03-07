import { canonicalizeLanguageTag, normalizeLanguageTag, type LanguageCatalogEntry } from "../lib/language-catalog.js";
import { normalizeLanguageInput, normalizeLanguageListInput } from "../lib/language-normalization.js";
import { normalizeFieldLabel } from "../lib/termbase-import.js";
import { resolveLanguageMatch, type OrgLanguageSettings } from "../lib/org-languages.js";
import { toIsoOrNull } from "../utils.js";
import crypto from "crypto";
import ExcelJS from "exceljs";

export type GlossaryRow = {
  id: number;
  label: string;
  filename: string | null;
  description: string | null;
  languages: any;
  visibility: string | null;
  disabled: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

export type GlossaryListItem = {
  id: number;
  label: string;
  filename: string | null;
  description: string | null;
  languages: string[];
  visibility: string | null;
  disabled: boolean;
  uploadedBy: string | null;
  uploadedAt: string;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
  entryCount: number;
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

export const REQUIRED_HEADERS = ["source_lang", "target_lang", "term", "translation"] as const;
export type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

export const HEADER_ALIASES: Record<RequiredHeader, string[]> = {
  source_lang: ["source_lang", "src_lang", "source_language", "source_lang_code", "src_language"],
  target_lang: ["target_lang", "tgt_lang", "target_language", "target_lang_code", "tgt_language"],
  term: ["term", "src_term", "source_term"],
  translation: ["translation", "tgt_term", "target_term"]
};

export const FRIENDLY_HEADER_FORMATS: string[] = [
  REQUIRED_HEADERS.join(","),
  "src_lang,tgt_lang,src_term,tgt_term"
];

export type GlossaryImportType = "csv" | "xlsx" | "tbx" | "mtf_xml" | "xml" | "empty";

export type GlossaryImportMapping = Partial<{
  termId: string;
  sourceLang: string;
  targetLang: string;
  sourceTerm: string;
  targetTerm: string;
  definition: string;
  partOfSpeech: string;
  domain: string;
  context: string;
  usageNote: string;
  forbidden: string;
  preferred: string;
  status: string;
  synonyms: string;
  tags: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  notes: string;
  imageId: string;
  imageFilename: string;
}>;

export type GlossaryImportSettings = {
  synonymSeparator: string;
  multiValueSeparator: string;
  multiLanguageDelimiter: string;
  strictImport: boolean;
};

export type GlossaryImportColumn = { name: string; normalized: string };

export type GlossaryImportEntry = {
  termId: string;
  sourceLang: string;
  targetLang: string;
  term: string;
  translation: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  meta: Record<string, any>;
  imageRef: string | null;
  explicitImageRef: boolean;
};

export type GlossaryImportStats = {
  rowCount: number;
  skippedRows: number;
  missingTermIds: number;
};

export type GlossaryImportParseData = {
  errors: string[];
  warnings: string[];
  entries: GlossaryImportEntry[];
  columns: GlossaryImportColumn[];
  sampleRows: Array<Record<string, string>>;
  detectedLanguages: string[];
  mapping: GlossaryImportMapping;
  stats: GlossaryImportStats;
};

export type GlossaryImportImage = {
  filename: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
};

export const CSV_MAPPING_FIELDS: Array<{
  key: keyof GlossaryImportMapping;
  label: string;
  required?: boolean;
  aliases: string[];
}> = [
  { key: "termId", label: "Term ID", aliases: ["term_id", "concept_id", "entry_id", "id"] },
  { key: "sourceLang", label: "Source language", required: true, aliases: HEADER_ALIASES.source_lang },
  { key: "targetLang", label: "Target language", required: true, aliases: HEADER_ALIASES.target_lang },
  { key: "sourceTerm", label: "Source term", required: true, aliases: HEADER_ALIASES.term },
  { key: "targetTerm", label: "Target term", required: true, aliases: HEADER_ALIASES.translation },
  { key: "definition", label: "Definition", aliases: ["definition", "def", "glossary_definition"] },
  { key: "partOfSpeech", label: "Part of speech", aliases: ["part_of_speech", "pos", "partofspeech"] },
  { key: "domain", label: "Domain/Subject", aliases: ["domain", "subject", "topic"] },
  { key: "context", label: "Context/Example", aliases: ["context", "example", "usage_example"] },
  { key: "usageNote", label: "Usage note", aliases: ["usage_note", "usage", "note_usage"] },
  { key: "forbidden", label: "Forbidden flag", aliases: ["forbidden", "disallow", "do_not_use"] },
  { key: "preferred", label: "Preferred flag", aliases: ["preferred", "allow", "use_preferred"] },
  { key: "status", label: "Status", aliases: ["status", "term_status", "entry_status", "term_status_label"] },
  { key: "synonyms", label: "Synonyms", aliases: ["synonyms", "synonym", "alt_terms", "alternative_terms"] },
  { key: "tags", label: "Tags", aliases: ["tags", "tag", "labels", "label"] },
  { key: "createdBy", label: "Created by", aliases: ["created_by", "author", "creator"] },
  { key: "createdAt", label: "Created at", aliases: ["created_at", "created", "created_on"] },
  { key: "updatedBy", label: "Updated by", aliases: ["updated_by", "modified_by", "last_modified_by"] },
  { key: "updatedAt", label: "Updated at", aliases: ["updated_at", "modified_at", "last_modified_at"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comment", "comments"] },
  { key: "imageId", label: "Image ID", aliases: ["image_id", "imageid", "image_ref", "image_ref_id"] },
  { key: "imageFilename", label: "Image filename", aliases: ["image_filename", "image_file", "image", "image_name"] }
];

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

export function normalizeHeader(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "") // BOM
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function normalizeLang(input: string) {
  return normalizeLanguageInput(input);
}

export function normalizeUser(input: string) {
  return input.trim();
}

export function parseTimestampOrNull(input: string) {
  return toIsoOrNull(input);
}

export function normalizeImportType(value: any): GlossaryImportType | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "csv" || v === "xlsx" || v === "tbx" || v === "mtf_xml" || v === "xml" || v === "empty") return v;
  return null;
}

export function normalizeLanguages(value: any): string[] {
  return normalizeLanguageListInput(value);
}

export async function ensureGlossaryLanguages(
  client: { query: (sql: string, params?: any[]) => Promise<{ rows: Array<{ languages: any }> }> },
  glossaryId: number,
  languages: string[],
  actor: string | null
) {
  if (!languages || languages.length === 0) return;
  const res = await client.query("SELECT languages FROM glossaries WHERE id = $1", [glossaryId]);
  const row = res.rows[0];
  if (!row) return;
  const current = normalizeLanguages(row.languages);
  const normalized = languages.map((lang) => normalizeLang(lang)).filter(Boolean);
  const next = Array.from(new Set([...current, ...normalized])).filter(Boolean);
  if (next.length === current.length) return;
  await client.query(
    `UPDATE glossaries
     SET languages = $1::jsonb, updated_by = COALESCE($2, updated_by), updated_at = NOW()
     WHERE id = $3`,
    [JSON.stringify(next), actor, glossaryId]
  );
}

export function normalizeGlossaryLanguages(value: any): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((v) => normalizeLang(String(v ?? ""))).filter(Boolean)));
  }
  if (value && typeof value === "object") {
    const arr = Array.isArray((value as any).languages) ? (value as any).languages : value;
    if (Array.isArray(arr)) {
      return Array.from(new Set(arr.map((v) => normalizeLang(String(v ?? ""))).filter(Boolean)));
    }
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((v) => normalizeLang(String(v ?? ""))).filter(Boolean)));
      }
    } catch {
      return [];
    }
  }
  return [];
}

export function parseJsonField<T>(input: string | null): T | null {
  if (!input) return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

export const DEFAULT_IMPORT_SETTINGS: GlossaryImportSettings = {
  synonymSeparator: "|",
  multiValueSeparator: ";",
  multiLanguageDelimiter: "||",
  strictImport: true
};

export function normalizeImportSettings(raw: any): GlossaryImportSettings {
  const input = raw && typeof raw === "object" ? raw : {};
  const synonymSeparator = String(input.synonymSeparator ?? input.synonym_separator ?? "").trim();
  const multiValueSeparator = String(input.multiValueSeparator ?? input.multi_value_separator ?? "").trim();
  const multiLanguageDelimiter = String(input.multiLanguageDelimiter ?? input.multi_language_delimiter ?? "").trim();
  const strictImport =
    input.strictImport !== undefined
      ? Boolean(input.strictImport)
      : input.strict_import !== undefined
        ? Boolean(input.strict_import)
        : DEFAULT_IMPORT_SETTINGS.strictImport;

  return {
    synonymSeparator: synonymSeparator || DEFAULT_IMPORT_SETTINGS.synonymSeparator,
    multiValueSeparator: multiValueSeparator || DEFAULT_IMPORT_SETTINGS.multiValueSeparator,
    multiLanguageDelimiter: multiLanguageDelimiter || DEFAULT_IMPORT_SETTINGS.multiLanguageDelimiter,
    strictImport
  };
}

export function mergeImportSettings(
  primary?: Partial<GlossaryImportSettings> | null,
  fallback?: Partial<GlossaryImportSettings> | null
) {
  return normalizeImportSettings({ ...(fallback || {}), ...(primary || {}) });
}

export function normalizeMapping(raw: any, options?: { allowPaths?: boolean }): GlossaryImportMapping {
  const mapping: GlossaryImportMapping = {};
  const allowPaths = options?.allowPaths ?? false;
  if (!raw || typeof raw !== "object") return mapping;
  for (const field of CSV_MAPPING_FIELDS) {
    const value = (raw as any)[field.key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    mapping[field.key] = allowPaths ? trimmed : normalizeHeader(trimmed);
  }
  return mapping;
}

export function suggestMapping(headerIndex: Map<string, number>) {
  const mapping: GlossaryImportMapping = {};
  for (const field of CSV_MAPPING_FIELDS) {
    for (const alias of field.aliases) {
      const normalized = normalizeHeader(alias);
      if (headerIndex.has(normalized)) {
        mapping[field.key] = normalized;
        break;
      }
    }
  }
  return mapping;
}

export function resolveMappingIndex(headerIndex: Map<string, number>, mapped?: string) {
  if (!mapped) return null;
  const key = normalizeHeader(mapped);
  const idx = headerIndex.get(key);
  return idx !== undefined ? idx : null;
}

export function parseBool(value: string): boolean | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return null;
}

export type TermStatus = "preferred" | "allowed" | "forbidden";

export const STATUS_ALIASES: Record<string, TermStatus> = {
  preferred: "preferred",
  pref: "preferred",
  approved: "preferred",
  confirmed: "preferred",
  accepted: "preferred",
  ok: "preferred",
  allow: "allowed",
  allowed: "allowed",
  permitted: "allowed",
  new: "allowed",
  pending: "allowed",
  proposed: "allowed",
  candidate: "allowed",
  forbidden: "forbidden",
  prohibited: "forbidden",
  disallowed: "forbidden",
  "do not use": "forbidden",
  "dont use": "forbidden",
  deprecated: "forbidden",
  rejected: "forbidden"
};

export function normalizeStatusKey(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseStatusValue(input: string): { status: TermStatus | null } {
  const raw = String(input ?? "").trim();
  if (!raw) return { status: null };
  const key = normalizeStatusKey(raw);
  if (!key) return { status: null };
  return { status: STATUS_ALIASES[key] ?? null };
}

export function applyStatusToMeta(meta: Record<string, any>, status: TermStatus | null) {
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
  meta.forbidden = true;
  meta.preferred = false;
}

export function resolveDescripValue(descrips: Record<string, string> | null | undefined, key: string): string | null {
  if (!descrips) return null;
  const direct = descrips[key];
  if (typeof direct === "string" && direct.trim()) return direct;
  const normalizedKey = normalizeFieldLabel(key);
  if (!normalizedKey) return null;
  for (const [rawKey, value] of Object.entries(descrips)) {
    if (normalizeFieldLabel(rawKey) === normalizedKey) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
  }
  return null;
}

export function normalizePicklistKey(input: string) {
  return String(input ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function splitList(value: string, separator?: string): string[] {
  const raw = String(value ?? "");
  if (!raw.trim()) return [];
  const token = String(separator ?? "").trim();
  const parts = token ? raw.split(token) : raw.split(/[,;|]/);
  return parts.map((v) => v.trim()).filter(Boolean);
}

export type LanguageBlock = { lang: string; text: string };

export function parseLanguageBlocks(value: string, delimiter: string): { blocks: LanguageBlock[]; error?: string } | null {
  const raw = String(value ?? "").trim();
  const token = String(delimiter ?? "").trim();
  if (!raw || !token) return null;

  const segments = raw.split(token).map((segment) => segment.trim()).filter(Boolean);
  const hasTag = segments.some((segment) => segment.includes(":") || segment.includes("="));
  if (segments.length <= 1 && !hasTag) return null;

  const blocks: LanguageBlock[] = [];
  for (const segment of segments) {
    const colonIdx = segment.indexOf(":");
    const eqIdx = segment.indexOf("=");
    let splitIdx = -1;
    if (colonIdx >= 0 && eqIdx >= 0) splitIdx = Math.min(colonIdx, eqIdx);
    else splitIdx = colonIdx >= 0 ? colonIdx : eqIdx;
    if (splitIdx <= 0) {
      return { blocks: [], error: "Multi-language cell is missing a language tag." };
    }
    const lang = normalizeLang(segment.slice(0, splitIdx));
    const text = segment.slice(splitIdx + 1).trim();
    if (!lang || !text) {
      return { blocks: [], error: "Multi-language cell has an invalid language tag." };
    }
    blocks.push({ lang, text });
  }

  return { blocks };
}

export function buildLanguageResolver(params: {
  settings: GlossaryImportSettings;
  enabledTags: string[];
  languageSettings: OrgLanguageSettings;
  catalogByTag: Map<string, LanguageCatalogEntry>;
  errors: string[];
  warnings: string[];
  missingLanguageTags?: Set<string>;
}) {
  const enabledTags = Array.from(
    new Set(
      params.enabledTags
        .map((tag) => {
          const canonical = canonicalizeLanguageTag(tag);
          if (!canonical) return "";
          const primary = canonical.split("-")[0]?.toLowerCase();
          if (primary === "ru") return "ru";
          return canonical;
        })
        .filter(Boolean)
    )
  );
  const enabledTagSet = new Set(enabledTags);
  const enabledByPrimary = new Map<string, string[]>();
  enabledTags.forEach((tag) => {
    const primary = tag.split("-")[0];
    if (!primary) return;
    const list = enabledByPrimary.get(primary);
    if (list) {
      if (!list.includes(tag)) list.push(tag);
      return;
    }
    enabledByPrimary.set(primary, [tag]);
  });
  return function resolveLanguage(rawValue: string, rowNumber: number, label: string) {
    const raw = String(rawValue ?? "").trim();
    if (!raw) return "";
    if (params.settings.strictImport) {
      let normalized = canonicalizeLanguageTag(raw);
      if (!normalized) return "";
      const aliasKey = normalized.toLowerCase().replace(/[^a-z]/g, "");
      const primaryRaw = normalized.split("-")[0]?.toLowerCase();
      if (primaryRaw === "ru") {
        normalized = "ru";
      }
      const isSerboCroatian = normalized === "sh" || aliasKey === "serbocroatian";
      if (isSerboCroatian) {
        normalized = "sr";
      }
      if (enabledTagSet.has(normalized) && !isSerboCroatian) return normalized;
      const primary = normalized.split("-")[0] || "";
      if (!primary) return "";
      if (primary === "ru" && normalized.includes("-") && enabledTagSet.has("ru")) {
        return "ru";
      }
      if (normalized.includes("-")) {
        params.missingLanguageTags?.add(normalized);
        return "";
      }
      const variants = enabledByPrimary.get(primary) ?? [];
      if (variants.length === 0) {
        params.missingLanguageTags?.add(normalized);
        return "";
      }
      if (variants.length === 1) return variants[0];
      const preferred = params.languageSettings.preferredVariantsByPrimary?.[primary];
      if (preferred) {
        const preferredTag = canonicalizeLanguageTag(preferred);
        if (preferredTag && variants.includes(preferredTag)) return preferredTag;
      }
      const base = variants.find((tag) => tag === primary);
      if (base) return base;
      const catalogEntry = params.catalogByTag.get(primary);
      if (catalogEntry?.defaultRegionForFlag) {
        const candidate = canonicalizeLanguageTag(`${primary}-${catalogEntry.defaultRegionForFlag}`);
        if (variants.includes(candidate)) return candidate;
      }
      return variants.slice().sort((a, b) => a.localeCompare(b))[0] ?? "";
    }
    const normalized = normalizeLanguageTag(raw);
    if (!normalized) return "";
    const match = resolveLanguageMatch(normalized, enabledTags, params.languageSettings, params.catalogByTag);
    if (!match.resolved) {
      params.warnings.push(`Row ${rowNumber}: ${label} language "${rawValue}" is unknown; imported as "${normalized}".`);
      return normalized;
    }
    if (match.strategy !== "exact" && match.resolved !== normalized) {
      params.warnings.push(`Row ${rowNumber}: ${label} language "${rawValue}" mapped to "${match.resolved}".`);
    }
    return match.resolved;
  };
}

export function appendMissingLanguageErrors(errors: string[], missingLanguageTags: Set<string>) {
  if (!missingLanguageTags || missingLanguageTags.size === 0) return;
  const tags = Array.from(missingLanguageTags).sort((a, b) => a.localeCompare(b));
  errors.push(`Import error: language codes missing in language settings: ${tags.join(", ")}.`);
}

export function autoTermId(seed: string) {
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = normalized[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      pushField();
      continue;
    }

    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }

    field += ch;
  }

  pushField();
  if (row.length > 1 || (row.length === 1 && row[0].trim().length > 0)) {
    pushRow();
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[0].map((h) => String(h ?? ""));
  return { headers, rows: rows.slice(1) };
}

function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export async function parseXlsxToCsv(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) return "";
  try {
    const workbook = new ExcelJS.Workbook();
    const data = Buffer.from(buffer);
    await workbook.xlsx.load(data as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return "";
    const lines: string[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const width = row.cellCount;
      if (width === 0) return;
      const values: string[] = [];
      let hasValue = false;
      for (let column = 1; column <= width; column += 1) {
        const text = String(row.getCell(column).text ?? "");
        if (text.trim().length > 0) hasValue = true;
        values.push(escapeCsvField(text));
      }
      if (!hasValue) return;
      lines.push(values.join(","));
    });
    return lines.join("\n");
  } catch (err: any) {
    throw new Error(err?.message || "Failed to parse XLSX file.");
  }
}

export function resolveHeaderIndex(
  headerIndex: Map<string, number>,
  header: RequiredHeader
): { header: string; index: number } | null {
  for (const candidate of HEADER_ALIASES[header]) {
    const index = headerIndex.get(candidate);
    if (index !== undefined) return { header: candidate, index };
  }
  return null;
}

export function resolveAnyHeaderIndex(headerIndex: Map<string, number>, candidates: string[]) {
  for (const candidate of candidates) {
    const index = headerIndex.get(candidate);
    if (index !== undefined) return index;
  }
  return null;
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

export function buildCsvSampleRows(headers: string[], rows: string[][], limit = 6) {
  const samples: Array<Record<string, string>> = [];
  for (const row of rows.slice(0, limit)) {
    const item: Record<string, string> = {};
    headers.forEach((h, idx) => {
      item[h] = String(row[idx] ?? "");
    });
    samples.push(item);
  }
  return samples;
}

export type PicklistFieldRef = {
  id: string;
  scope: "entry" | "language" | "term";
  index: number;
  name: string;
  key: string;
  values: string[];
};

export const PICKLIST_FIELD_ALIASES: Record<string, string[]> = {
  domain: ["subject", "domain", "topic"],
  tags: ["tags", "tag", "labels", "label"],
  status: ["status"]
};

export function normalizePicklistValue(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

export function buildPicklistFieldRefs(structure: any) {
  const refs: PicklistFieldRef[] = [];
  const refByKey = new Map<string, PicklistFieldRef>();
  const base = structure && typeof structure === "object" ? structure : {};
  (["entry", "language", "term"] as const).forEach((scope) => {
    const fields = Array.isArray(base[scope]) ? base[scope] : [];
    fields.forEach((field: any, index: number) => {
      if (!field || typeof field !== "object") return;
      const name = String(field.name ?? field.label ?? "").trim();
      const type = String(field.type ?? "").trim().toLowerCase();
      if (!name || type !== "picklist") return;
      const values = Array.isArray(field.values)
        ? field.values.map((value: any) => String(value ?? "").trim()).filter(Boolean)
        : [];
      const key = normalizePicklistKey(name);
      const ref: PicklistFieldRef = {
        id: `${scope}:${key || name.toLowerCase()}`,
        scope,
        index,
        name,
        key: key || name.toLowerCase(),
        values
      };
      refs.push(ref);
      if (!refByKey.has(ref.key)) refByKey.set(ref.key, ref);
    });
  });
  return { refs, refByKey };
}

export function resolvePicklistField(refByKey: Map<string, PicklistFieldRef>, key: string) {
  const normalized = normalizePicklistKey(key);
  const direct = refByKey.get(normalized);
  if (direct) return direct;
  const aliases = PICKLIST_FIELD_ALIASES[normalized];
  if (!aliases) return null;
  for (const alias of aliases) {
    const aliasKey = normalizePicklistKey(alias);
    const match = refByKey.get(aliasKey);
    if (match) return match;
  }
  return null;
}

export function entryLabel(entry: GlossaryImportEntry) {
  if (entry.termId) return `Entry ${entry.termId}`;
  if (entry.term || entry.translation) {
    const src = entry.term ? `"${entry.term}"` : "Term";
    const tgt = entry.translation ? `"${entry.translation}"` : "";
    return tgt ? `${src} -> ${tgt}` : src;
  }
  return "Entry";
}

export function statusLabelFromMeta(meta: Record<string, any>) {
  if (meta?.forbidden === true) return "Forbidden";
  if (meta?.preferred === true) return "Preferred";
  return null;
}

export function collectPicklistUpdates(params: {
  entries: GlossaryImportEntry[];
  structure: any;
  strict: boolean;
}) {
  const { refs, refByKey } = buildPicklistFieldRefs(params.structure);
  if (refs.length === 0) {
    return { errors: [], warnings: [], updatedStructure: params.structure };
  }

  const allowedById = new Map<string, Set<string>>();
  refs.forEach((ref) => {
    const set = new Set(ref.values.map(normalizePicklistValue).filter(Boolean));
    allowedById.set(ref.id, set);
  });

  const additions = new Map<string, Set<string>>();
  const errors: string[] = [];
  const warnings: string[] = [];

  const pushValue = (ref: PicklistFieldRef, rawValue: string, entry: GlossaryImportEntry) => {
    const normalized = normalizePicklistValue(rawValue);
    if (!normalized) return;
    const allowed = allowedById.get(ref.id) || new Set<string>();
    if (allowed.has(normalized)) return;
    if (params.strict) {
      errors.push(`${entryLabel(entry)}: ${ref.name} value "${rawValue}" is not in the allowed picklist.`);
      return;
    }
    if (!additions.has(ref.id)) additions.set(ref.id, new Set());
    additions.get(ref.id)!.add(rawValue);
  };

  params.entries.forEach((entry) => {
    const meta = entry.meta || {};
    const domainRef = resolvePicklistField(refByKey, "domain");
    if (domainRef && meta.domain) {
      pushValue(domainRef, String(meta.domain), entry);
    }
    const tagRef = resolvePicklistField(refByKey, "tags");
    if (tagRef && Array.isArray(meta.tags)) {
      meta.tags.forEach((tag: any) => pushValue(tagRef, String(tag ?? ""), entry));
    }
    const statusRef = resolvePicklistField(refByKey, "status");
    const statusLabel = statusLabelFromMeta(meta);
    if (statusRef && statusLabel) {
      pushValue(statusRef, statusLabel, entry);
    }
  });

  if (additions.size === 0) {
    return { errors, warnings, updatedStructure: params.structure };
  }

  const next = { ...(params.structure || {}) } as any;
  refs.forEach((ref) => {
    const added = additions.get(ref.id);
    if (!added || added.size === 0) return;
    const list = Array.isArray(next[ref.scope]) ? [...next[ref.scope]] : [];
    const field = list[ref.index] && typeof list[ref.index] === "object" ? { ...list[ref.index] } : {};
    const values = Array.isArray(field.values) ? [...field.values] : [];
    const existing = new Set(values.map(normalizePicklistValue).filter(Boolean));
    added.forEach((value) => {
      const normalized = normalizePicklistValue(value);
      if (!normalized || existing.has(normalized)) return;
      values.push(value);
      existing.add(normalized);
    });
    field.values = values;
    list[ref.index] = field;
    next[ref.scope] = list;
    warnings.push(`Picklist "${ref.name}" extended with: ${Array.from(added).join(", ")}.`);
  });

  return { errors, warnings, updatedStructure: next };
}
