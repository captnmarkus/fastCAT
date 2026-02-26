import {
  CAT_API_BASE,
  LLM_API_BASE,
  authHeaders,
  httpError,
  type ParsingTemplate,
  type ParsingTemplateConfig,
  type ParsingTemplateKind
} from "./core";

export async function listParsingTemplates(opts?: { kind?: ParsingTemplateKind }): Promise<ParsingTemplate[]> {
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", String(opts.kind));
  const r = await fetch(`${CAT_API_BASE}/parsing-templates${params.toString() ? `?${params.toString()}` : ""}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("list parsing templates", r);
  const data = await r.json();
  return data.templates || [];
}

export async function createParsingTemplate(payload: {
  name: string;
  description?: string;
  kind?: ParsingTemplateKind;
  config: ParsingTemplateConfig;
  sourceUploadId?: number;
}): Promise<ParsingTemplate> {
  const r = await fetch(`${CAT_API_BASE}/parsing-templates`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await httpError("create parsing template", r);
  const data = await r.json();
  return data.template as ParsingTemplate;
}

export async function updateParsingTemplate(
  id: number,
  payload: { name?: string; description?: string; config?: ParsingTemplateConfig; sourceUploadId?: number }
): Promise<ParsingTemplate> {
  const r = await fetch(`${CAT_API_BASE}/parsing-templates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await httpError("update parsing template", r);
  const data = await r.json();
  return data.template as ParsingTemplate;
}

export async function deleteParsingTemplate(id: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/parsing-templates/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete parsing template", r);
}

export async function downloadParsingTemplateJson(id: number): Promise<Blob> {
  const r = await fetch(`${CAT_API_BASE}/parsing-templates/${encodeURIComponent(id)}/download`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("download parsing template", r);
  return await r.blob();
}

export async function uploadParsingTemplateJson(file: File, opts?: { kind?: ParsingTemplateKind }): Promise<{
  uploadId: number;
  kind: ParsingTemplateKind;
  template: { kind: ParsingTemplateKind; name: string; description: string; config: ParsingTemplateConfig };
}> {
  const fd = new FormData();
  fd.append("file", file);
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", String(opts.kind));
  const r = await fetch(`${CAT_API_BASE}/parsing-templates/uploads${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd
  });
  if (!r.ok) throw await httpError("upload parsing template json", r);
  const data = await r.json();
  return {
    uploadId: Number(data?.upload?.id),
    kind: (String(data?.upload?.kind || "html").toLowerCase() === "xml" ? "xml" : "html") as ParsingTemplateKind,
    template: {
      kind: (String(data?.template?.kind || "html").toLowerCase() === "xml" ? "xml" : "html") as ParsingTemplateKind,
      name: String(data?.template?.name ?? ""),
      description: String(data?.template?.description ?? ""),
      config: data?.template?.config as ParsingTemplateConfig
    }
  };
}

export async function deleteParsingTemplateUpload(uploadId: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/parsing-templates/uploads/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete parsing template upload", r);
}

export async function getProjectSegments(
  projectId: number,
  opts?: { pageSize?: number; fileId?: number; taskId?: number }
): Promise<{ segments: Segment[]; total: number }> {
  const limit = Math.min(Math.max(opts?.pageSize ?? 250, 25), 500);
  let page = 1;
  let total = 0;
  const segments: Segment[] = [];
  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });
    if (opts?.fileId != null && Number.isFinite(Number(opts.fileId))) {
      params.set("fileId", String(opts.fileId));
    }
    if (opts?.taskId != null && Number.isFinite(Number(opts.taskId))) {
      params.set("taskId", String(opts.taskId));
    }
    const r = await fetch(
      `${CAT_API_BASE}/projects/${projectId}/segments?${params.toString()}`,
      {
        headers: { ...authHeaders() }
      }
    );
    const data = await r.json();
    if (!r.ok) {
      throw new Error(data?.error || `segments ${r.status}`);
    }
    total = Number(data.total ?? total ?? 0);
    const batch: Segment[] = data.segments || [];
    segments.push(...batch);
    if (segments.length >= total || batch.length < limit) {
      break;
    }
    page++;
  }
  return { segments, total: total || segments.length };
}

export async function updateSegment(params: {
  id: number;
  tgt: string;
  tgtRuns?: any[];
  status?: string;
  state?: import("./types/app").SegmentState;
  version: number;
  generatedByLlm?: boolean;
  qeScore?: number | null;
  forceReviewed?: boolean;
  markReviewed?: boolean;
  sourceType?: SegmentSourceType;
  sourceScore?: number | null;
  sourceMatchId?: string | null;
  originDetails?: Record<string, unknown> | null;
}): Promise<SegmentUpdateResponse> {
  const r = await fetch(`${CAT_API_BASE}/segments/${params.id}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({
      tgt: params.tgt,
      ...(params.tgtRuns !== undefined ? { tgtRuns: params.tgtRuns } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.state !== undefined ? { state: params.state } : {}),
      version: params.version,
      ...(params.generatedByLlm !== undefined ? { generatedByLlm: params.generatedByLlm } : {}),
      ...(params.qeScore !== undefined ? { qeScore: params.qeScore } : {}),
      ...(params.forceReviewed ? { forceReviewed: true } : {}),
      ...(params.markReviewed ? { markReviewed: true } : {}),
      ...(params.sourceType !== undefined ? { sourceType: params.sourceType } : {}),
      ...(params.sourceScore !== undefined ? { sourceScore: params.sourceScore } : {}),
      ...(params.sourceMatchId !== undefined ? { sourceMatchId: params.sourceMatchId } : {}),
      ...(params.originDetails !== undefined ? { originDetails: params.originDetails } : {})
    })
  });
  const payload = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(
      payload?.error || `update segment ${r.status}`
    ) as Error & { code?: string; currentVersion?: number };
    if (payload?.code) error.code = payload.code;
    if (payload?.currentVersion != null) {
      error.currentVersion = payload.currentVersion;
    }
    throw error;
  }
  return payload as SegmentUpdateResponse;
}

export async function exportProjectXliff(
  projectId: number,
  opts?: { fileId?: number; taskId?: number }
): Promise<Blob> {
  const params = new URLSearchParams();
  if (opts?.fileId != null) params.set("fileId", String(opts.fileId));
  if (opts?.taskId != null) params.set("taskId", String(opts.taskId));
  const qs = params.toString();
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/export-xliff${qs ? `?${qs}` : ""}`,
    {
      headers: { ...authHeaders() }
    }
  );
  if (!r.ok) throw new Error(`export xliff ${r.status}`);
  return await r.blob();
}

export async function exportProjectHtml(
  projectId: number,
  opts?: { fileId?: number; taskId?: number }
): Promise<Blob> {
  const params = new URLSearchParams();
  if (opts?.fileId != null) params.set("fileId", String(opts.fileId));
  if (opts?.taskId != null) params.set("taskId", String(opts.taskId));
  const qs = params.toString();
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/export-html${qs ? `?${qs}` : ""}`,
    {
      headers: { ...authHeaders() }
    }
  );
  if (!r.ok) throw new Error(`export html ${r.status}`);
  return await r.blob();
}

export async function exportProjectTargetFile(
  projectId: number,
  opts?: { fileId?: number; taskId?: number; lang?: string; targetLang?: string }
): Promise<Blob> {
  const params = new URLSearchParams();
  if (opts?.fileId != null) params.set("fileId", String(opts.fileId));
  if (opts?.taskId != null) params.set("taskId", String(opts.taskId));
  const lang = opts?.targetLang ?? opts?.lang;
  if (lang) params.set("lang", String(lang));
  const qs = params.toString();
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/export-target${qs ? `?${qs}` : ""}`,
    { headers: { ...authHeaders() } }
  );
  if (!r.ok) throw await httpError("export target file", r);
  return await r.blob();
}

export async function getProjectBucket(projectId: number): Promise<ProjectBucketMeta> {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}/bucket`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("project bucket", r);
  return (await r.json()) as ProjectBucketMeta;
}

export async function listProjectFiles(projectId: number): Promise<ProjectFilesResponse> {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}/files`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("project files", r);
  return (await r.json()) as ProjectFilesResponse;
}

export async function listInboxItems(): Promise<InboxItem[]> {
  const r = await fetch(`${CAT_API_BASE}/inbox`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("inbox", r);
  const data = (await r.json()) as any;
  return (data?.items || []) as InboxItem[];
}

export type EditorFileMeta = {
  task?: {
    id: number;
    targetLang: string;
    assigneeId?: string;
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
  const r = await fetch(`${CAT_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!r.ok) throw await httpError("get file", r);
  return (await r.json()) as EditorFileMeta;
}

export async function getTask(taskId: number, opts?: { signal?: AbortSignal }): Promise<EditorFileMeta> {
  const r = await fetch(`${CAT_API_BASE}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!r.ok) throw await httpError("get task", r);
  return (await r.json()) as EditorFileMeta;
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

  const r = await fetch(
    `${CAT_API_BASE}/projects/${encodeURIComponent(params.projectId)}/files/${encodeURIComponent(params.fileId)}/rendered-preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body)
    }
  );
  if (!r.ok) throw await httpError("request rendered preview", r);
  return (await r.json()) as RenderedPreviewStatusResponse;
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
  const qs = query.toString();

  const r = await fetch(
    `${CAT_API_BASE}/projects/${encodeURIComponent(params.projectId)}/files/${encodeURIComponent(params.fileId)}/rendered-preview/status${qs ? `?${qs}` : ""}`,
    { headers: { ...authHeaders() }, signal: params.signal }
  );
  if (!r.ok) throw await httpError("rendered preview status", r);
  return (await r.json()) as RenderedPreviewStatusResponse;
}

export async function getRenderedPreviewDetails(
  previewId: string | number,
  opts?: { signal?: AbortSignal }
): Promise<RenderedPreviewDetailsResponse> {
  const r = await fetch(`${CAT_API_BASE}/rendered-preview/${encodeURIComponent(previewId)}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!r.ok) throw await httpError("rendered preview", r);
  return (await r.json()) as RenderedPreviewDetailsResponse;
}

export async function getFileSegments(
  fileId: number,
  opts?: {
    cursor?: number | null;
    limit?: number;
    signal?: AbortSignal;
    state?: string | string[];
    hasIssues?: boolean;
    severity?: "error" | "warning";
    search?: string;
  }
): Promise<{ segments: Segment[]; total: number; nextCursor: number | null }> {
  const params = new URLSearchParams();
  if (opts?.cursor != null && Number.isFinite(Number(opts.cursor))) {
    params.set("cursor", String(opts.cursor));
  }
  if (opts?.limit != null && Number.isFinite(Number(opts.limit))) {
    params.set("limit", String(opts.limit));
  }
  if (opts?.state) {
    const value = Array.isArray(opts.state) ? opts.state.join(",") : String(opts.state);
    if (value) params.set("state", value);
  }
  if (opts?.hasIssues != null) params.set("hasIssues", opts.hasIssues ? "true" : "false");
  if (opts?.severity) params.set("severity", opts.severity);
  if (opts?.search) params.set("search", opts.search);
  const qs = params.toString();
  const r = await fetch(`${CAT_API_BASE}/files/${encodeURIComponent(fileId)}/segments${qs ? `?${qs}` : ""}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!r.ok) throw await httpError("file segments", r);
  return (await r.json()) as { segments: Segment[]; total: number; nextCursor: number | null };
}

export async function getTaskSegments(
  taskId: number,
  opts?: {
    cursor?: number | null;
    limit?: number;
    signal?: AbortSignal;
    state?: string | string[];
    hasIssues?: boolean;
    severity?: "error" | "warning";
    search?: string;
  }
): Promise<{ segments: Segment[]; total: number; nextCursor: number | null }> {
  const params = new URLSearchParams();
  if (opts?.cursor != null && Number.isFinite(Number(opts.cursor))) {
    params.set("cursor", String(opts.cursor));
  }
  if (opts?.limit != null && Number.isFinite(Number(opts.limit))) {
    params.set("limit", String(opts.limit));
  }
  if (opts?.state) {
    const value = Array.isArray(opts.state) ? opts.state.join(",") : String(opts.state);
    if (value) params.set("state", value);
  }
  if (opts?.hasIssues != null) params.set("hasIssues", opts.hasIssues ? "true" : "false");
  if (opts?.severity) params.set("severity", opts.severity);
  if (opts?.search) params.set("search", opts.search);
  const qs = params.toString();
  const r = await fetch(`${CAT_API_BASE}/tasks/${encodeURIComponent(taskId)}/segments${qs ? `?${qs}` : ""}`, {
    headers: { ...authHeaders() },
    signal: opts?.signal
  });
  if (!r.ok) throw await httpError("task segments", r);
  return (await r.json()) as { segments: Segment[]; total: number; nextCursor: number | null };
}

export async function patchFileSegment(params: {
  fileId: number;
  segmentId: number;
  tgt: string;
  tgtRuns?: any[];
  status?: string;
  state?: import("./types/app").SegmentState;
  isLocked?: boolean;
  version: number;
  generatedByLlm?: boolean;
  qeScore?: number | null;
  forceReviewed?: boolean;
  markReviewed?: boolean;
  sourceType?: SegmentSourceType;
  sourceScore?: number | null;
  sourceMatchId?: string | null;
  originDetails?: Record<string, unknown> | null;
}): Promise<SegmentUpdateResponse> {
  const r = await fetch(
    `${CAT_API_BASE}/files/${encodeURIComponent(params.fileId)}/segments/${encodeURIComponent(params.segmentId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({
        tgt: params.tgt,
        ...(params.tgtRuns !== undefined ? { tgtRuns: params.tgtRuns } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.state !== undefined ? { state: params.state } : {}),
        ...(params.isLocked !== undefined ? { isLocked: params.isLocked } : {}),
        version: params.version,
        ...(params.generatedByLlm !== undefined ? { generatedByLlm: params.generatedByLlm } : {}),
        ...(params.qeScore !== undefined ? { qeScore: params.qeScore } : {}),
        ...(params.forceReviewed ? { forceReviewed: true } : {}),
        ...(params.markReviewed ? { markReviewed: true } : {}),
        ...(params.sourceType !== undefined ? { sourceType: params.sourceType } : {}),
        ...(params.sourceScore !== undefined ? { sourceScore: params.sourceScore } : {}),
        ...(params.sourceMatchId !== undefined ? { sourceMatchId: params.sourceMatchId } : {}),
        ...(params.originDetails !== undefined ? { originDetails: params.originDetails } : {})
      })
    }
  );
  const payload = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(
      payload?.error || `update segment ${r.status}`
    ) as Error & { code?: string; currentVersion?: number };
    if (payload?.code) error.code = payload.code;
    if (payload?.currentVersion != null) {
      error.currentVersion = payload.currentVersion;
    }
    throw error;
  }
  return payload as SegmentUpdateResponse;
}

export async function patchTaskSegment(params: {
  taskId: number;
  segmentId: number;
  tgt: string;
  tgtRuns?: any[];
  status?: string;
  state?: import("./types/app").SegmentState;
  isLocked?: boolean;
  version: number;
  generatedByLlm?: boolean;
  qeScore?: number | null;
  forceReviewed?: boolean;
  markReviewed?: boolean;
  sourceType?: SegmentSourceType;
  sourceScore?: number | null;
  sourceMatchId?: string | null;
  originDetails?: Record<string, unknown> | null;
}): Promise<SegmentUpdateResponse> {
  const r = await fetch(
    `${CAT_API_BASE}/tasks/${encodeURIComponent(params.taskId)}/segments/${encodeURIComponent(params.segmentId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({
        tgt: params.tgt,
        ...(params.tgtRuns !== undefined ? { tgtRuns: params.tgtRuns } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.state !== undefined ? { state: params.state } : {}),
        ...(params.isLocked !== undefined ? { isLocked: params.isLocked } : {}),
        version: params.version,
        ...(params.generatedByLlm !== undefined ? { generatedByLlm: params.generatedByLlm } : {}),
        ...(params.qeScore !== undefined ? { qeScore: params.qeScore } : {}),
        ...(params.forceReviewed ? { forceReviewed: true } : {}),
        ...(params.markReviewed ? { markReviewed: true } : {}),
        ...(params.sourceType !== undefined ? { sourceType: params.sourceType } : {}),
        ...(params.sourceScore !== undefined ? { sourceScore: params.sourceScore } : {}),
        ...(params.sourceMatchId !== undefined ? { sourceMatchId: params.sourceMatchId } : {}),
        ...(params.originDetails !== undefined ? { originDetails: params.originDetails } : {})
      })
    }
  );
  const payload = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(
      payload?.error || `update segment ${r.status}`
    ) as Error & { code?: string; currentVersion?: number };
    if (payload?.code) error.code = payload.code;
    if (payload?.currentVersion != null) {
      error.currentVersion = payload.currentVersion;
    }
    throw error;
  }
  return payload as SegmentUpdateResponse;
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
  const qs = params.toString();
  const r = await fetch(
    `${CAT_API_BASE}/segments/${encodeURIComponent(segmentId)}/history${qs ? `?${qs}` : ""}`,
    {
      headers: { ...authHeaders() },
      signal: opts?.signal
    }
  );
  if (!r.ok) throw await httpError("segment history", r);
  return (await r.json()) as { segmentId: number; segmentNo: number; entries: SegmentHistoryEntry[] };
}

export async function recomputeSegmentIssues(params: {
  segmentIds?: number[];
  taskId?: number;
  fileId?: number;
}): Promise<{
  ok: true;
  updated: number;
  segments: Array<{
    id: number;
    status: import("./types/app").SegmentStatus;
    state: import("./types/app").SegmentState;
    issueSummary: IssueSummary;
    issues: SegmentIssue[];
  }>;
}> {
  const r = await fetch(`${CAT_API_BASE}/segments/recompute-issues`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      ...(params.segmentIds ? { segmentIds: params.segmentIds } : {}),
      ...(params.taskId != null ? { taskId: params.taskId } : {}),
      ...(params.fileId != null ? { fileId: params.fileId } : {})
    })
  });
  if (!r.ok) throw await httpError("recompute issues", r);
  return (await r.json()) as {
    ok: true;
    updated: number;
    segments: Array<{
      id: number;
      status: import("./types/app").SegmentStatus;
      state: import("./types/app").SegmentState;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
    }>;
  };
}

export async function markSegmentsReviewed(params: {
  segmentIds: number[];
  forceReviewed?: boolean;
}): Promise<{
  ok: true;
  updated: number;
  skipped?: number;
  segments: Array<{
    id: number;
    status: import("./types/app").SegmentStatus;
    state: import("./types/app").SegmentState;
    isLocked?: boolean;
    issueSummary: IssueSummary;
    issues: SegmentIssue[];
    version: number;
  }>;
  skippedIds?: number[];
}> {
  const r = await fetch(`${CAT_API_BASE}/segments/mark-reviewed`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      segmentIds: params.segmentIds,
      ...(params.forceReviewed ? { forceReviewed: true } : {})
    })
  });
  if (!r.ok) throw await httpError("mark reviewed", r);
  return (await r.json()) as {
    ok: true;
    updated: number;
    skipped?: number;
    segments: Array<{
      id: number;
      status: import("./types/app").SegmentStatus;
      state: import("./types/app").SegmentState;
      isLocked?: boolean;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
      version: number;
    }>;
    skippedIds?: number[];
  };
}

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

export async function bulkApproveProjectFileSegments(params: {
  projectId: number;
  fileId: number;
  taskId?: number | null;
  scope: EditorBulkApproveScope;
  qaPolicy?: EditorBulkApproveQaPolicy;
  dryRun?: boolean;
  filters?: EditorBulkVisibleFilters;
}): Promise<EditorBulkApproveResponse> {
  const r = await fetch(
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
  if (!r.ok) throw await httpError("bulk approve segments", r);
  return (await r.json()) as EditorBulkApproveResponse;
}

export async function getBulkApproveJobStatus(jobId: string): Promise<EditorBulkJobStatusResponse> {
  const r = await fetch(`${CAT_API_BASE}/bulk-jobs/${encodeURIComponent(jobId)}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("bulk approve job status", r);
  return (await r.json()) as EditorBulkJobStatusResponse;
}

export async function acceptCleanLlmDrafts(params: {
  taskId?: number;
  fileId?: number;
  qeThreshold?: number;
}): Promise<{
  ok: true;
  updated: number;
  segments: Array<{
    id: number;
    status: import("./types/app").SegmentStatus;
    state: import("./types/app").SegmentState;
    isLocked?: boolean;
    issueSummary: IssueSummary;
    issues: SegmentIssue[];
    version: number;
  }>;
}> {
  const r = await fetch(`${CAT_API_BASE}/segments/accept-clean-llm-drafts`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      ...(params.taskId != null ? { taskId: params.taskId } : {}),
      ...(params.fileId != null ? { fileId: params.fileId } : {}),
      ...(params.qeThreshold != null ? { qeThreshold: params.qeThreshold } : {})
    })
  });
  if (!r.ok) throw await httpError("accept clean drafts", r);
  return (await r.json()) as {
    ok: true;
    updated: number;
    segments: Array<{
      id: number;
      status: import("./types/app").SegmentStatus;
      state: import("./types/app").SegmentState;
      isLocked?: boolean;
      issueSummary: IssueSummary;
      issues: SegmentIssue[];
      version: number;
    }>;
  };
}

export async function completeFile(fileId: number, mode: "under_review" | "reviewed"): Promise<any> {
  const r = await fetch(`${CAT_API_BASE}/files/${encodeURIComponent(fileId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ mode })
  });
  if (!r.ok) throw await httpError("complete file", r);
  return r.json();
}

export async function completeTask(taskId: number, mode: "under_review" | "reviewed"): Promise<any> {
  const r = await fetch(`${CAT_API_BASE}/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ mode })
  });
  if (!r.ok) throw await httpError("complete task", r);
  return r.json();
}

export async function downloadProjectBucketSourceFile(
  projectId: number,
  fileId: number,
  filename: string
): Promise<Blob> {
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/bucket/file/${encodeURIComponent(fileId)}/source/${encodeURIComponent(filename)}`,
    { headers: { ...authHeaders() } }
  );
  if (!r.ok) throw await httpError("download project source", r);
  return await r.blob();
}

export async function downloadProjectBucketOutputFile(
  projectId: number,
  fileId: number,
  lang: string,
  filename: string
): Promise<Blob> {
  return exportProjectTargetFile(projectId, { fileId, lang });
}

export async function requestLLMCompletion(params: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}) {
  const payload: Record<string, any> = {
    messages: params.messages,
    temperature: params.temperature ?? 0.3,
    max_tokens: params.max_tokens
  };
  if (params.model) payload.model = params.model;

  const r = await fetch(`${LLM_API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`llm gateway ${r.status}`);
  return r.json();
}

export async function requestSegmentLLM(params: {
  segmentId: number;
  messages?: ChatMessage[];
  model?: string;
  provider?: string;
  signal?: AbortSignal;
}) {
  const r = await fetch(
    `${CAT_API_BASE}/segments/${params.segmentId}/llm`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        messages: params.messages,
        model: params.model,
        provider: params.provider
      }),
      signal: params.signal
    }
  );
  if (!r.ok) throw new Error(`llm proxy ${r.status}`);
  return r.json();
}

export async function fetchProjectGlossary(
  projectId: number
): Promise<GlobalGlossaryEntry[]> {
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/glossary`,
    { headers: { ...authHeaders() } }
  );
  if (!r.ok) throw new Error(`glossary ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) return data as GlobalGlossaryEntry[];
  return data.entries || [];
}

export type ProjectTermbaseEntriesResponse = {
  entries: TermbaseMatchEntry[];
  termbaseId: number | null;
};

export async function fetchProjectTermbaseEntries(params: {
  projectId: number;
  taskId?: number;
}): Promise<ProjectTermbaseEntriesResponse> {
  const qs = new URLSearchParams();
  if (params.taskId != null && Number.isFinite(Number(params.taskId))) {
    qs.set("taskId", String(params.taskId));
  }
  const r = await fetch(
    `${CAT_API_BASE}/projects/${params.projectId}/termbase/entries${qs.toString() ? `?${qs}` : ""}`,
    { headers: { ...authHeaders() } }
  );
  if (!r.ok) throw await httpError("termbase entries", r);
  const data = await r.json();
  if (Array.isArray(data)) {
    return { entries: data as TermbaseMatchEntry[], termbaseId: null };
  }
  return {
    entries: data.entries || [],
    termbaseId: data.termbaseId ?? data.glossaryId ?? null
  };
}

export async function fetchTermbaseConcordance(params: {
  termbaseId: number;
  q: string;
  sourceLang: string;
  targetLang: string;
  mode?: "auto" | "search";
  limit?: number;
  searchSource?: boolean;
  searchTarget?: boolean;
  includeDeprecated?: boolean;
  includeForbidden?: boolean;
  category?: string;
  signal?: AbortSignal;
}): Promise<TermbaseConcordanceEntry[]> {
  const qs = new URLSearchParams();
  if (params.q.trim()) qs.set("q", params.q.trim());
  if (params.sourceLang) qs.set("sourceLang", params.sourceLang);
  if (params.targetLang) qs.set("targetLang", params.targetLang);
  if (params.mode) qs.set("mode", params.mode);
  if (params.limit != null && Number.isFinite(Number(params.limit))) {
    qs.set("limit", String(params.limit));
  }
  if (params.searchSource != null) qs.set("searchSource", params.searchSource ? "true" : "false");
  if (params.searchTarget != null) qs.set("searchTarget", params.searchTarget ? "true" : "false");
  if (params.includeDeprecated != null) {
    qs.set("includeDeprecated", params.includeDeprecated ? "true" : "false");
  }
  if (params.includeForbidden != null) {
    qs.set("includeForbidden", params.includeForbidden ? "true" : "false");
  }
  if (params.category) qs.set("category", params.category);

  const r = await fetch(
    `${CAT_API_BASE}/termbases/${params.termbaseId}/concordance${qs.toString() ? `?${qs}` : ""}`,
    { headers: { ...authHeaders() }, signal: params.signal }
  );
  if (!r.ok) throw await httpError("termbase concordance", r);
  const data = await r.json();
  return data.entries || [];
}

export type TermbaseLookupFilters = {
  includeDeprecated?: boolean;
  includeForbidden?: boolean;
  category?: string;
  searchSource?: boolean;
  searchTarget?: boolean;
  limit?: number;
  signal?: AbortSignal;
};

export async function getTermbaseSuggestions(params: {
  termbaseId: number;
  segmentId?: number;
  sourceText: string;
  srcLang: string;
  tgtLang: string;
  filters?: TermbaseLookupFilters;
}): Promise<TermbaseConcordanceEntry[]> {
  return fetchTermbaseConcordance({
    termbaseId: params.termbaseId,
    q: params.sourceText,
    sourceLang: params.srcLang,
    targetLang: params.tgtLang,
    mode: "auto",
    limit: params.filters?.limit ?? 12,
    searchSource: params.filters?.searchSource ?? true,
    searchTarget: params.filters?.searchTarget ?? false,
    includeDeprecated: params.filters?.includeDeprecated,
    includeForbidden: params.filters?.includeForbidden,
    category: params.filters?.category,
    signal: params.filters?.signal
  });
}

export async function searchTermbaseConcordance(params: {
  termbaseId: number;
  query: string;
  searchIn?: "source" | "target";
  srcLang: string;
  tgtLang: string;
  filters?: Omit<TermbaseLookupFilters, "searchSource" | "searchTarget">;
}): Promise<TermbaseConcordanceEntry[]> {
  const searchIn = params.searchIn ?? "source";
  return fetchTermbaseConcordance({
    termbaseId: params.termbaseId,
    q: params.query,
    sourceLang: params.srcLang,
    targetLang: params.tgtLang,
    mode: "search",
    limit: params.filters?.limit ?? 12,
    searchSource: searchIn === "source",
    searchTarget: searchIn === "target",
    includeDeprecated: params.filters?.includeDeprecated,
    includeForbidden: params.filters?.includeForbidden,
    category: params.filters?.category,
    signal: params.filters?.signal
  });
}

export async function searchProjectGlossary(params: {
  projectId: number;
  q: string;
}): Promise<GlobalGlossaryEntry[]> {
  const qs = new URLSearchParams();
  if (params.q.trim()) qs.set("q", params.q.trim());
  const r = await fetch(
    `${CAT_API_BASE}/projects/${params.projectId}/glossary/search?${qs.toString()}`,
    { headers: { ...authHeaders() } }
  );
  if (!r.ok) throw new Error(`glossary search ${r.status}`);
  const data = await r.json();
  return data.entries || [];
}

export async function getProjectAnalytics(projectId: number, opts?: { fileId?: number }) {
  const qs = new URLSearchParams();
  if (opts?.fileId != null && Number.isFinite(Number(opts.fileId))) {
    qs.set("fileId", String(opts.fileId));
  }
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/analytics${qs.toString() ? `?${qs.toString()}` : ""}`,
    { headers: { ...authHeaders() } }
  );
  if (!r.ok) throw new Error(`analytics ${r.status}`);
  return r.json();
}

export async function getSegmentQaIssues(
  segmentId: number
): Promise<QaIssue[]> {
  const r = await fetch(`${CAT_API_BASE}/segments/${segmentId}/qa`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error(`qa issues ${r.status}`);
  const data = await r.json();
  return data.issues || [];
}

export async function createSegmentQaIssue(params: {
  segmentId: number;
  issueType: string;
  severity: string;
  message: string;
}): Promise<QaIssue> {
  const r = await fetch(`${CAT_API_BASE}/segments/${params.segmentId}/qa`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      issueType: params.issueType,
      severity: params.severity,
      message: params.message
    })
  });
  if (!r.ok) throw new Error(`create qa ${r.status}`);
  const data = await r.json();
  return data.issue as QaIssue;
}

export async function resolveQaIssue(issueId: number) {
  const r = await fetch(`${CAT_API_BASE}/qa/${issueId}/resolve`, {
    method: "POST",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error(`resolve qa ${r.status}`);
  return r.json();
}

