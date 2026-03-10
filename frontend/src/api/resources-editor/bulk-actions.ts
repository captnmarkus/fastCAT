import {
  CAT_API_BASE,
  authHeaders,
  httpError,
  type IssueSummary,
  type SegmentIssue,
  type SegmentState,
  type SegmentStatus
} from "./shared";

export type EditorBulkApproveScope = "all" | "visible" | "clean";
export type EditorBulkApproveQaPolicy = "ignore" | "require_clean";

export type EditorBulkVisibleFilters = {
  statusFilter?: "all" | "draft" | "under_review" | "reviewed";
  sourceSearch?: string;
  targetSearch?: string;
  untranslatedOnly?: boolean;
  draftOnly?: boolean;
  reviewedOnly?: boolean;
  withQaOnly?: boolean;
  lockedOnly?: boolean;
  termHitsOnly?: boolean;
  ntmDraftOnly?: boolean;
  tmxOnly?: boolean;
};

export type EditorBulkApproveEstimate = {
  total: number;
  eligible: number;
  skipped: number;
  qaFlaggedEligible: number;
  reasonsBreakdown: Record<string, number>;
  skippedSegmentIds: number[];
  problematicSegmentIds: number[];
};

export type EditorBulkApproveResponse = {
  ok: true;
  dryRun?: boolean;
  jobId?: string;
  estimated: EditorBulkApproveEstimate;
};

export type EditorBulkJobProgress = {
  total: number;
  processed: number;
  approved: number;
  skipped: number;
  percent: number;
};

export type EditorBulkJobSummary = {
  approved: number;
  skipped: number;
  qaFlaggedApproved: number;
  reasonsBreakdown: Record<string, number>;
  skippedSegmentIds: number[];
  problematicSegmentIds: number[];
};

export type EditorBulkJobStatusResponse = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  scope: EditorBulkApproveScope;
  projectId: number;
  fileId: number;
  taskId: number | null;
  progress: EditorBulkJobProgress;
  estimated: EditorBulkApproveEstimate;
  summary: EditorBulkJobSummary | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type SegmentReviewResult = {
  id: number;
  status: SegmentStatus;
  state: SegmentState;
  issueSummary: IssueSummary;
  issues: SegmentIssue[];
  isLocked?: boolean;
  version: number;
};

export async function bulkApproveProjectFileSegments(params: {
  projectId: number;
  fileId: number;
  taskId?: number | null;
  scope: EditorBulkApproveScope;
  qaPolicy?: EditorBulkApproveQaPolicy;
  dryRun?: boolean;
  filters?: EditorBulkVisibleFilters;
}): Promise<EditorBulkApproveResponse> {
  const response = await fetch(
    `${CAT_API_BASE}/projects/${encodeURIComponent(params.projectId)}/files/${encodeURIComponent(params.fileId)}/segments/bulk-approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        scope: params.scope,
        ...(params.taskId != null ? { taskId: params.taskId } : {}),
        ...(params.qaPolicy ? { qaPolicy: params.qaPolicy } : {}),
        ...(params.dryRun ? { dryRun: true } : {}),
        ...(params.filters ? { filters: params.filters } : {})
      })
    }
  );
  if (!response.ok) throw await httpError("bulk approve segments", response);
  return (await response.json()) as EditorBulkApproveResponse;
}

export async function getBulkApproveJobStatus(jobId: string): Promise<EditorBulkJobStatusResponse> {
  const response = await fetch(`${CAT_API_BASE}/bulk-jobs/${encodeURIComponent(jobId)}`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("bulk approve job status", response);
  return (await response.json()) as EditorBulkJobStatusResponse;
}

export async function acceptCleanLlmDrafts(params: {
  taskId?: number;
  fileId?: number;
  qeThreshold?: number;
}): Promise<{ ok: true; updated: number; segments: SegmentReviewResult[] }> {
  const response = await fetch(`${CAT_API_BASE}/segments/accept-clean-llm-drafts`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      ...(params.taskId != null ? { taskId: params.taskId } : {}),
      ...(params.fileId != null ? { fileId: params.fileId } : {}),
      ...(params.qeThreshold != null ? { qeThreshold: params.qeThreshold } : {})
    })
  });
  if (!response.ok) throw await httpError("accept clean drafts", response);
  return (await response.json()) as { ok: true; updated: number; segments: SegmentReviewResult[] };
}
