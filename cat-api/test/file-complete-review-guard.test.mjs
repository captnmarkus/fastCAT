import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = String(process.env.FASTCAT_BASE_URL || "http://localhost:9991").replace(/\/$/, "");
const TM_API_BASE = String(process.env.FASTCAT_TM_BASE || `${BASE_URL}/api`).replace(/\/$/, "");
const CAT_API_BASE = String(process.env.FASTCAT_CAT_BASE || `${BASE_URL}/api/cat`).replace(/\/$/, "");
const ADMIN_USER = process.env.FASTCAT_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.FASTCAT_ADMIN_PASS || "FastCAT!12345";

const SAMPLE_XLF = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2">
  <file source-language="de" target-language="en" datatype="plaintext" original="test.txt">
    <body>
      <trans-unit id="1">
        <source>Dies ist ein Test.</source>
        <target></target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
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

async function createProject(token, filename) {
  const bootstrapTempKey = `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const bootstrapFilename = String(filename || "").trim() || "seed.xlf";
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      name: `file-complete-guard-${Date.now()}`,
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

async function presignUpload(token, projectId, fileId, filename) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/presign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      fileId,
      filename,
      contentType: "application/x-xliff+xml"
    })
  });
  assert.equal(res.status, 200, `presign failed: ${JSON.stringify(payload)}`);
  return payload;
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

test("file complete reviewed rejects while draft segments remain", async () => {
  const token = await login();
  const created = await createProject(token, "review-guard.xlf");
  const project = created.project;
  assert.ok(project?.id, "missing project id");

  const presign = await presignUpload(token, project.id, created.fileId, "review-guard.xlf");
  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || {},
    body: Buffer.from(SAMPLE_XLF, "utf8")
  });
  assert.ok(putRes.ok, `S3 upload failed: ${putRes.status}`);

  const finalize = await requestJson(`${CAT_API_BASE}/projects/${project.id}/files/${created.fileId}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({})
  });
  assert.equal(finalize.res.status, 200, `finalize failed: ${JSON.stringify(finalize.payload)}`);
  await waitForProjectReady(token, project.id);

  const complete = await requestJson(`${CAT_API_BASE}/files/${created.fileId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ mode: "reviewed" })
  });

  assert.equal(complete.res.status, 409, `complete should be blocked: ${JSON.stringify(complete.payload)}`);
  assert.equal(complete.payload?.code, "COMPLETE_REQUIRES_UNDER_REVIEW");
  assert.ok(Number(complete.payload?.details?.draft ?? 0) > 0);
});
