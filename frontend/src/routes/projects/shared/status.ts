import type { ProjectCardMeta } from "../../../types/app";

export function deriveProjectCardMeta(
  analytics: any,
  opts?: { projectStatus?: string | null }
): ProjectCardMeta {
  const statuses = Array.isArray(analytics?.statuses) ? analytics.statuses : [];
  const projectStatus = String(opts?.projectStatus || "").trim().toLowerCase();

  const total = statuses.reduce(
    (sum: number, entry: { count?: number }) => sum + Number(entry?.count ?? 0),
    0
  );

  const reviewedCount = statuses
    .filter((entry: { status?: string }) => {
      const val = String(entry?.status || "").toLowerCase();
      return val === "reviewed" || val === "approved";
    })
    .reduce((sum: number, entry: { count?: number }) => sum + Number(entry?.count ?? 0), 0);

  const pending = Math.max(0, total - reviewedCount);
  const inProgressCount = statuses
    .filter((entry: { status?: string }) => {
      const val = String(entry?.status || "").toLowerCase();
      return val === "under_review" || val === "reviewed" || val === "approved";
    })
    .reduce((sum: number, entry: { count?: number }) => sum + Number(entry?.count ?? 0), 0);

  if (projectStatus === "provisioning") {
    return { label: "PROVISIONING", tone: "warning", pending: total, total };
  }
  if (projectStatus === "failed") {
    return { label: "FAILED", tone: "danger", pending: total, total };
  }
  if (projectStatus === "draft") {
    return { label: "DRAFT", tone: "secondary", pending: total, total };
  }
  if (projectStatus === "canceled") {
    return { label: "CANCELED", tone: "secondary", pending: total, total };
  }

  if (total === 0) {
    return { label: "ANALYZING", tone: "secondary", pending: 0, total: 0 };
  }

  if (pending === 0) {
    return { label: "DONE", tone: "success", pending, total };
  }

  if (inProgressCount > 0) {
    return { label: "IN PROGRESS", tone: "warning", pending, total };
  }

  return { label: "READY", tone: "secondary", pending, total };
}

export function statusToneClass(tone: ProjectCardMeta["tone"]) {
  if (tone === "success") return "is-success";
  if (tone === "danger") return "is-danger";
  if (tone === "warning") return "is-warning";
  return "is-ready";
}
