import type { User, UserRole } from "./t5memory.js";

export type ApiUser = {
  id: number;
  username: string;
  role: UserRole;
  departmentId: number | null;
  displayName: string | null;
  email: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  failedAttempts: number;
  locked: boolean;
  lockExpiresAt: string | null;
};

export function parseRole(input: any): UserRole {
  const value = String(input || "").trim().toLowerCase();
  if (value === "manager") return "manager";
  if (value === "reviewer") return "reviewer";
  if (value === "user") return "reviewer";
  if (value === "admin") return "admin";
  return "reviewer";
}

export function parseDepartmentId(input: any): number | null {
  if (input === undefined || input === null || String(input).trim() === "") {
    return null;
  }
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function toApiUser(user: User): ApiUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    departmentId: user.departmentId ?? null,
    displayName: user.displayName,
    email: user.email,
    disabled: user.disabled,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    failedAttempts: user.failedAttempts,
    locked: Boolean(user.lockedAt),
    lockExpiresAt: null
  };
}

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isUserLocked(user: User): boolean {
  return Boolean(user.lockedAt);
}
