import { FastifyInstance } from "fastify";
import { insertSegmentsForFile } from "./projects.segment-insert.js";
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
import { normalizeParsingTemplateConfig, normalizeXmlParsingTemplateConfig } from "../lib/parsing-templates.js";
import { extractXmlSegmentsWithTemplate } from "../lib/xml-extraction.js";
import { segmentPlainText, toText } from "../utils.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";
import AdmZip from "adm-zip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  normalizeEngineDefaultsByTarget,
  normalizeEngineOverrides,
  resolveEngineSelection
} from "../lib/translation-engine-settings.js";
import { enqueuePretranslateJobs } from "../lib/pretranslate-queue.js";
import { enqueueProvisionJobIfImportReady } from "../lib/provision-queue.js";
import { retryProvisionJob } from "../lib/provision-worker.js";
import { parseOfficeRichSegments } from "../lib/office-rich.js";
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
  aggregateCustomFields,
  aggregateEntryAudit,
  aggregateTermAudit,
  auditFromRow,
  buildDocxBuffer,
  buildOfficeParserConfig,
  buildPptxBuffer,
  buildTargetFilename,
  buildXlsxBuffer,
  buildXmlOutput,
  coerceSourceType,
  conceptKeyForRow,
  contentTypeForExtension,
  DOCX_CONTENT_TYPES_XML,
  DOCX_RELS_XML,
  encodeTermKey,
  escapeXml,
  formatOfficeParseError,
  getFileTypeConfigParsingTemplateId,
  getProjectRow,
  hasAudit,
  hasElementChildren,
  INLINE_TOKEN_RE,
  isRequestError,
  isTextLikeContentType,
  isUploadError,
  listProjectFiles,
  listProjectHtmlFiles,
  makeRequestError,
  makeUploadError,
  mergeAudit,
  mergeAuditAggregate,
  mergeFieldMap,
  normalizeAuditMeta,
  normalizeAuditValue,
  normalizeFieldMap,
  normalizeJsonObject,
  normalizeLang,
  normalizeLangList,
  normalizeLanguageFields,
  normalizeTermAuditMap,
  normalizeTermbaseLang,
  normalizeTermbaseMeta,
  normalizeTermFields,
  OFFICE_UPLOAD_TYPES,
  parseNodePath,
  parseOptionalBool,
  parseOptionalInt,
  parseSourceType,
  projectDepartmentId,
  ProjectFileListRow,
  ProjectRow,
  ProjectTaskRow,
  requesterMatchesUser,
  RequestError,
  resolveOutputExtension,
  resolveSegmentText,
  resolveUploadFileType,
  resolveUserDepartmentId,
  resolveUserRef,
  resolveUserRole,
  rowToProject,
  rowToSegment,
  safeDispositionFilename,
  sanitizeSegments,
  sanitizeTextForDb,
  SegmentRow,
  SegmentSourceType,
  selectElementByPath,
  statusFromMeta,
  TermbaseAudit,
  TermbaseEntryRow,
  TermbaseFieldMap,
  TermbaseLanguageFields,
  TermbaseMatchEntry,
  TermbaseMatchSection,
  TermbaseMatchTerm,
  TermbaseTermAudit,
  TermbaseTermFields,
  toBase64Url,
  toIsoOrNull,
  truncateErrorMessage,
  uniqueTerms,
  UploadError,
  UploadType,
  withTimeout
} from './projects.helpers.js';


export async function registerProjectRoutesPart4(app: FastifyInstance) {
  // --- DELETE Project ---
  app.delete("/projects/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!Number.isFinite(projectId)) {
      return reply.code(400).send({ error: "Invalid project id" });
    }

    const row = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!row) return;

    const createdBy = (row as any).created_by ? String((row as any).created_by) : null;
    const assignedUserRaw = (row as any).assigned_user ? String((row as any).assigned_user) : null;
    const assignedUser = assignedUserRaw || createdBy;

    await db.query(
      `DELETE FROM segment_qa
       WHERE segment_id IN (SELECT id FROM segments WHERE project_id = $1)`,
      [projectId]
    );
    await db.query("DELETE FROM segments WHERE project_id = $1", [projectId]);
    const fileRowsRes = await db.query<{ id: number; stored_path: string }>(
      "SELECT id, stored_path FROM project_files WHERE project_id = $1",
      [projectId]
    );
    const fileRows = fileRowsRes.rows;
    const fileIds = fileRows.map((row) => row.id);
    if (fileIds.length > 0) {
      await db.query(
        `DELETE FROM project_file_html_templates WHERE file_id = ANY($1::int[])`,
        [fileIds]
      );
    }

    const artifactRes = await db.query<{ object_key: string }>(
      `SELECT DISTINCT a.object_key
       FROM file_artifacts a
       JOIN project_files f ON f.id = a.file_id
       WHERE f.project_id = $1`,
      [projectId]
    );

    const objectKeys = new Set<string>();
    for (const row of artifactRes.rows) {
      const key = String((row as any).object_key || "").trim();
      if (key) objectKeys.add(key);
    }
    for (const row of fileRows) {
      const key = String((row as any).stored_path || "").trim();
      if (key && key !== "pending") objectKeys.add(key);
    }

    await db.query("DELETE FROM project_files WHERE project_id = $1", [projectId]);
    await db.query("DELETE FROM projects WHERE id = $1", [projectId]);

    for (const key of objectKeys) {
      try {
        await deleteObject({ key });
      } catch (err) {
        (req as any).log?.warn?.({ err, key }, "Failed to delete S3 object for project");
      }
    }

    try {
      const client = getRedisClient();
      if (createdBy) {
        await client.zRem(userProjectsCreatedKey(createdBy), String(projectId));
      }
      if (assignedUser) {
        await client.zRem(userProjectsAssignedKey(assignedUser), String(projectId));
      }
      if (fileIds.length > 0) {
        const members = fileIds.map((id) => String(id));
        if (createdBy) {
          await client.zRem(userFilesAssignedKey(createdBy), members);
        }
        if (assignedUser && assignedUser !== createdBy) {
          await client.zRem(userFilesAssignedKey(assignedUser), members);
        }
      }
    } catch {
      /* ignore redis errors */
    }
    return { ok: true };
  });

  // --- ASSIGN Project ---
  app.post("/projects/:id/assign", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    const accessRow = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!accessRow) return;
    const row = await getProjectRow(projectId);
    if (!row) return reply.code(404).send({ error: "Project not found" });
    const previousAssigned = row.assigned_user ?? row.created_by ?? null;

    const hasFiles = await db.query<{ id: number }>(
      "SELECT id FROM project_files WHERE project_id = $1 LIMIT 1",
      [projectId]
    );
    if ((hasFiles.rowCount ?? 0) > 0) {
      return reply.code(409).send({
        error: "Assignment is locked for project files.",
        code: "ASSIGNMENT_LOCKED"
      });
    }

    const body = (req.body as any) || {};
    if (!body.userId) {
      return reply.code(400).send({ error: "userId is required" });
    }
    const assigned = await resolveUserRef(body.userId);
    if (!assigned) {
      return reply.code(400).send({ error: "Invalid userId" });
    }
    const requester = getRequestUser(req);
    const isSelfAssignment = await requesterMatchesUser(requester, assigned);
    if (isManagerUser(requester) && !isSelfAssignment) {
      return reply.code(403).send({ error: "Managers can only assign themselves as project owner" });
    }
    const assignedRole = await resolveUserRole(assigned);
    if (!assignedRole || (assignedRole !== "admin" && assignedRole !== "manager")) {
      return reply.code(400).send({ error: "Project owner must be an admin or manager" });
    }
    if (assignedRole === "admin" && !isSelfAssignment) {
      return reply.code(403).send({ error: "Admins can only assign themselves as project owner" });
    }
    const departmentId = projectDepartmentId(accessRow);
    if (assignedRole === "manager") {
      const assignedDepartmentId = await resolveUserDepartmentId(assigned);
      if (assignedDepartmentId == null || assignedDepartmentId !== departmentId) {
        return reply.code(403).send({ error: "Project owner must belong to the project department" });
      }
    }
    try {
      await db.query("UPDATE projects SET assigned_user = $1 WHERE id = $2", [
        assigned,
        projectId
      ]);
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply
          .code(409)
          .send({ error: "A project with this name already exists." });
      }
      throw err;
    }

    try {
      if (previousAssigned) await removeProjectFromAssigned(previousAssigned, projectId);
      await addProjectToAssigned(assigned, projectId, Date.now());
      await touchProjectForUsers({
        projectId,
        createdBy: row.created_by ?? null,
        assignedUser: assigned,
        updatedAtMs: Date.now()
      });
    } catch {
      /* ignore redis errors */
    }

    const patched = await getProjectRow(projectId);
    return { project: patched ? await rowToProject(patched) : null };
  });

  // --- ASSIGN Project To Me ---
  app.post("/projects/:id/assign-to-me", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    const accessRow = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!accessRow) return;
    const row = await getProjectRow(projectId);
    if (!row) return reply.code(404).send({ error: "Project not found" });
    const previousAssigned = row.assigned_user ?? row.created_by ?? null;

    const hasFiles = await db.query<{ id: number }>(
      "SELECT id FROM project_files WHERE project_id = $1 LIMIT 1",
      [projectId]
    );
    if ((hasFiles.rowCount ?? 0) > 0) {
      return reply.code(409).send({
        error: "Assignment is locked for project files.",
        code: "ASSIGNMENT_LOCKED"
      });
    }

    const requester = getRequestUser(req);
    const requesterId = requestUserId(requester);
    if (!requesterId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const assigned = await resolveUserRef(requesterId);
    if (!assigned) {
      return reply.code(400).send({ error: "Invalid userId" });
    }

    const assignedRole = await resolveUserRole(assigned);
    if (!assignedRole || (assignedRole !== "admin" && assignedRole !== "manager")) {
      return reply.code(400).send({ error: "Project owner must be an admin or manager" });
    }
    const departmentId = projectDepartmentId(accessRow);
    if (assignedRole === "manager") {
      const assignedDepartmentId = await resolveUserDepartmentId(assigned);
      if (assignedDepartmentId == null || assignedDepartmentId !== departmentId) {
        return reply.code(403).send({ error: "Project owner must belong to the project department" });
      }
    }

    try {
      await db.query("UPDATE projects SET assigned_user = $1 WHERE id = $2", [
        assigned,
        projectId
      ]);
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply
          .code(409)
          .send({ error: "A project with this name already exists." });
      }
      throw err;
    }

    try {
      if (previousAssigned) await removeProjectFromAssigned(previousAssigned, projectId);
      await addProjectToAssigned(assigned, projectId, Date.now());
      await touchProjectForUsers({
        projectId,
        createdBy: row.created_by ?? null,
        assignedUser: assigned,
        updatedAtMs: Date.now()
      });
    } catch {
      /* ignore redis errors */
    }

    const patched = await getProjectRow(projectId);
    return { project: patched ? await rowToProject(patched) : null };
  });

  // --- PRESIGN Project File Upload (S3) ---
  app.post("/projects/:id/files/presign", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const pid = Number(req.params.id);
    const accessRow = await ensureProjectAccess(pid, getRequestUser(req), reply);
    if (!accessRow) return;

    const body = (req.body as any) || {};
    let requestedFileId = parseOptionalInt(body.fileId ?? body.file_id);
    const contentTypeRaw = body.contentType != null ? String(body.contentType).trim() : "";
    const contentType = contentTypeRaw.length > 0 ? contentTypeRaw : null;

    let existingFile: { id: number; original_name: string; file_type: string | null; file_type_config_id: number | null } | null = null;
    let reusedPlaceholderFile = false;
    if (requestedFileId != null) {
      const fileRes = await db.query<{ id: number; original_name: string; file_type: string | null; file_type_config_id: number | null }>(
        "SELECT id, original_name, file_type, file_type_config_id FROM project_files WHERE project_id = $1 AND id = $2 LIMIT 1",
        [pid, requestedFileId]
      );
      existingFile = fileRes.rows[0] ?? null;
      if (!existingFile) return reply.code(404).send({ error: "Project file not found" });
    } else {
      const placeholderRes = await db.query<{ id: number; original_name: string; file_type: string | null; file_type_config_id: number | null }>(
        `SELECT id, original_name, file_type, file_type_config_id
         FROM project_files
         WHERE project_id = $1
           AND status = 'created'
         ORDER BY id ASC
         LIMIT 1`,
        [pid]
      );
      const placeholder = placeholderRes.rows[0] ?? null;
      if (placeholder) {
        requestedFileId = Number(placeholder.id);
        existingFile = placeholder;
        reusedPlaceholderFile = true;
      }
    }

    const filename = String(body.filename || existingFile?.original_name || "").trim();
    if (!filename) {
      return reply.code(400).send({ error: "filename is required" });
    }
    if (
      existingFile &&
      body.filename &&
      String(body.filename) !== String(existingFile.original_name) &&
      !reusedPlaceholderFile
    ) {
      return reply.code(400).send({ error: "filename must match the existing project file" });
    }

    const uploadType = resolveUploadFileType(filename);
    const requestedFileTypeConfigId = parseOptionalInt(body.fileTypeConfigId ?? body.file_type_config_id);
    let fileTypeConfigId: number | null = null;
    const projectFlagsRes = await db.query<{ is_agent_upload_session: boolean }>(
      `SELECT COALESCE(project_settings->>'appAgentUploadSession', 'false') = 'true' AS is_agent_upload_session
       FROM projects
       WHERE id = $1
       LIMIT 1`,
      [pid]
    );
    const preferAgentDefaultConfig = Boolean(projectFlagsRes.rows[0]?.is_agent_upload_session);
    const validateFileTypeConfig = async (id: number) => {
      const cfgRes = await db.query<{ id: number; disabled: boolean; config: any }>(
        `SELECT id, disabled, config FROM file_type_configs WHERE id = $1 LIMIT 1`,
        [id]
      );
      const row = cfgRes.rows[0];
      if (!row) {
        reply.code(400).send({ error: "Selected File Type Configuration not found.", code: "FILE_TYPE_CONFIG_INVALID" });
        return null;
      }
      if (row.disabled) {
        reply.code(400).send({ error: "Selected File Type Configuration is disabled.", code: "FILE_TYPE_CONFIG_INVALID" });
        return null;
      }
      if (uploadType) {
        const cfgType = String(row.config?.fileType || "").trim().toLowerCase();
        if (cfgType !== uploadType) {
          reply.code(400).send({ error: "Selected File Type Configuration does not match this file type.", code: "FILE_TYPE_CONFIG_INVALID" });
          return null;
        }
      }
      return row;
    };

    if (requestedFileTypeConfigId != null) {
      const validated = await validateFileTypeConfig(requestedFileTypeConfigId);
      if (!validated) return;
      fileTypeConfigId = requestedFileTypeConfigId;
    } else if (existingFile?.file_type_config_id != null) {
      const validated = await validateFileTypeConfig(existingFile.file_type_config_id);
      if (!validated) return;
      fileTypeConfigId = existingFile.file_type_config_id;
    } else if (uploadType) {
      const cfgRes = await db.query<{ id: number }>(
        `SELECT id
         FROM file_type_configs
         WHERE disabled = FALSE
           AND LOWER(config->>'fileType') = $1
         ORDER BY
           CASE
             WHEN $2::boolean = TRUE
               AND (
                 LOWER(COALESCE(config->>'agentDefault', 'false')) IN ('true', '1', 'yes', 'on')
                 OR LOWER(COALESCE(config->>'appAgentDefault', 'false')) IN ('true', '1', 'yes', 'on')
               )
             THEN 0
             ELSE 1
           END,
           updated_at DESC,
           id DESC
         LIMIT 1`,
        [uploadType, preferAgentDefaultConfig]
      );
      const row = cfgRes.rows[0];
      if (!row) {
        return reply.code(400).send({
          error: `No File Type Configuration configured for ${uploadType.toUpperCase()} files. Create one first in Resources > File Type Configurations.`,
          code: "FILE_TYPE_CONFIG_REQUIRED",
          fileType: uploadType
        });
      }
      fileTypeConfigId = Number(row.id);
    }

    const departmentId = projectDepartmentId(accessRow);

    let fileId: number;
    let objectKey: string;
    if (requestedFileId != null) {
      fileId = requestedFileId;
      objectKey = keyProjectSourceOriginal({
        departmentId,
        projectId: pid,
        fileId,
        originalFilename: filename
      });
      await db.query(
        `UPDATE project_files
         SET stored_path = $1,
             file_type = $2,
             file_type_config_id = $3,
             status = $4,
             original_name = $5
         WHERE id = $6`,
        [objectKey, uploadType, fileTypeConfigId, "uploading", filename, fileId]
      );
    } else {
      const created = await withTransaction(async (client) => {
        const fileRes = await client.query<{ id: number }>(
          `INSERT INTO project_files(project_id, original_name, stored_path, file_type, file_type_config_id, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [pid, filename, "pending", uploadType, fileTypeConfigId, "uploading"]
        );
        const createdFileId = Number(fileRes.rows[0]?.id);
        if (!Number.isFinite(createdFileId) || createdFileId <= 0) {
          throw new Error("Failed to create project file");
        }

        const createdObjectKey = keyProjectSourceOriginal({
          departmentId,
          projectId: pid,
          fileId: createdFileId,
          originalFilename: filename
        });

        await client.query(`UPDATE project_files SET stored_path = $1 WHERE id = $2`, [createdObjectKey, createdFileId]);

        return { fileId: createdFileId, objectKey: createdObjectKey };
      });
      fileId = created.fileId;
      objectKey = created.objectKey;
    }

    const presigned = await presignPutObject({ key: objectKey, contentType });

    return {
      fileId,
      bucket: getS3Bucket(),
      objectKey,
      uploadUrl: presigned.url,
      headers: presigned.headers
    };
  });

  // --- FINALIZE Project File Upload (S3) ---
  app.post("/projects/:id/files/:fileId/finalize", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const pid = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    const requestId = String((req as any).id || "");
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid ids" });
    }

    const accessRow = await ensureProjectAccess(pid, getRequestUser(req), reply);
    if (!accessRow) return;

    const fileRes = await db.query<{ id: number; original_name: string; stored_path: string; file_type: string | null; file_type_config_id: number | null }>(
      "SELECT id, original_name, stored_path, file_type, file_type_config_id FROM project_files WHERE project_id = $1 AND id = $2 LIMIT 1",
      [pid, fileId]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) return reply.code(404).send({ error: "Project file not found" });

    const originalFilename = String(fileRow.original_name || "").trim();
    const objectKey = String(fileRow.stored_path || "").trim();
    if (!objectKey) return reply.code(400).send({ error: "Missing stored object key" });

    const body = (req.body as any) || {};
    const requestedFileTypeConfigId =
      parseOptionalInt(body.fileTypeConfigId ?? body.file_type_config_id) ??
      parseOptionalInt(fileRow.file_type_config_id);

    const uploadType = resolveUploadFileType(originalFilename);
    const projectFlagsRes = await db.query<{ is_agent_upload_session: boolean }>(
      `SELECT COALESCE(project_settings->>'appAgentUploadSession', 'false') = 'true' AS is_agent_upload_session
       FROM projects
       WHERE id = $1
       LIMIT 1`,
      [pid]
    );
    const preferAgentDefaultConfig = Boolean(projectFlagsRes.rows[0]?.is_agent_upload_session);
    let fileTypeConfig: { id: number; config: any } | null = null;
    if (uploadType) {
      if (requestedFileTypeConfigId != null) {
        const cfgRes = await db.query<{ id: number; config: any }>(
          `SELECT id, config
           FROM file_type_configs
           WHERE id = $1
             AND disabled = FALSE
           LIMIT 1`,
          [requestedFileTypeConfigId]
        );
        const row = cfgRes.rows[0] ?? null;
        if (!row) {
          return reply.code(400).send({ error: "Selected File Type Configuration not found.", code: "FILE_TYPE_CONFIG_INVALID" });
        }
        const cfgType = String(row.config?.fileType || "").trim().toLowerCase();
        if (cfgType !== uploadType) {
          return reply.code(400).send({ error: "Selected File Type Configuration does not match this file type.", code: "FILE_TYPE_CONFIG_INVALID" });
        }
        fileTypeConfig = row;
      } else {
        const cfgRes = await db.query<{ id: number; config: any }>(
          `SELECT id, config
           FROM file_type_configs
           WHERE disabled = FALSE
             AND LOWER(config->>'fileType') = $1
           ORDER BY
             CASE
               WHEN $2::boolean = TRUE
                 AND (
                   LOWER(COALESCE(config->>'agentDefault', 'false')) IN ('true', '1', 'yes', 'on')
                   OR LOWER(COALESCE(config->>'appAgentDefault', 'false')) IN ('true', '1', 'yes', 'on')
                 )
               THEN 0
               ELSE 1
             END,
             updated_at DESC,
             id DESC
           LIMIT 1`,
          [uploadType, preferAgentDefaultConfig]
        );
        fileTypeConfig = cfgRes.rows[0] ?? null;
        if (!fileTypeConfig) {
          return reply.code(400).send({
            error: `No File Type Configuration configured for ${uploadType.toUpperCase()} files. Create one first in Resources > File Type Configurations.`,
            code: "FILE_TYPE_CONFIG_REQUIRED",
            fileType: uploadType
          });
        }
      }
    }

    let buf: Buffer;
    let etag: string | null;
    let contentType: string | null;
    try {
      ({ buf, etag, contentType } = await getObjectBuffer({ key: objectKey }));
    } catch (err) {
      req.log.error({ err, requestId, projectId: pid, fileId, objectKey, subsystem: "storage" }, "Finalize upload: failed to fetch object");
      return reply.code(400).send({
        error: "Uploaded file is missing or unreadable.",
        code: "UPLOAD_MISSING",
        requestId
      });
    }
    const sha256 = await sha256Hex(buf);

    const ext = path.extname(originalFilename).toLowerCase();

    let segs: Array<{
      src: string;
      tgt?: string | null;
      srcRuns?: any;
      tgtRuns?: any;
      segmentContext?: any;
      originDetails?: any;
    }> = [];
    let htmlTemplate: { template: string; markers: any[]; parsingTemplateId: number } | null = null;
    const normalizedContentType = contentType ? String(contentType) : null;
    const isXlf = ext === ".xlf" || ext === ".xliff";

    try {
      if (isXlf) {
        const parsed = parseXliffSegments(buf.toString());
        segs = parsed.map((p) => ({ src: p.src, tgt: p.tgt }));
      } else if (uploadType === "html") {
        const parsingTemplateId = fileTypeConfig ? getFileTypeConfigParsingTemplateId(fileTypeConfig.config, "html") : null;
        if (!parsingTemplateId) {
          return reply.code(400).send({
            error: "File Type Configuration is missing an extraction template.",
            code: "FILE_TYPE_CONFIG_INVALID"
          });
        }

        const templateRes = await db.query<{ config: any; kind: string }>(
          `SELECT config, kind FROM parsing_templates WHERE id = $1 LIMIT 1`,
          [parsingTemplateId]
        );
        const templateRow = templateRes.rows[0];
        if (!templateRow) {
          return reply.code(400).send({ error: "Invalid extraction template.", code: "PARSING_TEMPLATE_INVALID" });
        }
        if (String(templateRow.kind || "html").toLowerCase() === "xml") {
          return reply.code(400).send({ error: "Selected template is not an HTML/XHTML template.", code: "PARSING_TEMPLATE_INVALID" });
        }

        let config;
        try {
          config = normalizeParsingTemplateConfig(templateRow.config);
        } catch (err: any) {
          return reply.code(400).send({
            error: err?.message || "Invalid parsing template config",
            code: "PARSING_TEMPLATE_INVALID"
          });
        }

        const xmlMode = ext === ".xhtml" || ext === ".xtml";
        const parsed = segmentHtmlWithTemplate(buf, config, { xmlMode });
        segs = parsed.segments.map((text) => ({ src: text }));
        htmlTemplate = { template: parsed.template, markers: parsed.map ?? [], parsingTemplateId };
      } else if (uploadType === "xml") {
        const parsingTemplateId = fileTypeConfig ? getFileTypeConfigParsingTemplateId(fileTypeConfig.config, "xml") : null;
        if (!parsingTemplateId) {
          return reply.code(400).send({
            error: "File Type Configuration is missing an extraction template.",
            code: "FILE_TYPE_CONFIG_INVALID"
          });
        }

        const templateRes = await db.query<{ config: any; kind: string }>(
          `SELECT config, kind FROM parsing_templates WHERE id = $1 LIMIT 1`,
          [parsingTemplateId]
        );
        const templateRow = templateRes.rows[0];
        if (!templateRow) {
          return reply.code(400).send({ error: "Invalid extraction template.", code: "PARSING_TEMPLATE_INVALID" });
        }
        if (String(templateRow.kind || "html").toLowerCase() !== "xml") {
          return reply.code(400).send({ error: "Selected template is not an XML template.", code: "PARSING_TEMPLATE_INVALID" });
        }

        let config;
        try {
          config = normalizeXmlParsingTemplateConfig(templateRow.config);
        } catch (err: any) {
          return reply.code(400).send({
            error: err?.message || "Invalid XML parsing template config",
            code: "PARSING_TEMPLATE_INVALID"
          });
        }

        const cfgNorm = normalizeJsonObject(fileTypeConfig?.config);
        const xmlCfg = normalizeJsonObject(cfgNorm.xml);
        const segmenter = String(xmlCfg.segmenter || "lines").toLowerCase() === "sentences" ? "sentences" : "lines";
        const preserveWhitespace = xmlCfg.preserveWhitespace !== undefined ? Boolean(xmlCfg.preserveWhitespace) : true;

        const extracted = extractXmlSegmentsWithTemplate({
          fileBuffer: buf,
          template: config,
          segmenter,
          preserveWhitespace
        });
        segs = extracted.segments.map((seg) => ({ src: seg.taggedText }));
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
          let text: string;
          try {
            text = await withTimeout(
              officeParser.parseOfficeAsync(buf, officeConfig),
              CONFIG.CONVERSION_TIMEOUT_MS,
              `${uploadType.toUpperCase()} conversion`
            );
          } catch (err) {
            const reason = formatOfficeParseError(err);
            req.log.error(
              {
                err,
                requestId,
                projectId: pid,
                fileId,
                objectKey,
                fileName: originalFilename,
                contentType: normalizedContentType,
                sizeBytes: buf.length,
                subsystem: "conversion",
                converter: { type: uploadType, config: officeConfig, reason }
              },
              "Finalize upload conversion failed"
            );
            const userMessage = `${uploadType.toUpperCase()} upload failed during conversion. ` +
              `${reason ? `Reason: ${reason}. ` : ""}Try again or contact admin.`;
            throw makeUploadError(
              422,
              "FILE_CONVERSION_FAILED",
              userMessage.trim(),
              reason,
              err
            );
          }
          segs = segmentPlainText(sanitizeTextForDb(String(text || ""))).map((segment) => ({ src: segment }));
        }
      } else if (uploadType && OFFICE_UPLOAD_TYPES.has(uploadType)) {
        const officeConfig = buildOfficeParserConfig(uploadType, fileTypeConfig);
        let text: string;
        try {
          text = await withTimeout(
            officeParser.parseOfficeAsync(buf, officeConfig),
            CONFIG.CONVERSION_TIMEOUT_MS,
            `${uploadType.toUpperCase()} conversion`
          );
        } catch (err) {
          const reason = formatOfficeParseError(err);
          req.log.error(
            {
              err,
              requestId,
              projectId: pid,
              fileId,
              objectKey,
              fileName: originalFilename,
              contentType: normalizedContentType,
              sizeBytes: buf.length,
              subsystem: "conversion",
              converter: { type: uploadType, config: officeConfig, reason }
            },
            "Finalize upload conversion failed"
          );
          const userMessage = `${uploadType.toUpperCase()} upload failed during conversion. ` +
            `${reason ? `Reason: ${reason}. ` : ""}Try again or contact admin.`;
          throw makeUploadError(
            422,
            "FILE_CONVERSION_FAILED",
            userMessage.trim(),
            reason,
            err
          );
        }
        segs = segmentPlainText(sanitizeTextForDb(String(text || ""))).map((segment) => ({ src: segment }));
      } else {
        if (!uploadType && !isXlf && !isTextLikeContentType(normalizedContentType)) {
          throw makeUploadError(415, "FILE_TYPE_UNSUPPORTED", "Unsupported file type.");
        }
        segs = segmentPlainText(sanitizeTextForDb(buf.toString("utf8"))).map((segment) => ({ src: segment }));
      }
    } catch (err) {
      if (isUploadError(err)) {
        if (err.code !== "FILE_CONVERSION_FAILED") {
          req.log.warn(
            { requestId, projectId: pid, fileId, objectKey, fileName: originalFilename, code: err.code, detail: err.detail },
            "Finalize upload rejected"
          );
        }
        return reply.code(err.status).send({
          error: err.message,
          code: err.code,
          detail: err.detail,
          requestId
        });
      }
      req.log.error(
        { err, requestId, projectId: pid, fileId, objectKey, fileName: originalFilename, subsystem: "upload-finalize" },
        "Finalize upload failed"
      );
      return reply.code(500).send({
        error: "Upload finalization failed due to an unexpected error.",
        code: "UPLOAD_FINALIZE_FAILED",
        requestId
      });
    }

    segs = sanitizeSegments(segs);

    const actor = requestUserId(getRequestUser(req)) ?? "system";

    let result: { fileId: number; createdSegments: number; alreadyFinalized: boolean };
    try {
      result = await withTransaction(async (client) => {
        const existingSegmentsRes = await client.query<{ id: number }>(
          "SELECT id FROM segments WHERE file_id = $1 LIMIT 1",
          [fileId]
        );
        if ((existingSegmentsRes.rowCount ?? 0) > 0) {
          return { fileId, createdSegments: 0, alreadyFinalized: true };
        }

        const artifact = await insertFileArtifact(client, {
          fileId,
          kind: "source_original" satisfies FileArtifactKind,
          bucket: getS3Bucket(),
          objectKey,
          sha256,
          etag,
          sizeBytes: buf.length,
          contentType: contentType || null,
          meta: { originalFilename },
          createdBy: actor
        });

        await client.query("UPDATE project_files SET original_artifact_id = $1, status = $2, file_type_config_id = $3 WHERE id = $4", [
          artifact.id,
          "ready",
          fileTypeConfig ? Number(fileTypeConfig.id) : null,
          fileId
        ]);

        if (htmlTemplate) {
          await client.query(
            `INSERT INTO project_file_html_templates(file_id, template, markers, parsing_template_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (file_id) DO UPDATE
             SET template = EXCLUDED.template,
                 markers = EXCLUDED.markers,
                 parsing_template_id = EXCLUDED.parsing_template_id`,
            [fileId, htmlTemplate.template, JSON.stringify(htmlTemplate.markers), htmlTemplate.parsingTemplateId]
          );
        }

        await insertSegmentsForFile(client, pid, fileId, segs);

        return { fileId, createdSegments: segs.length, alreadyFinalized: false };
      });
    } catch (err) {
      req.log.error(
        { err, requestId, projectId: pid, fileId, objectKey, fileName: originalFilename, subsystem: "db" },
        "Finalize upload database failure"
      );
      return reply.code(500).send({
        error: "Upload finalization failed due to an unexpected error.",
        code: "UPLOAD_FINALIZE_FAILED",
        requestId
      });
    }

    req.log.info(
      { requestId, projectId: pid, fileId: result.fileId, createdSegments: result.createdSegments },
      "Direct upload finalized and file marked ready"
    );

    try {
      const createdBy = (accessRow as any).created_by ? String((accessRow as any).created_by) : null;
      const assignedUserRaw = (accessRow as any).assigned_user ? String((accessRow as any).assigned_user) : null;
      const assignedUser = assignedUserRaw || createdBy;
      const projectStatus = String((accessRow as any).status || "").trim().toLowerCase();
      const now = Date.now();
      if (projectStatus === "ready") {
        if (createdBy) await addFileToAssigned(createdBy, fileId, now);
        if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, fileId, now);
        await touchProjectForUsers({ projectId: pid, createdBy, assignedUser, updatedAtMs: now });
      }
    } catch {
      /* ignore redis errors */
    }

    try {
      await enqueueProvisionJobIfImportReady({
        projectId: pid,
        step: "import",
        log: (req as any).log
      });
    } catch (err) {
      (req as any).log?.warn?.({ err, projectId: pid, fileId }, "Failed to queue provision job after finalize");
    }

    return { fileId: result.fileId, createdSegments: result.createdSegments };
  });

}



