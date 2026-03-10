import {
  CAT_API_BASE,
  authHeaders,
  httpError,
  type IssueSummary,
  type Segment,
  type SegmentCollectionOptions,
  type SegmentIssue,
  type SegmentMutationParams,
  type SegmentSourceType,
  type SegmentStatus,
  type SegmentUpdateResponse
} from "./shared";
import {
  buildSegmentCollectionQuery,
  buildSegmentMutationBody,
  parseSegmentMutationResponse
} from "./shared";
import type { SegmentState } from "../../types/app";

export type EditorFileMeta = {
  task?: {
    id: number;
    targetLang: string;
    assigneeId?: string;
    reviewerUserId?: string | null;
    status?: string;
    tmxId?: number | null;
  };
  file: {
    id: number;
    originalFilename: string;
    createdAt: string | null;
    fileType?: string | null;
    fileTypeConfigId?: number | null;
  };
  project: {
    id: number;
    name: string;
    srcLang: string;
    tgtLang: string;
    assignedUser: string | null;
  };
  segmentStats: {
    total: number;
    draft: number;
    under_review: number;
    reviewed: number;
  };
  renderedPreview?: {
    supported: boolean;
    method: RenderedPreviewMethod | null;
    defaultOn: boolean;
    xmlXsltTemplateId?: number | null;
    xmlRendererProfileId?: string | null;
  };
  hasHtmlExport: boolean;
};

export type RenderedPreviewMethod = "pdf" | "images" | "html" | "xml_xslt" | "xml_raw_pretty";
export type RenderedPreviewStatus = "idle" | "disabled" | "queued" | "running" | "ready" | "error";

export type RenderedPreviewStatusResponse = {
  previewId: string | null;
  status: RenderedPreviewStatus | string;
  draftRevisionId: string | null;
  previewMethod: string | null;
  cached?: boolean;
  warnings?: string[];
  logs?: string[];
  error?: string | null;
};

export type RenderedPreviewDetailsResponse = {
  previewId: string;
  status: "ready" | "queued" | "running" | "error" | string;
  signedUrl?: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  methodRequested?: string | null;
  methodUsed?: string | null;
  kind?: "pdf" | "images" | "html" | "xml" | string | null;
  draftRevisionId?: string | null;
  warnings?: string[];
  logs?: string[];
  error?: string | null;
  details?: string | null;
};

export async function getFile(fileId: number, opts?: { signal?: AbortSignal }): Promise<EditorFileMeta> {
  const response = await fetch(`${CAT_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!response.ok) throw await httpError("get file", response);
  return (await response.json()) as EditorFileMeta;
}

export async function getTask(taskId: number, opts?: { signal?: AbortSignal }): Promise<EditorFileMeta> {
  const response = await fetch(`${CAT_API_BASE}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!response.ok) throw await httpError("get task", response);
  return (await response.json()) as EditorFileMeta;
}

export async function requestRenderedPreview(params: {
  projectId: number;
  fileId: number;
  taskId?: number | null;
  targetLang?: string | null;
  draftRevisionId?: string | null;
  previewMethod?: RenderedPreviewMethod | null;
}): Promise<RenderedPreviewStatusResponse> {
  const body: Record<string, any> = {};
  if (params.taskId != null && Number.isFinite(Number(params.taskId))) {
    body.taskId = Number(params.taskId);
  }
  if (params.targetLang != null && String(params.targetLang).trim()) {
    body.targetLang = String(params.targetLang).trim();
  }
  if (params.draftRevisionId != null && String(params.draftRevisionId).trim()) {
    body.draftRevisionId = String(params.draftRevisionId).trim();
  }
  if (params.previewMethod) body.previewMethod = params.previewMethod;

  const response = await fetch(
    `${CAT_API_BASE}/projects/${encodeURIComponent(params.projectId)}/files/${encodeURIComponent(params.fileId)}/rendered-preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) throw await httpError("request rendered preview", response);
  return (await response.json()) as RenderedPreviewStatusResponse;
}

export async function getRenderedPreviewStatus(params: {
  projectId: number;
  fileId: number;
  taskId?: number | null;
  targetLang?: string | null;
  draftRevisionId?: string | null;
  previewMethod?: RenderedPreviewMethod | null;
  signal?: AbortSignal;
}): Promise<RenderedPreviewStatusResponse> {
  const query = new URLSearchParams();
  if (params.taskId != null && Number.isFinite(Number(params.taskId))) {
    query.set("taskId", String(params.taskId));
  }
  if (params.targetLang != null && String(params.targetLang).trim()) {
    query.set("targetLang", String(params.targetLang).trim());
  }
  if (params.draftRevisionId != null && String(params.draftRevisionId).trim()) {
    query.set("draftRevisionId", String(params.draftRevisionId).trim());
  }
  if (params.previewMethod) query.set("previewMethod", params.previewMethod);
  const queryString = query.toString();

  const response = await fetch(
    `${CAT_API_BASE}/projects/${encodeURIComponent(params.projectId)}/files/${encodeURIComponent(params.fileId)}/rendered-preview/status${queryString ? `?${queryString}` : ""}`,
    { headers: { ...authHeaders() }, signal: params.signal }
  );
  if (!response.ok) throw await httpError("rendered preview status", response);
  return (await response.json()) as RenderedPreviewStatusResponse;
}

export async function getRenderedPreviewDetails(
  previewId: string | number,
  opts?: { signal?: AbortSignal }
): Promise<RenderedPreviewDetailsResponse> {
  const response = await fetch(`${CAT_API_BASE}/rendered-preview/${encodeURIComponent(previewId)}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!response.ok) throw await httpError("rendered preview", response);
  return (await response.json()) as RenderedPreviewDetailsResponse;
}

type SegmentCollectionResponse = {
  segments: Segment[];
  total: number;
  nextCursor: number | null;
};

async function getSegmentCollection(
  owner: "files" | "tasks",
  ownerId: number,
  opts?: SegmentCollectionOptions
): Promise<SegmentCollectionResponse> {
  const query = buildSegmentCollectionQuery(opts);
  const response = await fetch(
    `${CAT_API_BASE}/${owner}/${encodeURIComponent(ownerId)}/segments${query ? `?${query}` : ""}`,
    {
      headers: { ...authHeaders() },
      signal: opts?.signal
    }
  );
  if (!response.ok) throw await httpError(owner === "files" ? "file segments" : "task segments", response);
  return (await response.json()) as SegmentCollectionResponse;
}

export async function getFileSegments(fileId: number, opts?: SegmentCollectionOptions): Promise<SegmentCollectionResponse> {
  return getSegmentCollection("files", fileId, opts);
}

export async function getTaskSegments(taskId: number, opts?: SegmentCollectionOptions): Promise<SegmentCollectionResponse> {
  return getSegmentCollection("tasks", taskId, opts);
}

type PatchSegmentParams = SegmentMutationParams & {
  segmentId: number;
  state?: SegmentState;
  sourceType?: SegmentSourceType;
};

export async function patchFileSegment(
  params: PatchSegmentParams & { fileId: number }
): Promise<SegmentUpdateResponse> {
  const response = await fetch(
    `${CAT_API_BASE}/files/${encodeURIComponent(params.fileId)}/segments/${encodeURIComponent(params.segmentId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(buildSegmentMutationBody(params))
    }
  );
  return parseSegmentMutationResponse(response);
}

export async function patchTaskSegment(
  params: PatchSegmentParams & { taskId: number }
): Promise<SegmentUpdateResponse> {
  const response = await fetch(
    `${CAT_API_BASE}/tasks/${encodeURIComponent(params.taskId)}/segments/${encodeURIComponent(params.segmentId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(buildSegmentMutationBody(params))
    }
  );
  return parseSegmentMutationResponse(response);
}

export type SegmentHistoryEntry = {
  id: number;
  oldTgt: string;
  newTgt: string;
  updatedBy: string | null;
  createdAt: string;
};

export async function getSegmentHistory(
  segmentId: number,
  opts?: { limit?: number; signal?: AbortSignal }
): Promise<{ segmentId: number; segmentNo: number; entries: SegmentHistoryEntry[] }> {
  const params = new URLSearchParams();
  if (opts?.limit != null && Number.isFinite(Number(opts.limit))) {
    params.set("limit", String(opts.limit));
  }
  const query = params.toString();
  const response = await fetch(
    `${CAT_API_BASE}/segments/${encodeURIComponent(segmentId)}/history${query ? `?${query}` : ""}`,
    { headers: { ...authHeaders() }, signal: opts?.signal }
  );
  if (!response.ok) throw await httpError("segment history", response);
  return (await response.json()) as { segmentId: number; segmentNo: number; entries: SegmentHistoryEntry[] };
}

type SegmentIssueMutationResult = {
  id: number;
  status: SegmentStatus;
  state: SegmentState;
  issueSummary: IssueSummary;
  issues: SegmentIssue[];
  isLocked?: boolean;
  version?: number;
};

export async function recomputeSegmentIssues(params: {
  segmentIds?: number[];
  taskId?: number;
  fileId?: number;
}): Promise<{ ok: true; updated: number; segments: SegmentIssueMutationResult[] }> {
  const response = await fetch(`${CAT_API_BASE}/segments/recompute-issues`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      ...(params.segmentIds ? { segmentIds: params.segmentIds } : {}),
      ...(params.taskId != null ? { taskId: params.taskId } : {}),
      ...(params.fileId != null ? { fileId: params.fileId } : {})
    })
  });
  if (!response.ok) throw await httpError("recompute issues", response);
  return (await response.json()) as { ok: true; updated: number; segments: SegmentIssueMutationResult[] };
}

export async function markSegmentsReviewed(params: {
  segmentIds: number[];
  forceReviewed?: boolean;
}): Promise<{
  ok: true;
  updated: number;
  skipped?: number;
  segments: SegmentIssueMutationResult[];
  skippedIds?: number[];
}> {
  const response = await fetch(`${CAT_API_BASE}/segments/mark-reviewed`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      segmentIds: params.segmentIds,
      ...(params.forceReviewed ? { forceReviewed: true } : {})
    })
  });
  if (!response.ok) throw await httpError("mark reviewed", response);
  return (await response.json()) as {
    ok: true;
    updated: number;
    skipped?: number;
    segments: SegmentIssueMutationResult[];
    skippedIds?: number[];
  };
}
