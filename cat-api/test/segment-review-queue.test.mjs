import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = String(process.env.FASTCAT_BASE_URL || "http://localhost:9991").replace(/\/$/, "");
const TM_API_BASE = String(process.env.FASTCAT_TM_BASE || `${BASE_URL}/api`).replace(/\/$/, "");
const CAT_API_BASE = String(process.env.FASTCAT_CAT_BASE || `${BASE_URL}/api/cat`).replace(/\/$/, "");
const ADMIN_USER = process.env.FASTCAT_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.FASTCAT_ADMIN_PASS || "FastCAT!12345";

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  return text ? { error: text } : null;
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const payload = await readJson(res);
  return { res, payload };
}

async function login() {
  const { res, payload } = await requestJson(`${TM_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
  });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(payload)}`);
  return payload.token;
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
      departmentId: 1,
      files: [
        {
          tempKey: bootstrapTempKey,
          filename: bootstrapFilename
        }
      ]
    })
  });
  assert.equal(res.status, 200, `create project failed: ${JSON.stringify(payload)}`);
  const fileId = Number(
    (Array.isArray(payload?.files) ? payload.files : []).find((entry) => String(entry?.tempKey || "") === bootstrapTempKey)?.fileId
  );
  assert.ok(Number.isFinite(fileId) && fileId > 0, "missing bootstrap file id");
  return { project: payload?.project, fileId };
}

function loadFixture(filename) {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");
  return fs.readFileSync(path.join(repoRoot, "test", "fixtures", filename), "utf-8");
}

async function uploadFile(token, projectId, fileId, filename, content) {
  const presignRes = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/presign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      fileId,
      filename,
      contentType: "application/x-xliff+xml"
    })
  });
  assert.equal(presignRes.res.status, 200, `presign failed: ${JSON.stringify(presignRes.payload)}`);

  const putRes = await fetch(presignRes.payload.uploadUrl, {
    method: "PUT",
    headers: presignRes.payload.headers || {},
    body: Buffer.from(content, "utf8")
  });
  assert.ok(putRes.ok, `S3 upload failed: ${putRes.status}`);

  const finalizeRes = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/${fileId}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({})
  });
  assert.equal(finalizeRes.res.status, 200, `finalize failed: ${JSON.stringify(finalizeRes.payload)}`);
  return fileId;
}

async function waitForProjectReady(token, projectId) {
  const maxAttempts = 240;
  let lastStatus = "unknown";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/provision/status`, {
      headers: { ...authHeaders(token) }
    });
    assert.equal(res.status, 200, `provision status failed: ${JSON.stringify(payload)}`);
    lastStatus = String(payload?.status || "unknown");
    if (lastStatus.toLowerCase() === "ready") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`project ${projectId} did not become ready (last status: ${lastStatus})`);
}

async function getFileSegments(token, fileId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/files/${fileId}/segments?limit=10`, {
    headers: { ...authHeaders(token) }
  });
  assert.equal(res.status, 200, `get segments failed: ${JSON.stringify(payload)}`);
  return payload?.segments ?? [];
}

test("NMT draft review workflow: state + accept clean + mark reviewed", async () => {
  const token = await login();
  const created = await createProject(token, `review-queue-${Date.now()}`, "segments-mini.xlf");
  const project = created.project;
  assert.ok(project?.id, "missing project id");

  const xlfContent = loadFixture("segments-mini.xlf");
  const fileId = await uploadFile(token, project.id, created.fileId, "segments-mini.xlf", xlfContent);
  assert.ok(fileId, "missing file id");
  await waitForProjectReady(token, project.id);

  const [seg1, seg2] = await getFileSegments(token, fileId);
  assert.ok(seg1?.id && seg2?.id, "expected at least two segments");

  const patch1 = await requestJson(`${CAT_API_BASE}/files/${fileId}/segments/${seg1.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      tgt: "Translated value {1} is 10",
      generatedByLlm: true,
      version: seg1.version
    })
  });
  assert.equal(patch1.res.status, 200, `patch1 failed: ${JSON.stringify(patch1.payload)}`);
  assert.equal(patch1.payload?.state, "nmt_draft");

  const patch2 = await requestJson(`${CAT_API_BASE}/files/${fileId}/segments/${seg2.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      tgt: "Sum",
      generatedByLlm: true,
      version: seg2.version
    })
  });
  assert.equal(patch2.res.status, 200, `patch2 failed: ${JSON.stringify(patch2.payload)}`);
  assert.equal(patch2.payload?.state, "nmt_draft");

  const acceptRes = await requestJson(`${CAT_API_BASE}/segments/accept-clean-llm-drafts`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ fileId })
  });
  assert.equal(acceptRes.res.status, 200, `accept clean failed: ${JSON.stringify(acceptRes.payload)}`);
  const acceptedIds = (acceptRes.payload?.segments ?? []).map((s) => s.id);
  assert.ok(acceptedIds.includes(seg1.id), "clean draft should be accepted");
  assert.ok(!acceptedIds.includes(seg2.id), "issue draft should not be accepted");

  const refreshed = await getFileSegments(token, fileId);
  const refreshed1 = refreshed.find((s) => s.id === seg1.id);
  const refreshed2 = refreshed.find((s) => s.id === seg2.id);
  assert.equal(refreshed1?.state, "reviewed");
  assert.equal(refreshed2?.state, "nmt_draft");

  const markRes = await requestJson(`${CAT_API_BASE}/segments/mark-reviewed`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ segmentIds: [seg2.id] })
  });
  assert.equal(markRes.res.status, 200, `mark reviewed failed: ${JSON.stringify(markRes.payload)}`);
  const afterMark = await getFileSegments(token, fileId);
  const marked = afterMark.find((s) => s.id === seg2.id);
  assert.equal(marked?.state, "reviewed");
});
