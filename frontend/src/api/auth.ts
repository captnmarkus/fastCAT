import { TM_API_BASE, authHeaders, httpError } from "./core";

// ---------- Auth (via tm-proxy) ----------

export type SetupStatus = {
  status: "configured" | "not_configured";
};

export async function getSetupStatus(): Promise<SetupStatus> {
  const r = await fetch(`${TM_API_BASE}/setup/status`);
  if (!r.ok) throw await httpError("setup status", r);
  return (await r.json()) as SetupStatus;
}

export async function initializeSetup(payload: {
  admin: { username: string; password: string; email?: string; displayName?: string };
  languages?: string[];
  defaults?: { defaultSource?: string; defaultTargets?: string[] };
  departments?: Array<string | { name: string; slug?: string }>;
}): Promise<{ ok: true }> {
  const r = await fetch(`${TM_API_BASE}/setup/initialize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await httpError("setup initialize", r);
  return { ok: true };
}

export async function login(username: string, password: string) {
  const r = await fetch(`${TM_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) throw await httpError("login", r);
  const data = await r.json();
  localStorage.setItem("token", data.token);
  return data.user;
}

export async function me() {
  const r = await fetch(`${TM_API_BASE}/auth/me`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error("not logged in");
  const data = await r.json();
  return data.user;
}

export async function changePassword(params: {
  currentPassword: string;
  newPassword: string;
}) {
  const r = await fetch(`${TM_API_BASE}/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(params)
  });
  if (!r.ok) throw await httpError("change password", r);
  const data = await r.json();
  if (data?.token) localStorage.setItem("token", data.token);
  return data.user;
}

export async function updateMyProfile(params: {
  email?: string;
  displayName?: string;
}) {
  const r = await fetch(`${TM_API_BASE}/auth/profile`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(params)
  });
  if (!r.ok) throw await httpError("update profile", r);
  const data = await r.json();
  if (data?.token) localStorage.setItem("token", data.token);
  return data.user;
}

export async function logout() {
  localStorage.removeItem("token");
}

