import { db } from "../db.js";
import { decryptJson, encryptJson } from "./secrets.js";

export type AppAgentConnectionProvider = "mock" | "gateway";

export type AppAgentToolName =
  | "translate_snippet"
  | "create_project"
  | "list_projects"
  | "get_project_status";

export type AppAgentConfig = {
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
  providerOrg: string | null;
  providerProject: string | null;
  providerRegion: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AppAgentGatewayConfig = AppAgentConfig & {
  providerApiKey: string | null;
};

export const APP_AGENT_TOOL_ALLOWLIST: AppAgentToolName[] = [
  "translate_snippet",
  "create_project",
  "list_projects",
  "get_project_status"
];

const APP_AGENT_TOOL_SET = new Set<AppAgentToolName>(APP_AGENT_TOOL_ALLOWLIST);
const MAX_SYSTEM_PROMPT_LENGTH = 12_000;
const MAX_MODEL_NAME_LENGTH = 200;
const MAX_ENDPOINT_LENGTH = 500;
const MAX_METADATA_LENGTH = 255;

export const DEFAULT_APP_AGENT_SYSTEM_PROMPT = [
  "You are the Fastcat App Agent.",
  "You help users translate short snippets and manage their own projects.",
  "Never perform admin-only actions or expose secrets.",
  "If project creation is requested without files, ask for at least one file first."
].join(" ");

type AppAgentConfigRow = {
  enabled: boolean;
  connection_provider: string;
  provider_id: number | null;
  model_name: string | null;
  endpoint: string | null;
  mock_mode: boolean;
  system_prompt: string | null;
  enabled_tools: unknown;
  provider_secret_enc: string | null;
  provider_api_key_masked: string | null;
  provider_org: string | null;
  provider_project: string | null;
  provider_region: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeJsonArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeEnabledTools(input: unknown): AppAgentToolName[] {
  const raw = normalizeJsonArray(input);
  const deduped = new Set<AppAgentToolName>();
  raw.forEach((entry) => {
    const tool = String(entry || "").trim() as AppAgentToolName;
    if (APP_AGENT_TOOL_SET.has(tool)) deduped.add(tool);
  });
  if (deduped.size === 0) {
    return [...APP_AGENT_TOOL_ALLOWLIST];
  }
  return Array.from(deduped);
}

function normalizeConnectionProvider(value: unknown): AppAgentConnectionProvider {
  return String(value || "").trim().toLowerCase() === "gateway" ? "gateway" : "mock";
}

function sanitizeSystemPrompt(input: unknown): string {
  const raw = String(input ?? "").replace(/\u0000/g, "").trim();
  if (!raw) return DEFAULT_APP_AGENT_SYSTEM_PROMPT;
  return raw.slice(0, MAX_SYSTEM_PROMPT_LENGTH);
}

function sanitizeModelName(input: unknown): string {
  return String(input ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_MODEL_NAME_LENGTH);
}

function sanitizeEndpoint(input: unknown): string {
  const value = String(input ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_ENDPOINT_LENGTH);
  if (!value) return "";
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return value;
  } catch {
    return "";
  }
}

function sanitizeOptionalMetadata(input: unknown): string | null {
  const value = String(input ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_METADATA_LENGTH);
  return value || null;
}

function maskApiKey(input: string): string {
  const value = String(input || "").trim();
  if (!value) return "";
  const tail = value.length >= 4 ? value.slice(-4) : value;
  return `****${tail}`;
}

function parseProviderSecretApiKey(secretEnc: string | null | undefined): string | null {
  const secret = decryptJson(secretEnc);
  if (!secret || typeof secret !== "object") return null;
  const apiKey = String((secret as any).apiKey ?? (secret as any).api_key ?? "").trim();
  return apiKey || null;
}

function rowToConfig(
  row: AppAgentConfigRow | null | undefined,
  opts?: { includeSensitive?: boolean }
): AppAgentGatewayConfig {
  const includeSensitive = Boolean(opts?.includeSensitive);

  if (!row) {
    return {
      enabled: true,
      connectionProvider: "mock",
      providerId: null,
      modelName: "",
      endpoint: "",
      mockMode: true,
      systemPrompt: DEFAULT_APP_AGENT_SYSTEM_PROMPT,
      enabledTools: [...APP_AGENT_TOOL_ALLOWLIST],
      providerApiKeyConfigured: false,
      providerApiKeyMasked: null,
      providerOrg: null,
      providerProject: null,
      providerRegion: null,
      providerApiKey: null,
      updatedBy: null,
      createdAt: null,
      updatedAt: null
    };
  }

  const providerApiKey = parseProviderSecretApiKey(row.provider_secret_enc);
  const providerApiKeyMasked =
    String(row.provider_api_key_masked || "").trim() ||
    (providerApiKey ? maskApiKey(providerApiKey) : "");

  return {
    enabled: Boolean(row.enabled),
    connectionProvider: normalizeConnectionProvider(row.connection_provider),
    providerId: row.provider_id != null ? Number(row.provider_id) : null,
    modelName: sanitizeModelName(row.model_name || ""),
    endpoint: sanitizeEndpoint(row.endpoint || ""),
    mockMode: Boolean(row.mock_mode),
    systemPrompt: sanitizeSystemPrompt(row.system_prompt || ""),
    enabledTools: normalizeEnabledTools(row.enabled_tools),
    providerApiKeyConfigured: Boolean(providerApiKey),
    providerApiKeyMasked: providerApiKeyMasked || null,
    providerOrg: sanitizeOptionalMetadata(row.provider_org),
    providerProject: sanitizeOptionalMetadata(row.provider_project),
    providerRegion: sanitizeOptionalMetadata(row.provider_region),
    providerApiKey: includeSensitive ? providerApiKey : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export async function ensureAppAgentConfigSingleton() {
  await db.query(
    `
    INSERT INTO app_agent_config(
      id,
      enabled,
      connection_provider,
      provider_id,
      model_name,
      endpoint,
      mock_mode,
      system_prompt,
      enabled_tools,
      provider_secret_enc,
      provider_api_key_masked,
      provider_org,
      provider_project,
      provider_region,
      updated_by
    )
    VALUES (
      1,
      TRUE,
      'mock',
      NULL,
      NULL,
      NULL,
      TRUE,
      $1,
      '["translate_snippet","create_project","list_projects","get_project_status"]'::jsonb,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'system'
    )
    ON CONFLICT (id) DO NOTHING;
    `,
    [DEFAULT_APP_AGENT_SYSTEM_PROMPT]
  );
}

async function loadAppAgentConfigRow(): Promise<AppAgentConfigRow | null> {
  await ensureAppAgentConfigSingleton();
  const res = await db.query<AppAgentConfigRow>(
    `SELECT
       enabled,
       connection_provider,
       provider_id,
       model_name,
       endpoint,
       mock_mode,
       system_prompt,
       enabled_tools,
       provider_secret_enc,
       provider_api_key_masked,
       provider_org,
       provider_project,
       provider_region,
       updated_by,
       created_at,
       updated_at
     FROM app_agent_config
     WHERE id = 1
     LIMIT 1`
  );
  return res.rows[0] ?? null;
}

export async function loadAppAgentConfig(): Promise<AppAgentConfig> {
  const row = await loadAppAgentConfigRow();
  const { providerApiKey: _providerApiKey, ...config } = rowToConfig(row, { includeSensitive: false });
  return config;
}

export async function loadAppAgentGatewayConfig(): Promise<AppAgentGatewayConfig> {
  const row = await loadAppAgentConfigRow();
  return rowToConfig(row, { includeSensitive: true });
}

export type AppAgentConfigUpdateInput = Partial<{
  enabled: boolean;
  connectionProvider: AppAgentConnectionProvider;
  providerId: number | null;
  modelName: string;
  endpoint: string;
  mockMode: boolean;
  systemPrompt: string;
  enabledTools: AppAgentToolName[];
  providerApiKey: string | null;
  clearProviderApiKey: boolean;
  providerOrg: string | null;
  providerProject: string | null;
  providerRegion: string | null;
}>;

type NormalizeConfigBaseInput = {
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
  providerOrg: string | null;
  providerProject: string | null;
  providerRegion: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export function normalizeUpdatedAppAgentConfig(
  previous: NormalizeConfigBaseInput,
  input: AppAgentConfigUpdateInput
): NormalizeConfigBaseInput {
  const connectionProvider = normalizeConnectionProvider(input.connectionProvider ?? previous.connectionProvider);
  const enabledTools = normalizeEnabledTools(input.enabledTools ?? previous.enabledTools);

  return {
    ...previous,
    enabled: input.enabled != null ? Boolean(input.enabled) : previous.enabled,
    connectionProvider,
    providerId:
      input.providerId === undefined
        ? previous.providerId
        : input.providerId != null && Number.isFinite(Number(input.providerId)) && Number(input.providerId) > 0
          ? Math.trunc(Number(input.providerId))
          : null,
    modelName: sanitizeModelName(input.modelName ?? previous.modelName),
    endpoint: sanitizeEndpoint(input.endpoint ?? previous.endpoint),
    mockMode: input.mockMode != null ? Boolean(input.mockMode) : previous.mockMode,
    systemPrompt: sanitizeSystemPrompt(input.systemPrompt ?? previous.systemPrompt),
    enabledTools,
    providerOrg: sanitizeOptionalMetadata(input.providerOrg ?? previous.providerOrg),
    providerProject: sanitizeOptionalMetadata(input.providerProject ?? previous.providerProject),
    providerRegion: sanitizeOptionalMetadata(input.providerRegion ?? previous.providerRegion)
  };
}

export async function updateAppAgentConfig(
  input: AppAgentConfigUpdateInput,
  actor: string
): Promise<AppAgentConfig> {
  const previousRuntime = await loadAppAgentGatewayConfig();
  const next = normalizeUpdatedAppAgentConfig(previousRuntime, input);

  const clearProviderApiKey = input.clearProviderApiKey === true || input.providerApiKey === null;
  const replacementApiKey = String(input.providerApiKey ?? "").trim();
  const nextProviderApiKey = clearProviderApiKey
    ? null
    : replacementApiKey
      ? replacementApiKey
      : previousRuntime.providerApiKey || null;

  const providerSecretEnc = nextProviderApiKey
    ? encryptJson({
        apiKey: nextProviderApiKey
      })
    : null;
  const providerApiKeyMasked = nextProviderApiKey ? maskApiKey(nextProviderApiKey) : null;

  await db.query(
    `UPDATE app_agent_config
     SET enabled = $1,
         connection_provider = $2,
         provider_id = $3,
         model_name = $4,
         endpoint = $5,
         mock_mode = $6,
         system_prompt = $7,
         enabled_tools = $8::jsonb,
         provider_secret_enc = $9,
         provider_api_key_masked = $10,
         provider_org = $11,
         provider_project = $12,
         provider_region = $13,
         updated_by = $14,
         updated_at = NOW()
     WHERE id = 1`,
    [
      next.enabled,
      next.connectionProvider,
      next.providerId,
      next.modelName || null,
      next.endpoint || null,
      next.mockMode,
      next.systemPrompt,
      JSON.stringify(next.enabledTools),
      providerSecretEnc,
      providerApiKeyMasked,
      next.providerOrg,
      next.providerProject,
      next.providerRegion,
      actor || "system"
    ]
  );
  return loadAppAgentConfig();
}
