import type { Project, ProjectBucketMeta, ProjectFilesResponse } from "../../../api";
import type { ProjectCardMeta } from "../../../types/app";

export function provisioningStepTone(step: string) {
  const normalized = String(step || "").trim().toLowerCase();
  if (normalized === "done") return "bg-success text-white";
  if (normalized === "failed") return "bg-danger text-white";
  if (normalized === "running") return "bg-warning text-dark";
  return "bg-light text-dark border";
}

export function formatProvisioningStep(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "Preparing...";
  return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export type ImportDialogState = {
  fileId: number;
  fileName: string;
  targetLang: string;
  targetLabel: string;
};

export type RowImportState = {
  status: "imported" | "error";
  importedAt?: string;
  message?: string;
};

export type LoadState = {
  project: Project | null;
  meta: ProjectCardMeta | null;
  progressPct: number;
  bucket: ProjectBucketMeta | null;
  files: ProjectFilesResponse["files"];
  error: string | null;
  loading: boolean;
};

export const DEFAULT_STATE: LoadState = {
  project: null,
  meta: null,
  progressPct: 0,
  bucket: null,
  files: [],
  error: null,
  loading: true
};
