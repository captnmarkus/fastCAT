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
import XLSX from "xlsx";
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


export async function registerProjectRoutesPart5(app: FastifyInstance) {
  // --- UPLOAD File ---
  app.post("/projects/:id/files", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const pid = Number(req.params.id);
    const requestId = String((req as any).id || "");
    const accessRow = await ensureProjectAccess(pid, getRequestUser(req), reply);
    if (!accessRow) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });
    const buf = await file.toBuffer();
    const ext = path.extname(file.filename).toLowerCase();
    const uploadType = resolveUploadFileType(file.filename);

    let fileTypeConfig: { id: number; config: any } | null = null;
    if (uploadType) {
      const cfgRes = await db.query<{ id: number; config: any }>(
        `SELECT id, config
         FROM file_type_configs
         WHERE disabled = FALSE
           AND LOWER(config->>'fileType') = $1
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [uploadType]
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

    let segs: Array<{
      src: string;
      tgt?: string | null;
      srcRuns?: any;
      tgtRuns?: any;
      segmentContext?: any;
      originDetails?: any;
    }> = [];
    let htmlTemplate: { template: string; markers: any[]; parsingTemplateId: number } | null = null;
    const normalizedContentType = file.mimetype ? String(file.mimetype) : null;
    const isXlf = ext === ".xlf" || ext === ".xliff";

    try {
      if (isXlf) {
        const parsed = parseXliffSegments(buf.toString());
        segs = parsed.map((p) => ({ src: p.src, tgt: p.tgt }));
      } else if (uploadType === "html") {
        const parsingTemplateId = fileTypeConfig ? getFileTypeConfigParsingTemplateId(fileTypeConfig.config, "html") : null;
        if (!parsingTemplateId) {
          return reply.code(400).send({ error: "File Type Configuration is missing an extraction template.", code: "FILE_TYPE_CONFIG_INVALID" });
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
          return reply.code(400).send({ error: "File Type Configuration is missing an extraction template.", code: "FILE_TYPE_CONFIG_INVALID" });
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

        const extracted = extractXmlSegmentsWithTemplate({ fileBuffer: buf, template: config, segmenter, preserveWhitespace });
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
                fileName: file.filename,
                contentType: normalizedContentType,
                sizeBytes: buf.length,
                subsystem: "conversion",
                converter: { type: uploadType, config: officeConfig, reason }
              },
              "Direct upload conversion failed"
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
              fileName: file.filename,
              contentType: normalizedContentType,
              sizeBytes: buf.length,
              subsystem: "conversion",
              converter: { type: uploadType, config: officeConfig, reason }
            },
            "Direct upload conversion failed"
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
            { requestId, projectId: pid, fileName: file.filename, code: err.code, detail: err.detail },
            "Direct upload rejected"
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
        { err, requestId, projectId: pid, fileName: file.filename, subsystem: "upload-direct" },
        "Direct upload failed"
      );
      return reply.code(500).send({
        error: "Upload failed due to an unexpected error.",
        code: "UPLOAD_FAILED",
        requestId
      });
    }

    segs = sanitizeSegments(segs);

    let result: { fileId: number; createdSegments: number };
    try {
      result = await withTransaction(async (client) => {
        const fileRes = await client.query<{ id: number }>(
          `INSERT INTO project_files(project_id, original_name, stored_path, file_type, file_type_config_id, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [pid, file.filename, "pending", uploadType, fileTypeConfig?.id ?? null, "uploading"]
        );
        const fileId = Number(fileRes.rows[0]?.id);
        if (!Number.isFinite(fileId) || fileId <= 0) {
          throw new Error("Failed to create project file");
        }

        const departmentId = projectDepartmentId(accessRow);
        const objectKey = keyProjectSourceOriginal({
          departmentId,
          projectId: pid,
          fileId,
          originalFilename: file.filename
        });

        await putObjectBuffer({ key: objectKey, buf, contentType: file.mimetype || null });
        const sha256 = await sha256Hex(buf);

        const artifact = await insertFileArtifact(client, {
          fileId,
          kind: "source_original" satisfies FileArtifactKind,
          bucket: getS3Bucket(),
          objectKey,
          sha256,
          etag: null,
          sizeBytes: buf.length,
          contentType: file.mimetype || null,
          meta: { originalFilename: file.filename },
          createdBy: requestUserId(getRequestUser(req)) ?? "system"
        });

        await client.query(`UPDATE project_files SET stored_path = $1, original_artifact_id = $2, status = $4 WHERE id = $3`, [
          objectKey,
          artifact.id,
          fileId,
          "ready"
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

        return { fileId, createdSegments: segs.length };
      });
    } catch (err) {
      req.log.error(
        { err, requestId, projectId: pid, fileName: file.filename, subsystem: "db" },
        "Direct upload database failure"
      );
      return reply.code(500).send({
        error: "Upload failed due to an unexpected error.",
        code: "UPLOAD_FAILED",
        requestId
      });
    }

    try {
      const createdBy = (accessRow as any).created_by ? String((accessRow as any).created_by) : null;
      const assignedUserRaw = (accessRow as any).assigned_user ? String((accessRow as any).assigned_user) : null;
      const assignedUser = assignedUserRaw || createdBy;
      const projectStatus = String((accessRow as any).status || "").trim().toLowerCase();
      const now = Date.now();
      if (projectStatus === "ready") {
        if (createdBy) await addFileToAssigned(createdBy, result.fileId, now);
        if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, result.fileId, now);
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
      (req as any).log?.warn?.({ err, projectId: pid, fileId: result.fileId }, "Failed to queue provision job after direct upload");
    }

    return result;
  });

  // --- GET Segments ---
  app.get("/projects/:id/segments", { preHandler: [requireAuth] }, async (req, reply) => {
    const pid = Number((req.params as any).id);
    const accessRow = await ensureProjectAccess(pid, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;
    const query = (req.query as any) || {};
    const { page = 1, limit = 100, fileId: fileIdRaw } = query;
    const taskIdRaw = query.taskId ?? query.task_id ?? null;
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 10), 500);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    const fileId =
      fileIdRaw != null && fileIdRaw !== ""
        ? Number(fileIdRaw)
        : null;
    const hasFileId = fileId != null && Number.isFinite(fileId) && fileId > 0;
    const taskId =
      taskIdRaw != null && String(taskIdRaw).trim() !== ""
        ? Number(taskIdRaw)
        : null;
    const hasTaskId = taskId != null && Number.isFinite(taskId) && taskId > 0;

    const rowsRes = hasTaskId
      ? await db.query<SegmentRow>(
          `SELECT id, project_id, file_id, seg_index, src, tgt, src_runs, tgt_runs, segment_context, origin_details, status, version, source_type, source_score, source_match_id
           FROM segments
           WHERE project_id = $1 AND task_id = $2
           ORDER BY seg_index
           LIMIT $3 OFFSET $4`,
          [pid, taskId, safeLimit, offset]
        )
      : hasFileId
      ? await db.query<SegmentRow>(
          `SELECT id, project_id, file_id, seg_index, src, tgt, src_runs, tgt_runs, segment_context, origin_details, status, version, source_type, source_score, source_match_id
           FROM segments
           WHERE project_id = $1 AND file_id = $2 AND task_id IS NULL
           ORDER BY seg_index
           LIMIT $3 OFFSET $4`,
          [pid, fileId, safeLimit, offset]
        )
      : await db.query<SegmentRow>(
          `SELECT id, project_id, file_id, seg_index, src, tgt, src_runs, tgt_runs, segment_context, origin_details, status, version, source_type, source_score, source_match_id
           FROM segments
           WHERE project_id = $1 AND task_id IS NULL
           ORDER BY file_id, seg_index
           LIMIT $2 OFFSET $3`,
          [pid, safeLimit, offset]
        );
    const rows = rowsRes.rows;

    const totalRes = hasTaskId
      ? await db.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM segments WHERE project_id = $1 AND task_id = $2`,
          [pid, taskId]
        )
      : hasFileId
      ? await db.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM segments WHERE project_id = $1 AND file_id = $2 AND task_id IS NULL`,
          [pid, fileId]
        )
      : await db.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM segments WHERE project_id = $1 AND task_id IS NULL`,
          [pid]
        );
    const total = totalRes.rows[0];
    return {
      segments: rows.map(rowToSegment),
      total: Number(total?.count ?? 0),
      page: safePage,
      limit: safeLimit
    };
  });

  // --- GET Glossary ---
  // UPDATED: Use LIKE for fuzzy language matching to find terms even if region code differs
  app.get("/projects/:id/glossary", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;
    const project = await getProjectRow(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const query = (req.query as any) || {};
    const taskIdParam = query.taskId != null ? Number(query.taskId) : null;
    const taskId =
      taskIdParam != null && Number.isFinite(taskIdParam) && taskIdParam > 0 ? taskIdParam : null;
    const fileIdParam = query.fileId != null ? Number(query.fileId) : null;
    let fileId = fileIdParam != null && Number.isFinite(fileIdParam) && fileIdParam > 0 ? fileIdParam : null;
    let targetLang = project.tgt_lang;
    let glossaryId = project.glossary_id ?? null;
    if (taskId) {
      const taskRes = await db.query<{ file_id: number; target_lang: string; glossary_id: number | null }>(
        `SELECT file_id, target_lang, glossary_id
         FROM translation_tasks
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [taskId, projectId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      fileId = Number(taskRow.file_id);
      targetLang = String(taskRow.target_lang || project.tgt_lang || "");
      if (taskRow.glossary_id != null) glossaryId = taskRow.glossary_id;
    }
    if (!glossaryId) return { entries: [] };

    const srcLike = `${project.src_lang}%`;
    const tgtLike = `${targetLang || project.tgt_lang}%`;

    const entriesRes = await db.query<{
      id: number;
      source_lang: string;
      target_lang: string;
      term: string;
      translation: string;
      notes: string | null;
      created_by: string | null;
      updated_by: string | null;
      updated_at: string | null;
      created_at: string;
    }>(
      `SELECT id, source_lang, target_lang, term, translation, notes, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
         AND LOWER(source_lang) LIKE LOWER($2)
         AND LOWER(target_lang) LIKE LOWER($3)
       ORDER BY LOWER(term), term`,
      [glossaryId, srcLike, tgtLike]
    );
    const entries = entriesRes.rows;

    return {
      entries: entries.map((e) => ({
        id: e.id,
        sourceLang: e.source_lang,
        targetLang: e.target_lang,
        term: e.term,
        translation: e.translation,
        notes: e.notes ?? null,
        sourceType: "origination",
        createdBy: e.created_by ?? null,
        createdAt: e.created_at ? new Date(e.created_at).toISOString() : null,
        updatedBy: e.updated_by ?? null,
        updatedAt: e.updated_at ? new Date(e.updated_at).toISOString() : null
      }))
    };
  });

  // --- Termbase Lookup (per project, language-pair filtered) ---
  app.get("/projects/:id/termbase/entries", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;
    const project = await getProjectRow(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const query = (req.query as any) || {};
    const taskIdParam = query.taskId != null ? Number(query.taskId) : null;
    const taskId =
      taskIdParam != null && Number.isFinite(taskIdParam) && taskIdParam > 0 ? taskIdParam : null;
    let targetLang = project.tgt_lang;
    let glossaryId = project.glossary_id ?? null;
    if (taskId) {
      const taskRes = await db.query<{ target_lang: string; glossary_id: number | null }>(
        `SELECT target_lang, glossary_id
         FROM translation_tasks
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [taskId, projectId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      targetLang = String(taskRow.target_lang || project.tgt_lang || "");
      if (taskRow.glossary_id != null) glossaryId = taskRow.glossary_id;
    }
    if (!glossaryId) return { entries: [] };

    const srcLike = `${project.src_lang}%`;
    const tgtLike = `${targetLang || project.tgt_lang}%`;

    const entriesRes = await db.query<TermbaseEntryRow>(
      `SELECT id, glossary_id, concept_id, source_lang, target_lang, term, translation, notes, meta_json, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
         AND (
           LOWER(source_lang) LIKE LOWER($2)
           OR LOWER(target_lang) LIKE LOWER($2)
           OR LOWER(source_lang) LIKE LOWER($3)
           OR LOWER(target_lang) LIKE LOWER($3)
         )
       ORDER BY id ASC`,
      [glossaryId, srcLike, tgtLike]
    );

    const rows = entriesRes.rows;
    if (rows.length === 0) return { entries: [] };

    const byEntry = new Map<string, TermbaseEntryRow[]>();
    rows.forEach((row) => {
      const entryId = conceptKeyForRow(row);
      const list = byEntry.get(entryId) ?? [];
      list.push(row);
      byEntry.set(entryId, list);
    });

    const entryIds = Array.from(byEntry.keys());
    const conceptIds = entryIds.filter((id) => !id.startsWith("row-"));
    const rowIds = entryIds
      .filter((id) => id.startsWith("row-"))
      .map((id) => Number(id.slice(4)))
      .filter((id) => Number.isFinite(id));

    const illustrationByEntry = new Map<string, { filename: string; url: string | null }>();
    if (conceptIds.length > 0 || rowIds.length > 0) {
      const conditions: string[] = [];
      const params: any[] = [glossaryId];
      if (conceptIds.length > 0) {
        params.push(conceptIds);
        conditions.push(`concept_id = ANY($${params.length})`);
      }
      if (rowIds.length > 0) {
        params.push(rowIds);
        conditions.push(`entry_id = ANY($${params.length})`);
      }
      const where = conditions.length > 0 ? `AND (${conditions.join(" OR ")})` : "";
      const mediaRes = await db.query<{
        entry_id: number;
        concept_id: string | null;
        storage_path: string;
        original_filename: string | null;
      }>(
        `SELECT entry_id, concept_id, storage_path, original_filename
         FROM glossary_entry_media
         WHERE glossary_id = $1
         ${where}`,
        params
      );
      for (const row of mediaRes.rows) {
        const entryId = row.concept_id ? String(row.concept_id) : `row-${row.entry_id}`;
        if (illustrationByEntry.has(entryId)) continue;
        let url: string | null = null;
        if (row.storage_path) {
          try {
            url = (await presignGetObject({ key: row.storage_path })).url;
          } catch {
            url = null;
          }
        }
        illustrationByEntry.set(entryId, {
          filename: row.original_filename ?? "illustration",
          url
        });
      }
    }

    const normalizedSource = normalizeTermbaseLang(project.src_lang);
    const normalizedTarget = normalizeTermbaseLang(targetLang || project.tgt_lang);

    const entries: TermbaseMatchEntry[] = [];
    for (const [entryId, entryRows] of byEntry.entries()) {
      const { entryFields, languageFields, termFields } = aggregateCustomFields(entryRows);
      const entryAudit = aggregateEntryAudit(entryRows);
      const termAudit = aggregateTermAudit(entryRows);
      const sections = uniqueTerms(entryRows, glossaryId, termFields, termAudit);
      const sourceSection = sections.find((section) => section.language === normalizedSource) ?? null;
      const targetSection = sections.find((section) => section.language === normalizedTarget) ?? null;

      if (!sourceSection && !targetSection) continue;

      const entryFieldsValue = Object.keys(entryFields).length > 0 ? entryFields : null;
      const sourceFields = languageFields[normalizedSource] ?? null;
      const targetFields = languageFields[normalizedTarget] ?? null;

      entries.push({
        entryId,
        entry: {
          fields: entryFieldsValue,
          audit: entryAudit
        },
        source: sourceSection
          ? {
              language: sourceSection.language,
              terms: sourceSection.terms,
              fields: sourceFields && Object.keys(sourceFields).length > 0 ? sourceFields : null
            }
          : null,
        target: targetSection
          ? {
              language: targetSection.language,
              terms: targetSection.terms,
              fields: targetFields && Object.keys(targetFields).length > 0 ? targetFields : null
            }
          : null,
        illustration: illustrationByEntry.get(entryId) ?? null
      });
    }

    return { entries, termbaseId: glossaryId };
  });

  // --- Glossary Search (per project, language-pair filtered) ---
  app.get("/projects/:id/glossary/search", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;
    const project = await getProjectRow(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    const taskIdParam = (req.query as any)?.taskId != null ? Number((req.query as any).taskId) : null;
    const taskId =
      taskIdParam != null && Number.isFinite(taskIdParam) && taskIdParam > 0 ? taskIdParam : null;
    let glossaryId = project.glossary_id ?? null;
    let targetLang = project.tgt_lang;
    if (taskId) {
      const taskRes = await db.query<{ target_lang: string; glossary_id: number | null }>(
        `SELECT target_lang, glossary_id
         FROM translation_tasks
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [taskId, projectId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      targetLang = String(taskRow.target_lang || project.tgt_lang || "");
      if (taskRow.glossary_id != null) glossaryId = taskRow.glossary_id;
    }
    if (!glossaryId) return { entries: [] };

    const q = String(((req.query as any) || {}).q || "").trim();
    if (!q) return { entries: [] };

    const srcLike = `${project.src_lang}%`;
    const tgtLike = `${targetLang || project.tgt_lang}%`;
    const like = `%${q}%`;

    const res = await db.query<{
      id: number;
      source_lang: string;
      target_lang: string;
      term: string;
      translation: string;
      notes: string | null;
      created_by: string | null;
      updated_by: string | null;
      updated_at: string | null;
      created_at: string;
    }>(
      `SELECT id, source_lang, target_lang, term, translation, notes, created_by, updated_by, updated_at, created_at
       FROM glossary_entries
       WHERE glossary_id = $1
         AND LOWER(source_lang) LIKE LOWER($2)
         AND LOWER(target_lang) LIKE LOWER($3)
         AND (term ILIKE $4 OR translation ILIKE $4 OR COALESCE(notes,'') ILIKE $4)
       ORDER BY LENGTH(term) ASC, LOWER(term), term
       LIMIT 50`,
      [glossaryId, srcLike, tgtLike, like]
    );

    return {
      entries: res.rows.map((e) => ({
        id: e.id,
        sourceLang: e.source_lang,
        targetLang: e.target_lang,
        term: e.term,
        translation: e.translation,
        notes: e.notes ?? null,
        sourceType: "origination",
        createdBy: e.created_by ?? null,
        createdAt: e.created_at ? new Date(e.created_at).toISOString() : null,
        updatedBy: e.updated_by ?? null,
        updatedAt: e.updated_at ? new Date(e.updated_at).toISOString() : null
      }))
    };
  });

}



