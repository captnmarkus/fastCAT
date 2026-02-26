import React, { useEffect, useState } from "react";
import type { AuthUser } from "../../../types/app";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListDepartments,
  adminListUsers,
  adminResetUserPassword,
  adminUnlockUser,
  adminUpdateUser,
  type AdminUser,
  type Department
} from "../../../api";
import { formatDateTime } from "../../../utils/format";

export default function UserManagementTab({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState({
    username: "",
    password: "",
    displayName: "",
    email: "",
    role: "reviewer",
    departmentId: ""
  });
  const adminCount = users.filter((user) => user.role === "admin").length;
  const activeDepartments = departments.filter((dept) => !dept.disabled);
  const defaultDepartmentId = activeDepartments[0]?.id ?? null;

  async function reloadUsers() {
    setLoading(true);
    setError(null);
    try {
      const [list, deptList] = await Promise.all([adminListUsers(), adminListDepartments()]);
      setUsers(list);
      setDepartments(deptList);
    } catch (err: any) {
      setError(err?.userMessage || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadUsers();
  }, []);

  useEffect(() => {
    if (newUserForm.role === "admin") return;
    if (!newUserForm.departmentId && defaultDepartmentId) {
      setNewUserForm((prev) => ({ ...prev, departmentId: String(defaultDepartmentId) }));
    }
  }, [defaultDepartmentId, newUserForm.departmentId, newUserForm.role]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUserForm.username.trim() || !newUserForm.password.trim()) {
      setError("Username and password are required");
      return;
    }
    const role = newUserForm.role;
    const departmentId =
      role === "admin" ? null : Number(String(newUserForm.departmentId || "").trim());
    if (role !== "admin" && (!Number.isFinite(departmentId) || departmentId <= 0)) {
      setError("Department is required for managers and reviewers.");
      return;
    }
    setError(null);
    try {
      await adminCreateUser({
        username: newUserForm.username.trim(),
        password: newUserForm.password.trim(),
        role,
        departmentId: role === "admin" ? null : departmentId,
        displayName: newUserForm.displayName.trim() || undefined,
        email: newUserForm.email.trim() || undefined
      });
      setNewUserForm({
        username: "",
        password: "",
        displayName: "",
        email: "",
        role: "reviewer",
        departmentId: ""
      });
      await reloadUsers();
    } catch (err: any) {
      setError(err?.userMessage || "Failed to create user.");
    }
  }

  async function handleRoleChange(user: AdminUser, role: string) {
    if (role === user.role) return;
    const isAdminUser = user.role === "admin";
    if (isAdminUser && role !== "admin" && adminCount <= 1) {
      setError("At least one admin is required.");
      return;
    }

    const nextDepartmentId =
      role === "admin"
        ? null
        : Number.isFinite(Number(user.departmentId)) && user.departmentId
          ? user.departmentId
          : defaultDepartmentId;

    if (role !== "admin" && (!nextDepartmentId || !Number.isFinite(nextDepartmentId))) {
      setError("Select a department before assigning a non-admin role.");
      return;
    }
    const ok = window.confirm(`Change ${user.displayName || user.username} to ${role}?`);
    if (!ok) return;
    setError(null);
    try {
      await adminUpdateUser(user.id, {
        role,
        departmentId: role === "admin" ? null : nextDepartmentId
      });
      await reloadUsers();
    } catch (err: any) {
      setError(err?.userMessage || "Failed to update role.");
    }
  }

  async function handleDepartmentChange(user: AdminUser, departmentId: number) {
    if (user.role === "admin") {
      setError("Admins do not belong to departments.");
      return;
    }
    if (!Number.isFinite(departmentId) || departmentId <= 0) {
      setError("Select a valid department.");
      return;
    }
    if (user.departmentId === departmentId) return;
    setError(null);
    try {
      await adminUpdateUser(user.id, { departmentId });
      await reloadUsers();
    } catch (err: any) {
      setError(err?.userMessage || "Failed to update department.");
    }
  }

  async function handleResetPassword(user: AdminUser) {
    const password = window.prompt(`Enter new password for ${user.displayName || user.username}`);
    if (!password) return;
    setError(null);
    try {
      await adminResetUserPassword(user.id, password);
      await reloadUsers();
    } catch (err: any) {
      setError(err?.userMessage || "Failed to reset password.");
    }
  }

  async function handleUnlock(user: AdminUser) {
    setError(null);
    try {
      await adminUnlockUser(user.id);
      await reloadUsers();
    } catch (err: any) {
      setError(err?.userMessage || "Failed to unlock user.");
    }
  }

  async function handleToggleDisabled(user: AdminUser) {
    if (user.role === "admin") {
      setError("The admin account cannot be disabled.");
      return;
    }
    if (String(user.id) === String(currentUser.id)) {
      setError("You cannot disable your own account.");
      return;
    }
    const ok = window.confirm(`${user.disabled ? "Enable" : "Disable"} ${user.displayName || user.username}?`);
    if (!ok) return;
    setError(null);
    try {
      await adminUpdateUser(user.id, { disabled: !user.disabled });
      await reloadUsers();
    } catch (err: any) {
      setError(err?.userMessage || "Failed to update user.");
    }
  }

  async function handleDelete(user: AdminUser) {
    const isSelf = String(user.id) === String(currentUser.id);
    if (user.role === "admin") {
      if (!isSelf) {
        setError("Admins cannot delete other admins.");
        return;
      }
      if (adminCount <= 1) {
        setError("At least one admin is required.");
        return;
      }
    } else if (isSelf) {
      setError("You cannot delete your own account.");
      return;
    }
    const ok = window.confirm(`Delete user ${user.displayName || user.username}?`);
    if (!ok) return;
    setError(null);
    try {
      await adminDeleteUser(user.id);
      if (isSelf) {
        localStorage.removeItem("token");
        window.location.href = "/";
        return;
      }
      await reloadUsers();
    } catch (err: any) {
      setError(err?.userMessage || "Failed to delete user.");
    }
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        {error && <div className="alert alert-danger">{error}</div>}

        <form className="row g-2 mb-3" onSubmit={handleCreateUser}>
          <div className="col-md-2">
            <label className="form-label small text-muted">Username</label>
            <input
              className="form-control form-control-sm"
              placeholder="reviewer01"
              value={newUserForm.username}
              onChange={(e) => setNewUserForm((p) => ({ ...p, username: e.target.value }))}
            />
          </div>
          <div className="col-md-2">
            <label className="form-label small text-muted">Password</label>
            <input
              type="password"
              className="form-control form-control-sm"
              placeholder="password"
              value={newUserForm.password}
              onChange={(e) => setNewUserForm((p) => ({ ...p, password: e.target.value }))}
            />
          </div>
          <div className="col-md-2">
            <label className="form-label small text-muted">Role</label>
            <select
              className="form-select form-select-sm"
              value={newUserForm.role}
              onChange={(e) => {
                const nextRole = e.target.value;
                setNewUserForm((p) => ({
                  ...p,
                  role: nextRole,
                  departmentId:
                    nextRole === "admin"
                      ? ""
                      : p.departmentId || (defaultDepartmentId ? String(defaultDepartmentId) : "")
                }));
              }}
            >
              <option value="reviewer">Reviewer</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label small text-muted">Department</label>
            {newUserForm.role === "admin" ? (
              <input className="form-control form-control-sm" value="All departments" disabled />
            ) : (
              <select
                className="form-select form-select-sm"
                value={newUserForm.departmentId}
                onChange={(e) => setNewUserForm((p) => ({ ...p, departmentId: e.target.value }))}
                disabled={loading || departments.length === 0}
              >
                <option value="">Select department...</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={String(dept.id)} disabled={dept.disabled}>
                    {dept.name}
                    {dept.disabled ? " (disabled)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="col-md-2">
            <label className="form-label small text-muted">Display name</label>
            <input
              className="form-control form-control-sm"
              placeholder="Jane Doe"
              value={newUserForm.displayName}
              onChange={(e) => setNewUserForm((p) => ({ ...p, displayName: e.target.value }))}
            />
          </div>
          <div className="col-md-2">
            <label className="form-label small text-muted">Email</label>
            <input
              className="form-control form-control-sm"
              placeholder="jane@example.com"
              value={newUserForm.email}
              onChange={(e) => setNewUserForm((p) => ({ ...p, email: e.target.value }))}
            />
          </div>
          <div className="col-12 text-end">
            <button className="btn btn-dark btn-sm" type="submit" disabled={loading}>
              Create user
            </button>
          </div>
        </form>

        {loading ? (
          <div className="text-center text-muted py-4">
            <span className="spinner-border" />
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr className="text-muted small">
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Last login</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="fw-semibold">{user.displayName || user.username}</div>
                      <div className="text-muted small">{user.email || user.username}</div>
                    </td>
                    <td style={{ width: 180 }}>
                      <select
                        className="form-select form-select-sm"
                        value={user.role}
                        disabled={loading || (user.role === "admin" && adminCount <= 1)}
                        onChange={(e) => handleRoleChange(user, e.target.value)}
                      >
                        <option value="reviewer">Reviewer</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td style={{ width: 220 }}>
                      {user.role === "admin" ? (
                        <span className="text-muted">All departments</span>
                      ) : (
                        <select
                          className="form-select form-select-sm"
                          value={user.departmentId ?? ""}
                          onChange={(e) => handleDepartmentChange(user, Number(e.target.value))}
                          disabled={loading || departments.length === 0}
                        >
                          <option value="">Select department...</option>
                          {departments.map((dept) => (
                            <option key={dept.id} value={String(dept.id)} disabled={dept.disabled}>
                              {dept.name}
                              {dept.disabled ? " (disabled)" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{formatDateTime(user.lastLoginAt) || "-"}</td>
                    <td>
                      {user.disabled ? (
                        <span className="badge text-bg-secondary">Disabled</span>
                      ) : user.locked ? (
                        <span className="badge text-bg-danger">Locked</span>
                      ) : (
                        <span className="badge text-bg-light text-dark">Active</span>
                      )}
                      {user.mustChangePassword && !user.disabled && (
                        <span className="badge text-bg-warning ms-2">Password change required</span>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="btn-group btn-group-sm">
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => handleResetPassword(user)}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          disabled={user.role === "admin" || String(user.id) === String(currentUser.id)}
                          onClick={() => handleToggleDisabled(user)}
                        >
                          {user.disabled ? "Enable" : "Disable"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          disabled={!user.locked}
                          onClick={() => handleUnlock(user)}
                        >
                          Unlock
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger"
                          disabled={
                            user.role === "admin"
                              ? adminCount <= 1 || String(user.id) !== String(currentUser.id)
                              : false
                          }
                          onClick={() => handleDelete(user)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-muted small">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
