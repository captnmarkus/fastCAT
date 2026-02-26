import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { getRequestUser, isAdminUser, requireAdmin, requireAuth, requestUserDepartmentId } from "../middleware/auth.js";

type DepartmentRow = {
  id: number;
  name: string;
  slug: string | null;
  disabled: boolean;
  created_at: string;
};

function normalizeSlug(input: string): string | null {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || null;
}

function rowToDepartment(row: DepartmentRow) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    slug: row.slug ? String(row.slug) : null,
    disabled: Boolean(row.disabled),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

export async function departmentsRoutes(app: FastifyInstance) {
  app.get("/departments", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = getRequestUser(req);
    if (isAdminUser(user)) {
      const res = await db.query<DepartmentRow>(
        `SELECT id, name, slug, disabled, created_at
         FROM departments
         WHERE disabled = FALSE
         ORDER BY LOWER(name) ASC`
      );
      return { departments: res.rows.map(rowToDepartment) };
    }

    const departmentId = await requestUserDepartmentId(user);
    if (!departmentId) {
      return reply.code(403).send({ error: "Department assignment required" });
    }
    const res = await db.query<DepartmentRow>(
      `SELECT id, name, slug, disabled, created_at
       FROM departments
       WHERE id = $1 AND disabled = FALSE`,
      [departmentId]
    );
    return { departments: res.rows.map(rowToDepartment) };
  });

  app.get("/admin/departments", { preHandler: [requireAdmin] }, async () => {
    const res = await db.query<DepartmentRow>(
      `SELECT id, name, slug, disabled, created_at
       FROM departments
       ORDER BY LOWER(name) ASC`
    );
    return { departments: res.rows.map(rowToDepartment) };
  });

  app.post("/admin/departments", { preHandler: [requireAdmin] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const name = String(body.name || "").trim();
    if (!name) {
      return reply.code(400).send({ error: "name is required" });
    }
    const rawSlug = body.slug;
    const slug =
      rawSlug === undefined
        ? normalizeSlug(name)
        : normalizeSlug(String(rawSlug || ""));

    try {
      const res = await db.query<DepartmentRow>(
        `INSERT INTO departments(name, slug, disabled)
         VALUES ($1, $2, FALSE)
         RETURNING id, name, slug, disabled, created_at`,
        [name, slug]
      );
      return reply.code(201).send({ department: rowToDepartment(res.rows[0]) });
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "Department name or slug already exists" });
      }
      throw err;
    }
  });

  app.patch("/admin/departments/:id", { preHandler: [requireAdmin] }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: "Invalid department id" });
    }
    const body = (req.body as any) || {};
    const updates: string[] = [];
    const params: any[] = [id];
    let idx = 2;

    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) return reply.code(400).send({ error: "name cannot be empty" });
      updates.push(`name = $${idx++}`);
      params.push(name);
    }

    if (body.slug !== undefined) {
      const slug = normalizeSlug(String(body.slug || ""));
      updates.push(`slug = $${idx++}`);
      params.push(slug);
    }

    if (body.disabled !== undefined) {
      updates.push(`disabled = $${idx++}`);
      params.push(Boolean(body.disabled));
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: "No changes provided" });
    }

    try {
      const res = await db.query<DepartmentRow>(
        `UPDATE departments
         SET ${updates.join(", ")}
         WHERE id = $1
         RETURNING id, name, slug, disabled, created_at`,
        params
      );
      if (!res.rows[0]) {
        return reply.code(404).send({ error: "Department not found" });
      }
      return { department: rowToDepartment(res.rows[0]) };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "Department name or slug already exists" });
      }
      throw err;
    }
  });

  app.delete("/admin/departments/:id", { preHandler: [requireAdmin] }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: "Invalid department id" });
    }

    const deptRes = await db.query<DepartmentRow>(
      `SELECT id, name, slug, disabled, created_at FROM departments WHERE id = $1`,
      [id]
    );
    if (!deptRes.rows[0]) {
      return reply.code(404).send({ error: "Department not found" });
    }

    const userRes = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM users WHERE department_id = $1`,
      [id]
    );
    if ((userRes.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({
        error: "Reassign users before deleting this department."
      });
    }

    const projectRes = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE department_id = $1`,
      [id]
    );
    if ((projectRes.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({
        error: "Reassign or delete projects before deleting this department."
      });
    }

    await db.query(`DELETE FROM departments WHERE id = $1`, [id]);
    return { ok: true };
  });
}
