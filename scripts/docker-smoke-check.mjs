#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE_URL = String(process.env.FASTCAT_BASE_URL || "http://localhost:9991").replace(/\/$/, "");
const TM_API_BASE = String(process.env.FASTCAT_TM_BASE || `${BASE_URL}/api`).replace(/\/$/, "");
const CAT_API_BASE = String(process.env.FASTCAT_CAT_BASE || `${BASE_URL}/api/cat`).replace(/\/$/, "");
const CHAT_API_BASE = String(process.env.FASTCAT_CHAT_BASE || `${BASE_URL}/api/chat`).replace(/\/$/, "");

const ADMIN_USER = process.env.FASTCAT_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.FASTCAT_ADMIN_PASS || "FastCAT!12345";

const MANAGER_USER = process.env.FASTCAT_MANAGER_USER || "smoke_manager";
const MANAGER_PASS = process.env.FASTCAT_MANAGER_PASS || "FastCAT!12345";
const REVIEWER_USER = process.env.FASTCAT_REVIEWER_USER || "smoke_reviewer";
const REVIEWER_PASS = process.env.FASTCAT_REVIEWER_PASS || "FastCAT!12345";
const DEFAULT_DEPARTMENT_ID = Number(process.env.FASTCAT_DEPARTMENT_ID || 1);

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  const text = await res.text();
  return text ? { error: text } : null;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const payload = await readJson(res);
  return { res, payload };
}

function assertStatus(res, payload, expected, message) {
  if (res.status !== expected) {
    throw new Error(`${message}. expected=${expected} actual=${res.status} payload=${JSON.stringify(payload)}`);
  }
}

async function login(username, password) {
  const { res, payload } = await requestJson(`${TM_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  assertStatus(res, payload, 200, `login failed for ${username}`);
  const token = payload?.token;
  if (!token) throw new Error(`missing token for ${username}`);
  return token;
}

async function rotatePassword(username, currentPassword, targetPassword) {
  const token = await login(username, currentPassword);
  const interimPassword = `${targetPassword}X`;

  const first = await requestJson(`${TM_API_BASE}/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ currentPassword, newPassword: interimPassword })
  });
  assertStatus(first.res, first.payload, 200, `first password change failed for ${username}`);

  const interimToken = await login(username, interimPassword);
  const second = await requestJson(`${TM_API_BASE}/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(interimToken) },
    body: JSON.stringify({ currentPassword: interimPassword, newPassword: targetPassword })
  });
  assertStatus(second.res, second.payload, 200, `second password change failed for ${username}`);
}

async function loginReady(username, password) {
  let token = await login(username, password);
  const me = await requestJson(`${TM_API_BASE}/auth/me`, {
    headers: { ...authHeaders(token) }
  });
  assertStatus(me.res, me.payload, 200, `auth me failed for ${username}`);
  if (me.payload?.user?.mustChangePassword) {
    await rotatePassword(username, password, password);
    token = await login(username, password);
  }
  return token;
}

async function listAdminUsers(adminToken) {
  const { res, payload } = await requestJson(`${TM_API_BASE}/admin/users`, {
    headers: { ...authHeaders(adminToken) }
  });
  assertStatus(res, payload, 200, "list admin users failed");
  return Array.isArray(payload?.users) ? payload.users : [];
}

async function ensureUser(adminToken, params) {
  const { username, password, role, departmentId } = params;
  const users = await listAdminUsers(adminToken);
  const existing = users.find((u) => String(u?.username || "").toLowerCase() === String(username).toLowerCase()) || null;

  if (!existing) {
    const { res, payload } = await requestJson(`${TM_API_BASE}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(adminToken) },
      body: JSON.stringify({ username, password, role, departmentId })
    });
    assertStatus(res, payload, 201, `create user failed for ${username}`);
    await rotatePassword(username, password, password);
    return payload?.user;
  }

  const patchPayload = {
    role,
    departmentId,
    disabled: false
  };
  const patchRes = await requestJson(`${TM_API_BASE}/admin/users/${existing.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(adminToken) },
    body: JSON.stringify(patchPayload)
  });
  if (patchRes.res.status !== 200) {
    throw new Error(`update user failed for ${username}: status=${patchRes.res.status} payload=${JSON.stringify(patchRes.payload)}`);
  }
  try {
    await loginReady(username, password);
  } catch {
    const resetRes = await requestJson(`${TM_API_BASE}/admin/users/${existing.id}/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(adminToken) },
      body: JSON.stringify({ password })
    });
    if (resetRes.res.status !== 200) {
      throw new Error(`reset password failed for ${username}: status=${resetRes.res.status} payload=${JSON.stringify(resetRes.payload)}`);
    }
    await rotatePassword(username, password, password);
  }

  return { ...existing, ...patchRes.payload?.user };
}

function fixtureContent(name) {
  const fixturePath = path.join(process.cwd(), "cat-api", "test", "fixtures", name);
  return fs.readFileSync(fixturePath, "utf-8");
}

async function createProject(token, name, filename) {
  const bootstrapTempKey = `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const bootstrapFilename = String(filename || "").trim() || "seed.xlf";
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      name,
      srcLang: "de",
      tgtLang: "en",
      departmentId: DEFAULT_DEPARTMENT_ID,
      files: [
        {
          tempKey: bootstrapTempKey,
          filename: bootstrapFilename
        }
      ]
    })
  });
  assertStatus(res, payload, 200, `create project failed (${name})`);
  const id = payload?.project?.id;
  if (!id) throw new Error(`project id missing for ${name}`);
  const bootstrapFileId = Number(
    (Array.isArray(payload?.files) ? payload.files : []).find((entry) => String(entry?.tempKey || "") === bootstrapTempKey)?.fileId
  );
  if (!Number.isFinite(bootstrapFileId) || bootstrapFileId <= 0) {
    throw new Error(`bootstrap file id missing for ${name}`);
  }
  return {
    project: payload.project,
    bootstrapFileId
  };
}

async function presignUpload(token, projectId, fileId, filename, contentType) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/presign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      fileId,
      filename,
      contentType
    })
  });
  assertStatus(res, payload, 200, `presign failed (${filename})`);
  return payload;
}

async function finalizeUpload(token, projectId, fileId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/${fileId}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({})
  });
  assertStatus(res, payload, 200, `finalize failed (project=${projectId}, file=${fileId})`);
  return payload;
}

async function waitForProjectReady(token, projectId) {
  const maxAttempts = 240;
  let lastStatus = "unknown";
  for (let i = 0; i < maxAttempts; i += 1) {
    const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/provision/status`, {
      headers: { ...authHeaders(token) }
    });
    assertStatus(res, payload, 200, `provision status failed for project ${projectId}`);
    lastStatus = String(payload?.status || "unknown").toLowerCase();
    if (lastStatus === "ready") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`project ${projectId} did not become ready; last status=${lastStatus}`);
}

async function fetchSegments(token, fileId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/files/${fileId}/segments?limit=5`, {
    headers: { ...authHeaders(token) }
  });
  assertStatus(res, payload, 200, `fetch segments failed for file ${fileId}`);
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  if (segments.length === 0) throw new Error(`no segments found for file ${fileId}`);
  return segments;
}

async function runFileFlow(label, token, filename) {
  const created = await createProject(token, `${label}-${Date.now()}`, filename);
  const project = created.project;
  const fileId = created.bootstrapFileId;
  const content = fixtureContent("segments-mini.xlf");

  const presign = await presignUpload(token, project.id, fileId, filename, "application/x-xliff+xml");
  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || {},
    body: Buffer.from(content, "utf8")
  });
  if (!putRes.ok) {
    throw new Error(`S3 upload failed (${filename}): status=${putRes.status}`);
  }
  await finalizeUpload(token, project.id, fileId);

  await waitForProjectReady(token, project.id);
  const segments = await fetchSegments(token, fileId);
  return { projectId: project.id, fileId, segmentCount: segments.length };
}

function parseSseEvents(rawBody) {
  const events = [];
  const blocks = String(rawBody || "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    const lines = trimmed.split(/\r?\n/);
    let eventName = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!eventName) continue;
    let payload = {};
    if (data) {
      try {
        payload = JSON.parse(data);
      } catch {
        payload = {};
      }
    }
    events.push({ event: eventName, payload });
  }
  return events;
}

async function runChatFlow(label, token) {
  const createThread = await requestJson(`${CHAT_API_BASE}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title: `${label}-thread-${Date.now()}` })
  });
  assertStatus(createThread.res, createThread.payload, 200, `chat thread create failed (${label})`);
  const threadId = Number(createThread.payload?.thread?.id);
  if (!threadId) throw new Error(`chat thread id missing (${label})`);

  const sendMessage = await requestJson(`${CHAT_API_BASE}/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ contentText: "List my projects" })
  });
  assertStatus(sendMessage.res, sendMessage.payload, 202, `chat message create failed (${label})`);
  const requestId = String(sendMessage.payload?.requestId || "");
  if (!requestId) throw new Error(`chat requestId missing (${label})`);

  const stream = await requestJson(
    `${CHAT_API_BASE}/threads/${threadId}/stream?requestId=${encodeURIComponent(requestId)}`,
    {
      headers: { accept: "text/event-stream", ...authHeaders(token) }
    }
  );
  assertStatus(stream.res, stream.payload, 200, `chat stream failed (${label})`);
  const rawBody = typeof stream.payload?.error === "string" ? stream.payload.error : "";
  const events = parseSseEvents(rawBody);
  if (!events.some((entry) => entry.event === "final")) {
    throw new Error(`chat final event missing (${label})`);
  }
  return { threadId, requestId, eventCount: events.length };
}

async function runTermbaseFlow(token) {
  const termbaseName = `smoke-termbase-${Date.now()}`;
  const createTermbase = await requestJson(`${CAT_API_BASE}/termbases`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name: termbaseName, languages: ["de", "en"] })
  });
  assertStatus(createTermbase.res, createTermbase.payload, 201, "create termbase failed");
  const termbaseId = createTermbase.payload?.termbase?.id;
  if (!termbaseId) throw new Error("termbase id missing");

  const createEntry = await requestJson(`${CAT_API_BASE}/termbases/${termbaseId}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      sourceLang: "de",
      targetLang: "en",
      sourceTerm: "Rollenlager",
      targetTerm: "bearing"
    })
  });
  assertStatus(createEntry.res, createEntry.payload, 201, "create termbase entry failed");
  const entryId = createEntry.payload?.entry?.entryId;
  if (!entryId) throw new Error("entry id missing");

  const getEntry = await requestJson(`${CAT_API_BASE}/termbases/${termbaseId}/entries/${encodeURIComponent(entryId)}`, {
    headers: { ...authHeaders(token) }
  });
  assertStatus(getEntry.res, getEntry.payload, 200, "fetch termbase entry failed");

  return { termbaseId, entryId };
}

async function assertReviewerCannotCreateTermbase(token) {
  const res = await requestJson(`${CAT_API_BASE}/termbases`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name: `reviewer-forbidden-${Date.now()}`, languages: ["de", "en"] })
  });
  if (res.res.status !== 403) {
    throw new Error(`reviewer create termbase expected 403 got ${res.res.status} payload=${JSON.stringify(res.payload)}`);
  }
}

function logStep(message) {
  process.stdout.write(`[smoke] ${message}\n`);
}

async function main() {
  logStep(`base=${BASE_URL}`);
  const adminToken = await login(ADMIN_USER, ADMIN_PASS);
  logStep(`admin login ok: ${ADMIN_USER}`);

  await ensureUser(adminToken, {
    username: MANAGER_USER,
    password: MANAGER_PASS,
    role: "manager",
    departmentId: DEFAULT_DEPARTMENT_ID
  });
  await ensureUser(adminToken, {
    username: REVIEWER_USER,
    password: REVIEWER_PASS,
    role: "reviewer",
    departmentId: DEFAULT_DEPARTMENT_ID
  });
  logStep(`manager/reviewer ensured`);

  const managerToken = await loginReady(MANAGER_USER, MANAGER_PASS);
  const reviewerToken = await loginReady(REVIEWER_USER, REVIEWER_PASS);
  logStep(`manager/reviewer login ok`);

  const adminFileFlow = await runFileFlow("admin-file-flow", adminToken, "smoke-admin-file-a.xlf");
  logStep(`admin file flow ok: project=${adminFileFlow.projectId} file=${adminFileFlow.fileId}`);

  const managerFileFlow = await runFileFlow("manager-file-flow", managerToken, "smoke-manager-file-b.xlf");
  logStep(`manager file flow ok: project=${managerFileFlow.projectId} file=${managerFileFlow.fileId}`);

  const reviewerFileFlow = await runFileFlow("reviewer-file-flow", reviewerToken, "smoke-reviewer-file-c.xlf");
  logStep(`reviewer file flow ok: project=${reviewerFileFlow.projectId} file=${reviewerFileFlow.fileId}`);

  const managerChatFlow = await runChatFlow("manager-chat-flow", managerToken);
  logStep(`manager chat flow ok: thread=${managerChatFlow.threadId} events=${managerChatFlow.eventCount}`);

  const reviewerChatFlow = await runChatFlow("reviewer-chat-flow", reviewerToken);
  logStep(`reviewer chat flow ok: thread=${reviewerChatFlow.threadId} events=${reviewerChatFlow.eventCount}`);

  const termbase = await runTermbaseFlow(managerToken);
  logStep(`manager termbase flow ok: termbase=${termbase.termbaseId} entry=${termbase.entryId}`);

  await assertReviewerCannotCreateTermbase(reviewerToken);
  logStep(`reviewer termbase permission check ok (403)`);

  logStep("docker smoke check passed");
}

main().catch((err) => {
  process.stderr.write(`[smoke] FAILED: ${err?.stack || err}\n`);
  process.exit(1);
});
