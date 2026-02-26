export function toneForInboxStatus(status: string) {
  const value = String(status || "").toLowerCase();
  if (value === "reviewed") return "success" as const;
  if (value === "under_review" || value === "under review") return "warning" as const;
  if (value === "error") return "danger" as const;
  return "secondary" as const;
}

export function labelForInboxStatus(status: string) {
  return String(status || "").replace(/_/g, " ").toUpperCase();
}

