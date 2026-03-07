import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db.js";

export type JwtPayload = {
  sub?: string | number;
  username?: string;
  role?: string;
  departmentId?: number | null;
  department_id?: number | null;
  [k: string]: any;
};

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch (err) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const user = getRequestUser(req);
  const rawSub = user?.sub;
  const userId =
    typeof rawSub === "number"
      ? rawSub
      : /^\d+$/.test(String(rawSub ?? ""))
        ? Number(rawSub)
        : null;

  if (userId == null) return;

  try {
    const res = await db.query<{
      disabled: boolean;
      must_change_password: boolean;
    }>(
      `SELECT disabled, must_change_password FROM users WHERE id = $1`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (row.disabled) {
      return reply.code(403).send({ error: "Account disabled" });
    }
    if (row.must_change_password) {
      return reply.code(403).send({ error: "Password change required" });
    }
  } catch {
    // Ignore if users table is unavailable during early bootstrap.
  }
}

export function getRequestUser(req: FastifyRequest): JwtPayload | undefined {
  return (req as any).user as JwtPayload | undefined;
}

export function requestUserId(user?: JwtPayload): string | null {
  if (!user) return null;
  const val =
    user.username !== undefined && user.username !== null
      ? user.username
      : user.sub;
  const str = String(val).trim();
  return str.length ? str : null;
}

function normalizeAccessKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function requestUserAccessKeys(user?: JwtPayload): string[] {
  if (!user) return [];
  const keys = new Set<string>();
  const username = normalizeAccessKey(user.username);
  if (username) keys.add(username);
  const sub = normalizeAccessKey(user.sub);
  if (sub) keys.add(sub);
  return Array.from(keys.values());
}

export function requestUserMatchesIdentifier(user: JwtPayload | undefined, identifier: unknown): boolean {
  const normalized = normalizeAccessKey(identifier);
  if (!normalized) return false;
  return requestUserAccessKeys(user).includes(normalized);
}

async function userHasProjectTaskAccess(projectId: number, user?: JwtPayload): Promise<boolean> {
  const keys = requestUserAccessKeys(user);
  if (keys.length === 0) return false;
  try {
    const res = await db.query(
      `SELECT 1
       FROM translation_tasks
       WHERE project_id = $1
         AND (
           LOWER(COALESCE(translator_user, '')) = ANY($2::text[])
           OR LOWER(COALESCE(reviewer_user, '')) = ANY($2::text[])
         )
       LIMIT 1`,
      [projectId, keys]
    );
    return (res.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export function requestUserIdInt(user?: JwtPayload): number | null {
  if (!user) return null;
  const raw = user.sub;
  const id =
    typeof raw === "number"
      ? raw
      : /^\d+$/.test(String(raw ?? ""))
        ? Number(raw)
        : null;
  return id != null && Number.isFinite(id) ? id : null;
}

export async function requestUserDepartmentId(user?: JwtPayload): Promise<number | null> {
  if (!user) return null;
  const raw = user.departmentId ?? user.department_id;
  if (raw != null) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const userId = requestUserIdInt(user);
  if (!userId) return null;
  try {
    const res = await db.query<{ department_id: number | null }>(
      `SELECT department_id FROM users WHERE id = $1`,
      [userId]
    );
    const row = res.rows[0];
    if (!row || row.department_id == null) return null;
    const parsed = Number(row.department_id);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function requestDefaultDepartmentId(): Promise<number | null> {
  try {
    const preferred = await db.query<{ id: number }>(
      `SELECT id
       FROM departments
       WHERE disabled = FALSE
         AND (LOWER(COALESCE(slug, '')) = 'general' OR LOWER(COALESCE(name, '')) = 'general')
       ORDER BY id ASC
       LIMIT 1`
    );
    const preferredId = Number(preferred.rows[0]?.id ?? 0);
    if (Number.isFinite(preferredId) && preferredId > 0) return Math.trunc(preferredId);

    const fallback = await db.query<{ id: number }>(
      `SELECT id
       FROM departments
       WHERE disabled = FALSE
       ORDER BY id ASC
       LIMIT 1`
    );
    const fallbackId = Number(fallback.rows[0]?.id ?? 0);
    return Number.isFinite(fallbackId) && fallbackId > 0 ? Math.trunc(fallbackId) : null;
  } catch {
    return null;
  }
}

export async function requestUserDepartmentIdWithAdminFallback(user?: JwtPayload): Promise<number | null> {
  const directDepartmentId = await requestUserDepartmentId(user);
  if (directDepartmentId) return directDepartmentId;
  if (!isAdminUser(user)) return null;
  return requestDefaultDepartmentId();
}

export function isAdminUser(user?: JwtPayload): boolean {
  return (user?.role || "").toLowerCase() === "admin";
}

export function isManagerUser(user?: JwtPayload): boolean {
  return (user?.role || "").toLowerCase() === "manager";
}

export function canAssignProjects(user?: JwtPayload): boolean {
  return isAdminUser(user) || isManagerUser(user);
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  const user = getRequestUser(req);
  if (!isAdminUser(user)) {
    return reply.code(403).send({ error: "Admin privileges required" });
  }
}

export async function requireManagerOrAdmin(
  req: FastifyRequest,
  reply: FastifyReply
) {
  await requireAuth(req, reply);
  const user = getRequestUser(req);
  if (!canAssignProjects(user)) {
    return reply
      .code(403)
      .send({ error: "Manager privileges required" });
  }
}

// Helper for project access control
export async function ensureProjectAccess(
  projectId: number,
  user: JwtPayload | undefined,
  reply: FastifyReply
) {
  const { rows } = await db.query(
    `SELECT id, assigned_user, created_by, department_id, status, init_error FROM projects WHERE id = $1`,
    [projectId]
  );
  const row = rows[0] as any;

  if (!row) {
    reply.code(404).send({ error: "Project not found" });
    return null;
  }
  if (isAdminUser(user)) return row;
  const departmentId = await requestUserDepartmentId(user);
  if (!departmentId || Number(row.department_id) !== Number(departmentId)) {
    reply.code(403).send({ error: "Project access denied" });
    return null;
  }
  const owner = row.assigned_user ?? row.created_by ?? null;
  if (requestUserMatchesIdentifier(user, owner)) {
    return row;
  }
  if (await userHasProjectTaskAccess(projectId, user)) {
    return row;
  }
  reply.code(403).send({ error: "Project access denied" });
  return null;
}

export function ensureProjectReady(row: { status?: string } | null, reply: FastifyReply) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (status !== "ready") {
    const projectId =
      row && typeof row === "object"
        ? Number((row as any).id ?? (row as any).project_id ?? null)
        : null;
    if (status === "failed") {
      const initError = String((row as any)?.init_error || "").trim() || null;
      reply.code(423).send({
        error: initError || "Project preparation failed.",
        code: "PROJECT_FAILED",
        status: status || null,
        projectId: Number.isFinite(projectId) ? projectId : null,
        initError
      });
    } else {
      reply.code(423).send({
        error: "Project is still preparing.",
        code: "PROJECT_PREPARING",
        status: status || null,
        projectId: Number.isFinite(projectId) ? projectId : null
      });
    }
    return false;
  }
  return true;
}
