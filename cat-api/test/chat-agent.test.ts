import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { db, initDatabase } from "../src/db.js";
import { CONFIG } from "../src/config.js";
import { AgentService } from "../src/lib/agent-service.js";
import { ChatStreamManager } from "../src/lib/chat-stream-manager.js";
import { chatRoutes } from "../src/routes/chat.js";
import { appAgentRoutes } from "../src/routes/app-agent.js";

type TestUser = {
  id: number;
  username: string;
  role: string;
  departmentId: number;
};

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`
  };
}

async function ensureUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT,
      department_id INTEGER,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createUser(params: { role: string; departmentId: number }) {
  await ensureUsersTable();
  const username = `chat_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await db.query<{ id: number; username: string; role: string; department_id: number }>(
    `INSERT INTO users(username, password_hash, role, department_id, disabled, must_change_password)
     VALUES ($1, '', $2, $3, FALSE, FALSE)
     RETURNING id, username, role, department_id`,
    [username, params.role, params.departmentId]
  );
  const row = res.rows[0];
  assert.ok(row, "test user should be created");
  return {
    id: Number(row.id),
    username: String(row.username),
    role: String(row.role || ""),
    departmentId: Number(row.department_id || 1)
  } as TestUser;
}

async function createMockGateway() {
  const gateway = Fastify({ logger: false });
  gateway.post("/app-agent/chat", async (req: any, reply) => {
    const secret = String(req.headers["x-app-agent-secret"] || "").trim();
    if (!secret || secret !== CONFIG.APP_AGENT_INTERNAL_SECRET) {
      return reply.code(403).send({ error: "denied" });
    }

    const body = (req.body as any) || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages]
      .reverse()
      .find((entry) => String(entry?.role || "").toLowerCase() === "user");
    const prompt = String(lastUser?.contentText || "").trim();
    const finalText = prompt ? `Echo: ${prompt}` : "Echo: Ready.";

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    reply.hijack();
    reply.raw.write(`event: token\ndata: ${JSON.stringify({ token: "Echo: " })}\n\n`);
    reply.raw.write(`event: token\ndata: ${JSON.stringify({ token: prompt || "Ready." })}\n\n`);
    reply.raw.write(
      `event: final\ndata: ${JSON.stringify({
        contentText: finalText,
        contentJson: null
      })}\n\n`
    );
    reply.raw.end();
  });
  await gateway.listen({ host: "127.0.0.1", port: 0 });
  const addr = gateway.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  assert.ok(Number.isFinite(port) && port > 0, "mock gateway port missing");
  return {
    app: gateway,
    url: `http://127.0.0.1:${port}`
  };
}

async function createTestApp(gatewayUrl: string) {
  const app = Fastify({ logger: false });
  const agentService = new AgentService({
    log: app.log,
    systemPrompt: "Test prompt.",
    gatewayUrl,
    gatewayTimeoutMs: 30_000
  });
  const streamManager = new ChatStreamManager();
  await agentService.init();
  await app.register(jwt, { secret: CONFIG.JWT_SECRET });
  await app.register(chatRoutes, { prefix: "/api", agentService, streamManager });
  await app.register(appAgentRoutes, { prefix: "/api", agentService });
  await app.ready();
  return app;
}

function signToken(app: ReturnType<typeof Fastify>, user: TestUser) {
  return app.jwt.sign({
    sub: user.id,
    username: user.username,
    role: user.role,
    departmentId: user.departmentId
  });
}

function parseSseEvents(rawBody: string) {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = rawBody.split(/\r?\n\r?\n/);
  blocks.forEach((block) => {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    const lines = trimmed.split(/\r?\n/);
    let eventName = "";
    let dataPayload = "";
    lines.forEach((line) => {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataPayload += line.slice(5).trim();
      }
    });
    if (!eventName) return;
    let parsedData: any = {};
    if (dataPayload) {
      try {
        parsedData = JSON.parse(dataPayload);
      } catch {
        parsedData = {};
      }
    }
    events.push({ event: eventName, data: parsedData });
  });
  return events;
}

async function cleanupUserData(userId: number, username: string) {
  await db.query("DELETE FROM chat_threads WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM project_files WHERE project_id IN (SELECT id FROM projects WHERE assigned_user = $1)", [username]);
  await db.query("DELETE FROM projects WHERE assigned_user = $1", [username]);
  await db.query("DELETE FROM users WHERE id = $1", [userId]);
}

async function upsertLanguageSettings(params: {
  enabled: string[];
  defaultSource: string;
  defaultTargets: string[];
  allowSingleLanguage?: boolean;
}) {
  await db.query(
    `INSERT INTO org_language_settings(
       id,
       enabled_language_tags,
       default_source_tag,
       default_target_tags,
       allow_single_language,
       updated_at
     )
     VALUES (1, $1::jsonb, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (id) DO UPDATE
     SET enabled_language_tags = EXCLUDED.enabled_language_tags,
         default_source_tag = EXCLUDED.default_source_tag,
         default_target_tags = EXCLUDED.default_target_tags,
         allow_single_language = EXCLUDED.allow_single_language,
         updated_at = NOW()`,
    [
      JSON.stringify(params.enabled),
      params.defaultSource,
      JSON.stringify(params.defaultTargets),
      Boolean(params.allowSingleLanguage)
    ]
  );
}

type LanguageSettingsSnapshot = {
  enabled: string[];
  defaultSource: string;
  defaultTargets: string[];
  allowSingleLanguage: boolean;
} | null;

async function readLanguageSettingsSnapshot(): Promise<LanguageSettingsSnapshot> {
  const res = await db.query<{
    enabled_language_tags: unknown;
    default_source_tag: string | null;
    default_target_tags: unknown;
    allow_single_language: boolean | null;
  }>(
    `SELECT enabled_language_tags, default_source_tag, default_target_tags, allow_single_language
     FROM org_language_settings
     WHERE id = 1
     LIMIT 1`
  );
  const row = res.rows[0];
  if (!row) return null;
  const enabled = Array.isArray(row.enabled_language_tags)
    ? row.enabled_language_tags.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const defaultTargets = Array.isArray(row.default_target_tags)
    ? row.default_target_tags.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  return {
    enabled,
    defaultSource: String(row.default_source_tag || "").trim() || "en",
    defaultTargets,
    allowSingleLanguage: Boolean(row.allow_single_language)
  };
}

async function restoreLanguageSettingsSnapshot(snapshot: LanguageSettingsSnapshot) {
  if (!snapshot) {
    await db.query("DELETE FROM org_language_settings WHERE id = 1");
    return;
  }
  await upsertLanguageSettings({
    enabled: snapshot.enabled,
    defaultSource: snapshot.defaultSource,
    defaultTargets: snapshot.defaultTargets,
    allowSingleLanguage: snapshot.allowSingleLanguage
  });
}

test("chat routes scope threads and messages by user_id", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const userA = await createUser({ role: "manager", departmentId: 1 });
  const userB = await createUser({ role: "manager", departmentId: 1 });
  const app = await createTestApp(gateway.url);

  try {
    const tokenA = signToken(app, userA);
    const tokenB = signToken(app, userB);

    const createThread = await app.inject({
      method: "POST",
      url: "/api/chat/threads",
      headers: {
        ...authHeaders(tokenA),
        "content-type": "application/json"
      },
      payload: { title: "User A Thread" }
    });
    assert.equal(createThread.statusCode, 200, createThread.body);
    const threadId = Number(createThread.json().thread?.id);
    assert.ok(Number.isFinite(threadId) && threadId > 0);

    const listDenied = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: authHeaders(tokenB)
    });
    assert.equal(listDenied.statusCode, 404, listDenied.body);

    const postDenied = await app.inject({
      method: "POST",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        ...authHeaders(tokenB),
        "content-type": "application/json"
      },
      payload: { contentText: "hello" }
    });
    assert.equal(postDenied.statusCode, 404, postDenied.body);
  } finally {
    await app.close();
    await gateway.app.close();
    await cleanupUserData(userA.id, userA.username);
    await cleanupUserData(userB.id, userB.username);
  }
});

test("chat flow persists user and assistant messages", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const user = await createUser({ role: "manager", departmentId: 1 });
  const app = await createTestApp(gateway.url);

  try {
    const token = signToken(app, user);

    const createThread = await app.inject({
      method: "POST",
      url: "/api/chat/threads",
      headers: {
        ...authHeaders(token),
        "content-type": "application/json"
      },
      payload: { title: "Persistence Test" }
    });
    assert.equal(createThread.statusCode, 200, createThread.body);
    const threadId = Number(createThread.json().thread?.id);
    assert.ok(Number.isFinite(threadId) && threadId > 0);

    const postMessage = await app.inject({
      method: "POST",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        ...authHeaders(token),
        "content-type": "application/json"
      },
      payload: {
        contentText: "Hello from persistence test."
      }
    });
    assert.equal(postMessage.statusCode, 202, postMessage.body);
    const requestId = String(postMessage.json().requestId || "");
    assert.ok(requestId, "requestId should be returned");

    const streamResponse = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${threadId}/stream?requestId=${encodeURIComponent(requestId)}`,
      headers: {
        ...authHeaders(token),
        accept: "text/event-stream"
      }
    });
    assert.equal(streamResponse.statusCode, 200, streamResponse.body);
    const events = parseSseEvents(streamResponse.body);
    assert.ok(events.some((entry) => entry.event === "token"), "stream should include token events");
    assert.ok(events.some((entry) => entry.event === "final"), "stream should include final event");

    const messagesRes = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: authHeaders(token)
    });
    assert.equal(messagesRes.statusCode, 200, messagesRes.body);
    const messages = messagesRes.json().messages || [];
    assert.ok(messages.length >= 2, "user and assistant messages should be persisted");
    assert.ok(messages.some((entry: any) => entry.role === "assistant"), "assistant message should be persisted");
  } finally {
    await app.close();
    await gateway.app.close();
    await cleanupUserData(user.id, user.username);
  }
});

test("non-admin cannot access app agent admin config endpoint", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const adminUser = await createUser({ role: "admin", departmentId: 1 });
  const managerUser = await createUser({ role: "manager", departmentId: 1 });
  const app = await createTestApp(gateway.url);

  try {
    const adminToken = signToken(app, adminUser);
    const managerToken = signToken(app, managerUser);

    const denied = await app.inject({
      method: "GET",
      url: "/api/admin/app-agent/config",
      headers: authHeaders(managerToken)
    });
    assert.equal(denied.statusCode, 403, denied.body);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/admin/app-agent/config",
      headers: authHeaders(adminToken)
    });
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.ok(allowed.json().config?.systemPrompt != null, "admin config should be returned");
  } finally {
    await app.close();
    await gateway.app.close();
    await cleanupUserData(adminUser.id, adminUser.username);
    await cleanupUserData(managerUser.id, managerUser.username);
  }
});

test("internal create_project tool rejects empty file_ids", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const managerUser = await createUser({ role: "manager", departmentId: 1 });
  const app = await createTestApp(gateway.url);

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/internal/tools/create-project",
      headers: {
        "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET,
        "content-type": "application/json"
      },
      payload: {
        userContext: {
          userId: managerUser.id,
          username: managerUser.username,
          role: managerUser.role,
          departmentId: managerUser.departmentId
        },
        args: {
          name: "Should Fail",
          source_lang: "en",
          target_langs: ["de"],
          file_ids: []
        }
      }
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /file_id/i);
  } finally {
    await app.close();
    await gateway.app.close();
    await cleanupUserData(managerUser.id, managerUser.username);
  }
});

test("non-manager cannot assign internal create_project to another user", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const reviewerUser = await createUser({ role: "user", departmentId: 1 });
  const managerUser = await createUser({ role: "manager", departmentId: 1 });
  const app = await createTestApp(gateway.url);

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/internal/tools/create-project",
      headers: {
        "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET,
        "content-type": "application/json"
      },
      payload: {
        userContext: {
          userId: reviewerUser.id,
          username: reviewerUser.username,
          role: reviewerUser.role,
          departmentId: reviewerUser.departmentId
        },
        args: {
          source_lang: "en",
          target_langs: ["de"],
          file_ids: [99999],
          assigned_user_id: managerUser.id
        }
      }
    });
    assert.equal(res.statusCode, 403, res.body);
    assert.match(res.body, /managers\/admins/i);
  } finally {
    await app.close();
    await gateway.app.close();
    await cleanupUserData(reviewerUser.id, reviewerUser.username);
    await cleanupUserData(managerUser.id, managerUser.username);
  }
});

test("manager can assign create_project to another user (permission passes)", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const managerUser = await createUser({ role: "manager", departmentId: 1 });
  const reviewerUser = await createUser({ role: "user", departmentId: 1 });
  const app = await createTestApp(gateway.url);
  const languageSnapshot = await readLanguageSettingsSnapshot();

  let engineId: number | null = null;
  try {
    await upsertLanguageSettings({
      enabled: ["en", "de"],
      defaultSource: "en",
      defaultTargets: ["de"],
      allowSingleLanguage: false
    });

    const createdEngine = await db.query<{ id: number }>(
      `INSERT INTO translation_engines(name, disabled)
       VALUES ($1, FALSE)
       RETURNING id`,
      [`agent-engine-${Date.now()}`]
    );
    engineId = Number(createdEngine.rows[0]?.id ?? 0);
    assert.ok(engineId > 0);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat/internal/tools/create-project",
      headers: {
        "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET,
        "content-type": "application/json"
      },
      payload: {
        userContext: {
          userId: managerUser.id,
          username: managerUser.username,
          role: managerUser.role,
          departmentId: managerUser.departmentId
        },
        args: {
          source_lang: "en",
          target_langs: ["de"],
          file_ids: [99999],
          assigned_user_id: reviewerUser.id,
          translation_engine_id: engineId
        }
      }
    });
    assert.notEqual(res.statusCode, 403, res.body);
    assert.match(res.body, /(file_ids could not be found|file_ids|not be found)/i);
  } finally {
    if (engineId != null) {
      await db.query("DELETE FROM translation_engines WHERE id = $1", [engineId]);
    }
    await restoreLanguageSettingsSnapshot(languageSnapshot);
    await app.close();
    await gateway.app.close();
    await cleanupUserData(managerUser.id, managerUser.username);
    await cleanupUserData(reviewerUser.id, reviewerUser.username);
  }
});

test("create_project rejects target language not enabled", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const managerUser = await createUser({ role: "manager", departmentId: 1 });
  const app = await createTestApp(gateway.url);
  const languageSnapshot = await readLanguageSettingsSnapshot();

  try {
    await upsertLanguageSettings({
      enabled: ["en", "de"],
      defaultSource: "en",
      defaultTargets: ["de"],
      allowSingleLanguage: false
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/chat/internal/tools/create-project",
      headers: {
        "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET,
        "content-type": "application/json"
      },
      payload: {
        userContext: {
          userId: managerUser.id,
          username: managerUser.username,
          role: managerUser.role,
          departmentId: managerUser.departmentId
        },
        args: {
          source_lang: "en",
          target_langs: ["fr"],
          file_ids: [99999]
        }
      }
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /not enabled/i);
  } finally {
    await restoreLanguageSettingsSnapshot(languageSnapshot);
    await app.close();
    await gateway.app.close();
    await cleanupUserData(managerUser.id, managerUser.username);
  }
});

test("wizard options include missing-resource notices and assignable-user auth", async () => {
  await initDatabase();
  const gateway = await createMockGateway();
  const managerUser = await createUser({ role: "manager", departmentId: 1 });
  const reviewerUser = await createUser({ role: "user", departmentId: 1 });
  const app = await createTestApp(gateway.url);

  const originalEngines = await db.query<{ id: number; disabled: boolean }>(
    "SELECT id, disabled FROM translation_engines"
  );
  const originalRules = await db.query<{ id: number; disabled: boolean }>(
    "SELECT id, disabled FROM language_processing_rulesets"
  );
  const originalTmx = await db.query<{ id: number; disabled: boolean }>(
    "SELECT id, disabled FROM tm_library"
  );
  const originalTermbases = await db.query<{ id: number; disabled: boolean }>(
    "SELECT id, disabled FROM glossaries"
  );

  try {
    await db.query("UPDATE translation_engines SET disabled = TRUE");
    await db.query("UPDATE language_processing_rulesets SET disabled = TRUE");
    await db.query("UPDATE tm_library SET disabled = TRUE");
    await db.query("UPDATE glossaries SET disabled = TRUE");

    const deniedAssignable = await app.inject({
      method: "POST",
      url: "/api/chat/internal/tools/list-assignable-users",
      headers: {
        "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET,
        "content-type": "application/json"
      },
      payload: {
        userContext: {
          userId: reviewerUser.id,
          username: reviewerUser.username,
          role: reviewerUser.role,
          departmentId: reviewerUser.departmentId
        }
      }
    });
    assert.equal(deniedAssignable.statusCode, 403, deniedAssignable.body);

    const optionsRes = await app.inject({
      method: "POST",
      url: "/api/chat/internal/tools/project-wizard-options",
      headers: {
        "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET,
        "content-type": "application/json"
      },
      payload: {
        userContext: {
          userId: managerUser.id,
          username: managerUser.username,
          role: managerUser.role,
          departmentId: managerUser.departmentId
        }
      }
    });
    assert.equal(optionsRes.statusCode, 200, optionsRes.body);
    const assignmentCfg = optionsRes.json()?.wizard?.configurable?.assignment ?? {};
    assert.equal(Boolean(assignmentCfg.canAssignOthers), true);
    assert.ok(Array.isArray(assignmentCfg.assignableUsers), "assignable users should be included for manager");
    const notices = optionsRes.json()?.wizard?.configurable?.notices ?? [];
    const kinds = new Set<string>(notices.map((entry: any) => String(entry?.kind || "")));
    assert.ok(kinds.has("engine_missing"), "engine_missing notice expected");
    assert.ok(kinds.has("ruleset_missing"), "ruleset_missing notice expected");
    assert.ok(kinds.has("tmx_missing"), "tmx_missing notice expected");
    assert.ok(kinds.has("termbase_missing"), "termbase_missing notice expected");
  } finally {
    for (const row of originalEngines.rows) {
      await db.query("UPDATE translation_engines SET disabled = $2 WHERE id = $1", [
        row.id,
        row.disabled
      ]);
    }
    for (const row of originalRules.rows) {
      await db.query("UPDATE language_processing_rulesets SET disabled = $2 WHERE id = $1", [
        row.id,
        row.disabled
      ]);
    }
    for (const row of originalTmx.rows) {
      await db.query("UPDATE tm_library SET disabled = $2 WHERE id = $1", [
        row.id,
        row.disabled
      ]);
    }
    for (const row of originalTermbases.rows) {
      await db.query("UPDATE glossaries SET disabled = $2 WHERE id = $1", [
        row.id,
        row.disabled
      ]);
    }
    await app.close();
    await gateway.app.close();
    await cleanupUserData(managerUser.id, managerUser.username);
    await cleanupUserData(reviewerUser.id, reviewerUser.username);
  }
});
