import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import {
  APP_AGENT_TOOL_ALLOWLIST,
  type AppAgentConfigUpdateInput,
  evaluateAppAgentAvailability,
  loadAppAgentConfig,
  normalizeUpdatedAppAgentConfig,
  updateAppAgentConfig
} from "../lib/app-agent-config.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";
import type { AgentService } from "../lib/agent-service.js";
import {
  getRequestUser,
  requireAdmin,
  requireAuth,
  requestUserId
} from "../middleware/auth.js";
import {
  addFileToAssigned,
  addProjectToAssigned,
  addProjectToCreated,
  touchProjectForUsers
} from "../lib/user-buckets.js";
import { copyObject, getObjectBuffer, getS3Bucket } from "../lib/s3.js";
import { keyProjectSourceOriginal } from "../lib/storage-keys.js";
import { insertFileArtifact } from "../lib/file-artifacts.js";
import { enqueueProvisionJobIfImportReady } from "../lib/provision-queue.js";
import { insertSegmentsForFile } from "./projects.segment-insert.js";
import { parseXliffSegments } from "../lib/xliff.js";
import { segmentHtmlWithTemplate } from "../lib/html-segmentation.js";
import { normalizeParsingTemplateConfig, normalizeXmlParsingTemplateConfig } from "../lib/parsing-templates.js";
import { extractXmlSegmentsWithTemplate } from "../lib/xml-extraction.js";
import officeParser from "officeparser";
import { parseOfficeRichSegments } from "../lib/office-rich.js";
import { segmentPlainText } from "../utils.js";
import {
  buildOfficeParserConfig,
  formatOfficeParseError,
  getFileTypeConfigParsingTemplateId,
  isTextLikeContentType,
  normalizeJsonObject as normalizeProjectJsonObject,
  resolveUploadFileType,
  sanitizeSegments,
  sanitizeTextForDb,
  withTimeout
} from "./projects.helpers.js";
import path from "path";
import type { PoolClient } from "pg";

export type AppAgentRoutesOptions = {
  agentService: AgentService;
};

export type InternalUserContext = {
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
};

export type InternalCreateProjectArgs = {
  name?: string;
  source_lang?: string;
  sourceLang?: string;
  target_langs?: string[];
  targetLangs?: string[];
  file_ids?: number[];
  fileIds?: number[];
  due_at?: string;
  dueAt?: string;
  owner_user_id?: number | string;
  ownerUserId?: number | string;
  assigned_user_id?: number | string;
  assignedUserId?: number | string;
  translation_engine_id?: number;
  translationEngineId?: number;
  ruleset_id?: number;
  rulesetId?: number;
  tmx_id?: number;
  tmxId?: number;
  glossary_id?: number;
  glossaryId?: number;
  termbase_id?: number;
  termbaseId?: number;
};

export type GlobalLanguageSettings = {
  enabledLanguages: string[];
  defaultSource: string;
  defaultTargets: string[];
  allowSingleLanguage: boolean;
};

export type SourceFileRow = {
  id: number;
  original_name: string;
  stored_path: string;
  file_type: string | null;
  file_type_config_id: number | null;
  status: string | null;
  project_id: number;
  department_id: number | null;
  assigned_user: string | null;
  created_by: string | null;
};

export type SegmentSeedRow = {
  seg_index: number;
  src: string;
  tgt: string | null;
  src_runs: any;
  tgt_runs: any;
  segment_context: any;
  origin_details: any;
  task_id: number | null;
};

export type SourceArtifactRow = {
  bucket: string | null;
  object_key: string | null;
  sha256: string | null;
  etag: string | null;
  size_bytes: number | null;
  content_type: string | null;
  meta_json: any;
};

export type AssignableUser = {
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
};

export type ResolvedUserRef = {
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
  disabled: boolean;
};

export type FileProcessingStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export function parsePositiveIntArray(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const deduped = new Set<number>();
  input.forEach((entry) => {
    const num = Number(entry);
    if (Number.isFinite(num) && num > 0) deduped.add(Math.trunc(num));
  });
  return Array.from(deduped);
}

export function parsePositiveInt(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

export function normalizeLanguageList(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();
  raw.forEach((entry) => {
    const normalized = normalizeLanguageTag(String(entry || ""));
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

export function normalizeJsonObject(input: unknown): Record<string, any> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, any>;
  }
  return {};
}

export function normalizeProjectAccessRole(role: unknown): string {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "user" ? "reviewer" : normalized;
}

export function isEligibleProjectAssigneeRole(role: unknown, opts?: { allowAdminSelf?: boolean }): boolean {
  const normalized = normalizeProjectAccessRole(role);
  if (normalized === "reviewer" || normalized === "manager") return true;
  return Boolean(opts?.allowAdminSelf) && normalized === "admin";
}

export const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  html: [".html", ".htm", ".xhtml", ".xtml"],
  xml: [".xml", ".xlf", ".xliff"],
  pdf: [".pdf"],
  docx: [".doc", ".docx"],
  pptx: [".ppt", ".pptx"],
  xlsx: [".xls", ".xlsx"]
};

export function canAssignProjectsByRole(role: string | null | undefined) {
  const normalized = normalizeProjectAccessRole(role);
  return normalized === "admin" || normalized === "manager";
}

export async function resolveUserRef(userRef: unknown): Promise<ResolvedUserRef | null> {
  const raw = String(userRef ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const userId = Number(raw);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    const res = await db.query<{
      id: number;
      username: string;
      role: string | null;
      department_id: number | null;
      disabled: boolean;
    }>(
      `SELECT id, username, role, department_id, disabled
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [Math.trunc(userId)]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      userId: Number(row.id),
      username: String(row.username || "").trim(),
      role: normalizeProjectAccessRole(row.role),
      departmentId:
        row.department_id != null && Number.isFinite(Number(row.department_id)) && Number(row.department_id) > 0
          ? Math.trunc(Number(row.department_id))
          : null,
      disabled: Boolean(row.disabled)
    };
  }

  const normalizedUsername = raw.toLowerCase();
  const res = await db.query<{
    id: number;
    username: string;
    role: string | null;
    department_id: number | null;
    disabled: boolean;
  }>(
    `SELECT id, username, role, department_id, disabled
     FROM users
     WHERE LOWER(username) = LOWER($1)
     LIMIT 1`,
    [normalizedUsername]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    userId: Number(row.id),
    username: String(row.username || "").trim(),
    role: normalizeProjectAccessRole(row.role),
    departmentId:
      row.department_id != null && Number.isFinite(Number(row.department_id)) && Number(row.department_id) > 0
        ? Math.trunc(Number(row.department_id))
        : null,
    disabled: Boolean(row.disabled)
  };
}

export async function listAssignableUsersForContext(userContext: InternalUserContext): Promise<AssignableUser[]> {
  const canAssign = canAssignProjectsByRole(userContext.role);
  const departmentId = userContext.departmentId;
  const queryText = canAssign
    ? userContext.role === "admin"
      ? `SELECT id, username, role, department_id
         FROM users
         WHERE disabled = FALSE
         ORDER BY LOWER(username) ASC, id ASC`
      : `SELECT id, username, role, department_id
         FROM users
         WHERE disabled = FALSE
           AND ($1::int IS NULL OR department_id = $1)
         ORDER BY LOWER(username) ASC, id ASC`
    : `SELECT id, username, role, department_id
       FROM users
       WHERE disabled = FALSE
         AND id = $1
       LIMIT 1`;
  const queryParams = canAssign
    ? userContext.role === "admin"
      ? []
      : [departmentId]
    : [userContext.userId];
  const res = await db.query<{
    id: number;
    username: string;
    role: string | null;
    department_id: number | null;
  }>(queryText, queryParams);

  return res.rows
    .map((row) => {
      const departmentIdRaw = Number(row.department_id ?? 0);
      return {
        userId: Number(row.id),
        username: String(row.username || "").trim(),
        role: normalizeProjectAccessRole(row.role),
        departmentId:
          Number.isFinite(departmentIdRaw) && departmentIdRaw > 0 ? Math.trunc(departmentIdRaw) : null
      };
    })
    .filter((row) => {
      if (!canAssign) return row.userId === userContext.userId;
      const allowAdminSelf = row.userId === userContext.userId && row.role === "admin";
      return isEligibleProjectAssigneeRole(row.role, { allowAdminSelf });
    });
}

export function parseDueAtIso(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) return "__invalid__";
  return parsed.toISOString();
}

export function parseUserContext(input: unknown): InternalUserContext | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const userIdRaw = Number(raw.userId);
  const username = String(raw.username || "").trim();
  const role = String(raw.role || "").trim().toLowerCase();
  const departmentIdRaw = Number(raw.departmentId);
  if (!Number.isFinite(userIdRaw) || userIdRaw <= 0 || !username) return null;
  const departmentId =
    Number.isFinite(departmentIdRaw) && departmentIdRaw > 0
      ? Math.trunc(departmentIdRaw)
      : null;
  return {
    userId: Math.trunc(userIdRaw),
    username,
    role,
    departmentId
  };
}

export function requireInternalAgentSecret(req: any, reply: FastifyReply) {
  const secret = String(req.headers["x-app-agent-secret"] || "").trim();
  if (!secret || secret !== CONFIG.APP_AGENT_INTERNAL_SECRET) {
    reply.code(403).send({ error: "Internal agent request denied" });
    return false;
  }
  return true;
}

export function normalizeTargetLanguages(input: unknown, sourceLanguage: string): string[] {
  if (!Array.isArray(input)) return [];
  const deduped = new Set<string>();
  input.forEach((entry) => {
    const normalized = normalizeLanguageTag(String(entry || ""));
    if (normalized && normalized !== sourceLanguage) deduped.add(normalized);
  });
  return Array.from(deduped);
}

export async function resolveVerifiedToolUser(userContext: InternalUserContext): Promise<InternalUserContext | null> {
  const res = await db.query<{
    id: number;
    username: string;
    role: string | null;
    department_id: number | null;
  }>(
    `SELECT id, username, role, department_id
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userContext.userId]
  );
  const row = res.rows[0];
  if (!row) return null;
  const dbUsername = String(row.username || "").trim();
  if (!dbUsername) return null;
  if (dbUsername !== userContext.username) return null;
  const departmentIdRaw = Number(row.department_id ?? 0);
  const departmentId =
    Number.isFinite(departmentIdRaw) && departmentIdRaw > 0 ? Math.trunc(departmentIdRaw) : null;
  return {
    userId: Math.trunc(Number(row.id)),
    username: dbUsername,
    role: normalizeProjectAccessRole(row.role),
    departmentId
  };
}

export async function loadGlobalLanguageSettings(): Promise<GlobalLanguageSettings> {
  const res = await db.query<{
    enabled_language_tags: unknown;
    default_source_tag: string | null;
    default_target_tags: unknown;
    allow_single_language: boolean | null;
  }>(
    `SELECT enabled_language_tags, default_source_tag, default_target_tags, allow_single_language
     FROM org_language_settings
     WHERE id = 1
     LIMIT 1`
  );
  const row = res.rows[0];
  const enabledLanguages = normalizeLanguageList(row?.enabled_language_tags ?? []);
  const defaultSource =
    normalizeLanguageTag(String(row?.default_source_tag || "")) ||
    enabledLanguages[0] ||
    "en";
  const defaultTargets = normalizeLanguageList(row?.default_target_tags ?? []).filter(
    (entry) => entry !== defaultSource
  );
  return {
    enabledLanguages,
    defaultSource,
    defaultTargets,
    allowSingleLanguage: Boolean(row?.allow_single_language)
  };
}

export async function insertFileProcessingLog(
  client: PoolClient,
  params: {
    projectId: number;
    fileId: number;
    stage: string;
    status: FileProcessingStatus;
    message: string;
    details?: Record<string, any>;
  }
) {
  await client.query(
    `INSERT INTO project_file_processing_logs(
       project_id,
       file_id,
       stage,
       status,
       message,
       details
     )
     VALUES($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      params.projectId,
      params.fileId,
      String(params.stage || "").trim().toUpperCase() || "IMPORT",
      String(params.status || "QUEUED").trim().toUpperCase(),
      String(params.message || "").trim() || "Processing update",
      JSON.stringify(params.details || {})
    ]
  );
}

export function buildDefaultProjectName(filename: string) {
  const date = new Date().toISOString().slice(0, 10);
  const base = path.parse(String(filename || "").trim()).name || "Project";
  return `${base} ${date}`;
}

export async function provisionAgentProjectShell(params: {
  app: any;
  traceId?: string;
  userContext: InternalUserContext;
  name: string;
  departmentId: number;
  sourceLanguage: string;
  targetLanguages: string[];
  dueAtIso: string | null;
  projectOwnerUsername: string;
  translationEngineId: number | null;
  rulesetId: number | null;
  tmxId: number | null;
  termbaseId: number | null;
  assignedUsername: string;
  files: Array<{ sourceFileId: number; tempKey: string; filename: string; fileTypeConfigId: number | null }>;
}) {
  const token = params.app.jwt.sign({
    sub: params.userContext.userId,
    username: params.userContext.username,
    role: normalizeProjectAccessRole(params.userContext.role),
    departmentId: params.userContext.departmentId ?? null
  });
  const response = await params.app.inject({
    method: "POST",
    url: "/api/cat/projects/provision",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(params.traceId ? { "x-request-id": params.traceId } : {})
    },
    payload: {
      name: params.name,
      departmentId: params.departmentId,
      srcLang: params.sourceLanguage,
      tgtLang: params.targetLanguages[0] ?? null,
      projectTargetLangs: params.targetLanguages,
      projectOwnerId: params.projectOwnerUsername,
      dueAt: params.dueAtIso ?? undefined,
      files: params.files.map((file) => ({
        tempKey: file.tempKey,
        filename: file.filename,
        fileTypeConfigId: file.fileTypeConfigId
      })),
      translationPlan: params.files.map((file) => ({
        tempKey: file.tempKey,
        targetLangs: params.targetLanguages,
        assignments: Object.fromEntries(
          params.targetLanguages.map((targetLanguage) => [
            targetLanguage,
            {
              translatorUserId: params.assignedUsername,
              tmxId: params.tmxId ?? null,
              seedSource: params.tmxId != null ? "tmx" : params.translationEngineId != null ? "nmt" : "none",
              engineId: params.translationEngineId ?? null,
              rulesetId: params.rulesetId ?? null,
              glossaryId: params.termbaseId ?? null
            }
          ])
        )
      })),
      translationEngineId: params.translationEngineId ?? null,
      mtSeedingEnabled: params.translationEngineId != null,
      rulesEnabled: params.rulesetId != null,
      rulesetId: params.rulesetId ?? null,
      termbaseEnabled: params.termbaseId != null,
      glossaryEnabled: params.termbaseId != null,
      glossaryId: params.termbaseId ?? null
    }
  });

  let payload: any = null;
  try {
    payload = response.json();
  } catch {
    payload = null;
  }
  if (response.statusCode >= 400) {
    const error: any = new Error(String(payload?.error || "Failed to provision project shell."));
    error.statusCode = response.statusCode;
    throw error;
  }

  const projectId = Number(payload?.projectId ?? 0);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    throw new Error("Provision route did not return a valid project ID.");
  }

  const fileIdByTempKey = new Map<string, number>();
  const files = Array.isArray(payload?.files) ? payload.files : [];
  files.forEach((row: any) => {
    const tempKey = String(row?.tempKey || "").trim();
    const fileId = Number(row?.fileId ?? 0);
    if (!tempKey || !Number.isFinite(fileId) || fileId <= 0) return;
    fileIdByTempKey.set(tempKey, Math.trunc(fileId));
  });

  return {
    projectId,
    status: String(payload?.status || "provisioning"),
    statusUrl: payload?.statusUrl ? String(payload.statusUrl) : null,
    fileIdByTempKey
  };
}

export async function loadSourceArtifact(
  client: PoolClient,
  sourceFileId: number
) {
  const res = await client.query<SourceArtifactRow>(
    `SELECT
       bucket,
       object_key,
       sha256,
       etag,
       size_bytes,
       content_type,
       meta_json
     FROM file_artifacts
     WHERE file_id = $1
       AND kind = 'source_original'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [sourceFileId]
  );
  return res.rows[0] ?? null;
}

export async function loadSeedSegmentsFromSourceFile(
  client: PoolClient,
  sourceFileId: number
) {
  const res = await client.query<SegmentSeedRow>(
    `SELECT seg_index, src, tgt, src_runs, tgt_runs, segment_context, origin_details, task_id
     FROM segments
     WHERE file_id = $1
     ORDER BY
       seg_index ASC,
       CASE WHEN task_id IS NULL THEN 0 ELSE 1 END ASC,
       id ASC`,
    [sourceFileId]
  );
  const seen = new Set<number>();
  const merged: Array<{
    src: string;
    tgt?: string | null;
    srcRuns?: any;
    tgtRuns?: any;
    segmentContext?: any;
    originDetails?: any;
  }> = [];
  res.rows.forEach((row) => {
    const idx = Number(row.seg_index ?? -1);
    if (!Number.isFinite(idx) || idx < 0 || seen.has(idx)) return;
    seen.add(idx);
    merged.push({
      src: String(row.src || ""),
      tgt: row.tgt ?? null,
      srcRuns: row.src_runs ?? [],
      tgtRuns: row.tgt_runs ?? [],
      segmentContext: row.segment_context ?? {},
      originDetails: row.origin_details ?? {}
    });
  });
  return sanitizeSegments(merged);
}

export async function parseSegmentsFromSourceArtifact(params: {
  client: PoolClient;
  sourceFile: SourceFileRow;
  sourceArtifact: SourceArtifactRow;
}) {
  const filename = String(params.sourceFile.original_name || "");
  const ext = path.extname(filename).toLowerCase();
  const uploadType = resolveUploadFileType(filename);
  const normalizedContentType = params.sourceArtifact.content_type
    ? String(params.sourceArtifact.content_type)
    : null;
  const key = String(params.sourceArtifact.object_key || "").trim();
  if (!key) return [];

  const { buf } = await getObjectBuffer({ key });
  const isXlf = ext === ".xlf" || ext === ".xliff";
  let fileTypeConfig: { id: number; config: any } | null = null;
  const configIdRaw = Number(params.sourceFile.file_type_config_id ?? 0);
  if (Number.isFinite(configIdRaw) && configIdRaw > 0) {
    const configRes = await params.client.query<{ id: number; config: any }>(
      `SELECT id, config
       FROM file_type_configs
       WHERE id = $1
       LIMIT 1`,
      [configIdRaw]
    );
    fileTypeConfig = configRes.rows[0] ?? null;
  }

  let segs: Array<{
    src: string;
    tgt?: string | null;
    srcRuns?: any;
    tgtRuns?: any;
    segmentContext?: any;
    originDetails?: any;
  }> = [];

  if (isXlf) {
    const parsed = parseXliffSegments(buf.toString());
    segs = parsed.map((entry) => ({ src: entry.src, tgt: entry.tgt }));
  } else if (uploadType === "html") {
    const parsingTemplateId = fileTypeConfig
      ? getFileTypeConfigParsingTemplateId(fileTypeConfig.config, "html")
      : null;
    if (!parsingTemplateId) {
      throw new Error("No HTML parsing template configured for this file.");
    }
    const templateRes = await params.client.query<{ config: any; kind: string }>(
      `SELECT config, kind
       FROM parsing_templates
       WHERE id = $1
       LIMIT 1`,
      [parsingTemplateId]
    );
    const template = templateRes.rows[0];
    if (!template) throw new Error("HTML parsing template was not found.");
    const config = normalizeParsingTemplateConfig(template.config);
    const xmlMode = ext === ".xhtml" || ext === ".xtml";
    const parsed = segmentHtmlWithTemplate(buf, config, { xmlMode });
    segs = parsed.segments.map((segmentText) => ({ src: segmentText }));
  } else if (uploadType === "xml") {
    const parsingTemplateId = fileTypeConfig
      ? getFileTypeConfigParsingTemplateId(fileTypeConfig.config, "xml")
      : null;
    if (!parsingTemplateId) {
      throw new Error("No XML parsing template configured for this file.");
    }
    const templateRes = await params.client.query<{ config: any; kind: string }>(
      `SELECT config, kind
       FROM parsing_templates
       WHERE id = $1
       LIMIT 1`,
      [parsingTemplateId]
    );
    const template = templateRes.rows[0];
    if (!template) throw new Error("XML parsing template was not found.");
    const config = normalizeXmlParsingTemplateConfig(template.config);
    const fileTypeConfigJson = normalizeProjectJsonObject(fileTypeConfig?.config);
    const xmlCfg = normalizeProjectJsonObject(fileTypeConfigJson.xml);
    const segmenter =
      String(xmlCfg.segmenter || "lines").toLowerCase() === "sentences"
        ? "sentences"
        : "lines";
    const preserveWhitespace =
      xmlCfg.preserveWhitespace !== undefined ? Boolean(xmlCfg.preserveWhitespace) : true;
    const extracted = extractXmlSegmentsWithTemplate({
      fileBuffer: buf,
      template: config,
      segmenter,
      preserveWhitespace
    });
    segs = extracted.segments.map((segment) => ({ src: segment.taggedText }));
  } else if (uploadType === "docx" || uploadType === "pptx" || uploadType === "xlsx") {
    const richParsed = parseOfficeRichSegments({ buffer: buf, fileType: uploadType });
    if (richParsed.segments.length > 0) {
      segs = richParsed.segments.map((segment) => ({
        src: segment.src,
        tgt: segment.tgt ?? null,
        srcRuns: segment.srcRuns ?? [],
        tgtRuns: segment.tgtRuns ?? [],
        segmentContext: segment.segmentContext ?? { fileType: uploadType },
        originDetails: {}
      }));
    } else {
      const officeConfig = buildOfficeParserConfig(uploadType, fileTypeConfig);
      const text = await withTimeout(
        officeParser.parseOfficeAsync(buf, officeConfig),
        CONFIG.CONVERSION_TIMEOUT_MS,
        `${uploadType.toUpperCase()} conversion`
      );
      segs = segmentPlainText(sanitizeTextForDb(String(text || ""))).map((segment) => ({ src: segment }));
    }
  } else {
    if (!uploadType && !isTextLikeContentType(normalizedContentType)) {
      throw new Error("Unsupported source file type for segmentation.");
    }
    segs = segmentPlainText(sanitizeTextForDb(buf.toString("utf8"))).map((segment) => ({ src: segment }));
  }

  return sanitizeSegments(segs);
}

