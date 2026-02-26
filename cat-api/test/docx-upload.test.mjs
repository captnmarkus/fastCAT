import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = String(process.env.FASTCAT_BASE_URL || "http://localhost:9991").replace(/\/$/, "");
const TM_API_BASE = String(process.env.FASTCAT_TM_BASE || `${BASE_URL}/api`).replace(/\/$/, "");
const CAT_API_BASE = String(process.env.FASTCAT_CAT_BASE || `${BASE_URL}/api/cat`).replace(/\/$/, "");
const ADMIN_USER = process.env.FASTCAT_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.FASTCAT_ADMIN_PASS || "FastCAT!12345";

const SAMPLE_DOCX_BASE64 =
  "UEsDBBQAAAAIAMFkKlydxYoq8gAAALkBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE73kKy1eUOHBACCXpgZ8jcCgPsLI3iVV7bXnd0r49TgtFQpSjNfPNrKdb7b0TO0xsA/XyummlQNLBWJp6+b5+ru+k4AxkwAXCXh6Q5WqouvUhIosCE/dyzjneK8V6Rg/chIhUlDEkD7k806Qi6A1MqG7a9lbpQBkp13nJkEMlRPeII2xdFk/7opxuSehYioeTd6nrJcTorIZcdLUj86uo/ippCnn08GwjXxWDVJdKFvFyxw/6WiZK1qB4g5RfwBej+gjJKBP01he4+T/pj2vDOFqNZ35JiyloZC7be9ecFQ+Wvn/RqePwQ/UJUEsDBBQAAAAIAMFkKlxAoFMJsgAAAC8BAAALAAAAX3JlbHMvLnJlbHONz7sOgjAUBuCdp2jOLgUHYwyFxZiwGnyApj2URnpJWy+8vR0cxDg4ntt38jfd08zkjiFqZxnUZQUErXBSW8XgMpw2eyAxcSv57CwyWDBC1xbNGWee8k2ctI8kIzYymFLyB0qjmNDwWDqPNk9GFwxPuQyKei6uXCHdVtWOhk8D2oKQFUt6ySD0sgYyLB7/4d04aoFHJ24Gbfrx5WsjyzwoTAweLkgq3+0ys0BzSrqK2RYvUEsDBBQAAAAIAMFkKlzjsYl4uwAAABUBAAARAAAAd29yZC9kb2N1bWVudC54bWw9j8EOgjAMhu88xbK7DD0YQwBvxgfQs5msKsnWLusUeXs3CN6+P22+9m+OX2fFBwIPhK3clpUUgD2ZAZ+tvF5Om4MUHDUabQmhlROwPHZFM9aG+rcDjCIZkOuxla8Yfa0U9y9wmkvygGn2oOB0TDE81UjB+EA9MKcDzqpdVe2V0wPKrhAiWe9kpoxz8AvNHFaeU+zOYC2JRyAnWDtv4RaDRrY6piZleu7bqLy3GtRfkXE2Z1juZVr7dMUPUEsBAhQAFAAAAAgAwWQqXJ3FiiryAAAAuQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACADBZCpcQKBTCbIAAAAvAQAACwAAAAAAAAAAAAAAgAEjAQAAX3JlbHMvLnJlbHNQSwECFAAUAAAACADBZCpc47GJeLsAAAAVAQAAEQAAAAAAAAAAAAAAgAH+AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA6AIAAAAA";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

async function ensureDocxConfig(token) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/resources/file-types`, {
    headers: { ...authHeaders(token) }
  });
  assert.equal(res.status, 200, `list file types failed: ${JSON.stringify(payload)}`);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const existing = items.find((item) => String(item?.config?.fileType || "").toLowerCase() === "docx" && !item.disabled);
  if (existing) return existing.id;

  const name = `Docx Test ${Date.now()}`;
  const createRes = await requestJson(`${CAT_API_BASE}/resources/file-types`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      name,
      description: "Docx test config",
      disabled: false,
      config: {
        fileType: "docx",
        docx: { segmenter: "lines" }
      }
    })
  });
  assert.equal(createRes.res.status, 200, `create file type failed: ${JSON.stringify(createRes.payload)}`);
  return createRes.payload?.item?.id;
}

async function createProject(token, name) {
  const bootstrapTempKey = `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
          filename: "seed.docx"
        }
      ]
    })
  });
  assert.equal(res.status, 200, `create project failed: ${JSON.stringify(payload)}`);
  return payload?.project;
}

async function presignUpload(token, projectId, filename, contentType, fileTypeConfigId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects/${projectId}/files/presign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ filename, contentType, fileTypeConfigId })
  });
  assert.equal(res.status, 200, `presign failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function finalizeUpload(token, projectId, fileId, fileTypeConfigId) {
  return requestJson(`${CAT_API_BASE}/projects/${projectId}/files/${fileId}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ fileTypeConfigId })
  });
}

test("DOCX finalize succeeds", async () => {
  const token = await login();
  const fileTypeConfigId = await ensureDocxConfig(token);
  const project = await createProject(token, `docx-test-${Date.now()}`);
  assert.ok(project?.id, "missing project id");

  const docxBuffer = Buffer.from(SAMPLE_DOCX_BASE64, "base64");
  const presign = await presignUpload(token, project.id, "sample_translation.docx", DOCX_CONTENT_TYPE, fileTypeConfigId);

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || {},
    body: docxBuffer
  });
  assert.ok(putRes.ok, `S3 upload failed: ${putRes.status}`);

  const finalize = await finalizeUpload(token, project.id, presign.fileId, fileTypeConfigId);
  assert.equal(finalize.res.status, 200, `finalize failed: ${JSON.stringify(finalize.payload)}`);
  assert.ok(Number(finalize.payload?.createdSegments ?? 0) > 0, "expected segments to be created");

  const filesRes = await requestJson(`${CAT_API_BASE}/projects/${project.id}/files`, {
    headers: { ...authHeaders(token) }
  });
  assert.equal(filesRes.res.status, 200, `list files failed: ${JSON.stringify(filesRes.payload)}`);
  const files = Array.isArray(filesRes.payload?.files) ? filesRes.payload.files : [];
  assert.ok(files.some((f) => Number(f.fileId) === Number(presign.fileId)), "file record missing");
});

test("DOCX finalize rejects invalid file", async () => {
  const token = await login();
  const fileTypeConfigId = await ensureDocxConfig(token);
  const project = await createProject(token, `docx-invalid-${Date.now()}`);
  assert.ok(project?.id, "missing project id");

  const invalidBuffer = Buffer.from("not a docx");
  const presign = await presignUpload(token, project.id, "invalid.docx", DOCX_CONTENT_TYPE, fileTypeConfigId);

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || {},
    body: invalidBuffer
  });
  assert.ok(putRes.ok, `S3 upload failed: ${putRes.status}`);

  const finalize = await finalizeUpload(token, project.id, presign.fileId, fileTypeConfigId);
  assert.ok([415, 422].includes(finalize.res.status), `unexpected status: ${finalize.res.status}`);
  const errorText = String(finalize.payload?.error || "");
  assert.ok(errorText.toLowerCase().includes("conversion") || errorText.toLowerCase().includes("docx"));
});
