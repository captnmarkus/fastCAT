import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { db, initDatabase } from "../src/db.js";
import { CONFIG } from "../src/config.js";
import { enqueuePretranslateJobs } from "../src/lib/pretranslate-queue.js";
import { processPretranslateJobForTest } from "../src/lib/pretranslate-worker.js";
import { filesRoutes } from "../src/routes/files.js";

test("pretranslate worker writes targets for all task languages", async () => {
  await initDatabase();

  let engineId: number | null = null;
  let projectId: number | null = null;
  let fileId: number | null = null;
  let taskDe: number | null = null;
  let taskFr: number | null = null;
  let app: ReturnType<typeof Fastify> | null = null;

  try {
    const engineRes = await db.query<{ id: number }>(
      `INSERT INTO translation_engines(name, description, config, disabled, created_at, updated_at)
       VALUES ($1, '', '{}'::jsonb, FALSE, NOW(), NOW())
       RETURNING id`,
      [`test-engine-${Date.now()}`]
    );
    engineId = engineRes.rows[0]?.id ?? null;
    assert.ok(engineId, "Engine created");

    await db.query("BEGIN");
    try {
      const projectRes = await db.query<{ id: number }>(
        `INSERT INTO projects(name, src_lang, tgt_lang, target_langs, status, created_by, created_at, department_id)
         VALUES ($1, 'en', 'de', $2::jsonb, 'draft', 'tester', NOW(), 1)
         RETURNING id`,
        ["pretranslate-worker-test", JSON.stringify(["de", "fr"])]
      );
      projectId = projectRes.rows[0]?.id ?? null;
      assert.ok(projectId, "Project created");

      const fileRes = await db.query<{ id: number }>(
        `INSERT INTO project_files(project_id, original_name, stored_path, created_at)
         VALUES ($1, 'file-a.txt', 'pending', NOW())
         RETURNING id`,
        [projectId]
      );
      fileId = fileRes.rows[0]?.id ?? null;
      assert.ok(fileId, "File created");

      await db.query(`UPDATE projects SET status = 'ready' WHERE id = $1`, [projectId]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }

    const taskRes = await db.query<{ id: number; target_lang: string }>(
      `INSERT INTO translation_tasks(project_id, file_id, source_lang, target_lang, translator_user, status)
       VALUES ($1, $2, 'en', 'de', 'tester', 'draft'),
              ($1, $2, 'en', 'fr', 'tester', 'draft')
       RETURNING id, target_lang`,
      [projectId, fileId]
    );
    taskRes.rows.forEach((row) => {
      if (row.target_lang === "de") taskDe = row.id;
      if (row.target_lang === "fr") taskFr = row.id;
    });
    assert.ok(taskDe && taskFr, "Tasks created");

    const segments: Array<{ taskId: number; segIndex: number; src: string }> = [
      { taskId: taskDe!, segIndex: 0, src: "Hello" },
      { taskId: taskDe!, segIndex: 1, src: "World" },
      { taskId: taskFr!, segIndex: 0, src: "Hello" },
      { taskId: taskFr!, segIndex: 1, src: "World" }
    ];
    for (const seg of segments) {
      await db.query(
        `INSERT INTO segments(project_id, file_id, task_id, seg_index, src, tgt, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NULL, 'draft', NOW(), NOW())`,
        [projectId, fileId, seg.taskId, seg.segIndex, seg.src]
      );
    }

    await db.query(
      "UPDATE projects SET project_settings = $2 WHERE id = $1",
      [
        projectId,
        {
          translation_engine_default_id: engineId,
          mt_seeding_enabled: true
        }
      ]
    );

    const enqueueResult = await enqueuePretranslateJobs({ projectId, scope: "all" });
    assert.equal(enqueueResult.total, 2);
    assert.equal(enqueueResult.queued, 2);

    const jobsRes = await db.query<{
      id: number;
      project_id: number;
      file_id: number;
      target_lang: string;
      engine_id: number | null;
      status: string;
      overwrite_existing: boolean;
      retry_count: number;
      max_retries: number;
    }>(
      `SELECT id, project_id, file_id, target_lang, engine_id, status, overwrite_existing, retry_count, max_retries
       FROM project_pretranslate_jobs
       WHERE project_id = $1`,
      [projectId]
    );

    const mockRequest = async ({ segmentId }: { segmentId: number }) => ({
      payload: { choices: [{ message: { content: `translated-${segmentId}` } }] },
      status: 200,
      engineId
    });

    for (const job of jobsRes.rows) {
      await processPretranslateJobForTest(job, { requestSegment: mockRequest });
    }

    const segRes = await db.query<{ task_id: number; id: number; tgt: string | null }>(
      `SELECT task_id, id, tgt
       FROM segments
       WHERE project_id = $1
       ORDER BY task_id, seg_index`,
      [projectId]
    );
    const byTask = new Map<number, Array<{ id: number; tgt: string | null }>>();
    segRes.rows.forEach((row) => {
      const list = byTask.get(row.task_id) ?? [];
      list.push({ id: row.id, tgt: row.tgt });
      byTask.set(row.task_id, list);
    });
    const taskDeSegs = byTask.get(taskDe!) ?? [];
    const taskFrSegs = byTask.get(taskFr!) ?? [];
    assert.equal(taskDeSegs.length, 2);
    assert.equal(taskFrSegs.length, 2);
    taskDeSegs.forEach((seg) => {
      assert.equal(seg.tgt, `translated-${seg.id}`);
    });
    taskFrSegs.forEach((seg) => {
      assert.equal(seg.tgt, `translated-${seg.id}`);
    });

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: CONFIG.JWT_SECRET });
    await app.register(filesRoutes, { prefix: "/api/cat" });
    await app.ready();
    const token = app.jwt.sign({
      sub: "tester",
      username: "tester",
      role: "manager",
      departmentId: 1
    });

    const assertSegmentsResponse = (payload: any) => {
      assert.ok(payload && Array.isArray(payload.segments), "segments payload missing");
      payload.segments.forEach((seg: any) => {
        assert.equal(seg.tgt, `translated-${seg.id}`);
      });
    };

    const resDe = await app.inject({
      method: "GET",
      url: `/api/cat/tasks/${taskDe}/segments`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(resDe.statusCode, 200);
    assertSegmentsResponse(resDe.json());

    const resFr = await app.inject({
      method: "GET",
      url: `/api/cat/tasks/${taskFr}/segments`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(resFr.statusCode, 200);
    assertSegmentsResponse(resFr.json());
  } finally {
    if (app) {
      await app.close();
    }
    if (projectId != null) {
      await db.query("DELETE FROM project_pretranslate_jobs WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM segments WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM translation_tasks WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM project_files WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM projects WHERE id = $1", [projectId]);
    }
    if (engineId != null) {
      await db.query("DELETE FROM translation_engines WHERE id = $1", [engineId]);
    }
  }
});

test("pretranslate worker fails when segments are missing for a job", async () => {
  await initDatabase();

  let engineId: number | null = null;
  let projectId: number | null = null;
  let fileId: number | null = null;

  try {
    const engineRes = await db.query<{ id: number }>(
      `INSERT INTO translation_engines(name, description, config, disabled, created_at, updated_at)
       VALUES ($1, '', '{}'::jsonb, FALSE, NOW(), NOW())
       RETURNING id`,
      [`test-engine-missing-${Date.now()}`]
    );
    engineId = engineRes.rows[0]?.id ?? null;

    await db.query("BEGIN");
    try {
      const projectRes = await db.query<{ id: number }>(
        `INSERT INTO projects(name, src_lang, tgt_lang, target_langs, status, created_by, created_at, department_id)
         VALUES ($1, 'en', 'de', $2::jsonb, 'draft', 'tester', NOW(), 1)
         RETURNING id`,
        ["pretranslate-worker-missing", JSON.stringify(["de"])]
      );
      projectId = projectRes.rows[0]?.id ?? null;

      const fileRes = await db.query<{ id: number }>(
        `INSERT INTO project_files(project_id, original_name, stored_path, created_at)
         VALUES ($1, 'file-a.txt', 'pending', NOW())
         RETURNING id`,
        [projectId]
      );
      fileId = fileRes.rows[0]?.id ?? null;

      await db.query(`UPDATE projects SET status = 'ready' WHERE id = $1`, [projectId]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }

    await db.query(
      `INSERT INTO translation_tasks(project_id, file_id, source_lang, target_lang, translator_user, status)
       VALUES ($1, $2, 'en', 'de', 'tester', 'draft')`,
      [projectId, fileId]
    );

    await db.query(
      "UPDATE projects SET project_settings = $2 WHERE id = $1",
      [
        projectId,
        {
          translation_engine_default_id: engineId,
          mt_seeding_enabled: true
        }
      ]
    );

    await enqueuePretranslateJobs({ projectId, scope: "all" });

    const jobRes = await db.query<{
      id: number;
      project_id: number;
      file_id: number;
      target_lang: string;
      engine_id: number | null;
      status: string;
      overwrite_existing: boolean;
      retry_count: number;
      max_retries: number;
    }>(
      `SELECT id, project_id, file_id, target_lang, engine_id, status, overwrite_existing, retry_count, max_retries
       FROM project_pretranslate_jobs
       WHERE project_id = $1
       LIMIT 1`,
      [projectId]
    );
    const job = jobRes.rows[0];
    assert.ok(job, "Job created");

    const mockRequest = async ({ segmentId }: { segmentId: number }) => ({
      payload: { choices: [{ message: { content: `translated-${segmentId}` } }] },
      status: 200,
      engineId
    });

    await processPretranslateJobForTest(job, { requestSegment: mockRequest });

    const updatedJobRes = await db.query<{ status: string; error_message: string | null }>(
      `SELECT status, error_message
       FROM project_pretranslate_jobs
       WHERE id = $1`,
      [job.id]
    );
    const updatedJob = updatedJobRes.rows[0];
    assert.equal(updatedJob.status, "failed");
    assert.ok(updatedJob.error_message?.toLowerCase().includes("no segments"));
  } finally {
    if (projectId != null) {
      await db.query("DELETE FROM project_pretranslate_jobs WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM translation_tasks WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM project_files WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM projects WHERE id = $1", [projectId]);
    }
    if (engineId != null) {
      await db.query("DELETE FROM translation_engines WHERE id = $1", [engineId]);
    }
  }
});
