import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import {
  APP_AGENT_TOOL_ALLOWLIST,
  type AppAgentConfigUpdateInput,
  loadAppAgentConfig,
  normalizeUpdatedAppAgentConfig,
  updateAppAgentConfig
} from "../lib/app-agent-config.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";
import type { AgentService } from "../lib/agent-service.js";
import {
  getRequestUser,
  requireAdmin,
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

type AppAgentRoutesOptions = {
  agentService: AgentService;
};

type InternalUserContext = {
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
};

type InternalCreateProjectArgs = {
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

type GlobalLanguageSettings = {
  enabledLanguages: string[];
  defaultSource: string;
  defaultTargets: string[];
  allowSingleLanguage: boolean;
};

type SourceFileRow = {
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

type SegmentSeedRow = {
  seg_index: number;
  src: string;
  tgt: string | null;
  src_runs: any;
  tgt_runs: any;
  segment_context: any;
  origin_details: any;
  task_id: number | null;
};

type SourceArtifactRow = {
  bucket: string | null;
  object_key: string | null;
  sha256: string | null;
  etag: string | null;
  size_bytes: number | null;
  content_type: string | null;
  meta_json: any;
};

type AssignableUser = {
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
};

type ResolvedUserRef = {
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
  disabled: boolean;
};

type FileProcessingStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

function parsePositiveIntArray(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const deduped = new Set<number>();
  input.forEach((entry) => {
    const num = Number(entry);
    if (Number.isFinite(num) && num > 0) deduped.add(Math.trunc(num));
  });
  return Array.from(deduped);
}

function parsePositiveInt(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function normalizeLanguageList(input: unknown): string[] {
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

function normalizeJsonObject(input: unknown): Record<string, any> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, any>;
  }
  return {};
}

const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  html: [".html", ".htm", ".xhtml", ".xtml"],
  xml: [".xml", ".xlf", ".xliff"],
  pdf: [".pdf"],
  docx: [".doc", ".docx"],
  pptx: [".ppt", ".pptx"],
  xlsx: [".xls", ".xlsx"]
};

function canAssignProjectsByRole(role: string | null | undefined) {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "admin" || normalized === "manager";
}

async function resolveUserRef(userRef: unknown): Promise<ResolvedUserRef | null> {
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
      role: String(row.role || "").trim().toLowerCase(),
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
    role: String(row.role || "").trim().toLowerCase(),
    departmentId:
      row.department_id != null && Number.isFinite(Number(row.department_id)) && Number(row.department_id) > 0
        ? Math.trunc(Number(row.department_id))
        : null,
    disabled: Boolean(row.disabled)
  };
}

async function listAssignableUsersForContext(userContext: InternalUserContext): Promise<AssignableUser[]> {
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

  return res.rows.map((row) => {
    const departmentIdRaw = Number(row.department_id ?? 0);
    return {
      userId: Number(row.id),
      username: String(row.username || "").trim(),
      role: String(row.role || "").trim().toLowerCase(),
      departmentId:
        Number.isFinite(departmentIdRaw) && departmentIdRaw > 0 ? Math.trunc(departmentIdRaw) : null
    };
  });
}

function parseDueAtIso(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) return "__invalid__";
  return parsed.toISOString();
}

function parseUserContext(input: unknown): InternalUserContext | null {
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

function requireInternalAgentSecret(req: any, reply: FastifyReply) {
  const secret = String(req.headers["x-app-agent-secret"] || "").trim();
  if (!secret || secret !== CONFIG.APP_AGENT_INTERNAL_SECRET) {
    reply.code(403).send({ error: "Internal agent request denied" });
    return false;
  }
  return true;
}

function normalizeTargetLanguages(input: unknown, sourceLanguage: string): string[] {
  if (!Array.isArray(input)) return [];
  const deduped = new Set<string>();
  input.forEach((entry) => {
    const normalized = normalizeLanguageTag(String(entry || ""));
    if (normalized && normalized !== sourceLanguage) deduped.add(normalized);
  });
  return Array.from(deduped);
}

async function resolveVerifiedToolUser(userContext: InternalUserContext): Promise<InternalUserContext | null> {
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
    role: String(row.role || "").trim().toLowerCase(),
    departmentId
  };
}

async function loadGlobalLanguageSettings(): Promise<GlobalLanguageSettings> {
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

async function insertFileProcessingLog(
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

function buildDefaultProjectName(filename: string) {
  const date = new Date().toISOString().slice(0, 10);
  const base = path.parse(String(filename || "").trim()).name || "Project";
  return `${base} ${date}`;
}

async function loadSourceArtifact(
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

async function loadSeedSegmentsFromSourceFile(
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

async function parseSegmentsFromSourceArtifact(params: {
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

export const appAgentRoutes: FastifyPluginAsync<AppAgentRoutesOptions> = async (app, opts) => {
  app.get("/admin/app-agent/config", { preHandler: [requireAdmin] }, async () => {
    const config = await opts.agentService.getConfig();
    const providerRes = await db.query<{
      id: number;
      name: string;
      model: string | null;
      enabled: boolean;
    }>(
      `SELECT id, name, model, enabled
       FROM nmt_providers
       ORDER BY LOWER(name) ASC, id ASC`
    );

    return {
      config: {
        ...config,
        applyMode: "hot_reload"
      },
      providers: providerRes.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name || ""),
        model: row.model ? String(row.model) : "",
        enabled: Boolean(row.enabled)
      })),
      allowlistedTools: APP_AGENT_TOOL_ALLOWLIST
    };
  });

  app.put("/admin/app-agent/config", { preHandler: [requireAdmin] }, async (req: any, reply) => {
    const body = (req.body as AppAgentConfigUpdateInput) || {};
    const current = await loadAppAgentConfig();
    const next = normalizeUpdatedAppAgentConfig(current, body);

    if (Object.prototype.hasOwnProperty.call(body, "endpoint")) {
      const endpointRaw = String(body.endpoint ?? "").trim();
      if (endpointRaw) {
        try {
          // eslint-disable-next-line no-new
          new URL(endpointRaw);
        } catch {
          return reply.code(400).send({ error: "endpoint must be a valid URL." });
        }
      }
    }

    if (next.connectionProvider === "gateway" && !next.mockMode) {
      const hasProvider = next.providerId != null && Number.isFinite(next.providerId) && next.providerId > 0;
      const hasEndpoint = Boolean(next.endpoint);
      if (!hasProvider && !hasEndpoint) {
        return reply.code(400).send({
          error: "Gateway mode requires either a providerId or endpoint."
        });
      }
    }

    if (next.providerId != null) {
      const providerRes = await db.query<{ id: number; enabled: boolean }>(
        `SELECT id, enabled
         FROM nmt_providers
         WHERE id = $1
         LIMIT 1`,
        [next.providerId]
      );
      const provider = providerRes.rows[0];
      if (!provider) {
        return reply.code(400).send({ error: "Selected providerId was not found." });
      }
      if (!provider.enabled) {
        return reply.code(400).send({ error: "Selected provider is disabled." });
      }
    }

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const updated = await updateAppAgentConfig(body, actor);
    await opts.agentService.reloadConfig(updated);

    return {
      config: {
        ...updated,
        applyMode: "hot_reload"
      }
    };
  });

  app.post("/chat/internal/tools/create-project", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const verifiedUserContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!verifiedUserContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const userContext = verifiedUserContext;

    const args = (body.args as InternalCreateProjectArgs) || {};
    const fileIds = parsePositiveIntArray(args.file_ids ?? args.fileIds);
    if (fileIds.length === 0) {
      return reply.code(400).send({ error: "create_project requires at least one file_id." });
    }

    const ownerRef =
      args.owner_user_id ??
      args.ownerUserId ??
      args.assigned_user_id ??
      args.assignedUserId ??
      null;
    const requesterCanAssign = canAssignProjectsByRole(userContext.role);

    let assignedUser = {
      userId: userContext.userId,
      username: userContext.username,
      role: userContext.role,
      departmentId: userContext.departmentId
    };
    if (ownerRef != null && String(ownerRef).trim()) {
      const resolvedOwner = await resolveUserRef(ownerRef);
      if (!resolvedOwner) {
        return reply.code(400).send({ error: "Assigned owner user was not found." });
      }
      if (resolvedOwner.disabled) {
        return reply.code(400).send({ error: "Assigned owner user is disabled." });
      }
      const isSelf =
        String(resolvedOwner.username).trim().toLowerCase() ===
        String(userContext.username).trim().toLowerCase();
      if (!requesterCanAssign && !isSelf) {
        return reply.code(403).send({
          error:
            "Only managers/admins can assign projects to other users. I'll create it for you, or ask a manager/admin to create/assign it."
        });
      }
      if (requesterCanAssign && userContext.role === "manager" && !isSelf) {
        if (
          userContext.departmentId == null ||
          resolvedOwner.departmentId == null ||
          Number(resolvedOwner.departmentId) !== Number(userContext.departmentId)
        ) {
          return reply.code(403).send({
            error: "Managers can assign projects only within their own department."
          });
        }
      }
      assignedUser = {
        userId: resolvedOwner.userId,
        username: resolvedOwner.username,
        role: resolvedOwner.role,
        departmentId: resolvedOwner.departmentId
      };
    }

    const globalLanguages = await loadGlobalLanguageSettings();
    const allowedLanguageSet = new Set(globalLanguages.enabledLanguages);

    const sourceLanguage =
      normalizeLanguageTag(String(args.source_lang ?? args.sourceLang ?? "")) ||
      globalLanguages.defaultSource;

    let targetLanguages = normalizeTargetLanguages(args.target_langs ?? args.targetLangs, sourceLanguage);
    if (targetLanguages.length === 0) {
      targetLanguages = globalLanguages.defaultTargets.filter((entry) => entry !== sourceLanguage);
    }
    if (targetLanguages.length === 0) {
      targetLanguages = globalLanguages.enabledLanguages.filter((entry) => entry !== sourceLanguage).slice(0, 1);
    }
    if (targetLanguages.length === 0) {
      return reply.code(400).send({ error: "At least one target language is required." });
    }

    if (allowedLanguageSet.size > 0) {
      if (!allowedLanguageSet.has(sourceLanguage)) {
        return reply.code(400).send({
          error: `Source language "${sourceLanguage}" is not enabled in global Language Settings.`
        });
      }
      const invalidTargets = targetLanguages.filter((entry) => !allowedLanguageSet.has(entry));
      if (invalidTargets.length > 0) {
        return reply.code(400).send({
          error: `Target language(s) not enabled in global Language Settings: ${invalidTargets.join(", ")}`
        });
      }
    }
    if (!globalLanguages.allowSingleLanguage && targetLanguages.every((entry) => entry === sourceLanguage)) {
      return reply.code(400).send({ error: "Target language must be different from source language." });
    }

    const dueAtIso = parseDueAtIso(args.due_at ?? args.dueAt);
    if (dueAtIso === "__invalid__") {
      return reply.code(400).send({ error: "Invalid due date/time." });
    }

    const engineRes = await db.query<{ id: number; name: string; config: any }>(
      `SELECT id, name, config
       FROM translation_engines
       WHERE disabled = FALSE
       ORDER BY
         CASE
           WHEN LOWER(COALESCE(config->>'agentDefault', 'false')) IN ('true', '1', 'yes', 'on')
             OR LOWER(COALESCE(config->>'appAgentDefault', 'false')) IN ('true', '1', 'yes', 'on')
           THEN 0
           ELSE 1
         END,
         updated_at DESC,
         id DESC`
    );
    const engineIds = new Set<number>(engineRes.rows.map((row) => Number(row.id)));
    const requestedEngineId = parsePositiveInt(
      args.translation_engine_id ?? args.translationEngineId
    );
    const defaultEngineIdRaw = Number(engineRes.rows[0]?.id ?? 0);
    const defaultEngineId =
      Number.isFinite(defaultEngineIdRaw) && defaultEngineIdRaw > 0 ? Math.trunc(defaultEngineIdRaw) : null;
    const selectedEngineId = requestedEngineId ?? defaultEngineId;
    if (!selectedEngineId) {
      return reply.code(400).send({
        error:
          "No translation engine is configured/enabled for your account/project scope. A manager/admin can enable it for you."
      });
    }
    if (!engineIds.has(selectedEngineId)) {
      return reply.code(400).send({ error: "Selected translation engine is not available." });
    }

    const rulesetRes = await db.query<{ id: number; name: string }>(
      `SELECT id, name
       FROM language_processing_rulesets
       WHERE disabled = FALSE
       ORDER BY updated_at DESC, id DESC`
    );
    const rulesetIds = new Set<number>(rulesetRes.rows.map((row) => Number(row.id)));
    const selectedRulesetId = parsePositiveInt(args.ruleset_id ?? args.rulesetId);
    if (selectedRulesetId != null && !rulesetIds.has(selectedRulesetId)) {
      return reply.code(400).send({ error: "Selected ruleset is not available." });
    }

    const tmxRes = await db.query<{ id: number; label: string }>(
      `SELECT id, label
       FROM tm_library
       WHERE disabled = FALSE
         AND origin = 'upload'
       ORDER BY updated_at DESC, id DESC`
    );
    const tmxIds = new Set<number>(tmxRes.rows.map((row) => Number(row.id)));
    const selectedTmxId = parsePositiveInt(args.tmx_id ?? args.tmxId);
    if (selectedTmxId != null && !tmxIds.has(selectedTmxId)) {
      return reply.code(400).send({ error: "Selected TMX is not available." });
    }

    const termbaseRes = await db.query<{ id: number; label: string }>(
      `SELECT id, label
       FROM glossaries
       WHERE disabled = FALSE
       ORDER BY updated_at DESC, id DESC`
    );
    const termbaseIds = new Set<number>(termbaseRes.rows.map((row) => Number(row.id)));
    const selectedTermbaseId = parsePositiveInt(
      args.termbase_id ??
        args.termbaseId ??
        args.glossary_id ??
        args.glossaryId
    );
    if (selectedTermbaseId != null && !termbaseIds.has(selectedTermbaseId)) {
      return reply.code(400).send({ error: "Selected termbase is not available." });
    }

    const sourceFileRes = await db.query<SourceFileRow>(
      `SELECT
         pf.id,
         pf.original_name,
         pf.stored_path,
         pf.file_type,
         pf.file_type_config_id,
         pf.status::text AS status,
         p.id AS project_id,
         p.department_id,
         p.assigned_user,
         p.created_by
       FROM project_files pf
       JOIN projects p ON p.id = pf.project_id
       WHERE pf.id = ANY($1::int[])`,
      [fileIds]
    );

    const sourceById = new Map<number, SourceFileRow>();
    sourceFileRes.rows.forEach((row) => {
      sourceById.set(Number(row.id), row);
    });
    if (sourceById.size !== fileIds.length) {
      return reply.code(400).send({ error: "One or more file_ids could not be found." });
    }

    let departmentId = userContext.departmentId;
    if (!departmentId) {
      const firstFile = sourceById.get(fileIds[0]!);
      const candidate = Number(firstFile?.department_id ?? 0);
      departmentId = Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : null;
    }
    if (!departmentId) {
      return reply.code(403).send({ error: "Department assignment is required to create projects." });
    }

    for (const fileId of fileIds) {
      const row = sourceById.get(fileId);
      if (!row) continue;
      const owner = String(row.assigned_user ?? row.created_by ?? "").trim();
      if (!owner || owner !== userContext.username) {
        return reply.code(403).send({ error: `Access denied for file_id ${fileId}.` });
      }
      if (row.department_id != null && Number(row.department_id) !== Number(departmentId)) {
        return reply.code(403).send({ error: `Access denied for file_id ${fileId}.` });
      }
    }

    const firstSourceFile = sourceById.get(fileIds[0]!)!;
    const projectName = String(args.name || "").trim() || buildDefaultProjectName(firstSourceFile.original_name);

    const created = await withTransaction(async (client) => {
      const projectSettings: Record<string, any> = {
        createdByAgent: true,
        sourceFileIds: fileIds,
        appAgentSourceFileMap: {},
        ownerUserId: assignedUser.userId,
        owner_user_id: assignedUser.userId,
        assignedUserId: assignedUser.userId,
        assigned_user_id: assignedUser.userId,
        translationEngineDefaultId: selectedEngineId,
        translation_engine_default_id: selectedEngineId,
        rulesetId: selectedRulesetId ?? null,
        languageProcessingRulesetId: selectedRulesetId ?? null,
        language_processing_ruleset_id: selectedRulesetId ?? null,
        rulesEnabled: selectedRulesetId != null,
        rules_enabled: selectedRulesetId != null,
        tmxId: selectedTmxId ?? null,
        tmx_id: selectedTmxId ?? null,
        termbaseEnabled: selectedTermbaseId != null,
        termbase_enabled: selectedTermbaseId != null,
        glossaryEnabled: selectedTermbaseId != null,
        glossary_enabled: selectedTermbaseId != null,
        glossaryId: selectedTermbaseId ?? null,
        glossary_id: selectedTermbaseId ?? null
      };
      if (dueAtIso && dueAtIso !== "__invalid__") {
        projectSettings.dueAt = dueAtIso;
        projectSettings.due_at = dueAtIso;
      }

      const projectRes = await client.query<{
        id: number;
        name: string;
        status: string;
        created_at: string;
      }>(
        `INSERT INTO projects(
           name,
           src_lang,
           tgt_lang,
           target_langs,
           status,
           published_at,
           init_error,
           provisioning_started_at,
           provisioning_updated_at,
           provisioning_finished_at,
           provisioning_progress,
           provisioning_current_step,
           created_by,
           assigned_user,
           department_id,
           translation_engine_id,
           glossary_id,
           owner_user_id,
           assigned_to_user_id,
           project_settings
         )
         VALUES ($1, $2, $3, $4::jsonb, 'provisioning', NULL, NULL, NOW(), NOW(), NULL, 0, 'IMPORT_FILES', $5, $6, $7, $8, $9, $10, $10, $11::jsonb)
         RETURNING id, name, status::text AS status, created_at`,
        [
          projectName,
          sourceLanguage,
          targetLanguages[0],
          JSON.stringify(targetLanguages),
          userContext.username,
          assignedUser.username,
          departmentId,
          selectedEngineId,
          selectedTermbaseId,
          assignedUser.userId,
          JSON.stringify(projectSettings)
        ]
      );
      const project = projectRes.rows[0];
      if (!project) {
        throw new Error("Failed to create project.");
      }

      const createdFileIds: number[] = [];
      const fileStatuses: Array<{
        sourceFileId: number;
        fileId: number;
        filename: string;
        status: FileProcessingStatus;
        segmentCount: number;
        error: string | null;
      }> = [];
      const sourceFileMap: Record<string, number> = {};

      for (const sourceFileId of fileIds) {
        const source = sourceById.get(sourceFileId);
        if (!source) continue;
        const fileRes = await client.query<{ id: number }>(
          `INSERT INTO project_files(project_id, original_name, stored_path, file_type, file_type_config_id, status)
           VALUES ($1, $2, $3, $4, $5, 'created')
           RETURNING id`,
          [
            project.id,
            source.original_name,
            "pending",
            source.file_type,
            source.file_type_config_id
          ]
        );
        const newFileId = Number(fileRes.rows[0]?.id ?? 0);
        if (!Number.isFinite(newFileId) || newFileId <= 0) {
          throw new Error("Failed to create project file reference.");
        }
        createdFileIds.push(newFileId);
        sourceFileMap[String(newFileId)] = sourceFileId;
        await insertFileProcessingLog(client, {
          projectId: Number(project.id),
          fileId: newFileId,
          stage: "IMPORT",
          status: "QUEUED",
          message: "Queued for agent import.",
          details: { sourceFileId }
        });

        try {
          const sourceArtifact = await loadSourceArtifact(client, sourceFileId);
          const sourceObjectKey = String(sourceArtifact?.object_key || "").trim();
          if (!sourceArtifact || !sourceObjectKey) {
            throw new Error(`Source artifact is missing for file_id ${sourceFileId}.`);
          }

          await client.query(
            `UPDATE project_files
             SET status = 'processing'
             WHERE id = $1`,
            [newFileId]
          );
          await insertFileProcessingLog(client, {
            projectId: Number(project.id),
            fileId: newFileId,
            stage: "IMPORT",
            status: "PROCESSING",
            message: "Importing and segmenting source file.",
            details: { sourceFileId }
          });

          const copiedObjectKey = keyProjectSourceOriginal({
            departmentId,
            projectId: Number(project.id),
            fileId: newFileId,
            originalFilename: source.original_name
          });
          const copyResult = await copyObject({
            sourceKey: sourceObjectKey,
            destinationKey: copiedObjectKey
          });

          await client.query(
            `UPDATE project_files
             SET stored_path = $1,
                 file_type = $2,
                 file_type_config_id = $3
             WHERE id = $4`,
            [copiedObjectKey, source.file_type, source.file_type_config_id, newFileId]
          );

          await insertFileArtifact(client, {
            projectId: Number(project.id),
            fileId: newFileId,
            kind: "source_original",
            bucket: String(sourceArtifact.bucket || getS3Bucket()),
            objectKey: copiedObjectKey,
            sha256: sourceArtifact.sha256 ?? null,
            etag: copyResult.etag ?? sourceArtifact.etag ?? null,
            sizeBytes: sourceArtifact.size_bytes ?? null,
            contentType: sourceArtifact.content_type ?? null,
            meta: sourceArtifact.meta_json ?? {},
            createdBy: userContext.username
          });

          for (const targetLanguage of targetLanguages) {
            await client.query(
              `INSERT INTO translation_tasks(
                 project_id,
                 file_id,
                 source_lang,
                 target_lang,
                 translator_user,
                 reviewer_user,
                 tmx_id,
                 seed_source,
                 engine_id,
                 glossary_id,
                 ruleset_id,
                 status
               )
               VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, 'draft')`,
              [
                project.id,
                newFileId,
                sourceLanguage,
                targetLanguage,
                assignedUser.username,
                selectedTmxId,
                selectedTmxId != null ? "tmx" : "none",
                selectedEngineId,
                selectedTermbaseId,
                selectedRulesetId
              ]
            );
          }

          let segments = await loadSeedSegmentsFromSourceFile(client, sourceFileId);
          if (segments.length === 0) {
            await insertFileProcessingLog(client, {
              projectId: Number(project.id),
              fileId: newFileId,
              stage: "PARSE",
              status: "PROCESSING",
              message: "No existing segments found. Parsing source artifact."
            });
            try {
              segments = await parseSegmentsFromSourceArtifact({
                client,
                sourceFile: source,
                sourceArtifact
              });
            } catch (err: any) {
              const officeReason = formatOfficeParseError(err);
              throw new Error(officeReason || String(err?.message || "Failed to parse source artifact."));
            }
          }

          if (segments.length === 0) {
            throw new Error("No segments extracted from source file.");
          }

          await insertSegmentsForFile(client, Number(project.id), newFileId, segments);
          await client.query(
            `UPDATE project_files
             SET status = 'ready'
             WHERE id = $1`,
            [newFileId]
          );
          await insertFileProcessingLog(client, {
            projectId: Number(project.id),
            fileId: newFileId,
            stage: "SEGMENT",
            status: "READY",
            message: `Segments prepared (${segments.length}).`,
            details: { segmentCount: segments.length }
          });
          fileStatuses.push({
            sourceFileId,
            fileId: newFileId,
            filename: String(source.original_name || ""),
            status: "READY",
            segmentCount: segments.length,
            error: null
          });
        } catch (err: any) {
          const message = String(err?.message || "Import failed");
          await client.query(
            `UPDATE project_files
             SET status = 'failed'
             WHERE id = $1`,
            [newFileId]
          );
          await insertFileProcessingLog(client, {
            projectId: Number(project.id),
            fileId: newFileId,
            stage: "IMPORT",
            status: "FAILED",
            message,
            details: { sourceFileId }
          });
          fileStatuses.push({
            sourceFileId,
            fileId: newFileId,
            filename: String(source.original_name || ""),
            status: "FAILED",
            segmentCount: 0,
            error: message
          });
        }
      }

      await client.query(
        `UPDATE projects
         SET project_settings = COALESCE(project_settings, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [
          project.id,
          JSON.stringify({
            appAgentSourceFileMap: sourceFileMap
          })
        ]
      );

      const failed = fileStatuses.filter((entry) => entry.status === "FAILED");
      const ready = fileStatuses.filter((entry) => entry.status === "READY");
      if (failed.length > 0 || ready.length === 0) {
        const initError =
          failed.length > 0
            ? failed.map((entry) => `${entry.filename}: ${entry.error || "failed"}`).join(" | ").slice(0, 1200)
            : "No segments extracted from uploaded files.";
        await client.query(
          `UPDATE projects
           SET status = 'failed',
               init_error = $2,
               provisioning_updated_at = NOW(),
               provisioning_finished_at = NOW(),
               provisioning_progress = $3,
               provisioning_current_step = 'IMPORT_FILES'
           WHERE id = $1`,
          [
            project.id,
            initError,
            Math.max(0, Math.min(99, Math.round((ready.length / Math.max(1, fileStatuses.length)) * 100)))
          ]
        );
      } else {
        await client.query(
          `UPDATE projects
           SET status = 'ready',
               published_at = NOW(),
               init_error = NULL,
               provisioning_updated_at = NOW(),
               provisioning_finished_at = NOW(),
               provisioning_progress = 100,
               provisioning_current_step = 'FINALIZE'
           WHERE id = $1`,
          [project.id]
        );
      }

      const statusRes = await client.query<{ status: string; init_error: string | null }>(
        `SELECT status::text AS status, init_error
         FROM projects
         WHERE id = $1
         LIMIT 1`,
        [project.id]
      );
      const projectStatus = String(statusRes.rows[0]?.status || "failed");

      return {
        projectId: Number(project.id),
        name: String(project.name || ""),
        status: projectStatus,
        assignedUserId: assignedUser.userId,
        assignedUsername: assignedUser.username,
        translationEngineId: selectedEngineId,
        rulesetId: selectedRulesetId ?? null,
        tmxId: selectedTmxId ?? null,
        termbaseId: selectedTermbaseId ?? null,
        dueAt: dueAtIso && dueAtIso !== "__invalid__" ? dueAtIso : null,
        fileIds: createdFileIds,
        fileStatuses,
        initError: statusRes.rows[0]?.init_error ? String(statusRes.rows[0]?.init_error) : null
      };
    });

    const now = Date.now();
    await addProjectToCreated(userContext.username, created.projectId, now);
    await addProjectToAssigned(created.assignedUsername, created.projectId, now);
    for (const fileId of created.fileIds) {
      await addFileToAssigned(created.assignedUsername, fileId, now);
    }
    await touchProjectForUsers({
      projectId: created.projectId,
      createdBy: userContext.username,
      assignedUser: created.assignedUsername,
      updatedAtMs: now
    });

    return {
      ok: true,
      project: {
        id: created.projectId,
        name: created.name,
        status: created.status,
        sourceLang: sourceLanguage,
        targetLangs: targetLanguages,
        ownerUserId: created.assignedUserId,
        assignedUserId: created.assignedUserId,
        assignedUsername: created.assignedUsername,
        translationEngineId: created.translationEngineId,
        rulesetId: created.rulesetId,
        tmxId: created.tmxId,
        termbaseId: created.termbaseId,
        dueAt: created.dueAt,
        initError: created.initError
      },
      nextAction: created.status === "ready" ? "OPEN_EDITOR" : "SHOW_PROCESSING",
      fileProcessing: created.fileStatuses.map((entry) => ({
        sourceFileId: entry.sourceFileId,
        fileId: entry.fileId,
        filename: entry.filename,
        status: entry.status,
        segmentCount: entry.segmentCount,
        error: entry.error
      })),
      fileIds: created.fileIds
    };
  });

  app.post("/chat/internal/tools/project-wizard-options", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }

    const globalLanguages = await loadGlobalLanguageSettings();
    const canAssignOthers = canAssignProjectsByRole(userContext.role);
    const assignableUsers = canAssignOthers
      ? await listAssignableUsersForContext(userContext)
      : [];
    const selfAssignee = canAssignOthers
      ? assignableUsers.find((entry) => entry.userId === userContext.userId) ?? {
          userId: userContext.userId,
          username: userContext.username,
          role: userContext.role,
          departmentId: userContext.departmentId
        }
      : {
          userId: userContext.userId,
          username: userContext.username,
          role: userContext.role,
          departmentId: userContext.departmentId
        };

    const fileTypeRes = await db.query<{
      id: number;
      name: string;
      description: string | null;
      config: any;
    }>(
      `SELECT id, name, description, config
       FROM file_type_configs
       WHERE disabled = FALSE
       ORDER BY
         CASE
           WHEN LOWER(COALESCE(config->>'agentDefault', 'false')) IN ('true', '1', 'yes', 'on')
             OR LOWER(COALESCE(config->>'appAgentDefault', 'false')) IN ('true', '1', 'yes', 'on')
           THEN 0
           ELSE 1
         END,
         updated_at DESC,
         id DESC`
    );
    const fileTypeMap = new Map<
      string,
      {
        fileType: string;
        extensions: string[];
        defaultConfigId: number;
        configs: Array<{ id: number; name: string; description: string | null }>;
      }
    >();
    fileTypeRes.rows.forEach((row) => {
      const config = normalizeJsonObject(row.config);
      const fileType = String(config.fileType || "").trim().toLowerCase();
      if (!fileType || !FILE_TYPE_EXTENSIONS[fileType]) return;
      const existing = fileTypeMap.get(fileType);
      if (!existing) {
        fileTypeMap.set(fileType, {
          fileType,
          extensions: FILE_TYPE_EXTENSIONS[fileType] || [],
          defaultConfigId: Number(row.id),
          configs: [
            {
              id: Number(row.id),
              name: String(row.name || ""),
              description: row.description ? String(row.description) : null
            }
          ]
        });
        return;
      }
      existing.configs.push({
        id: Number(row.id),
        name: String(row.name || ""),
        description: row.description ? String(row.description) : null
      });
    });

    const engineRes = await db.query<{ id: number; name: string; config: any }>(
      `SELECT id, name, config
       FROM translation_engines
       WHERE disabled = FALSE
       ORDER BY
         CASE
           WHEN LOWER(COALESCE(config->>'agentDefault', 'false')) IN ('true', '1', 'yes', 'on')
             OR LOWER(COALESCE(config->>'appAgentDefault', 'false')) IN ('true', '1', 'yes', 'on')
           THEN 0
           ELSE 1
         END,
         updated_at DESC,
         id DESC`
    );
    const rulesetRes = await db.query<{ id: number; name: string }>(
      `SELECT id, name
       FROM language_processing_rulesets
       WHERE disabled = FALSE
       ORDER BY updated_at DESC, id DESC`
    );
    const tmxRes = await db.query<{ id: number; label: string }>(
      `SELECT id, label
       FROM tm_library
       WHERE disabled = FALSE
         AND origin = 'upload'
       ORDER BY updated_at DESC, id DESC`
    );
    const termbaseRes = await db.query<{
      id: number;
      label: string;
      languages: unknown;
      visibility: string | null;
    }>(
      canAssignOthers
        ? `SELECT id, label, languages, visibility
           FROM glossaries
           WHERE disabled = FALSE
           ORDER BY updated_at DESC, id DESC`
        : `SELECT id, label, languages, visibility
           FROM glossaries
           WHERE disabled = FALSE
             AND COALESCE(LOWER(visibility), 'managers') NOT IN ('admins', 'private')
           ORDER BY updated_at DESC, id DESC`
    );

    const termbases = termbaseRes.rows.map((row) => {
      let languageList: string[] = [];
      if (Array.isArray(row.languages)) {
        languageList = row.languages.map((entry) => String(entry || "").trim()).filter(Boolean);
      } else if (typeof row.languages === "string") {
        try {
          const parsed = JSON.parse(row.languages);
          if (Array.isArray(parsed)) {
            languageList = parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
          }
        } catch {
          languageList = [];
        }
      }
      return {
        id: Number(row.id),
        label: String(row.label || ""),
        languages: languageList,
        visibility: row.visibility ? String(row.visibility) : null
      };
    });

    const defaultEngineId = engineRes.rows.length > 0 ? Number(engineRes.rows[0]?.id) : null;
    const defaultRulesetId = rulesetRes.rows.length > 0 ? Number(rulesetRes.rows[0]?.id) : null;
    const notices: Array<{ kind: string; severity: "error" | "warning"; message: string }> = [];
    if (engineRes.rows.length === 0) {
      notices.push({
        kind: "engine_missing",
        severity: "error",
        message:
          "No translation engine is configured/enabled for your account/project scope. A manager/admin can enable it for you."
      });
    }
    if (rulesetRes.rows.length === 0) {
      notices.push({
        kind: "ruleset_missing",
        severity: "warning",
        message:
          "No rulesets are available. Project creation can continue without rules, or ask a manager/admin to configure one."
      });
    }
    if (tmxRes.rows.length === 0) {
      notices.push({
        kind: "tmx_missing",
        severity: "warning",
        message:
          "TMX is not enabled for your account/project scope. A manager/admin can enable it for you."
      });
    }
    if (termbaseRes.rows.length === 0) {
      notices.push({
        kind: "termbase_missing",
        severity: "warning",
        message:
          "Termbase is not enabled for your account/project scope. A manager/admin can enable it for you."
      });
    }

    return {
      ok: true,
      wizard: {
        steps: [
          { id: "files", label: "Choose one or more files", required: true },
          { id: "target_languages", label: "Choose one or more target languages", required: true },
          { id: "due_date", label: "Set due date/time", required: false },
          { id: "assignment", label: "Set project owner/assignee", required: true },
          { id: "translation_engine", label: "Choose translation engine", required: true },
          { id: "ruleset", label: "Choose ruleset (optional)", required: false },
          { id: "tmx", label: "Choose TMX (optional)", required: false },
          { id: "termbase", label: "Choose termbase (optional)", required: false },
          { id: "confirmation", label: "Confirm and create project", required: true }
        ],
        configurable: {
          languages: {
            enabled: globalLanguages.enabledLanguages,
            defaultSource: globalLanguages.defaultSource,
            defaultTargets: globalLanguages.defaultTargets,
            allowSingleLanguage: globalLanguages.allowSingleLanguage
          },
          fileTypes: Array.from(fileTypeMap.values()).sort((a, b) =>
            a.fileType.localeCompare(b.fileType)
          ),
          assignment: {
            canAssignOthers,
            defaultOwner: {
              userId: selfAssignee.userId,
              username: selfAssignee.username,
              role: selfAssignee.role,
              departmentId: selfAssignee.departmentId
            },
            assignableUsers: assignableUsers.map((entry) => ({
              userId: entry.userId,
              username: entry.username,
              role: entry.role,
              departmentId: entry.departmentId
            }))
          },
          translationEngines: engineRes.rows.map((row) => ({
            id: Number(row.id),
            name: String(row.name || ""),
            isDefault: defaultEngineId != null && Number(row.id) === Number(defaultEngineId)
          })),
          rulesets: rulesetRes.rows.map((row) => ({
            id: Number(row.id),
            name: String(row.name || ""),
            isDefault: defaultRulesetId != null && Number(row.id) === Number(defaultRulesetId)
          })),
          tmx: tmxRes.rows.map((row) => ({
            id: Number(row.id),
            label: String(row.label || "")
          })),
          termbases,
          defaults: {
            ownerUserId: selfAssignee.userId,
            translationEngineId: defaultEngineId,
            rulesetId: defaultRulesetId,
            tmxId: null,
            termbaseId: null
          },
          availability: {
            hasEngines: engineRes.rows.length > 0,
            hasRulesets: rulesetRes.rows.length > 0,
            hasTmx: tmxRes.rows.length > 0,
            hasTermbases: termbaseRes.rows.length > 0
          },
          notices
        }
      }
    };
  });

  app.post("/chat/internal/tools/get-current-user", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    return {
      ok: true,
      user: {
        userId: userContext.userId,
        username: userContext.username,
        role: userContext.role,
        departmentId: userContext.departmentId
      }
    };
  });

  app.post("/chat/internal/tools/list-enabled-languages", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const globalLanguages = await loadGlobalLanguageSettings();
    return {
      ok: true,
      languages: {
        enabled: globalLanguages.enabledLanguages,
        defaultSource: globalLanguages.defaultSource,
        defaultTargets: globalLanguages.defaultTargets,
        allowSingleLanguage: globalLanguages.allowSingleLanguage
      }
    };
  });

  app.post("/chat/internal/tools/list-translation-engines", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const engineRes = await db.query<{ id: number; name: string; config: any }>(
      `SELECT id, name, config
       FROM translation_engines
       WHERE disabled = FALSE
       ORDER BY
         CASE
           WHEN LOWER(COALESCE(config->>'agentDefault', 'false')) IN ('true', '1', 'yes', 'on')
             OR LOWER(COALESCE(config->>'appAgentDefault', 'false')) IN ('true', '1', 'yes', 'on')
           THEN 0
           ELSE 1
         END,
         updated_at DESC,
         id DESC`
    );
    const defaultEngineId = engineRes.rows.length > 0 ? Number(engineRes.rows[0]?.id) : null;
    return {
      ok: true,
      defaultEngineId,
      translationEngines: engineRes.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name || ""),
        isDefault: defaultEngineId != null && Number(row.id) === Number(defaultEngineId)
      }))
    };
  });

  app.post("/chat/internal/tools/list-rulesets", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const rulesetRes = await db.query<{ id: number; name: string }>(
      `SELECT id, name
       FROM language_processing_rulesets
       WHERE disabled = FALSE
       ORDER BY updated_at DESC, id DESC`
    );
    return {
      ok: true,
      rulesets: rulesetRes.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name || "")
      }))
    };
  });

  app.post("/chat/internal/tools/list-tmx", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const tmxRes = await db.query<{ id: number; label: string }>(
      `SELECT id, label
       FROM tm_library
       WHERE disabled = FALSE
         AND origin = 'upload'
       ORDER BY updated_at DESC, id DESC`
    );
    return {
      ok: true,
      tmx: tmxRes.rows.map((row) => ({
        id: Number(row.id),
        label: String(row.label || "")
      }))
    };
  });

  app.post("/chat/internal/tools/list-termbases", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const canAssignOthers = canAssignProjectsByRole(userContext.role);
    const termbaseRes = await db.query<{
      id: number;
      label: string;
      languages: unknown;
      visibility: string | null;
    }>(
      canAssignOthers
        ? `SELECT id, label, languages, visibility
           FROM glossaries
           WHERE disabled = FALSE
           ORDER BY updated_at DESC, id DESC`
        : `SELECT id, label, languages, visibility
           FROM glossaries
           WHERE disabled = FALSE
             AND COALESCE(LOWER(visibility), 'managers') NOT IN ('admins', 'private')
           ORDER BY updated_at DESC, id DESC`
    );
    return {
      ok: true,
      termbases: termbaseRes.rows.map((row) => ({
        id: Number(row.id),
        label: String(row.label || ""),
        visibility: row.visibility ? String(row.visibility) : null,
        languages: normalizeLanguageList(row.languages || [])
      }))
    };
  });

  app.post("/chat/internal/tools/list-assignable-users", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    if (!canAssignProjectsByRole(userContext.role)) {
      return reply.code(403).send({ error: "Only managers/admins can list assignable users." });
    }
    const users = await listAssignableUsersForContext(userContext);
    return {
      ok: true,
      users: users.map((entry) => ({
        userId: entry.userId,
        username: entry.username,
        role: entry.role,
        departmentId: entry.departmentId
      }))
    };
  });

  app.post("/chat/internal/tools/describe-files", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const args = (body.args as InternalCreateProjectArgs) || {};
    const fileIds = parsePositiveIntArray(args.file_ids ?? args.fileIds);
    if (fileIds.length === 0) {
      return reply.code(400).send({ error: "At least one file_id is required." });
    }

    const fileRes = await db.query<{
      id: number;
      original_name: string;
      project_id: number;
      department_id: number | null;
      assigned_user: string | null;
      created_by: string | null;
    }>(
      `SELECT
         pf.id,
         pf.original_name,
         p.id AS project_id,
         p.department_id,
         p.assigned_user,
         p.created_by
       FROM project_files pf
       JOIN projects p ON p.id = pf.project_id
       WHERE pf.id = ANY($1::int[])`,
      [fileIds]
    );

    const byId = new Map<number, {
      id: number;
      original_name: string;
      project_id: number;
      department_id: number | null;
      assigned_user: string | null;
      created_by: string | null;
    }>();
    fileRes.rows.forEach((row) => byId.set(Number(row.id), row));
    if (byId.size !== fileIds.length) {
      return reply.code(400).send({ error: "One or more file_ids could not be found." });
    }

    for (const fileId of fileIds) {
      const row = byId.get(fileId);
      if (!row) continue;
      const owner = String(row.assigned_user ?? row.created_by ?? "").trim();
      if (!owner || owner !== userContext.username) {
        return reply.code(403).send({ error: `Access denied for file_id ${fileId}.` });
      }
      if (
        userContext.departmentId != null &&
        row.department_id != null &&
        Number(row.department_id) !== Number(userContext.departmentId)
      ) {
        return reply.code(403).send({ error: `Access denied for file_id ${fileId}.` });
      }
    }

    return {
      ok: true,
      files: fileIds.map((fileId) => {
        const row = byId.get(fileId)!;
        return {
          fileId,
          filename: String(row.original_name || ""),
          projectId: Number(row.project_id),
          departmentId: row.department_id != null ? Number(row.department_id) : null
        };
      })
    };
  });

  app.post("/chat/internal/tools/list-projects", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }

    const args = (body.args as Record<string, unknown>) || {};
    const limitRaw = Number(args.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.trunc(limitRaw))) : 5;
    const statusFilter = String(args.status || "").trim().toLowerCase();

    const res = await db.query<{
      id: number;
      name: string;
      status: string;
      src_lang: string;
      tgt_lang: string;
      created_at: string;
      last_updated_at: string;
      total_segments: number;
      translated_segments: number;
    }>(
      `SELECT
         p.id,
         p.name,
         p.status::text AS status,
         p.src_lang,
         p.tgt_lang,
         p.created_at,
         COALESCE(MAX(s.updated_at), p.created_at) AS last_updated_at,
         COUNT(s.id)::int AS total_segments,
         COALESCE(SUM(CASE WHEN BTRIM(COALESCE(s.tgt, '')) <> '' THEN 1 ELSE 0 END), 0)::int AS translated_segments
       FROM projects p
       LEFT JOIN segments s ON s.project_id = p.id
       WHERE (p.assigned_user = $1 OR (p.assigned_user IS NULL AND p.created_by = $1))
         AND COALESCE(p.project_settings->>'appAgentUploadSession', 'false') <> 'true'
         AND ($2::text = '' OR LOWER(p.status::text) = $2)
       GROUP BY p.id
       ORDER BY last_updated_at DESC, p.id DESC
       LIMIT $3`,
      [userContext.username, statusFilter, limit]
    );

    const projects = res.rows.map((row) => {
      const totalSegments = Number(row.total_segments || 0);
      const translatedSegments = Number(row.translated_segments || 0);
      const progressPct = totalSegments > 0 ? Math.round((translatedSegments / totalSegments) * 100) : 0;
      return {
        projectId: Number(row.id),
        name: String(row.name || ""),
        status: String(row.status || ""),
        sourceLang: String(row.src_lang || ""),
        targetLang: String(row.tgt_lang || ""),
        progressPct,
        translatedSegments,
        totalSegments,
        lastUpdatedAt: new Date(row.last_updated_at).toISOString(),
        createdAt: new Date(row.created_at).toISOString()
      };
    });

    return { ok: true, projects };
  });

  app.post("/chat/internal/tools/get-project-status", async (req: any, reply) => {
    if (!requireInternalAgentSecret(req, reply)) return;
    const body = (req.body as any) || {};
    const parsedUserContext = parseUserContext(body.userContext);
    if (!parsedUserContext) {
      return reply.code(400).send({ error: "Invalid user context." });
    }
    const userContext = await resolveVerifiedToolUser(parsedUserContext);
    if (!userContext) {
      return reply.code(403).send({ error: "User context verification failed." });
    }
    const args = (body.args as Record<string, unknown>) || {};
    const projectIdRaw = Number(args.projectId);
    const projectId = Number.isFinite(projectIdRaw) && projectIdRaw > 0 ? Math.trunc(projectIdRaw) : 0;
    if (!projectId) {
      return reply.code(400).send({ error: "projectId is required." });
    }

    const projectRes = await db.query<{
      id: number;
      name: string;
      status: string;
      src_lang: string;
      tgt_lang: string;
      updated_at: string;
      created_at: string;
    }>(
      `SELECT id, name, status::text AS status, src_lang, tgt_lang, updated_at, created_at
       FROM projects
       WHERE id = $1
         AND (assigned_user = $2 OR (assigned_user IS NULL AND created_by = $2))
       LIMIT 1`,
      [projectId, userContext.username]
    );
    const project = projectRes.rows[0];
    if (!project) {
      return reply.code(404).send({ error: "Project not found." });
    }

    const progressRes = await db.query<{
      total: number;
      translated: number;
      reviewed: number;
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN BTRIM(COALESCE(tgt, '')) <> '' THEN 1 ELSE 0 END), 0)::int AS translated,
         COALESCE(SUM(CASE WHEN status IN ('reviewed', 'approved') THEN 1 ELSE 0 END), 0)::int AS reviewed
        FROM segments
       WHERE project_id = $1
         AND task_id IS NULL`,
      [projectId]
    );

    const totalSegments = Number(progressRes.rows[0]?.total ?? 0);
    const translatedSegments = Number(progressRes.rows[0]?.translated ?? 0);
    const reviewedSegments = Number(progressRes.rows[0]?.reviewed ?? 0);
    const progressPct = totalSegments > 0 ? Math.round((translatedSegments / totalSegments) * 100) : 0;
    const fileRes = await db.query<{
      file_id: number;
      filename: string;
      status: string;
      segment_count: number;
    }>(
      `SELECT
         pf.id AS file_id,
         pf.original_name AS filename,
         COALESCE(pf.status::text, 'queued') AS status,
         COALESCE(COUNT(s.id), 0)::int AS segment_count
       FROM project_files pf
       LEFT JOIN segments s
         ON s.project_id = pf.project_id
        AND s.file_id = pf.id
        AND s.task_id IS NULL
       WHERE pf.project_id = $1
       GROUP BY pf.id
       ORDER BY pf.id ASC`,
      [projectId]
    );

    return {
      ok: true,
      project: {
        projectId: Number(project.id),
        name: String(project.name || ""),
        status: String(project.status || ""),
        sourceLang: String(project.src_lang || ""),
        targetLang: String(project.tgt_lang || ""),
        progress: {
          totalSegments,
          translatedSegments,
          reviewedSegments,
          translatedPct: progressPct
        },
        fileProcessing: fileRes.rows.map((row) => ({
          fileId: Number(row.file_id),
          filename: String(row.filename || ""),
          status: String(row.status || "").trim().toUpperCase(),
          segmentCount: Number(row.segment_count || 0)
        })),
        updatedAt: new Date(project.updated_at || project.created_at).toISOString()
      }
    };
  });
};
