import { Pool } from "pg";
import crypto from "crypto";
import { assertPasswordPolicy } from "./passwordPolicy.js";

export type UserRole = "reviewer" | "manager" | "admin";

export type User = {
  id: number;
  username: string;
  passwordHash: string;
  role: UserRole;
  departmentId: number | null;
  displayName: string | null;
  email: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export type CreateUserInput = {
  username: string;
  password: string;
  role?: UserRole;
  departmentId?: number | null;
  displayName?: string | null;
  email?: string | null;
  disabled?: boolean;
  mustChangePassword?: boolean;
};

export type TM = {
  id: number;
  name: string;
  description?: string | null;
  createdAt: string;
};

export type TMMatch = {
  source: string;
  target: string;
  score: number;
};

export type TMConcordanceMode = "source" | "target" | "both";

export type TMConcordanceEntry = {
  source: string;
  target: string;
  score: number;
};

export type TMEntry = {
  id: number;
  tmId: number;
  sourceLang: string;
  targetLang: string;
  source: string;
  target: string;
  count: number;
  createdAt: string;
};

const connectionString =
  process.env.TM_DB_URL ||
  "postgresql://tmlite:tmlitepass@localhost:5432/tmlite";

const pool = new Pool({ connectionString });

// --- bootstrap -----------------------------------------------------------------

export async function initStore() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW())
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_unique
      ON departments(LOWER(name));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_slug_unique
      ON departments(LOWER(slug)) WHERE slug IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_departments_disabled
      ON departments(disabled);

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'reviewer',
      department_id INTEGER,
      display_name TEXT,
      email TEXT,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_at TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW())
    );

    CREATE TABLE IF NOT EXISTS tms (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW())
    );

    CREATE TABLE IF NOT EXISTS tm_units (
      id SERIAL PRIMARY KEY,
      tm_id INTEGER NOT NULL REFERENCES tms(id) ON DELETE CASCADE,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()),
      UNIQUE (tm_id, source_lang, target_lang, source, target)
    );

    CREATE INDEX IF NOT EXISTS idx_tm_units_search
      ON tm_units (tm_id, source_lang, target_lang, source);

    CREATE INDEX IF NOT EXISTS idx_tm_units_source_trgm
      ON tm_units
      USING gin (source gin_trgm_ops);

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS display_name TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
  `);

  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'reviewer';`);

  await normalizeLegacyRoles();
  const defaultDepartmentId = await ensureDefaultDepartment();
  await pool.query(
    `UPDATE users
     SET department_id = $1
     WHERE role <> 'admin' AND department_id IS NULL`,
    [defaultDepartmentId]
  );
  await pool.query(`DROP INDEX IF EXISTS idx_users_single_admin;`);
  await ensureTmDefaults();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(calc, "hex")
  );
}

type DepartmentRow = {
  id: number;
  disabled: boolean;
};

function normalizeDepartmentId(input: unknown): number | null {
  if (input === undefined || input === null || String(input).trim() === "") return null;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

async function getDepartmentById(id: number): Promise<DepartmentRow | null> {
  const { rows } = await pool.query<DepartmentRow>(
    `SELECT id, disabled FROM departments WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), disabled: Boolean(row.disabled) };
}

async function ensureDefaultDepartment(): Promise<number> {
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM departments ORDER BY id ASC LIMIT 1`
  );
  if (existing.rows[0]?.id) return Number(existing.rows[0].id);
  const res = await pool.query<{ id: number }>(
    `INSERT INTO departments(name, slug)
     VALUES ($1, $2)
     RETURNING id`,
    ["General", "general"]
  );
  return Number(res.rows[0]?.id);
}

async function normalizeLegacyRoles() {
  await pool.query(
    `UPDATE users
     SET role = 'reviewer'
     WHERE role IS NULL OR role = '' OR role = 'translator' OR role = 'user'`
  );
}

async function ensureTmDefaults() {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM tms`
  );
  if (rows.length === 0 || rows[0].count === "0") {
    const defaultName = process.env.DEFAULT_TM_NAME || "Shared TM";
    await pool.query(
      `INSERT INTO tms(name, description) VALUES($1, $2)`,
      [defaultName, "Default organization memory"]
    );
    console.log(`[tm-proxy] Created default TM '${defaultName}'`);
  }
}

// --- users ----------------------------------------------------------------------

export async function findUserByUsername(
  username: string
): Promise<User | null> {
  const { rows } = await pool.query(
    `
      SELECT id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
      FROM users
      WHERE username = $1
    `,
    [username]
  );
  if (!rows[0]) return null;
  return mapUser(rows[0]);
}

export function checkPassword(user: User, password: string): boolean {
  return verifyPassword(password, user.passwordHash);
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const {
    username,
    password,
    role = "reviewer",
    departmentId,
    displayName = null,
    email = null,
    disabled = false,
    mustChangePassword = false
  } = input;
  const normalizedUsername = username.trim().toLowerCase();
  assertPasswordPolicy(password);
  const passwordHash = hashPassword(password);
  const normalizedRole = normalizeRole(role);

  let resolvedDepartmentId: number | null = null;
  if (normalizedRole !== "admin") {
    resolvedDepartmentId = normalizeDepartmentId(departmentId);
    if (!resolvedDepartmentId) {
      throw Object.assign(new Error("Department is required for managers and reviewers."), {
        code: "DEPARTMENT_REQUIRED"
      });
    }
    const department = await getDepartmentById(resolvedDepartmentId);
    if (!department || department.disabled) {
      throw Object.assign(new Error("Department is invalid or disabled."), {
        code: "DEPARTMENT_INVALID"
      });
    }
  }

  const { rows } = await pool.query(
    `
      INSERT INTO users(username, password_hash, role, department_id, display_name, email, disabled, must_change_password)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
    `,
    [
      normalizedUsername,
      passwordHash,
      normalizedRole,
      resolvedDepartmentId,
      displayName,
      email,
      Boolean(disabled),
      Boolean(mustChangePassword)
    ]
  );
  return mapUser(rows[0]);
}

export async function listUsers(): Promise<User[]> {
  const { rows } = await pool.query(
    `
      SELECT id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
      FROM users
      ORDER BY created_at ASC
    `
  );
  return rows.map(mapUser);
}

export async function getUserById(id: number): Promise<User | null> {
  const { rows } = await pool.query(
    `
      SELECT id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
      FROM users
      WHERE id = $1
    `,
    [id]
  );
  if (!rows[0]) return null;
  return mapUser(rows[0]);
}

export async function updateUserRole(
  id: number,
  role: UserRole,
  departmentId?: number | null
): Promise<User | null> {
  const existing = await getUserById(id);
  if (!existing) return null;

  const normalizedRole = normalizeRole(role);

  if (existing.role === "admin" && normalizedRole !== "admin") {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      throw Object.assign(new Error("At least one admin is required."), {
        code: "ADMIN_REQUIRED"
      });
    }
  }

  let nextDepartmentId: number | null = null;
  if (normalizedRole !== "admin") {
    nextDepartmentId = normalizeDepartmentId(departmentId ?? existing.departmentId);
    if (!nextDepartmentId) {
      throw Object.assign(new Error("Department is required for managers and reviewers."), {
        code: "DEPARTMENT_REQUIRED"
      });
    }
    const department = await getDepartmentById(nextDepartmentId);
    if (!department || department.disabled) {
      throw Object.assign(new Error("Department is invalid or disabled."), {
        code: "DEPARTMENT_INVALID"
      });
    }
  }

  const { rows } = await pool.query(
    `
      UPDATE users
      SET role = $2,
          department_id = $3
      WHERE id = $1
      RETURNING id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
    `,
    [id, normalizedRole, nextDepartmentId]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function updateUserProfile(params: {
  id: number;
  displayName?: string | null;
  email?: string | null;
}): Promise<User | null> {
  const { id, displayName, email } = params;
  const { rows } = await pool.query(
    `
      UPDATE users
      SET display_name = CASE
            WHEN $2 IS NULL THEN display_name
            ELSE $2
          END,
          email = CASE
            WHEN $3 IS NULL THEN email
            ELSE $3
          END
      WHERE id = $1
      RETURNING id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
    `,
    [id, displayName ?? null, email ?? null]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function updateUserDepartment(
  id: number,
  departmentId: number | null
): Promise<User | null> {
  const existing = await getUserById(id);
  if (!existing) return null;
  if (existing.role === "admin") {
    if (departmentId == null) return existing;
    throw Object.assign(new Error("Admins cannot be assigned to a department."), {
      code: "ADMIN_DEPARTMENT_LOCKED"
    });
  }

  const nextDepartmentId = normalizeDepartmentId(departmentId);
  if (!nextDepartmentId) {
    throw Object.assign(new Error("Department is required for managers and reviewers."), {
      code: "DEPARTMENT_REQUIRED"
    });
  }
  const department = await getDepartmentById(nextDepartmentId);
  if (!department || department.disabled) {
    throw Object.assign(new Error("Department is invalid or disabled."), {
      code: "DEPARTMENT_INVALID"
    });
  }

  const { rows } = await pool.query(
    `
      UPDATE users
      SET department_id = $2
      WHERE id = $1
      RETURNING id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
    `,
    [id, nextDepartmentId]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function resetUserPassword(
  id: number,
  newPassword: string
): Promise<User | null> {
  assertPasswordPolicy(newPassword);
  const passwordHash = hashPassword(newPassword);
  const { rows } = await pool.query(
    `
      UPDATE users
      SET password_hash = $2,
          must_change_password = TRUE,
          failed_attempts = 0,
          locked_at = NULL
      WHERE id = $1
      RETURNING id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
    `,
    [id, passwordHash]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function changeUserPassword(
  id: number,
  newPassword: string
): Promise<User | null> {
  assertPasswordPolicy(newPassword);
  const passwordHash = hashPassword(newPassword);
  const { rows } = await pool.query(
    `
      UPDATE users
      SET password_hash = $2,
          must_change_password = FALSE,
          failed_attempts = 0,
          locked_at = NULL
      WHERE id = $1
      RETURNING id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
    `,
    [id, passwordHash]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function setUserDisabled(
  id: number,
  disabled: boolean
): Promise<User | null> {
  const { rows } = await pool.query(
    `
      UPDATE users
      SET disabled = $2
      WHERE id = $1
      RETURNING id, username, password_hash, role, department_id, display_name, email, disabled, must_change_password, failed_attempts, locked_at, last_login_at, created_at
    `,
    [id, Boolean(disabled)]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function recordLoginAttempt(
  id: number,
  success: boolean,
  maxAttempts = 5
): Promise<void> {
  if (success) {
    await pool.query(
      `
        UPDATE users
        SET failed_attempts = 0,
            locked_at = NULL,
            last_login_at = NOW()
        WHERE id = $1
      `,
      [id]
    );
    return;
  }
  const { rows } = await pool.query(
    `
      UPDATE users
      SET failed_attempts = failed_attempts + 1,
          locked_at = CASE
            WHEN failed_attempts + 1 >= $2 THEN NOW()
            ELSE locked_at
          END
      WHERE id = $1
      RETURNING failed_attempts
    `,
    [id, maxAttempts]
  );
  const attempts = Number(rows[0]?.failed_attempts ?? 0);
  if (attempts >= maxAttempts) {
    await pool.query(
      `
        UPDATE users
        SET locked_at = COALESCE(locked_at, NOW())
        WHERE id = $1
      `,
      [id]
    );
  }
}

export async function clearUserLockout(id: number): Promise<void> {
  await pool.query(
    `
      UPDATE users
      SET failed_attempts = 0,
          locked_at = NULL
      WHERE id = $1
    `,
    [id]
  );
}

export async function deleteUser(id: number): Promise<boolean> {
  const result = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  return Number(result.rowCount ?? 0) > 0;
}

// --- TM registry ----------------------------------------------------------------

export async function listTMs(): Promise<TM[]> {
  const { rows } = await pool.query(
    `
      SELECT id, name, description, created_at
      FROM tms
      ORDER BY created_at ASC
    `
  );
  return rows.map(mapTM);
}

export async function getTM(tmId: number): Promise<TM | null> {
  const { rows } = await pool.query(
    `
      SELECT id, name, description, created_at
      FROM tms
      WHERE id = $1
    `,
    [tmId]
  );
  if (!rows[0]) return null;
  return mapTM(rows[0]);
}

export async function createTM(
  name: string,
  description?: string | null
): Promise<TM> {
  const { rows } = await pool.query(
    `
      INSERT INTO tms(name, description)
      VALUES($1, $2)
      RETURNING id, name, description, created_at
    `,
    [name, description ?? null]
  );
  return mapTM(rows[0]);
}

export async function findTMByName(name: string): Promise<TM | null> {
  const { rows } = await pool.query(
    `
      SELECT id, name, description, created_at
      FROM tms
      WHERE name = $1
      LIMIT 1
    `,
    [name]
  );
  if (!rows[0]) return null;
  return mapTM(rows[0]);
}

export async function deleteTM(tmId: number): Promise<void> {
  await pool.query(`DELETE FROM tms WHERE id = $1`, [tmId]);
}

// --- TM data --------------------------------------------------------------------

export async function addToTM(
  tmId: number,
  sourceLang: string,
  targetLang: string,
  source: string,
  target: string
): Promise<{ ok: true }> {
  await pool.query(
    `
      INSERT INTO tm_units (tm_id, source_lang, target_lang, source, target, count)
      VALUES ($1, $2, $3, $4, $5, 1)
      ON CONFLICT (tm_id, source_lang, target_lang, source, target)
      DO UPDATE SET
        count = tm_units.count + 1,
        target = EXCLUDED.target
    `,
    [tmId, sourceLang, targetLang, source, target]
  );
  return { ok: true };
}

export async function searchTM(
  tmId: number,
  sourceLang: string,
  targetLang: string,
  text: string,
  limit = 10
): Promise<TMMatch[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 20);

  const { rows } = await pool.query(
    `
      SELECT
        source,
        target,
        similarity(source, $4) AS score
      FROM tm_units
      WHERE tm_id = $1
        AND source_lang = $2
        AND target_lang = $3
        AND source % $4
      ORDER BY score DESC, count DESC, created_at DESC
      LIMIT $5
    `,
    [tmId, sourceLang, targetLang, trimmed, safeLimit]
  );

  return rows.map((row: any) => ({
    source: row.source as string,
    target: row.target as string,
    score: Number(row.score ?? 0.6)
  }));
}

export async function searchTMConcordance(
  tmId: number,
  sourceLang: string,
  targetLang: string,
  query: string,
  mode: TMConcordanceMode = "source",
  limit = 20
): Promise<TMConcordanceEntry[]> {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];
  const safeMode: TMConcordanceMode =
    mode === "target" || mode === "both" ? mode : "source";
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const pattern = `%${trimmed}%`;

  const { rows } = await pool.query(
    `
      SELECT
        source,
        target,
        CASE
          WHEN $4 = 'target' THEN similarity(target, $5)
          ELSE similarity(source, $5)
        END AS score
      FROM tm_units
      WHERE tm_id = $1
        AND source_lang = $2
        AND target_lang = $3
        AND (
          ($4 = 'source' AND source ILIKE $6) OR
          ($4 = 'target' AND target ILIKE $6) OR
          ($4 = 'both' AND (source ILIKE $6 OR target ILIKE $6))
        )
      ORDER BY
        score DESC,
        count DESC,
        created_at DESC
      LIMIT $7
    `,
    [tmId, sourceLang, targetLang, safeMode, trimmed, pattern, safeLimit]
  );

  return rows.map((row: any) => ({
    source: String(row.source ?? ""),
    target: String(row.target ?? ""),
    score: Number(row.score ?? 0)
  }));
}

export async function getAllEntriesCursor(
  tmId: number
): Promise<TMEntry[]> {
  const { rows } = await pool.query(
    `
      SELECT id, tm_id, source_lang, target_lang, source, target, count, created_at
      FROM tm_units
      WHERE tm_id = $1
      ORDER BY created_at ASC
    `,
    [tmId]
  );
  return rows.map(mapEntry);
}

export async function getAllEntries(
  tmId: number,
  sourceLang?: string,
  targetLang?: string
): Promise<TMEntry[]> {
  const clauses = ["tm_id = $1"];
  const params: any[] = [tmId];
  if (sourceLang) {
    clauses.push(`source_lang = $${clauses.length + 1}`);
    params.push(sourceLang);
  }
  if (targetLang) {
    clauses.push(`target_lang = $${clauses.length + 1}`);
    params.push(targetLang);
  }
  const where = clauses.join(" AND ");

  const { rows } = await pool.query(
    `
      SELECT
        id,
        tm_id,
        source_lang,
        target_lang,
        source,
        target,
        count,
        created_at
      FROM tm_units
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT 500
    `,
    params
  );

  return rows.map(mapEntry);
}

export async function tmEntryExists(
  tmId: number,
  sourceLang: string,
  targetLang: string,
  source: string,
  target: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `
      SELECT 1
      FROM tm_units
      WHERE tm_id = $1
        AND source_lang = $2
        AND target_lang = $3
        AND source = $4
        AND target = $5
      LIMIT 1
    `,
    [tmId, sourceLang, targetLang, source, target]
  );
  return rows.length > 0;
}

export async function getTMEntryCount(tmId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM tm_units WHERE tm_id = $1`,
    [tmId]
  );
  return Number(rows[0]?.count ?? 0);
}

// --- helpers --------------------------------------------------------------------

function mapUser(row: any): User {
  return {
    id: Number(row.id),
    username: row.username,
    passwordHash: row.password_hash,
    role: normalizeRole(row.role),
    departmentId:
      row.department_id == null || row.department_id === ""
        ? null
        : Number(row.department_id),
    displayName: row.display_name ?? null,
    email: row.email ?? null,
    disabled: Boolean(row.disabled),
    mustChangePassword: Boolean(row.must_change_password),
    failedAttempts: Number(row.failed_attempts ?? 0),
    lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : null,
    lastLoginAt: row.last_login_at
      ? new Date(row.last_login_at).toISOString()
      : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function normalizeRole(input: unknown): UserRole {
  const value = String(input || "").trim().toLowerCase();
  if (value === "admin") return "admin";
  if (value === "manager") return "manager";
  if (value === "user") return "reviewer";
  return "reviewer";
}

export async function countAdmins() {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`
  );
  return Number(rows[0]?.count ?? 0);
}

function mapTM(row: any): TM {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function mapEntry(row: any): TMEntry {
  return {
    id: Number(row.id),
    tmId: Number(row.tm_id),
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    source: row.source,
    target: row.target,
    count: Number(row.count),
    createdAt: new Date(row.created_at).toISOString()
  };
}
