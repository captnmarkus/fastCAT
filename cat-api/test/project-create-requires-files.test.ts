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

  const existing = await db.query<{ id: number }>(
    "SELECT id FROM users WHERE username = $1 LIMIT 1",
    [username]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }

  const inserted = await db.query<{ id: number }>(
    `INSERT INTO users(username, password_hash, role, department_id, disabled, must_change_password)
     VALUES ($1, $2, $3, $4, FALSE, FALSE)
     RETURNING id`,
    [username, "test-password-hash", role, departmentId]
  );
  return { id: inserted.rows[0]?.id ?? null, created: true };
}

test("backend create project endpoint rejects requests without files", async () => {
  await initDatabase();

  let app: ReturnType<typeof Fastify> | null = null;
  let createdUserId: number | null = null;

  try {
    const user = await ensureUser("project_files_guard", "manager", 1);
    if (user.created) createdUserId = user.id ?? null;

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: CONFIG.JWT_SECRET });
    await app.register(projectRoutes, { prefix: "/api/cat" });
    await app.ready();

    const token = app.jwt.sign({
      sub: "project_files_guard",
      username: "project_files_guard",
      role: "manager",
      departmentId: 1
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/cat/projects",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      payload: {
        name: `no-files-${Date.now()}`,
        srcLang: "en",
        tgtLang: "de",
        projectTargetLangs: ["de"],
        departmentId: 1,
        projectOwnerId: "project_files_guard"
      }
    });

    assert.equal(res.statusCode, 400, res.body);
    const payload = res.json();
    assert.match(String(payload?.error || ""), /at least one file/i);
  } finally {
    if (app) {
      await app.close();
    }
    if (createdUserId != null) {
      await db.query("DELETE FROM users WHERE id = $1", [createdUserId]);
    }
  }
});
