import type { Project } from "../../../api";
import type { ProjectCardMeta } from "../../../types/app";

export type ViewMode = "list" | "cards";
export type SortKey = "name" | "due" | "status" | "progress" | "modified";
export type SortDir = "asc" | "desc";

export type ProjectRow = {
  project: Project;
  meta: ProjectCardMeta | undefined;
  statusLabel: string;
  statusTone: ProjectCardMeta["tone"];
  progressPct: number;
  provisioningStep: string | null;
  provisioningUpdatedAt: string | null;
  isProvisioning: boolean;
  dueAt: string | null;
  lastModifiedAt: string;
  errorCount: number;
  overdueDays: number | null;
  ownerLabel: string;
};
