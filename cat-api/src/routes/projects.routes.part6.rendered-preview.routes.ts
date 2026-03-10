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



import type { RenderedPreviewRouteHelpers } from "./projects.routes.part6.rendered-preview.js";

export async function registerProjectRoutesPart6RenderedPreviewRoutes(
  app: FastifyInstance,
  helpers: RenderedPreviewRouteHelpers
) {
  const {
    computeDraftRevisionId,
    findRenderedPreviewArtifactByCacheKey,
    pruneRenderedPreviewJobs,
    renderedPreviewJobsByCacheKey,
    renderedPreviewJobsById,
    resolveRenderedPreviewSelection,
    runRenderedPreviewGenerationJob
  } = helpers;

  app.post("/projects/:projectId/files/:fileId/rendered-preview", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const projectId = Number(req.params.projectId);
    const fileIdParam = Number(req.params.fileId);
    if (!Number.isFinite(projectId) || projectId <= 0) return reply.code(400).send({ error: "Invalid project id" });
    if (!Number.isFinite(fileIdParam) || fileIdParam <= 0) return reply.code(400).send({ error: "Invalid file id" });

    const accessRow = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!accessRow) return;

    const body = (req.body as any) || {};
    const taskIdRaw = body.taskId ?? body.task_id ?? null;
    const targetLangRaw = body.targetLang ?? body.target_lang ?? body.lang ?? null;
    const draftRevisionRaw = body.draftRevisionId ?? body.draft_revision_id ?? null;
    const requestedMethodRaw = body.previewMethod ?? body.method ?? null;

    const selection = await resolveRenderedPreviewSelection({
      projectId,
      fileId: fileIdParam,
      taskId: taskIdRaw != null ? Number(taskIdRaw) : null,
      targetLang: targetLangRaw != null ? String(targetLangRaw) : null
    });
    if ("error" in selection) return reply.code(400).send({ error: selection.error });
    if (Number(selection.fileId) !== Number(fileIdParam)) {
      return reply.code(400).send({ error: "Task does not belong to the requested file." });
    }

    const fileRes = await db.query<{ file_type: string | null; file_type_config_id: number | null; config: any }>(
      `SELECT f.file_type, f.file_type_config_id, ft.config
       FROM project_files f
       LEFT JOIN file_type_configs ft ON ft.id = f.file_type_config_id
       WHERE f.project_id = $1 AND f.id = $2
       LIMIT 1`,
      [projectId, fileIdParam]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) return reply.code(404).send({ error: "Project file not found" });

    const normalizedFileType = String(fileRow.file_type || "").trim().toLowerCase() || "unknown";
    const settings = getRenderedPreviewSettings(fileRow.config, normalizedFileType);
    if (!settings.supportsRenderedPreview) {
      return reply.code(400).send({ error: "Rendered preview is disabled for this file type configuration." });
    }

    const requestedMethod = String(requestedMethodRaw || "").trim().toLowerCase();
    const previewMethod = requestedMethod || settings.renderedPreviewMethod || "";
    if (!previewMethod) {
      return reply.code(400).send({ error: "Rendered preview method is not configured." });
    }

    const draftRevisionId =
      String(draftRevisionRaw || "").trim() ||
      (await computeDraftRevisionId({
        projectId,
        fileId: fileIdParam,
        taskId: selection.taskId ?? null
      }));

    const cacheKey = createRenderedPreviewCacheKey({
      projectId,
      fileId: fileIdParam,
      taskId: selection.taskId ?? null,
      targetLang: selection.targetLang,
      previewMethod,
      draftRevisionId
    });

    pruneRenderedPreviewJobs();
    const existingJobId = renderedPreviewJobsByCacheKey.get(cacheKey);
    if (existingJobId) {
      const existingJob = renderedPreviewJobsById.get(existingJobId);
      if (existingJob) {
        return {
          previewId: existingJob.id,
          status: existingJob.status,
          draftRevisionId,
          previewMethod,
          cached: false,
          warnings: existingJob.warnings,
          logs: existingJob.logs,
          error: existingJob.error
        };
      }
      renderedPreviewJobsByCacheKey.delete(cacheKey);
    }

    const cachedArtifact = await findRenderedPreviewArtifactByCacheKey({
      projectId,
      fileId: fileIdParam,
      cacheKey
    });
    if (cachedArtifact) {
      return {
        previewId: String(cachedArtifact.id),
        status: "ready",
        draftRevisionId,
        previewMethod,
        cached: true
      };
    }

    const userId = requestUserId(getRequestUser(req)) ?? "system";
    const jobId = `rp_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const now = Date.now();
    const job = {
      id: jobId,
      cacheKey,
      projectId,
      fileId: fileIdParam,
      taskId: selection.taskId ?? null,
      targetLang: selection.targetLang,
      previewMethod,
      status: "queued",
      createdAtMs: now,
      updatedAtMs: now,
      artifactId: null,
      warnings: [],
      logs: [],
      error: null,
      errorDetails: null
    };
    renderedPreviewJobsById.set(jobId, job);
    renderedPreviewJobsByCacheKey.set(cacheKey, jobId);

    void runRenderedPreviewGenerationJob({
      jobId,
      cacheKey,
      projectId,
      fileId: fileIdParam,
      taskId: selection.taskId ?? null,
      targetLang: selection.targetLang,
      previewMethod,
      draftRevisionId,
      userId,
      accessRow
    });

    return {
      previewId: jobId,
      status: "queued",
      draftRevisionId,
      previewMethod,
      cached: false
    };
  });

  app.get("/projects/:projectId/files/:fileId/rendered-preview/status", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const projectId = Number(req.params.projectId);
    const fileIdParam = Number(req.params.fileId);
    if (!Number.isFinite(projectId) || projectId <= 0) return reply.code(400).send({ error: "Invalid project id" });
    if (!Number.isFinite(fileIdParam) || fileIdParam <= 0) return reply.code(400).send({ error: "Invalid file id" });

    const accessRow = await ensureProjectAccess(projectId, getRequestUser(req), reply);
    if (!accessRow) return;

    const query = (req.query as any) || {};
    const taskIdRaw = query.taskId ?? query.task_id ?? null;
    const targetLangRaw = query.targetLang ?? query.target_lang ?? query.lang ?? null;
    const draftRevisionRaw = query.draftRevisionId ?? query.draft_revision_id ?? null;
    const requestedMethodRaw = query.previewMethod ?? query.method ?? null;

    const selection = await resolveRenderedPreviewSelection({
      projectId,
      fileId: fileIdParam,
      taskId: taskIdRaw != null ? Number(taskIdRaw) : null,
      targetLang: targetLangRaw != null ? String(targetLangRaw) : null
    });
    if ("error" in selection) return reply.code(400).send({ error: selection.error });
    if (Number(selection.fileId) !== Number(fileIdParam)) {
      return reply.code(400).send({ error: "Task does not belong to the requested file." });
    }

    const fileRes = await db.query<{ file_type: string | null; file_type_config_id: number | null; config: any }>(
      `SELECT f.file_type, f.file_type_config_id, ft.config
       FROM project_files f
       LEFT JOIN file_type_configs ft ON ft.id = f.file_type_config_id
       WHERE f.project_id = $1 AND f.id = $2
       LIMIT 1`,
      [projectId, fileIdParam]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) return reply.code(404).send({ error: "Project file not found" });

    const normalizedFileType = String(fileRow.file_type || "").trim().toLowerCase() || "unknown";
    const settings = getRenderedPreviewSettings(fileRow.config, normalizedFileType);
    if (!settings.supportsRenderedPreview) {
      return {
        previewId: null,
        status: "disabled",
        draftRevisionId: null,
        previewMethod: settings.renderedPreviewMethod
      };
    }

    const requestedMethod = String(requestedMethodRaw || "").trim().toLowerCase();
    const previewMethod = requestedMethod || settings.renderedPreviewMethod || "";
    if (!previewMethod) {
      return {
        previewId: null,
        status: "disabled",
        draftRevisionId: null,
        previewMethod: null
      };
    }

    const draftRevisionId =
      String(draftRevisionRaw || "").trim() ||
      (await computeDraftRevisionId({
        projectId,
        fileId: fileIdParam,
        taskId: selection.taskId ?? null
      }));

    const cacheKey = createRenderedPreviewCacheKey({
      projectId,
      fileId: fileIdParam,
      taskId: selection.taskId ?? null,
      targetLang: selection.targetLang,
      previewMethod,
      draftRevisionId
    });

    pruneRenderedPreviewJobs();
    const existingJobId = renderedPreviewJobsByCacheKey.get(cacheKey);
    if (existingJobId) {
      const existingJob = renderedPreviewJobsById.get(existingJobId);
      if (existingJob) {
        return {
          previewId: existingJob.id,
          status: existingJob.status,
          draftRevisionId,
          previewMethod,
          cached: false,
          warnings: existingJob.warnings,
          logs: existingJob.logs,
          error: existingJob.error
        };
      }
      renderedPreviewJobsByCacheKey.delete(cacheKey);
    }

    const cachedArtifact = await findRenderedPreviewArtifactByCacheKey({
      projectId,
      fileId: fileIdParam,
      cacheKey
    });
    if (cachedArtifact) {
      return {
        previewId: String(cachedArtifact.id),
        status: "ready",
        draftRevisionId,
        previewMethod,
        cached: true
      };
    }

    return {
      previewId: null,
      status: "idle",
      draftRevisionId,
      previewMethod,
      cached: false
    };
  });

  app.get("/rendered-preview/:previewId", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const previewIdRaw = String(req.params.previewId || "").trim();
    if (!previewIdRaw) return reply.code(400).send({ error: "Invalid preview id" });

    pruneRenderedPreviewJobs();
    let artifactId: number | null = null;
    if (previewIdRaw.startsWith("rp_")) {
      const job = renderedPreviewJobsById.get(previewIdRaw);
      if (!job) return reply.code(404).send({ error: "Rendered preview job not found" });
      if (job.status === "error") {
        return {
          previewId: job.id,
          status: "error",
          error: job.error,
          details: job.errorDetails,
          warnings: job.warnings,
          logs: job.logs
        };
      }
      if (job.status !== "ready" || !job.artifactId) {
        return {
          previewId: job.id,
          status: job.status,
          warnings: job.warnings,
          logs: job.logs
        };
      }
      artifactId = Number(job.artifactId);
    } else {
      const parsed = Number(previewIdRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return reply.code(400).send({ error: "Invalid preview id" });
      }
      artifactId = parsed;
    }

    const artifactRes = await db.query<{
      id: number;
      project_id: number | null;
      file_id: number | null;
      object_key: string;
      content_type: string | null;
      size_bytes: number | null;
      meta_json: any;
      created_at: string;
    }>(
      `SELECT id, project_id, file_id, object_key, content_type, size_bytes, meta_json, created_at
       FROM file_artifacts
       WHERE id = $1
         AND kind = 'rendered_preview'
       LIMIT 1`,
      [artifactId]
    );
    const artifact = artifactRes.rows[0];
    if (!artifact || artifact.project_id == null || artifact.file_id == null) {
      return reply.code(404).send({ error: "Rendered preview not found" });
    }

    const accessRow = await ensureProjectAccess(Number(artifact.project_id), getRequestUser(req), reply);
    if (!accessRow) return;

    const signed = await presignGetObject({
      key: String(artifact.object_key || "").trim(),
      contentType: artifact.content_type ? String(artifact.content_type) : null,
      expiresInSeconds: 900
    });

    const meta = artifact.meta_json && typeof artifact.meta_json === "object" ? artifact.meta_json : {};
    return {
      previewId: String(artifact.id),
      status: "ready",
      signedUrl: signed.url,
      contentType: artifact.content_type ? String(artifact.content_type) : null,
      sizeBytes: artifact.size_bytes != null ? Number(artifact.size_bytes) : null,
      createdAt: artifact.created_at ? new Date(artifact.created_at).toISOString() : null,
      methodRequested: meta.previewMethodRequested ?? null,
      methodUsed: meta.previewMethodUsed ?? null,
      kind: meta.kind ?? null,
      draftRevisionId: meta.draftRevisionId ?? null,
      warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
      logs: Array.isArray(meta.logs) ? meta.logs : []
    };
  });
}
