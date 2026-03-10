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

import type { FastifyInstance } from "fastify";
import * as shared from "./app-agent.shared.js";

type InternalCreateProjectArgs = shared.InternalCreateProjectArgs;

export async function registerAppAgentInternalToolRoutes(app: FastifyInstance) {
  const {
    parsePositiveIntArray,
    normalizeLanguageList,
    normalizeJsonObject,
    normalizeProjectAccessRole,
    canAssignProjectsByRole,
    listAssignableUsersForContext,
    parseUserContext,
    requireInternalAgentSecret,
    resolveVerifiedToolUser,
    loadGlobalLanguageSettings,
    FILE_TYPE_EXTENSIONS
  } = shared;

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
      normalizeProjectAccessRole(userContext.role) === "admin"
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
        severity: "warning",
        message:
          "No translation engine is configured right now. Project creation can continue without one, or an admin can configure it later."
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
          { id: "title", label: "Choose a project title", required: true },
          { id: "files", label: "Upload at least one file", required: true },
          { id: "target_languages", label: "Choose one or more target languages", required: true },
          { id: "assignment", label: "Choose the assignee", required: true },
          { id: "translation_engine", label: "Choose translation engine (optional)", required: false },
          { id: "ruleset", label: "Choose rules (optional)", required: false },
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
}
