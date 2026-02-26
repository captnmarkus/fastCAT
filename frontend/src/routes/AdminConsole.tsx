import React from "react";
import type { AuthUser } from "../types/app";
import SettingsShell from "./settings/SettingsShell";

export default function AdminConsole({
  currentUser,
  onUserUpdated
}: {
  currentUser: AuthUser | null;
  onUserUpdated?: (user: AuthUser) => void;
}) {
  if (!currentUser) {
    return (
      <div className="text-center text-muted py-5">
        <span className="spinner-border" />
      </div>
    );
  }

  return <SettingsShell currentUser={currentUser} onUserUpdated={onUserUpdated ?? (() => undefined)} />;
}

