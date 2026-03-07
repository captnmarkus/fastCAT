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


export async function registerProjectRoutesPart6(app: FastifyInstance) {
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
  const RENDERED_PREVIEW_ARTIFACT_TTL_DAYS = 7;
  const RENDERED_PREVIEW_JOB_TTL_MS = 30 * 60 * 1000;

  type RenderedPreviewJobStatus = "queued" | "running" | "ready" | "error";

  type OutputSegmentRow = {
    seg_index: number;
    src: string;
    tgt: string | null;
    src_runs: any;
    tgt_runs: any;
    segment_context: any;
  };
  type RenderedPreviewJob = {
    id: string;
    cacheKey: string;
    projectId: number;
    fileId: number;
    taskId: number | null;
    targetLang: string;
    previewMethod: string;
    status: RenderedPreviewJobStatus;
    createdAtMs: number;
    updatedAtMs: number;
    artifactId: number | null;
    warnings: string[];
    logs: string[];
    error: string | null;
    errorDetails: string | null;
  };

  const renderedPreviewJobsById = new Map<string, RenderedPreviewJob>();
  const renderedPreviewJobsByCacheKey = new Map<string, string>();

  const pruneRenderedPreviewJobs = () => {
    const now = Date.now();
    for (const [jobId, job] of renderedPreviewJobsById.entries()) {
      if (job.status === "queued" || job.status === "running") continue;
      if (now - job.updatedAtMs < RENDERED_PREVIEW_JOB_TTL_MS) continue;
      renderedPreviewJobsById.delete(jobId);
      if (renderedPreviewJobsByCacheKey.get(job.cacheKey) === jobId) {
        renderedPreviewJobsByCacheKey.delete(job.cacheKey);
      }
    }
  };

  const sanitizeHtmlForRenderedPreview = (inputHtml: string) => {
    const $ = loadHtml(String(inputHtml || ""), undefined, false);
    $("script, iframe, object, embed, base, link[rel='preload'], link[rel='prefetch'], meta[http-equiv='refresh']").remove();
    $("*").each((_, node) => {
      const attrs = { ...((node as any).attribs || {}) } as Record<string, string>;
      for (const [name, value] of Object.entries(attrs)) {
        const normalized = String(name || "").trim().toLowerCase();
        if (!normalized) continue;
        if (normalized.startsWith("on")) {
          $(node).removeAttr(name);
          continue;
        }
        if ((normalized === "href" || normalized === "src") && /^javascript:/i.test(String(value || "").trim())) {
          $(node).removeAttr(name);
        }
      }
    });
    return $.html();
  };

  const buildOfficeFallbackHtml = (params: {
    fileType: string;
    lines: string[];
    warning: string;
  }) => {
    const rows = params.lines
      .map((line, idx) => `<tr><td>${idx + 1}</td><td>${escapeXml(String(line || ""))}</td></tr>`)
      .join("");
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rendered Preview Fallback</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #fff; color: #111; }
      .shell { padding: 16px; }
      .note { border: 1px solid #222; background: #fafafa; padding: 12px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
      td:first-child { width: 64px; color: #666; text-align: right; }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="note">
        <strong>${escapeXml(params.fileType.toUpperCase())} preview fallback:</strong>
        ${escapeXml(params.warning || "PDF conversion is unavailable in this environment.")}
      </div>
      <table>
        <tbody>${rows || "<tr><td>1</td><td></td></tr>"}</tbody>
      </table>
    </div>
  </body>
</html>`;
  };

  const runBinaryWithTimeout = async (command: string, args: string[], timeoutMs: number) => {
    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        if (code !== 0) {
          reject(new Error(`${command} exited with code ${code}. ${truncateErrorMessage(stderr || stdout || "")}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  };

  const convertOfficeBufferToPdf = async (params: {
    inputBuffer: Buffer;
    inputExtension: string;
  }): Promise<{ ok: true; pdf: Buffer; logs: string[] } | { ok: false; error: string; logs: string[] }> => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "fastcat-rendered-preview-"));
    const logs: string[] = [];
    try {
      const inputPath = path.join(tempRoot, `input${params.inputExtension}`);
      const outputPath = path.join(tempRoot, "input.pdf");
      await writeFile(inputPath, params.inputBuffer);

      const candidateCommands = [
        { command: "soffice", args: ["--headless", "--nologo", "--norestore", "--convert-to", "pdf", "--outdir", tempRoot, inputPath] },
        { command: "libreoffice", args: ["--headless", "--nologo", "--norestore", "--convert-to", "pdf", "--outdir", tempRoot, inputPath] }
      ];

      let lastError = "No office converter command succeeded.";
      for (const candidate of candidateCommands) {
        try {
          const run = await runBinaryWithTimeout(candidate.command, candidate.args, 45_000);
          logs.push(`${candidate.command}: ${truncateErrorMessage(run.stdout || run.stderr || "ok", 400)}`);
          const pdf = await readFile(outputPath);
          if (pdf.length > 0) return { ok: true, pdf, logs };
        } catch (err: any) {
          const message = truncateErrorMessage(err?.message || String(err), 400);
          logs.push(`${candidate.command}: ${message}`);
          lastError = message || lastError;
        }
      }

      return { ok: false, error: lastError, logs };
    } catch (err: any) {
      return { ok: false, error: truncateErrorMessage(err?.message || String(err), 400), logs };
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  };

  const resolveRenderedPreviewSelection = async (params: {
    projectId: number;
    fileId: number | null;
    taskId: number | null;
    targetLang: string | null;
  }) => {
    let taskId = params.taskId;
    let fileId = params.fileId;
    let targetLang = params.targetLang ? normalizeLanguageTag(params.targetLang) : "";

    const project = await getProjectRow(params.projectId);
    if (!project) {
      return { error: "Project not found" as const };
    }

    if (taskId != null) {
      const taskRes = await db.query<{ file_id: number; target_lang: string }>(
        `SELECT file_id, target_lang
         FROM translation_tasks
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [taskId, params.projectId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return { error: "Task not found" as const };
      fileId = Number(taskRow.file_id);
      targetLang = normalizeLanguageTag(String(taskRow.target_lang || project.tgt_lang || ""));
    }

    if (!fileId) {
      return { error: "fileId or taskId is required" as const };
    }

    if (!taskId) {
      const tasksRes = await db.query<{ id: number; target_lang: string }>(
        `SELECT id, target_lang
         FROM translation_tasks
         WHERE project_id = $1 AND file_id = $2
         ORDER BY id ASC`,
        [params.projectId, fileId]
      );
      if ((tasksRes.rowCount ?? 0) > 0) {
        if (!targetLang) {
          if ((tasksRes.rowCount ?? 0) === 1) {
            const row = tasksRes.rows[0];
            taskId = Number(row.id);
            targetLang = normalizeLanguageTag(String(row.target_lang || project.tgt_lang || ""));
          } else {
            return { error: "targetLang is required when multiple target languages exist for this file." as const };
          }
        } else {
          const normalizedTarget = normalizeLanguageTag(targetLang);
          const match = tasksRes.rows.find((row) => normalizeLanguageTag(String(row.target_lang || "")) === normalizedTarget);
          if (!match) {
            return { error: "No translation task found for the requested target language." as const };
          }
          taskId = Number(match.id);
          targetLang = normalizeLanguageTag(String(match.target_lang || project.tgt_lang || ""));
        }
      }
    }

    if (!targetLang) targetLang = normalizeLanguageTag(String(project.tgt_lang || ""));
    if (!targetLang) return { error: "targetLang is required" as const };

    return {
      project,
      fileId,
      taskId,
      targetLang
    };
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
        Array.isArray(taskRow.src_runs) && taskRow.src_runs.length > 0
          ? taskRow.src_runs
          : baseRow.src_runs;
      const mergedTgtRuns = taskTgt
        ? Array.isArray(taskRow.tgt_runs) && taskRow.tgt_runs.length > 0
          ? taskRow.tgt_runs
          : baseRow.tgt_runs
        : baseTgt
          ? baseRow.tgt_runs
          : taskRow.tgt_runs ?? baseRow.tgt_runs;
      const taskContext =
        taskRow.segment_context && typeof taskRow.segment_context === "object"
          ? taskRow.segment_context
          : null;
      const baseContext =
        baseRow.segment_context && typeof baseRow.segment_context === "object"
          ? baseRow.segment_context
          : null;
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
      const remaining = Array.from(taskByIndex.values()).sort(
        (a, b) => Number(a.seg_index) - Number(b.seg_index)
      );
      merged.push(...remaining);
    }

    return merged;
  };

  const computeDraftRevisionId = async (params: { projectId: number; fileId: number; taskId: number | null }) => {
    const revisionRes = params.taskId
      ? await db.query<{ max_version: number; count: number; max_updated_at: string | null }>(
          `SELECT
             COALESCE(MAX(version), 0)::int AS max_version,
             COUNT(*)::int AS count,
             MAX(updated_at) AS max_updated_at
           FROM segments
           WHERE project_id = $1 AND task_id = $2`,
          [params.projectId, params.taskId]
        )
      : await db.query<{ max_version: number; count: number; max_updated_at: string | null }>(
          `SELECT
             COALESCE(MAX(version), 0)::int AS max_version,
             COUNT(*)::int AS count,
             MAX(updated_at) AS max_updated_at
           FROM segments
           WHERE project_id = $1 AND file_id = $2 AND task_id IS NULL`,
          [params.projectId, params.fileId]
        );
    const row = revisionRes.rows[0] || { max_version: 0, count: 0, max_updated_at: null };
    const maxUpdatedAtMs = row.max_updated_at ? new Date(row.max_updated_at).getTime() : 0;
    return `${Number(row.max_version ?? 0)}:${Number(row.count ?? 0)}:${Number.isFinite(maxUpdatedAtMs) ? maxUpdatedAtMs : 0}`;
  };

  const findRenderedPreviewArtifactByCacheKey = async (params: {
    projectId: number;
    fileId: number;
    cacheKey: string;
  }) => {
    const res = await db.query<{
      id: number;
      project_id: number;
      file_id: number;
      object_key: string;
      content_type: string | null;
      size_bytes: number | null;
      meta_json: any;
      created_at: string;
    }>(
      `SELECT id, project_id, file_id, object_key, content_type, size_bytes, meta_json, created_at
       FROM file_artifacts
       WHERE project_id = $1
         AND file_id = $2
         AND kind = 'rendered_preview'
         AND COALESCE(meta_json->>'cacheKey', '') = $3
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [params.projectId, params.fileId, params.cacheKey]
    );
    return res.rows[0] ?? null;
  };

  const cleanupOldRenderedPreviewArtifacts = async (fileId: number) => {
    const staleRes = await db.query<{ id: number; object_key: string }>(
      `SELECT id, object_key
       FROM file_artifacts
       WHERE file_id = $1
         AND kind = 'rendered_preview'
         AND created_at < NOW() - ($2::text || ' days')::interval
       LIMIT 200`,
      [fileId, String(RENDERED_PREVIEW_ARTIFACT_TTL_DAYS)]
    );
    if ((staleRes.rowCount ?? 0) <= 0) return;

    const ids: number[] = [];
    for (const row of staleRes.rows) {
      const key = String(row.object_key || "").trim();
      if (key) await deleteObject({ key }).catch(() => {});
      ids.push(Number(row.id));
    }

    if (ids.length > 0) {
      await db.query("DELETE FROM file_artifacts WHERE id = ANY($1::int[])", [ids]);
    }
  };

  const generateRenderedPreviewPayload = async (params: {
    projectId: number;
    fileId: number;
    taskId: number | null;
    targetLang: string;
    previewMethod: string;
  }) => {
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
      [params.projectId, params.fileId]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) throw new Error("Project file not found");

    const originalName = String(fileRow.original_name || "").trim() || `file-${params.fileId}`;
    const fileType = String(fileRow.file_type || "").trim().toLowerCase() || resolveUploadFileType(originalName) || "";
    const outputExtension = resolveOutputExtension(originalName, fileRow.file_type);
    const segments = await loadOutputSegmentsWithTaskFallback({
      projectId: params.projectId,
      fileId: params.fileId,
      taskId: params.taskId
    });
    const lines = segments.map(resolveSegmentText);

    const warnings: string[] = [];
    const logs: string[] = [];
    let methodUsed = params.previewMethod;
    let kind: "pdf" | "images" | "html" | "xml" = "html";
    let contentType = contentTypeForExtension(outputExtension);
    let extension = outputExtension;
    let outBuf: Buffer;

    if (fileType === "html" || [".html", ".htm", ".xhtml", ".xtml"].includes(outputExtension.toLowerCase())) {
      const templateRes = await db.query<{ template: string; markers: string }>(
        `SELECT template, markers
         FROM project_file_html_templates
         WHERE file_id = $1
         LIMIT 1`,
        [params.fileId]
      );
      const templateRow = templateRes.rows[0] as any;
      if (!templateRow) throw new Error("HTML preview is not available because no template was stored for this file.");

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
      const sanitized = sanitizeHtmlForRenderedPreview(content);
      outBuf = Buffer.from(sanitized, "utf8");
      extension = ".html";
      contentType = "text/html";
      methodUsed = "html";
      kind = "html";
    } else if (fileType === "xml" || outputExtension.toLowerCase() === ".xml") {
      if (!fileRow.file_type_config_id) {
        throw new Error("XML preview is not available because the file type configuration is missing.");
      }
      const cfgRes = await db.query<{ config: any }>(
        `SELECT config FROM file_type_configs WHERE id = $1 LIMIT 1`,
        [fileRow.file_type_config_id]
      );
      const cfgRow = cfgRes.rows[0];
      if (!cfgRow) throw new Error("XML preview is not available because the file type configuration is missing.");
      const parsingTemplateId = getFileTypeConfigParsingTemplateId(cfgRow.config, "xml");
      if (!parsingTemplateId) throw new Error("XML preview is not available because the parsing template is missing.");

      const templateRes = await db.query<{ config: any; kind: string }>(
        `SELECT config, kind FROM parsing_templates WHERE id = $1 LIMIT 1`,
        [parsingTemplateId]
      );
      const templateRow = templateRes.rows[0];
      if (!templateRow || String(templateRow.kind || "xml").toLowerCase() !== "xml") {
        throw new Error("XML preview is not available because the parsing template is invalid.");
      }

      const xmlTemplate = normalizeXmlParsingTemplateConfig(templateRow.config);
      const cfgNorm = normalizeJsonObject(cfgRow.config);
      const xmlCfg = normalizeJsonObject(cfgNorm.xml);
      const segmenter = String(xmlCfg.segmenter || "lines").toLowerCase() === "sentences" ? "sentences" : "lines";
      const preserveWhitespace = xmlCfg.preserveWhitespace !== undefined ? Boolean(xmlCfg.preserveWhitespace) : true;

      const storedKey = String(fileRow.stored_path || "").trim();
      if (!storedKey) throw new Error("XML preview is not available because the source file is missing.");
      const { buf: sourceBuffer } = await getObjectBuffer({ key: storedKey });
      const xmlContent = buildXmlOutput({
        sourceBuffer,
        template: xmlTemplate,
        segmenter,
        preserveWhitespace,
        segments
      });

      if (params.previewMethod === "xml_xslt") {
        const settings = getRenderedPreviewSettings(cfgRow.config, "xml");
        if (!settings.xmlXsltTemplateId && !settings.xmlRendererProfileId) {
          warnings.push("No XML XSLT renderer profile is configured. Showing formatted XML output.");
        }
        const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:12px;font-family:Consolas, Menlo, monospace;background:#fff;color:#111;">
    <pre style="white-space:pre-wrap;line-height:1.35;">${escapeXml(xmlContent)}</pre>
  </body>
</html>`;
        outBuf = Buffer.from(html, "utf8");
        extension = ".html";
        contentType = "text/html";
        methodUsed = "xml_xslt";
        kind = "html";
      } else {
        outBuf = Buffer.from(xmlContent, "utf8");
        extension = ".xml";
        contentType = "application/xml";
        methodUsed = "xml_raw_pretty";
        kind = "xml";
      }
    } else if (fileType === "docx" || fileType === "pptx" || fileType === "xlsx") {
      let officeBuf: Buffer;
      const storedKey = String(fileRow.stored_path || "").trim();
      if (!storedKey) throw new Error("Office preview is not available because the source file is missing.");
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
      officeBuf = rebuilt.buffer;
      if (rebuilt.warnings.length > 0) warnings.push(...rebuilt.warnings);
      if (fileType === "docx") {
        extension = ".docx";
        contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (fileType === "pptx") {
        extension = ".pptx";
        contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      } else {
        extension = ".xlsx";
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }

      if (params.previewMethod === "pdf" || params.previewMethod === "images") {
        const conversion = await convertOfficeBufferToPdf({ inputBuffer: officeBuf, inputExtension: extension });
        logs.push(...conversion.logs);
        const fontLogWarnings = conversion.logs.filter(
          (line) => /font/i.test(line) && /(substit|fallback|missing|replace)/i.test(line)
        );
        if (fontLogWarnings.length > 0) {
          warnings.push(...fontLogWarnings.map((line) => `Font substituted: ${line}`));
        }
        if (conversion.ok) {
          outBuf = conversion.pdf;
          extension = ".pdf";
          contentType = "application/pdf";
          methodUsed = "pdf";
          kind = "pdf";
        } else {
          warnings.push(`PDF conversion unavailable: ${conversion.error}`);
          const fallbackHtml = buildOfficeFallbackHtml({
            fileType,
            lines,
            warning: conversion.error || "PDF conversion is unavailable in this environment."
          });
          outBuf = Buffer.from(fallbackHtml, "utf8");
          extension = ".html";
          contentType = "text/html";
          methodUsed = "html";
          kind = "html";
        }
      } else {
        const fallbackHtml = buildOfficeFallbackHtml({
          fileType,
          lines,
          warning: "Preview method is not configured for this file type. Showing a textual fallback."
        });
        outBuf = Buffer.from(fallbackHtml, "utf8");
        extension = ".html";
        contentType = "text/html";
        methodUsed = "html";
        kind = "html";
      }
    } else {
      const fallback = lines.join("\n");
      outBuf = Buffer.from(fallback, "utf8");
      extension = ".txt";
      contentType = "text/plain";
      methodUsed = "html";
      kind = "html";
    }

    const filename = buildTargetFilename(originalName, params.targetLang, extension);
    return {
      outBuf,
      contentType,
      extension,
      filename,
      methodUsed,
      kind,
      warnings,
      logs
    };
  };

  const runRenderedPreviewGenerationJob = async (params: {
    jobId: string;
    cacheKey: string;
    projectId: number;
    fileId: number;
    taskId: number | null;
    targetLang: string;
    previewMethod: string;
    draftRevisionId: string;
    userId: string;
    accessRow: any;
  }) => {
    const job = renderedPreviewJobsById.get(params.jobId);
    if (!job) return;
    job.status = "running";
    job.updatedAtMs = Date.now();

    try {
      const generated = await generateRenderedPreviewPayload({
        projectId: params.projectId,
        fileId: params.fileId,
        taskId: params.taskId,
        targetLang: params.targetLang,
        previewMethod: params.previewMethod
      });

      const departmentId = projectDepartmentId(params.accessRow);
      const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      const objectKey = keyProjectRenderedPreviewRun({
        departmentId,
        projectId: params.projectId,
        fileId: params.fileId,
        targetLang: params.targetLang,
        previewMethod: generated.methodUsed,
        outputExtension: generated.extension,
        runId
      });

      const put = await putObjectBuffer({ key: objectKey, buf: generated.outBuf, contentType: generated.contentType });
      const sha256 = await sha256Hex(generated.outBuf);
      const artifact = await insertFileArtifact(db, {
        projectId: params.projectId,
        fileId: params.fileId,
        kind: "rendered_preview",
        bucket: getS3Bucket(),
        objectKey,
        sha256,
        etag: put.etag,
        sizeBytes: generated.outBuf.length,
        contentType: generated.contentType,
        meta: {
          cacheKey: params.cacheKey,
          draftRevisionId: params.draftRevisionId,
          previewMethodRequested: params.previewMethod,
          previewMethodUsed: generated.methodUsed,
          targetLang: params.targetLang,
          taskId: params.taskId,
          filename: generated.filename,
          kind: generated.kind,
          warnings: generated.warnings,
          logs: generated.logs,
          runId
        },
        createdBy: params.userId
      });

      job.status = "ready";
      job.updatedAtMs = Date.now();
      job.artifactId = Number(artifact.id);
      job.warnings = generated.warnings;
      job.logs = generated.logs;
      job.error = null;
      job.errorDetails = null;

      await cleanupOldRenderedPreviewArtifacts(params.fileId).catch(() => {});
    } catch (err: any) {
      job.status = "error";
      job.updatedAtMs = Date.now();
      job.error = truncateErrorMessage(err?.message || "Rendered preview generation failed.", 500);
      job.errorDetails = err?.stack ? truncateErrorMessage(String(err.stack), 2_000) : null;
      job.warnings = [];
      job.logs = [];
      job.artifactId = null;
    } finally {
      pruneRenderedPreviewJobs();
    }
  };

  // --- EXPORT TARGET FILE (Handler Logic) ---
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
    const job: RenderedPreviewJob = {
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
