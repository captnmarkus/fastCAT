import { test } from "node:test";
import assert from "node:assert/strict";
import { db, initDatabase, withTransaction } from "../src/db.js";

test("project creation transaction fails when no file references are inserted", async () => {
  await initDatabase();
  const projectName = `file-required-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  let failed = false;
  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO projects(
           name,
           src_lang,
           tgt_lang,
           target_langs,
           status,
           published_at,
           created_by,
           assigned_user,
           department_id
         )
         VALUES ($1, $2, $3, $4::jsonb, 'ready', NOW(), $5, $5, 1)`,
        [projectName, "en", "de", JSON.stringify(["de"]), "system"]
      );
    });
  } catch (err: any) {
    failed = true;
    assert.equal(String(err?.code || ""), "23514");
  }

  assert.equal(failed, true, "project insert without files should fail");

  const existing = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM projects
     WHERE name = $1`,
    [projectName]
  );
  assert.equal(Number(existing.rows[0]?.count ?? 0), 0, "failed transaction must not persist project row");
});

