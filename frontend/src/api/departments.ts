import { CAT_API_BASE, authHeaders, httpError } from "./core";

// ---------- Departments (cat-api) ----------

export async function listDepartments(): Promise<Department[]> {
  const r = await fetch(`${CAT_API_BASE}/departments`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("list departments", r);
  const data = await r.json();
  return data.departments || [];
}

export async function adminListDepartments(): Promise<Department[]> {
  const r = await fetch(`${CAT_API_BASE}/admin/departments`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("list departments", r);
  const data = await r.json();
  return data.departments || [];
}

export async function adminCreateDepartment(payload: {
  name: string;
  slug?: string;
}): Promise<Department> {
  const r = await fetch(`${CAT_API_BASE}/admin/departments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await httpError("create department", r);
  const data = await r.json();
  return data.department as Department;
}

export async function adminUpdateDepartment(
  departmentId: number,
  updates: { name?: string; slug?: string; disabled?: boolean }
): Promise<Department> {
  const r = await fetch(`${CAT_API_BASE}/admin/departments/${departmentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates)
  });
  if (!r.ok) throw await httpError("update department", r);
  const data = await r.json();
  return data.department as Department;
}

export async function adminDeleteDepartment(departmentId: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/admin/departments/${departmentId}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete department", r);
}

