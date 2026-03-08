#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE_URL = String(process.env.FASTCAT_BASE_URL || "http://localhost:9991").replace(/\/$/, "");
const TM_API_BASE = String(process.env.FASTCAT_TM_BASE || `${BASE_URL}/api`).replace(/\/$/, "");
const CAT_API_BASE = String(process.env.FASTCAT_CAT_BASE || `${BASE_URL}/api/cat`).replace(/\/$/, "");
const CHAT_API_BASE = String(process.env.FASTCAT_CHAT_BASE || `${BASE_URL}/api/chat`).replace(/\/$/, "");
const INTERNAL_CHAT_API_BASE = `${BASE_URL}/api/chat/internal/tools`;

const ADMIN_USER = process.env.FASTCAT_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.FASTCAT_ADMIN_PASS || "FastCAT!12345";
const MANAGER_USER = process.env.FASTCAT_MANAGER_USER || "smoke_manager";
const MANAGER_PASS = process.env.FASTCAT_MANAGER_PASS || "FastCAT!12345";
const REVIEWER_USER = process.env.FASTCAT_REVIEWER_USER || "smoke_reviewer";
const REVIEWER_PASS = process.env.FASTCAT_REVIEWER_PASS || "FastCAT!12345";
const DEFAULT_DEPARTMENT_ID = Number(process.env.FASTCAT_DEPARTMENT_ID || 1);
const APP_AGENT_INTERNAL_SECRET =
  process.env.APP_AGENT_INTERNAL_SECRET ||
  process.env.CHAT_AGENT_INTERNAL_SECRET ||
  "changeme-jwt-secret";

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

function logStep(message) {
  process.stdout.write(`[agent-smoke] ${message}\n`);
}

function fixtureContent(name) {
  return fs.readFileSync(path.join(process.cwd(), "cat-api", "test", "fixtures", name), "utf8");
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
  const existing =
    users.find((entry) => String(entry?.username || "").toLowerCase() === String(username).toLowerCase()) || null;

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

  const patchRes = await requestJson(`${TM_API_BASE}/admin/users/${existing.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(adminToken) },
    body: JSON.stringify({
      role,
      departmentId,
      disabled: false
    })
  });
  assertStatus(patchRes.res, patchRes.payload, 200, `update user failed for ${username}`);

  try {
    await loginReady(username, password);
  } catch {
    const resetRes = await requestJson(`${TM_API_BASE}/admin/users/${existing.id}/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(adminToken) },
      body: JSON.stringify({ password })
    });
    assertStatus(resetRes.res, resetRes.payload, 200, `reset password failed for ${username}`);
    await rotatePassword(username, password, password);
  }

  return { ...existing, ...patchRes.payload?.user };
}

function parseSseEvents(rawBody) {
  const events = [];
  const blocks = String(rawBody || "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    const lines = trimmed.split(/\r?\n/);
    let eventName = "";
    const dataParts = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataParts.push(line.slice(5).trim());
      }
    }
    if (!eventName) continue;
    const data = dataParts.join("\n");
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

function latestFinalEvent(events) {
  return [...events].reverse().find((entry) => entry.event === "final") || null;
}

function latestToolSuccess(events, toolName) {
  return (
    [...events].reverse().find(
      (entry) => entry.event === "tool_call" && entry.payload?.toolName === toolName && entry.payload?.status === "succeeded"
    ) || null
  );
}

function getWizardStep(message) {
  return String(message?.contentJson?.wizard?.step || "").trim();
}

function extractProjectIdFromFinalMessage(message) {
  const quickActions = Array.isArray(message?.contentJson?.quickActions) ? message.contentJson.quickActions : [];
  for (const action of quickActions) {
    const projectId = Number(action?.payload?.projectId);
    if (Number.isFinite(projectId) && projectId > 0) {
      return projectId;
    }
  }
  const match = String(message?.contentText || "").match(/\(ID\s+(\d+)\)/i);
  if (match) {
    const projectId = Number(match[1]);
    if (Number.isFinite(projectId) && projectId > 0) return projectId;
  }
  return null;
}

function assertIncludes(text, expected, message) {
  if (!String(text || "").includes(expected)) {
    throw new Error(`${message}. expected to include=${JSON.stringify(expected)} actual=${JSON.stringify(text)}`);
  }
}

async function createChatThread(token, title) {
  const { res, payload } = await requestJson(`${CHAT_API_BASE}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title })
  });
  assertStatus(res, payload, 200, "chat thread create failed");
  const threadId = Number(payload?.thread?.id);
  if (!Number.isFinite(threadId) || threadId <= 0) throw new Error("chat thread id missing");
  return threadId;
}

async function sendChatTurn(token, threadId, payload) {
  const createRes = await requestJson(`${CHAT_API_BASE}/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload)
  });
  assertStatus(createRes.res, createRes.payload, 202, `chat message create failed for thread ${threadId}`);
  const requestId = String(createRes.payload?.requestId || "");
  if (!requestId) throw new Error(`chat requestId missing for thread ${threadId}`);

  const streamRes = await fetch(`${CHAT_API_BASE}/threads/${threadId}/stream?requestId=${encodeURIComponent(requestId)}`, {
    headers: { accept: "text/event-stream", ...authHeaders(token) }
  });
  if (!streamRes.ok) {
    const body = await streamRes.text();
    throw new Error(`chat stream failed for thread ${threadId}: status=${streamRes.status} body=${body}`);
  }
  const rawBody = await streamRes.text();
  const events = parseSseEvents(rawBody);
  const finalEvent = latestFinalEvent(events);
  if (!finalEvent) {
    throw new Error(`chat final event missing for thread ${threadId}: ${rawBody}`);
  }
  return {
    requestId,
    events,
    finalMessage: finalEvent.payload?.message || null
  };
}

async function getOrCreateChatUploadSession(token) {
  const { res, payload } = await requestJson(`${CHAT_API_BASE}/uploads/session`, {
    method: "POST",
    headers: { ...authHeaders(token) }
  });
  assertStatus(res, payload, 200, "create chat upload session failed");
  const session = payload?.session;
  if (!session?.projectId) throw new Error("chat upload session missing projectId");
  return session;
}

async function presignUpload(token, projectId, filename, contentType) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/presign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      filename,
      contentType
    })
  });
  assertStatus(res, payload, 200, `presign failed for ${filename}`);
  return payload;
}

async function finalizeUpload(token, projectId, fileId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/${fileId}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({})
  });
  assertStatus(res, payload, 200, `finalize failed for project=${projectId} file=${fileId}`);
  return payload;
}

async function uploadChatFile(token, params) {
  const session = await getOrCreateChatUploadSession(token);
  const presign = await presignUpload(token, Number(session.projectId), params.filename, params.contentType);
  const putRes = await fetch(String(presign.uploadUrl || ""), {
    method: "PUT",
    headers: presign.headers || {},
    body: Buffer.from(params.content, "utf8")
  });
  if (!putRes.ok) {
    throw new Error(`S3 upload failed for ${params.filename}: status=${putRes.status}`);
  }
  await finalizeUpload(token, Number(session.projectId), Number(presign.fileId));
  return {
    session,
    fileId: Number(presign.fileId),
    filename: params.filename
  };
}

async function waitForProjectReady(token, projectId) {
  const maxAttempts = 240;
  let lastStatus = "unknown";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/provision/status`, {
      headers: { ...authHeaders(token) }
    });
    assertStatus(res, payload, 200, `provision status failed for project ${projectId}`);
    lastStatus = String(payload?.status || "unknown").trim().toLowerCase();
    if (lastStatus === "ready") return payload;
    if (lastStatus === "failed") {
      throw new Error(`project ${projectId} provisioning failed: ${JSON.stringify(payload)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`project ${projectId} did not become ready; last status=${lastStatus}`);
}

async function getProjectFiles(token, projectId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files`, {
    headers: { ...authHeaders(token) }
  });
  assertStatus(res, payload, 200, `project files failed for project ${projectId}`);
  return Array.isArray(payload?.files) ? payload.files : [];
}

async function getInbox(token) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/inbox`, {
    headers: { ...authHeaders(token) }
  });
  assertStatus(res, payload, 200, "inbox failed");
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function assertCreateProjectRequiresFiles(userContext) {
  const { res, payload } = await requestJson(`${INTERNAL_CHAT_API_BASE}/create-project`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-app-agent-secret": APP_AGENT_INTERNAL_SECRET
    },
    body: JSON.stringify({
      userContext,
      args: {
        name: `missing-file-check-${Date.now()}`,
        target_langs: ["en"]
      }
    })
  });
  if (res.status !== 400) {
    throw new Error(`expected missing-file create-project call to fail with 400, got ${res.status}: ${JSON.stringify(payload)}`);
  }
  assertIncludes(JSON.stringify(payload), "at least one file", "missing-file validation should explain file requirement");
}

function assertSummaryShape(messageText, expectedAssignee = null) {
  const requiredSnippets = [
    "Please confirm the project details:",
    "Title:",
    "Uploaded files:",
    "Target languages:",
    "Assignee:",
    "TMX:",
    "LLM / engine:",
    "Rules:",
    "Termbase:"
  ];
  for (const snippet of requiredSnippets) {
    assertIncludes(messageText, snippet, `summary missing ${snippet}`);
  }
  if (expectedAssignee) {
    assertIncludes(messageText, `Assignee: ${expectedAssignee}`, "summary should include the selected assignee");
  }
}

async function skipOptionalStepsUntilConfirm(token, threadId, initialTurn, expectedAssignee = null) {
  let turn = initialTurn;
  let guard = 0;
  while (getWizardStep(turn.finalMessage) !== "confirm") {
    guard += 1;
    if (guard > 8) {
      throw new Error(`wizard did not reach confirmation in time: lastStep=${getWizardStep(turn.finalMessage)}`);
    }
    turn = await sendChatTurn(token, threadId, { contentText: "skip" });
  }
  assertSummaryShape(String(turn.finalMessage?.contentText || ""), expectedAssignee);
  return turn;
}

async function runReviewerFlow(token) {
  const threadId = await createChatThread(token, `reviewer-guided-project-${Date.now()}`);

  let turn = await sendChatTurn(token, threadId, { contentText: "Create a project." });
  if (getWizardStep(turn.finalMessage) !== "title") {
    throw new Error(`reviewer flow should start at title step, got ${getWizardStep(turn.finalMessage)}`);
  }
  assertIncludes(turn.finalMessage?.contentText, "What should I call the project?", "reviewer title prompt missing");

  turn = await sendChatTurn(token, threadId, { contentText: "skip" });
  if (getWizardStep(turn.finalMessage) !== "files") {
    throw new Error(`reviewer flow should ask for files after title skip, got ${getWizardStep(turn.finalMessage)}`);
  }
  assertIncludes(turn.finalMessage?.contentText, "Projects require at least one uploaded file", "reviewer file requirement prompt missing");

  const upload = await uploadChatFile(token, {
    filename: `reviewer-agent-upload-${Date.now()}.xlf`,
    contentType: "application/x-xliff+xml",
    content: fixtureContent("segments-mini.xlf")
  });
  turn = await sendChatTurn(token, threadId, {
    contentText: "I uploaded the requested file.",
    contentJson: {
      uploadedFiles: [
        {
          projectId: Number(upload.session.projectId),
          fileId: upload.fileId,
          filename: upload.filename
        }
      ]
    }
  });
  if (getWizardStep(turn.finalMessage) !== "title") {
    throw new Error(`reviewer flow should return to title after upload, got ${getWizardStep(turn.finalMessage)}`);
  }
  assertIncludes(turn.finalMessage?.contentText, "I can use", "reviewer upload should produce a suggested title");

  turn = await sendChatTurn(token, threadId, { contentText: "default" });
  if (getWizardStep(turn.finalMessage) !== "target_languages") {
    throw new Error(`reviewer flow should ask for target languages after title, got ${getWizardStep(turn.finalMessage)}`);
  }

  const targetLang = String(upload.session.targetLang || "").trim() || "en";
  turn = await sendChatTurn(token, threadId, { contentText: targetLang });
  const stepAfterTargets = getWizardStep(turn.finalMessage);
  if (!["translation_engine", "ruleset", "tmx", "termbase", "confirm"].includes(stepAfterTargets)) {
    throw new Error(`unexpected reviewer step after target languages: ${stepAfterTargets}`);
  }

  turn = await skipOptionalStepsUntilConfirm(token, threadId, turn, REVIEWER_USER);
  turn = await sendChatTurn(token, threadId, { contentText: "create" });

  const toolSuccess = latestToolSuccess(turn.events, "create_project");
  const projectId = extractProjectIdFromFinalMessage(turn.finalMessage);
  if (!toolSuccess || !projectId) {
    throw new Error(`reviewer flow did not create a project: ${JSON.stringify(turn.events)}`);
  }
  await waitForProjectReady(token, projectId);

  const files = await getProjectFiles(token, projectId);
  const assigned = files.flatMap((file) => (Array.isArray(file?.tasks) ? file.tasks : []));
  if (!assigned.some((task) => String(task?.assigneeId || "") === REVIEWER_USER)) {
    throw new Error(`reviewer-created project ${projectId} is not assigned to ${REVIEWER_USER}: ${JSON.stringify(files)}`);
  }

  const inbox = await getInbox(token);
  if (!inbox.some((item) => Number(item?.projectId) === projectId)) {
    throw new Error(`reviewer inbox does not include created project ${projectId}`);
  }

  return { projectId, targetLang, uploadedFileId: upload.fileId };
}

async function runManagerFlow(managerToken) {
  const threadId = await createChatThread(managerToken, `manager-guided-project-${Date.now()}`);

  let turn = await sendChatTurn(managerToken, threadId, { contentText: "Create a project." });
  if (getWizardStep(turn.finalMessage) !== "title") {
    throw new Error(`manager flow should start at title step, got ${getWizardStep(turn.finalMessage)}`);
  }

  const manualTitle = `Manager guided project ${Date.now()}`;
  turn = await sendChatTurn(managerToken, threadId, { contentText: `Title: ${manualTitle}` });
  if (getWizardStep(turn.finalMessage) !== "files") {
    throw new Error(`manager flow should ask for files after title, got ${getWizardStep(turn.finalMessage)}`);
  }

  const upload = await uploadChatFile(managerToken, {
    filename: `manager-agent-upload-${Date.now()}.xlf`,
    contentType: "application/x-xliff+xml",
    content: fixtureContent("segments-mini.xlf")
  });
  turn = await sendChatTurn(managerToken, threadId, {
    contentText: "The upload is ready.",
    contentJson: {
      uploadedFiles: [
        {
          projectId: Number(upload.session.projectId),
          fileId: upload.fileId,
          filename: upload.filename
        }
      ]
    }
  });
  if (getWizardStep(turn.finalMessage) !== "target_languages") {
    throw new Error(`manager flow should ask for target languages after upload, got ${getWizardStep(turn.finalMessage)}`);
  }

  turn = await sendChatTurn(managerToken, threadId, {
    contentText: `Assign it to ${REVIEWER_USER}.`
  });
  if (getWizardStep(turn.finalMessage) !== "target_languages") {
    throw new Error(`manager flow should keep asking for target languages after early assignment, got ${getWizardStep(turn.finalMessage)}`);
  }

  const targetLang = String(upload.session.targetLang || "").trim() || "en";
  turn = await sendChatTurn(managerToken, threadId, { contentText: targetLang });
  const nextStep = getWizardStep(turn.finalMessage);
  if (!["translation_engine", "ruleset", "tmx", "termbase", "confirm"].includes(nextStep)) {
    throw new Error(`manager flow did not recover after early assignment; nextStep=${nextStep}`);
  }

  turn = await skipOptionalStepsUntilConfirm(managerToken, threadId, turn, REVIEWER_USER);
  turn = await sendChatTurn(managerToken, threadId, { contentText: "create" });

  const toolSuccess = latestToolSuccess(turn.events, "create_project");
  const projectId = extractProjectIdFromFinalMessage(turn.finalMessage);
  if (!toolSuccess || !projectId) {
    throw new Error(`manager flow did not create a project: ${JSON.stringify(turn.events)}`);
  }
  await waitForProjectReady(managerToken, projectId);

  const files = await getProjectFiles(managerToken, projectId);
  const assigned = files.flatMap((file) => (Array.isArray(file?.tasks) ? file.tasks : []));
  if (!assigned.some((task) => String(task?.assigneeId || "") === REVIEWER_USER)) {
    throw new Error(`manager-created project ${projectId} is not assigned to ${REVIEWER_USER}: ${JSON.stringify(files)}`);
  }

  return { projectId, targetLang, uploadedFileId: upload.fileId };
}

async function main() {
  logStep(`base=${BASE_URL}`);
  const adminToken = await login(ADMIN_USER, ADMIN_PASS);
  logStep(`admin login ok: ${ADMIN_USER}`);

  const managerUser = await ensureUser(adminToken, {
    username: MANAGER_USER,
    password: MANAGER_PASS,
    role: "manager",
    departmentId: DEFAULT_DEPARTMENT_ID
  });
  const reviewerUser = await ensureUser(adminToken, {
    username: REVIEWER_USER,
    password: REVIEWER_PASS,
    role: "reviewer",
    departmentId: DEFAULT_DEPARTMENT_ID
  });
  logStep("manager/reviewer ensured");

  const managerToken = await loginReady(MANAGER_USER, MANAGER_PASS);
  const reviewerToken = await loginReady(REVIEWER_USER, REVIEWER_PASS);
  logStep("manager/reviewer login ok");

  await assertCreateProjectRequiresFiles({
    userId: Number(reviewerUser?.id || 0),
    username: REVIEWER_USER,
    role: "reviewer",
    departmentId: DEFAULT_DEPARTMENT_ID
  });
  logStep("missing-file create-project validation ok");

  const reviewerFlow = await runReviewerFlow(reviewerToken);
  logStep(`reviewer guided flow ok: project=${reviewerFlow.projectId} file=${reviewerFlow.uploadedFileId}`);

  const managerFlow = await runManagerFlow(managerToken);
  logStep(`manager guided flow ok: project=${managerFlow.projectId} file=${managerFlow.uploadedFileId}`);

  const reviewerInbox = await getInbox(reviewerToken);
  if (!reviewerInbox.some((item) => Number(item?.projectId) === managerFlow.projectId)) {
    throw new Error(`reviewer inbox does not include manager-assigned project ${managerFlow.projectId}`);
  }
  logStep(`reviewer inbox includes manager-assigned project ${managerFlow.projectId}`);

  logStep("guided app-agent project flow smoke check passed");
}

main().catch((err) => {
  process.stderr.write(`[agent-smoke] FAILED: ${err?.stack || err}\n`);
  process.exit(1);
});
