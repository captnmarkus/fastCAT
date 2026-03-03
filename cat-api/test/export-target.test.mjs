import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { db, initDatabase } from "../src/db.js";

const BASE_URL = String(process.env.FASTCAT_BASE_URL || "http://localhost:9991").replace(/\/$/, "");
const TM_API_BASE = String(process.env.FASTCAT_TM_BASE || `${BASE_URL}/api`).replace(/\/$/, "");
const CAT_API_BASE = String(process.env.FASTCAT_CAT_BASE || `${BASE_URL}/api/cat`).replace(/\/$/, "");
const ADMIN_USER = process.env.FASTCAT_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.FASTCAT_ADMIN_PASS || "FastCAT!12345";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DOCX_CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n</Types>\n`;

const DOCX_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n</Relationships>\n`;

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case "\"": return "&quot;";
      default: return c;
    }
  });
}

function buildDocxBuffer(lines) {
  const paragraphs = lines.map((line) => {
    const text = escapeXml(line);
    return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  }).join("");
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n  <w:body>\n    ${paragraphs}\n  </w:body>\n</w:document>\n`;
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(DOCX_CONTENT_TYPES_XML, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(DOCX_RELS_XML, "utf8"));
  zip.addFile("word/document.xml", Buffer.from(docXml, "utf8"));
  return zip.toBuffer();
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

  const name = `Docx Export Test ${Date.now()}`;
  const createRes = await requestJson(`${CAT_API_BASE}/resources/file-types`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      name,
      description: "Docx export test config",
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

async function createTaskForFile(projectId, fileId, sourceLang, targetLang, translatorUser = "admin") {
  const normalizedSource = String(sourceLang || "").trim().toLowerCase();
  const normalizedTarget = String(targetLang || "").trim().toLowerCase();
  const insert = await db.query(
    `INSERT INTO translation_tasks(project_id, file_id, source_lang, target_lang, translator_user, status)
     VALUES ($1, $2, $3, $4, $5, 'draft')
     RETURNING id`,
    [projectId, fileId, normalizedSource, normalizedTarget, String(translatorUser || "admin")]
  );
  const taskId = Number(insert.rows[0]?.id);
  assert.ok(Number.isFinite(taskId) && taskId > 0, "expected translation task id");
  return taskId;
}

async function createXmlTemplate(token) {
  const payload = {
    name: `XML Template ${Date.now()}`,
    description: "XML export template",
    kind: "xml",
    config: {
      block_xpath: ["/root/item"],
      inline_xpath: [],
      ignored_xpath: [],
      namespaces: {},
      default_namespace_prefix: null,
      translate_attributes: false,
      attribute_allowlist: [],
      treat_cdata_as_text: true
    }
  };
  const { res, payload: body } = await requestJson(`${CAT_API_BASE}/parsing-templates`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload)
  });
  assert.equal(res.status, 201, `create parsing template failed: ${JSON.stringify(body)}`);
  return body?.template?.id;
}

async function createXmlFileTypeConfig(token, templateId) {
  const name = `XML Config ${Date.now()}`;
  const { res, payload } = await requestJson(`${CAT_API_BASE}/resources/file-types`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      name,
      description: "XML export config",
      disabled: false,
      config: {
        fileType: "xml",
        xml: {
          parsingTemplateId: templateId,
          segmenter: "lines",
          preserveWhitespace: true
        }
      }
    })
  });
  assert.equal(res.status, 200, `create xml file type failed: ${JSON.stringify(payload)}`);
  return payload?.item?.id;
}

async function markTaskReviewed(projectId, fileId) {
  const res = await db.query(
    `UPDATE translation_tasks
     SET status = 'reviewed', updated_at = NOW()
     WHERE project_id = $1 AND file_id = $2`,
    [projectId, fileId]
  );
  assert.ok((res.rowCount ?? 0) > 0, "expected translation task rows to update");
}

test("export target docx applies translations with fallback", async () => {
  await initDatabase();

  const token = await login();
  const fileTypeConfigId = await ensureDocxConfig(token);
  const project = await createProject(token, `docx-export-${Date.now()}`);
  assert.ok(project?.id, "missing project id");

  const lines = ["Alpha source", "Bravo source", "Charlie source"];
  const docxBuffer = buildDocxBuffer(lines);
  const presign = await presignUpload(token, project.id, "sample_export.docx", DOCX_CONTENT_TYPE, fileTypeConfigId);
  await createTaskForFile(project.id, presign.fileId, "de", "en", "admin");

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || {},
    body: docxBuffer
  });
  assert.ok(putRes.ok, `S3 upload failed: ${putRes.status}`);

  const finalize = await finalizeUpload(token, project.id, presign.fileId, fileTypeConfigId);
  assert.equal(finalize.res.status, 200, `finalize failed: ${JSON.stringify(finalize.payload)}`);

  const segRes = await db.query("SELECT id, src FROM segments WHERE file_id = $1 AND task_id IS NULL ORDER BY seg_index", [
    presign.fileId
  ]);
  assert.ok(segRes.rowCount >= 3, `expected >=3 segments, got ${segRes.rowCount}`);
  const [seg1, seg2, seg3] = segRes.rows;

  await db.query("UPDATE segments SET tgt = $1 WHERE id = $2", ["Alpha translated", seg1.id]);
  await db.query("UPDATE segments SET tgt = $1 WHERE id = $2", ["Bravo translated", seg2.id]);

  const blocked = await requestJson(
    `${CAT_API_BASE}/projects/${project.id}/export-target?fileId=${encodeURIComponent(presign.fileId)}&lang=en`,
    { headers: { ...authHeaders(token) } }
  );
  assert.equal(blocked.res.status, 409, `export should be blocked before review done: ${JSON.stringify(blocked.payload)}`);
  assert.equal(blocked.payload?.code, "DOWNLOAD_REQUIRES_REVIEWED");

  await markTaskReviewed(project.id, presign.fileId);

  const exportRes = await fetch(
    `${CAT_API_BASE}/projects/${project.id}/export-target?fileId=${encodeURIComponent(presign.fileId)}&lang=en`,
    { headers: { ...authHeaders(token) } }
  );
  assert.equal(exportRes.status, 200, `export failed: ${exportRes.status}`);
  const docxContentType = exportRes.headers.get("content-type") || "";
  assert.ok(
    docxContentType.includes(DOCX_CONTENT_TYPE),
    `unexpected content-type: ${docxContentType}`
  );
  const buf = Buffer.from(await exportRes.arrayBuffer());
  assert.ok(buf.length > 0, "exported docx is empty");

  const zip = new AdmZip(buf);
  const documentXml = zip.readAsText("word/document.xml");
  assert.ok(documentXml.includes("Alpha translated"), "missing translated segment");
  assert.ok(documentXml.includes("Bravo translated"), "missing translated segment");
  assert.ok(documentXml.includes(seg3.src), "missing fallback source segment");
});

test("export target xml applies translations with fallback", async () => {
  await initDatabase();

  const token = await login();
  const templateId = await createXmlTemplate(token);
  assert.ok(templateId, "missing xml template id");
  const fileTypeConfigId = await createXmlFileTypeConfig(token, templateId);
  assert.ok(fileTypeConfigId, "missing xml file type config id");
  const project = await createProject(token, `xml-export-${Date.now()}`);
  assert.ok(project?.id, "missing project id");

  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <item>One source</item>\n  <item>Two source</item>\n  <item>Three source</item>\n</root>\n`;
  const presign = await presignUpload(token, project.id, "sample_export.xml", "application/xml", fileTypeConfigId);
  await createTaskForFile(project.id, presign.fileId, "de", "en", "admin");

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || {},
    body: Buffer.from(xmlContent, "utf8")
  });
  assert.ok(putRes.ok, `S3 upload failed: ${putRes.status}`);

  const finalize = await finalizeUpload(token, project.id, presign.fileId, fileTypeConfigId);
  assert.equal(finalize.res.status, 200, `finalize failed: ${JSON.stringify(finalize.payload)}`);

  const segRes = await db.query("SELECT id, src FROM segments WHERE file_id = $1 AND task_id IS NULL ORDER BY seg_index", [
    presign.fileId
  ]);
  assert.ok(segRes.rowCount >= 3, `expected >=3 segments, got ${segRes.rowCount}`);
  const [seg1, seg2, seg3] = segRes.rows;

  await db.query("UPDATE segments SET tgt = $1 WHERE id = $2", ["One translated", seg1.id]);
  await db.query("UPDATE segments SET tgt = $1 WHERE id = $2", ["Two translated", seg2.id]);
  await markTaskReviewed(project.id, presign.fileId);

  const exportRes = await fetch(
    `${CAT_API_BASE}/projects/${project.id}/export-target?fileId=${encodeURIComponent(presign.fileId)}&lang=en`,
    { headers: { ...authHeaders(token) } }
  );
  assert.equal(exportRes.status, 200, `export failed: ${exportRes.status}`);
  const xmlContentType = exportRes.headers.get("content-type") || "";
  assert.ok(xmlContentType.includes("application/xml"), `unexpected content-type: ${xmlContentType}`);
  const exportText = await exportRes.text();
  assert.ok(exportText.includes("One translated"), "missing translated segment");
  assert.ok(exportText.includes("Two translated"), "missing translated segment");
  assert.ok(exportText.includes(seg3.src), "missing fallback source segment");
});
