import path from "path";
import { db } from "../db.js";
import {
  normalizeParsingTemplateConfig,
  normalizeXmlParsingTemplateConfig,
  type ParsingTemplateKind,
  type ParsingTemplateConfig,
  type XmlParsingTemplateConfig
} from "../lib/parsing-templates.js";
import { insertFileArtifact, type FileArtifactKind } from "../lib/file-artifacts.js";
import {
  getObjectBuffer,
  getS3Bucket,
  putObjectBuffer,
  sha256Hex
} from "../lib/s3.js";
import { keyFileIngestionTemplateJson } from "../lib/storage-keys.js";

export type ParsingTemplateRow = {
  id: number;
  name: string;
  description: string | null;
  kind: string;
  config: ParsingTemplateConfig | XmlParsingTemplateConfig;
  source_json_path: string | null;
  source_json_original_name: string | null;
  source_json_size_bytes: number | null;
  source_json_uploaded_at: string | null;
  source_artifact_id: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number | null;
};

export type ParsingTemplateJsonUploadRow = {
  id: number;
  kind: string;
  original_name: string;
  stored_path: string;
  size_bytes: number | null;
  artifact_id: number | null;
  created_by: string | null;
  created_at: string;
};

export function normalizeTemplateKind(value: any): ParsingTemplateKind {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return v === "xml" ? "xml" : "html";
}

export function safeBasename(filename: string) {
  const base = path.basename(String(filename || "").trim() || "template.json");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function templateJsonPayload(args: { name: string; description: string | null; kind: ParsingTemplateKind; config: any }) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      kind: args.kind,
      name: args.name,
      description: args.description ? String(args.description) : "",
      config: args.config
    },
    null,
    2
  );
}

export function suggestTemplateNameFromUpload(args: { originalFilename: string; parsed: any }) {
  const obj = args.parsed && typeof args.parsed === "object" && !Array.isArray(args.parsed) ? (args.parsed as any) : null;
  const fileBase = String(args.originalFilename || "")
    .replace(/\.json$/i, "")
    .trim();
  return String(obj?.name ?? fileBase).trim() || fileBase || "Template";
}

export function suggestTemplateDescriptionFromUpload(parsed: any) {
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as any) : null;
  return String(obj?.description ?? "").trim();
}

export function actorUserIdInt(user: any): number | null {
  const raw = user?.sub;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  const str = String(raw ?? "").trim();
  if (!/^\d+$/.test(str)) return null;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rowToTemplate(row: ParsingTemplateRow) {
  const kind = normalizeTemplateKind(row.kind);
  return {
    id: row.id,
    name: row.name,
    description: row.description ? String(row.description) : "",
    kind,
    config: row.config,
    version: row.version != null && Number.isFinite(Number(row.version)) ? Number(row.version) : 1,
    sourceJson: row.source_artifact_id
      ? {
          originalName: row.source_json_original_name ? String(row.source_json_original_name) : null,
          sizeBytes: row.source_json_size_bytes != null ? Number(row.source_json_size_bytes) : null,
          uploadedAt: row.source_json_uploaded_at ? new Date(row.source_json_uploaded_at).toISOString() : null
        }
      : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function resolveUploadRow(params: {
  uploadId: number;
  actor: string;
  actorIsAdmin: boolean;
}) {
  const res = await db.query<ParsingTemplateJsonUploadRow>(
    `SELECT id, kind, original_name, stored_path, size_bytes, artifact_id, created_by, created_at
     FROM parsing_template_json_uploads
     WHERE id = $1`,
    [params.uploadId]
  );
  const row = res.rows[0];
  if (!row) return { error: "Upload not found" as const };
  if (!params.actorIsAdmin && row.created_by && String(row.created_by) !== params.actor) {
    return { error: "Forbidden" as const };
  }
  return { row };
}

export async function readUploadConfig(params: {
  upload: ParsingTemplateJsonUploadRow;
}): Promise<{ config: ParsingTemplateConfig | XmlParsingTemplateConfig; parsed: any } | { error: string }> {
  const objectKey = String(params.upload.stored_path || "").trim();
  if (!objectKey) return { error: "Upload has no stored object key" };
  try {
    const { buf } = await getObjectBuffer({ key: objectKey });
    const parsed = JSON.parse(buf.toString("utf8"));
    const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as any) : null;
    const rawConfig = obj?.config ?? parsed;
    const config =
      normalizeTemplateKind(params.upload.kind) === "xml"
        ? normalizeXmlParsingTemplateConfig(rawConfig)
        : normalizeParsingTemplateConfig(rawConfig);
    return { config, parsed };
  } catch (err: any) {
    return { error: err?.message || "Failed to read uploaded JSON from storage" };
  }
}

export async function writeTemplateVersion(params: {
  client: { query: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number }> };
  templateId: number;
  kind: ParsingTemplateKind;
  name: string;
  description: string | null;
  config: ParsingTemplateConfig | XmlParsingTemplateConfig;
  createdBy: string;
}) {
  await params.client.query("SELECT pg_advisory_xact_lock($1)", [params.templateId]);

  const versionRes = await params.client.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
     FROM template_versions
     WHERE template_id = $1`,
    [params.templateId]
  );
  const version = Number(versionRes.rows[0]?.next_version ?? 1) || 1;

  const objectKey = keyFileIngestionTemplateJson({
    kind: params.kind === "xml" ? "xml" : "html",
    templateId: params.templateId,
    version
  });

  const originalName = safeBasename(`${params.name}.json`);
  const jsonText = templateJsonPayload({
    name: params.name,
    description: params.description,
    kind: params.kind,
    config: params.config
  });
  const buf = Buffer.from(jsonText, "utf8");

  const put = await putObjectBuffer({ key: objectKey, buf, contentType: "application/json" });
  const sha256 = await sha256Hex(buf);

  const artifact = await insertFileArtifact(params.client, {
    kind: "template_json" satisfies FileArtifactKind,
    bucket: getS3Bucket(),
    objectKey,
    sha256,
    etag: put.etag,
    sizeBytes: buf.length,
    contentType: "application/json",
    meta: {
      templateId: params.templateId,
      version,
      kind: params.kind,
      originalFilename: originalName
    },
    createdBy: params.createdBy
  });

  await params.client.query(
    `
      INSERT INTO template_versions(
        template_id,
        version,
        artifact_id,
        schema_version,
        created_by,
        created_at
      )
      VALUES ($1, $2, $3, 1, $4, NOW())
    `,
    [params.templateId, version, artifact.id, params.createdBy]
  );

  await params.client.query(
    `
      UPDATE parsing_templates
      SET source_artifact_id = $1,
          source_json_path = $2,
          source_json_original_name = $3,
          source_json_size_bytes = $4,
          source_json_uploaded_at = NOW(),
          updated_at = NOW()
      WHERE id = $5
    `,
    [artifact.id, objectKey, originalName, buf.length, params.templateId]
  );

  return { version, artifactId: artifact.id, objectKey };
}
