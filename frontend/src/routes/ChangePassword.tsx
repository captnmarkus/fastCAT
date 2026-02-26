import React, { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePassword } from "../api";
import type { AuthUser } from "../types/app";

export default function ChangePassword({
  currentUser,
  onUpdated
}: {
  currentUser: AuthUser;
  onUpdated: (user: AuthUser) => void;
}) {
  const nav = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      setError("Enter your current password and a new password.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const user = await changePassword({ currentPassword, newPassword });
      onUpdated(user);
      nav("/", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Failed to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="d-flex justify-content-center">
      <div className="card shadow-sm" style={{ width: 520, maxWidth: "100%" }}>
        <div className="card-body">
          <h4 className="mb-1">Change password</h4>
          {currentUser.mustChangePassword && (
            <div className="text-muted small mb-3">
              Password change is required before you can continue.
            </div>
          )}
          {error && <div className="alert alert-danger py-2">{error}</div>}
          <form onSubmit={onSubmit}>
            <div className="mb-3">
              <label className="form-label small text-uppercase text-muted">
                Current password
              </label>
              <input
                type="password"
                className="form-control"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className="form-label small text-uppercase text-muted">
                New password
              </label>
              <input
                type="password"
                className="form-control"
                value={newPassword}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className="form-label small text-uppercase text-muted">
                Confirm new password
              </label>
              <input
                type="password"
                className="form-control"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => nav("/", { replace: true })}
                disabled={saving && Boolean(currentUser.mustChangePassword)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-dark"
                disabled={saving}
              >
                {saving ? "Saving..." : "Update password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

