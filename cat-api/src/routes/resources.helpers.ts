import { db } from "../db.js";

export type ProjectTemplateRow = {
  id: number;
  name: string;
  description: string | null;
  scope: string | null;
  disabled?: boolean | null;
  src_lang: string;
  target_langs: any;
  translation_engine_id: number | null;
  file_type_config_id: number | null;
  default_tmx_id?: number | null;
  default_ruleset_id?: number | null;
  default_glossary_id?: number | null;
  tmx_by_target_lang?: any;
  ruleset_by_target_lang?: any;
  glossary_by_target_lang?: any;
  settings: any;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  translation_engine_name?: string | null;
  file_type_config_name?: string | null;
};

export type TranslationEngineRow = {
  id: number;
  name: string;
  description: string | null;
  config: any;
  disabled: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FileTypeConfigRow = {
  id: number;
  name: string;
  description: string | null;
  config: any;
  disabled: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RulesetRow = {
  id: number;
  name: string;
  description: string | null;
  rules: any;
  disabled: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RulesetVersionRow = {
  id: number;
  ruleset_id: number;
  version: number;
  name: string;
  description: string | null;
  rules: any;
  disabled: boolean;
  summary: string | null;
  created_by: string | null;
  created_at: string;
};

export type DbClient = Pick<typeof db, "query">;

export type NmtProviderRow = {
  id: number;
  name: string;
  provider: string;
  enabled: boolean;
  config: any;
  secret_enc: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeLang(code: any): string {
  return String(code ?? "").trim().toLowerCase();
}

export function uniqueStrings(values: any): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const v = normalizeLang(item);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function parseOptionalInt(value: any): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function normalizeBool(input: any, defaultValue = false): boolean {
  if (input === undefined) return defaultValue;
  return Boolean(input);
}

export function normalizeJsonObject(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

const ALLOWED_FILE_TYPES = new Set(["html", "xml", "pdf", "docx", "pptx", "xlsx"]);
const ALLOWED_RENDERED_PREVIEW_METHODS = new Set(["pdf", "images", "html", "xml_xslt", "xml_raw_pretty"]);

export type RenderedPreviewMethod = "pdf" | "images" | "html" | "xml_xslt" | "xml_raw_pretty";

function normalizeRenderedPreviewMethod(value: any): RenderedPreviewMethod | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (!ALLOWED_RENDERED_PREVIEW_METHODS.has(normalized)) return null;
  return normalized as RenderedPreviewMethod;
}

function defaultRenderedPreviewMethodForFileType(fileType: string): RenderedPreviewMethod | null {
  if (fileType === "docx" || fileType === "pptx" || fileType === "xlsx") return "pdf";
  if (fileType === "html") return "html";
  if (fileType === "xml") return "xml_raw_pretty";
  return null;
}

export function getRenderedPreviewSettings(cfg: any, fileType: string) {
  const root = normalizeJsonObject(cfg);
  const xml = normalizeJsonObject(root.xml);
  const normalizedType = normalizeFileType(fileType) ?? fileType;
  const supportsRenderedPreview = normalizeBool(
    root.supportsRenderedPreview ?? normalizeJsonObject(root.renderedPreview).enabled,
    false
  );
  const defaultOn = normalizeBool(
    root.renderedPreviewDefaultOn ?? normalizeJsonObject(root.renderedPreview).defaultOn,
    false
  );

  const requestedMethod =
    normalizeRenderedPreviewMethod(
      root.renderedPreviewMethod ?? normalizeJsonObject(root.renderedPreview).method
    ) ??
    (normalizedType === "xml" ? normalizeRenderedPreviewMethod(xml.renderedPreviewMethod) : null) ??
    defaultRenderedPreviewMethodForFileType(normalizedType);

  let method = requestedMethod;
  if (normalizedType === "html") method = method === "html" ? "html" : "html";
  if (normalizedType === "xml") {
    method = method === "xml_xslt" || method === "xml_raw_pretty" ? method : "xml_raw_pretty";
  }
  if (normalizedType === "docx" || normalizedType === "pptx" || normalizedType === "xlsx") {
    method = method === "images" ? "images" : "pdf";
  }

  const xmlXsltTemplateId = parseOptionalInt(
    xml.renderedPreviewXsltTemplateId ??
      xml.previewXsltTemplateId ??
      root.renderedPreviewXsltTemplateId ??
      root.previewXsltTemplateId
  );
  const xmlRendererProfileId = String(
    xml.renderedPreviewRendererProfileId ??
      xml.previewRendererProfileId ??
      root.renderedPreviewRendererProfileId ??
      root.previewRendererProfileId ??
      ""
  ).trim();

  return {
    supportsRenderedPreview,
    renderedPreviewMethod: method,
    renderedPreviewDefaultOn: defaultOn,
    xmlXsltTemplateId: xmlXsltTemplateId != null && xmlXsltTemplateId > 0 ? xmlXsltTemplateId : null,
    xmlRendererProfileId: xmlRendererProfileId || null
  };
}

export function normalizeFileType(value: any): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  return ALLOWED_FILE_TYPES.has(v) ? v : null;
}

export function normalizeFileTypeConfigForWrite(input: any): { config: Record<string, any>; fileType: string } | { error: string } {
  const base = normalizeJsonObject(input);
  const fromField = normalizeFileType(base.fileType);
  const legacy = Array.isArray((base as any).fileTypes)
    ? (base as any).fileTypes.map((t: any) => normalizeFileType(t)).filter(Boolean)
    : [];

  if (legacy.length > 1) {
    return { error: "Exactly one file type must be selected." };
  }

  const fileType = fromField ?? (legacy[0] as string | undefined) ?? null;
  if (!fileType) {
    return { error: "fileType is required." };
  }

  const config: any = { ...base, fileType };
  delete config.fileTypes;

  if (fileType === "html") {
    const html = normalizeJsonObject(config.html);
    const parsingTemplateId = parseOptionalInt(
      html.parsingTemplateId ?? config.parsingTemplateId ?? config.htmlParsingTemplateId ?? config.parsing_template_id
    );
    if (parsingTemplateId != null) html.parsingTemplateId = parsingTemplateId;
    if (!html.segmenter && config.segmentation && typeof config.segmentation === "object") {
      const mode = String((config.segmentation as any).mode || "").toLowerCase();
      html.segmenter = mode === "sentences" ? "sentences" : "lines";
    }
    config.html = html;
  }

  if (fileType === "xml") {
    const xml = normalizeJsonObject(config.xml);
    const parsingTemplateId = parseOptionalInt(
      xml.parsingTemplateId ?? config.parsingTemplateId ?? config.htmlParsingTemplateId ?? config.parsing_template_id
    );
    if (parsingTemplateId != null) xml.parsingTemplateId = parsingTemplateId;
    if (!xml.segmenter && config.segmentation && typeof config.segmentation === "object") {
      const mode = String((config.segmentation as any).mode || "").toLowerCase();
      xml.segmenter = mode === "sentences" ? "sentences" : "lines";
    }
    config.xml = xml;
  }

  if (fileType !== "html" && fileType !== "xml") {
    config[fileType] = normalizeJsonObject(config[fileType]);
  }

  const previewFromRoot = normalizeJsonObject(config.renderedPreview);
  const previewSettings = getRenderedPreviewSettings(config, fileType);
  const supportsRenderedPreview = normalizeBool(
    config.supportsRenderedPreview ?? previewFromRoot.enabled,
    previewSettings.supportsRenderedPreview
  );
  const renderedPreviewMethod =
    normalizeRenderedPreviewMethod(config.renderedPreviewMethod ?? previewFromRoot.method) ??
    previewSettings.renderedPreviewMethod;
  const renderedPreviewDefaultOn = normalizeBool(
    config.renderedPreviewDefaultOn ?? previewFromRoot.defaultOn,
    previewSettings.renderedPreviewDefaultOn
  );
  config.supportsRenderedPreview = supportsRenderedPreview;
  if (renderedPreviewMethod) config.renderedPreviewMethod = renderedPreviewMethod;
  config.renderedPreviewDefaultOn = renderedPreviewDefaultOn;

  if (fileType === "xml") {
    const xml = normalizeJsonObject(config.xml);
    const xmlPreviewMethod =
      normalizeRenderedPreviewMethod(xml.renderedPreviewMethod ?? config.renderedPreviewMethod) ??
      "xml_raw_pretty";
    xml.renderedPreviewMethod =
      xmlPreviewMethod === "xml_xslt" || xmlPreviewMethod === "xml_raw_pretty"
        ? xmlPreviewMethod
        : "xml_raw_pretty";

    const xmlXsltTemplateId = parseOptionalInt(
      xml.renderedPreviewXsltTemplateId ??
        xml.previewXsltTemplateId ??
        config.renderedPreviewXsltTemplateId ??
        config.previewXsltTemplateId
    );
    if (xmlXsltTemplateId != null && xmlXsltTemplateId > 0) {
      xml.renderedPreviewXsltTemplateId = xmlXsltTemplateId;
      config.renderedPreviewXsltTemplateId = xmlXsltTemplateId;
    } else {
      delete xml.renderedPreviewXsltTemplateId;
      delete config.renderedPreviewXsltTemplateId;
    }

    const xmlRendererProfileId = String(
      xml.renderedPreviewRendererProfileId ??
        xml.previewRendererProfileId ??
        config.renderedPreviewRendererProfileId ??
        config.previewRendererProfileId ??
        ""
    ).trim();
    if (xmlRendererProfileId) {
      xml.renderedPreviewRendererProfileId = xmlRendererProfileId;
      config.renderedPreviewRendererProfileId = xmlRendererProfileId;
    } else {
      delete xml.renderedPreviewRendererProfileId;
      delete config.renderedPreviewRendererProfileId;
    }

    config.xml = xml;
    config.renderedPreviewMethod = xml.renderedPreviewMethod;
  }

  if (fileType === "html") {
    config.renderedPreviewMethod = "html";
  }
  if (fileType === "docx" || fileType === "pptx" || fileType === "xlsx") {
    const method = normalizeRenderedPreviewMethod(config.renderedPreviewMethod);
    config.renderedPreviewMethod = method === "images" ? "images" : "pdf";
  }

  return { config, fileType };
}

export function getPreviewParsingTemplateId(cfg: any): number | null {
  const root = normalizeJsonObject(cfg);
  const html = normalizeJsonObject(root.html);
  const xml = normalizeJsonObject(root.xml);
  return parseOptionalInt(
    html.parsingTemplateId ??
      xml.parsingTemplateId ??
      root.parsingTemplateId ??
      root.htmlParsingTemplateId ??
      root.parsing_template_id
  );
}

export function getFileTypeConfigParsingTemplateId(cfg: any, fileType: string): number | null {
  const root = normalizeJsonObject(cfg);
  if (fileType === "html") {
    const html = normalizeJsonObject(root.html);
    return parseOptionalInt(html.parsingTemplateId);
  }
  if (fileType === "xml") {
    const xml = normalizeJsonObject(root.xml);
    return parseOptionalInt(xml.parsingTemplateId);
  }
  return null;
}

export function fileTypeConfigTemplateWhere(paramIndex: number) {
  return `
    COALESCE(config #>> '{html,parsingTemplateId}', '') = $${paramIndex}
    OR COALESCE(config #>> '{xml,parsingTemplateId}', '') = $${paramIndex}
    OR COALESCE(config->>'parsingTemplateId', '') = $${paramIndex}
    OR COALESCE(config->>'htmlParsingTemplateId', '') = $${paramIndex}
    OR COALESCE(config->>'parsing_template_id', '') = $${paramIndex}
  `;
}

export function getAttachedParsingTemplateIds(cfg: any): number[] {
  const root = normalizeJsonObject(cfg);
  const fileType = normalizeFileType((root as any).fileType);
  const legacy = Array.isArray((root as any).fileTypes)
    ? (root as any).fileTypes.map((t: any) => normalizeFileType(t)).filter(Boolean)
    : [];
  const effectiveType = (fileType ?? legacy[0] ?? null) as string | null;
  if (effectiveType !== "html" && effectiveType !== "xml") return [];

  const html = normalizeJsonObject(root.html);
  const xml = normalizeJsonObject(root.xml);
  const candidates = [
    effectiveType === "xml" ? xml.parsingTemplateId : html.parsingTemplateId,
    root.parsingTemplateId,
    root.htmlParsingTemplateId,
    root.parsing_template_id
  ];
  const out = new Set<number>();
  for (const item of candidates) {
    const parsed = parseOptionalInt(item);
    if (parsed != null && parsed > 0) out.add(parsed);
  }
  return Array.from(out);
}

export function normalizeTemplateSettings(input: any) {
  const src = input && typeof input === "object" ? input : {};
  return {
    canEditSource: Boolean(src.canEditSource),
    canDownloadSource: Boolean(src.canDownloadSource),
    canDownloadTranslated: Boolean(src.canDownloadTranslated),
    canExportIntermediate: Boolean(src.canExportIntermediate),
    autoCreateInboxItems: src.autoCreateInboxItems !== false,
    completionPolicy: String(src.completionPolicy || "").trim() || "assignee"
  };
}

export function normalizeTemplateOverrides(input: any, allowedTargets: string[]) {
  const allowedSet = new Set(allowedTargets.map(normalizeLang).filter(Boolean));
  const src = normalizeJsonObject(input);
  const out: Record<string, number | null> = {};
  Object.entries(src).forEach(([key, value]) => {
    const lang = normalizeLang(key);
    if (!lang || !allowedSet.has(lang)) return;
    if (value === null || String(value).trim() === "") {
      out[lang] = null;
      return;
    }
    const parsed = parseOptionalInt(value);
    if (parsed != null) out[lang] = parsed;
  });
  return out;
}

export function hasInvalidOverrideKeys(input: any, allowedTargets: string[]) {
  const allowedSet = new Set(allowedTargets.map(normalizeLang).filter(Boolean));
  const src = normalizeJsonObject(input);
  return Object.keys(src).some((key) => {
    const lang = normalizeLang(key);
    return lang && !allowedSet.has(lang);
  });
}

export function rowToTemplate(row: ProjectTemplateRow) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    description: row.description ? String(row.description) : "",
    scope: row.scope ? String(row.scope) : "",
    disabled: Boolean(row.disabled),
    languages: {
      src: String(row.src_lang || ""),
      targets: Array.isArray(row.target_langs) ? row.target_langs : []
    },
    translationEngineId: row.translation_engine_id != null ? Number(row.translation_engine_id) : null,
    translationEngineName: row.translation_engine_name ? String(row.translation_engine_name) : null,
    fileTypeConfigId: row.file_type_config_id != null ? Number(row.file_type_config_id) : null,
    fileTypeConfigName: row.file_type_config_name ? String(row.file_type_config_name) : null,
    defaultTmxId: row.default_tmx_id != null ? Number(row.default_tmx_id) : null,
    defaultRulesetId: row.default_ruleset_id != null ? Number(row.default_ruleset_id) : null,
    defaultGlossaryId: row.default_glossary_id != null ? Number(row.default_glossary_id) : null,
    tmxByTargetLang: row.tmx_by_target_lang && typeof row.tmx_by_target_lang === "object" ? row.tmx_by_target_lang : {},
    rulesetByTargetLang:
      row.ruleset_by_target_lang && typeof row.ruleset_by_target_lang === "object" ? row.ruleset_by_target_lang : {},
    glossaryByTargetLang:
      row.glossary_by_target_lang && typeof row.glossary_by_target_lang === "object" ? row.glossary_by_target_lang : {},
    settings: row.settings && typeof row.settings === "object" ? row.settings : {},
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export function rowToTranslationEngine(row: TranslationEngineRow) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    description: row.description ? String(row.description) : "",
    config: normalizeJsonObject(row.config),
    disabled: Boolean(row.disabled),
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export function rowToFileTypeConfig(row: FileTypeConfigRow) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    description: row.description ? String(row.description) : "",
    config: normalizeJsonObject(row.config),
    disabled: Boolean(row.disabled),
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export function rowToRuleset(row: RulesetRow) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    description: row.description ? String(row.description) : "",
    rules: Array.isArray(row.rules) ? row.rules : [],
    disabled: Boolean(row.disabled),
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export function rowToRulesetVersion(row: RulesetVersionRow) {
  return {
    id: Number(row.id),
    rulesetId: Number(row.ruleset_id),
    version: Number(row.version),
    name: String(row.name || ""),
    description: row.description ? String(row.description) : "",
    rules: Array.isArray(row.rules) ? row.rules : [],
    disabled: Boolean(row.disabled),
    summary: row.summary ? String(row.summary) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

export function rowToNmtProvider(row: NmtProviderRow) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    provider: String(row.provider || "").trim(),
    enabled: Boolean(row.enabled),
    config: normalizeJsonObject(row.config),
    hasSecret: Boolean(row.secret_enc),
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export function maskApiKey(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  const last4 = v.length >= 4 ? v.slice(-4) : "";
  const prefix = v.startsWith("sk-") ? "sk-" : "";
  return `${prefix}â€¢â€¢â€¢â€¢${last4 || "â€¢â€¢â€¢â€¢"}`;
}

export function maskBaseUrl(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  try {
    const url = new URL(v);
    const host = url.host;
    if (!host) return "stored";
    return `${url.protocol}//${host}/â€¦`;
  } catch {
    return "stored";
  }
}

const COPY_TABLES = {
  project_templates: "project_templates",
  translation_engines: "translation_engines",
  file_type_configs: "file_type_configs",
  language_processing_rulesets: "language_processing_rulesets",
  nmt_providers: "nmt_providers"
} as const;

export async function uniqueCopyName(params: { table: keyof typeof COPY_TABLES; base: string }): Promise<string> {
  const table = COPY_TABLES[params.table];
  const base = params.base;
  const trimmed = String(base || "").trim() || "Template";
  const candidates = [
    `${trimmed} (Copy)`,
    `Copy of ${trimmed}`
  ];
  for (const name of candidates) {
    const exists = await db.query(`SELECT 1 FROM ${table} WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]);
    if ((exists.rowCount ?? 0) === 0) return name;
  }
  for (let i = 2; i < 1000; i += 1) {
    const name = `${trimmed} (Copy ${i})`;
    const exists = await db.query(`SELECT 1 FROM ${table} WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]);
    if ((exists.rowCount ?? 0) === 0) return name;
  }
  return `${trimmed} (Copy ${Date.now()})`;
}

export async function insertRulesetVersion(client: DbClient, ruleset: RulesetRow, userId: string, summary?: string | null) {
  const versionRes = await client.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0)::int AS version FROM language_processing_ruleset_versions WHERE ruleset_id = $1",
    [ruleset.id]
  );
  const nextVersion = Number(versionRes.rows[0]?.version ?? 0) + 1;
  await client.query(
    `INSERT INTO language_processing_ruleset_versions(
       ruleset_id,
       version,
       name,
       description,
       rules,
       disabled,
       summary,
       created_by,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, NOW())`,
    [
      ruleset.id,
      nextVersion,
      ruleset.name,
      ruleset.description ?? null,
      JSON.stringify(Array.isArray(ruleset.rules) ? ruleset.rules : []),
      Boolean(ruleset.disabled),
      summary ?? null,
      userId
    ]
  );
  return nextVersion;
}
