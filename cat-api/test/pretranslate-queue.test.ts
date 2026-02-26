import { test } from "node:test";
import assert from "node:assert/strict";
import { db, initDatabase } from "../src/db.js";
import { enqueuePretranslateJobs } from "../src/lib/pretranslate-queue.js";

test("enqueuePretranslateJobs creates jobs for all file/lang pairs with correct engine", async () => {
  await initDatabase();

  const engineNameA = `test-engine-a-${Date.now()}`;
  const engineNameB = `test-engine-b-${Date.now()}`;

  let engineA: number | null = null;
  let engineB: number | null = null;
  let projectId: number | null = null;
  let fileA: number | null = null;
  let fileB: number | null = null;

  try {
    const engineResA = await db.query<{ id: number }>(
      `INSERT INTO translation_engines(name, description, config, disabled, created_at, updated_at)
       VALUES ($1, '', '{}'::jsonb, FALSE, NOW(), NOW())
       RETURNING id`,
      [engineNameA]
    );
    engineA = engineResA.rows[0]?.id ?? null;

    const engineResB = await db.query<{ id: number }>(
      `INSERT INTO translation_engines(name, description, config, disabled, created_at, updated_at)
       VALUES ($1, '', '{}'::jsonb, FALSE, NOW(), NOW())
       RETURNING id`,
      [engineNameB]
    );
    engineB = engineResB.rows[0]?.id ?? null;

    assert.ok(engineA && engineB, "Engines created");

    await db.query("BEGIN");
    try {
      const projectRes = await db.query<{ id: number }>(
        `INSERT INTO projects(name, src_lang, tgt_lang, target_langs, status, created_by, created_at, department_id)
         VALUES ($1, 'en', 'de', $2::jsonb, 'draft', 'tester', NOW(), 1)
         RETURNING id`,
        ["pretranslate-test", JSON.stringify(["de", "fr"])]
      );
      projectId = projectRes.rows[0]?.id ?? null;
      assert.ok(projectId, "Project created");

      const fileResA = await db.query<{ id: number }>(
        `INSERT INTO project_files(project_id, original_name, stored_path, created_at)
         VALUES ($1, 'file-a.txt', 'pending', NOW())
         RETURNING id`,
        [projectId]
      );
      fileA = fileResA.rows[0]?.id ?? null;

      const fileResB = await db.query<{ id: number }>(
        `INSERT INTO project_files(project_id, original_name, stored_path, created_at)
         VALUES ($1, 'file-b.txt', 'pending', NOW())
         RETURNING id`,
        [projectId]
      );
      fileB = fileResB.rows[0]?.id ?? null;

      assert.ok(fileA && fileB, "Files created");

      await db.query(`UPDATE projects SET status = 'ready' WHERE id = $1`, [projectId]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }

    await db.query(
      `INSERT INTO translation_tasks(project_id, file_id, source_lang, target_lang, translator_user, status)
       VALUES ($1, $2, 'en', 'de', 'tester', 'draft'),
              ($1, $2, 'en', 'fr', 'tester', 'draft'),
              ($1, $3, 'en', 'de', 'tester', 'draft'),
              ($1, $3, 'en', 'fr', 'tester', 'draft')`,
      [projectId, fileA, fileB]
    );

    const settings = {
      translation_engine_default_id: engineA,
      translation_engine_defaults_by_target: { fr: engineB },
      translation_engine_overrides: {
        [String(fileA)]: { de: engineB }
      }
    };
    await db.query("UPDATE projects SET project_settings = $2 WHERE id = $1", [projectId, settings]);

    const result = await enqueuePretranslateJobs({ projectId, scope: "all" });
    assert.equal(result.total, 4);
    assert.equal(result.queued, 4);

    const jobsRes = await db.query<{ file_id: number; target_lang: string; engine_id: number }>(
      `SELECT file_id, target_lang, engine_id
       FROM project_pretranslate_jobs
       WHERE project_id = $1`,
      [projectId]
    );
    const jobs = jobsRes.rows.map((row) => ({
      fileId: Number(row.file_id),
      target: row.target_lang,
      engineId: Number(row.engine_id)
    }));

    const findJob = (fileId: number, target: string) =>
      jobs.find((job) => job.fileId === fileId && job.target === target)?.engineId ?? null;

    assert.equal(findJob(fileA, "de"), engineB);
    assert.equal(findJob(fileA, "fr"), engineB);
    assert.equal(findJob(fileB, "de"), engineA);
    assert.equal(findJob(fileB, "fr"), engineB);
  } finally {
    if (projectId != null) {
      await db.query("DELETE FROM project_pretranslate_jobs WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM translation_tasks WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM project_files WHERE project_id = $1", [projectId]);
      await db.query("DELETE FROM projects WHERE id = $1", [projectId]);
    }
    if (engineA != null) {
      await db.query("DELETE FROM translation_engines WHERE id = $1", [engineA]);
    }
    if (engineB != null) {
      await db.query("DELETE FROM translation_engines WHERE id = $1", [engineB]);
    }
  }
});
