import { test } from "node:test";
import assert from "node:assert/strict";
import { db, initDatabase } from "../src/db.js";
import { insertSegments } from "../src/routes/projects.js";

test("insertSegments stores word_count for inbox aggregates", async () => {
  await initDatabase();

  let projectId: number | null = null;
  let fileId: number | null = null;
  let taskId: number | null = null;

  try {
    await db.query("BEGIN");
    try {
      const projectRes = await db.query<{ id: number }>(
        `INSERT INTO projects(name, src_lang, tgt_lang, target_langs, status, created_by, created_at, department_id)
         VALUES ($1, 'en', 'fr', $2::jsonb, 'draft', 'tester', NOW(), 1)
         RETURNING id`,
        ["word-count-test", JSON.stringify(["fr"])]
      );
      projectId = projectRes.rows[0]?.id ?? null;
      assert.ok(projectId, "Project created");

      const fileRes = await db.query<{ id: number }>(
        `INSERT INTO project_files(project_id, original_name, stored_path, created_at)
         VALUES ($1, 'test.txt', 'pending', NOW())
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

    const taskRes = await db.query<{ id: number }>(
      `INSERT INTO translation_tasks(project_id, file_id, source_lang, target_lang, translator_user, status)
       VALUES ($1, $2, 'en', 'fr', 'tester', 'draft')
       RETURNING id`,
      [projectId, fileId]
    );
    taskId = taskRes.rows[0]?.id ?? null;
    assert.ok(taskId, "Task created");

    const segments = [
      { src: "Hello world", tgt: null },
      { src: "More words here", tgt: null }
    ];

    await insertSegments(db, projectId, fileId, segments, { taskId });

    const res = await db.query<{ total: number; words: number; nmt_state_count: number }>(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(word_count), 0)::int AS words,
              COALESCE(SUM(CASE WHEN state = 'nmt_draft' THEN 1 ELSE 0 END), 0)::int AS nmt_state_count
       FROM segments
       WHERE project_id = $1 AND file_id = $2 AND task_id = $3`,
      [projectId, fileId, taskId]
    );

    const row = res.rows[0];
    assert.equal(row.total, segments.length);
    assert.equal(row.words, 5);
    assert.equal(row.nmt_state_count, 0);
  } finally {
    if (taskId != null) {
      await db.query("DELETE FROM segments WHERE task_id = $1", [taskId]);
      await db.query("DELETE FROM translation_tasks WHERE id = $1", [taskId]);
    }
    if (fileId != null) {
      await db.query("DELETE FROM project_files WHERE id = $1", [fileId]);
    }
    if (projectId != null) {
      await db.query("DELETE FROM projects WHERE id = $1", [projectId]);
    }
  }
});
