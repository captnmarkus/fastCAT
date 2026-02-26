import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { getRequestUser, requireAdmin, requireAuth, requestUserId } from "../middleware/auth.js";
import {
  buildLanguageCatalogResponse,
  getOrgLanguageConfig,
  getOrgLanguageSettings,
  updateOrgLanguageConfig,
  updateOrgLanguageSettings
} from "../lib/org-languages.js";

export async function adminRoutes(app: FastifyInstance) {
  function csvEscape(value: unknown): string {
    const raw = String(value ?? "");
    if (raw.includes("\"") || raw.includes(",") || raw.includes("\n") || raw.includes("\r")) {
      return `"${raw.replace(/\"/g, "\"\"")}"`;
    }
    return raw;
  }

  async function buildChatUsageSummary() {
    const totalsRes = await db.query<{
      threads: number;
      messages: number;
      userMessages: number;
      assistantMessages: number;
      toolCalls: number;
      toolCallFailures: number;
      requests: number;
      requestFailures: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM chat_threads) AS threads,
         (SELECT COUNT(*)::int FROM chat_messages) AS messages,
         (SELECT COUNT(*)::int FROM chat_messages WHERE role = 'user') AS "userMessages",
         (SELECT COUNT(*)::int FROM chat_messages WHERE role = 'assistant') AS "assistantMessages",
         (SELECT COUNT(*)::int FROM tool_calls) AS "toolCalls",
         (SELECT COUNT(*)::int FROM tool_calls WHERE status = 'failed') AS "toolCallFailures",
         (SELECT COUNT(*)::int FROM chat_audit_events WHERE event_type = 'chat_request_started') AS requests,
         (SELECT COUNT(*)::int FROM chat_audit_events WHERE event_type = 'chat_request_failed') AS "requestFailures"`
    );

    const toolsRes = await db.query<{
      toolName: string;
      calls: number;
      failures: number;
    }>(
      `SELECT
         tool_name AS "toolName",
         COUNT(*)::int AS calls,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failures
       FROM tool_calls
       GROUP BY tool_name
       ORDER BY calls DESC, tool_name ASC`
    );

    const usersRes = await db.query<{
      userId: number;
      threads: number;
      userMessages: number;
      assistantMessages: number;
      toolCalls: number;
      requests: number;
      failures: number;
      lastMessageAt: string | null;
    }>(
      `WITH message_agg AS (
         SELECT
           m.user_id AS user_id,
           COUNT(DISTINCT m.thread_id)::int AS threads,
           COUNT(*) FILTER (WHERE m.role = 'user')::int AS user_messages,
           COUNT(*) FILTER (WHERE m.role = 'assistant')::int AS assistant_messages,
           MAX(m.created_at) AS last_message_at
         FROM chat_messages m
         GROUP BY m.user_id
       ),
       tool_agg AS (
         SELECT user_id, COUNT(*)::int AS tool_calls
         FROM tool_calls
         GROUP BY user_id
       ),
       request_agg AS (
         SELECT
           user_id,
           COUNT(*) FILTER (WHERE event_type = 'chat_request_started')::int AS requests,
           COUNT(*) FILTER (WHERE event_type = 'chat_request_failed')::int AS failures
         FROM chat_audit_events
         GROUP BY user_id
       )
       SELECT
         ma.user_id AS "userId",
         ma.threads AS threads,
         ma.user_messages AS "userMessages",
         ma.assistant_messages AS "assistantMessages",
         COALESCE(ta.tool_calls, 0)::int AS "toolCalls",
         COALESCE(ra.requests, 0)::int AS requests,
         COALESCE(ra.failures, 0)::int AS failures,
         ma.last_message_at::text AS "lastMessageAt"
       FROM message_agg ma
       LEFT JOIN tool_agg ta ON ta.user_id = ma.user_id
       LEFT JOIN request_agg ra ON ra.user_id = ma.user_id
       ORDER BY ma.user_messages DESC, ma.user_id ASC`
    );

    const dailyRes = await db.query<{
      day: string;
      requests: number;
      failures: number;
      toolCalls: number;
    }>(
      `WITH days AS (
         SELECT generate_series(
           date_trunc('day', NOW() - INTERVAL '13 day'),
           date_trunc('day', NOW()),
           INTERVAL '1 day'
         )::date AS day
       ),
       req AS (
         SELECT
           date_trunc('day', created_at)::date AS day,
           COUNT(*) FILTER (WHERE event_type = 'chat_request_started')::int AS requests,
           COUNT(*) FILTER (WHERE event_type = 'chat_request_failed')::int AS failures
         FROM chat_audit_events
         WHERE created_at >= NOW() - INTERVAL '14 day'
         GROUP BY 1
       ),
       tc AS (
         SELECT
           date_trunc('day', created_at)::date AS day,
           COUNT(*)::int AS tool_calls
         FROM tool_calls
         WHERE created_at >= NOW() - INTERVAL '14 day'
         GROUP BY 1
       )
       SELECT
         d.day::text AS day,
         COALESCE(r.requests, 0)::int AS requests,
         COALESCE(r.failures, 0)::int AS failures,
         COALESCE(tc.tool_calls, 0)::int AS "toolCalls"
       FROM days d
       LEFT JOIN req r ON r.day = d.day
       LEFT JOIN tc ON tc.day = d.day
       ORDER BY d.day ASC`
    );

    return {
      totals: {
        threads: totalsRes.rows[0]?.threads ?? 0,
        messages: totalsRes.rows[0]?.messages ?? 0,
        userMessages: totalsRes.rows[0]?.userMessages ?? 0,
        assistantMessages: totalsRes.rows[0]?.assistantMessages ?? 0,
        toolCalls: totalsRes.rows[0]?.toolCalls ?? 0,
        toolCallFailures: totalsRes.rows[0]?.toolCallFailures ?? 0,
        requests: totalsRes.rows[0]?.requests ?? 0,
        requestFailures: totalsRes.rows[0]?.requestFailures ?? 0
      },
      tools: toolsRes.rows.map((row) => ({
        toolName: row.toolName,
        calls: row.calls ?? 0,
        failures: row.failures ?? 0
      })),
      users: usersRes.rows.map((row) => ({
        userId: row.userId,
        threads: row.threads ?? 0,
        userMessages: row.userMessages ?? 0,
        assistantMessages: row.assistantMessages ?? 0,
        toolCalls: row.toolCalls ?? 0,
        requests: row.requests ?? 0,
        failures: row.failures ?? 0,
        lastMessageAt: row.lastMessageAt
      })),
      daily: dailyRes.rows.map((row) => ({
        day: row.day,
        requests: row.requests ?? 0,
        failures: row.failures ?? 0,
        toolCalls: row.toolCalls ?? 0
      }))
    };
  }

  app.get("/admin/usage", { preHandler: [requireAdmin] }, async () => {
    const projectTotalRes = await db.query<{ projects: number }>(
      `SELECT COUNT(*)::int AS projects FROM projects`
    );

    const segmentTotalsRes = await db.query<{
      segments: number;
      translated: number;
      underReview: number;
    }>(`
      SELECT
        COUNT(*)::int AS segments,
        COALESCE(SUM(CASE WHEN status IN ('reviewed', 'approved') THEN 1 ELSE 0 END), 0)::int AS translated,
        COALESCE(SUM(CASE WHEN status = 'under_review' THEN 1 ELSE 0 END), 0)::int AS "underReview"
      FROM segments
    `);

    const perUserRes = await db.query<{
      userId: string;
      projects: number;
      segments: number;
      translated: number;
      underReview: number;
    }>(`
      SELECT
        COALESCE(assigned_user, created_by, 'unassigned') AS "userId",
        COUNT(DISTINCT p.id)::int AS projects,
        COUNT(s.id)::int AS segments,
        COALESCE(SUM(CASE WHEN s.status IN ('reviewed', 'approved') THEN 1 ELSE 0 END), 0)::int AS translated,
        COALESCE(SUM(CASE WHEN s.status = 'under_review' THEN 1 ELSE 0 END), 0)::int AS "underReview"
      FROM projects p
      LEFT JOIN segments s ON s.project_id = p.id
      GROUP BY COALESCE(assigned_user, created_by, 'unassigned')
    `);

    return {
      totals: {
        projects: projectTotalRes.rows[0]?.projects ?? 0,
        segments: segmentTotalsRes.rows[0]?.segments ?? 0,
        translated: segmentTotalsRes.rows[0]?.translated ?? 0,
        underReview: segmentTotalsRes.rows[0]?.underReview ?? 0
      },
      users: perUserRes.rows.map((u) => ({
        userId: u.userId,
        projects: u.projects ?? 0,
        segments: u.segments ?? 0,
        translated: u.translated ?? 0,
        underReview: u.underReview ?? 0
      }))
    };
  });

  app.get("/org/languages", { preHandler: [requireAuth] }, async () => {
    const config = await getOrgLanguageConfig();
    const settings = await getOrgLanguageSettings();
    return {
      languages: config.languages,
      defaults: config.defaults,
      allowSingleLanguage: Boolean(config.allowSingleLanguage),
      catalog: buildLanguageCatalogResponse(),
      settings
    };
  });

  app.put("/admin/org/languages", { preHandler: [requireAdmin] }, async (req, reply) => {
    const body = (req.body as any) || {};

    try {
      const actor = requestUserId(getRequestUser(req)) || "admin";
      if (
        Array.isArray(body.languages) ||
        Array.isArray(body.entries) ||
        (body.defaults && typeof body.defaults === "object")
      ) {
        const config = {
          languages: Array.isArray(body.languages)
            ? body.languages
            : Array.isArray(body.entries)
              ? body.entries
              : [],
          defaults: body.defaults && typeof body.defaults === "object" ? body.defaults : {},
          allowSingleLanguage: Boolean(body.allowSingleLanguage)
        };
        const updated = await updateOrgLanguageConfig(config, actor);
        return reply.send({
          languages: updated.languages,
          defaults: updated.defaults,
          allowSingleLanguage: Boolean(updated.allowSingleLanguage)
        });
      }

      const settings = {
        enabledLanguageTags: Array.isArray(body.enabledLanguageTags) ? body.enabledLanguageTags : [],
        defaultSourceTag: String(body.defaultSourceTag || ""),
        defaultTargetTags: Array.isArray(body.defaultTargetTags) ? body.defaultTargetTags : [],
        preferredVariantsByPrimary:
          body.preferredVariantsByPrimary && typeof body.preferredVariantsByPrimary === "object"
            ? body.preferredVariantsByPrimary
            : {},
        allowSingleLanguage: Boolean(body.allowSingleLanguage)
      };
      const updated = await updateOrgLanguageSettings(settings, actor);
      return reply.send({ settings: updated });
    } catch (err: any) {
      const details = err?.details;
      return reply.code(400).send({ error: err?.message || "Invalid language settings.", details });
    }
  });

  app.get(
    "/admin/usage/export",
    { preHandler: [requireAdmin] },
    async (_, reply) => {
      const perUserRes = await db.query<{
        userId: string;
        projects: number;
        segments: number;
        translated: number;
        underReview: number;
      }>(`
        SELECT
          COALESCE(assigned_user, created_by, 'unassigned') AS "userId",
          COUNT(DISTINCT p.id)::int AS projects,
          COUNT(s.id)::int AS segments,
          COALESCE(SUM(CASE WHEN s.status IN ('reviewed', 'approved') THEN 1 ELSE 0 END), 0)::int AS translated,
          COALESCE(SUM(CASE WHEN s.status = 'under_review' THEN 1 ELSE 0 END), 0)::int AS "underReview"
        FROM projects p
        LEFT JOIN segments s ON s.project_id = p.id
        GROUP BY COALESCE(assigned_user, created_by, 'unassigned')
        ORDER BY COALESCE(assigned_user, created_by, 'unassigned') ASC
      `);

      const rows = perUserRes.rows;
      const header = ["user", "projects", "segments", "under_review", "reviewed"].join(",");
      const body = rows
        .map((row) =>
          [
            csvEscape(row.userId),
            csvEscape(row.projects ?? 0),
            csvEscape(row.segments ?? 0),
            csvEscape(row.underReview ?? 0),
            csvEscape(row.translated ?? 0)
          ].join(",")
        )
        .join("\n");

      const csv = `${header}\n${body}\n`;
      const filename = `usage-${new Date().toISOString().slice(0, 10)}.csv`;
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(csv);
    }
  );

  app.get("/admin/chat/usage", { preHandler: [requireAdmin] }, async () => {
    return buildChatUsageSummary();
  });

  app.get("/admin/chat/audit", { preHandler: [requireAdmin] }, async (req: any, reply) => {
    const limitRaw = Number(req?.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 200;
    const eventType = String(req?.query?.eventType || "").trim();
    const userIdRaw = Number(req?.query?.userId);
    const userId = Number.isFinite(userIdRaw) && userIdRaw > 0 ? Math.trunc(userIdRaw) : null;

    const rows = await db.query<{
      id: number;
      request_id: string;
      user_id: number;
      thread_id: number | null;
      message_id: number | null;
      event_type: string;
      tool_name: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT
         id,
         request_id,
         user_id,
         thread_id,
         message_id,
         event_type,
         tool_name,
         metadata,
         created_at
       FROM chat_audit_events
       WHERE ($1::text = '' OR event_type = $1)
         AND ($2::int IS NULL OR user_id = $2)
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [eventType, userId, limit]
    );

    return reply.send({
      events: rows.rows.map((row) => ({
        id: Number(row.id),
        requestId: String(row.request_id),
        userId: Number(row.user_id),
        threadId: row.thread_id != null ? Number(row.thread_id) : null,
        messageId: row.message_id != null ? Number(row.message_id) : null,
        eventType: String(row.event_type),
        toolName: row.tool_name ? String(row.tool_name) : null,
        metadata: row.metadata ?? {},
        createdAt: new Date(row.created_at).toISOString()
      }))
    });
  });

  app.get("/admin/chat/usage/export", { preHandler: [requireAdmin] }, async (_, reply) => {
    const usage = await buildChatUsageSummary();
    const header = [
      "user_id",
      "threads",
      "user_messages",
      "assistant_messages",
      "tool_calls",
      "requests",
      "failures",
      "last_message_at"
    ].join(",");
    const body = usage.users
      .map((row) =>
        [
          csvEscape(row.userId),
          csvEscape(row.threads),
          csvEscape(row.userMessages),
          csvEscape(row.assistantMessages),
          csvEscape(row.toolCalls),
          csvEscape(row.requests),
          csvEscape(row.failures),
          csvEscape(row.lastMessageAt || "")
        ].join(",")
      )
      .join("\n");

    const csv = `${header}\n${body}\n`;
    const filename = `chat-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(csv);
  });
}
