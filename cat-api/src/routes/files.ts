import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import {
  ensureProjectAccess,
  ensureProjectReady,
  getRequestUser,
  requireAuth,
  requestUserId
} from "../middleware/auth.js";
import { addFileToAssigned, touchProjectForUsers } from "../lib/user-buckets.js";
import {
  computeSegmentIssues,
  mapStateToStatus,
  normalizeSegmentState
} from "../lib/segment-issues.js";
import {
  getSegmentCompletionCounts,
  validateReviewedCompletion
} from "../lib/segment-completion.js";
import {
  canTransitionSegmentStatus,
  clampInt,
  coerceSegmentState,
  coerceSegmentStatus,
  coerceSourceType,
  ensureTaskAccess,
  ensureTaskSegments,
  isBlank,
  loadTermbaseIndex,
  normalizeIssueDetails,
  normalizeIssueSummary,
  parseBool,
  parseSourceType,
  parseSegmentStatus,
  stateFromStatus,
  type SegmentState,
  type SegmentStatus
} from "./files.helpers.js";
import { getRenderedPreviewSettings, normalizeFileType } from "./resources.helpers.js";
import { registerTaskFileRoutes } from "./files.task-routes.js";
import {
  normalizeOriginDetails,
  normalizeRichTextRuns,
  normalizeSegmentContext,
  projectTextToTemplateRuns,
  runsToPlainText
} from "../lib/rich-text.js";

function inferFileTypeFromFilename(filename: string): string | null {
  const normalized = String(filename || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.endsWith(".docx")) return "docx";
  if (normalized.endsWith(".pptx")) return "pptx";
  if (normalized.endsWith(".xlsx")) return "xlsx";
  if (normalized.endsWith(".xml")) return "xml";
  if (normalized.endsWith(".xhtml") || normalized.endsWith(".html") || normalized.endsWith(".htm") || normalized.endsWith(".xtml")) {
    return "html";
  }
  if (normalized.endsWith(".pdf")) return "pdf";
  return null;
}

export async function filesRoutes(app: FastifyInstance) {
  // --- GET file metadata (editor entry point) ---
  app.get("/files/:fileId", { preHandler: [requireAuth] }, async (req, reply) => {
    const fileId = Number((req.params as any).fileId);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid fileId" });
    }

    const res = await db.query<{
      file_id: number;
      original_name: string;
      file_type: string | null;
      file_type_config_id: number | null;
      file_type_config: any;
      file_created_at: string;
      project_id: number;
      project_name: string;
      src_lang: string;
      tgt_lang: string;
      assigned_user: string | null;
      created_by: string | null;
      total: number;
      draft: number;
      under_review: number;
      reviewed: number;
    }>(
      `SELECT f.id AS file_id,
              f.original_name,
              f.file_type,
              f.file_type_config_id,
              ft.config AS file_type_config,
              f.created_at AS file_created_at,
              p.id AS project_id,
              p.name AS project_name,
              p.src_lang,
              p.tgt_lang,
              p.assigned_user,
              p.created_by,
              COALESCE(s.total, 0)::int AS total,
              COALESCE(s.draft, 0)::int AS draft,
              COALESCE(s.under_review, 0)::int AS under_review,
              COALESCE(s.reviewed, 0)::int AS reviewed
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
       LEFT JOIN file_type_configs ft ON ft.id = f.file_type_config_id
      LEFT JOIN (
        SELECT file_id,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
               COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
               COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
        FROM segments
        WHERE file_id = $1 AND task_id IS NULL
        GROUP BY file_id
      ) s ON s.file_id = f.id
       WHERE f.id = $1
       LIMIT 1`,
      [fileId]
    );

    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "File not found" });

    const accessRow = await ensureProjectAccess(row.project_id, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    const hasHtmlRes = await db.query("SELECT 1 FROM project_file_html_templates WHERE file_id = $1 LIMIT 1", [
      fileId
    ]);
    const fileType =
      normalizeFileType(row.file_type) ??
      inferFileTypeFromFilename(String(row.original_name || ""));
    const previewSettings = getRenderedPreviewSettings(row.file_type_config, fileType || "");

    return {
      file: {
        id: Number(row.file_id),
        originalFilename: String(row.original_name || ""),
        createdAt: row.file_created_at ? new Date(row.file_created_at).toISOString() : null,
        fileType: fileType,
        fileTypeConfigId: row.file_type_config_id != null ? Number(row.file_type_config_id) : null
      },
      project: {
        id: Number(row.project_id),
        name: String(row.project_name || ""),
        srcLang: String(row.src_lang || ""),
        tgtLang: String(row.tgt_lang || ""),
        assignedUser: row.assigned_user ?? row.created_by ?? null
      },
      segmentStats: {
        total: Number(row.total ?? 0) || 0,
        draft: Number(row.draft ?? 0) || 0,
        under_review: Number(row.under_review ?? 0) || 0,
        reviewed: Number(row.reviewed ?? 0) || 0
      },
      renderedPreview: {
        supported: Boolean(previewSettings.supportsRenderedPreview && fileType),
        method: previewSettings.renderedPreviewMethod ?? null,
        defaultOn: Boolean(previewSettings.renderedPreviewDefaultOn),
        xmlXsltTemplateId: previewSettings.xmlXsltTemplateId ?? null,
        xmlRendererProfileId: previewSettings.xmlRendererProfileId ?? null
      },
      hasHtmlExport: (hasHtmlRes.rowCount ?? 0) > 0
    };
  });

  // --- GET segments (cursor pagination for large files) ---
  app.get("/files/:fileId/segments", { preHandler: [requireAuth] }, async (req, reply) => {
    const fileId = Number((req.params as any).fileId);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid fileId" });
    }

    const fileRes = await db.query<{ project_id: number }>(
      "SELECT project_id FROM project_files WHERE id = $1 LIMIT 1",
      [fileId]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) return reply.code(404).send({ error: "File not found" });

    const accessRow = await ensureProjectAccess(Number(fileRow.project_id), getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    const query = (req.query as any) || {};
    const cursorRaw = query.cursor;
    const cursor = cursorRaw == null || String(cursorRaw).trim() === "" ? -1 : Number(cursorRaw);
    const limit = clampInt(Number(query.limit ?? 250), 25, 500);

    const stateRaw = query.state ?? query.states ?? "";
    const stateList = String(stateRaw || "")
      .split(",")
      .map((value) => normalizeSegmentState(value))
      .filter(Boolean) as SegmentState[];
    const hasIssues = parseBool(query.hasIssues ?? query.has_issues);
    const severity = String(query.severity ?? "").trim().toLowerCase();
    const search = String(query.search ?? query.q ?? "").trim();

    const baseConditions = ["file_id = $1", "task_id IS NULL"];
    const baseParams: any[] = [fileId];

    if (stateList.length > 0) {
      baseParams.push(stateList);
      baseConditions.push(`state = ANY($${baseParams.length})`);
    }

    if (hasIssues != null) {
      baseConditions.push(
        hasIssues
          ? "(COALESCE((issue_summary->>'error')::int,0) + COALESCE((issue_summary->>'warning')::int,0)) > 0"
          : "(COALESCE((issue_summary->>'error')::int,0) + COALESCE((issue_summary->>'warning')::int,0)) = 0"
      );
    }

    if (severity === "error") {
      baseConditions.push("COALESCE((issue_summary->>'error')::int,0) > 0");
    } else if (severity === "warning") {
      baseConditions.push("COALESCE((issue_summary->>'warning')::int,0) > 0");
    }

    if (search) {
      baseParams.push(`%${search}%`);
      baseConditions.push(`(src ILIKE $${baseParams.length} OR tgt ILIKE $${baseParams.length})`);
    }

    const baseWhere = baseConditions.join(" AND ");

    const totalRes = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM segments WHERE ${baseWhere}`,
      baseParams
    );
    const total = Number(totalRes.rows[0]?.total ?? 0) || 0;

    const segConditions = [...baseConditions, `seg_index > $${baseParams.length + 1}`];
    const segParams = [...baseParams, Number.isFinite(cursor) ? cursor : -1, limit];
    const limitParam = segParams.length;

    const segRes = await db.query<{
      id: number;
      seg_index: number;
      src: string;
      tgt: string | null;
      src_runs: any;
      tgt_runs: any;
      segment_context: any;
      origin_details: any;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      issue_summary: any;
      issue_details: any;
      version: number;
      is_locked: boolean | null;
      source_type: string | null;
      source_score: number | null;
      source_match_id: string | null;
    }>(
      `SELECT id,
              seg_index,
              src,
              tgt,
              src_runs,
              tgt_runs,
              segment_context,
              origin_details,
              status,
              state,
              generated_by_llm,
              qe_score,
              issue_summary,
              issue_details,
              version,
              is_locked,
              source_type,
              source_score,
              source_match_id
       FROM segments
       WHERE ${segConditions.join(" AND ")}
       ORDER BY seg_index ASC
       LIMIT $${limitParam}`,
      segParams
    );

    const segments = segRes.rows.map((s) => ({
      id: Number(s.id),
      index: Number(s.seg_index),
      src: String(s.src || ""),
      tgt: s.tgt ?? null,
      srcRuns: normalizeRichTextRuns(s.src_runs, String(s.src || "")),
      tgtRuns: normalizeRichTextRuns(s.tgt_runs, String(s.tgt ?? "")),
      segmentContext: normalizeSegmentContext(s.segment_context ?? {}),
      originDetails: normalizeOriginDetails(s.origin_details ?? {}),
      status: coerceSegmentStatus(s.status),
      state: coerceSegmentState(s.state, coerceSegmentStatus(s.status)),
      generatedByLlm: Boolean(s.generated_by_llm),
      qeScore: s.qe_score == null ? null : Number(s.qe_score),
      issueSummary: normalizeIssueSummary(s.issue_summary),
      issues: normalizeIssueDetails(s.issue_details),
      version: Number(s.version ?? 0) || 0,
      isLocked: Boolean(s.is_locked),
      sourceType: coerceSourceType(s.source_type),
      sourceScore:
        s.source_score == null ? null : Number.isFinite(Number(s.source_score)) ? Number(s.source_score) : null,
      sourceMatchId: s.source_match_id ?? null
    }));

    const nextCursor = segments.length > 0 ? segments[segments.length - 1]!.index : null;

    return {
      segments,
      total,
      nextCursor
    };
  });

  // --- UPDATE SEGMENT (file-scoped alias for editor) ---
  app.patch("/files/:fileId/segments/:segmentId", { preHandler: [requireAuth] }, async (req, reply) => {
    const fileId = Number((req.params as any).fileId);
    const segmentId = Number((req.params as any).segmentId);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid fileId" });
    }
    if (!Number.isFinite(segmentId) || segmentId <= 0) {
      return reply.code(400).send({ error: "Invalid segmentId" });
    }

    const body = (req.body as any) || {};
    const incomingVersion = Number(body?.version);
    if (!Number.isFinite(incomingVersion)) {
      return reply.code(400).send({
        error: "Missing segment version",
        code: "SEGMENT_VERSION_REQUIRED"
      });
    }

    const segRes = await db.query<{
      project_id: number;
      file_id: number;
      src: string;
      tgt: string | null;
      src_runs: any;
      tgt_runs: any;
      segment_context: any;
      origin_details: any;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      issue_summary: any;
      issue_details: any;
      source_type: string | null;
      is_locked: boolean | null;
      version: number;
    }>(
      `SELECT project_id,
              file_id,
              src,
              tgt,
              src_runs,
              tgt_runs,
              segment_context,
              origin_details,
              status,
              state,
              generated_by_llm,
              qe_score,
              issue_summary,
              issue_details,
              source_type,
              is_locked,
              version
       FROM segments
       WHERE id = $1 AND task_id IS NULL
       LIMIT 1`,
      [segmentId]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Not found" });
    if (Number(seg.file_id) !== Number(fileId)) {
      return reply.code(404).send({ error: "Not found" });
    }

    const projectRow = await ensureProjectAccess(seg.project_id, getRequestUser(req), reply);
    if (!projectRow) return;
    if (!ensureProjectReady(projectRow, reply)) return;

    const currentVersion = Number(seg.version ?? 0);
    if (incomingVersion !== currentVersion) {
      return reply.code(409).send({
        error: "Segment has been modified by someone else.",
        code: "SEGMENT_VERSION_CONFLICT",
        currentVersion
      });
    }

    const now = new Date().toISOString();
    const userId = requestUserId(getRequestUser(req)) ?? "system";
    const currentStatus = coerceSegmentStatus(seg.status);
    const currentState = coerceSegmentState(seg.state, currentStatus);
    const hasIsLocked =
      Object.prototype.hasOwnProperty.call(body, "isLocked") ||
      Object.prototype.hasOwnProperty.call(body, "is_locked") ||
      Object.prototype.hasOwnProperty.call(body, "locked");
    const parsedIsLocked = hasIsLocked
      ? parseBool(body?.isLocked ?? body?.is_locked ?? body?.locked)
      : null;
    if (hasIsLocked && parsedIsLocked == null) {
      return reply.code(400).send({
        error: "Invalid segment lock state.",
        code: "SEGMENT_LOCK_INVALID"
      });
    }
    const unlocking = hasIsLocked && parsedIsLocked === false;

    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
    const requestedStatusRaw = hasStatus ? body?.status : null;
    const parsedStatus = hasStatus ? parseSegmentStatus(requestedStatusRaw) : currentStatus;
    const hasState = Object.prototype.hasOwnProperty.call(body, "state");
    const requestedState = hasState ? normalizeSegmentState(body?.state) : null;
    if (hasState && !requestedState) {
      return reply.code(400).send({
        error: "Invalid segment state.",
        code: "SEGMENT_STATE_INVALID"
      });
    }
    const requestedStatus = hasStatus
      ? parsedStatus
      : requestedState
      ? mapStateToStatus(requestedState)
      : parsedStatus;
    if (!requestedStatus) {
      return reply.code(400).send({
        error: "Invalid segment status.",
        code: "SEGMENT_STATUS_INVALID"
      });
    }
    if (!canTransitionSegmentStatus(currentStatus, requestedStatus)) {
      return reply.code(400).send({
        error: `Invalid segment status transition: ${currentStatus} -> ${requestedStatus}.`,
        code: "SEGMENT_STATUS_INVALID_TRANSITION",
        currentStatus,
        requestedStatus
      });
    }

    const hasSourceType = Object.prototype.hasOwnProperty.call(body, "sourceType");
    const parsedSourceType = hasSourceType ? parseSourceType(body?.sourceType) : null;
    if (hasSourceType && !parsedSourceType) {
      return reply.code(400).send({
        error: "Invalid segment source type.",
        code: "SEGMENT_SOURCE_TYPE_INVALID"
      });
    }

    const hasSourceScore = Object.prototype.hasOwnProperty.call(body, "sourceScore");
    let nextSourceScore: number | null = null;
    if (hasSourceScore) {
      if (body?.sourceScore == null || String(body?.sourceScore).trim() === "") {
        nextSourceScore = null;
      } else {
        const parsedScore = Number(body?.sourceScore);
        if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) {
          return reply.code(400).send({
            error: "Invalid segment source score.",
            code: "SEGMENT_SOURCE_SCORE_INVALID"
          });
        }
        nextSourceScore = Math.round(parsedScore);
      }
    }

    const hasSourceMatchId = Object.prototype.hasOwnProperty.call(body, "sourceMatchId");
    const nextSourceMatchId = hasSourceMatchId
      ? String(body?.sourceMatchId ?? "").trim() || null
      : null;

    const hasTarget = Object.prototype.hasOwnProperty.call(body, "tgt");
    let nextTarget = hasTarget ? body?.tgt ?? null : seg.tgt ?? null;
    const hasTargetRuns =
      Object.prototype.hasOwnProperty.call(body, "tgtRuns") ||
      Object.prototype.hasOwnProperty.call(body, "targetRuns");
    const incomingTargetRuns = hasTargetRuns
      ? normalizeRichTextRuns(body?.tgtRuns ?? body?.targetRuns, hasTarget ? String(nextTarget ?? "") : String(seg.tgt ?? ""))
      : normalizeRichTextRuns(seg.tgt_runs, String(seg.tgt ?? ""));
    const sourceRuns = normalizeRichTextRuns(seg.src_runs, String(seg.src ?? ""));
    let nextTargetRuns = incomingTargetRuns;
    if (!hasTargetRuns && hasTarget) {
      nextTargetRuns = projectTextToTemplateRuns({
        text: String(nextTarget ?? ""),
        templateRuns: incomingTargetRuns,
        fallbackRuns: sourceRuns
      });
    }
    if (hasTargetRuns && !hasTarget) {
      nextTarget = runsToPlainText(nextTargetRuns);
    }
    const nextTargetText = String(nextTarget ?? "");
    if (nextTargetText) {
      if (runsToPlainText(nextTargetRuns) !== nextTargetText) {
        nextTargetRuns = projectTextToTemplateRuns({
          text: nextTargetText,
          templateRuns: nextTargetRuns,
          fallbackRuns: sourceRuns
        });
      }
    } else {
      nextTargetRuns = [];
    }

    const hasOriginDetails = Object.prototype.hasOwnProperty.call(body, "originDetails");
    const nextOriginDetails = hasOriginDetails
      ? normalizeOriginDetails(body?.originDetails)
      : normalizeOriginDetails(seg.origin_details ?? {});

    const hasQeScore = Object.prototype.hasOwnProperty.call(body, "qeScore");
    let nextQeScore = seg.qe_score ?? null;
    if (hasQeScore) {
      if (body?.qeScore == null || String(body?.qeScore).trim() === "") {
        nextQeScore = null;
      } else {
        const parsed = Number(body?.qeScore);
        if (!Number.isFinite(parsed)) {
          return reply.code(400).send({
            error: "Invalid QE score.",
            code: "SEGMENT_QE_SCORE_INVALID"
          });
        }
        nextQeScore = parsed;
      }
    }

    const hasGeneratedByLlm = Object.prototype.hasOwnProperty.call(body, "generatedByLlm");
    let nextGeneratedByLlm = hasGeneratedByLlm ? Boolean(body?.generatedByLlm) : Boolean(seg.generated_by_llm);

    if (parsedSourceType === "nmt") {
      nextGeneratedByLlm = true;
    }

    const termbase = await loadTermbaseIndex({ projectId: seg.project_id });
    const { issues, summary } = computeSegmentIssues({ src: seg.src, tgt: nextTarget, termbase });
    const forceReviewed = requestedState === "reviewed" || body?.forceReviewed === true || body?.markReviewed === true;
    const engineSeeded = hasGeneratedByLlm && nextGeneratedByLlm;
    const targetChanged = hasTarget && String(nextTarget ?? "") !== String(seg.tgt ?? "");

    let nextState: SegmentState = requestedState ?? (hasStatus ? stateFromStatus(requestedStatus) : currentState);
    if (unlocking) {
      nextState = "draft";
    } else if (forceReviewed) {
      nextState = "reviewed";
    } else if (targetChanged) {
      nextState = engineSeeded ? "nmt_draft" : "draft";
    }

    const finalStatus =
      hasStatus && requestedStatus === "under_review" && nextState !== "reviewed"
        ? "under_review"
        : mapStateToStatus(nextState);
    if (finalStatus === "reviewed" && isBlank(nextTarget)) {
      return reply.code(400).send({
        error: "Cannot mark a segment as reviewed with an empty target.",
        code: "SEGMENT_TARGET_REQUIRED_FOR_REVIEWED"
      });
    }

    const autoLock = !unlocking && nextState === "reviewed";
    const applyIsLocked = hasIsLocked || autoLock;
    const nextIsLocked = hasIsLocked ? Boolean(parsedIsLocked) : autoLock ? true : Boolean(seg.is_locked);

    const updateRes = await db.query<{ version: number }>(
      `UPDATE segments
       SET tgt = $1,
           tgt_runs = $2,
           status = $3,
           state = $4,
           is_locked = CASE WHEN $5 THEN $6 ELSE is_locked END,
           generated_by_llm = $7,
           qe_score = $8,
           issue_summary = $9,
           issue_details = $10,
           source_type = CASE WHEN $11 THEN $12 ELSE source_type END,
           source_score = CASE WHEN $13 THEN $14 ELSE source_score END,
           source_match_id = CASE WHEN $15 THEN $16 ELSE source_match_id END,
           origin_details = CASE WHEN $17 THEN $18 ELSE origin_details END,
           updated_by = $19,
           updated_at = $20,
           version = version + 1
       WHERE id = $21 AND version = $22
       RETURNING version`,
      [
        nextTarget,
        JSON.stringify(nextTargetRuns),
        finalStatus,
        nextState,
        applyIsLocked,
        nextIsLocked,
        nextGeneratedByLlm,
        nextQeScore,
        JSON.stringify(summary),
        JSON.stringify(issues),
        hasSourceType,
        parsedSourceType,
        hasSourceScore,
        nextSourceScore,
        hasSourceMatchId,
        nextSourceMatchId,
        hasOriginDetails,
        JSON.stringify(nextOriginDetails),
        userId,
        now,
        segmentId,
        currentVersion
      ]
    );

    if (updateRes.rowCount === 0) {
      return reply.code(409).send({
        error: "Segment has been modified by someone else.",
        code: "SEGMENT_VERSION_CONFLICT",
        currentVersion
      });
    }

    const shouldLogFinalization =
      currentState !== "reviewed" && nextState === "reviewed";
    if (shouldLogFinalization) {
      await db.query(
        `INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [segmentId, seg.tgt ?? null, nextTarget, userId, now]
      );
    }

    try {
      const createdBy = (projectRow as any).created_by ? String((projectRow as any).created_by) : null;
      const assignedUserRaw = (projectRow as any).assigned_user ? String((projectRow as any).assigned_user) : null;
      const assignedUser = assignedUserRaw || createdBy;
      const nowMs = Date.now();
      if (createdBy) await addFileToAssigned(createdBy, fileId, nowMs);
      if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, fileId, nowMs);
      await touchProjectForUsers({ projectId: seg.project_id, createdBy, assignedUser, updatedAtMs: nowMs });
    } catch {
      /* ignore redis errors */
    }

    return {
      ok: true,
      version: updateRes.rows[0]?.version ?? currentVersion + 1,
      status: finalStatus,
      state: nextState,
      isLocked: nextIsLocked,
      generatedByLlm: nextGeneratedByLlm,
      qeScore: nextQeScore,
      tgtRuns: nextTargetRuns,
      originDetails: nextOriginDetails,
      issueSummary: summary,
      issues
    };
  });

  // --- COMPLETE file (bulk status transition for speed) ---
  app.post("/files/:fileId/complete", { preHandler: [requireAuth] }, async (req, reply) => {
    const fileId = Number((req.params as any).fileId);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid fileId" });
    }

    const fileRes = await db.query<{ project_id: number }>(
      "SELECT project_id FROM project_files WHERE id = $1 LIMIT 1",
      [fileId]
    );
    const fileRow = fileRes.rows[0];
    if (!fileRow) return reply.code(404).send({ error: "File not found" });

    const projectRow = await ensureProjectAccess(Number(fileRow.project_id), getRequestUser(req), reply);
    if (!projectRow) return;
    if (!ensureProjectReady(projectRow, reply)) return;

    const body = (req.body as any) || {};
    const mode = String(body?.mode || "").trim().toLowerCase();
    if (mode !== "under_review" && mode !== "reviewed") {
      return reply.code(400).send({ error: "mode must be under_review or reviewed" });
    }

    const now = new Date().toISOString();
    const userId = requestUserId(getRequestUser(req)) ?? "system";

    if (mode === "under_review") {
      const result = await db.query<{ updated: number }>(
         `WITH updated AS (
         UPDATE segments
         SET status = 'under_review',
             updated_by = $3,
             updated_at = $2,
             version = version + 1
         WHERE file_id = $1
           AND task_id IS NULL
           AND status = 'draft'
           AND BTRIM(COALESCE(tgt, '')) <> ''
           RETURNING 1
         )
         SELECT COUNT(*)::int AS updated FROM updated`,
        [fileId, now, userId]
      );

      try {
        const createdBy = (projectRow as any).created_by ? String((projectRow as any).created_by) : null;
        const assignedUserRaw = (projectRow as any).assigned_user ? String((projectRow as any).assigned_user) : null;
        const assignedUser = assignedUserRaw || createdBy;
        const nowMs = Date.now();
        if (createdBy) await addFileToAssigned(createdBy, fileId, nowMs);
        if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, fileId, nowMs);
        await touchProjectForUsers({ projectId: Number(fileRow.project_id), createdBy, assignedUser, updatedAtMs: nowMs });
      } catch {
        /* ignore redis errors */
      }

      return {
        ok: true,
        mode,
        updated: Number(result.rows[0]?.updated ?? 0) || 0
      };
    }

    const counts = await getSegmentCompletionCounts(db, { kind: "file", id: fileId });
    const completionGuard = validateReviewedCompletion({ kind: "file", id: fileId }, counts);
    if (!completionGuard.ok) {
      req.log.info(
        { fileId, mode, code: completionGuard.code, details: completionGuard.details },
        "File completion blocked"
      );
      return reply.code(409).send({
        error: completionGuard.error,
        code: completionGuard.code,
        details: completionGuard.details
      });
    }

    const result = await db.query<{ updated: number; logged: number }>(
      `WITH to_review AS (
         SELECT id, tgt
         FROM segments
       WHERE file_id = $1
         AND task_id IS NULL
         AND status = 'under_review'
         AND BTRIM(COALESCE(tgt, '')) <> ''
       ),
         updated AS (
           UPDATE segments s
           SET status = 'reviewed',
               state = 'reviewed',
               is_locked = TRUE,
               updated_by = $3,
               updated_at = $2,
               version = version + 1
         FROM to_review r
         WHERE s.id = r.id
         RETURNING s.id, r.tgt AS old_tgt, s.tgt AS new_tgt
       ),
       history AS (
         INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
         SELECT id, old_tgt, new_tgt, $3, $2
         FROM updated
         RETURNING 1
       )
       SELECT
         (SELECT COUNT(*)::int FROM updated) AS updated,
         (SELECT COUNT(*)::int FROM history) AS logged`,
      [fileId, now, userId]
    );

    try {
      const createdBy = (projectRow as any).created_by ? String((projectRow as any).created_by) : null;
      const assignedUserRaw = (projectRow as any).assigned_user ? String((projectRow as any).assigned_user) : null;
      const assignedUser = assignedUserRaw || createdBy;
      const nowMs = Date.now();
      if (createdBy) await addFileToAssigned(createdBy, fileId, nowMs);
      if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, fileId, nowMs);
      await touchProjectForUsers({ projectId: Number(fileRow.project_id), createdBy, assignedUser, updatedAtMs: nowMs });
    } catch {
      /* ignore redis errors */
    }

    req.log.info(
      {
        fileId,
        mode,
        updated: Number(result.rows[0]?.updated ?? 0) || 0,
        logged: Number(result.rows[0]?.logged ?? 0) || 0
      },
      "File completion applied"
    );

    return {
      ok: true,
      mode,
      updated: Number(result.rows[0]?.updated ?? 0) || 0,
      logged: Number(result.rows[0]?.logged ?? 0) || 0
    };
  });
  registerTaskFileRoutes(app);
}

