import { CAT_API_BASE, TM_API_BASE, authHeaders, httpError } from "./core";

// ---------- Resources (vNext) ----------

export type ProjectTemplate = {
  id: number;
  name: string;
  description: string;
  scope: string;
  disabled?: boolean;
  languages: {
    src: string;
    targets: string[];
  };
  translationEngineId: number | null;
  translationEngineName: string | null;
  fileTypeConfigId: number | null;
  fileTypeConfigName: string | null;
  defaultTmxId?: number | null;
  defaultRulesetId?: number | null;
  defaultGlossaryId?: number | null;
  tmxByTargetLang?: Record<string, number | null>;
  rulesetByTargetLang?: Record<string, number | null>;
  glossaryByTargetLang?: Record<string, number | null>;
  settings: {
    canEditSource: boolean;
    canDownloadSource: boolean;
    canDownloadTranslated: boolean;
    canExportIntermediate: boolean;
    autoCreateInboxItems: boolean;
    completionPolicy: string;
  };
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listProjectTemplates(): Promise<ProjectTemplate[]> {
  const r = await fetch(`${CAT_API_BASE}/resources/project-templates`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("project templates", r);
  const data = (await r.json()) as any;
  return (data?.items || []) as ProjectTemplate[];
}

export async function getProjectTemplate(templateId: number): Promise<ProjectTemplate> {
  const r = await fetch(`${CAT_API_BASE}/resources/project-templates/${encodeURIComponent(templateId)}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("project template", r);
  const data = (await r.json()) as any;
  return data.item as ProjectTemplate;
}

export async function checkProjectTemplateNameAvailable(params: { name: string; excludeId?: number | string | null }): Promise<boolean> {
  const name = String(params.name || "").trim();
  if (!name) return true;
  const qs = new URLSearchParams({ name });
  if (params.excludeId != null && String(params.excludeId).trim()) {
    qs.set("excludeId", String(params.excludeId));
  }
  const r = await fetch(`${CAT_API_BASE}/resources/project-templates/check-name?${qs.toString()}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("check project template name", r);
  const data = (await r.json()) as any;
  return Boolean(data?.available);
}

export async function createProjectTemplate(input: {
  name: string;
  description?: string;
  scope?: string;
  disabled?: boolean;
  languages: { src: string; targets: string[] };
  translationEngineId?: number | null;
  fileTypeConfigId?: number | null;
  defaultTmxId?: number | null;
  defaultRulesetId?: number | null;
  defaultGlossaryId?: number | null;
  tmxByTargetLang?: Record<string, number | null>;
  rulesetByTargetLang?: Record<string, number | null>;
  glossaryByTargetLang?: Record<string, number | null>;
  settings?: Partial<ProjectTemplate["settings"]>;
}): Promise<ProjectTemplate> {
  const r = await fetch(`${CAT_API_BASE}/resources/project-templates`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("create project template", r);
  const data = (await r.json()) as any;
  return data.item as ProjectTemplate;
}

export async function updateProjectTemplate(
  templateId: number,
  updates: Partial<{
    name: string;
    description: string;
    scope: string;
    disabled: boolean;
    languages: { src: string; targets: string[] };
    translationEngineId: number | null;
    fileTypeConfigId: number | null;
    defaultTmxId: number | null;
    defaultRulesetId: number | null;
    defaultGlossaryId: number | null;
    tmxByTargetLang: Record<string, number | null>;
    rulesetByTargetLang: Record<string, number | null>;
    glossaryByTargetLang: Record<string, number | null>;
    settings: Partial<ProjectTemplate["settings"]>;
  }>
): Promise<ProjectTemplate> {
  const r = await fetch(`${CAT_API_BASE}/resources/project-templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates)
  });
  if (!r.ok) throw await httpError("update project template", r);
  const data = (await r.json()) as any;
  return data.item as ProjectTemplate;
}

export async function deleteProjectTemplate(templateId: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/resources/project-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete project template", r);
}

export async function copyProjectTemplate(templateId: number): Promise<ProjectTemplate> {
  const r = await fetch(`${CAT_API_BASE}/resources/project-templates/${encodeURIComponent(templateId)}/copy`, {
    method: "POST",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("copy project template", r);
  const data = (await r.json()) as any;
  return data.item as ProjectTemplate;
}

export type TranslationEngine = {
  id: number;
  name: string;
  description: string;
  disabled: boolean;
  llmProviderId: number | null;
  llmProviderName: string | null;
  llmProviderVendor: string | null;
  llmProviderModel: string | null;
  systemPrompt?: string;
  userPromptTemplate?: string;
  generation?: { temperature: number | null; maxTokens: number | null; topP: number | null };
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listTranslationEngines(): Promise<TranslationEngine[]> {
  const r = await fetch(`${TM_API_BASE}/translation-engines`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("translation engines", r);
  const data = (await r.json()) as any;
  return (data?.items || []) as TranslationEngine[];
}

export async function createTranslationEngine(input: {
  name: string;
  description?: string;
  disabled?: boolean;
  llmProviderId: number;
  systemPrompt: string;
  userPromptTemplate: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
}): Promise<TranslationEngine> {
  const r = await fetch(`${TM_API_BASE}/translation-engines`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("create translation engine", r);
  const data = (await r.json()) as any;
  return data.item as TranslationEngine;
}

export async function getTranslationEngine(engineId: number): Promise<TranslationEngine> {
  const r = await fetch(`${TM_API_BASE}/translation-engines/${encodeURIComponent(engineId)}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("translation engine", r);
  const data = (await r.json()) as any;
  return data.item as TranslationEngine;
}

export async function deleteTranslationEngine(engineId: number): Promise<void> {
  const r = await fetch(`${TM_API_BASE}/translation-engines/${encodeURIComponent(engineId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete translation engine", r);
}

export type FileTypeConfig = {
  id: number;
  name: string;
  description: string;
  config: Record<string, any>;
  disabled: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FileTypePreviewResult = {
  kind: "html" | "text" | "xml";
  segments: Array<{
    id: number;
    sourceText: string;
    taggedText: string;
    location?:
      | { kind: "html"; selector: string }
      | { kind: "attr"; selector: string; attribute: string }
      | null;
    path?: string | null;
  }>;
  total: number;
  stats?: { blockMatches: number; inlineMatches: number; ignoredMatches: number } | null;
  debug?: { inlinePlaceholderCount?: number; errors: string[]; warnings: string[] } | null;
};

export async function listFileTypeConfigs(): Promise<FileTypeConfig[]> {
  const r = await fetch(`${CAT_API_BASE}/resources/file-types`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("file type configs", r);
  const data = (await r.json()) as any;
  return (data?.items || []) as FileTypeConfig[];
}

export async function listEnabledFileTypeConfigs(): Promise<FileTypeConfig[]> {
  const r = await fetch(`${CAT_API_BASE}/file-type-configs`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("file type configs", r);
  const data = (await r.json()) as any;
  return (data?.items || []) as FileTypeConfig[];
}

export async function getFileTypeConfig(configId: number): Promise<FileTypeConfig> {
  const r = await fetch(`${CAT_API_BASE}/resources/file-types/${encodeURIComponent(configId)}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("file type config", r);
  const data = (await r.json()) as any;
  return data.item as FileTypeConfig;
}

export async function createFileTypeConfig(input: {
  name: string;
  description?: string;
  config?: Record<string, any>;
  disabled?: boolean;
}): Promise<FileTypeConfig> {
  const r = await fetch(`${CAT_API_BASE}/resources/file-types`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("create file type config", r);
  const data = (await r.json()) as any;
  return data.item as FileTypeConfig;
}

export async function updateFileTypeConfig(
  configId: number,
  updates: Partial<{ name: string; description: string; config: Record<string, any>; disabled: boolean }>
): Promise<FileTypeConfig> {
  const r = await fetch(`${CAT_API_BASE}/resources/file-types/${encodeURIComponent(configId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates)
  });
  if (!r.ok) throw await httpError("update file type config", r);
  const data = (await r.json()) as any;
  return data.item as FileTypeConfig;
}

export async function deleteFileTypeConfig(configId: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/resources/file-types/${encodeURIComponent(configId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete file type config", r);
}

export async function copyFileTypeConfig(configId: number): Promise<FileTypeConfig> {
  const r = await fetch(`${CAT_API_BASE}/resources/file-types/${encodeURIComponent(configId)}/copy`, {
    method: "POST",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("copy file type config", r);
  const data = (await r.json()) as any;
  return data.item as FileTypeConfig;
}

export async function previewFileTypeConfig(configId: number, file: File): Promise<FileTypePreviewResult> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${CAT_API_BASE}/resources/file-types/${encodeURIComponent(configId)}/preview`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd
  });
  if (!r.ok) throw await httpError("preview file type config", r);
  return (await r.json()) as FileTypePreviewResult;
}

export async function previewFileTypeConfigDraft(config: Record<string, any>, file: File): Promise<FileTypePreviewResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("config", JSON.stringify(config ?? {}));
  const r = await fetch(`${CAT_API_BASE}/resources/file-types/preview`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd
  });
  if (!r.ok) throw await httpError("preview file type config", r);
  return (await r.json()) as FileTypePreviewResult;
}

export type LanguageProcessingRuleset = {
  id: number;
  name: string;
  description: string;
  rules: any[];
  disabled: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LanguageProcessingRulesetVersion = {
  id: number;
  rulesetId: number;
  version: number;
  name: string;
  description: string;
  rules: any[];
  disabled: boolean;
  summary: string | null;
  createdBy: string | null;
  createdAt: string;
};

export async function checkLanguageProcessingRulesetName(name: string, opts?: { excludeId?: number }): Promise<boolean> {
  const params = new URLSearchParams();
  if (name.trim()) params.set("name", name.trim());
  if (opts?.excludeId != null && Number.isFinite(opts.excludeId)) {
    params.set("excludeId", String(opts.excludeId));
  }
  const r = await fetch(`${CAT_API_BASE}/rules/check-name${params.toString() ? `?${params.toString()}` : ""}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("ruleset name check", r);
  const data = await r.json();
  const available = Boolean(data?.available);
  return !available;
}

export async function listLanguageProcessingRulesets(): Promise<LanguageProcessingRuleset[]> {
  const r = await fetch(`${CAT_API_BASE}/resources/language-processing-rules`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("language processing rules", r);
  const data = (await r.json()) as any;
  return (data?.items || []) as LanguageProcessingRuleset[];
}

export async function getLanguageProcessingRulesetDetails(
  rulesetId: number
): Promise<{ item: LanguageProcessingRuleset; history: LanguageProcessingRulesetVersion[] }> {
  const r = await fetch(`${CAT_API_BASE}/resources/language-processing-rules/${encodeURIComponent(rulesetId)}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("ruleset details", r);
  const data = (await r.json()) as any;
  return {
    item: data?.item as LanguageProcessingRuleset,
    history: (data?.history || []) as LanguageProcessingRulesetVersion[]
  };
}

export async function createLanguageProcessingRuleset(input: {
  name: string;
  description?: string;
  rules?: any[];
  disabled?: boolean;
  summary?: string;
}): Promise<LanguageProcessingRuleset> {
  const r = await fetch(`${CAT_API_BASE}/resources/language-processing-rules`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("create ruleset", r);
  const data = (await r.json()) as any;
  return data.item as LanguageProcessingRuleset;
}

export async function updateLanguageProcessingRuleset(
  rulesetId: number,
  updates: Partial<{ name: string; description: string; rules: any[]; disabled: boolean; summary: string }>
): Promise<LanguageProcessingRuleset> {
  const r = await fetch(`${CAT_API_BASE}/resources/language-processing-rules/${encodeURIComponent(rulesetId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates)
  });
  if (!r.ok) throw await httpError("update ruleset", r);
  const data = (await r.json()) as any;
  return data.item as LanguageProcessingRuleset;
}

export async function deleteLanguageProcessingRuleset(rulesetId: number): Promise<void> {
  const r = await fetch(`${CAT_API_BASE}/resources/language-processing-rules/${encodeURIComponent(rulesetId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete ruleset", r);
}

export async function copyLanguageProcessingRuleset(rulesetId: number): Promise<LanguageProcessingRuleset> {
  const r = await fetch(`${CAT_API_BASE}/resources/language-processing-rules/${encodeURIComponent(rulesetId)}/copy`, {
    method: "POST",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("copy ruleset", r);
  const data = (await r.json()) as any;
  return data.item as LanguageProcessingRuleset;
}

export async function testLanguageProcessingRules(params: {
  input: string;
  rulesetId?: number;
  rules?: any[];
}): Promise<{ output: string; applied: number }> {
  const r = await fetch(`${CAT_API_BASE}/resources/language-processing-rules/test`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(params)
  });
  if (!r.ok) throw await httpError("test ruleset", r);
  return (await r.json()) as { output: string; applied: number };
}

export type NmtProvider = {
  id: number;
  title: string;
  vendor: string;
  description: string;
  model: string;
  enabled: boolean;
  baseUrlMasked: string;
  apiKeyMasked: string;
  keyVersion: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listNmtProviders(): Promise<NmtProvider[]> {
  const r = await fetch(`${TM_API_BASE}/nmt-providers`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("nmt models", r);
  const data = (await r.json()) as any;
  return (data?.items || []) as NmtProvider[];
}

export async function createNmtProvider(input: {
  title: string;
  vendor: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  description?: string;
}): Promise<NmtProvider> {
  const r = await fetch(`${TM_API_BASE}/nmt-providers`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("create nmt model", r);
  const data = (await r.json()) as any;
  return data.item as NmtProvider;
}

export async function getNmtProvider(providerId: number): Promise<NmtProvider> {
  const r = await fetch(`${TM_API_BASE}/nmt-providers/${encodeURIComponent(providerId)}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("nmt provider", r);
  const data = (await r.json()) as any;
  return data.item as NmtProvider;
}

export async function deleteNmtProvider(providerId: number): Promise<void> {
  const r = await fetch(`${TM_API_BASE}/nmt-providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("delete nmt model", r);
}

export async function testNmtProviderConnection(input: {
  vendor: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<{ ok: boolean; status?: number; latencyMs?: number; error?: string }> {
  const r = await fetch(`${TM_API_BASE}/nmt-providers/test`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("test nmt provider", r);
  return (await r.json()) as { ok: boolean; status?: number; latencyMs?: number; error?: string };
}

export async function checkProjectNameAvailable(params: {
  name: string;
  projectOwnerId?: string | number;
  assignedUserId?: string | number;
}): Promise<boolean> {
  const name = String(params.name || "").trim();
  if (!name) return true;
  const qs = new URLSearchParams({ name });
  const ownerRef = params.projectOwnerId ?? params.assignedUserId;
  if (ownerRef !== undefined && ownerRef !== null) {
    const raw = String(ownerRef).trim();
    if (raw) {
      const key = params.projectOwnerId != null ? "projectOwnerId" : "assignedUserId";
      qs.set(key, raw);
    }
  }
  const r = await fetch(`${CAT_API_BASE}/projects/check-name?${qs.toString()}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("check project name", r);
  const data = (await r.json()) as any;
  return Boolean(data?.available);
}

export type CreateProjectInput = {
  idempotencyKey?: string;
  name: string;
  projectTemplateId?: number | null;
  description?: string;
  departmentId?: number;
  srcLang: string;
  tgtLang?: string;
  projectTargetLangs?: string[];
  projectOwnerId?: string | number;
  dueAt?: string | null;
  files?: Array<{
    tempKey: string;
    filename: string;
    fileTypeConfigId?: number | null;
  }>;
  translationPlan?: Array<{
    fileId?: number | null;
    tempKey?: string;
    targetLangs: string[];
    assignments: Record<
      string,
      {
        translatorUserId: string;
        reviewerUserId?: string | null;
        tmxId?: number | null;
        seedSource?: string;
        engineId?: number | null;
        rulesetId?: number | null;
        glossaryId?: number | null;
      }
    >;
  }>;
  tmSample?: string;
  tmSampleTmId?: number | null;
  glossaryId?: number | null;
  translationEngineId?: number | null;
  translationEngineDefaultsByTarget?: Record<string, number | null>;
  translationEngineOverrides?: Record<string, Record<string, number | null | "inherit">>;
  mtSeedingEnabled?: boolean;
  mtRunAfterCreate?: boolean;
  rulesEnabled?: boolean;
  termbaseEnabled?: boolean;
  glossaryEnabled?: boolean;
  rulesetId?: number | null;
  assignedUserId?: string | number;
  assignedUserRole?: string;
};

export async function createProject(
  input: CreateProjectInput
): Promise<{ project: Project; files: Array<{ tempKey: string; fileId: number }>; statusUrl?: string | null }> {
  const r = await fetch(`${CAT_API_BASE}/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("create project", r);
  const data = await r.json();
  const project = data?.project as Project | null | undefined;
  if (!project || (project as any).id == null) {
    throw new Error("Create project failed: missing projectId");
  }
  const files = Array.isArray(data?.files) ? data.files : [];
  const statusUrl = typeof data?.statusUrl === "string" ? data.statusUrl : null;
  return { project, files, statusUrl };
}

export type ProvisionStatusStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  percent: number;
  message?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
};

export type ProvisionStatusResponse = {
  status: string;
  step: string;
  currentStep?: string;
  percent: number;
  progress?: number;
  steps: ProvisionStatusStep[];
  startedAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
  lastUpdate: string | null;
  error?: string | null;
  files?: Array<{
    fileId: number;
    filename: string;
    status: string;
    segmentCount: number;
  }>;
  logs?: Array<{
    id: string;
    fileId: number;
    stage: string;
    status: string;
    message: string;
    details?: Record<string, unknown>;
    createdAt: string | null;
  }>;
};

export async function provisionProject(
  input: CreateProjectInput
): Promise<{
  projectId: number;
  status: string;
  statusUrl?: string | null;
  files: Array<{ tempKey: string; fileId: number }>;
}> {
  const r = await fetch(`${CAT_API_BASE}/projects/provision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw await httpError("provision project", r);
  const data = await r.json();
  const projectId = Number(data?.projectId);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    throw new Error("Provision project failed: missing projectId");
  }
  const files = Array.isArray(data?.files) ? data.files : [];
  const statusUrl = typeof data?.statusUrl === "string" ? data.statusUrl : null;
  return {
    projectId,
    status: String(data?.status || "provisioning"),
    statusUrl,
    files
  };
}

export async function getProjectProvisionStatus(projectId: number): Promise<ProvisionStatusResponse> {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}/provisioning`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("provision status", r);
  return (await r.json()) as ProvisionStatusResponse;
}

export async function retryProjectProvision(projectId: number): Promise<{
  projectId: number;
  status: string;
  statusUrl?: string | null;
}> {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}/provision/retry`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() }
  });
  if (!r.ok) throw await httpError("provision retry", r);
  const data = await r.json();
  return {
    projectId: Number(data?.projectId),
    status: String(data?.status || "provisioning"),
    statusUrl: typeof data?.statusUrl === "string" ? data.statusUrl : null
  };
}

export type PretranslateJobStatus = {
  id: number;
  projectId: number;
  fileId: number;
  fileName: string;
  targetLang: string;
  engineId: number | null;
  status: "pending" | "running" | "done" | "failed";
  overwriteExisting: boolean;
  retryCount: number;
  maxRetries: number;
  segmentsTotal: number;
  segmentsProcessed: number;
  segmentsSkipped: number;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type PretranslateStatusResponse = {
  summary: {
    total: number;
    pending: number;
    running: number;
    done: number;
    failed: number;
    segmentsTotal: number;
    segmentsProcessed: number;
    segmentsSkipped: number;
  };
  jobs: PretranslateJobStatus[];
};

export async function runProjectPretranslate(
  projectId: number,
  payload: {
    scope?: "all" | "file" | "language";
    fileId?: number;
    targetLang?: string;
    overwrite?: boolean;
  }
): Promise<{ queued: number; skipped: number; total: number }> {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}/pretranslate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await httpError("pretranslate", r);
  return (await r.json()) as { queued: number; skipped: number; total: number };
}

export async function getProjectPretranslateStatus(projectId: number): Promise<PretranslateStatusResponse> {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}/pretranslate/status`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw await httpError("pretranslate status", r);
  return (await r.json()) as PretranslateStatusResponse;
}

export async function assignProjectOwner(
  projectId: number,
  payload: { userId: string | number; role: string }
): Promise<Project> {
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/assign`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify(payload)
    }
  );
  if (!r.ok) throw await httpError("assign project", r);
  const data = await r.json();
  return data.project as Project;
}

export async function assignProjectOwnerToMe(
  projectId: number,
  payload?: { roleInProject?: "manager" | "reviewer" }
): Promise<Project> {
  const r = await fetch(
    `${CAT_API_BASE}/projects/${projectId}/assign-to-me`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify(payload ?? {})
    }
  );
  if (!r.ok) throw await httpError("assign project to me", r);
  const data = await r.json();
  return data.project as Project;
}

export async function getProject(
  projectId: number
): Promise<Project> {
  const r = await fetch(`${CAT_API_BASE}/projects/${projectId}`, {
    headers: { ...authHeaders() }
  });
  if (!r.ok) throw new Error(`get project ${r.status}`);
  const data = await r.json();
  return data.project as Project;
}

export async function uploadProjectFile(
  projectId: number,
  file: File,
  opts?: { fileTypeConfigId?: number | null; fileId?: number | null }
): Promise<{ fileId: number; createdSegments: number }> {
  const fileTypeConfigId =
    opts?.fileTypeConfigId != null && Number.isFinite(Number(opts.fileTypeConfigId))
      ? Number(opts.fileTypeConfigId)
      : null;
  const requestedFileId = opts?.fileId != null && Number.isFinite(Number(opts.fileId))
    ? Number(opts.fileId)
    : null;
  const presignRes = await fetch(`${CAT_API_BASE}/projects/${projectId}/files/presign`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || null,
      fileTypeConfigId,
      fileId: requestedFileId
    })
  });
  if (!presignRes.ok) throw await httpError("presign upload", presignRes);
  const presign = (await presignRes.json()) as any;

  const uploadUrl = String(presign?.uploadUrl || "");
  if (!uploadUrl) throw new Error("Upload failed: missing uploadUrl");
  const uploadHeaders = (presign?.headers || {}) as Record<string, string>;

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: uploadHeaders,
    body: file
  });
  if (!putRes.ok) {
    throw new Error(`S3 upload failed (${putRes.status})`);
  }

  const resolvedFileId = Number(presign?.fileId);
  if (!Number.isFinite(resolvedFileId) || resolvedFileId <= 0) throw new Error("Upload failed: missing fileId");

  const finalizeRes = await fetch(`${CAT_API_BASE}/projects/${projectId}/files/${resolvedFileId}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ fileTypeConfigId })
  });
  if (!finalizeRes.ok) throw await httpError("finalize upload", finalizeRes);
  const data = await finalizeRes.json();
  return {
    fileId: Number(data.fileId ?? resolvedFileId),
    createdSegments: Number(data.createdSegments ?? 0)
  };
}


