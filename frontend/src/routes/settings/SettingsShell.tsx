import React from "react";
import { Outlet } from "react-router-dom";
import type { AuthUser } from "../../types/app";

export default function SettingsShell({ currentUser }: { currentUser: AuthUser }) {
  return (
    <div className="py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Settings</h2>
      </div>

      <Outlet context={{ currentUser }} />
    </div>
  );
}
