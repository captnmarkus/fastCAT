import { FastifyInstance } from "fastify";
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


export async function registerProjectRoutesPart1(app: FastifyInstance) {
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

  // --- GET Projects List ---
  app.get("/projects", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = getRequestUser(req);
    const userId = requestUserId(user);
    const departmentId = await requestUserDepartmentId(user);
    const query = (req.query as any) || {};
    const scopeCurrent = String(query.scope || "").trim().toLowerCase() === "current";
    let rows: ProjectRow[];
    if (isAdminUser(user)) {
      if (scopeCurrent && !userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const res = await db.query<ProjectRow>(
        `SELECT p.id,
                p.name,
                p.description,
                p.src_lang,
                p.tgt_lang,
                p.target_langs,
                p.status,
                p.published_at,
                p.init_error,
                p.provisioning_started_at,
                p.provisioning_updated_at,
                p.provisioning_finished_at,
                p.provisioning_progress,
                p.provisioning_current_step,
                p.created_by,
                p.assigned_user,
                p.tm_sample,
                p.tm_sample_tm_id,
                p.glossary_id,
                p.department_id,
                d.name AS department_name,
                p.project_settings,
                p.created_at,
                COALESCE(seg.last_modified_at, p.created_at) AS last_modified_at,
                COALESCE(err.error_count, 0) AS error_count
         FROM projects p
         LEFT JOIN departments d ON d.id = p.department_id
         LEFT JOIN (
           SELECT project_id, MAX(updated_at) AS last_modified_at
           FROM segments
           GROUP BY project_id
         ) seg ON seg.project_id = p.id
         LEFT JOIN (
           SELECT s.project_id, COUNT(*)::int AS error_count
           FROM segment_qa qa
           JOIN segments s ON s.id = qa.segment_id
           WHERE qa.resolved = FALSE
           GROUP BY s.project_id
         ) err ON err.project_id = p.id
         WHERE COALESCE(p.project_settings->>'appAgentUploadSession', 'false') <> 'true'
           AND ($1::boolean = FALSE OR p.assigned_user = $2 OR (p.assigned_user IS NULL AND p.created_by = $2))
         ORDER BY p.created_at DESC`,
        [scopeCurrent, userId]
      );
      rows = res.rows;
      return { projects: await Promise.all(rows.map(rowToProject)) };
    }

    if (isManagerUser(user)) {
      if (!departmentId) {
        return reply.code(403).send({ error: "Department assignment required" });
      }
      const res = await db.query<ProjectRow>(
        `SELECT p.id,
                p.name,
                p.description,
                p.src_lang,
                p.tgt_lang,
                p.target_langs,
                p.status,
                p.published_at,
                p.init_error,
                p.provisioning_started_at,
                p.provisioning_updated_at,
                p.provisioning_finished_at,
                p.provisioning_progress,
                p.provisioning_current_step,
                p.created_by,
                p.assigned_user,
                p.tm_sample,
                p.tm_sample_tm_id,
                p.glossary_id,
                p.department_id,
                d.name AS department_name,
                p.project_settings,
                p.created_at,
                COALESCE(seg.last_modified_at, p.created_at) AS last_modified_at,
                COALESCE(err.error_count, 0) AS error_count
         FROM projects p
         LEFT JOIN departments d ON d.id = p.department_id
         LEFT JOIN (
           SELECT project_id, MAX(updated_at) AS last_modified_at
           FROM segments
           GROUP BY project_id
         ) seg ON seg.project_id = p.id
         LEFT JOIN (
           SELECT s.project_id, COUNT(*)::int AS error_count
           FROM segment_qa qa
           JOIN segments s ON s.id = qa.segment_id
           WHERE qa.resolved = FALSE
           GROUP BY s.project_id
         ) err ON err.project_id = p.id
         WHERE p.department_id = $1
           AND COALESCE(p.project_settings->>'appAgentUploadSession', 'false') <> 'true'
           AND ($3::boolean = FALSE OR p.assigned_user = $2 OR (p.assigned_user IS NULL AND p.created_by = $2))
         ORDER BY p.created_at DESC`,
        [departmentId, userId, scopeCurrent]
      );
      rows = res.rows;
      return { projects: await Promise.all(rows.map(rowToProject)) };
    }

    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    if (!departmentId) return reply.code(403).send({ error: "Department assignment required" });

    try {
      await ensureUserBucketsInitialized(userId);
      const client = getRedisClient();

      const created = await client.zRangeWithScores(userProjectsCreatedKey(userId), 0, -1, { REV: true });
      const assigned = await client.zRangeWithScores(userProjectsAssignedKey(userId), 0, -1, { REV: true });

      const scoreMap = new Map<number, number>();
      for (const entry of [...created, ...assigned]) {
        const id = Number((entry as any).value);
        if (!Number.isFinite(id)) continue;
        const score = Number((entry as any).score);
        if (!Number.isFinite(score)) continue;
        scoreMap.set(id, Math.max(scoreMap.get(id) ?? 0, score));
      }

      const orderedIds = Array.from(scoreMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);

      if (orderedIds.length === 0) return { projects: [] };

      const res = await db.query<ProjectRow>(
        `SELECT p.id,
                p.name,
                p.description,
                p.src_lang,
                p.tgt_lang,
                p.target_langs,
                p.status,
                p.published_at,
                p.init_error,
                p.provisioning_started_at,
                p.provisioning_updated_at,
                p.provisioning_finished_at,
                p.provisioning_progress,
                p.provisioning_current_step,
                p.created_by,
                p.assigned_user,
                p.tm_sample,
                p.tm_sample_tm_id,
                p.glossary_id,
                p.department_id,
                d.name AS department_name,
                p.project_settings,
                p.created_at,
                COALESCE(seg.last_modified_at, p.created_at) AS last_modified_at,
                COALESCE(err.error_count, 0) AS error_count
         FROM projects p
         LEFT JOIN departments d ON d.id = p.department_id
         LEFT JOIN (
           SELECT project_id, MAX(updated_at) AS last_modified_at
           FROM segments
           GROUP BY project_id
         ) seg ON seg.project_id = p.id
         LEFT JOIN (
           SELECT s.project_id, COUNT(*)::int AS error_count
           FROM segment_qa qa
           JOIN segments s ON s.id = qa.segment_id
           WHERE qa.resolved = FALSE
           GROUP BY s.project_id
         ) err ON err.project_id = p.id
         WHERE p.id = ANY($1::int[])
           AND p.department_id = $2
           AND COALESCE(p.project_settings->>'appAgentUploadSession', 'false') <> 'true'
         ORDER BY p.created_at DESC`,
        [orderedIds, departmentId]
      );

      const byId = new Map<number, ProjectRow>();
      res.rows.forEach((row) => byId.set(Number(row.id), row));
      rows = orderedIds.map((id) => byId.get(id)).filter(Boolean) as ProjectRow[];
      return { projects: await Promise.all(rows.map(rowToProject)) };
    } catch {
      // Fallback to DB query if Redis is unavailable.
      const res = await db.query<ProjectRow>(
            `SELECT p.id,
                    p.name,
                    p.description,
                    p.src_lang,
                    p.tgt_lang,
                    p.target_langs,
                    p.status,
                    p.published_at,
                    p.init_error,
                    p.provisioning_started_at,
                    p.provisioning_updated_at,
                    p.provisioning_finished_at,
                    p.provisioning_progress,
                    p.provisioning_current_step,
                    p.created_by,
                    p.assigned_user,
                    p.tm_sample,
                    p.tm_sample_tm_id,
                    p.glossary_id,
                    p.department_id,
                    d.name AS department_name,
                    p.project_settings,
                    p.created_at,
                    COALESCE(seg.last_modified_at, p.created_at) AS last_modified_at,
                    COALESCE(err.error_count, 0) AS error_count
             FROM projects p
             LEFT JOIN departments d ON d.id = p.department_id
             LEFT JOIN (
               SELECT project_id, MAX(updated_at) AS last_modified_at
               FROM segments
               GROUP BY project_id
             ) seg ON seg.project_id = p.id
             LEFT JOIN (
               SELECT s.project_id, COUNT(*)::int AS error_count
               FROM segment_qa qa
               JOIN segments s ON s.id = qa.segment_id
               WHERE qa.resolved = FALSE
               GROUP BY s.project_id
             ) err ON err.project_id = p.id
             WHERE p.department_id = $2
               AND (p.assigned_user = $1 OR (p.assigned_user IS NULL AND p.created_by = $1))
               AND COALESCE(p.project_settings->>'appAgentUploadSession', 'false') <> 'true'
             ORDER BY p.created_at DESC`,
            [userId, departmentId]
          );
      rows = res.rows;
      return { projects: await Promise.all(rows.map(rowToProject)) };
    }
  });

  // --- GET Inbox (task-level work items) ---
  app.get("/inbox", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = getRequestUser(req);
    const userId = requestUserId(user);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const departmentId = await requestUserDepartmentId(user);

    const isAdmin = isAdminUser(user);

    type InboxRow = {
      task_id: number;
      project_id: number;
      project_name: string;
      src_lang: string;
      target_lang: string;
      translator_user: string;
      created_by: string | null;
      project_owner: string | null;
      file_id: number;
      original_name: string;
      file_created_at: string;
      last_modified_at: string | null;
      task_status: string | null;
      source_word_count: number | null;
      segment_count: number | null;
      total: number | null;
      draft: number | null;
      under_review: number | null;
      reviewed: number | null;
    };

    let res: { rows: InboxRow[] };

    if (isAdmin) {
      res = await db.query<InboxRow>(
        `SELECT t.id AS task_id,
                p.id AS project_id,
                p.name AS project_name,
                p.src_lang,
                t.target_lang,
                t.translator_user,
                p.created_by,
                COALESCE(p.assigned_user, p.created_by) AS project_owner,
                f.id AS file_id,
                f.original_name,
                f.created_at AS file_created_at,
                COALESCE(s.last_modified_at, t.updated_at, f.created_at) AS last_modified_at,
                t.status AS task_status,
                COALESCE(s.source_word_count, 0)::int AS source_word_count,
                COALESCE(s.segment_count, 0)::int AS segment_count,
                COALESCE(s.total, 0)::int AS total,
                COALESCE(s.draft, 0)::int AS draft,
                COALESCE(s.under_review, 0)::int AS under_review,
                COALESCE(s.reviewed, 0)::int AS reviewed
         FROM translation_tasks t
         JOIN project_files f ON f.id = t.file_id
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN (
           SELECT task_id,
                  MAX(updated_at) AS last_modified_at,
                  SUM(COALESCE(word_count, 0))::int AS source_word_count,
                  COUNT(*)::int AS segment_count,
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                  COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
                  COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
           FROM segments
           WHERE task_id IS NOT NULL
           GROUP BY task_id
         ) s ON s.task_id = t.id
         WHERE p.status = 'ready'
         ORDER BY COALESCE(s.last_modified_at, t.updated_at, f.created_at) DESC, t.id DESC`
      );
    } else {
      if (!departmentId) {
        return reply.code(403).send({ error: "Department assignment required" });
      }
      res = await db.query<InboxRow>(
        `SELECT t.id AS task_id,
                p.id AS project_id,
                p.name AS project_name,
                p.src_lang,
                t.target_lang,
                t.translator_user,
                p.created_by,
                COALESCE(p.assigned_user, p.created_by) AS project_owner,
                f.id AS file_id,
                f.original_name,
                f.created_at AS file_created_at,
                COALESCE(s.last_modified_at, t.updated_at, f.created_at) AS last_modified_at,
                t.status AS task_status,
                COALESCE(s.source_word_count, 0)::int AS source_word_count,
                COALESCE(s.segment_count, 0)::int AS segment_count,
                COALESCE(s.total, 0)::int AS total,
                COALESCE(s.draft, 0)::int AS draft,
                COALESCE(s.under_review, 0)::int AS under_review,
                COALESCE(s.reviewed, 0)::int AS reviewed
         FROM translation_tasks t
         JOIN project_files f ON f.id = t.file_id
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN (
           SELECT task_id,
                  MAX(updated_at) AS last_modified_at,
                  SUM(COALESCE(word_count, 0))::int AS source_word_count,
                  COUNT(*)::int AS segment_count,
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                  COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
                  COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
           FROM segments
           WHERE task_id IS NOT NULL
           GROUP BY task_id
         ) s ON s.task_id = t.id
         WHERE t.translator_user = $1
           AND p.department_id = $2
           AND p.status = 'ready'
         ORDER BY COALESCE(s.last_modified_at, t.updated_at, f.created_at) DESC, t.id DESC`,
        [userId, departmentId]
      );
    }

    const items = res.rows.map((row) => {
      const filename = String(row.original_name || "");
      const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
      const total = Number(row.total ?? 0) || 0;
      const reviewed = Number(row.reviewed ?? 0) || 0;
      const underReview = Number(row.under_review ?? 0) || 0;
      const draft = Number(row.draft ?? 0) || 0;
      const sourceWordCount = Number(row.source_word_count ?? 0) || 0;
      const segmentCount = Number(row.segment_count ?? total ?? 0) || 0;

      let fallbackStatus: "draft" | "under_review" | "reviewed" | "error" = "draft";
      if (total > 0) {
        if (reviewed >= total) fallbackStatus = "reviewed";
        else if (underReview > 0 || reviewed > 0) fallbackStatus = "under_review";
        else if (draft > 0) fallbackStatus = "draft";
      }

      const statusRaw = String(row.task_status || "").trim().toLowerCase();
      const normalizedTaskStatus = normalizeReviewGateStatus(statusRaw);
      const status =
        statusRaw === "draft" || statusRaw === "under_review" || statusRaw === "reviewed" || statusRaw === "error"
          ? total > 0
            ? fallbackStatus
            : statusRaw
          : fallbackStatus;

      const assignedTo = row.translator_user || row.created_by || null;
      const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

      return {
        taskId: Number(row.task_id),
        projectId: Number(row.project_id),
        projectName: String(row.project_name || ""),
        projectOwnerId: row.project_owner ?? null,
        fileId: Number(row.file_id),
        originalFilename: filename,
        type: ext || "file",
        usage: "translatable",
        assignedTo,
        srcLang: row.src_lang,
        tgtLang: row.target_lang,
        status,
        taskStatus: normalizedTaskStatus,
        progressPct,
        lastModifiedAt: row.last_modified_at ? new Date(row.last_modified_at).toISOString() : null,
        lastUpdatedAt: row.last_modified_at ? new Date(row.last_modified_at).toISOString() : null,
        createdAt: new Date(row.file_created_at).toISOString(),
        sourceWordCount,
        segmentCount,
        segmentStats: {
          total,
          draft,
          underReview,
          reviewed
        }
      };
    });

    return { items };
  });

  // --- Project Bucket (S3-backed file storage) ---
  app.get("/projects/:id/bucket", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const projectId = Number(req.params.id);
    const user = getRequestUser(req);
    const userId = requestUserId(user);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const projectRes = await db.query(
      `SELECT id, assigned_user, created_by, department_id FROM projects WHERE id = $1`,
      [projectId]
    );
    const accessRow = projectRes.rows[0] as any;
    if (!accessRow) return reply.code(404).send({ error: "Project not found" });

    if (!isAdminUser(user)) {
      const departmentId = await requestUserDepartmentId(user);
      if (!departmentId || Number(accessRow.department_id) !== Number(departmentId)) {
        return reply.code(403).send({ error: "Project access denied" });
      }

      if (!isManagerUser(user)) {
        const owner = accessRow.assigned_user ?? accessRow.created_by ?? null;
        if (owner !== userId) {
          const taskRes = await db.query(
            `SELECT 1 FROM translation_tasks WHERE project_id = $1 AND translator_user = $2 LIMIT 1`,
            [projectId, userId]
          );
          if ((taskRes.rowCount ?? 0) === 0) {
            return reply.code(403).send({ error: "Project access denied" });
          }
        }
      }
    }

    const sourceRes = await db.query<{
      file_id: number;
      original_name: string;
      content_type: string | null;
      size_bytes: number | null;
      created_at: string | null;
    }>(
      `SELECT
         f.id AS file_id,
         f.original_name,
         a.content_type,
         a.size_bytes,
         a.created_at
       FROM project_files f
       JOIN LATERAL (
         SELECT content_type, size_bytes, created_at
         FROM file_artifacts
         WHERE file_id = f.id AND kind = 'source_original'
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) a ON TRUE
       WHERE f.project_id = $1
       ORDER BY a.created_at DESC, f.created_at DESC, f.id DESC`,
      [projectId]
    );

    const outputRes = await db.query<{
      file_id: number;
      kind: string;
      content_type: string | null;
      size_bytes: number | null;
      created_at: string;
      meta_json: any;
    }>(
      `SELECT a.file_id, a.kind, a.content_type, a.size_bytes, a.created_at, a.meta_json
       FROM file_artifacts a
       JOIN project_files f ON f.id = a.file_id
       WHERE f.project_id = $1
         AND a.kind = 'target_output'
       ORDER BY a.created_at DESC, a.id DESC`,
      [projectId]
    );

    const qaRes = await db.query<{ count: number; last_message: string | null }>(
      `SELECT COUNT(*)::int AS count,
              (SELECT qa.message
               FROM segment_qa qa
               JOIN segments s ON s.id = qa.segment_id
               WHERE s.project_id = $1 AND qa.resolved = FALSE
               ORDER BY qa.created_at DESC
               LIMIT 1) AS last_message
       FROM segment_qa qa
       JOIN segments s ON s.id = qa.segment_id
       WHERE s.project_id = $1 AND qa.resolved = FALSE`,
      [projectId]
    );
    const errorCount = Number(qaRes.rows[0]?.count ?? 0);
    const lastErrorMessageRaw = qaRes.rows[0]?.last_message ?? null;
    const lastErrorMessage = lastErrorMessageRaw ? String(lastErrorMessageRaw) : null;

    const source = sourceRes.rows.map((row) => ({
      fileId: Number(row.file_id),
      filename: String(row.original_name || ""),
      contentType: row.content_type ? String(row.content_type) : null,
      sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : 0,
      uploadedAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
    }));

    const output = outputRes.rows.map((row) => {
      const meta = row.meta_json && typeof row.meta_json === "object" ? (row.meta_json as any) : {};
      const filename = String(meta?.filename || "").trim() || "output";
      const lang = String(meta?.lang || "").trim() || "";
      return {
        fileId: Number(row.file_id),
        filename,
        lang,
        contentType: row.content_type ? String(row.content_type) : null,
        sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : 0,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
      };
    });

    return {
      projectId,
      updatedAt: new Date().toISOString(),
      source,
      output,
      errorCount,
      lastErrorMessage
    };
  });

  app.get("/projects/:id/bucket/file/:fileId/source/:filename", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const projectId = Number(req.params.id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;
    const fileId = Number(req.params.fileId);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid file id" });
    }

    const rowRes = await db.query<{ object_key: string; content_type: string | null; original_name: string }>(
      `SELECT a.object_key, a.content_type, f.original_name
       FROM file_artifacts a
       JOIN project_files f ON f.id = a.file_id
       WHERE f.project_id = $1
         AND f.id = $2
         AND a.kind = 'source_original'
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1`,
      [projectId, fileId]
    );
    const row = rowRes.rows[0];
    if (!row) return reply.code(404).send({ error: "File not found" });

    const signed = await presignGetObject({
      key: String((row as any).object_key || ""),
      downloadFilename: String((row as any).original_name || ""),
      contentType: row.content_type ? String(row.content_type) : null
    });
    return reply.redirect(signed.url);
  });

  app.get("/projects/:id/bucket/file/:fileId/target/:lang/:filename", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const projectId = Number(req.params.id);
    if (!(await ensureProjectAccess(projectId, getRequestUser(req), reply))) return;
    const fileId = Number(req.params.fileId);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid file id" });
    }
    const lang = String(req.params.lang || "");
    const filename = String(req.params.filename || "");

    const taskRes = await db.query<{ status: string | null }>(
      `SELECT status
       FROM translation_tasks
       WHERE project_id = $1
         AND file_id = $2
         AND LOWER(target_lang) = LOWER($3)
       ORDER BY id ASC
       LIMIT 1`,
      [projectId, fileId, lang]
    );
    const taskRow = taskRes.rows[0];
    if (taskRow && !isReviewGateSatisfied(taskRow.status)) {
      return reply.code(409).send({
        error: "Download is available only after review is marked Done.",
        code: "DOWNLOAD_REQUIRES_REVIEWED",
        taskStatus: normalizeReviewGateStatus(taskRow.status)
      });
    }

    const exactRes = await db.query<{ object_key: string; content_type: string | null }>(
      `SELECT a.object_key, a.content_type
       FROM file_artifacts a
       JOIN project_files f ON f.id = a.file_id
       WHERE f.project_id = $1
         AND f.id = $2
         AND a.kind IN ('target_output', 'derived_segments_xliff', 'export_xliff')
         AND COALESCE(a.meta_json->>'lang','') = $3
         AND COALESCE(a.meta_json->>'filename','') = $4
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1`,
      [projectId, fileId, lang, filename]
    );
    const row = exactRes.rows[0];
    if (!row) {
      const fallbackRes = await db.query<{ object_key: string; content_type: string | null }>(
        `SELECT a.object_key, a.content_type
         FROM file_artifacts a
         JOIN project_files f ON f.id = a.file_id
         WHERE f.project_id = $1
           AND f.id = $2
           AND a.kind IN ('target_output', 'derived_segments_xliff', 'export_xliff')
           AND COALESCE(a.meta_json->>'lang','') = $3
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 1`,
        [projectId, fileId, lang]
      );
      const fallback = fallbackRes.rows[0];
      if (!fallback) return reply.code(404).send({ error: "File not found" });
      const signed = await presignGetObject({
        key: String((fallback as any).object_key || ""),
        downloadFilename: filename,
        contentType: fallback.content_type ? String(fallback.content_type) : null
      });
      return reply.redirect(signed.url);
    }

    const signed = await presignGetObject({
      key: String((row as any).object_key || ""),
      downloadFilename: filename,
      contentType: row.content_type ? String(row.content_type) : null
    });
    return reply.redirect(signed.url);
  });

  app.get("/projects/check-name", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = getRequestUser(req);
    const requester = requestUserId(user);
    if (!requester) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const query = (req.query as any) || {};
    const name = String(query.name || "").trim();
    if (!name) {
      return reply.code(400).send({ error: "name is required" });
    }
    let assignedUser = requester;
    const ownerQuery =
      query.projectOwnerId ??
      query.project_owner_id ??
      query.assignedUserId ??
      query.assigned_user_id ??
      null;
    if (ownerQuery !== undefined && ownerQuery !== null) {
      const raw = String(ownerQuery).trim();
      if (raw) {
        const resolved = await resolveUserRef(raw);
        if (!resolved) {
          return reply.code(400).send({ error: "Invalid assignedUserId" });
        }
        if (!canAssignProjects(user) && resolved !== requester) {
          return reply
            .code(403)
            .send({ error: "Manager privileges required to assign users" });
        }
        assignedUser = resolved;
      }
    }

    const existsRes = await db.query(
      `SELECT 1 FROM projects WHERE assigned_user = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [assignedUser, name]
    );
    return { available: existsRes.rowCount === 0 };
  });

}
