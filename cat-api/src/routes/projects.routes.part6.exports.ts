import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { enqueueProvisionJob } from "../lib/provision-queue.js";
import { retryProvisionJob } from "../lib/provision-worker.js";
import { rebuildOfficeFromRichSegments } from "../lib/office-rich.js";
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
  keyProjectRenderedPreviewRun,
  keyProjectSourceOriginal,
  keyProjectTargetOutput,
  keyProjectTargetOutputRun
} from "../lib/storage-keys.js";
import { createRenderedPreviewCacheKey } from "../lib/rendered-preview-cache.js";
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
import { getRenderedPreviewSettings } from "./resources.helpers.js";



export async function registerProjectRoutesPart6Exports(app: FastifyInstance) {
  const normalizeReviewGateStatus = (value: unknown): "draft" | "under_review" | "reviewed" | "error" => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (raw === "reviewed" || raw === "approved" || raw === "done" || raw === "completed") return "reviewed";
    if (raw === "under_review" || raw === "under review" || raw === "in_review" || raw === "in progress") {
      return "under_review";
    }
    if (raw === "error") return "error";
    return "draft";
  };

  const isReviewGateSatisfied = (value: unknown) => normalizeReviewGateStatus(value) === "reviewed";

  type OutputSegmentRow = {
    seg_index: number;
    src: string;
    tgt: string | null;
    src_runs: any;
    tgt_runs: any;
    segment_context: any;
  };

  const loadOutputSegmentsWithTaskFallback = async (params: {
    projectId: number;
    fileId: number;
    taskId: number | null;
  }): Promise<OutputSegmentRow[]> => {
    const baseRes = await db.query<OutputSegmentRow>(
      `SELECT seg_index, src, tgt, src_runs, tgt_runs, segment_context
       FROM segments
       WHERE project_id = $1 AND file_id = $2 AND task_id IS NULL
       ORDER BY seg_index`,
      [params.projectId, params.fileId]
    );
    const baseRows = baseRes.rows;

    if (!params.taskId) {
      return baseRows;
    }

    const taskRes = await db.query<OutputSegmentRow>(
      `SELECT seg_index, src, tgt, src_runs, tgt_runs, segment_context
       FROM segments
       WHERE project_id = $1 AND task_id = $2
       ORDER BY seg_index`,
      [params.projectId, params.taskId]
    );
    const taskRows = taskRes.rows;

    if (taskRows.length === 0) {
      return baseRows;
    }
    if (baseRows.length === 0) {
      return taskRows;
    }

    const taskByIndex = new Map<number, OutputSegmentRow>();
    taskRows.forEach((row) => {
      taskByIndex.set(Number(row.seg_index), row);
    });

    const merged: OutputSegmentRow[] = [];
    baseRows.forEach((baseRow) => {
      const idx = Number(baseRow.seg_index);
      const taskRow = taskByIndex.get(idx);
      if (!taskRow) {
        merged.push(baseRow);
        return;
      }

      const taskTgt = String(taskRow.tgt ?? "").trim();
      const baseTgt = String(baseRow.tgt ?? "").trim();
      const mergedSrc = String(taskRow.src ?? "").trim() ? taskRow.src : baseRow.src;
      const mergedTgt = taskTgt ? taskRow.tgt : baseTgt ? baseRow.tgt : taskRow.tgt ?? baseRow.tgt;
      const mergedSrcRuns =
        Array.isArray(taskRow.src_runs) && taskRow.src_runs.length > 0 ? taskRow.src_runs : baseRow.src_runs;
      const mergedTgtRuns = taskTgt
        ? Array.isArray(taskRow.tgt_runs) && taskRow.tgt_runs.length > 0
          ? taskRow.tgt_runs
          : baseRow.tgt_runs
        : baseTgt
          ? baseRow.tgt_runs
          : taskRow.tgt_runs ?? baseRow.tgt_runs;
      const taskContext =
        taskRow.segment_context && typeof taskRow.segment_context === "object" ? taskRow.segment_context : null;
      const baseContext =
        baseRow.segment_context && typeof baseRow.segment_context === "object" ? baseRow.segment_context : null;
      const mergedSegmentContext =
        taskContext && Object.keys(taskContext).length > 0
          ? baseContext
            ? { ...baseContext, ...taskContext }
            : taskContext
          : baseContext ?? taskContext;

      merged.push({
        ...taskRow,
        src: mergedSrc,
        tgt: mergedTgt,
        src_runs: mergedSrcRuns,
        tgt_runs: mergedTgtRuns,
        segment_context: mergedSegmentContext
      });
      taskByIndex.delete(idx);
    });

    if (taskByIndex.size > 0) {
      const remaining = Array.from(taskByIndex.values()).sort((a, b) => Number(a.seg_index) - Number(b.seg_index));
      merged.push(...remaining);
    }

    return merged;
  };
  const handleTargetExport = async (req: any, reply: any) => {
    const projectId = Number(req.params.id);
    const accessRow = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!accessRow) return;

    const project = await getProjectRow(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const query = (req.query as any) || {};
    const taskIdParam = query.taskId != null ? Number(query.taskId) : null;
    let taskId =
      taskIdParam != null && Number.isFinite(taskIdParam) && taskIdParam > 0 ? taskIdParam : null;
    const fileIdParam = query.fileId != null ? Number(query.fileId) : null;
    let fileId =
      fileIdParam != null && Number.isFinite(fileIdParam) && fileIdParam > 0 ? fileIdParam : null;

    const targetLangRaw = query.targetLang ?? query.lang ?? query.target_lang ?? null;
    let targetLang = targetLangRaw != null ? normalizeLanguageTag(String(targetLangRaw)) : "";
    let resolvedTaskStatus: string | null = null;

    if (taskId) {
      const taskRes = await db.query<{ file_id: number; target_lang: string; status: string | null }>(
        `SELECT file_id, target_lang, status
         FROM translation_tasks
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [taskId, projectId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      fileId = Number(taskRow.file_id);
      targetLang = normalizeLanguageTag(String(taskRow.target_lang || project.tgt_lang || ""));
      resolvedTaskStatus = taskRow.status ? String(taskRow.status) : null;
    }

    if (!fileId) {
      return reply.code(400).send({ error: "fileId or taskId is required" });
    }

    if (!taskId) {
      const tasksRes = await db.query<{ id: number; target_lang: string; status: string | null }>(
        `SELECT id, target_lang, status
         FROM translation_tasks
         WHERE project_id = $1 AND file_id = $2
         ORDER BY id ASC`,
        [projectId, fileId]
      );
      if ((tasksRes.rowCount ?? 0) > 0) {
        if (!targetLang) {
          if (tasksRes.rowCount === 1) {
            const onlyTask = tasksRes.rows[0];
            taskId = Number(onlyTask.id);
            targetLang = normalizeLanguageTag(String(onlyTask.target_lang || project.tgt_lang || ""));
            resolvedTaskStatus = onlyTask.status ? String(onlyTask.status) : null;
          } else {
            return reply
              .code(400)
              .send({ error: "targetLang is required when multiple target languages exist for this file." });
          }
        } else {
          const normalizedTarget = normalizeLanguageTag(targetLang);
          const match = tasksRes.rows.find(
            (row) => normalizeLanguageTag(String(row.target_lang || "")) === normalizedTarget
          );
          if (!match) {
            return reply
              .code(404)
              .send({ error: "No translation task found for the requested target language." });
          }
          taskId = Number(match.id);
          targetLang = normalizeLanguageTag(String(match.target_lang || project.tgt_lang || ""));
          resolvedTaskStatus = match.status ? String(match.status) : null;
        }
      }
    }

    if (!targetLang) {
      targetLang = normalizeLanguageTag(String(project.tgt_lang || ""));
    }
    if (!targetLang) {
      return reply.code(400).send({ error: "targetLang is required" });
    }

    if (taskId) {
      if (!resolvedTaskStatus) {
        const taskStatusRes = await db.query<{ status: string | null }>(
          `SELECT status FROM translation_tasks WHERE id = $1 AND project_id = $2 LIMIT 1`,
          [taskId, projectId]
        );
        resolvedTaskStatus = taskStatusRes.rows[0]?.status ? String(taskStatusRes.rows[0].status) : null;
      }
      if (!isReviewGateSatisfied(resolvedTaskStatus)) {
        return reply.code(409).send({
          error: "Download is available only after review is marked Done.",
          code: "DOWNLOAD_REQUIRES_REVIEWED",
          taskStatus: normalizeReviewGateStatus(resolvedTaskStatus)
        });
      }
    }

    const fileRes = await db.query<{
      id: number;
      original_name: string;
      stored_path: string;
      file_type: string | null;
      file_type_config_id: number | null;
    }>(
      `SELECT id, original_name, stored_path, file_type, file_type_config_id
       FROM project_files
       WHERE project_id = $1 AND id = $2
       LIMIT 1`,
      [projectId, fileId]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) return reply.code(404).send({ error: "Project file not found" });

    const originalName = String(fileRow.original_name || "").trim() || `file-${fileId}`;
    const fileType = String(fileRow.file_type || "").trim().toLowerCase() || resolveUploadFileType(originalName);
    const outputExtension = resolveOutputExtension(originalName, fileRow.file_type);
    const outputFilename = buildTargetFilename(originalName, targetLang, outputExtension);
    const contentType = contentTypeForExtension(outputExtension);

    const segments = await loadOutputSegmentsWithTaskFallback({
      projectId,
      fileId,
      taskId
    });
    const lines = segments.map(resolveSegmentText);

    let outBuf: Buffer;
    try {
      if (fileType === "html" || [".html", ".htm", ".xhtml", ".xtml"].includes(outputExtension.toLowerCase())) {
        const templateRes = await db.query<{ template: string; markers: string }>(
          `SELECT template, markers
           FROM project_file_html_templates
           WHERE file_id = $1
           LIMIT 1`,
          [fileId]
        );
        const templateRow = templateRes.rows[0] as any;
        if (!templateRow) {
          return reply.code(400).send({ error: "HTML export is not available because no template was stored for this file." });
        }

        const resolveText = (index: number) => {
          const seg = segments[index];
          return seg ? resolveSegmentText(seg) : "";
        };
        let map: any[] = [];
        try {
          map = JSON.parse(templateRow.markers);
        } catch {
          map = [];
        }

        let content = templateRow.template;
        const first = map[0];
        const isLegacyMarker = first && typeof first === "object" && typeof first.marker === "string";
        if (isLegacyMarker) {
          content = fillHtmlTemplate(content, map as any[], resolveText);
        } else {
          const $ = loadHtml(content);
          for (let i = 0; i < map.length && i < segments.length; i++) {
            const entry = map[i];
            if (!entry || entry.kind !== "html") continue;
            const selector = String(entry.selector || "").trim();
            if (!selector) continue;
            const translation = resolveText(i);
            const el = $(selector).first();
            if (el.length > 0) el.html(translation);
          }

          for (let i = 0; i < map.length && i < segments.length; i++) {
            const entry = map[i];
            if (!entry || entry.kind !== "attr") continue;
            const selector = String(entry.selector || "").trim();
            const attribute = String(entry.attribute || "").trim();
            if (!selector || !attribute) continue;
            const translation = resolveText(i);
            const el = $(selector).first();
            if (el.length > 0) el.attr(attribute, translation);
          }

          $(`span[data-fastcat-seg="1"]`).each((_, el) => {
            const wrap = $(el);
            wrap.replaceWith(wrap.contents());
          });

          content = $.html();
        }
        outBuf = Buffer.from(content, "utf8");
      } else if (fileType === "xml" || outputExtension.toLowerCase() === ".xml") {
        if (!fileRow.file_type_config_id) {
          return reply.code(400).send({ error: "XML export is not available because the file type configuration is missing." });
        }
        const cfgRes = await db.query<{ config: any }>(
          `SELECT config FROM file_type_configs WHERE id = $1 LIMIT 1`,
          [fileRow.file_type_config_id]
        );
        const cfgRow = cfgRes.rows[0];
        if (!cfgRow) {
          return reply.code(400).send({ error: "XML export is not available because the file type configuration is missing." });
        }
        const parsingTemplateId = getFileTypeConfigParsingTemplateId(cfgRow.config, "xml");
        if (!parsingTemplateId) {
          return reply.code(400).send({ error: "XML export is not available because the parsing template is missing." });
        }
        const templateRes = await db.query<{ config: any; kind: string }>(
          `SELECT config, kind FROM parsing_templates WHERE id = $1 LIMIT 1`,
          [parsingTemplateId]
        );
        const templateRow = templateRes.rows[0];
        if (!templateRow || String(templateRow.kind || "xml").toLowerCase() !== "xml") {
          return reply.code(400).send({ error: "XML export is not available because the parsing template is invalid." });
        }

        const xmlTemplate = normalizeXmlParsingTemplateConfig(templateRow.config);
        const cfgNorm = normalizeJsonObject(cfgRow.config);
        const xmlCfg = normalizeJsonObject(cfgNorm.xml);
        const segmenter =
          String(xmlCfg.segmenter || "lines").toLowerCase() === "sentences" ? "sentences" : "lines";
        const preserveWhitespace = xmlCfg.preserveWhitespace !== undefined ? Boolean(xmlCfg.preserveWhitespace) : true;

        const storedKey = String(fileRow.stored_path || "").trim();
        if (!storedKey) {
          return reply.code(400).send({ error: "XML export is not available because the source file is missing." });
        }
        const { buf: sourceBuffer } = await getObjectBuffer({ key: storedKey });
        const content = buildXmlOutput({
          sourceBuffer,
          template: xmlTemplate,
          segmenter,
          preserveWhitespace,
          segments
        });
        outBuf = Buffer.from(content, "utf8");
      } else if (fileType === "docx" || fileType === "pptx" || fileType === "xlsx") {
        const storedKey = String(fileRow.stored_path || "").trim();
        if (!storedKey) {
          return reply.code(400).send({ error: "Office export is not available because the source file is missing." });
        }
        const { buf: sourceBuffer } = await getObjectBuffer({ key: storedKey });
        const rebuilt = rebuildOfficeFromRichSegments({
          sourceBuffer,
          fileType: fileType as "docx" | "pptx" | "xlsx",
          segments: segments.map((segment) => ({
            src: segment.src,
            tgt: segment.tgt,
            srcRuns: segment.src_runs,
            tgtRuns: segment.tgt_runs,
            segmentContext: segment.segment_context
          }))
        });
        outBuf = rebuilt.buffer;
      } else {
        const text = lines.join("\n");
        outBuf = Buffer.from(text, "utf8");
      }
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || "Failed to generate export output." });
    }

    const departmentId = projectDepartmentId(accessRow);
    const runId = String((req as any)?.id || Date.now());
    const objectKey = keyProjectTargetOutputRun({
      departmentId,
      projectId,
      fileId,
      targetLang,
      outputExtension,
      runId
    });
    const put = await putObjectBuffer({ key: objectKey, buf: outBuf, contentType });
    const sha256 = await sha256Hex(outBuf);
    await insertFileArtifact(db, {
      projectId,
      fileId,
      kind: "target_output",
      bucket: getS3Bucket(),
      objectKey,
      sha256,
      etag: put.etag,
      sizeBytes: outBuf.length,
      contentType,
      meta: { lang: targetLang, filename: outputFilename, runId, taskId: taskId ?? null },
      createdBy: requestUserId(getRequestUser(req)) ?? "system"
    });

    reply.header("Content-Disposition", `attachment; filename="${safeDispositionFilename(outputFilename)}"`);
    reply.header("Content-Type", contentType);
    return reply.send(outBuf);
  };

  app.get("/projects/:id/export-target", { preHandler: [requireAuth] }, handleTargetExport);

  // --- EXPORT XLIFF (Handler Logic) ---
  const handleXliffExport = async (req: any, reply: any) => {
    const projectId = Number(req.params.id);
    const accessRow = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!accessRow) return;

    const project = await getProjectRow(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const query = (req.query as any) || {};
    const taskIdParam = query.taskId != null ? Number(query.taskId) : null;
    const taskId =
      taskIdParam != null && Number.isFinite(taskIdParam) && taskIdParam > 0 ? taskIdParam : null;
    const fileIdParam = query.fileId != null ? Number(query.fileId) : null;
    let fileId =
      fileIdParam != null && Number.isFinite(fileIdParam) && fileIdParam > 0 ? fileIdParam : null;
    let targetLang = project.tgt_lang;
    let resolvedTaskStatus: string | null = null;

    if (taskId) {
      const taskRes = await db.query<{ file_id: number; target_lang: string; status: string | null }>(
        `SELECT file_id, target_lang, status
         FROM translation_tasks
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [taskId, projectId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      fileId = Number(taskRow.file_id);
      targetLang = String(taskRow.target_lang || project.tgt_lang || "");
      resolvedTaskStatus = taskRow.status ? String(taskRow.status) : null;
    }

    if (taskId && !isReviewGateSatisfied(resolvedTaskStatus)) {
      return reply.code(409).send({
        error: "Download is available only after review is marked Done.",
        code: "DOWNLOAD_REQUIRES_REVIEWED",
        taskStatus: normalizeReviewGateStatus(resolvedTaskStatus)
      });
    }

    const pendingRes = await db.query<{ count: number }>(
      taskId
        ? `SELECT COUNT(*)::int AS count
           FROM segments
           WHERE project_id = $1
             AND task_id = $2
             AND status NOT IN ('reviewed', 'approved')`
        : `SELECT COUNT(*)::int AS count
           FROM segments
           WHERE project_id = $1
             AND task_id IS NULL
             AND status NOT IN ('reviewed', 'approved')`,
      taskId ? [projectId, taskId] : [projectId]
    );
    const pending = Number(pendingRes.rows[0]?.count ?? 0);
    if (pending > 0) {
      return reply.code(400).send({
        error: "Project is not complete. Mark all segments as reviewed before exporting.",
        code: "PROJECT_NOT_COMPLETE",
        pending
      });
    }

    let targetFileName: string | null = null;
    if (fileId) {
      const fileRes = await db.query<{ original_name: string }>(
        "SELECT original_name FROM project_files WHERE project_id = $1 AND id = $2 LIMIT 1",
        [projectId, fileId]
      );
      targetFileName = fileRes.rows[0]?.original_name ? String(fileRes.rows[0].original_name) : null;
      if (!targetFileName) return reply.code(404).send({ error: "Project file not found" });
    }

    const segmentsRes = taskId
      ? await db.query<SegmentRow>(
          "SELECT id, project_id, file_id, seg_index, src, tgt, status, version FROM segments WHERE project_id = $1 AND task_id = $2 ORDER BY seg_index",
          [projectId, taskId]
        )
      : fileId
        ? await db.query<SegmentRow>(
            "SELECT id, project_id, file_id, seg_index, src, tgt, status, version FROM segments WHERE project_id = $1 AND file_id = $2 AND task_id IS NULL ORDER BY seg_index",
            [projectId, fileId]
          )
        : await db.query<SegmentRow>(
            "SELECT id, project_id, file_id, seg_index, src, tgt, status, version FROM segments WHERE project_id = $1 AND task_id IS NULL ORDER BY file_id, seg_index",
            [projectId]
          );
    const segments = segmentsRes.rows;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<xliff version="1.2">\n`;
    xml += `  <file source-language="${project.src_lang}" target-language="${targetLang}" datatype="plaintext" original="file.ext">\n    <body>\n`;
    for (const seg of segments) {
         xml += `      <trans-unit id="${seg.id}">\n`;
         xml += `        <source>${escapeXml(seg.src)}</source>\n`;
         xml += `        <target>${escapeXml(seg.tgt || "")}</target>\n`;
         xml += `      </trans-unit>\n`;
    }
    xml += `    </body>\n  </file>\n</xliff>`;

    const baseLabel = targetFileName ? path.parse(targetFileName).name : `project-${projectId}`;
    const filename = fileId ? `${baseLabel || "file"}-${fileId}.xlf` : `${baseLabel}.xlf`;

    if (fileId) {
      const departmentId = projectDepartmentId(accessRow);
      const runId = String((req as any)?.id || Date.now());
      const objectKey = keyProjectDerivedSegmentsXliffRun({ departmentId, projectId, fileId, runId });
      const outBuf = Buffer.from(xml, "utf8");
      const put = await putObjectBuffer({
        key: objectKey,
        buf: outBuf,
        contentType: "application/x-xliff+xml"
      });
      const sha256 = await sha256Hex(outBuf);
      await insertFileArtifact(db, {
        projectId,
        fileId,
        kind: "derived_segments_xliff",
        bucket: getS3Bucket(),
        objectKey,
        sha256,
        etag: put.etag,
        sizeBytes: outBuf.length,
        contentType: "application/x-xliff+xml",
        meta: { lang: targetLang, filename, runId, taskId: taskId ?? null },
        createdBy: requestUserId(getRequestUser(req)) ?? "system"
      });
    }

    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.header("Content-Type", "application/x-xliff+xml");
    return reply.send(xml);
  };

  // Register XLIFF Export with Aliases to catch frontend mismatches
  app.get("/projects/:id/export-xliff", { preHandler: [requireAuth] }, handleXliffExport);
  app.get("/projects/:id/xliff", { preHandler: [requireAuth] }, handleXliffExport);
  app.get("/projects/:id/export/xliff", { preHandler: [requireAuth] }, handleXliffExport);

  // --- EXPORT HTML (Handler Logic) ---
  const handleHtmlExport = async (req: any, reply: any) => {
    const projectId = Number(req.params.id);
    const accessRow = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!accessRow) return;

    const project = await getProjectRow(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const query = (req.query as any) || {};
    const taskIdParam = query.taskId != null ? Number(query.taskId) : null;
    const taskId =
      taskIdParam != null && Number.isFinite(taskIdParam) && taskIdParam > 0 ? taskIdParam : null;
    const fileIdParam = query.fileId != null ? Number(query.fileId) : null;
    let fileId =
      fileIdParam != null && Number.isFinite(fileIdParam) && fileIdParam > 0 ? fileIdParam : null;
    let targetLang = project.tgt_lang;
    let resolvedTaskStatus: string | null = null;

    if (taskId) {
      const taskRes = await db.query<{ file_id: number; target_lang: string; status: string | null }>(
        `SELECT file_id, target_lang, status
         FROM translation_tasks
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [taskId, projectId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      fileId = Number(taskRow.file_id);
      targetLang = String(taskRow.target_lang || project.tgt_lang || "");
      resolvedTaskStatus = taskRow.status ? String(taskRow.status) : null;
    }

    if (taskId && !isReviewGateSatisfied(resolvedTaskStatus)) {
      return reply.code(409).send({
        error: "Download is available only after review is marked Done.",
        code: "DOWNLOAD_REQUIRES_REVIEWED",
        taskStatus: normalizeReviewGateStatus(resolvedTaskStatus)
      });
    }

    const pendingRes = await db.query<{ count: number }>(
      taskId
        ? `SELECT COUNT(*)::int AS count
           FROM segments
           WHERE project_id = $1
             AND task_id = $2
             AND status NOT IN ('reviewed', 'approved')`
        : `SELECT COUNT(*)::int AS count
           FROM segments
           WHERE project_id = $1
             AND task_id IS NULL
             AND status NOT IN ('reviewed', 'approved')`,
      taskId ? [projectId, taskId] : [projectId]
    );
    const pending = Number(pendingRes.rows[0]?.count ?? 0);
    if (pending > 0) {
      return reply.code(400).send({
        error: "Project is not complete. Mark all segments as reviewed before exporting.",
        code: "PROJECT_NOT_COMPLETE",
        pending
      });
    }

    const templateRes = await db.query<{ file_id: number; template: string; markers: string }>(
      fileId
        ? `SELECT t.file_id, t.template, t.markers
           FROM project_file_html_templates t
           JOIN project_files f ON f.id = t.file_id
           WHERE f.project_id = $1 AND t.file_id = $2
           LIMIT 1`
        : `SELECT t.file_id, t.template, t.markers
           FROM project_file_html_templates t
           JOIN project_files f ON f.id = t.file_id
           WHERE f.project_id = $1
           ORDER BY f.id ASC
           LIMIT 1`,
      fileId ? [projectId, fileId] : [projectId]
    );
    const templateRow = templateRes.rows[0] as any;

    if (!templateRow) {
        return reply.code(400).send({ error: "No HTML template found for this project." });
    }

    const segmentsRes = await db.query<{ src: string; tgt: string | null }>(
      taskId
        ? "SELECT src, tgt FROM segments WHERE project_id = $1 AND task_id = $2 ORDER BY seg_index"
        : "SELECT src, tgt FROM segments WHERE project_id = $1 AND file_id = $2 AND task_id IS NULL ORDER BY seg_index",
      taskId ? [projectId, taskId] : [projectId, Number(templateRow.file_id)]
    );
    const segments = segmentsRes.rows;
    
    const resolveText = (index: number) =>
      segments[index]?.tgt ?? segments[index]?.src ?? "";

    let map: any[] = [];
    try {
      map = JSON.parse(templateRow.markers);
    } catch {
      map = [];
    }

    let content = templateRow.template;

    const first = map[0];
    const isLegacyMarker =
      first && typeof first === "object" && typeof first.marker === "string";

    if (isLegacyMarker) {
      content = fillHtmlTemplate(content, map as any[], resolveText);
    } else {
      const $ = loadHtml(content);

      for (let i = 0; i < map.length && i < segments.length; i++) {
        const entry = map[i];
        if (!entry || entry.kind !== "html") continue;
        const selector = String(entry.selector || "").trim();
        if (!selector) continue;
        const translation = resolveText(i);
        const el = $(selector).first();
        if (el.length > 0) el.html(translation);
      }

      for (let i = 0; i < map.length && i < segments.length; i++) {
        const entry = map[i];
        if (!entry || entry.kind !== "attr") continue;
        const selector = String(entry.selector || "").trim();
        const attribute = String(entry.attribute || "").trim();
        if (!selector || !attribute) continue;
        const translation = resolveText(i);
        const el = $(selector).first();
        if (el.length > 0) el.attr(attribute, translation);
      }

      $(`span[data-fastcat-seg="1"]`).each((_, el) => {
        const wrap = $(el);
        wrap.replaceWith(wrap.contents());
      });

      content = $.html();
    }

    const htmlFileId = Number(templateRow.file_id);
    const filename = `project-${projectId}-${htmlFileId}.html`;
    {
      const departmentId = projectDepartmentId(accessRow);
      const runId = String((req as any)?.id || Date.now());
      const objectKey = keyProjectTargetOutputRun({
        departmentId,
        projectId,
        fileId: htmlFileId,
        targetLang,
        outputExtension: ".html",
        runId
      });
      const outBuf = Buffer.from(content, "utf8");
      const put = await putObjectBuffer({ key: objectKey, buf: outBuf, contentType: "text/html" });
      const sha256 = await sha256Hex(outBuf);
      await insertFileArtifact(db, {
        projectId,
        fileId: htmlFileId,
        kind: "target_output",
        bucket: getS3Bucket(),
        objectKey,
        sha256,
        etag: put.etag,
        sizeBytes: outBuf.length,
        contentType: "text/html",
        meta: { lang: targetLang, filename, runId, taskId: taskId ?? null },
        createdBy: requestUserId(getRequestUser(req)) ?? "system"
      });
    }

    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.header("Content-Type", "text/html");
    return reply.send(content);
  };

  // Register HTML Export with Aliases
  app.get("/projects/:id/export-html", { preHandler: [requireAuth] }, handleHtmlExport);
  app.get("/projects/:id/html", { preHandler: [requireAuth] }, handleHtmlExport);
  app.get("/projects/:id/export/html", { preHandler: [requireAuth] }, handleHtmlExport);

}
