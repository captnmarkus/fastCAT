import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { db, initDatabase } from "../src/db.js";
import { CONFIG } from "../src/config.js";
import { projectRoutes } from "../src/routes/projects.js";
import { segmentRoutes } from "../src/routes/segments.js";

type TestUser = {
  id: number;
  username: string;
  role: string;
  departmentId: number;
};

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`
  };
}

async function ensureUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT,
      department_id INTEGER,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createUser(params: { role: string; departmentId: number }) {
  await ensureUsersTable();
  const username = `proj_access_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await db.query<{ id: number; username: string; role: string; department_id: number }>(
    `INSERT INTO users(username, password_hash, role, department_id, disabled, must_change_password)
     VALUES ($1, '', $2, $3, FALSE, FALSE)
     RETURNING id, username, role, department_id`,
    [username, params.role, params.departmentId]
  );
  const row = res.rows[0];
  assert.ok(row, "test user should be created");
  return {
    id: Number(row.id),
    username: String(row.username),
    role: String(row.role || ""),
    departmentId: Number(row.department_id || params.departmentId)
  } as TestUser;
}

async function createReadyProject(params: {
  name: string;
  owner: TestUser;
  departmentId: number;
}) {
  let projectId = 0;
  let fileId = 0;
  await db.query("BEGIN");
  try {
    const projectRes = await db.query<{ id: number }>(
      `INSERT INTO projects(
         name,
         src_lang,
         tgt_lang,
         target_langs,
         status,
         created_by,
         assigned_user,
         created_at,
         department_id
       )
       VALUES ($1, 'de-DE', 'fr-FR', $2::jsonb, 'draft', $3, $3, NOW(), $4)
       RETURNING id`,
      [params.name, JSON.stringify(["fr-FR", "da-DK"]), params.owner.username, params.departmentId]
    );
    projectId = Number(projectRes.rows[0]?.id ?? 0);
    assert.ok(projectId > 0, "project should be created");

    const fileRes = await db.query<{ id: number }>(
      `INSERT INTO project_files(project_id, original_name, stored_path, created_at)
       VALUES ($1, $2, 'pending', NOW())
       RETURNING id`,
      [projectId, `${params.name}.docx`]
    );
    fileId = Number(fileRes.rows[0]?.id ?? 0);
    assert.ok(fileId > 0, "file should be created");

    await db.query(`UPDATE projects SET status = 'ready' WHERE id = $1`, [projectId]);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
  return { projectId, fileId };
}

async function createTask(params: {
  projectId: number;
  fileId: number;
  translator: TestUser;
  reviewer?: TestUser | null;
  targetLang: string;
}) {
  const res = await db.query<{ id: number }>(
    `INSERT INTO translation_tasks(
       project_id,
       file_id,
       source_lang,
       target_lang,
       translator_user,
       reviewer_user,
       status
     )
     VALUES ($1, $2, 'de-DE', $3, $4, $5, 'draft')
     RETURNING id`,
    [
      params.projectId,
      params.fileId,
      params.targetLang,
      params.translator.username,
      params.reviewer?.username ?? null
    ]
  );
  const taskId = Number(res.rows[0]?.id ?? 0);
  assert.ok(taskId > 0, "task should be created");
  return taskId;
}

async function insertTaskSegments(params: {
  projectId: number;
  fileId: number;
  taskId: number;
  segments: Array<{ segIndex: number; src: string; tgt: string; srcRuns?: any[] }>;
}) {
  for (const segment of params.segments) {
    await db.query(
      `INSERT INTO segments(
         project_id,
         file_id,
         task_id,
         seg_index,
         src,
         tgt,
         src_runs,
         status,
         state,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft', 'draft', NOW(), NOW())`,
      [
        params.projectId,
        params.fileId,
        params.taskId,
        segment.segIndex,
        segment.src,
        segment.tgt,
        JSON.stringify(segment.srcRuns ?? [])
      ]
    );
  }
}

function signToken(app: ReturnType<typeof Fastify>, user: TestUser) {
  return app.jwt.sign({
    sub: user.id,
    username: user.username,
    role: user.role,
    departmentId: user.departmentId
  });
}

async function createProjectApp() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: CONFIG.JWT_SECRET });
  await app.register(projectRoutes, { prefix: "/api/cat" });
  await app.ready();
  return app;
}

async function createSegmentsApp() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: CONFIG.JWT_SECRET });
  await app.register(segmentRoutes, { prefix: "/api/cat" });
  await app.ready();
  return app;
}

async function waitForBulkJob(app: ReturnType<typeof Fastify>, token: string, jobId: string) {
  let lastSnapshot: any = null;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const res = await app.inject({
      method: "GET",
      url: `/api/cat/bulk-jobs/${jobId}`,
      headers: authHeaders(token)
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    lastSnapshot = body ?? null;
    const status = String(body?.status || "");
    if (status === "completed" || status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`bulk job ${jobId} did not finish in time; last status: ${JSON.stringify(lastSnapshot)}`);
}

async function cleanupProjects(projectIds: number[]) {
  const ids = projectIds.filter((value) => Number.isFinite(value) && value > 0);
  if (ids.length === 0) return;
  await db.query("DELETE FROM project_pretranslate_jobs WHERE project_id = ANY($1::int[])", [ids]);
  await db.query("DELETE FROM file_artifacts WHERE project_id = ANY($1::int[])", [ids]);
  await db.query("DELETE FROM segments WHERE project_id = ANY($1::int[])", [ids]);
  await db.query("DELETE FROM translation_tasks WHERE project_id = ANY($1::int[])", [ids]);
  await db.query("DELETE FROM project_files WHERE project_id = ANY($1::int[])", [ids]);
  await db.query("DELETE FROM projects WHERE id = ANY($1::int[])", [ids]);
}

async function cleanupUsers(users: TestUser[]) {
  const ids = users.map((user) => user.id).filter((value) => Number.isFinite(value) && value > 0);
  if (ids.length === 0) return;
  await db.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

test("manager project visibility excludes unrelated admin-owned projects", async () => {
  await initDatabase();

  const projectIds: number[] = [];
  const users: TestUser[] = [];
  let app: ReturnType<typeof Fastify> | null = null;

  try {
    const adminUser = await createUser({ role: "admin", departmentId: 1 });
    const managerUser = await createUser({ role: "manager", departmentId: 1 });
    const translatorUser = await createUser({ role: "user", departmentId: 1 });
    users.push(adminUser, managerUser, translatorUser);

    const managerProject = await createReadyProject({
      name: `manager-owned-${Date.now()}`,
      owner: managerUser,
      departmentId: 1
    });
    projectIds.push(managerProject.projectId);

    const sharedProject = await createReadyProject({
      name: `shared-${Date.now()}`,
      owner: adminUser,
      departmentId: 1
    });
    projectIds.push(sharedProject.projectId);
    await createTask({
      projectId: sharedProject.projectId,
      fileId: sharedProject.fileId,
      translator: managerUser,
      reviewer: translatorUser,
      targetLang: "fr-FR"
    });

    const hiddenAdminProject = await createReadyProject({
      name: `hidden-admin-${Date.now()}`,
      owner: adminUser,
      departmentId: 1
    });
    projectIds.push(hiddenAdminProject.projectId);
    await createTask({
      projectId: hiddenAdminProject.projectId,
      fileId: hiddenAdminProject.fileId,
      translator: translatorUser,
      reviewer: null,
      targetLang: "da-DK"
    });

    app = await createProjectApp();
    const managerToken = signToken(app, managerUser);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/cat/projects",
      headers: authHeaders(managerToken)
    });
    assert.equal(listRes.statusCode, 200, listRes.body);
    const visibleProjectIds = new Set<number>((listRes.json().projects || []).map((project: any) => Number(project.id)));
    assert.ok(visibleProjectIds.has(managerProject.projectId), "manager-owned project should be visible");
    assert.ok(visibleProjectIds.has(sharedProject.projectId), "assigned project should be visible");
    assert.ok(!visibleProjectIds.has(hiddenAdminProject.projectId), "unrelated admin project should be hidden");

    const detailDenied = await app.inject({
      method: "GET",
      url: `/api/cat/projects/${hiddenAdminProject.projectId}`,
      headers: authHeaders(managerToken)
    });
    assert.equal(detailDenied.statusCode, 403, detailDenied.body);

    const bucketDenied = await app.inject({
      method: "GET",
      url: `/api/cat/projects/${hiddenAdminProject.projectId}/bucket`,
      headers: authHeaders(managerToken)
    });
    assert.equal(bucketDenied.statusCode, 403, bucketDenied.body);

    const detailAllowed = await app.inject({
      method: "GET",
      url: `/api/cat/projects/${sharedProject.projectId}`,
      headers: authHeaders(managerToken)
    });
    assert.equal(detailAllowed.statusCode, 200, detailAllowed.body);
  } finally {
    if (app) await app.close();
    await cleanupProjects(projectIds);
    await cleanupUsers(users);
  }
});

test("reviewer bulk approve works for assigned task filters and rejects unrelated reviewers", async () => {
  await initDatabase();

  const projectIds: number[] = [];
  const users: TestUser[] = [];
  let app: ReturnType<typeof Fastify> | null = null;

  try {
    const ownerUser = await createUser({ role: "manager", departmentId: 1 });
    const translatorUser = await createUser({ role: "user", departmentId: 1 });
    const reviewerUser = await createUser({ role: "user", departmentId: 1 });
    const unrelatedReviewer = await createUser({ role: "user", departmentId: 1 });
    users.push(ownerUser, translatorUser, reviewerUser, unrelatedReviewer);

    const project = await createReadyProject({
      name: `bulk-review-${Date.now()}`,
      owner: ownerUser,
      departmentId: 1
    });
    projectIds.push(project.projectId);

    const taskId = await createTask({
      projectId: project.projectId,
      fileId: project.fileId,
      translator: translatorUser,
      reviewer: reviewerUser,
      targetLang: "fr-FR"
    });

    await insertTaskSegments({
      projectId: project.projectId,
      fileId: project.fileId,
      taskId,
      segments: [
        { segIndex: 0, src: "Alpha source one", tgt: "Bonjour un" },
        { segIndex: 1, src: "Alpha source two", tgt: "Bonjour deux" },
        { segIndex: 2, src: "Beta source three", tgt: "Bonjour trois" }
      ]
    });

    app = await createSegmentsApp();
    const reviewerToken = signToken(app, reviewerUser);
    const otherReviewerToken = signToken(app, unrelatedReviewer);

    const deniedRes = await app.inject({
      method: "POST",
      url: `/api/cat/projects/${project.projectId}/files/${project.fileId}/segments/bulk-approve`,
      headers: {
        ...authHeaders(otherReviewerToken),
        "content-type": "application/json"
      },
      payload: {
        taskId,
        scope: "visible",
        filters: { sourceSearch: "Alpha" }
      }
    });
    assert.equal(deniedRes.statusCode, 403, deniedRes.body);

    const approveRes = await app.inject({
      method: "POST",
      url: `/api/cat/projects/${project.projectId}/files/${project.fileId}/segments/bulk-approve`,
      headers: {
        ...authHeaders(reviewerToken),
        "content-type": "application/json"
      },
      payload: {
        taskId,
        scope: "visible",
        filters: { sourceSearch: "Alpha" }
      }
    });
    assert.equal(approveRes.statusCode, 200, approveRes.body);
    const jobId = String(approveRes.json().jobId || "");
    assert.ok(jobId, "bulk approval job id should be returned");

    const jobPayload = await waitForBulkJob(app, reviewerToken, jobId);
    assert.equal(jobPayload.status, "completed");
    assert.equal(Number(jobPayload.summary?.approved ?? 0), 2);

    const segmentsRes = await db.query<{
      seg_index: number;
      status: string;
      state: string | null;
      is_locked: boolean | null;
      updated_by: string | null;
    }>(
      `SELECT seg_index, status, state, is_locked, updated_by
       FROM segments
       WHERE task_id = $1
       ORDER BY seg_index ASC`,
      [taskId]
    );
    assert.equal(segmentsRes.rows.length, 3);

    assert.equal(segmentsRes.rows[0]?.status, "reviewed");
    assert.equal(segmentsRes.rows[0]?.state, "reviewed");
    assert.equal(segmentsRes.rows[0]?.is_locked, true);
    assert.equal(segmentsRes.rows[0]?.updated_by, reviewerUser.username);

    assert.equal(segmentsRes.rows[1]?.status, "reviewed");
    assert.equal(segmentsRes.rows[1]?.state, "reviewed");
    assert.equal(segmentsRes.rows[1]?.is_locked, true);
    assert.equal(segmentsRes.rows[1]?.updated_by, reviewerUser.username);

    assert.equal(segmentsRes.rows[2]?.status, "draft");
    assert.notEqual(segmentsRes.rows[2]?.state, "reviewed");
  } finally {
    if (app) await app.close();
    await cleanupProjects(projectIds);
    await cleanupUsers(users);
  }
});
