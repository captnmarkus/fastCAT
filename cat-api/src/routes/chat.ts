import { randomUUID } from "crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { db, withTransaction } from "../db.js";
import {
  getRequestUser,
  requestUserDepartmentIdWithAdminFallback,
  requestUserId,
  requestUserIdInt,
  requireAuth
} from "../middleware/auth.js";
import { CONFIG } from "../config.js";
import type { AgentService } from "../lib/agent-service.js";
import { ChatStreamManager, type ChatStreamEvent } from "../lib/chat-stream-manager.js";
import { consumeChatRateLimit } from "../lib/chat-rate-limiter.js";
import { normalizeLanguageTag } from "../lib/language-catalog.js";

type ChatRoutesOptions = {
  agentService: AgentService;
  streamManager: ChatStreamManager;
};

const MAX_MESSAGE_LENGTH = 4000;

type ThreadRow = {
  id: number;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  thread_id: number;
  user_id: number;
  role: "user" | "assistant" | "tool";
  content_text: string | null;
  content_json: Record<string, unknown> | null;
  created_at: string;
};

type ChatUploadSessionRow = {
  id: number;
  name: string;
  status: string;
  src_lang: string;
  tgt_lang: string;
  created_at: string;
};

type OrgLanguageSettingsRow = {
  enabled_language_tags: unknown;
  default_source_tag: string | null;
  default_target_tags: unknown;
};

type ChatUploadSessionFileRow = {
  id: number;
  original_name: string;
  file_type: string | null;
  file_type_config_id: number | null;
  status: string | null;
  created_at: string;
};

function parseThreadId(input: unknown): number | null {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function threadResponse(row: ThreadRow) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    title: String(row.title || ""),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function messageResponse(row: MessageRow) {
  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    userId: Number(row.user_id),
    role: row.role,
    contentText: String(row.content_text || ""),
    contentJson: row.content_json ?? null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function ensureThreadAccess(threadId: number, userId: number, reply: FastifyReply) {
  const res = await db.query<ThreadRow>(
    `SELECT id, user_id, title, created_at, updated_at
     FROM chat_threads
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [threadId, userId]
  );
  const row = res.rows[0];
  if (!row) {
    reply.code(404).send({ error: "Thread not found" });
    return null;
  }
  return row;
}

async function ensureDefaultThread(userId: number) {
  const existing = await db.query<ThreadRow>(
    `SELECT id, user_id, title, created_at, updated_at
     FROM chat_threads
     WHERE user_id = $1
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }
  const created = await db.query<ThreadRow>(
    `INSERT INTO chat_threads(user_id, title)
     VALUES ($1, 'App Agent')
     RETURNING id, user_id, title, created_at, updated_at`,
    [userId]
  );
  return created.rows[0] ?? null;
}

function writeSseEvent(reply: FastifyReply, event: ChatStreamEvent) {
  reply.raw.write(`id: ${event.id}\n`);
  reply.raw.write(`event: ${event.type}\n`);
  reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function readLastEventId(req: any): number {
  const headerValue = req.headers["last-event-id"];
  const headerParsed = Number(Array.isArray(headerValue) ? headerValue[0] : headerValue);
  if (Number.isFinite(headerParsed) && headerParsed >= 0) return headerParsed;
  const queryParsed = Number((req.query as any)?.lastEventId);
  if (Number.isFinite(queryParsed) && queryParsed >= 0) return queryParsed;
  return 0;
}

function normalizeLanguageList(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = [];
    }
  }

  raw.forEach((entry) => {
    const normalized = normalizeLanguageTag(String(entry || ""));
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });

  return out;
}

async function resolveChatUploadLanguageDefaults(): Promise<{ sourceLang: string; targetLang: string }> {
  const res = await db.query<OrgLanguageSettingsRow>(
    `SELECT enabled_language_tags, default_source_tag, default_target_tags
     FROM org_language_settings
     WHERE id = 1
     LIMIT 1`
  );
  const row = res.rows[0];
  const enabled = normalizeLanguageList(row?.enabled_language_tags ?? []);
  const defaultSource = normalizeLanguageTag(String(row?.default_source_tag || ""));
  const sourceLang = defaultSource || enabled[0] || "en";

  const defaultTargets = normalizeLanguageList(row?.default_target_tags ?? []);
  const targetCandidates = defaultTargets.filter((entry) => entry !== sourceLang);
  const enabledFallback = enabled.filter((entry) => entry !== sourceLang);
  const targetLang =
    targetCandidates[0] ||
    enabledFallback[0] ||
    (sourceLang === "en" ? "de" : "en");

  return { sourceLang, targetLang };
}

async function getOrCreateChatUploadSessionProject(params: {
  username: string;
  departmentId: number;
}): Promise<ChatUploadSessionRow> {
  const existingRes = await db.query<ChatUploadSessionRow>(
    `SELECT id, name, status::text AS status, src_lang, tgt_lang, created_at
     FROM projects
     WHERE created_by = $1
       AND assigned_user = $1
       AND department_id = $2
       AND COALESCE(project_settings->>'appAgentUploadSession', 'false') = 'true'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [params.username, params.departmentId]
  );
  const existing = existingRes.rows[0];
  if (existing) {
    return existing;
  }

  const { sourceLang, targetLang } = await resolveChatUploadLanguageDefaults();
  const row = await withTransaction(async (client) => {
    const created = await client.query<ChatUploadSessionRow>(
      `INSERT INTO projects(
         name,
         src_lang,
         tgt_lang,
         target_langs,
         status,
         created_by,
         assigned_user,
         department_id,
         project_settings
       )
       VALUES ($1, $2, $3, $4::jsonb, 'failed', $5, $5, $6, $7::jsonb)
       RETURNING id, name, status::text AS status, src_lang, tgt_lang, created_at`,
      [
        `App Agent Upload Session ${new Date().toISOString().slice(0, 10)}`,
        sourceLang,
        targetLang,
        JSON.stringify([targetLang]),
        params.username,
        params.departmentId,
        JSON.stringify({
          appAgentUploadSession: true,
          hidden: true,
          createdAt: new Date().toISOString()
        })
      ]
    );
    const createdProject = created.rows[0];
    if (!createdProject) return null;

    // Keep a hidden placeholder file reference so deferred DB constraints pass
    // until the user uploads real files into the session project.
    await client.query(
      `INSERT INTO project_files(project_id, original_name, stored_path, status)
       VALUES ($1, $2, $3, $4)`,
      [
        createdProject.id,
        "__chat_upload_placeholder__",
        `chat/upload-session/${createdProject.id}/placeholder/${randomUUID()}`,
        "placeholder"
      ]
    );

    return createdProject;
  });
  if (!row) {
    throw new Error("Failed to create chat upload session project.");
  }
  return row;
}

export const chatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (app, opts) => {
  app.get("/chat/threads", { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = requestUserIdInt(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    await ensureDefaultThread(userId);
    const res = await db.query<ThreadRow>(
      `SELECT id, user_id, title, created_at, updated_at
       FROM chat_threads
       WHERE user_id = $1
       ORDER BY updated_at DESC, id DESC`,
      [userId]
    );
    return { threads: res.rows.map(threadResponse) };
  });

  app.post("/chat/threads", { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = requestUserIdInt(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const canCreateThread = await consumeChatRateLimit({
      scope: "thread-create",
      userId,
      limit: Math.max(5, Math.floor(CONFIG.CHAT_RATE_LIMIT_PER_MINUTE / 2))
    });
    if (!canCreateThread) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const body = (req.body as any) || {};
    const requestedTitle = String(body.title || "").trim();
    const title = requestedTitle ? requestedTitle.slice(0, 120) : "App Agent";
    const res = await db.query<ThreadRow>(
      `INSERT INTO chat_threads(user_id, title)
       VALUES ($1, $2)
       RETURNING id, user_id, title, created_at, updated_at`,
      [userId, title]
    );
    const row = res.rows[0];
    return { thread: row ? threadResponse(row) : null };
  });

  app.patch("/chat/threads/:id", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const userId = requestUserIdInt(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const threadId = parseThreadId(req.params.id);
    if (!threadId) return reply.code(400).send({ error: "Invalid thread id" });
    const existing = await ensureThreadAccess(threadId, userId, reply);
    if (!existing) return;

    const body = (req.body as any) || {};
    const title = String(body.title || "").trim().slice(0, 120);
    if (!title) {
      return reply.code(400).send({ error: "title is required" });
    }

    const updated = await db.query<ThreadRow>(
      `UPDATE chat_threads
       SET title = $3, updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
       RETURNING id, user_id, title, created_at, updated_at`,
      [threadId, userId, title]
    );
    return {
      thread: updated.rows[0] ? threadResponse(updated.rows[0]) : threadResponse(existing)
    };
  });

  app.delete("/chat/threads/:id", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const userId = requestUserIdInt(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const threadId = parseThreadId(req.params.id);
    if (!threadId) return reply.code(400).send({ error: "Invalid thread id" });
    if (!(await ensureThreadAccess(threadId, userId, reply))) return;

    await db.query(
      `DELETE FROM chat_threads
       WHERE id = $1
         AND user_id = $2`,
      [threadId, userId]
    );

    let replacementThread: ThreadRow | null = null;
    const remaining = await db.query<ThreadRow>(
      `SELECT id, user_id, title, created_at, updated_at
       FROM chat_threads
       WHERE user_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [userId]
    );
    replacementThread = remaining.rows[0] ?? null;
    if (!replacementThread) {
      replacementThread = await ensureDefaultThread(userId);
    }

    return {
      ok: true,
      replacementThread: replacementThread ? threadResponse(replacementThread) : null
    };
  });

  app.get("/chat/threads/:id/messages", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const userId = requestUserIdInt(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const threadId = parseThreadId(req.params.id);
    if (!threadId) return reply.code(400).send({ error: "Invalid thread id" });
    if (!(await ensureThreadAccess(threadId, userId, reply))) return;

    const limitRaw = Number((req.query as any)?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 200;

    const res = await db.query<MessageRow>(
      `SELECT id, thread_id, user_id, role, content_text, content_json, created_at
       FROM chat_messages
       WHERE thread_id = $1
         AND user_id = $2
       ORDER BY created_at ASC, id ASC
       LIMIT $3`,
      [threadId, userId, limit]
    );
    return { messages: res.rows.map(messageResponse) };
  });

  app.post("/chat/threads/:id/messages", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const user = getRequestUser(req);
    const userId = requestUserIdInt(user);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const username = String(requestUserId(user) || userId).trim();
    const threadId = parseThreadId(req.params.id);
    if (!threadId) return reply.code(400).send({ error: "Invalid thread id" });
    if (!(await ensureThreadAccess(threadId, userId, reply))) return;

    const canCreateMessage = await consumeChatRateLimit({
      scope: "message-create",
      userId,
      limit: Math.max(10, CONFIG.CHAT_RATE_LIMIT_PER_MINUTE)
    });
    if (!canCreateMessage) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const body = (req.body as any) || {};
    const contentText = String(body.contentText ?? body.text ?? "").trim();
    const contentJson =
      body.contentJson && typeof body.contentJson === "object" && !Array.isArray(body.contentJson)
        ? (body.contentJson as Record<string, unknown>)
        : null;

    if (!contentText && !contentJson) {
      return reply.code(400).send({ error: "Message content is required" });
    }
    if (contentText.length > MAX_MESSAGE_LENGTH) {
      return reply.code(400).send({ error: `Message too long (max ${MAX_MESSAGE_LENGTH})` });
    }

    const insertRes = await db.query<MessageRow>(
      `INSERT INTO chat_messages(thread_id, user_id, role, content_text, content_json)
       VALUES ($1, $2, 'user', $3, $4::jsonb)
       RETURNING id, thread_id, user_id, role, content_text, content_json, created_at`,
      [threadId, userId, contentText, contentJson ? JSON.stringify(contentJson) : null]
    );
    await db.query(`UPDATE chat_threads SET updated_at = NOW() WHERE id = $1 AND user_id = $2`, [threadId, userId]);
    const userMessage = insertRes.rows[0];
    if (!userMessage) {
      return reply.code(500).send({ error: "Failed to persist user message" });
    }

    const requestId = randomUUID();
    opts.streamManager.createSession({
      requestId,
      userId,
      threadId
    });

    const role = String((user as any)?.role || "").trim();
    const departmentId = await requestUserDepartmentIdWithAdminFallback(user);

    void (async () => {
      try {
        const result = await opts.agentService.run({
          threadId,
          userMessageId: Number(userMessage.id),
          requestId,
          userContext: {
            userId,
            username,
            role,
            departmentId
          },
          callbacks: {
            onToken: (token) => {
              opts.streamManager.pushEvent(requestId, "token", { token });
            },
            onToolCall: (event) => {
              opts.streamManager.pushEvent(requestId, "tool_call", {
                toolName: event.toolName,
                status: event.status,
                message: event.message ?? null
              });
            }
          }
        });
        opts.streamManager.pushEvent(requestId, "final", {
          message: result.assistantMessage
        });
      } catch (error: any) {
        opts.streamManager.pushEvent(requestId, "error", {
          message: String(error?.message || "Agent execution failed")
        });
      } finally {
        opts.streamManager.markDone(requestId);
      }
    })();

    return reply.code(202).send({
      requestId,
      userMessage: messageResponse(userMessage)
    });
  });

  app.post("/chat/uploads/session", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = getRequestUser(req);
    const userId = requestUserId(user);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const departmentId = await requestUserDepartmentIdWithAdminFallback(user);
    if (!departmentId || departmentId <= 0) {
      return reply.code(403).send({ error: "Department assignment required." });
    }

    const sessionProject = await getOrCreateChatUploadSessionProject({
      username: userId,
      departmentId
    });

    const filesRes = await db.query<ChatUploadSessionFileRow>(
      `SELECT id, original_name, file_type, file_type_config_id, status::text AS status, created_at
       FROM project_files
       WHERE project_id = $1
         AND COALESCE(status::text, '') <> 'placeholder'
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [sessionProject.id]
    );

    return {
      session: {
        projectId: Number(sessionProject.id),
        name: String(sessionProject.name || ""),
        status: String(sessionProject.status || ""),
        sourceLang: String(sessionProject.src_lang || ""),
        targetLang: String(sessionProject.tgt_lang || ""),
        files: filesRes.rows.map((row) => ({
          fileId: Number(row.id),
          filename: String(row.original_name || ""),
          fileType: row.file_type ? String(row.file_type) : null,
          fileTypeConfigId:
            row.file_type_config_id != null && Number.isFinite(Number(row.file_type_config_id))
              ? Number(row.file_type_config_id)
              : null,
          status: row.status ? String(row.status) : null,
          createdAt: new Date(row.created_at).toISOString()
        }))
      }
    };
  });

  app.get("/chat/threads/:id/stream", { preHandler: [requireAuth] }, async (req: any, reply) => {
    const userId = requestUserIdInt(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const canOpenStream = await consumeChatRateLimit({
      scope: "stream-open",
      userId,
      limit: Math.max(30, CONFIG.CHAT_RATE_LIMIT_PER_MINUTE * 3)
    });
    if (!canOpenStream) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const threadId = parseThreadId(req.params.id);
    if (!threadId) return reply.code(400).send({ error: "Invalid thread id" });
    if (!(await ensureThreadAccess(threadId, userId, reply))) return;

    const requestId = String((req.query as any)?.requestId || "").trim();
    if (!requestId) return reply.code(400).send({ error: "requestId is required" });

    const session = opts.streamManager.getSession(requestId);
    if (!session || session.userId !== userId || session.threadId !== threadId) {
      return reply.code(404).send({ error: "Stream not found" });
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    reply.hijack();

    const lastEventId = readLastEventId(req);
    const replayEvents = opts.streamManager.getEventsSince(requestId, lastEventId);
    replayEvents.forEach((event) => writeSseEvent(reply, event));

    if (session.done && (replayEvents.length === 0 || replayEvents.some((event) => event.type === "final" || event.type === "error"))) {
      reply.raw.end();
      return;
    }

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 15_000);

    const unsubscribe = opts.streamManager.subscribe(requestId, (event) => {
      writeSseEvent(reply, event);
      if (event.type === "final" || event.type === "error") {
        clearInterval(heartbeat);
        unsubscribe?.();
        reply.raw.end();
      }
    });

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });
};
