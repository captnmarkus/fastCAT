import type { FastifyInstance } from "fastify";

import {
  findUserByUsername,
  checkPassword,
  createUser,
  deleteUser,
  listUsers,
  getUserById,
  updateUserRole,
  updateUserDepartment,
  updateUserProfile,
  resetUserPassword,
  changeUserPassword,
  recordLoginAttempt,
  clearUserLockout,
  setUserDisabled,
  countAdmins
} from "../t5memory.js";
import type { User } from "../t5memory.js";
import { PASSWORD_POLICY_MESSAGE } from "../passwordPolicy.js";
import {
  authenticate,
  requireAdmin,
  requireManagerOrAdmin,
  resolveRequesterDepartmentId,
  tokenUserId
} from "../auth.js";
import type { JwtUser } from "../auth.js";
import { applySetupDefaults } from "../setup-defaults.js";
import {
  isUserLocked,
  normalizeUsername,
  parseDepartmentId,
  parseRole,
  toApiUser
} from "../user-utils.js";

const MAX_LOGIN_ATTEMPTS = 3;

function signToken(app: FastifyInstance, user: User): string {
  return app.jwt.sign({
    sub: user.id,
    username: user.username,
    role: user.role,
    departmentId: user.departmentId ?? null,
    displayName: user.displayName,
    mustChangePassword: user.mustChangePassword
  } as JwtUser);
}

export function registerSetupAuthUserRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/setup/status", async () => {
    const adminCount = await countAdmins();
    return { status: adminCount > 0 ? "configured" : "not_configured" };
  });

  app.post("/api/setup/initialize", async (req, reply) => {
    const adminCount = await countAdmins();
    if (adminCount > 0) {
      return reply.code(409).send({ error: "Setup already completed." });
    }

    const body = (req.body as any) || {};
    const adminPayload =
      body.admin && typeof body.admin === "object" ? body.admin : body;
    const username = String(adminPayload.username || "").trim();
    const password = String(adminPayload.password || "");
    const email =
      adminPayload.email != null ? String(adminPayload.email || "").trim() : null;
    const displayName =
      adminPayload.displayName != null
        ? String(adminPayload.displayName || "").trim()
        : null;

    if (!username || !password) {
      return reply.code(400).send({ error: "username and password required" });
    }

    const existing = await findUserByUsername(username.toLowerCase());
    if (existing) {
      return reply.code(409).send({ error: "username already exists" });
    }

    let adminUser: User | null = null;
    try {
      adminUser = await createUser({
        username,
        password,
        role: "admin",
        displayName: displayName || null,
        email: email || null,
        mustChangePassword: false
      });
    } catch (err: any) {
      if (err?.code === "WEAK_PASSWORD") {
        return reply.code(400).send({ error: err.message || PASSWORD_POLICY_MESSAGE });
      }
      if (err?.code === "DEPARTMENT_REQUIRED" || err?.code === "DEPARTMENT_INVALID") {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    const token = signToken(app, adminUser);
    try {
      await applySetupDefaults(token, body);
    } catch (err: any) {
      await deleteUser(adminUser.id);
      return reply.code(500).send({
        error: err?.message || "Failed to apply setup defaults."
      });
    }

    return reply.code(201).send({ ok: true, user: toApiUser(adminUser) });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = (req.body as any) || {};
    const { username, password } = body;

    if (!username || !password) {
      return reply.code(400).send({ error: "username and password required" });
    }

    const normalized = normalizeUsername(String(username));
    const user = await findUserByUsername(normalized);
    if (!user) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    if (user.disabled) {
      return reply.code(403).send({ error: "Account disabled" });
    }

    if (isUserLocked(user)) {
      return reply.code(423).send({ error: "Account locked" });
    }

    if (!checkPassword(user, password)) {
      await recordLoginAttempt(user.id, false, MAX_LOGIN_ATTEMPTS);
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    await recordLoginAttempt(user.id, true, MAX_LOGIN_ATTEMPTS);
    const freshUser = (await getUserById(user.id)) ?? user;
    return {
      token: signToken(app, freshUser),
      user: toApiUser(freshUser)
    };
  });

  app.get("/api/auth/me", { preHandler: [authenticate] }, async (req, reply) => {
    const jwtUser = (req as any).user as JwtUser;
    const userId = tokenUserId(jwtUser);
    if (!userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const me = await getUserById(userId);
    if (!me) {
      return reply.code(404).send({ error: "User not found" });
    }
    return { user: toApiUser(me) };
  });

  app.post(
    "/api/auth/change-password",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const jwtUser = (req as any).user as JwtUser;
      const userId = tokenUserId(jwtUser);
      if (!userId) {
        return reply.code(400).send({ error: "Invalid user context" });
      }

      const body = (req.body as any) || {};
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      if (!currentPassword || !newPassword) {
        return reply
          .code(400)
          .send({ error: "currentPassword and newPassword required" });
      }

      const user = await getUserById(userId);
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (user.disabled) {
        return reply.code(403).send({ error: "Account disabled" });
      }
      if (!checkPassword(user, currentPassword)) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      let updated: User | null = null;
      try {
        updated = await changeUserPassword(userId, newPassword);
      } catch (err: any) {
        if (err?.code === "WEAK_PASSWORD") {
          return reply.code(400).send({ error: err.message || PASSWORD_POLICY_MESSAGE });
        }
        throw err;
      }
      if (!updated) {
        return reply.code(500).send({ error: "Failed to update password" });
      }

      return { token: signToken(app, updated), user: toApiUser(updated) };
    }
  );

  app.patch("/api/auth/profile", { preHandler: [authenticate] }, async (req, reply) => {
    const jwtUser = (req as any).user as JwtUser;
    const userId = tokenUserId(jwtUser);
    if (!userId) {
      return reply.code(400).send({ error: "Invalid user context" });
    }

    const user = await getUserById(userId);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (user.disabled) {
      return reply.code(403).send({ error: "Account disabled" });
    }

    const body = (req.body as any) || {};
    const emailRaw = body.email;
    const displayNameRaw = body.displayName;

    const nextEmail = emailRaw !== undefined ? String(emailRaw || "").trim() : null;
    const requestedDisplayName =
      displayNameRaw !== undefined ? String(displayNameRaw || "").trim() : null;

    const nextDisplayName = user.role === "reviewer" ? null : requestedDisplayName || null;
    const updated =
      (await updateUserProfile({
        id: userId,
        displayName: nextDisplayName,
        email: nextEmail || null
      })) ?? user;

    return { token: signToken(app, updated), user: toApiUser(updated) };
  });

  app.get(
    "/api/users",
    { preHandler: [authenticate, requireManagerOrAdmin] },
    async (req, reply) => {
      const users = await listUsers();
      const requester = (req as any).user as JwtUser | undefined;
      if (!requester || requester.role === "admin") {
        return { users: users.filter((u) => !u.disabled).map(toApiUser) };
      }
      const departmentId = await resolveRequesterDepartmentId(requester);
      if (!departmentId) {
        return reply.code(403).send({ error: "Department assignment required" });
      }
      const scoped = users.filter((u) => !u.disabled && u.departmentId === departmentId);
      return { users: scoped.map(toApiUser) };
    }
  );

  app.get("/api/admin/users", { preHandler: [authenticate, requireAdmin] }, async () => {
    const users = await listUsers();
    return { users: users.map(toApiUser) };
  });

  app.post(
    "/api/admin/users",
    { preHandler: [authenticate, requireAdmin] },
    async (req, reply) => {
      const body = (req.body as any) || {};
      const { username, password, role, displayName, email } = body;
      const departmentId = parseDepartmentId(body.departmentId ?? body.department_id);
      if (!username || !password) {
        return reply.code(400).send({ error: "username and password required" });
      }
      const normalized = normalizeUsername(String(username));
      const existing = await findUserByUsername(normalized);
      if (existing) {
        return reply.code(409).send({ error: "username already exists" });
      }

      try {
        const newUser = await createUser({
          username: normalized,
          password,
          role: parseRole(role),
          departmentId,
          displayName: displayName ?? null,
          email: email ?? null
        });
        return reply.code(201).send({ user: toApiUser(newUser) });
      } catch (err: any) {
        if (err?.code === "DEPARTMENT_REQUIRED" || err?.code === "DEPARTMENT_INVALID") {
          return reply.code(400).send({ error: err.message });
        }
        if (err?.code === "WEAK_PASSWORD") {
          return reply.code(400).send({ error: err.message || PASSWORD_POLICY_MESSAGE });
        }
        throw err;
      }
    }
  );

  app.patch(
    "/api/admin/users/:userId",
    { preHandler: [authenticate, requireAdmin] },
    async (req, reply) => {
      const { userId } = req.params as any;
      const id = Number(userId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid user id" });
      }
      const body = (req.body as any) || {};
      const { role, displayName, email, disabled } = body;
      const departmentId = parseDepartmentId(body.departmentId ?? body.department_id);
      const hasDepartmentUpdate =
        body.departmentId !== undefined || body.department_id !== undefined;
      const user = await getUserById(id);
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }
      let updated: User | null = user;
      const requestedRole = role ? parseRole(role) : user.role;
      const roleChanging = role && requestedRole !== user.role;
      if (roleChanging) {
        try {
          updated =
            (await updateUserRole(
              id,
              requestedRole,
              hasDepartmentUpdate ? departmentId : undefined
            )) ?? updated;
        } catch (err: any) {
          if (err?.code === "ADMIN_REQUIRED") {
            return reply.code(409).send({ error: err.message });
          }
          if (err?.code === "DEPARTMENT_REQUIRED" || err?.code === "DEPARTMENT_INVALID") {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      }
      if (!roleChanging && hasDepartmentUpdate) {
        try {
          updated = (await updateUserDepartment(id, departmentId)) ?? updated;
        } catch (err: any) {
          if (err?.code === "ADMIN_DEPARTMENT_LOCKED") {
            return reply.code(400).send({ error: err.message });
          }
          if (err?.code === "DEPARTMENT_REQUIRED" || err?.code === "DEPARTMENT_INVALID") {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      }
      if (displayName !== undefined || email !== undefined) {
        updated =
          (await updateUserProfile({
            id,
            displayName: displayName ?? null,
            email: email ?? null
          })) ?? updated;
      }
      if (disabled !== undefined) {
        const nextDisabled = Boolean(disabled);
        if (user.role === "admin" && nextDisabled) {
          const adminCount = await countAdmins();
          if (adminCount <= 1) {
            return reply.code(409).send({ error: "At least one admin is required." });
          }
        }
        const requester = (req as any).user as JwtUser;
        if (tokenUserId(requester) === id && nextDisabled) {
          return reply.code(400).send({ error: "You cannot disable your own account" });
        }
        updated = (await setUserDisabled(id, nextDisabled)) ?? updated;
      }
      return { user: updated ? toApiUser(updated) : null };
    }
  );

  app.post(
    "/api/admin/users/:userId/reset-password",
    { preHandler: [authenticate, requireAdmin] },
    async (req, reply) => {
      const { userId } = req.params as any;
      const id = Number(userId);
      const body = (req.body as any) || {};
      const { password } = body;
      if (!Number.isFinite(id) || !password) {
        return reply.code(400).send({ error: "Valid user id and password required" });
      }
      let updated: User | null = null;
      try {
        updated = await resetUserPassword(id, password);
      } catch (err: any) {
        if (err?.code === "WEAK_PASSWORD") {
          return reply.code(400).send({ error: err.message || PASSWORD_POLICY_MESSAGE });
        }
        throw err;
      }
      if (!updated) {
        return reply.code(404).send({ error: "User not found" });
      }
      return { user: toApiUser(updated) };
    }
  );

  app.post(
    "/api/admin/users/:userId/unlock",
    { preHandler: [authenticate, requireAdmin] },
    async (req, reply) => {
      const { userId } = req.params as any;
      const id = Number(userId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid user id" });
      }
      await clearUserLockout(id);
      const user = await getUserById(id);
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }
      return { user: toApiUser(user) };
    }
  );

  app.delete(
    "/api/admin/users/:userId",
    { preHandler: [authenticate, requireAdmin] },
    async (req, reply) => {
      const { userId } = req.params as any;
      const id = Number(userId);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "Invalid user id" });
      }
      const requester = (req as any).user as JwtUser;
      const user = await getUserById(id);
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }
      const requesterId = tokenUserId(requester);
      const isSelf = requesterId === id;
      if (user.role === "admin") {
        if (!isSelf) {
          return reply.code(403).send({ error: "Admins cannot delete other admins." });
        }
        const adminCount = await countAdmins();
        if (adminCount <= 1) {
          return reply.code(409).send({ error: "At least one admin is required." });
        }
      } else if (isSelf) {
        return reply.code(400).send({ error: "You cannot delete your own account" });
      }
      const success = await deleteUser(id);
      if (!success) {
        return reply.code(500).send({ error: "Failed to delete user" });
      }
      return { ok: true };
    }
  );
}
