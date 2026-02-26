import { db } from "../db.js";
import { getRequestUser } from "../middleware/auth.js";

export type TmLibraryRow = {
  id: number;
  origin: string;
  label: string;
  comment: string | null;
  filename: string;
  stored_path: string;
  artifact_id: number | null;
  size_bytes: number;
  disabled: boolean;
  uploaded_by: string | null;
  uploaded_at: string | null;
  tm_name: string | null;
  tm_proxy_id: number | null;
  created_at: string;
  updated_at: string | null;
};

export type TmLibraryVersionRow = {
  version_id: number;
  tm_library_id: number;
  version_number?: number | null;
  created_at: string;
  created_by: string | null;
  comment: string | null;
  label: string;
  filename: string;
  stored_path: string;
  artifact_id: number | null;
  size_bytes: number;
  disabled: boolean;
  tm_name: string | null;
  tm_proxy_id: number | null;
};

export type ActorLabelOptions = { fallback?: string };

export function requestActorLabel(req: any, options: ActorLabelOptions = {}) {
  const user = getRequestUser(req) as any;
  const displayName = typeof user?.displayName === "string" ? user.displayName.trim() : "";
  if (displayName) return displayName;
  const username = typeof user?.username === "string" ? user.username.trim() : "";
  if (username) return username;
  const rawSub = user?.sub;
  const sub = String(rawSub ?? "").trim();
  return sub || options.fallback || null;
}

export function looksLikeS3ObjectKey(value: string) {
  const v = String(value || "").trim();
  if (!v) return false;
  return v.startsWith("root/") || v.startsWith("departments/") || v.startsWith("users/");
}

export function actorUserIdInt(user: any): number | null {
  const raw = user?.sub;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  const str = String(raw ?? "").trim();
  if (!/^\d+$/.test(str)) return null;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function tmLabelExists(label: string, opts: { excludeId?: number } = {}) {
  const normalized = String(label || "").trim();
  if (!normalized) return false;
  const params: any[] = [normalized.toLowerCase()];
  let sql =
    "SELECT 1 FROM tm_library WHERE origin = 'upload' AND LOWER(label) = $1";
  if (opts.excludeId != null && Number.isFinite(opts.excludeId)) {
    sql += " AND id <> $2";
    params.push(opts.excludeId);
  }
  sql += " LIMIT 1";
  const res = await db.query(sql, params);
  return (res.rowCount ?? 0) > 0;
}

export function rowToEntry(row: TmLibraryRow) {
  const uploadedAt =
    row.uploaded_at || row.created_at
      ? new Date(row.uploaded_at ?? row.created_at).toISOString()
      : null;
  const updatedAt = row.updated_at
    ? new Date(row.updated_at).toISOString()
    : uploadedAt;
  return {
    id: row.id,
    origin: row.origin,
    label: row.label,
    comment: row.comment ?? null,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    disabled: Boolean(row.disabled),
    uploadedBy: row.uploaded_by ?? null,
    uploadedAt,
    tmProxyId: row.tm_proxy_id ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt
  };
}

export function humanizeSampleLabel(filename: string) {
  const base = filename.replace(/\.[^/.]+$/, "");
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function rowToVersion(row: TmLibraryVersionRow) {
  return {
    versionId: row.version_id,
    entryId: row.tm_library_id,
    versionNumber: row.version_number ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    createdBy: row.created_by ?? null,
    comment: row.comment ?? null,
    label: row.label,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    disabled: Boolean(row.disabled)
  };
}

export async function insertLibraryVersion(params: {
  entry: TmLibraryRow;
  actor: string | null;
  comment?: string | null;
}) {
  const { entry, actor, comment } = params;
  await db.query(
    `
      INSERT INTO tm_library_versions(
        tm_library_id,
        created_by,
        comment,
        label,
        filename,
        stored_path,
        artifact_id,
        size_bytes,
        disabled,
        tm_name,
        tm_proxy_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `,
    [
      entry.id,
      actor ?? null,
      comment ?? null,
      entry.label,
      entry.filename,
      entry.stored_path,
      entry.artifact_id ?? null,
      entry.size_bytes,
      Boolean(entry.disabled),
      entry.tm_name,
      entry.tm_proxy_id
    ]
  );
}
