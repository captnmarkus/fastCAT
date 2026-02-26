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

async function createTermbase(token) {
  const name = `entry-update-test-${Date.now()}`;
  const { res, payload } = await requestJson(`${CAT_API_BASE}/termbases`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name, languages: ["de", "en"] })
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
      sourceTerm: "einfacher Aufbau",
      targetTerm: "simple structure",
      status: "preferred"
    })
  });
  assert.equal(res.status, 201, `create entry failed: ${JSON.stringify(payload)}`);
  return payload?.entry?.entryId;
}

async function getEntry(token, termbaseId, entryId) {
  const { res, payload } = await requestJson(
    `${CAT_API_BASE}/termbases/${termbaseId}/entries/${encodeURIComponent(entryId)}`,
    { headers: { ...authHeaders(token) } }
  );
  assert.equal(res.status, 200, `get entry failed: ${JSON.stringify(payload)}`);
  return payload?.entry;
}

test("PATCH termbase entry updates term status and text", async () => {
  const token = await login();
  const termbase = await createTermbase(token);
  assert.ok(termbase?.id, "missing termbase id");

  const entryId = await createEntry(token, termbase.id);
  assert.ok(entryId, "missing entry id");

  const entry = await getEntry(token, termbase.id, entryId);
  const deSection = entry?.languages?.find((section) => section.language === "de") ?? entry?.languages?.[0];
  const term = deSection?.terms?.[0];
  assert.ok(term?.termId, "missing term id");
  const entryModifiedAt = entry?.audit?.modifiedAt ?? null;
  const termModifiedAt = term?.audit?.modifiedAt ?? term?.updatedAt ?? null;

  const patchPayload = {
    languages: [
      {
        lang: "de",
        terms: [
          {
            termId: term.termId,
            status: "forbidden",
            text: "einfacher Aufbau neu"
          }
        ]
      }
    ]
  };

  const { res: patchRes, payload: patchBody } = await requestJson(
    `${CAT_API_BASE}/termbases/${termbase.id}/entries/${encodeURIComponent(entryId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(patchPayload)
    }
  );

  assert.equal(patchRes.status, 200, `patch entry failed: ${JSON.stringify(patchBody)}`);
  const patchedEntry = patchBody?.entry;
  const patchedSection = patchedEntry?.languages?.find((section) => section.language === "de");
  const patchedTerm = patchedSection?.terms?.find((item) => item.text === "einfacher Aufbau neu");
  assert.ok(patchedTerm, "patched term not found in response");
  assert.equal(patchedTerm.status, "forbidden", "status should be updated");
  const patchedEntryModifiedAt = patchedEntry?.audit?.modifiedAt ?? null;
  const patchedTermModifiedAt = patchedTerm?.audit?.modifiedAt ?? patchedTerm?.updatedAt ?? null;
  if (entryModifiedAt && patchedEntryModifiedAt) {
    assert.ok(patchedEntryModifiedAt > entryModifiedAt, "entry modifiedAt should bump");
  } else if (termModifiedAt && patchedTermModifiedAt) {
    assert.ok(patchedTermModifiedAt > termModifiedAt, "term modifiedAt should bump");
  }

  const refreshed = await getEntry(token, termbase.id, entryId);
  const refreshedSection = refreshed?.languages?.find((section) => section.language === "de");
  const refreshedTerm = refreshedSection?.terms?.find((item) => item.text === "einfacher Aufbau neu");
  assert.ok(refreshedTerm, "patched term not found after refresh");
  assert.equal(refreshedTerm.status, "forbidden", "status should persist");
  if (entryModifiedAt && refreshed?.audit?.modifiedAt) {
    assert.ok(refreshed.audit.modifiedAt > entryModifiedAt, "entry modifiedAt should persist");
  }
});
