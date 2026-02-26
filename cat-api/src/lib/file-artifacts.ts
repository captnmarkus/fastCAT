import { db } from "../db.js";

export type FileArtifactKind =
  | "source_original"
  | "derived_extraction"
  | "derived_segments_xliff"
  | "target_output"
  | "rendered_preview"
  | "export_bundle"
  | "export_xliff"
  | "template_json"
  | "tmx_upload"
  | "terminology_upload";

export type FileArtifactRow = {
  id: number;
  project_id: number | null;
  file_id: number | null;
  kind: FileArtifactKind | string;
  bucket: string;
  object_key: string;
  sha256: string | null;
  etag: string | null;
  size_bytes: number | null;
  content_type: string | null;
  meta_json: any;
  created_by: string | null;
  created_at: string;
};

type QueryClient = {
  query: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number }>;
};

export async function insertFileArtifact(
  client: QueryClient,
  params: {
    projectId?: number | null;
    fileId?: number | null;
    kind: FileArtifactKind | string;
    bucket: string;
    objectKey: string;
    sha256?: string | null;
    etag?: string | null;
    sizeBytes?: number | null;
    contentType?: string | null;
    meta?: any;
    createdBy?: string | null;
  }
) {
  const res = await client.query<FileArtifactRow>(
    `
      INSERT INTO file_artifacts(
        project_id,
        file_id,
        kind,
        bucket,
        object_key,
        sha256,
        etag,
        size_bytes,
        content_type,
        meta_json,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
      RETURNING id, project_id, file_id, kind, bucket, object_key, sha256, etag, size_bytes, content_type, meta_json, created_by, created_at
    `,
    [
      params.projectId ?? null,
      params.fileId ?? null,
      params.kind,
      params.bucket,
      params.objectKey,
      params.sha256 ?? null,
      params.etag ?? null,
      params.sizeBytes ?? null,
      params.contentType ?? null,
      JSON.stringify(params.meta ?? {}),
      params.createdBy ?? null
    ]
  );
  return res.rows[0] as FileArtifactRow;
}

export async function listProjectFileArtifacts(projectId: number) {
  const res = await db.query<FileArtifactRow>(
    `
      SELECT
        a.id,
        a.file_id,
        a.kind,
        a.bucket,
        a.object_key,
        a.sha256,
        a.etag,
        a.size_bytes,
        a.content_type,
        a.meta_json,
        a.created_by,
        a.created_at
      FROM file_artifacts a
      JOIN project_files f ON f.id = a.file_id
      WHERE f.project_id = $1
      ORDER BY a.created_at DESC, a.id DESC
    `,
    [projectId]
  );
  return res.rows;
}
