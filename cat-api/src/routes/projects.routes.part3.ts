import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import {
  requireAuth,
  getRequestUser,
  requestUserId,
  requestUserIdInt,
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
import { insertAuditEvent } from "../lib/audit.js";
import { insertSegmentsForFile } from "./projects.segment-insert.js";
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
import fetch from "node-fetch";
import crypto from "crypto";
import {
  isReviewGateSatisfied,
  normalizeDedupeMode,
  readProvisionState
} from "./projects.provisioning.helpers.js";

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


async function rehydrateAgentProjectImports(projectId: number) {
  const projectRes = await db.query<{ project_settings: any }>(
    `SELECT project_settings
     FROM projects
     WHERE id = $1
     LIMIT 1`,
    [projectId]
  );
  const projectRow = projectRes.rows[0];
  if (!projectRow) return { processedFiles: 0, failedFiles: 0, mapConfigured: false };
  const settings = normalizeJsonObject(projectRow.project_settings);
  const sourceMapRaw = normalizeJsonObject(settings.appAgentSourceFileMap);
  const mappings = Object.entries(sourceMapRaw)
    .map(([targetFileIdRaw, sourceFileIdRaw]) => {
      const targetFileId = Number(targetFileIdRaw);
      const sourceFileId = Number(sourceFileIdRaw);
      if (!Number.isFinite(targetFileId) || targetFileId <= 0) return null;
      if (!Number.isFinite(sourceFileId) || sourceFileId <= 0) return null;
      return {
        targetFileId: Math.trunc(targetFileId),
        sourceFileId: Math.trunc(sourceFileId)
      };
    })
    .filter(Boolean) as Array<{ targetFileId: number; sourceFileId: number }>;
  if (mappings.length === 0) {
    return { processedFiles: 0, failedFiles: 0, mapConfigured: false };
  }

  return withTransaction(async (client) => {
    let processedFiles = 0;
    let failedFiles = 0;

    for (const mapping of mappings) {
      const sourceSegRes = await client.query<{
        seg_index: number;
        src: string;
        tgt: string | null;
        src_runs: any;
        tgt_runs: any;
        segment_context: any;
        origin_details: any;
        task_id: number | null;
      }>(
        `SELECT seg_index, src, tgt, src_runs, tgt_runs, segment_context, origin_details, task_id
         FROM segments
         WHERE file_id = $1
         ORDER BY
           seg_index ASC,
           CASE WHEN task_id IS NULL THEN 0 ELSE 1 END ASC,
           id ASC`,
        [mapping.sourceFileId]
      );
      const seen = new Set<number>();
      const seedSegments: Array<{
        src: string;
        tgt?: string | null;
        srcRuns?: any;
        tgtRuns?: any;
        segmentContext?: any;
        originDetails?: any;
      }> = [];
      sourceSegRes.rows.forEach((row) => {
        const idx = Number(row.seg_index ?? -1);
        if (!Number.isFinite(idx) || idx < 0 || seen.has(idx)) return;
        seen.add(idx);
        seedSegments.push({
          src: String(row.src || ""),
          tgt: row.tgt ?? null,
          srcRuns: row.src_runs ?? [],
          tgtRuns: row.tgt_runs ?? [],
          segmentContext: row.segment_context ?? {},
          originDetails: row.origin_details ?? {}
        });
      });

      await client.query(
        `DELETE FROM segments
         WHERE project_id = $1
           AND file_id = $2`,
        [projectId, mapping.targetFileId]
      );

      if (seedSegments.length === 0) {
        failedFiles += 1;
        await client.query(
          `UPDATE project_files
           SET status = 'failed'
           WHERE project_id = $1
             AND id = $2`,
          [projectId, mapping.targetFileId]
        );
        await client.query(
          `INSERT INTO project_file_processing_logs(project_id, file_id, stage, status, message, details)
           VALUES($1, $2, 'IMPORT', 'FAILED', $3, $4::jsonb)`,
          [
            projectId,
            mapping.targetFileId,
            "Retry import failed: source has no segments.",
            JSON.stringify({ sourceFileId: mapping.sourceFileId })
          ]
        );
        continue;
      }

      await insertSegmentsForFile(client, projectId, mapping.targetFileId, sanitizeSegments(seedSegments));
      await client.query(
        `UPDATE project_files
         SET status = 'ready'
         WHERE project_id = $1
           AND id = $2`,
        [projectId, mapping.targetFileId]
      );
      await client.query(
        `INSERT INTO project_file_processing_logs(project_id, file_id, stage, status, message, details)
         VALUES($1, $2, 'IMPORT', 'READY', $3, $4::jsonb)`,
        [
          projectId,
          mapping.targetFileId,
          `Retry import restored ${seedSegments.length} segment(s).`,
          JSON.stringify({ sourceFileId: mapping.sourceFileId, segmentCount: seedSegments.length })
        ]
      );
      processedFiles += 1;
    }

    return { processedFiles, failedFiles, mapConfigured: true };
  });
}

export async function registerProjectRoutesPart3(app: FastifyInstance) {
  const hashText = (value: string) =>
    crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");

  // --- GET Project Details ---
  app.get("/projects/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;
    const row = await getProjectRow(projectId);
    if (!row) return reply.code(404).send({ error: "Project not found" });
    return { project: await rowToProject(row) };
  });

  // --- GET Provision Status ---
  const handleGetProvisionStatus = async (req: any, reply: any) => {
    const projectId = Number((req.params as any).id);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return reply.code(400).send({ error: "Invalid project id" });
    }
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;

    const payload = await readProvisionState(projectId);
    if (!payload) return reply.code(404).send({ error: "Project not found" });
    return payload;
  };
  app.get("/projects/:id/provision/status", { preHandler: [requireAuth] }, handleGetProvisionStatus);
  app.get("/projects/:id/provisioning", { preHandler: [requireAuth] }, handleGetProvisionStatus);

  // --- RETRY Provision ---
  app.post("/projects/:id/provision/retry", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return reply.code(400).send({ error: "Invalid project id" });
    }
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;

    const projectRes = await db.query<{ status: string }>(
      `SELECT status FROM projects WHERE id = $1`,
      [projectId]
    );
    const project = projectRes.rows[0];
    if (!project) return reply.code(404).send({ error: "Project not found" });
    const status = String(project.status || "").toLowerCase();

    const segCountRes = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM segments
       WHERE project_id = $1`,
      [projectId]
    );
    const totalSegments = Number(segCountRes.rows[0]?.total ?? 0);
    const canRetryReadyEmpty = status === "ready" && totalSegments === 0;

    if (status !== "failed" && status !== "provisioning" && !canRetryReadyEmpty) {
      return reply.code(409).send({ error: "Project is already ready.", code: "PROJECT_READY" });
    }

    if (status === "failed" || canRetryReadyEmpty) {
      try {
        const rehydrate = await rehydrateAgentProjectImports(projectId);
        if (rehydrate.mapConfigured && rehydrate.failedFiles > 0 && rehydrate.processedFiles <= 0) {
          return reply.code(409).send({
            error: "Retry import failed. Source files still have no segments.",
            code: "RETRY_IMPORT_EMPTY_SOURCE"
          });
        }
      } catch (err: any) {
        return reply.code(500).send({
          error: String(err?.message || "Retry import failed."),
          code: "RETRY_IMPORT_FAILED"
        });
      }
    }

    await retryProvisionJob({ projectId, log: (req as any).log });

    return {
      projectId,
      status: "provisioning",
      statusUrl: `/api/cat/projects/${projectId}/provisioning`
    };
  });

  // --- GET Project Files (multi-file projects) ---
  app.get("/projects/:id/files", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;
    const row = await getProjectRow(projectId);
    if (!row) return reply.code(404).send({ error: "Project not found" });
    const files = await listProjectFiles(projectId);
    const assignedTo = row.assigned_user ?? row.created_by ?? null;
    return {
      projectId,
      assignedTo,
      files
    };
  });

  // --- IMPORT FINISHED FILE SEGMENTS INTO TM ---
  app.post("/projects/:projectId/files/:fileId/import-to-tm", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const projectId = Number((req.params as any).projectId);
    const fileId = Number((req.params as any).fileId);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return reply.code(400).send({ error: "Invalid project id" });
    }
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid file id" });
    }

    const body = (req.body as any) || {};
    const tmId = Number(body.tmId ?? body.tm_id);
    if (!Number.isFinite(tmId) || tmId <= 0) {
      return reply.code(400).send({ error: "tmId is required", code: "TM_ID_REQUIRED" });
    }

    const dedupeMode = normalizeDedupeMode(body.dedupeMode ?? body.dedupe_mode);
    if (dedupeMode !== "skip") {
      return reply.code(400).send({
        error: `dedupeMode "${dedupeMode}" is not supported for this import flow`,
        code: "UNSUPPORTED_DEDUPE_MODE"
      });
    }

    const targetLangFilter = body.targetLang ?? body.target_lang ?? null;
    const normalizedTargetLangFilter = targetLangFilter ? normalizeLanguageTag(String(targetLangFilter)) : null;

    const user = getRequestUser(req);
    const actor = requestUserId(user);
    if (!actor) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const projectRes = await db.query<{
      id: number;
      src_lang: string;
      tgt_lang: string;
      assigned_user: string | null;
      created_by: string | null;
    }>(
      `SELECT id, src_lang, tgt_lang, assigned_user, created_by
       FROM projects
       WHERE id = $1`,
      [projectId]
    );
    const projectRow = projectRes.rows[0];
    if (!projectRow) {
      return reply.code(404).send({ error: "Project not found" });
    }

    const owner = String(projectRow.assigned_user ?? projectRow.created_by ?? "").trim();
    if (!owner || owner !== actor) {
      return reply.code(403).send({ error: "Only the project owner can import to TM", code: "PROJECT_OWNER_REQUIRED" });
    }

    const fileRes = await db.query<{ id: number; original_name: string }>(
      `SELECT id, original_name
       FROM project_files
       WHERE project_id = $1
         AND id = $2
       LIMIT 1`,
      [projectId, fileId]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) {
      return reply.code(404).send({ error: "File not found in project", code: "PROJECT_FILE_NOT_FOUND" });
    }

    const tmInfoRes = await fetch(`${CONFIG.TM_PROXY_URL}/api/tm/${tmId}/info`, {
      headers: { "content-type": "application/json" }
    });
    if (!tmInfoRes.ok) {
      if (tmInfoRes.status === 404) {
        return reply.code(404).send({ error: "TM not found", code: "TM_NOT_FOUND" });
      }
      return reply.code(502).send({ error: "Failed to validate TM", code: "TM_VALIDATION_FAILED" });
    }

    const tasksRes = await db.query<{
      id: number;
      source_lang: string;
      target_lang: string;
      status: string;
    }>(
      `SELECT id, source_lang, target_lang, status
       FROM translation_tasks
       WHERE project_id = $1
         AND file_id = $2
       ORDER BY id ASC`,
      [projectId, fileId]
    );

    if ((tasksRes.rowCount ?? 0) === 0) {
      return reply.code(409).send({ error: "File has no translation tasks", code: "FILE_NOT_FINISHED" });
    }

    const selectedTasks = tasksRes.rows.filter((task) => {
      if (!normalizedTargetLangFilter) return true;
      return normalizeLanguageTag(String(task.target_lang || "")) === normalizedTargetLangFilter;
    });
    if (selectedTasks.length === 0) {
      return reply.code(404).send({ error: "Target language task not found for file", code: "TASK_NOT_FOUND" });
    }

    const outputRes = await db.query<{ lang: string }>(
      `SELECT DISTINCT LOWER(COALESCE(a.meta_json->>'lang','')) AS lang
       FROM file_artifacts a
       JOIN project_files f ON f.id = a.file_id
       WHERE f.project_id = $1
         AND f.id = $2
         AND a.kind = 'target_output'`,
      [projectId, fileId]
    );
    const outputLangs = new Set(
      outputRes.rows
        .map((row) => normalizeLanguageTag(String(row.lang || "")).toLowerCase())
        .filter(Boolean)
    );

    const importableTasks = selectedTasks.filter((task) => {
      if (!isReviewGateSatisfied(task.status)) return false;
      const langKey = normalizeLanguageTag(String(task.target_lang || "")).toLowerCase();
      return outputLangs.has(langKey);
    });

    if (importableTasks.length === 0) {
      const hasFinished = selectedTasks.some((task) => isReviewGateSatisfied(task.status));
      if (!hasFinished) {
        return reply.code(409).send({ error: "File is not finished", code: "FILE_NOT_FINISHED" });
      }
      return reply.code(409).send({
        error: "No downloadable finished output found for file",
        code: "FILE_OUTPUT_NOT_FOUND"
      });
    }

    const taskIds = importableTasks.map((task) => Number(task.id));
    const segmentsRes = await db.query<{
      id: number;
      task_id: number;
      seg_index: number;
      src: string;
      tgt: string | null;
    }>(
      `SELECT id, task_id, seg_index, src, tgt
       FROM segments
       WHERE project_id = $1
         AND file_id = $2
         AND task_id = ANY($3::int[])
       ORDER BY task_id ASC, seg_index ASC`,
      [projectId, fileId, taskIds]
    );

    const segmentsByTask = new Map<number, Array<{ id: number; src: string; tgt: string | null }>>();
    for (const row of segmentsRes.rows) {
      const list = segmentsByTask.get(Number(row.task_id)) ?? [];
      list.push({
        id: Number(row.id),
        src: String(row.src || ""),
        tgt: row.tgt == null ? null : String(row.tgt)
      });
      segmentsByTask.set(Number(row.task_id), list);
    }

    const importPairs: Array<{
      taskId: number;
      segmentId: number;
      sourceLang: string;
      targetLang: string;
      sourceText: string;
      targetText: string;
    }> = [];

    for (const task of importableTasks) {
      const sourceLang = normalizeLanguageTag(String(task.source_lang || projectRow.src_lang || ""));
      const targetLang = normalizeLanguageTag(String(task.target_lang || projectRow.tgt_lang || ""));
      const taskSegments = segmentsByTask.get(Number(task.id)) ?? [];
      for (const segment of taskSegments) {
        const sourceText = String(segment.src || "").trim();
        const targetText = String(segment.tgt || "").trim();
        if (!sourceText || !targetText) continue;
        importPairs.push({
          taskId: Number(task.id),
          segmentId: Number(segment.id),
          sourceLang: sourceLang || String(task.source_lang || "").trim(),
          targetLang: targetLang || String(task.target_lang || "").trim(),
          sourceText,
          targetText
        });
      }
    }

    if (importPairs.length === 0) {
      return reply.code(409).send({ error: "No translated segments to import", code: "NO_SEGMENTS_TO_IMPORT" });
    }

    const traceId = typeof req.id === "string" ? req.id : undefined;
    const token = (app as any).jwt.sign({
      sub: "cat-api",
      username: "cat-api",
      role: "admin"
    });
    const proxyHeaders: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    };
    if (traceId) proxyHeaders["x-request-id"] = traceId;

    const parseProxyError = async (res: any, fallback: string) => {
      try {
        const payload = (await res.json()) as any;
        if (payload?.error) return String(payload.error);
      } catch {
        /* ignore */
      }
      return fallback;
    };

    let processed = 0;
    let imported = 0;
    let skipped = 0;
    const importedLangs = new Set<string>();

    (req as any).log?.info?.(
      {
        projectId,
        fileId,
        tmId,
        targetLang: normalizedTargetLangFilter,
        pairCount: importPairs.length,
        dedupeMode
      },
      "TM import from finished file started"
    );

    for (const pair of importPairs) {
      const sourceHash = hashText(pair.sourceText);
      const targetHash = hashText(pair.targetText);

      const markerRes = await db.query<{ id: number; status: string }>(
        `INSERT INTO tm_file_segment_imports(
           project_id,
           file_id,
           task_id,
           segment_id,
           tm_id,
           source_lang,
           target_lang,
           source_text,
           target_text,
           source_hash,
           target_hash,
           dedupe_mode,
           status,
           imported_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13)
         ON CONFLICT (project_id, file_id, tm_id, task_id, segment_id, source_hash, target_hash)
         DO UPDATE SET
           dedupe_mode = EXCLUDED.dedupe_mode,
           imported_by = EXCLUDED.imported_by,
           updated_at = NOW()
         RETURNING id, status`,
        [
          projectId,
          fileId,
          pair.taskId,
          pair.segmentId,
          tmId,
          pair.sourceLang,
          pair.targetLang,
          pair.sourceText,
          pair.targetText,
          sourceHash,
          targetHash,
          dedupeMode,
          actor
        ]
      );
      const markerId = Number(markerRes.rows[0]?.id);
      const markerStatus = String(markerRes.rows[0]?.status || "").trim().toLowerCase();

      processed += 1;
      importedLangs.add(pair.targetLang);

      if (!Number.isFinite(markerId) || markerId <= 0) {
        return reply.code(500).send({ error: "Failed to initialize TM import marker" });
      }
      if (markerStatus === "imported") {
        skipped += 1;
        continue;
      }

      try {
        const duplicateRes = await fetch(`${CONFIG.TM_PROXY_URL}/api/tm/${tmId}/check-duplicate`, {
          method: "POST",
          headers: proxyHeaders,
          body: JSON.stringify({
            sourceLang: pair.sourceLang,
            targetLang: pair.targetLang,
            source: pair.sourceText,
            target: pair.targetText
          })
        });
        if (!duplicateRes.ok) {
          const errMessage = await parseProxyError(duplicateRes, `tm duplicate check failed (${duplicateRes.status})`);
          throw new Error(errMessage);
        }
        const duplicatePayload = (await duplicateRes.json()) as any;
        if (Boolean(duplicatePayload?.exists)) {
          skipped += 1;
          await db.query(
            `UPDATE tm_file_segment_imports
             SET status = 'imported',
                 imported_at = COALESCE(imported_at, NOW()),
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [markerId]
          );
          continue;
        }

        const commitRes = await fetch(`${CONFIG.TM_PROXY_URL}/api/tm/${tmId}/commit`, {
          method: "POST",
          headers: proxyHeaders,
          body: JSON.stringify({
            sourceLang: pair.sourceLang,
            targetLang: pair.targetLang,
            source: pair.sourceText,
            target: pair.targetText
          })
        });
        if (!commitRes.ok) {
          const errMessage = await parseProxyError(commitRes, `tm commit failed (${commitRes.status})`);
          throw new Error(errMessage);
        }

        imported += 1;
        await db.query(
          `UPDATE tm_file_segment_imports
           SET status = 'imported',
               imported_at = COALESCE(imported_at, NOW()),
               error_message = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [markerId]
        );
      } catch (err: any) {
        await db.query(
          `UPDATE tm_file_segment_imports
           SET status = 'error',
               error_message = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [markerId, String(err?.message || "TM import failed")]
        );
        (req as any).log?.error?.(
          {
            projectId,
            fileId,
            tmId,
            taskId: pair.taskId,
            segmentId: pair.segmentId,
            err
          },
          "TM import from finished file failed"
        );
        return reply.code(502).send({
          error: err?.message || "Failed to import segment into TM",
          code: "TM_IMPORT_FAILED",
          processed,
          imported,
          skipped
        });
      }
    }

    const importedAtRes = await db.query<{ imported_at: string | null }>(
      `SELECT MAX(imported_at) AS imported_at
       FROM tm_file_segment_imports
       WHERE project_id = $1
         AND file_id = $2
         AND tm_id = $3
         AND status = 'imported'
         AND ($4::text IS NULL OR LOWER(target_lang) = LOWER($4))`,
      [projectId, fileId, tmId, normalizedTargetLangFilter]
    );
    const importedAt = importedAtRes.rows[0]?.imported_at
      ? new Date(importedAtRes.rows[0].imported_at as string).toISOString()
      : new Date().toISOString();

    await insertAuditEvent(db, {
      actorUserId: requestUserIdInt(user),
      actorLabel: actor,
      action: "TM_IMPORT_FROM_FINISHED_FILE",
      objectType: "project_file",
      objectId: `${projectId}:${fileId}`,
      details: {
        tmId,
        targetLang: normalizedTargetLangFilter,
        dedupeMode,
        processed,
        imported,
        skipped,
        languages: Array.from(importedLangs).sort()
      }
    });

    (req as any).log?.info?.(
      {
        projectId,
        fileId,
        tmId,
        targetLang: normalizedTargetLangFilter,
        processed,
        imported,
        skipped
      },
      "TM import from finished file completed"
    );

    return {
      ok: true,
      projectId,
      fileId,
      tmId,
      targetLang: normalizedTargetLangFilter,
      dedupeMode,
      segmentsProcessed: processed,
      segmentsImported: imported,
      segmentsSkipped: skipped,
      importedAt
    };
  });

  // --- RUN PRETRANSLATION JOBS ---
  app.post("/projects/:id/pretranslate", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;

    const body = (req.body as any) || {};
    const scopeRaw = String(body.scope || "all").trim().toLowerCase();
    const scope =
      scopeRaw === "file" || scopeRaw === "language" || scopeRaw === "all"
        ? scopeRaw
        : "all";
    const fileId = parseOptionalInt(body.fileId ?? body.file_id);
    const targetLang = body.targetLang ?? body.target_lang ?? null;
    const overwriteExisting = body.overwrite === true || body.overwriteExisting === true;

    if (scope === "file" && !fileId) {
      return reply.code(400).send({ error: "fileId is required when scope is file" });
    }
    if (scope === "language" && (!targetLang || !String(targetLang).trim())) {
      return reply.code(400).send({ error: "targetLang is required when scope is language" });
    }

    try {
      (req as any).log?.info?.(
        {
          projectId,
          scope,
          fileId: fileId ?? null,
          targetLang: targetLang ? String(targetLang) : null,
          overwriteExisting
        },
        "Pretranslate endpoint invoked"
      );
      const result = await enqueuePretranslateJobs({
        projectId,
        scope,
        fileId: fileId ?? null,
        targetLang: targetLang ? String(targetLang) : null,
        overwriteExisting,
        log: (req as any).log
      });
      (req as any).log?.info?.(
        {
          projectId,
          queued: (result as any)?.queued ?? null,
          skipped: (result as any)?.skipped ?? null,
          total: (result as any)?.total ?? null,
          resolvedPairCount: (result as any)?.resolvedPairCount ?? null
        },
        "Pretranslate endpoint completed"
      );
      return result;
    } catch (err: any) {
      const message = String(err?.message || "Failed to enqueue pretranslation jobs");
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: message });
      }
      throw err;
    }
  });

  // --- GET PRETRANSLATION STATUS ---
  app.get("/projects/:id/pretranslate/status", { preHandler: [requireAuth] }, async (req, reply) => {
    const projectId = Number((req.params as any).id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;

    const jobsRes = await db.query<{
      id: number;
      project_id: number;
      file_id: number;
      target_lang: string;
      engine_id: number | null;
      status: string;
      overwrite_existing: boolean;
      retry_count: number;
      max_retries: number;
      segments_total: number;
      segments_processed: number;
      segments_skipped: number;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      started_at: string | null;
      completed_at: string | null;
      original_name: string;
    }>(
      `SELECT j.*,
              pf.original_name
       FROM project_pretranslate_jobs j
       JOIN project_files pf ON pf.id = j.file_id
       WHERE j.project_id = $1
       ORDER BY pf.created_at ASC, j.target_lang ASC`,
      [projectId]
    );

    const jobs = jobsRes.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      fileId: row.file_id,
      fileName: row.original_name,
      targetLang: row.target_lang,
      engineId: row.engine_id != null ? Number(row.engine_id) : null,
      status: row.status,
      overwriteExisting: Boolean(row.overwrite_existing),
      retryCount: Number(row.retry_count || 0),
      maxRetries: Number(row.max_retries || 0),
      segmentsTotal: Number(row.segments_total || 0),
      segmentsProcessed: Number(row.segments_processed || 0),
      segmentsSkipped: Number(row.segments_skipped || 0),
      error: row.error_message ?? null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
    }));

    const summary = jobs.reduce(
      (acc, job) => {
        acc.total += 1;
        if (job.status === "pending") acc.pending += 1;
        else if (job.status === "running") acc.running += 1;
        else if (job.status === "failed") acc.failed += 1;
        else if (job.status === "done") acc.done += 1;
        acc.segmentsTotal += job.segmentsTotal;
        acc.segmentsProcessed += job.segmentsProcessed;
        acc.segmentsSkipped += job.segmentsSkipped;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        running: 0,
        done: 0,
        failed: 0,
        segmentsTotal: 0,
        segmentsProcessed: 0,
        segmentsSkipped: 0
      }
    );

    return { summary, jobs };
  });

  // --- GET Project Analytics ---
  app.get(
    "/projects/:id/analytics",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const projectId = Number((req.params as any).id);
      if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;

      const project = await getProjectRow(projectId);
      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const query = (req.query as any) || {};
      const fileIdParam = query.fileId != null ? Number(query.fileId) : null;
      const fileId =
        fileIdParam != null && Number.isFinite(fileIdParam) && fileIdParam > 0
          ? fileIdParam
          : null;

      const taskRowsRes = await db.query<{ status: string; count: number }>(
        fileId
          ? `SELECT status, COUNT(*)::int AS count
             FROM (
               SELECT t.id,
                      CASE
                        WHEN COALESCE(s.total, 0) = 0 THEN
                          CASE
                            WHEN LOWER(t.status) IN ('draft', 'under_review', 'reviewed', 'error') THEN LOWER(t.status)
                            ELSE 'draft'
                          END
                        WHEN s.reviewed >= s.total THEN 'reviewed'
                        WHEN s.under_review > 0 OR s.reviewed > 0 THEN 'under_review'
                        ELSE 'draft'
                      END AS status
               FROM translation_tasks t
               LEFT JOIN (
                 SELECT task_id,
                        COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                        COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
                        COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
                 FROM segments
                 WHERE task_id IS NOT NULL
                 GROUP BY task_id
               ) s ON s.task_id = t.id
               WHERE t.project_id = $1 AND t.file_id = $2
             ) derived
             GROUP BY status`
          : `SELECT status, COUNT(*)::int AS count
             FROM (
               SELECT t.id,
                      CASE
                        WHEN COALESCE(s.total, 0) = 0 THEN
                          CASE
                            WHEN LOWER(t.status) IN ('draft', 'under_review', 'reviewed', 'error') THEN LOWER(t.status)
                            ELSE 'draft'
                          END
                        WHEN s.reviewed >= s.total THEN 'reviewed'
                        WHEN s.under_review > 0 OR s.reviewed > 0 THEN 'under_review'
                        ELSE 'draft'
                      END AS status
               FROM translation_tasks t
               LEFT JOIN (
                 SELECT task_id,
                        COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                        COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
                        COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
                 FROM segments
                 WHERE task_id IS NOT NULL
                 GROUP BY task_id
               ) s ON s.task_id = t.id
               WHERE t.project_id = $1
             ) derived
             GROUP BY status`,
        fileId ? [projectId, fileId] : [projectId]
      );

      let rows = taskRowsRes.rows;
      if (rows.length === 0) {
        const rowsRes = await db.query<{ status: string; count: number }>(
          fileId
            ? `SELECT status, COUNT(*)::int as count
               FROM segments
               WHERE project_id = $1 AND file_id = $2
               GROUP BY status`
            : `SELECT status, COUNT(*)::int as count
               FROM segments
               WHERE project_id = $1
               GROUP BY status`,
          fileId ? [projectId, fileId] : [projectId]
        );
        rows = rowsRes.rows;
      }

      const statuses = rows.map((row) => ({
        status: row.status,
        count: Number(row.count ?? 0)
      }));

      const aggregates = statuses.reduce(
        (acc, row) => {
          acc.total += row.count;
          const key = String(row.status || "").toLowerCase();
          if (key === "draft") acc.draft += row.count;
          if (key === "under_review") acc.underReview += row.count;
          if (key === "reviewed" || key === "approved") acc.reviewed += row.count;
          return acc;
        },
        { total: 0, draft: 0, underReview: 0, reviewed: 0 }
      );

      const pending = Math.max(0, aggregates.total - aggregates.reviewed);

      return {
        projectId,
        statuses,
        aggregates: {
          total: aggregates.total,
          draft: aggregates.draft,
          underReview: aggregates.underReview,
          reviewed: aggregates.reviewed,
          pending
        }
      };
    }
  );

}
