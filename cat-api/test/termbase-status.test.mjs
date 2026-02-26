import test from "node:test";
import assert from "node:assert/strict";

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
  const name = `status-test-${Date.now()}`;
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

async function createEntry(token, termbaseId) {
  const { res, payload } = await requestJson(`${CAT_API_BASE}/termbases/${termbaseId}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      sourceLang: "de",
      targetLang: "en",
      sourceTerm: "Rollenlager",
      targetTerm: "bearing",
      status: "preferred"
    })
  });
  assert.equal(res.status, 201, `create entry failed: ${JSON.stringify(payload)}`);
  return payload?.entry?.entryId;
}

async function fetchEntry(token, termbaseId, entryId) {
  return requestJson(`${CAT_API_BASE}/termbases/${termbaseId}/entries/${encodeURIComponent(entryId)}`, {
    headers: { ...authHeaders(token) }
  });
}

function flattenTerms(entry) {
  const sections = Array.isArray(entry?.languages) ? entry.languages : [];
  return sections.reduce((acc, section) => {
    const terms = Array.isArray(section?.terms) ? section.terms : [];
    return acc.concat(terms);
  }, []);
}

test("Term status update persists", async () => {
  const token = await login();
  const termbase = await createTermbase(token);
  assert.ok(termbase?.id, "missing termbase id");

  const entryId = await createEntry(token, termbase.id);
  assert.ok(entryId, "missing entry id");

  const detail = await fetchEntry(token, termbase.id, entryId);
  assert.equal(detail.res.status, 200, `fetch entry failed: ${JSON.stringify(detail.payload)}`);
  const terms = flattenTerms(detail.payload?.entry);
  assert.ok(terms.length > 0, "missing terms");
  const term = terms[0];
  assert.ok(term?.termId, "missing term id");

  const update = await requestJson(`${CAT_API_BASE}/terms/${encodeURIComponent(term.termId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ status: "allowed" })
  });
  assert.equal(update.res.status, 200, `update term failed: ${JSON.stringify(update.payload)}`);
  assert.equal(update.payload?.term?.status, "allowed");

  const after = await fetchEntry(token, termbase.id, entryId);
  assert.equal(after.res.status, 200, `fetch entry failed: ${JSON.stringify(after.payload)}`);
  const afterTerms = flattenTerms(after.payload?.entry);
  const updatedTerm = afterTerms.find((item) => item?.termId === term.termId);
  assert.equal(updatedTerm?.status, "allowed");
});
