import { db, withTransaction } from "../db.js";
import { insertSegmentsForFile } from "./projects.segment-insert.js";
import { normalizeJsonObject, sanitizeSegments } from "./projects.helpers.js";

export async function rehydrateAgentProjectImports(projectId: number) {
  const projectRes = await db.query<{ project_settings: any }>(
    `SELECT project_settings
     FROM projects
     WHERE id = $1
     LIMIT 1`,
    [projectId]
  );
  const projectRow = projectRes.rows[0];
  if (!projectRow) return { processedFiles: 0, failedFiles: 0, mapConfigured: false };
  const settings = normalizeJsonObject(projectRow.project_settings);
  const sourceMapRaw = normalizeJsonObject(settings.appAgentSourceFileMap);
  const mappings = Object.entries(sourceMapRaw)
    .map(([targetFileIdRaw, sourceFileIdRaw]) => {
      const targetFileId = Number(targetFileIdRaw);
      const sourceFileId = Number(sourceFileIdRaw);
      if (!Number.isFinite(targetFileId) || targetFileId <= 0) return null;
      if (!Number.isFinite(sourceFileId) || sourceFileId <= 0) return null;
      return {
        targetFileId: Math.trunc(targetFileId),
        sourceFileId: Math.trunc(sourceFileId)
      };
    })
    .filter(Boolean) as Array<{ targetFileId: number; sourceFileId: number }>;
  if (mappings.length === 0) {
    return { processedFiles: 0, failedFiles: 0, mapConfigured: false };
  }

  return withTransaction(async (client) => {
    let processedFiles = 0;
    let failedFiles = 0;

    for (const mapping of mappings) {
      const sourceSegRes = await client.query<{
        seg_index: number;
        src: string;
        tgt: string | null;
        src_runs: any;
        tgt_runs: any;
        segment_context: any;
        origin_details: any;
        task_id: number | null;
      }>(
        `SELECT seg_index, src, tgt, src_runs, tgt_runs, segment_context, origin_details, task_id
         FROM segments
         WHERE file_id = $1
         ORDER BY
           seg_index ASC,
           CASE WHEN task_id IS NULL THEN 0 ELSE 1 END ASC,
           id ASC`,
        [mapping.sourceFileId]
      );
      const seen = new Set<number>();
      const seedSegments: Array<{
        src: string;
        tgt?: string | null;
        srcRuns?: any;
        tgtRuns?: any;
        segmentContext?: any;
        originDetails?: any;
      }> = [];
      sourceSegRes.rows.forEach((row) => {
        const idx = Number(row.seg_index ?? -1);
        if (!Number.isFinite(idx) || idx < 0 || seen.has(idx)) return;
        seen.add(idx);
        seedSegments.push({
          src: String(row.src || ""),
          tgt: row.tgt ?? null,
          srcRuns: row.src_runs ?? [],
          tgtRuns: row.tgt_runs ?? [],
          segmentContext: row.segment_context ?? {},
          originDetails: row.origin_details ?? {}
        });
      });

      await client.query(
        `DELETE FROM segments
         WHERE project_id = $1
           AND file_id = $2`,
        [projectId, mapping.targetFileId]
      );

      if (seedSegments.length === 0) {
        failedFiles += 1;
        await client.query(
          `UPDATE project_files
           SET status = 'failed'
           WHERE project_id = $1
             AND id = $2`,
          [projectId, mapping.targetFileId]
        );
        await client.query(
          `INSERT INTO project_file_processing_logs(project_id, file_id, stage, status, message, details)
           VALUES($1, $2, 'IMPORT', 'FAILED', $3, $4::jsonb)`,
          [
            projectId,
            mapping.targetFileId,
            "Retry import failed: source has no segments.",
            JSON.stringify({ sourceFileId: mapping.sourceFileId })
          ]
        );
        continue;
      }

      await insertSegmentsForFile(client, projectId, mapping.targetFileId, sanitizeSegments(seedSegments));
      await client.query(
        `UPDATE project_files
         SET status = 'ready'
         WHERE project_id = $1
           AND id = $2`,
        [projectId, mapping.targetFileId]
      );
      await client.query(
        `INSERT INTO project_file_processing_logs(project_id, file_id, stage, status, message, details)
         VALUES($1, $2, 'IMPORT', 'READY', $3, $4::jsonb)`,
        [
          projectId,
          mapping.targetFileId,
          `Retry import restored ${seedSegments.length} segment(s).`,
          JSON.stringify({ sourceFileId: mapping.sourceFileId, segmentCount: seedSegments.length })
        ]
      );
      processedFiles += 1;
    }

    return { processedFiles, failedFiles, mapConfigured: true };
  });
}
