// src/api.ts

export type Match = { source: string; target: string; score: number };

export type ParsingTemplateKind = "html" | "xml";

export type HtmlParsingTemplateConfig = {
  block_tags: string[];
  inline_tags: string[];
  ignored_tags: string[];
  translatable_attributes: Record<string, string[]>;
};

export type XmlParsingTemplateConfig = {
  block_xpath: string[];
  inline_xpath: string[];
  ignored_xpath: string[];
  namespaces: Record<string, string>;
  default_namespace_prefix: string | null;
  translate_attributes: boolean;
  attribute_allowlist: string[];
  treat_cdata_as_text: boolean;
};

export type ParsingTemplateConfig = HtmlParsingTemplateConfig | XmlParsingTemplateConfig;

export type ParsingTemplate = {
  id: number;
  name: string;
  description: string;
  kind?: ParsingTemplateKind;
  config: ParsingTemplateConfig;
  version?: number;
  sourceJson?: { originalName: string | null; sizeBytes: number | null; uploadedAt: string | null } | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// TM service (tm-proxy) base URL (through nginx: /api -> tm-proxy)
export const TM_API_BASE =
  (import.meta as any).env.VITE_API_BASE || "/api";

const DEFAULT_TM_ID = Number(
  (import.meta as any).env.VITE_DEFAULT_TM_ID || "1"
);

export function tmUrl(tmId?: number, suffix = "") {
  const id = tmId ?? DEFAULT_TM_ID;
  return `${TM_API_BASE}/tm/${id}${suffix}`;
}

// CAT service (cat-api) base URL (through nginx: /api/cat -> cat-api)
export const CAT_API_BASE =
  (import.meta as any).env.VITE_CAT_API_BASE || "/api/cat";

// App-wide chat agent API (through nginx: /api/chat -> cat-api)
export const CHAT_API_BASE =
  (import.meta as any).env.VITE_CHAT_API_BASE || "/api/chat";

// App Agent admin configuration API (through nginx: /api/admin/app-agent -> cat-api)
export const APP_AGENT_ADMIN_API_BASE =
  (import.meta as any).env.VITE_APP_AGENT_ADMIN_API_BASE || "/api/admin/app-agent";

// LLM orchestration base URL (proxied through nginx at /api/llm)
export const LLM_API_BASE =
  (import.meta as any).env.VITE_LLM_API_BASE || "/api/llm";

export function authHeaders() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function truncate(text: string, max = 400) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

export async function httpError(label: string, response: Response) {
  const requestId = response.headers.get("x-request-id");
  const statusLine = `${label} ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;

  let detail = "";
  let payloadObj: any = null;
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as any;
      payloadObj = payload;
      if (payload && typeof payload === "object") {
        if (typeof payload.error === "string" && payload.error.trim()) {
          detail = payload.error.trim();
        } else if (typeof payload.message === "string" && payload.message.trim()) {
          detail = payload.message.trim();
        } else {
          detail = JSON.stringify(payload);
        }
      }
    } else {
      detail = truncate((await response.text()).trim());
      if (detail.startsWith("<!DOCTYPE") || detail.startsWith("<html")) detail = "";
    }
  } catch {
    // ignore parsing errors
  }

  const err: any = new Error(
    [statusLine, detail || null, requestId ? `request ${requestId}` : null]
      .filter(Boolean)
      .join(": ")
  );
  err.status = response.status;
  err.requestId = requestId;
  err.detail = detail || null;
  err.userMessage = detail || null;
  if (payloadObj && typeof payloadObj === "object") {
    err.payload = payloadObj;
    if (typeof payloadObj.code === "string" && payloadObj.code.trim()) {
      err.code = payloadObj.code.trim();
    }
    if (payloadObj.fileType !== undefined) {
      err.fileType = payloadObj.fileType;
    }
  }
  return err;
}

