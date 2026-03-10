import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import {
  requireAuth,
  ensureProjectAccess,
  ensureProjectReady,
  getRequestUser,
  requestUserId
} from "../middleware/auth.js";
import { addFileToAssigned, touchProjectForUsers } from "../lib/user-buckets.js";
import {
  computeSegmentIssues,
  mapStateToStatus,
  normalizeSegmentState,
  type IssueSummary,
  type SegmentIssue,
  type SegmentState,
  type TermbaseIndex
} from "../lib/segment-issues.js";
import {
  normalizeOriginDetails,
  normalizeRichTextRuns,
  projectTextToTemplateRuns,
  runsToPlainText
} from "../lib/rich-text.js";
import {
  broadcast,
  canTransitionSegmentStatus,
  coerceSegmentState,
  coerceSegmentStatus,
  isBlank,
  loadTermbaseIndex,
  normalizeIdList,
  parseBool,
  parseSegmentStatus,
  parseSourceType,
  QE_REVIEW_THRESHOLD,
  stateFromStatus,
  type SegmentStatus
} from "./segments.shared.js";

export async function registerSegmentMutationRoutes(app: FastifyInstance) {
  // UPDATE SEGMENT
  app.post("/segments/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const sid = Number((req.params as any).id);
    const body = req.body as any;
    
    // Check access via JOIN
    const segRes = await db.query<{
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      src_runs: any;
      tgt_runs: any;
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
       WHERE id = $1`,
      [sid]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Not found" });
    const projectRow = await ensureProjectAccess(seg.project_id, getRequestUser(req), reply);
    if (!projectRow) return;
    if (!ensureProjectReady(projectRow, reply)) return;
    const incomingVersion = Number(body?.version);
    if (!Number.isFinite(incomingVersion)) {
      return reply.code(400).send({ error: "Missing segment version", code: "SEGMENT_VERSION_REQUIRED" });
    }
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

    const termbase = await loadTermbaseIndex({ projectId: seg.project_id, taskId: seg.task_id });
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
        sid,
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
        [sid, seg.tgt ?? null, nextTarget, userId, now]
      );
    }

    if (seg.task_id != null) {
      await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = $1`, [seg.task_id, now]);
    }

    broadcast("segment:update", { segmentId: sid });

    try {
      const createdBy = (projectRow as any).created_by ? String((projectRow as any).created_by) : null;
      const assignedUserRaw = (projectRow as any).assigned_user ? String((projectRow as any).assigned_user) : null;
      const assignedUser = assignedUserRaw || createdBy;
      const nowMs = Date.now();
      if (createdBy) await addFileToAssigned(createdBy, seg.file_id, nowMs);
      if (assignedUser && assignedUser !== createdBy) await addFileToAssigned(assignedUser, seg.file_id, nowMs);
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

  app.get("/segments/:id/history", { preHandler: [requireAuth] }, async (req, reply) => {
    const sid = Number((req.params as any).id);
    if (!Number.isFinite(sid) || sid <= 0) {
      return reply.code(400).send({ error: "Invalid segment id." });
    }
    const limitRaw = Number((req.query as any)?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;

    const segRes = await db.query<{
      id: number;
      project_id: number;
      seg_index: number;
      file_id: number;
      task_id: number | null;
    }>(
      `SELECT id, project_id, seg_index, file_id, task_id
       FROM segments
       WHERE id = $1
       LIMIT 1`,
      [sid]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Segment not found" });
    const accessRow = await ensureProjectAccess(seg.project_id, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    const historyRes = await db.query<{
      id: number;
      old_tgt: string | null;
      new_tgt: string | null;
      updated_by: string | null;
      created_at: string;
    }>(
      `SELECT id, old_tgt, new_tgt, updated_by, created_at
       FROM segment_history
       WHERE segment_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sid, limit]
    );

    return {
      segmentId: sid,
      segmentNo: Number(seg.seg_index) + 1,
      entries: historyRes.rows.map((row) => ({
        id: row.id,
        oldTgt: row.old_tgt ?? "",
        newTgt: row.new_tgt ?? "",
        updatedBy: row.updated_by ?? null,
        createdAt: row.created_at
      }))
    };
  });

  // BULK: recompute QA issues
  app.post("/segments/recompute-issues", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const segmentIds = normalizeIdList(body.segmentIds ?? body.segment_ids);
    const taskId = Number(body.taskId ?? body.task_id);
    const fileId = Number(body.fileId ?? body.file_id);
    const user = getRequestUser(req);

    let rows: Array<{
      id: number;
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      issue_summary: any;
      issue_details: any;
    }> = [];

    if (segmentIds.length > 0) {
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                issue_summary,
                issue_details
         FROM segments
         WHERE id = ANY($1::int[])`,
        [segmentIds]
      );
      rows = res.rows as typeof rows;
      if (rows.length === 0) return reply.code(404).send({ error: "Segments not found." });
      const projectIds = Array.from(new Set(rows.map((row) => row.project_id)));
      if (projectIds.length > 1) {
        return reply.code(400).send({ error: "Segments must belong to the same project." });
      }
      const accessRow = await ensureProjectAccess(projectIds[0]!, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
    } else if (Number.isFinite(taskId) && taskId > 0) {
      const taskRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM translation_tasks WHERE id = $1 LIMIT 1`,
        [taskId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      const accessRow = await ensureProjectAccess(taskRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                issue_summary,
                issue_details
         FROM segments
         WHERE task_id = $1
         ORDER BY seg_index`,
        [taskId]
      );
      rows = res.rows as typeof rows;
    } else if (Number.isFinite(fileId) && fileId > 0) {
      const fileRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM project_files WHERE id = $1 LIMIT 1`,
        [fileId]
      );
      const fileRow = fileRes.rows[0];
      if (!fileRow) return reply.code(404).send({ error: "File not found" });
      const accessRow = await ensureProjectAccess(fileRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                issue_summary,
                issue_details
         FROM segments
         WHERE file_id = $1 AND task_id IS NULL
         ORDER BY seg_index`,
        [fileId]
      );
      rows = res.rows as typeof rows;
    } else {
      return reply.code(400).send({ error: "Provide segmentIds, taskId, or fileId." });
    }

    if (rows.length === 0) {
      return { ok: true, updated: 0, segments: [] };
    }

    const termbaseCache = new Map<string, TermbaseIndex | null>();
    const updated: Array<{
      id: number;
      status: SegmentStatus;
      state: SegmentState;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
    }> = [];

    for (const row of rows) {
      const cacheKey = `${row.project_id}:${row.task_id ?? "none"}`;
      let termbase = termbaseCache.get(cacheKey);
      if (termbase === undefined) {
        termbase = await loadTermbaseIndex({ projectId: row.project_id, taskId: row.task_id });
        termbaseCache.set(cacheKey, termbase ?? null);
      }
      const { issues, summary } = computeSegmentIssues({
        src: row.src,
        tgt: row.tgt,
        termbase: termbase ?? null
      });
      await db.query(
        `UPDATE segments
         SET issue_summary = $2,
             issue_details = $3
         WHERE id = $1`,
        [row.id, JSON.stringify(summary), JSON.stringify(issues)]
      );
      const status = coerceSegmentStatus(row.status);
      const state = coerceSegmentState(row.state, status);
      updated.push({ id: row.id, status, state, issueSummary: summary, issues });
    }

    return { ok: true, updated: updated.length, segments: updated };
  });

  // BULK: mark reviewed (segments list)
  app.post("/segments/mark-reviewed", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const segmentIds = normalizeIdList(body.segmentIds ?? body.segment_ids);
    if (segmentIds.length === 0) {
      return reply.code(400).send({ error: "segmentIds must be provided." });
    }
    const forceReviewed = body.forceReviewed === true || body.force === true;
    const user = getRequestUser(req);

    const segRes = await db.query<{
      id: number;
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      issue_summary: any;
      issue_details: any;
      is_locked: boolean | null;
      version: number;
    }>(
      `SELECT id,
              project_id,
              file_id,
              task_id,
              src,
              tgt,
              status,
              state,
              generated_by_llm,
              qe_score,
              issue_summary,
              issue_details,
              is_locked,
              version
       FROM segments
       WHERE id = ANY($1::int[])`,
      [segmentIds]
    );
    const rows = segRes.rows;
    if (rows.length === 0) return reply.code(404).send({ error: "Segments not found." });
    const projectIds = Array.from(new Set(rows.map((row) => row.project_id)));
    if (projectIds.length > 1) {
      return reply.code(400).send({ error: "Segments must belong to the same project." });
    }
    const accessRow = await ensureProjectAccess(projectIds[0]!, user, reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    const termbaseCache = new Map<string, TermbaseIndex | null>();
    const now = new Date().toISOString();
    const userId = requestUserId(user) ?? "system";
    const updated: Array<{
      id: number;
      status: SegmentStatus;
      state: SegmentState;
      isLocked: boolean;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
      version: number;
    }> = [];
    const skipped: number[] = [];
    const taskIds = new Set<number>();

    for (const row of rows) {
      const tgt = String(row.tgt ?? "");
      if (!tgt.trim()) {
        skipped.push(row.id);
        continue;
      }
      const cacheKey = `${row.project_id}:${row.task_id ?? "none"}`;
      let termbase = termbaseCache.get(cacheKey);
      if (termbase === undefined) {
        termbase = await loadTermbaseIndex({ projectId: row.project_id, taskId: row.task_id });
        termbaseCache.set(cacheKey, termbase ?? null);
      }
      const { issues, summary } = computeSegmentIssues({
        src: row.src,
        tgt: row.tgt,
        termbase: termbase ?? null
      });
      const currentStatus = coerceSegmentStatus(row.status);
      const currentState = coerceSegmentState(row.state, currentStatus);
      let nextState: SegmentState = currentState;
      if (forceReviewed) {
        nextState = "reviewed";
      } else {
        const hasErrors = summary.error > 0;
        const lowQuality =
          row.qe_score != null && Number.isFinite(row.qe_score) && row.qe_score < QE_REVIEW_THRESHOLD;
        nextState = hasErrors || lowQuality ? "draft" : "reviewed";
      }
      const finalStatus = mapStateToStatus(nextState);
      const nextIsLocked = nextState === "reviewed" ? true : Boolean(row.is_locked);

      const updateRes = await db.query<{ version: number }>(
        `UPDATE segments
         SET status = $2,
             state = $3,
             is_locked = CASE WHEN $3 = 'reviewed' THEN TRUE ELSE is_locked END,
             issue_summary = $4,
             issue_details = $5,
             updated_by = $6,
             updated_at = $7,
             version = version + 1
         WHERE id = $1
         RETURNING version`,
        [row.id, finalStatus, nextState, JSON.stringify(summary), JSON.stringify(issues), userId, now]
      );

      if (nextState === "reviewed") {
        await db.query(
          `INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.id, row.tgt ?? null, row.tgt ?? null, userId, now]
        );
      }

      if (row.task_id != null) taskIds.add(row.task_id);

      updated.push({
        id: row.id,
        status: finalStatus,
        state: nextState,
        isLocked: nextIsLocked,
        issueSummary: summary,
        issues,
        version: updateRes.rows[0]?.version ?? (row.version ?? 0) + 1
      });
    }

    if (taskIds.size > 0) {
      await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = ANY($1::int[])`, [
        Array.from(taskIds.values()),
        now
      ]);
    }

    return {
      ok: true,
      updated: updated.length,
      skipped: skipped.length,
      segments: updated,
      skippedIds: skipped
    };
  });

  // BULK: accept clean LLM drafts
  app.post("/segments/accept-clean-llm-drafts", { preHandler: [requireAuth] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const taskId = Number(body.taskId ?? body.task_id);
    const fileId = Number(body.fileId ?? body.file_id);
    const qeThresholdRaw = body.qeThreshold ?? body.qe_threshold;
    const qeThreshold = Number.isFinite(Number(qeThresholdRaw))
      ? Number(qeThresholdRaw)
      : QE_REVIEW_THRESHOLD;
    const user = getRequestUser(req);

    let rows: Array<{
      id: number;
      project_id: number;
      file_id: number;
      task_id: number | null;
      src: string;
      tgt: string | null;
      status: string;
      state: string | null;
      generated_by_llm: boolean | null;
      qe_score: number | null;
      version: number;
    }> = [];

    if (Number.isFinite(taskId) && taskId > 0) {
      const taskRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM translation_tasks WHERE id = $1 LIMIT 1`,
        [taskId]
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
      const accessRow = await ensureProjectAccess(taskRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                version
         FROM segments
         WHERE task_id = $1
         ORDER BY seg_index`,
        [taskId]
      );
      rows = res.rows as typeof rows;
    } else if (Number.isFinite(fileId) && fileId > 0) {
      const fileRes = await db.query<{ project_id: number }>(
        `SELECT project_id FROM project_files WHERE id = $1 LIMIT 1`,
        [fileId]
      );
      const fileRow = fileRes.rows[0];
      if (!fileRow) return reply.code(404).send({ error: "File not found" });
      const accessRow = await ensureProjectAccess(fileRow.project_id, user, reply);
      if (!accessRow) return;
      if (!ensureProjectReady(accessRow, reply)) return;
      const res = await db.query(
        `SELECT id,
                project_id,
                file_id,
                task_id,
                src,
                tgt,
                status,
                state,
                generated_by_llm,
                qe_score,
                version
         FROM segments
         WHERE file_id = $1 AND task_id IS NULL
         ORDER BY seg_index`,
        [fileId]
      );
      rows = res.rows as typeof rows;
    } else {
      return reply.code(400).send({ error: "Provide taskId or fileId." });
    }

    if (rows.length === 0) {
      return { ok: true, updated: 0, segments: [] };
    }

    const termbaseCache = new Map<string, TermbaseIndex | null>();
    const now = new Date().toISOString();
    const userId = requestUserId(user) ?? "system";
    const updated: Array<{
      id: number;
      status: SegmentStatus;
      state: SegmentState;
      isLocked: boolean;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
      version: number;
    }> = [];
    const taskIds = new Set<number>();

    for (const row of rows) {
      const status = coerceSegmentStatus(row.status);
      const currentState = coerceSegmentState(row.state, status);
      if (currentState !== "nmt_draft") continue;
      if (!row.generated_by_llm) continue;
      const cacheKey = `${row.project_id}:${row.task_id ?? "none"}`;
      let termbase = termbaseCache.get(cacheKey);
      if (termbase === undefined) {
        termbase = await loadTermbaseIndex({ projectId: row.project_id, taskId: row.task_id });
        termbaseCache.set(cacheKey, termbase ?? null);
      }
      const { issues, summary } = computeSegmentIssues({
        src: row.src,
        tgt: row.tgt,
        termbase: termbase ?? null
      });
      const hasIssues = summary.error + summary.warning > 0;
      const lowQuality =
        row.qe_score != null && Number.isFinite(row.qe_score) && row.qe_score < qeThreshold;
      if (hasIssues || lowQuality) continue;

      const nextState: SegmentState = "reviewed";
      const finalStatus = mapStateToStatus(nextState);

      const updateRes = await db.query<{ version: number }>(
        `UPDATE segments
         SET status = $2,
             state = $3,
             is_locked = TRUE,
             issue_summary = $4,
             issue_details = $5,
             updated_by = $6,
             updated_at = $7,
             version = version + 1
         WHERE id = $1
         RETURNING version`,
        [row.id, finalStatus, nextState, JSON.stringify(summary), JSON.stringify(issues), userId, now]
      );

      if (nextState === "reviewed") {
        await db.query(
          `INSERT INTO segment_history(segment_id, old_tgt, new_tgt, updated_by, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.id, row.tgt ?? null, row.tgt ?? null, userId, now]
        );
      }

      if (row.task_id != null) taskIds.add(row.task_id);

      updated.push({
        id: row.id,
        status: finalStatus,
        state: nextState,
        isLocked: true,
        issueSummary: summary,
        issues,
        version: updateRes.rows[0]?.version ?? (row.version ?? 0) + 1
      });
    }

    if (taskIds.size > 0) {
      await db.query(`UPDATE translation_tasks SET updated_at = $2 WHERE id = ANY($1::int[])`, [
        Array.from(taskIds.values()),
        now
      ]);
    }

    return { ok: true, updated: updated.length, segments: updated };
  });
}
