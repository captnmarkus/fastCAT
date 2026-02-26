import { TM_API_BASE, authHeaders, httpError } from "./core";

// ---------- Admin (tm-proxy) ----------

export async function adminListUsers(): Promise<AdminUser[]> {
  const r = await fetch(`${TM_API_BASE}/admin/users`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("list users", r);
  const data = await r.json();
  return data.users || [];
}

export async function listUsersForAssignment(): Promise<AdminUser[]> {
  const r = await fetch(`${TM_API_BASE}/users`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("list users", r);
  const data = await r.json();
  return data.users || [];
}

export async function adminCreateUser(payload: {
  username: string;
  password: string;
  role?: string;
  displayName?: string;
  email?: string;
  departmentId?: number | null;
}): Promise<AdminUser> {
  const r = await fetch(`${TM_API_BASE}/admin/users`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await httpError("create user", r);
  const data = await r.json();
  return data.user as AdminUser;
}

export async function adminUpdateUser(
  userId: number,
  updates: {
    role?: string;
    displayName?: string | null;
    email?: string | null;
    disabled?: boolean;
    departmentId?: number | null;
  }
): Promise<AdminUser> {
  const r = await fetch(`${TM_API_BASE}/admin/users/${userId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(updates)
  });
  if (!r.ok) throw await httpError("update user", r);
  const data = await r.json();
  return data.user as AdminUser;
}

export async function adminResetUserPassword(
  userId: number,
  password: string
): Promise<AdminUser> {
  const r = await fetch(
    `${TM_API_BASE}/admin/users/${userId}/reset-password`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ password })
    }
  );
  if (!r.ok) throw await httpError("reset password", r);
  const data = await r.json();
  return data.user as AdminUser;
}

export async function adminUnlockUser(userId: number): Promise<AdminUser> {
  const r = await fetch(
    `${TM_API_BASE}/admin/users/${userId}/unlock`,
    {
      method: "POST",
      headers: { ...authHeaders() }
    }
  );
  if (!r.ok) throw await httpError("unlock user", r);
  const data = await r.json();
  return data.user as AdminUser;
}

export async function adminDeleteUser(userId: number): Promise<void> {
  const r = await fetch(`${TM_API_BASE}/admin/users/${userId}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete user", r);
}

