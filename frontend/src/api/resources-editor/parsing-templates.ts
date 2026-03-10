import {
  CAT_API_BASE,
  authHeaders,
  httpError
} from "./shared";
import type { ParsingTemplate, ParsingTemplateConfig, ParsingTemplateKind } from "../core";

export async function listParsingTemplates(opts?: { kind?: ParsingTemplateKind }): Promise<ParsingTemplate[]> {
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", String(opts.kind));
  const response = await fetch(
    `${CAT_API_BASE}/parsing-templates${params.toString() ? `?${params.toString()}` : ""}`,
    { headers: { ...authHeaders() } }
  );
  if (!response.ok) throw await httpError("list parsing templates", response);
  const data = await response.json();
  return data.templates || [];
}

export async function createParsingTemplate(payload: {
  name: string;
  description?: string;
  kind?: ParsingTemplateKind;
  config: ParsingTemplateConfig;
  sourceUploadId?: number;
}): Promise<ParsingTemplate> {
  const response = await fetch(`${CAT_API_BASE}/parsing-templates`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw await httpError("create parsing template", response);
  const data = await response.json();
  return data.template as ParsingTemplate;
}

export async function updateParsingTemplate(
  id: number,
  payload: { name?: string; description?: string; config?: ParsingTemplateConfig; sourceUploadId?: number }
): Promise<ParsingTemplate> {
  const response = await fetch(`${CAT_API_BASE}/parsing-templates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw await httpError("update parsing template", response);
  const data = await response.json();
  return data.template as ParsingTemplate;
}

export async function deleteParsingTemplate(id: number): Promise<void> {
  const response = await fetch(`${CAT_API_BASE}/parsing-templates/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("delete parsing template", response);
}

export async function downloadParsingTemplateJson(id: number): Promise<Blob> {
  const response = await fetch(`${CAT_API_BASE}/parsing-templates/${encodeURIComponent(id)}/download`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("download parsing template", response);
  return response.blob();
}

export async function uploadParsingTemplateJson(file: File, opts?: { kind?: ParsingTemplateKind }): Promise<{
  uploadId: number;
  kind: ParsingTemplateKind;
  template: { kind: ParsingTemplateKind; name: string; description: string; config: ParsingTemplateConfig };
}> {
  const formData = new FormData();
  formData.append("file", file);
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", String(opts.kind));
  const response = await fetch(
    `${CAT_API_BASE}/parsing-templates/uploads${params.toString() ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
      headers: { ...authHeaders() },
      body: formData
    }
  );
  if (!response.ok) throw await httpError("upload parsing template json", response);
  const data = await response.json();
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
  const response = await fetch(`${CAT_API_BASE}/parsing-templates/uploads/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw await httpError("delete parsing template upload", response);
}
