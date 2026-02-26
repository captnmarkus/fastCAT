import { getUserById } from "./t5memory.js";
import type { UserRole } from "./t5memory.js";

const PASSWORD_CHANGE_ALLOWED_PREFIXES = [
  "/api/auth/me",
  "/api/auth/change-password"
];

export type JwtUser = {
  sub: number | string;
  username: string;
  role: UserRole;
  departmentId?: number | null;
  displayName?: string | null;
  mustChangePassword?: boolean;
};

function isPasswordChangePathAllowed(url: string): boolean {
  return PASSWORD_CHANGE_ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export async function authenticate(request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const jwtUser = (request as any).user as JwtUser | undefined;
  const userId = tokenUserId(jwtUser);
  const url = String(request.raw?.url || request.url || "");

  if (userId != null) {
    const dbUser = await getUserById(userId);
    if (!dbUser) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (dbUser.disabled) {
      return reply.code(403).send({ error: "Account disabled" });
    }
    if (dbUser.mustChangePassword && !isPasswordChangePathAllowed(url)) {
      return reply.code(403).send({ error: "Password change required" });
    }
    return;
  }

  if (jwtUser?.mustChangePassword && !isPasswordChangePathAllowed(url)) {
    return reply.code(403).send({ error: "Password change required" });
  }
}

export async function requireAdmin(request: any, reply: any) {
  const user = (request as any).user as JwtUser | undefined;
  if (!user || user.role !== "admin") {
    return reply.code(403).send({ error: "Admin privileges required" });
  }
}

export async function requireManagerOrAdmin(request: any, reply: any) {
  const user = (request as any).user as JwtUser | undefined;
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return reply.code(403).send({ error: "Manager privileges required" });
  }
}

export function tokenUserId(user?: JwtUser): number | null {
  if (!user) return null;
  const raw = user.sub;
  const id =
    typeof raw === "number"
      ? raw
      : /^\d+$/.test(String(raw))
        ? Number(raw)
        : null;
  return id != null && Number.isFinite(id) ? id : null;
}

export async function resolveRequesterDepartmentId(
  user?: JwtUser
): Promise<number | null> {
  if (!user) return null;
  const raw = user.departmentId;
  if (raw !== undefined && raw !== null) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const id = tokenUserId(user);
  if (!id) return null;
  const dbUser = await getUserById(id);
  return dbUser?.departmentId ?? null;
}
