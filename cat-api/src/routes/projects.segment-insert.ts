import {
  normalizeOriginDetails,
  normalizeRichTextRuns,
  normalizeSegmentContext
} from "../lib/rich-text.js";

type InsertableSegment = {
  src: string;
  tgt?: string | null;
  srcRuns?: any;
  tgtRuns?: any;
  segmentContext?: any;
  originDetails?: any;
};

export async function insertSegments(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  projectId: number,
  fileId: number,
  segments: InsertableSegment[],
  opts?: { taskId?: number | null }
) {
  if (segments.length === 0) return;
  const CHUNK_SIZE = 500;
  const taskId = opts?.taskId ?? null;

  const countWords = (value: string) => {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    const matches = text.match(/\S+/g);
    return matches ? matches.length : 0;
  };

  for (let offset = 0; offset < segments.length; offset += CHUNK_SIZE) {
    const chunk = segments.slice(offset, offset + CHUNK_SIZE);
    const params: any[] = [];
    const valuesSql = chunk
      .map((seg, i) => {
        const base = i * 11;
        const wordCount = countWords(seg.src);
        const srcRuns = normalizeRichTextRuns(seg.srcRuns, seg.src);
        const tgtText = seg.tgt == null ? "" : String(seg.tgt);
        const tgtRuns = normalizeRichTextRuns(seg.tgtRuns, tgtText);
        const context = normalizeSegmentContext(seg.segmentContext ?? {});
        const origin = normalizeOriginDetails(seg.originDetails ?? {});
        params.push(
          projectId,
          fileId,
          taskId,
          offset + i,
          seg.src,
          seg.tgt ?? null,
          JSON.stringify(srcRuns),
          JSON.stringify(tgtRuns),
          JSON.stringify(context),
          JSON.stringify(origin),
          wordCount
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, 'draft', 'draft', FALSE, 'none')`;
      })
      .join(", ");

    await client.query(
      `INSERT INTO segments(
         project_id,
         file_id,
         task_id,
         seg_index,
         src,
         tgt,
         src_runs,
         tgt_runs,
         segment_context,
         origin_details,
         word_count,
         status,
         state,
         generated_by_llm,
         source_type
       )
       VALUES ${valuesSql}`,
      params
    );
  }
}

export async function insertSegmentsForFile(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  projectId: number,
  fileId: number,
  segments: InsertableSegment[]
) {
  // Always keep canonical file-level segments for file-based editor views.
  await insertSegments(client, projectId, fileId, segments);

  const tasksRes = await client.query(
    `SELECT id FROM translation_tasks WHERE project_id = $1 AND file_id = $2 ORDER BY id ASC`,
    [projectId, fileId]
  );
  if ((tasksRes.rowCount ?? 0) > 0) {
    for (const row of tasksRes.rows) {
      const taskId = Number(row.id);
      if (!Number.isFinite(taskId) || taskId <= 0) continue;
      await insertSegments(client, projectId, fileId, segments, { taskId });
    }
  }
}
