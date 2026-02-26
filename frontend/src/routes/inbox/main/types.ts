import type { InboxItem } from "../../../api";

export type SortKey = "file" | "project" | "status" | "progress" | "modified";
export type SortDir = "asc" | "desc";

export type InboxRow = InboxItem & {
  statusLabel: string;
  progressPct: number;
  modifiedAt: string | null;
};
