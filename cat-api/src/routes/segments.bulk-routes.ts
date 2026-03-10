import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import {
  requireAuth,
  ensureProjectAccess,
  ensureProjectReady,
  getRequestUser,
  requestUserId,
  isAdminUser,
  isManagerUser
} from "../middleware/auth.js";
import { requestSegmentLlmPayload, SegmentLlmError } from "../lib/segment-llm.js";
import { ensureTaskAccess, ensureTaskSegments } from "./files.helpers.js";
import {
  type BulkCandidateRow,
  bulkJobsById,
  computeBulkProgress,
  evaluateBulkApproveCandidates,
  loadBulkApproveCandidates,
  normalizeBulkQaPolicy,
  normalizeBulkScope,
  normalizeFilterObject,
  pruneBulkJobs,
  runBulkApproveJob,
  toBulkEstimatePublic,
  type BulkJobRecord
} from "./segments.shared.js";

export async function registerSegmentBulkRoutes(app: FastifyInstance) {
  app.post("/projects/:projectId/files/:fileId/segments/bulk-approve", { preHandler: [requireAuth] }, async (req, reply) => {
    pruneBulkJobs();
    const projectId = Number((req.params as any).projectId);
    const fileId = Number((req.params as any).fileId);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return reply.code(400).send({ error: "Invalid projectId." });
    }
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: "Invalid fileId." });
    }

    const user = getRequestUser(req);
    const requesterId = requestUserId(user);
    const canApproveAny = isAdminUser(user) || isManagerUser(user);
    const body = (req.body as any) || {};
    const parsedScope = normalizeBulkScope(body.scope);
    if (body.scope != null && parsedScope == null) {
      return reply.code(400).send({ error: "Invalid bulk approval scope.", code: "BULK_SCOPE_INVALID" });
    }
    const scope = parsedScope ?? "all";
    const parsedQaPolicy = normalizeBulkQaPolicy(body.qaPolicy);
    if (body.qaPolicy != null && parsedQaPolicy == null) {
      return reply.code(400).send({ error: "Invalid bulk approval QA policy.", code: "BULK_QA_POLICY_INVALID" });
    }
    const qaPolicy = parsedQaPolicy ?? (scope === "clean" ? "require_clean" : "ignore");
    const dryRun = body.dryRun === true || body.preview === true || body.estimateOnly === true;
    const taskIdRaw = Number(body.taskId ?? body.task_id);
    const taskId = Number.isFinite(taskIdRaw) && taskIdRaw > 0 ? Math.trunc(taskIdRaw) : null;
    const filters = normalizeFilterObject(body.filters);

    const accessRow = await ensureProjectAccess(projectId, user, reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    if (taskId != null) {
      const taskAccess = await ensureTaskAccess(taskId, user, reply);
      if (!taskAccess) return;
      if (Number(taskAccess.project_id) !== projectId || Number(taskAccess.file_id) !== fileId) {
        return reply.code(400).send({
          error: "taskId does not belong to the selected project/file.",
          code: "TASK_FILE_MISMATCH"
        });
      }
      await ensureTaskSegments(taskId);
    } else if (!canApproveAny) {
      return reply.code(400).send({
        error: "taskId is required for reviewer bulk approval.",
        code: "TASK_ID_REQUIRED"
      });
    }

    let rows: BulkCandidateRow[] = [];
    try {
      rows = await loadBulkApproveCandidates({
        projectId,
        fileId,
        taskId,
        scope,
        filters
      });
    } catch (err: any) {
      return reply.code(400).send({
        error: err?.message || "Invalid bulk approval filters.",
        code: "BULK_FILTER_INVALID"
      });
    }

    const projectOwner =
      accessRow && typeof accessRow === "object"
        ? String((accessRow as any).assigned_user ?? (accessRow as any).created_by ?? "").trim() || null
        : null;
    const estimate = await evaluateBulkApproveCandidates({
      rows,
      qaPolicy,
      requester: user,
      canApproveAny,
      projectOwner,
      persistQaPayload: qaPolicy === "require_clean"
    });
    const estimated = toBulkEstimatePublic(estimate);

    if (dryRun) {
      return { ok: true, dryRun: true, estimated };
    }

    const nowMs = Date.now();
    const jobId = `ba_${nowMs}_${Math.floor(Math.random() * 1_000_000)}`;
    const initialProgress = computeBulkProgress(
      estimate.total,
      estimate.skipped,
      0,
      estimate.skipped
    );
    const job: BulkJobRecord = {
      id: jobId,
      status: "queued",
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      scope,
      projectId,
      fileId,
      taskId,
      progress: initialProgress,
      estimated,
      summary: null,
      error: null
    };
    bulkJobsById.set(jobId, job);

    const jobUserId = requesterId ?? "system";
    setTimeout(() => {
      void runBulkApproveJob({
        job,
        eligibleCandidates: estimate.eligibleCandidates,
        initialSkippedCount: estimate.skipped,
        initialReasons: estimate.reasonsBreakdown,
        initialSkippedIds: estimate.skippedSegmentIds,
        initialProblematicIds: estimate.problematicSegmentIds,
        userId: jobUserId,
        accessRow
      });
    }, 0);

    return {
      ok: true,
      jobId,
      estimated
    };
  });

  app.get("/bulk-jobs/:jobId", { preHandler: [requireAuth] }, async (req, reply) => {
    pruneBulkJobs();
    const jobId = String((req.params as any).jobId || "").trim();
    if (!jobId) {
      return reply.code(400).send({ error: "Invalid jobId." });
    }

    const job = bulkJobsById.get(jobId);
    if (!job) {
      return reply.code(404).send({ error: "Bulk job not found." });
    }

    const accessRow = await ensureProjectAccess(job.projectId, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    return {
      jobId: job.id,
      status: job.status,
      scope: job.scope,
      projectId: job.projectId,
      fileId: job.fileId,
      taskId: job.taskId,
      progress: job.progress,
      estimated: job.estimated,
      summary: job.summary,
      error: job.error,
      createdAt: new Date(job.createdAtMs).toISOString(),
      updatedAt: new Date(job.updatedAtMs).toISOString()
    };
  });

  // LLM TRANSLATION
  app.post("/segments/:id/llm", { preHandler: [requireAuth] }, async (req, reply) => {
    const sid = Number((req.params as any).id);
    const segRes = await db.query<{ project_id: number }>(
      "SELECT project_id FROM segments WHERE id = $1 LIMIT 1",
      [sid]
    );
    const seg = segRes.rows[0];
    if (!seg) return reply.code(404).send({ error: "Segment not found" });
    const accessRow = await ensureProjectAccess(seg.project_id, getRequestUser(req), reply);
    if (!accessRow) return;
    if (!ensureProjectReady(accessRow, reply)) return;

    try {
      const traceId = (req.headers["x-request-id"] as string | undefined) ?? req.id;
      const result = await requestSegmentLlmPayload({ segmentId: sid, traceId });
      return reply.status(result.status).send(result.payload);
    } catch (err: any) {
      if (err instanceof SegmentLlmError) {
        return reply.code(err.status).send({ error: err.message });
      }
      return reply.code(502).send({ error: "LLM Error" });
    }
  });
}
