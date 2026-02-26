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

async function createTermbase(token) {
  const name = `concordance-test-${Date.now()}`;
  const { res, payload } = await requestJson(`${CAT_API_BASE}/termbases`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      name,
      languages: ["de", "en"]
    })
  });
  assert.equal(res.status, 201, `create termbase failed: ${JSON.stringify(payload)}`);
  return payload?.termbase;
}

async function createEntry(token, termbaseId, entry) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/termbases/${termbaseId}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(entry)
  });
  assert.equal(res.status, 201, `create entry failed: ${JSON.stringify(payload)}`);
  return payload?.entry?.entryId;
}

async function addTerm(token, termbaseId, entryId, term) {
  const { res, payload } = await requestJson(
    `${CAT_API_BASE}/termbases/${termbaseId}/entries/${encodeURIComponent(entryId)}/terms`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(term)
    }
  );
  assert.equal(res.status, 201, `add term failed: ${JSON.stringify(payload)}`);
}

async function updateEntryFields(token, termbaseId, entryId, fields) {
  const { res, payload } = await requestJson(
    `${CAT_API_BASE}/termbases/${termbaseId}/entries/${encodeURIComponent(entryId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ entryFields: fields })
    }
  );
  assert.equal(res.status, 200, `update entry failed: ${JSON.stringify(payload)}`);
}

function loadFixture() {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");
  const fixturePath = path.join(repoRoot, "test", "fixtures", "termbase-concordance.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
}

test("Termbase concordance ranks preferred and dedups entries", async () => {
  const token = await login();
  const termbase = await createTermbase(token);
  assert.ok(termbase?.id, "missing termbase id");

  const fixture = loadFixture();
  const entryIds = [];
  for (const entry of fixture.entries) {
    const entryId = await createEntry(token, termbase.id, entry);
    assert.ok(entryId, "missing entry id");
    entryIds.push(entryId);
  }

  for (const synonym of fixture.synonyms) {
    const entryId = entryIds[synonym.entryIndex];
    await addTerm(token, termbase.id, entryId, {
      language: synonym.language,
      text: synonym.text,
      status: synonym.status
    });
  }

  for (const patch of fixture.entryFields) {
    const entryId = entryIds[patch.entryIndex];
    await updateEntryFields(token, termbase.id, entryId, patch.fields);
  }

  const { res, payload } = await requestJson(
    `${CAT_API_BASE}/termbases/${termbase.id}/concordance?sourceLang=de&targetLang=en&q=Satz&mode=search&limit=10&searchSource=true&searchTarget=false&includeDeprecated=true&includeForbidden=true`,
    { headers: { ...authHeaders(token) } }
  );

  assert.equal(res.status, 200, `concordance failed: ${JSON.stringify(payload)}`);
  const entries = payload?.entries || [];
  assert.ok(entries.length >= 2, "expected multiple concordance entries");

  const regionalSource = await requestJson(
    `${CAT_API_BASE}/termbases/${termbase.id}/concordance?sourceLang=de-DE&targetLang=en-GB&q=Satz&mode=search&limit=10&searchSource=true&searchTarget=false&includeDeprecated=true&includeForbidden=true`,
    { headers: { ...authHeaders(token) } }
  );
  assert.equal(
    regionalSource.res.status,
    200,
    `regional source concordance failed: ${JSON.stringify(regionalSource.payload)}`
  );
  const regionalSourceEntries = regionalSource.payload?.entries || [];
  assert.ok(regionalSourceEntries.length >= 2, "expected regional source concordance results");

  const regionalTarget = await requestJson(
    `${CAT_API_BASE}/termbases/${termbase.id}/concordance?sourceLang=de-DE&targetLang=en-GB&q=sentence&mode=search&limit=10&searchSource=false&searchTarget=true&includeDeprecated=true&includeForbidden=true`,
    { headers: { ...authHeaders(token) } }
  );
  assert.equal(
    regionalTarget.res.status,
    200,
    `regional target concordance failed: ${JSON.stringify(regionalTarget.payload)}`
  );
  const regionalTargetEntries = regionalTarget.payload?.entries || [];
  assert.ok(regionalTargetEntries.length >= 1, "expected regional target concordance results");
  assert.equal(
    regionalTargetEntries[0]?.entryId,
    entryIds[0],
    "preferred target entry should be returned for regional tags"
  );

  assert.equal(entries[0]?.entryId, entryIds[0], "preferred entry should rank first");
  const dedupCount = entries.filter((entry) => entry.entryId === entryIds[0]).length;
  assert.equal(dedupCount, 1, "entry should be de-duplicated");

  const firstEntry = entries.find((entry) => entry.entryId === entryIds[0]);
  const sourceTerms = (firstEntry?.sourceTerms || []).map((term) => term.text);
  assert.ok(sourceTerms.includes("Satz"), "missing primary source term");
  assert.ok(sourceTerms.includes("Satzung"), "missing synonym source term");

  const secondEntry = entries.find((entry) => entry.entryId === entryIds[1]);
  assert.ok(secondEntry, "missing secondary entry");
  if (secondEntry?.entryFields) {
    assert.equal(secondEntry.entryFields.Kategorie ?? null, null, "null fields should remain null");
    assert.equal(secondEntry.entryFields.Illustration ?? null, null, "null illustration should remain null");
  }
});
