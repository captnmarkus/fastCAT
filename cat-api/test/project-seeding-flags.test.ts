import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { db, initDatabase } from "../src/db.js";
import { CONFIG } from "../src/config.js";
import { projectRoutes } from "../src/routes/projects.js";

async function ensureUser(username: string, role: string, departmentId: number) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT,
      department_id INTEGER,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS role TEXT,
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  const existing = await db.query<{ id: number }>("SELECT id FROM users WHERE username = $1 LIMIT 1", [username]);
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }
  const insert = await db.query<{ id: number }>(
    `INSERT INTO users(username, password_hash, role, department_id, disabled, must_change_password)
     VALUES ($1, $2, $3, $4, FALSE, FALSE)
     RETURNING id`,
    [username, "test-password-hash", role, departmentId]
  );
  return { id: insert.rows[0]?.id ?? null, created: true };
}

test("project create ignores rules/glossary selections when disabled", async () => {
  await initDatabase();

  let app: ReturnType<typeof Fastify> | null = null;
  let projectId: number | null = null;
  let rulesetId: number | null = null;
  let glossaryId: number | null = null;
  let createdUserId: number | null = null;

  try {
    const user = await ensureUser("tester", "manager", 1);
    if (user.created) createdUserId = user.id ?? null;

    const rulesetRes = await db.query<{ id: number }>(
      `INSERT INTO language_processing_rulesets(name)
       VALUES ($1)
       RETURNING id`,
      [`ruleset-test-${Date.now()}`]
    );
    rulesetId = rulesetRes.rows[0]?.id ?? null;
    assert.ok(rulesetId, "ruleset created");

    const glossaryRes = await db.query<{ id: number }>(
      `INSERT INTO glossaries(label)
       VALUES ($1)
       RETURNING id`,
      [`glossary-test-${Date.now()}`]
    );
    glossaryId = glossaryRes.rows[0]?.id ?? null;
    assert.ok(glossaryId, "glossary created");

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: CONFIG.JWT_SECRET });
    await app.register(projectRoutes, { prefix: "/api/cat" });
    await app.ready();

    const token = app.jwt.sign({
      sub: "tester",
      username: "tester",
      role: "manager",
      departmentId: 1
    });

    const name = `flags-test-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/cat/projects",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      payload: {
        name,
        srcLang: "en",
        tgtLang: "de",
        projectTargetLangs: ["de"],
        departmentId: 1,
        projectOwnerId: "tester",
        rulesEnabled: false,
        termbaseEnabled: false,
        glossaryEnabled: false,
        rulesetId,
        glossaryId,
        files: [{ tempKey: "file-1", filename: "sample.txt" }],
        translationPlan: [
          {
            tempKey: "file-1",
            targetLangs: ["de"],
            assignments: {
              de: {
                translatorUserId: "tester",
                rulesetId,
                glossaryId
              }
            }
          }
        ]
      }
    });

    assert.equal(res.statusCode, 200, res.body);
    const payload = res.json();
    projectId = payload?.project?.id ?? null;
    assert.ok(projectId, "project created");

    const projectRes = await db.query<{ glossary_id: number | null; project_settings: any }>(
      "SELECT glossary_id, project_settings FROM projects WHERE id = $1",
      [projectId]
    );
    const projectRow = projectRes.rows[0];
    assert.ok(projectRow, "project row loaded");
    const settings = projectRow.project_settings ?? {};

    assert.equal(settings.rules_enabled ?? settings.rulesEnabled, false);
    assert.equal(settings.termbase_enabled ?? settings.termbaseEnabled, false);
    assert.equal(settings.glossary_enabled ?? settings.glossaryEnabled, false);
    assert.equal(projectRow.glossary_id, null);

    const taskRes = await db.query<{ ruleset_id: number | null; glossary_id: number | null }>(
      "SELECT ruleset_id, glossary_id FROM translation_tasks WHERE project_id = $1",
      [projectId]
    );
    assert.ok(taskRes.rowCount && taskRes.rowCount > 0, "tasks created");
    taskRes.rows.forEach((row) => {
      assert.equal(row.ruleset_id, null);
      assert.equal(row.glossary_id, null);
    });
  } finally {
    if (app) {
      await app.close();
    }
    if (projectId != null) {
      await db.query("DELETE FROM provision_jobs WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM translation_tasks WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM project_files WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM projects WHERE id = $1", [projectId]);
    }
    if (rulesetId != null) {
      await db.query("DELETE FROM language_processing_rulesets WHERE id = $1", [rulesetId]);
    }
    if (glossaryId != null) {
      await db.query("DELETE FROM glossaries WHERE id = $1", [glossaryId]);
    }
    if (createdUserId != null) {
      await db.query("DELETE FROM users WHERE id = $1", [createdUserId]);
    }
  }
});
