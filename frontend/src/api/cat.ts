import { APP_AGENT_ADMIN_API_BASE, CAT_API_BASE, CHAT_API_BASE, authHeaders, httpError } from "./core";
import type {
  TermbaseAudit,
  TermbaseConcordanceEntry,
  TermbaseConcordanceMatch,
  TermbaseConcordanceMatchType,
  TermbaseConcordanceTerm,
  TermbaseCustomFields,
  TermbaseEntryDetail,
  TermbaseEntryListItem,
  TermbaseEntryListResponse,
  TermbaseField,
  TermbaseLanguageSection,
  TermbaseMatchEntry,
  TermbaseMatchSection,
  TermbaseMatchTerm,
  TermbaseMeta,
  TermbaseStructure,
  TermbaseTerm
} from "./cat.termbase-types";

export type {
  TermbaseAudit,
  TermbaseConcordanceEntry,
  TermbaseConcordanceMatch,
  TermbaseConcordanceMatchType,
  TermbaseConcordanceTerm,
  TermbaseCustomFields,
  TermbaseEntryDetail,
  TermbaseEntryListItem,
  TermbaseEntryListResponse,
  TermbaseField,
  TermbaseLanguageSection,
  TermbaseMatchEntry,
  TermbaseMatchSection,
  TermbaseMatchTerm,
  TermbaseMeta,
  TermbaseStructure,
  TermbaseTerm
} from "./cat.termbase-types";

// ---------- CAT (cat-api) ----------

export type ProjectHtmlFile = {
  id: number;
  originalName: string;
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  srcLang: string;
  tgtLang: string;
  targetLangs?: string[];
  status: string;
  publishedAt?: string | null;
  initError?: string | null;
  provisioningStartedAt?: string | null;
  provisioningUpdatedAt?: string | null;
  provisioningFinishedAt?: string | null;
  provisioningProgress?: number | null;
  provisioningCurrentStep?: string | null;
  createdBy: string | null;
  assignedUser: string | null;
  tmSample: string | null;
  tmSampleTmId: number | null;
  tmSampleSeeded: boolean;
  tmSampleEntryCount?: number;
  glossaryId: number | null;
  departmentId?: number | null;
  departmentName?: string | null;
  createdAt: string;
  dueAt?: string | null;
  lastModifiedAt?: string | null;
  errorCount?: number | null;
  htmlFiles?: ProjectHtmlFile[];
};

export type ProjectBucketSourceFile = {
  fileId: number;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  uploadedAt: string;
};

export type ProjectBucketOutputFile = {
  fileId: number;
  filename: string;
  lang: string;
  contentType: string | null;
  sizeBytes: number;
  createdAt: string;
};

export type ProjectBucketMeta = {
  projectId: number;
  updatedAt: string;
  source: ProjectBucketSourceFile[];
  output: ProjectBucketOutputFile[];
  errorCount?: number;
  lastErrorMessage?: string | null;
};

export type ProjectFileTask = {
  taskId: number;
  targetLang: string;
  assigneeId: string;
  status: string;
  segmentStats?: {
    total: number;
    draft: number;
    underReview: number;
    reviewed: number;
  };
};

export type ProjectFileItem = {
  fileId: number;
  originalFilename: string;
  type: string;
  usage: string;
  status: string;
  createdAt: string;
  tasks?: ProjectFileTask[];
  segmentStats: {
    total: number;
    draft: number;
    underReview: number;
    reviewed: number;
  };
};

export type ProjectFilesResponse = {
  projectId: number;
  assignedTo: string | null;
  files: ProjectFileItem[];
};

export type ImportProjectFileToTmResponse = {
  ok: boolean;
  projectId: number;
  fileId: number;
  tmId: number;
  targetLang: string | null;
  dedupeMode: "skip" | "overwrite" | "keep_both";
  segmentsProcessed: number;
  segmentsImported: number;
  segmentsSkipped: number;
  importedAt: string;
};

export type InboxItem = {
  taskId: number;
  projectId: number;
  projectName: string;
  projectOwnerId?: string | null;
  fileId: number;
  originalFilename: string;
  type: string;
  usage: string;
  assignedTo: string | null;
  srcLang: string;
  tgtLang: string;
  status: string;
  taskStatus?: string;
  progressPct: number;
  lastModifiedAt: string | null;
  lastUpdatedAt?: string | null;
  createdAt: string;
  sourceWordCount?: number;
  segmentCount?: number;
  segmentStats: {
    total: number;
    draft: number;
    underReview: number;
    reviewed: number;
  };
};

export type AdminUser = {
  id: number;
  username: string;
  role: string;
  departmentId: number | null;
  displayName: string | null;
  email: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  failedAttempts: number;
  locked: boolean;
  lockExpiresAt: string | null;
};

export type Department = {
  id: number;
  name: string;
  slug: string | null;
  disabled: boolean;
  createdAt: string | null;
};

export type UsageSummary = {
  totals: {
    projects: number;
    segments: number;
    translated: number;
    underReview: number;
  };
  users: {
    userId: string;
    projects: number;
    segments: number;
    translated: number;
    underReview: number;
  }[];
};

export type GlobalGlossaryEntry = {
  id: number | null;
  sourceLang: string | null;
  targetLang: string | null;
  term: string;
  translation: string;
  notes?: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  sourceType: "origination" | "modification";
  origin?: string | null;
  originAuthor?: string | null;
  originDate?: string | null;
};

export type GlobalGlossaryOverview = {
  entries: GlobalGlossaryEntry[];
  meta: {
    activeFile: string | null;
    entryCount: number;
  };
};

export type SampleAsset = {
  id: string;
  label: string;
  filename: string;
  tmId?: number | null;
  seeded?: boolean;
  entryCount?: number;
};

export type TmLibraryEntry = {
  id: number;
  origin?: string;
  label: string;
  comment?: string | null;
  filename: string;
  sizeBytes: number;
  disabled?: boolean;
  uploadedBy?: string | null;
  uploadedAt?: string | null;
  tmProxyId?: number | null;
  createdAt: string | null;
  updatedAt?: string | null;
};

export type TmLibraryVersion = {
  versionId: number;
  entryId: number;
  versionNumber?: number | null;
  createdAt: string | null;
  createdBy: string | null;
  comment: string | null;
  label: string;
  filename: string;
  sizeBytes: number;
  disabled: boolean;
};

export type SegmentSourceType = "tmx" | "nmt" | "ntm_draft" | "llm" | "manual" | "none";

export type SegmentIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type SegmentRunStyle = {
  fontFamily?: string | null;
  fontSizePt?: number | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string | null;
};

export type SegmentRunMeta = {
  tagId?: string | null;
  nonTranslatable?: boolean;
  placeholderType?: string | null;
};

export type SegmentRun = {
  text: string;
  style?: SegmentRunStyle | null;
  meta?: SegmentRunMeta | null;
};

export type SegmentContainerContext = {
  fileType?: string | null;
  partPath?: string | null;
  slideIndex?: number | null;
  shapeIndex?: number | null;
  paragraphIndex?: number | null;
  sheetName?: string | null;
  cellRef?: string | null;
  styleId?: number | null;
  numberFormat?: string | null;
  wrapText?: boolean | null;
  alignment?: string | null;
  richText?: boolean | null;
  [key: string]: unknown;
};

export type SegmentOriginDetails = {
  engineId?: string | null;
  tmId?: string | null;
  matchScore?: number | null;
  [key: string]: unknown;
};

export type IssueSummary = {
  error: number;
  warning: number;
  byType: Record<string, number>;
};

export type Segment = {
  id: number;
  index: number;
  src: string;
  tgt: string | null;
  srcRuns?: SegmentRun[];
  tgtRuns?: SegmentRun[];
  segmentContext?: SegmentContainerContext;
  originDetails?: SegmentOriginDetails;
  status: import("./types/app").SegmentStatus;
  state?: import("./types/app").SegmentState;
  generatedByLlm?: boolean;
  qeScore?: number | null;
  issueSummary?: IssueSummary;
  issues?: SegmentIssue[];
  version: number;
  isLocked?: boolean;
  sourceType?: SegmentSourceType;
  sourceScore?: number | null;
  sourceMatchId?: string | null;
};

export type SegmentUpdateResponse = {
  ok: true;
  version: number;
  status?: import("./types/app").SegmentStatus;
  state?: import("./types/app").SegmentState;
  isLocked?: boolean;
  generatedByLlm?: boolean;
  qeScore?: number | null;
  tgtRuns?: SegmentRun[];
  originDetails?: SegmentOriginDetails;
  issueSummary?: IssueSummary;
  issues?: SegmentIssue[];
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: any;
  [key: string]: any;
};
export type QaIssue = {
  id: number;
  segmentId: number;
  issueType: string;
  severity: string;
  message: string;
  resolved: boolean;
  createdAt: string;
};

async function requireOk(action: string, response: Response): Promise<Response> {
  if (!response.ok) throw await httpError(action, response);
  return response;
}

async function parseJsonResponse<T>(action: string, response: Response): Promise<T> {
  await requireOk(action, response);
  return (await response.json()) as T;
}

async function parseBlobResponse(action: string, response: Response): Promise<Blob> {
  await requireOk(action, response);
  return response.blob();
}

export type AgentChatThread = {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentChatThreadDeleteResponse = {
  ok: boolean;
  replacementThread: AgentChatThread | null;
};

export type AgentChatMessage = {
  id: number;
  threadId: number;
  userId: number;
  role: "user" | "assistant" | "tool";
  contentText: string;
  contentJson: Record<string, any> | null;
  createdAt: string;
};

export type AgentChatStartResponse = {
  requestId: string;
  userMessage: AgentChatMessage;
};

export type AgentChatStreamEvent =
  | { type: "token"; token: string }
  | { type: "tool_call"; toolName: string; status: "started" | "succeeded" | "failed"; message?: string | null }
  | { type: "final"; message: AgentChatMessage }
  | { type: "error"; message: string };

export type ChatUploadSessionFile = {
  fileId: number;
  filename: string;
  fileType: string | null;
  fileTypeConfigId: number | null;
  status: string | null;
  createdAt: string;
};

export type ChatUploadSession = {
  projectId: number;
  name: string;
  status: string;
  sourceLang: string;
  targetLang: string;
  files: ChatUploadSessionFile[];
};

export type AppAgentToolName =
  | "translate_snippet"
  | "create_project"
  | "list_projects"
  | "get_project_status";

export type AppAgentConnectionProvider = "mock" | "gateway";

export type AppAgentAdminConfig = {
  enabled: boolean;
  connectionProvider: AppAgentConnectionProvider;
  providerId: number | null;
  modelName: string;
  endpoint: string;
  mockMode: boolean;
  systemPrompt: string;
  enabledTools: AppAgentToolName[];
  providerApiKeyConfigured: boolean;
  providerApiKeyMasked: string | null;
  providerApiKey?: string | null;
  clearProviderApiKey?: boolean;
  providerOrg: string | null;
  providerProject: string | null;
  providerRegion: string | null;
  applyMode?: "hot_reload";
  updatedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AppAgentProviderOption = {
  id: number;
  name: string;
  model: string;
  enabled: boolean;
};

function parseSseBlock(block: string): { id?: number; event?: string; data?: string } | null {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  const lines = trimmed.split(/\r?\n/);
  let id: number | undefined;
  let event: string | undefined;
  const dataParts: string[] = [];
  lines.forEach((line) => {
    if (line.startsWith("id:")) {
      const value = Number(line.slice(3).trim());
      if (Number.isFinite(value)) id = value;
      return;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trim());
    }
  });
  return { id, event, data: dataParts.join("\n") };
}

export async function listChatThreads(): Promise<AgentChatThread[]> {
  const response = await fetch(`${CHAT_API_BASE}/threads`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ threads?: AgentChatThread[] }>("list chat threads", response);
  return Array.isArray(data.threads) ? data.threads : [];
}

export async function createChatThread(payload?: { title?: string }): Promise<AgentChatThread> {
  const response = await fetch(`${CHAT_API_BASE}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload || {})
  });
  const data = await parseJsonResponse<{ thread: AgentChatThread }>("create chat thread", response);
  return data.thread;
}

export async function updateChatThread(
  threadId: number,
  payload: { title: string }
): Promise<AgentChatThread> {
  const response = await fetch(`${CHAT_API_BASE}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  const data = await parseJsonResponse<{ thread: AgentChatThread }>("update chat thread", response);
  return data.thread;
}

export async function deleteChatThread(threadId: number): Promise<AgentChatThreadDeleteResponse> {
  const response = await fetch(`${CHAT_API_BASE}/threads/${threadId}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  return parseJsonResponse<AgentChatThreadDeleteResponse>("delete chat thread", response);
}

export async function listChatMessages(threadId: number): Promise<AgentChatMessage[]> {
  const response = await fetch(`${CHAT_API_BASE}/threads/${threadId}/messages`, {
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ messages?: AgentChatMessage[] }>("list chat messages", response);
  return Array.isArray(data.messages) ? data.messages : [];
}

export async function postChatMessage(
  threadId: number,
  payload: { contentText: string; contentJson?: Record<string, any> | null }
): Promise<AgentChatStartResponse> {
  const response = await fetch(`${CHAT_API_BASE}/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<AgentChatStartResponse>("post chat message", response);
}

export async function streamChatResponse(params: {
  threadId: number;
  requestId: string;
  signal?: AbortSignal;
  lastEventId?: number;
  onEvent: (event: AgentChatStreamEvent) => void;
}) {
  const qs = new URLSearchParams({ requestId: params.requestId });
  if (params.lastEventId != null && Number.isFinite(params.lastEventId)) {
    qs.set("lastEventId", String(params.lastEventId));
  }
  const response = await fetch(`${CHAT_API_BASE}/threads/${params.threadId}/stream?${qs.toString()}`, {
    headers: {
      Accept: "text/event-stream",
      ...authHeaders()
    },
    signal: params.signal
  });
  await requireOk("stream chat response", response);

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator && separator.index != null) {
      const splitIndex = separator.index;
      const separatorLength = separator[0].length;
      const block = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + separatorLength);
      const parsed = parseSseBlock(block);
      if (!parsed || !parsed.event) {
        separator = buffer.match(/\r?\n\r?\n/);
        continue;
      }
      let payload: any = {};
      if (parsed.data) {
        try {
          payload = JSON.parse(parsed.data);
        } catch {
          payload = {};
        }
      }
      if (parsed.event === "token") {
        params.onEvent({ type: "token", token: String(payload.token || "") });
      } else if (parsed.event === "tool_call") {
        params.onEvent({
          type: "tool_call",
          toolName: String(payload.toolName || ""),
          status: (payload.status as "started" | "succeeded" | "failed") || "started",
          message: payload.message ? String(payload.message) : null
        });
      } else if (parsed.event === "final") {
        params.onEvent({ type: "final", message: payload.message as AgentChatMessage });
      } else if (parsed.event === "error") {
        params.onEvent({ type: "error", message: String(payload.message || "Unknown error") });
      }
      separator = buffer.match(/\r?\n\r?\n/);
    }
  }
}

export async function getOrCreateChatUploadSession(): Promise<ChatUploadSession> {
  const response = await fetch(`${CHAT_API_BASE}/uploads/session`, {
    method: "POST",
    headers: { ...authHeaders() }
  });
  const data = await parseJsonResponse<{ session?: ChatUploadSession }>("create chat upload session", response);
  if (!data.session || !Number.isFinite(Number(data.session.projectId))) {
    throw new Error("Invalid chat upload session response.");
  }
  return data.session;
}

export async function getAppAgentAdminConfig(): Promise<{
  config: AppAgentAdminConfig;
  providers: AppAgentProviderOption[];
  allowlistedTools: AppAgentToolName[];
}> {
  const response = await fetch(`${APP_AGENT_ADMIN_API_BASE}/config`, {
    headers: { ...authHeaders() }
  });
  return parseJsonResponse<{
    config: AppAgentAdminConfig;
    providers: AppAgentProviderOption[];
    allowlistedTools: AppAgentToolName[];
  }>("get app agent config", response);
}

export async function updateAppAgentAdminConfig(
  payload: Partial<AppAgentAdminConfig>
): Promise<{ config: AppAgentAdminConfig }> {
  const response = await fetch(`${APP_AGENT_ADMIN_API_BASE}/config`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{ config: AppAgentAdminConfig }>("update app agent config", response);
}


export async function listProjects(params?: { scope?: "current" }): Promise<Project[]> {
  const qs = new URLSearchParams();
  if (params?.scope) qs.set("scope", params.scope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const r = await fetch(`${CAT_API_BASE}/projects${suffix}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error(`projects ${r.status}`);
  const data = await r.json();
  return data.projects || [];
}

export async function deleteProject(projectId: number) {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error(`delete project ${r.status}`);
  return r.json();
}

export async function importProjectFileToTm(
  projectId: number,
  fileId: number,
  payload: {
    tmId: number;
    targetLang?: string;
    dedupeMode?: "skip" | "overwrite" | "keep_both";
  }
): Promise<ImportProjectFileToTmResponse> {
  const response = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/files/${encodeURIComponent(fileId)}/import-to-tm`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    }
  );
  return parseJsonResponse<ImportProjectFileToTmResponse>("import file to tm", response);
}

export async function listTmSamples(): Promise<SampleAsset[]> {
  const r = await fetch(`${CAT_API_BASE}/library/tm-samples`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error(`tm samples ${r.status}`);
  const data = await r.json();
  return data.samples || [];
}

export async function fetchUsageSummary(): Promise<UsageSummary> {
  const r = await fetch(`${CAT_API_BASE}/admin/usage`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("usage summary", r);
  return r.json();
}

export async function downloadUsageCsv(): Promise<Blob> {
  const r = await fetch(`${CAT_API_BASE}/admin/usage/export`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("download usage", r);
  return r.blob();
}

export type ChatUsageSummary = {
  totals: {
    threads: number;
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolCallFailures: number;
    requests: number;
    requestFailures: number;
  };
  tools: Array<{
    toolName: string;
    calls: number;
    failures: number;
  }>;
  users: Array<{
    userId: number;
    threads: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    requests: number;
    failures: number;
    lastMessageAt: string | null;
  }>;
  daily: Array<{
    day: string;
    requests: number;
    failures: number;
    toolCalls: number;
  }>;
};

export type ChatAuditEvent = {
  id: number;
  requestId: string;
  userId: number;
  threadId: number | null;
  messageId: number | null;
  eventType: string;
  toolName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function fetchChatUsageSummary(): Promise<ChatUsageSummary> {
  const r = await fetch(`${CAT_API_BASE}/admin/chat/usage`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("chat usage summary", r);
  return r.json();
}

export async function downloadChatUsageCsv(): Promise<Blob> {
  const r = await fetch(`${CAT_API_BASE}/admin/chat/usage/export`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("download chat usage", r);
  return r.blob();
}

export async function listChatAuditEvents(params?: {
  limit?: number;
  eventType?: string;
  userId?: number;
}): Promise<ChatAuditEvent[]> {
  const qs = new URLSearchParams();
  if (params?.limit != null && Number.isFinite(params.limit)) qs.set("limit", String(params.limit));
  if (params?.eventType) qs.set("eventType", params.eventType);
  if (params?.userId != null && Number.isFinite(params.userId)) qs.set("userId", String(params.userId));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const r = await fetch(`${CAT_API_BASE}/admin/chat/audit${suffix}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("chat audit events", r);
  const data = (await r.json()) as { events?: ChatAuditEvent[] };
  return Array.isArray(data.events) ? data.events : [];
}

export type LanguageCatalogEntry = {
  tag: string;
  englishName: string;
  nativeName: string;
  defaultRegionForFlag: string;
  aliases?: string[];
};

export type OrgLanguageSettings = {
  enabledLanguageTags: string[];
  defaultSourceTag: string;
  defaultTargetTags: string[];
  preferredVariantsByPrimary: Record<string, string>;
  allowSingleLanguage: boolean;
};

export type OrgLanguageConfig = {
  catalog: LanguageCatalogEntry[];
  settings: OrgLanguageSettings;
};

export async function getOrgLanguages(): Promise<OrgLanguageConfig> {
  const r = await fetch(`${CAT_API_BASE}/org/languages`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("org languages", r);
  return r.json();
}

export async function updateOrgLanguageSettings(settings: OrgLanguageSettings): Promise<OrgLanguageSettings> {
  const r = await fetch(`${CAT_API_BASE}/admin/org/languages`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(settings)
  });
  if (!r.ok) throw await httpError("update org languages", r);
  const data = await r.json();
  return data.settings as OrgLanguageSettings;
}

export * from './cat.terminology';

