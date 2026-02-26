import { db } from "../db.js";
import { getRedisClient } from "../redis.js";

export const USER_BUCKETS_VERSION = 1;

function userKey(userId: string) {
  return String(userId || "").trim();
}

export function userBucketsInitKey(userId: string) {
  return `user:${userKey(userId)}:buckets:v${USER_BUCKETS_VERSION}:init`;
}

export function userProjectsCreatedKey(userId: string) {
  return `user:${userKey(userId)}:projects:created`;
}

export function userProjectsAssignedKey(userId: string) {
  return `user:${userKey(userId)}:projects:assigned`;
}

export function userFilesAssignedKey(userId: string) {
  return `user:${userKey(userId)}:files:assigned`;
}

export async function ensureUserBucketsInitialized(userId: string) {
  const client = getRedisClient();
  const initKey = userBucketsInitKey(userId);
  const exists = await client.get(initKey);
  if (exists) return;
  await seedUserBuckets(userId);
  await client.set(initKey, "1");
}

export async function seedUserBuckets(userId: string) {
  const client = getRedisClient();
  const uid = userKey(userId);
  if (!uid) return;

  // Projects created or assigned to this user (score = last modified time).
  const projectsRes = await db.query<{
    id: number;
    created_by: string | null;
    assigned_user: string | null;
    last_modified_at: string;
  }>(
    `SELECT p.id,
            p.created_by,
            p.assigned_user,
            COALESCE(seg.last_modified_at, p.created_at) AS last_modified_at
     FROM projects p
     LEFT JOIN (
       SELECT project_id, MAX(updated_at) AS last_modified_at
       FROM segments
       GROUP BY project_id
     ) seg ON seg.project_id = p.id
     WHERE (p.created_by = $1 OR p.assigned_user = $1)
       AND p.status = 'ready'`,
    [uid]
  );

  const created: { score: number; value: string }[] = [];
  const assigned: { score: number; value: string }[] = [];
  for (const row of projectsRes.rows) {
    const score = toScore(row.last_modified_at);
    const pid = String(row.id);
    if (row.created_by === uid) created.push({ score, value: pid });
    if (row.assigned_user === uid) assigned.push({ score, value: pid });
  }

  if (created.length > 0) await client.zAdd(userProjectsCreatedKey(uid), created);
  if (assigned.length > 0) await client.zAdd(userProjectsAssignedKey(uid), assigned);

  // Files assigned to this user for Inbox (score = last modified time).
  const filesRes = await db.query<{
    file_id: number;
    last_modified_at: string;
  }>(
    `SELECT f.id AS file_id,
            COALESCE(s.last_modified_at, f.created_at) AS last_modified_at
     FROM project_files f
     JOIN projects p ON p.id = f.project_id
     LEFT JOIN (
       SELECT file_id, MAX(updated_at) AS last_modified_at
       FROM segments
       GROUP BY file_id
     ) s ON s.file_id = f.id
     WHERE (p.created_by = $1 OR p.assigned_user = $1)
       AND p.status = 'ready'`,
    [uid]
  );

  const files: { score: number; value: string }[] = filesRes.rows.map((row) => ({
    score: toScore(row.last_modified_at),
    value: String(row.file_id)
  }));
  if (files.length > 0) await client.zAdd(userFilesAssignedKey(uid), files);
}

export async function touchProjectForUsers(params: {
  projectId: number;
  createdBy: string | null;
  assignedUser: string | null;
  updatedAtMs?: number;
}) {
  const client = getRedisClient();
  const score = params.updatedAtMs ?? Date.now();
  const projectId = String(params.projectId);

  const createdBy = params.createdBy ? userKey(params.createdBy) : "";
  const assignedUser = params.assignedUser ? userKey(params.assignedUser) : "";

  if (createdBy) {
    await client.zAdd(userProjectsCreatedKey(createdBy), [{ score, value: projectId }]);
  }
  if (assignedUser) {
    await client.zAdd(userProjectsAssignedKey(assignedUser), [{ score, value: projectId }]);
  }
}

export async function touchFileForUser(params: { userId: string; fileId: number; updatedAtMs?: number }) {
  const client = getRedisClient();
  const uid = userKey(params.userId);
  if (!uid) return;
  await client.zAdd(userFilesAssignedKey(uid), [
    { score: params.updatedAtMs ?? Date.now(), value: String(params.fileId) }
  ]);
}

export async function removeProjectFromAssigned(userId: string, projectId: number) {
  const client = getRedisClient();
  const uid = userKey(userId);
  if (!uid) return;
  await client.zRem(userProjectsAssignedKey(uid), String(projectId));
}

export async function addProjectToAssigned(userId: string, projectId: number, updatedAtMs?: number) {
  const client = getRedisClient();
  const uid = userKey(userId);
  if (!uid) return;
  await client.zAdd(userProjectsAssignedKey(uid), [{ score: updatedAtMs ?? Date.now(), value: String(projectId) }]);
}

export async function addProjectToCreated(userId: string, projectId: number, updatedAtMs?: number) {
  const client = getRedisClient();
  const uid = userKey(userId);
  if (!uid) return;
  await client.zAdd(userProjectsCreatedKey(uid), [{ score: updatedAtMs ?? Date.now(), value: String(projectId) }]);
}

export async function addFileToAssigned(userId: string, fileId: number, updatedAtMs?: number) {
  const client = getRedisClient();
  const uid = userKey(userId);
  if (!uid) return;
  await client.zAdd(userFilesAssignedKey(uid), [{ score: updatedAtMs ?? Date.now(), value: String(fileId) }]);
}

export async function removeFileFromAssigned(userId: string, fileId: number) {
  const client = getRedisClient();
  const uid = userKey(userId);
  if (!uid) return;
  await client.zRem(userFilesAssignedKey(uid), String(fileId));
}

function toScore(dateLike: any): number {
  const ms = new Date(String(dateLike || "")).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}
