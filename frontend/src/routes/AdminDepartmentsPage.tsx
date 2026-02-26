import React, { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../types/app";
import {
  adminCreateDepartment,
  adminDeleteDepartment,
  adminListDepartments,
  adminUpdateDepartment,
  type Department
} from "../api";
import { formatDateTime } from "../utils/format";

type EditState = {
  id: number | null;
  name: string;
  slug: string;
};

export default function AdminDepartmentsPage({ currentUser }: { currentUser: AuthUser }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newDept, setNewDept] = useState({ name: "", slug: "" });
  const [editState, setEditState] = useState<EditState>({ id: null, name: "", slug: "" });

  const sortedDepartments = useMemo(() => {
    return [...departments].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [departments]);

  async function reloadDepartments() {
    setLoading(true);
    setError(null);
    try {
      const list = await adminListDepartments();
      setDepartments(list);
    } catch (err: any) {
      setError(err?.userMessage || "Failed to load departments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadDepartments();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function handleCreateDepartment(e: React.FormEvent) {
    e.preventDefault();
    const name = newDept.name.trim();
    if (!name) {
      setError("Department name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminCreateDepartment({
        name,
        slug: newDept.slug.trim() || undefined
      });
      setNewDept({ name: "", slug: "" });
      await reloadDepartments();
      setNotice("Department created.");
    } catch (err: any) {
      setError(err?.userMessage || "Failed to create department.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDepartment() {
    if (editState.id == null) return;
    const name = editState.name.trim();
    if (!name) {
      setError("Department name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminUpdateDepartment(editState.id, {
        name,
        slug: editState.slug.trim() || ""
      });
      setEditState({ id: null, name: "", slug: "" });
      await reloadDepartments();
      setNotice("Department updated.");
    } catch (err: any) {
      setError(err?.userMessage || "Failed to update department.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleDepartment(dept: Department) {
    setSaving(true);
    setError(null);
    try {
      await adminUpdateDepartment(dept.id, { disabled: !dept.disabled });
      await reloadDepartments();
      setNotice(dept.disabled ? "Department activated." : "Department deactivated.");
    } catch (err: any) {
      setError(err?.userMessage || "Failed to update department.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDepartment(dept: Department) {
    const ok = window.confirm(`Delete department ${dept.name}?`);
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await adminDeleteDepartment(dept.id);
      await reloadDepartments();
      setNotice("Department deleted.");
    } catch (err: any) {
      setError(err?.userMessage || "Failed to delete department.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <div className="text-muted small">Admin</div>
          <h2 className="mb-0">Departments</h2>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success py-2">{notice}</div>}

      <div className="card-enterprise p-4 mb-3">
        <div className="fw-semibold mb-2">Create department</div>
        <form className="row g-2" onSubmit={handleCreateDepartment}>
          <div className="col-md-5">
            <label className="form-label small text-muted">Name</label>
            <input
              className="form-control form-control-sm"
              placeholder="Localization"
              value={newDept.name}
              onChange={(e) => setNewDept((p) => ({ ...p, name: e.target.value }))}
              disabled={saving}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted">Slug (optional)</label>
            <input
              className="form-control form-control-sm"
              placeholder="localization"
              value={newDept.slug}
              onChange={(e) => setNewDept((p) => ({ ...p, slug: e.target.value }))}
              disabled={saving}
            />
          </div>
          <div className="col-md-3 d-flex align-items-end justify-content-end">
            <button className="btn btn-dark btn-sm" type="submit" disabled={saving}>
              Create department
            </button>
          </div>
        </form>
      </div>

      <div className="card-enterprise p-4">
        <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
          <div className="fw-semibold">Departments</div>
          <span className="text-muted small">{departments.length} total</span>
        </div>

        {loading ? (
          <div className="text-center text-muted py-4">
            <span className="spinner-border" />
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr className="text-muted small">
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedDepartments.map((dept) => {
                  const isEditing = editState.id === dept.id;
                  return (
                    <tr key={dept.id}>
                      <td>
                        {isEditing ? (
                          <input
                            className="form-control form-control-sm"
                            value={editState.name}
                            onChange={(e) => setEditState((prev) => ({ ...prev, name: e.target.value }))}
                            disabled={saving}
                          />
                        ) : (
                          <div className="fw-semibold">{dept.name}</div>
                        )}
                      </td>
                      <td className="text-muted small">
                        {isEditing ? (
                          <input
                            className="form-control form-control-sm"
                            value={editState.slug}
                            onChange={(e) => setEditState((prev) => ({ ...prev, slug: e.target.value }))}
                            disabled={saving}
                          />
                        ) : (
                          dept.slug || "-"
                        )}
                      </td>
                      <td>
                        {dept.disabled ? (
                          <span className="badge text-bg-secondary">Disabled</span>
                        ) : (
                          <span className="badge text-bg-light text-dark">Active</span>
                        )}
                      </td>
                      <td className="text-muted small">{formatDateTime(dept.createdAt) || "-"}</td>
                      <td className="text-end">
                        <div className="btn-group btn-group-sm">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-outline-primary"
                                onClick={handleSaveDepartment}
                                disabled={saving}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={() => setEditState({ id: null, name: "", slug: "" })}
                                disabled={saving}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={() =>
                                  setEditState({
                                    id: dept.id,
                                    name: dept.name || "",
                                    slug: dept.slug || ""
                                  })
                                }
                                disabled={saving}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={() => handleToggleDepartment(dept)}
                                disabled={saving}
                              >
                                {dept.disabled ? "Activate" : "Deactivate"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-danger"
                                onClick={() => handleDeleteDepartment(dept)}
                                disabled={saving}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sortedDepartments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted small">
                      No departments found.
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
