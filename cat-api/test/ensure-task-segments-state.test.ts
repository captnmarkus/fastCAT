import { test } from "node:test";
import assert from "node:assert/strict";
import { db, initDatabase } from "../src/db.js";
import { ensureTaskSegments } from "../src/routes/files.helpers.js";

test("ensureTaskSegments downgrades stale nmt_draft when no MT metadata exists", async () => {
  await initDatabase();

  let projectId: number | null = null;
  let fileId: number | null = null;
  let taskId: number | null = null;

  try {
    await db.query("BEGIN");
    try {
      const projectRes = await db.query<{ id: number }>(
        `INSERT INTO projects(name, src_lang, tgt_lang, target_langs, status, created_by, created_at, department_id)
         VALUES ($1, 'de', 'en', $2::jsonb, 'draft', 'tester', NOW(), 1)
         RETURNING id`,
        [`task-state-test-${Date.now()}`, JSON.stringify(["en"])]
      );
      projectId = projectRes.rows[0]?.id ?? null;
      assert.ok(projectId, "Project created");

      const fileRes = await db.query<{ id: number }>(
        `INSERT INTO project_files(project_id, original_name, stored_path, created_at)
         VALUES ($1, 'state-test.xlf', 'pending', NOW())
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
       VALUES ($1, $2, 'de', 'en', 'tester', 'draft')
       RETURNING id`,
      [projectId, fileId]
    );
    taskId = taskRes.rows[0]?.id ?? null;
    assert.ok(taskId, "Task created");

    await db.query(
      `INSERT INTO segments(
         project_id,
         file_id,
         task_id,
         seg_index,
         src,
         tgt,
         status,
         state,
         generated_by_llm,
         source_type
       )
       VALUES
         ($1, $2, NULL, 0, 'Kein NMT', 'No MT metadata', 'draft', 'nmt_draft', FALSE, 'none'),
         ($1, $2, NULL, 1, 'Mit NMT', 'With MT metadata', 'draft', 'nmt_draft', TRUE, 'nmt')`,
      [projectId, fileId]
    );

    await ensureTaskSegments(taskId);

    const clonedRes = await db.query<{
      seg_index: number;
      state: string;
      generated_by_llm: boolean;
      source_type: string;
    }>(
      `SELECT seg_index, state, generated_by_llm, source_type
       FROM segments
       WHERE task_id = $1
       ORDER BY seg_index ASC`,
      [taskId]
    );

    assert.equal(clonedRes.rows.length, 2);

    const staleClone = clonedRes.rows[0];
    assert.equal(staleClone.seg_index, 0);
    assert.equal(staleClone.state, "draft");
    assert.equal(staleClone.generated_by_llm, false);
    assert.equal(String(staleClone.source_type).toLowerCase(), "none");

    const nmtClone = clonedRes.rows[1];
    assert.equal(nmtClone.seg_index, 1);
    assert.equal(nmtClone.state, "nmt_draft");
    assert.equal(nmtClone.generated_by_llm, true);
    assert.equal(String(nmtClone.source_type).toLowerCase(), "nmt");
  } finally {
    if (projectId != null) {
      await db.query("DELETE FROM segments WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM translation_tasks WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM project_files WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM projects WHERE id = $1", [projectId]);
    }
  }
});
