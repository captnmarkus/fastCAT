import {
  CAT_API_BASE,
  authHeaders,
  httpError,
  type InboxItem,
  type ProjectBucketMeta,
  type ProjectFilesResponse,
  type Segment,
  type SegmentMutationParams,
  type SegmentSourceType,
  type SegmentUpdateResponse
} from "./shared";
import { buildSegmentMutationBody, parseSegmentMutationResponse } from "./shared";
import type { SegmentState } from "../../types/app";

export async function getProjectSegments(
  projectId: number,
  opts?: { pageSize?: number; fileId?: number; taskId?: number }
): Promise<{ segments: Segment[]; total: number }> {
  const limit = Math.min(Math.max(opts?.pageSize ?? 250, 25), 500);
  let page = 1;
  let total = 0;
  const segments: Segment[] = [];
  while (true) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (opts?.fileId != null && Number.isFinite(Number(opts.fileId))) {
      params.set("fileId", String(opts.fileId));
    }
    if (opts?.taskId != null && Number.isFinite(Number(opts.taskId))) {
      params.set("taskId", String(opts.taskId));
    }
    const response = await fetch(`${CAT_API_BASE}/projects/${projectId}/segments?${params.toString()}`, {
      headers: { ...authHeaders() }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `segments ${response.status}`);
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

type UpdateSegmentParams = SegmentMutationParams & {
  id: number;
  state?: SegmentState;
  sourceType?: SegmentSourceType;
};

export async function updateSegment(params: UpdateSegmentParams): Promise<SegmentUpdateResponse> {
  const response = await fetch(`${CAT_API_BASE}/segments/${params.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(buildSegmentMutationBody(params))
  });
  return parseSegmentMutationResponse(response);
}

function buildProjectExportQuery(opts?: { fileId?: number; taskId?: number; lang?: string; targetLang?: string }) {
  const params = new URLSearchParams();
  if (opts?.fileId != null) params.set("fileId", String(opts.fileId));
  if (opts?.taskId != null) params.set("taskId", String(opts.taskId));
  const lang = opts?.targetLang ?? opts?.lang;
  if (lang) params.set("lang", String(lang));
  return params.toString();
}

export async function exportProjectXliff(
  projectId: number,
  opts?: { fileId?: number; taskId?: number }
): Promise<Blob> {
  const query = buildProjectExportQuery(opts);
  const response = await fetch(`${CAT_API_BASE}/projects/${projectId}/export-xliff${query ? `?${query}` : ""}`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw new Error(`export xliff ${response.status}`);
  return response.blob();
}

export async function exportProjectHtml(
  projectId: number,
  opts?: { fileId?: number; taskId?: number }
): Promise<Blob> {
  const query = buildProjectExportQuery(opts);
  const response = await fetch(`${CAT_API_BASE}/projects/${projectId}/export-html${query ? `?${query}` : ""}`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw new Error(`export html ${response.status}`);
  return response.blob();
}

export async function exportProjectTargetFile(
  projectId: number,
  opts?: { fileId?: number; taskId?: number; lang?: string; targetLang?: string }
): Promise<Blob> {
  const query = buildProjectExportQuery(opts);
  const response = await fetch(`${CAT_API_BASE}/projects/${projectId}/export-target${query ? `?${query}` : ""}`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("export target file", response);
  return response.blob();
}

export async function getProjectBucket(projectId: number): Promise<ProjectBucketMeta> {
  const response = await fetch(`${CAT_API_BASE}/projects/${projectId}/bucket`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("project bucket", response);
  return (await response.json()) as ProjectBucketMeta;
}

export async function listProjectFiles(projectId: number): Promise<ProjectFilesResponse> {
  const response = await fetch(`${CAT_API_BASE}/projects/${projectId}/files`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("project files", response);
  return (await response.json()) as ProjectFilesResponse;
}

export async function listInboxItems(): Promise<InboxItem[]> {
  const response = await fetch(`${CAT_API_BASE}/inbox`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("inbox", response);
  const data = (await response.json()) as any;
  return (data?.items || []) as InboxItem[];
}

export async function completeFile(fileId: number, mode: "under_review" | "reviewed"): Promise<any> {
  const response = await fetch(`${CAT_API_BASE}/files/${encodeURIComponent(fileId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ mode })
  });
  if (!response.ok) throw await httpError("complete file", response);
  return response.json();
}

export async function completeTask(taskId: number, mode: "under_review" | "reviewed"): Promise<any> {
  const response = await fetch(`${CAT_API_BASE}/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ mode })
  });
  if (!response.ok) throw await httpError("complete task", response);
  return response.json();
}

export async function downloadProjectBucketSourceFile(
  projectId: number,
  fileId: number,
  filename: string
): Promise<Blob> {
  const response = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/bucket/file/${encodeURIComponent(fileId)}/source/${encodeURIComponent(filename)}`,
    { headers: { ...authHeaders() } }
  );
  if (!response.ok) throw await httpError("download project source", response);
  return response.blob();
}

export async function downloadProjectBucketOutputFile(
  projectId: number,
  fileId: number,
  lang: string,
  filename: string
): Promise<Blob> {
  void filename;
  return exportProjectTargetFile(projectId, { fileId, lang });
}
