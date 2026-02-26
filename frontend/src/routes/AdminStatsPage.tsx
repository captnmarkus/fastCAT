import React from "react";
import type { AuthUser } from "../types/app";
import StatsTab from "./settings/tabs/StatsTab";

export default function AdminStatsPage({ currentUser }: { currentUser: AuthUser }) {
  return (
    <div className="py-3">
      <h2 className="mb-3">Stats</h2>
      <StatsTab currentUser={currentUser} />
    </div>
  );
}

