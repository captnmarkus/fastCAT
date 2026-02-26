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

function loadSampleFields() {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const xmlPath = path.join(repoRoot, "kk_glossar.xml");
  const xml = fs.readFileSync(xmlPath, "utf16le");

  const extract = (pattern, fallback) => {
    const match = xml.match(pattern);
    return match?.[1]?.trim() || fallback;
  };

  return {
    category: extract(/<descrip type="Kategorie">([^<]+)<\/descrip>/i, "Kategorie"),
    productType: extract(/<descrip type="Produkttyp">([^<]+)<\/descrip>/i, "Produkttyp"),
    feature: extract(/<descrip type="Produkteigenschaft">([^<]+)<\/descrip>/i, "Maßangabe"),
    explanation: extract(/<descrip type="Erläuterung">([^<]+)<\/descrip>/i, "Erläuterung"),
    termType: extract(/<descrip type="Typ">([^<]+)<\/descrip>/i, "Typ")
  };
}

async function createTermbase(token, fields) {
  const name = `custom-fields-${Date.now()}`;
  const { res, payload } = await requestJson(`${CAT_API_BASE}/termbases`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      name,
      languages: ["de", "en"],
      structure: {
        entry: [
          { name: "Kategorie", type: "picklist", values: [fields.category, "Other"] },
          { name: "Produkttyp", type: "text" },
          { name: "Erläuterung", type: "text" }
        ],
        language: [{ name: "Produkteigenschaft", type: "text" }],
        term: [
          { name: "Status", type: "picklist", values: ["Preferred", "Allowed", "Forbidden"] },
          { name: "Typ", type: "picklist", values: [fields.termType, "Abkürzung"] },
          { name: "Erläuterung", type: "text" }
        ]
      }
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
      sourceTerm: "Schreibtisch",
      targetTerm: "desk",
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

test("Entry/language/term custom fields merge on patch", async () => {
  const fields = loadSampleFields();
  const token = await login();
  const termbase = await createTermbase(token, fields);
  assert.ok(termbase?.id, "missing termbase id");

  const entryId = await createEntry(token, termbase.id);
  assert.ok(entryId, "missing entry id");

  const patch1 = await requestJson(`${CAT_API_BASE}/termbases/${termbase.id}/entries/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      entryFields: { Kategorie: fields.category }
    })
  });
  assert.equal(patch1.res.status, 200, `entry patch failed: ${JSON.stringify(patch1.payload)}`);

  const patch2 = await requestJson(`${CAT_API_BASE}/termbases/${termbase.id}/entries/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      entryFields: { Produkttyp: fields.productType },
      languageFields: { de: { Produkteigenschaft: fields.feature } }
    })
  });
  assert.equal(patch2.res.status, 200, `entry patch failed: ${JSON.stringify(patch2.payload)}`);

  const detail = await fetchEntry(token, termbase.id, entryId);
  assert.equal(detail.res.status, 200, `fetch entry failed: ${JSON.stringify(detail.payload)}`);
  const entry = detail.payload?.entry;
  assert.equal(entry?.customFields?.Kategorie, fields.category);
  assert.equal(entry?.customFields?.Produkttyp, fields.productType);
  const german = (entry?.languages || []).find((section) => String(section.language).toLowerCase().startsWith("de"));
  assert.equal(german?.customFields?.Produkteigenschaft, fields.feature);

  const term = german?.terms?.[0];
  assert.ok(term?.termId, "missing term id");

  const termPatch1 = await requestJson(`${CAT_API_BASE}/terms/${encodeURIComponent(term.termId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ customFields: { Typ: fields.termType } })
  });
  assert.equal(termPatch1.res.status, 200, `term patch failed: ${JSON.stringify(termPatch1.payload)}`);

  const termPatch2 = await requestJson(`${CAT_API_BASE}/terms/${encodeURIComponent(term.termId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ customFields: { "Erläuterung": fields.explanation } })
  });
  assert.equal(termPatch2.res.status, 200, `term patch failed: ${JSON.stringify(termPatch2.payload)}`);

  const after = await fetchEntry(token, termbase.id, entryId);
  assert.equal(after.res.status, 200, `fetch entry failed: ${JSON.stringify(after.payload)}`);
  const germanAfter = (after.payload?.entry?.languages || []).find((section) =>
    String(section.language).toLowerCase().startsWith("de")
  );
  const updatedTerm = germanAfter?.terms?.find((item) => item.termId === term.termId);
  assert.equal(updatedTerm?.customFields?.Typ, fields.termType);
  assert.equal(updatedTerm?.customFields?.["Erläuterung"], fields.explanation);
});
