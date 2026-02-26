import test from "node:test";
import assert from "node:assert/strict";
import { db, initDatabase } from "../src/db.js";

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
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  return text ? { error: text } : null;
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const payload = await readJson(res);
  return { res, payload };
}

async function login(username, password) {
  const { res, payload } = await requestJson(`${TM_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  assert.equal(res.status, 200, `login failed for ${username}: ${JSON.stringify(payload)}`);
  return payload.token;
}

async function createManagerUser(adminToken, username, password) {
  const { res, payload } = await requestJson(`${TM_API_BASE}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(adminToken) },
    body: JSON.stringify({
      username,
      password,
      role: "manager",
      departmentId: 1,
      displayName: username
    })
  });
  assert.equal(res.status, 201, `create manager user failed: ${JSON.stringify(payload)}`);
}

async function createProject(adminToken, ownerUsername) {
  const bootstrapTempKey = `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { res, payload } = await requestJson(`${CAT_API_BASE}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(adminToken) },
    body: JSON.stringify({
      name: `tm-import-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      srcLang: "de",
      tgtLang: "en",
      departmentId: 1,
      projectOwnerId: ownerUsername,
      files: [
        {
          tempKey: bootstrapTempKey,
          filename: "seed.xlf"
        }
      ]
    })
  });
  assert.equal(res.status, 200, `create project failed: ${JSON.stringify(payload)}`);
  const projectId = Number(payload?.project?.id);
  assert.ok(Number.isFinite(projectId) && projectId > 0, "missing project id");
  return projectId;
}

async function createTm(adminToken, label) {
  const { res, payload } = await requestJson(`${TM_API_BASE}/tms`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(adminToken) },
    body: JSON.stringify({ name: label })
  });
  assert.equal(res.status, 200, `create tm failed: ${JSON.stringify(payload)}`);
  const tmId = Number(payload?.tm?.id);
  assert.ok(Number.isFinite(tmId) && tmId > 0, "missing tm id");
  return tmId;
}

async function deleteProject(adminToken, projectId) {
  if (!projectId) return;
  await requestJson(`${CAT_API_BASE}/projects/${projectId}`, {
    method: "DELETE",
    headers: { ...authHeaders(adminToken) }
  });
}

async function deleteTm(adminToken, tmId) {
  if (!tmId) return;
  await requestJson(`${TM_API_BASE}/tms/${tmId}`, {
    method: "DELETE",
    headers: { ...authHeaders(adminToken) }
  });
}

async function deleteTmLibraryEntry(adminToken, entryId) {
  if (!entryId) return;
  await requestJson(`${CAT_API_BASE}/admin/tm-library/${entryId}`, {
    method: "DELETE",
    headers: { ...authHeaders(adminToken) }
  });
}

async function uploadTmLibraryEntry(adminToken, params) {
  const form = new FormData();
  form.append("label", params.label);
  form.append("comment", params.comment || "seed");
  form.append(
    "file",
    new Blob([params.content], { type: "application/xml" }),
    params.filename || "seed.tmx"
  );
  const res = await fetch(`${CAT_API_BASE}/admin/tm-library/upload`, {
    method: "POST",
    headers: { ...authHeaders(adminToken) },
    body: form
  });
  const payload = await readJson(res);
  assert.equal(res.status, 200, `upload tm library entry failed: ${JSON.stringify(payload)}`);
  return payload?.entry;
}

async function fetchLatestTmLibraryVersionId(adminToken, entryId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/admin/tm-library/${entryId}/versions`, {
    headers: { ...authHeaders(adminToken) }
  });
  assert.equal(res.status, 200, `tm versions failed: ${JSON.stringify(payload)}`);
  const versions = Array.isArray(payload?.versions) ? payload.versions : [];
  const latestVersionId = Number(versions[0]?.versionId);
  assert.ok(Number.isFinite(latestVersionId) && latestVersionId > 0, "missing latest tm version id");
  return latestVersionId;
}

async function createProjectFileWithTask(params) {
  const {
    projectId,
    translatorUser,
    taskStatus = "reviewed",
    targetLang = "en",
    withOutput = true,
    reviewedSegments = true,
    suffix
  } = params;
  const fileInsert = await db.query(
    `INSERT INTO project_files(project_id, original_name, stored_path, status)
     VALUES ($1, $2, $3, 'ready')
     RETURNING id`,
    [projectId, `sample-${suffix}.txt`, `pending-${suffix}`]
  );
  const fileId = Number(fileInsert.rows[0]?.id);
  assert.ok(Number.isFinite(fileId) && fileId > 0, "missing file id");

  const taskInsert = await db.query(
    `INSERT INTO translation_tasks(project_id, file_id, source_lang, target_lang, translator_user, status)
     VALUES ($1, $2, 'de', $3, $4, $5)
     RETURNING id`,
    [projectId, fileId, targetLang, translatorUser, taskStatus]
  );
  const taskId = Number(taskInsert.rows[0]?.id);
  assert.ok(Number.isFinite(taskId) && taskId > 0, "missing task id");

  const segmentStatus = reviewedSegments ? "reviewed" : "draft";
  await db.query(
    `INSERT INTO segments(project_id, file_id, task_id, seg_index, src, tgt, status, state, updated_by)
     VALUES
      ($1, $2, $3, 0, 'Quelle A', 'Target A', $4, $5, $6),
      ($1, $2, $3, 1, 'Quelle B', 'Target B', $4, $5, $6),
      ($1, $2, $3, 2, 'Quelle C', '', $4, $5, $6)`,
    [projectId, fileId, taskId, segmentStatus, segmentStatus, translatorUser]
  );

  if (withOutput) {
    await db.query(
      `INSERT INTO file_artifacts(project_id, file_id, kind, bucket, object_key, size_bytes, content_type, meta_json, created_by)
       VALUES ($1, $2, 'target_output', 'test-bucket', $3, 123, 'text/plain', $4::jsonb, $5)`,
      [
        projectId,
        fileId,
        `tests/output/${projectId}/${fileId}/${targetLang}/${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        JSON.stringify({ lang: targetLang, filename: `sample-${suffix}.${targetLang}.txt` }),
        translatorUser
      ]
    );
  }

  return { fileId, taskId };
}

async function fetchTmEntryCount(tmId) {
  const { res, payload } = await requestJson(`${TM_API_BASE}/tm/${tmId}/info`, {});
  assert.equal(res.status, 200, `tm info failed: ${JSON.stringify(payload)}`);
  return Number(payload?.entryCount ?? 0);
}

test("project file import-to-tm enforces owner, rejects unfinished files, imports segments, and is idempotent by default", async () => {
  await initDatabase();

  const adminToken = await login(ADMIN_USER, ADMIN_PASS);
  const managerUsername = `mgr_import_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const managerPassword = "FastCAT!12345";

  await createManagerUser(adminToken, managerUsername, managerPassword);
  const managerToken = await login(managerUsername, managerPassword);

  const projectId = await createProject(adminToken, managerUsername);
  const tmId = await createTm(adminToken, `tm-import-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

  try {
    const finished = await createProjectFileWithTask({
      projectId,
      translatorUser: managerUsername,
      taskStatus: "reviewed",
      reviewedSegments: true,
      withOutput: true,
      suffix: "finished"
    });

    const notFinished = await createProjectFileWithTask({
      projectId,
      translatorUser: managerUsername,
      taskStatus: "draft",
      reviewedSegments: false,
      withOutput: true,
      suffix: "draft"
    });

    const denied = await requestJson(
      `${CAT_API_BASE}/projects/${projectId}/files/${finished.fileId}/import-to-tm`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(adminToken) },
        body: JSON.stringify({ tmId, targetLang: "en" })
      }
    );
    assert.equal(denied.res.status, 403, `non-owner call should fail: ${JSON.stringify(denied.payload)}`);

    const unfinished = await requestJson(
      `${CAT_API_BASE}/projects/${projectId}/files/${notFinished.fileId}/import-to-tm`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(managerToken) },
        body: JSON.stringify({ tmId, targetLang: "en" })
      }
    );
    assert.equal(unfinished.res.status, 409, `unfinished file should fail: ${JSON.stringify(unfinished.payload)}`);
    assert.equal(unfinished.payload?.code, "FILE_NOT_FINISHED");

    const beforeCount = await fetchTmEntryCount(tmId);

    const first = await requestJson(
      `${CAT_API_BASE}/projects/${projectId}/files/${finished.fileId}/import-to-tm`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(managerToken) },
        body: JSON.stringify({ tmId, targetLang: "en" })
      }
    );
    assert.equal(first.res.status, 200, `first import failed: ${JSON.stringify(first.payload)}`);
    assert.equal(first.payload?.segmentsImported, 2);
    assert.ok(Number(first.payload?.segmentsSkipped ?? 0) >= 0);

    const afterFirstCount = await fetchTmEntryCount(tmId);
    assert.equal(afterFirstCount, beforeCount + 2, "expected two TM entries after first import");

    const second = await requestJson(
      `${CAT_API_BASE}/projects/${projectId}/files/${finished.fileId}/import-to-tm`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(managerToken) },
        body: JSON.stringify({ tmId, targetLang: "en" })
      }
    );
    assert.equal(second.res.status, 200, `second import failed: ${JSON.stringify(second.payload)}`);
    assert.equal(second.payload?.segmentsImported, 0, "retry should be idempotent in default skip mode");
    assert.ok(Number(second.payload?.segmentsSkipped ?? 0) >= 2);

    const afterSecondCount = await fetchTmEntryCount(tmId);
    assert.equal(afterSecondCount, afterFirstCount, "TM entry count should not increase on retry");
  } finally {
    await deleteProject(adminToken, projectId);
    await deleteTm(adminToken, tmId);
  }
});

test("tm latest-version download reflects finished-segment imports from TM database", async () => {
  await initDatabase();

  const adminToken = await login(ADMIN_USER, ADMIN_PASS);
  const managerUsername = `mgr_tmver_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const managerPassword = "FastCAT!12345";
  await createManagerUser(adminToken, managerUsername, managerPassword);
  const managerToken = await login(managerUsername, managerPassword);

  let projectId = null;
  let tmEntryId = null;

  try {
    const seedTmx = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="test" creationtoolversion="1.0" datatype="PlainText" segtype="sentence" adminlang="en-US" srclang="de" o-tmf="test"/>
  <body>
    <tu>
      <tuv xml:lang="de"><seg>Start Quelle</seg></tuv>
      <tuv xml:lang="en"><seg>Start Target</seg></tuv>
    </tu>
  </body>
</tmx>`;
    const tmEntry = await uploadTmLibraryEntry(adminToken, {
      label: `tm-ver-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      filename: "tm-seed.tmx",
      content: seedTmx
    });
    tmEntryId = Number(tmEntry?.id);
    const tmId = Number(tmEntry?.tmProxyId);
    assert.ok(Number.isFinite(tmEntryId) && tmEntryId > 0, "missing tm library entry id");
    assert.ok(Number.isFinite(tmId) && tmId > 0, "missing tm proxy id");

    projectId = await createProject(adminToken, managerUsername);
    const finished = await createProjectFileWithTask({
      projectId,
      translatorUser: managerUsername,
      taskStatus: "reviewed",
      reviewedSegments: true,
      withOutput: true,
      suffix: "tm-version-live"
    });

    const uniqueSource = `Quelle UNIQUE ${Date.now()} ${Math.floor(Math.random() * 1e6)}`;
    const uniqueTarget = `Target UNIQUE ${Date.now()} ${Math.floor(Math.random() * 1e6)}`;
    await db.query(
      `UPDATE segments
       SET src = $1, tgt = $2
       WHERE project_id = $3
         AND file_id = $4
         AND seg_index = 0`,
      [uniqueSource, uniqueTarget, projectId, finished.fileId]
    );

    const importRes = await requestJson(
      `${CAT_API_BASE}/projects/${projectId}/files/${finished.fileId}/import-to-tm`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(managerToken) },
        body: JSON.stringify({ tmId, targetLang: "en" })
      }
    );
    assert.equal(importRes.res.status, 200, `import to tm failed: ${JSON.stringify(importRes.payload)}`);
    assert.ok(Number(importRes.payload?.segmentsImported ?? 0) >= 1, "expected at least one imported segment");

    const latestVersionId = await fetchLatestTmLibraryVersionId(adminToken, tmEntryId);

    const liveRes = await fetch(`${CAT_API_BASE}/admin/tm-library/download/${tmEntryId}`, {
      headers: { ...authHeaders(adminToken) }
    });
    assert.equal(liveRes.status, 200, "live tm download failed");
    const liveXml = await liveRes.text();
    assert.ok(liveXml.includes(uniqueSource), "live tmx missing imported source segment");
    assert.ok(liveXml.includes(uniqueTarget), "live tmx missing imported target segment");

    const versionRes = await fetch(`${CAT_API_BASE}/admin/tm-library/versions/${latestVersionId}/download`, {
      headers: { ...authHeaders(adminToken) }
    });
    assert.equal(versionRes.status, 200, "version download failed");
    const versionXml = await versionRes.text();
    assert.ok(versionXml.includes(uniqueSource), "current version download missing imported source segment");
    assert.ok(versionXml.includes(uniqueTarget), "current version download missing imported target segment");
  } finally {
    await deleteProject(adminToken, projectId);
    await deleteTmLibraryEntry(adminToken, tmEntryId);
  }
});
