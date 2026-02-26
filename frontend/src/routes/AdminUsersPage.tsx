import React from "react";
import type { AuthUser } from "../types/app";
import UserManagementTab from "./settings/tabs/UserManagementTab";

export default function AdminUsersPage({ currentUser }: { currentUser: AuthUser }) {
  return (
    <div className="py-3">
      <h2 className="mb-3">User management</h2>
      <UserManagementTab currentUser={currentUser} />
    </div>
  );
}

