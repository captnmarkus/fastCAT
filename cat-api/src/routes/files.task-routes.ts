import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { getRequestUser, requireAuth, requestUserId } from "../middleware/auth.js";
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
  parseSegmentStatus,
  parseSourceType,
  stateFromStatus,
  type SegmentState,
  type SegmentStatus
} from "./files.helpers.js";
import { getRenderedPreviewSettings, normalizeFileType } from "./resources.helpers.js";
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

export function registerTaskFileRoutes(app: FastifyInstance) {
  // --- GET task metadata (editor entry point) ---
  app.get("/tasks/:taskId", { preHandler: [requireAuth] }, async (req, reply) => {
    const taskId = Number((req.params as any).taskId);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return reply.code(400).send({ error: "Invalid taskId" });
    }

    const access = await ensureTaskAccess(taskId, getRequestUser(req), reply);
    if (!access) return;

    const res = await db.query<{
      task_id: number;
      project_id: number;
      file_id: number;
      file_type: string | null;
      file_type_config_id: number | null;
      file_type_config: any;
      target_lang: string;
      translator_user: string;
      reviewer_user: string | null;
      tmx_id: number | null;
      task_status: string | null;
      original_name: string;
      file_created_at: string;
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
      `SELECT t.id AS task_id,
              t.project_id,
              t.file_id,
              f.file_type,
              f.file_type_config_id,
      ft.config AS file_type_config,
      t.target_lang,
      t.translator_user,
      t.reviewer_user,
      t.tmx_id,
      t.status AS task_status,
              f.original_name,
              f.created_at AS file_created_at,
              p.name AS project_name,
              p.src_lang,
              p.tgt_lang,
              p.assigned_user,
              p.created_by,
              COALESCE(s.total, 0)::int AS total,
              COALESCE(s.draft, 0)::int AS draft,
              COALESCE(s.under_review, 0)::int AS under_review,
              COALESCE(s.reviewed, 0)::int AS reviewed
       FROM translation_tasks t
       JOIN project_files f ON f.id = t.file_id
       LEFT JOIN file_type_configs ft ON ft.id = f.file_type_config_id
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN (
         SELECT task_id,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
                COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'approved')::int AS reviewed
         FROM segments
         WHERE task_id = $1
         GROUP BY task_id
       ) s ON s.task_id = t.id
       WHERE t.id = $1
       LIMIT 1`,
      [taskId]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Task not found" });

    const hasHtmlRes = await db.query("SELECT 1 FROM project_file_html_templates WHERE file_id = $1 LIMIT 1", [
      row.file_id
    ]);
    const fileType =
      normalizeFileType(row.file_type) ??
      inferFileTypeFromFilename(String(row.original_name || ""));
    const previewSettings = getRenderedPreviewSettings(row.file_type_config, fileType || "");

    return {
      task: {
        id: Number(row.task_id),
        targetLang: String(row.target_lang || ""),
        assigneeId: String(row.translator_user || ""),
        reviewerUserId: String(row.reviewer_user || "").trim() || null,
        status: String(row.task_status || "draft"),
        tmxId: row.tmx_id != null ? Number(row.tmx_id) : null
      },
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
        tgtLang: String(row.target_lang || ""),
        assignedUser: row.translator_user ?? row.assigned_user ?? row.created_by ?? null
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

  // --- GET task segments (cursor pagination) ---
  app.get("/tasks/:taskId/segments", { preHandler: [requireAuth] }, async (req, reply) => {
    const taskId = Number((req.params as any).taskId);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return reply.code(400).send({ error: "Invalid taskId" });
    }

    const access = await ensureTaskAccess(taskId, getRequestUser(req), reply);
    if (!access) return;

    await ensureTaskSegments(taskId);

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

    const baseConditions = ["task_id = $1"];
    const baseParams: any[] = [taskId];

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

  // --- UPDATE segment (task-scoped) ---
  app.patch("/tasks/:taskId/segments/:segmentId", { preHandler: [requireAuth] }, async (req, reply) => {
    const taskId = Number((req.params as any).taskId);
    const segmentId = Number((req.params as any).segmentId);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return reply.code(400).send({ error: "Invalid taskId" });
    }
    if (!Number.isFinite(segmentId) || segmentId <= 0) {
      return reply.code(400).send({ error: "Invalid segmentId" });
    }

    const access = await ensureTaskAccess(taskId, getRequestUser(req), reply);
    if (!access) return;

    const body = (req.body as any) || {};
    const incomingVersion = Number(body?.version);
    if (!Number.isFinite(incomingVersion)) {
      return reply.code(400).send({
        error: "Missing segment version",
        code: "SEGMENT_VERSION_REQUIRED"
      });
    }
    const taskStatusRes = await db.query<{ status: string | null }>(
      `SELECT status
       FROM translation_tasks
       WHERE id = $1
       LIMIT 1`,
      [taskId]
    );
    const taskStatus = String(taskStatusRes.rows[0]?.status || "").trim().toLowerCase();
    if (taskStatus === "reviewed" || taskStatus === "approved" || taskStatus === "done" || taskStatus === "completed") {
      return reply.code(409).send({
        error: "Task is marked Done and cannot be changed.",
        code: "TASK_READ_ONLY_AFTER_DONE",
        taskStatus: "reviewed"
      });
    }

    const segRes = await db.query<{
      project_id: number;
      file_id: number;
      task_id: number | null;
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
              task_id,
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
       WHERE id = $1 AND task_id = $2
       LIMIT 1`,
      [segmentId, taskId]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Not found" });

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

    const termbase = await loadTermbaseIndex({ projectId: seg.project_id, taskId });
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

    await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = $1`, [taskId, now]);

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

  // --- COMPLETE task (bulk status transition) ---
  app.post("/tasks/:taskId/complete", { preHandler: [requireAuth] }, async (req, reply) => {
    const taskId = Number((req.params as any).taskId);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return reply.code(400).send({ error: "Invalid taskId" });
    }

    const access = await ensureTaskAccess(taskId, getRequestUser(req), reply);
    if (!access) return;

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
           WHERE task_id = $1
             AND status = 'draft'
             AND BTRIM(COALESCE(tgt, '')) <> ''
           RETURNING 1
         )
         SELECT COUNT(*)::int AS updated FROM updated`,
        [taskId, now, userId]
      );

      await db.query(`UPDATE translation_tasks SET status = $2, updated_at = $3 WHERE id = $1`, [
        taskId,
        mode,
        now
      ]);

      req.log.info(
        {
          taskId,
          mode,
          updated: Number(result.rows[0]?.updated ?? 0) || 0
        },
        "Task completion applied"
      );

      return {
        ok: true,
        mode,
        updated: Number(result.rows[0]?.updated ?? 0) || 0
      };
    }

    const counts = await getSegmentCompletionCounts(db, { kind: "task", id: taskId });
    const completionGuard = validateReviewedCompletion({ kind: "task", id: taskId }, counts);
    if (!completionGuard.ok) {
      req.log.info(
        { taskId, mode, code: completionGuard.code, details: completionGuard.details },
        "Task completion blocked"
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
         WHERE task_id = $1
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
      [taskId, now, userId]
    );

    await db.query(`UPDATE translation_tasks SET status = $2, updated_at = $3 WHERE id = $1`, [
      taskId,
      mode,
      now
    ]);

    req.log.info(
      {
        taskId,
        mode,
        updated: Number(result.rows[0]?.updated ?? 0) || 0,
        logged: Number(result.rows[0]?.logged ?? 0) || 0
      },
      "Task completion applied"
    );

    return {
      ok: true,
      mode,
      updated: Number(result.rows[0]?.updated ?? 0) || 0,
      logged: Number(result.rows[0]?.logged ?? 0) || 0
    };
  });
}

