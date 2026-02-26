import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { changePassword, updateMyProfile } from "../../../api";
import type { AuthUser } from "../../../types/app";
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from "../../projects/shared/storage";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to read file."));
    };
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unsupported image."));
    img.src = dataUrl;
  });
}

async function createSquareAvatarDataUrl(file: File): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(sourceDataUrl);
  const canvas = document.createElement("canvas");
  const size = 160;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return sourceDataUrl;

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const crop = Math.min(srcW, srcH);
  const sx = Math.max(0, Math.floor((srcW - crop) / 2));
  const sy = Math.max(0, Math.floor((srcH - crop) / 2));
  ctx.drawImage(img, sx, sy, crop, crop, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function buildAvatarInitials(currentUser: AuthUser): string {
  const name = String(currentUser.displayName || currentUser.username || "").trim();
  if (!name) return "U";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return String(parts[0][0] || "U").toUpperCase();
  const first = String(parts[0][0] || "");
  const last = String(parts[parts.length - 1][0] || "");
  return `${first}${last}`.toUpperCase() || "U";
}

export default function ManageAccountTab({
  currentUser,
  onUserUpdated
}: {
  currentUser: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
}) {
  const isReviewer = currentUser.role === "reviewer";

  const [email, setEmail] = useState(currentUser.email || "");
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const userStorageKey = useMemo(() => {
    const id = String(currentUser.id || "").trim();
    const username = String(currentUser.username || "").trim();
    return (username || id).trim();
  }, [currentUser.id, currentUser.username]);
  const avatarStorageKey = useMemo(() => {
    return userStorageKey ? `fc:${userStorageKey}:avatar` : "fc:avatar";
  }, [userStorageKey]);
  const avatarInitials = useMemo(() => buildAvatarInitials(currentUser), [currentUser]);
  const [avatarCurrent, setAvatarCurrent] = useState<string | null>(null);
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSuccess, setAvatarSuccess] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setEmail(currentUser.email || "");
    setDisplayName(currentUser.displayName || "");
  }, [currentUser.displayName, currentUser.email]);

  useEffect(() => {
    const stored = safeLocalStorageGet(avatarStorageKey);
    const next = stored && stored.startsWith("data:image/") ? stored : null;
    setAvatarCurrent(next);
    setAvatarDraft(next);
    setAvatarError(null);
    setAvatarSuccess(null);
  }, [avatarStorageKey]);

  const profileDirty = useMemo(() => {
    const currentEmail = String(currentUser.email || "").trim();
    const currentDisplayName = String(currentUser.displayName || "").trim();
    if (String(email || "").trim() !== currentEmail) return true;
    if (!isReviewer && String(displayName || "").trim() !== currentDisplayName) return true;
    return false;
  }, [currentUser.displayName, currentUser.email, displayName, email, isReviewer]);
  const avatarDirty = avatarCurrent !== avatarDraft;

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!String(file.type || "").startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      setAvatarSuccess(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Image is too large. Maximum size is 5 MB.");
      setAvatarSuccess(null);
      return;
    }

    setAvatarError(null);
    setAvatarSuccess(null);
    try {
      const nextDataUrl = await createSquareAvatarDataUrl(file);
      if (nextDataUrl.length > 1_200_000) {
        setAvatarError("Image is still too large after processing. Please use a smaller image.");
        return;
      }
      setAvatarDraft(nextDataUrl);
    } catch (err: any) {
      setAvatarError(err?.message || "Unable to process image.");
    }
  }

  async function handleSaveAvatar() {
    if (!avatarDirty) return;
    setAvatarSaving(true);
    setAvatarError(null);
    setAvatarSuccess(null);
    try {
      if (avatarDraft) {
        safeLocalStorageSet(avatarStorageKey, avatarDraft);
      } else {
        safeLocalStorageRemove(avatarStorageKey);
      }
      setAvatarCurrent(avatarDraft);
      setAvatarSuccess("Profile photo updated.");
      try {
        window.dispatchEvent(new CustomEvent("fc:avatar:updated", { detail: { key: avatarStorageKey } }));
      } catch {
        // ignore
      }
    } finally {
      setAvatarSaving(false);
    }
  }

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!profileDirty) return;

    const trimmedEmail = String(email || "").trim();
    if (!trimmedEmail && currentUser.email) {
      setProfileError("Email cannot be empty.");
      return;
    }

    setProfileError(null);
    setProfileSuccess(null);
    setProfileSaving(true);
    try {
      const next = await updateMyProfile({
        email: trimmedEmail || undefined,
        ...(isReviewer ? {} : { displayName: String(displayName || "").trim() || undefined })
      });
      onUserUpdated(next);
      setProfileSuccess("Account updated.");
    } catch (err: any) {
      if (err?.status === 403) {
        setProfileError("You do not have permission to update these fields.");
      } else {
        setProfileError(err?.userMessage || err?.message || "Failed to update account.");
      }
    } finally {
      setProfileSaving(false);
    }
  }

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
    setSuccess(null);
    setSaving(true);
    try {
      const user = await changePassword({ currentPassword, newPassword });
      onUserUpdated(user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setSuccess("Password updated.");
    } catch (err: any) {
      if (err?.status === 401) {
        setError("Current password is incorrect.");
      } else {
        setError(err?.userMessage || "Failed to change password.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="card-enterprise">
        <div className="card-body">
          <div className="fw-bold mb-2">Account</div>

          {profileError && <div className="alert alert-danger py-2">{profileError}</div>}
          {profileSuccess && <div className="alert alert-success py-2">{profileSuccess}</div>}
          {avatarError && <div className="alert alert-danger py-2">{avatarError}</div>}
          {avatarSuccess && <div className="alert alert-success py-2">{avatarSuccess}</div>}

          <form onSubmit={onSaveProfile}>
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label small text-muted">Avatar</label>
                <div className="fc-account-avatar-row">
                  <div className="fc-account-avatar-preview" aria-hidden="true">
                    {avatarDraft ? (
                      <img src={avatarDraft} alt="" />
                    ) : (
                      <span className="fc-account-avatar-fallback">{avatarInitials}</span>
                    )}
                  </div>
                  <div className="fc-account-avatar-actions">
                    <input
                      type="file"
                      accept="image/*"
                      className="form-control form-control-sm"
                      onChange={handleAvatarFileChange}
                      disabled={avatarSaving}
                    />
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => {
                          setAvatarDraft(null);
                          setAvatarError(null);
                          setAvatarSuccess(null);
                        }}
                        disabled={avatarSaving || !avatarDraft}
                      >
                        Remove photo
                      </button>
                      <button
                        type="button"
                        className="btn btn-dark btn-sm"
                        onClick={handleSaveAvatar}
                        disabled={!avatarDirty || avatarSaving}
                      >
                        {avatarSaving ? "Saving..." : "Save photo"}
                      </button>
                    </div>
                    <div className="form-text">Square photos look best. PNG/JPG up to 5 MB.</div>
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Username</label>
                <input className="form-control form-control-sm" value={currentUser.username} readOnly />
              </div>
              {!isReviewer && (
                <div className="col-md-4">
                  <label className="form-label small text-muted">Display name</label>
                  <input
                    className="form-control form-control-sm"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={profileSaving}
                  />
                </div>
              )}
              <div className="col-md-4">
                <label className="form-label small text-muted">Email</label>
                <input
                  className="form-control form-control-sm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={profileSaving}
                  autoComplete="email"
                />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Role</label>
                <input className="form-control form-control-sm text-capitalize" value={currentUser.role} readOnly />
              </div>
              <div className="col-12 text-end">
                <button type="submit" className="btn btn-dark btn-sm" disabled={!profileDirty || profileSaving}>
                  {profileSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className="card-enterprise">
        <div className="card-body">
          <div className="fw-bold mb-1">Change password</div>
          <div className="text-muted small mb-3">Use a strong password you don&apos;t reuse elsewhere.</div>

          {error && <div className="alert alert-danger py-2">{error}</div>}
          {success && <div className="alert alert-success py-2">{success}</div>}

          <form onSubmit={onSubmit}>
            <div className="row g-2">
              <div className="col-md-4">
                <label className="form-label small text-uppercase text-muted">Current password</label>
                <input
                  type="password"
                  className="form-control form-control-sm"
                  value={currentPassword}
                  autoComplete="current-password"
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-uppercase text-muted">New password</label>
                <input
                  type="password"
                  className="form-control form-control-sm"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-uppercase text-muted">Confirm new password</label>
                <input
                  type="password"
                  className="form-control form-control-sm"
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <div className="col-12 text-end">
                <button type="submit" className="btn btn-dark btn-sm" disabled={saving}>
                  {saving ? "Saving..." : "Update password"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
