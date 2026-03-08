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

export type AppAgentAvailabilityState =
  | "ready_live"
  | "ready_mock"
  | "needs_configuration"
  | "disabled";

export type AppAgentAvailability = {
  state: AppAgentAvailabilityState;
  enabled: boolean;
  usable: boolean;
  live: boolean;
  mock: boolean;
  needsAdminConfiguration: boolean;
  title: string;
  description: string;
  providerLabel: string | null;
  usingEndpointOverride: boolean;
  usingDefaultProvider: boolean;
  missing: string[];
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

type AppAgentProviderRow = {
  id: number;
  name: string;
  provider: string | null;
  model: string | null;
  enabled: boolean;
  secret_enc: string | null;
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

function parseProviderSecretBaseUrl(secretEnc: string | null | undefined): string | null {
  const secret = decryptJson(secretEnc);
  if (!secret || typeof secret !== "object") return null;
  const baseUrl = String((secret as any).baseUrl ?? (secret as any).base_url ?? "").trim();
  return baseUrl || null;
}

function rowToConfig(
  row: AppAgentConfigRow | null | undefined,
  opts?: { includeSensitive?: boolean }
): AppAgentGatewayConfig {
  const includeSensitive = Boolean(opts?.includeSensitive);

  if (!row) {
    return {
      enabled: true,
      connectionProvider: "gateway",
      providerId: null,
      modelName: "",
      endpoint: "",
      mockMode: false,
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
      'gateway',
      NULL,
      NULL,
      NULL,
      FALSE,
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

async function loadAppAgentProviderRow(providerId: number): Promise<AppAgentProviderRow | null> {
  const res = await db.query<AppAgentProviderRow>(
    `SELECT id, name, provider, model, enabled, secret_enc
     FROM nmt_providers
     WHERE id = $1
     LIMIT 1`,
    [providerId]
  );
  return res.rows[0] ?? null;
}

async function loadDefaultAppAgentProviderRow(): Promise<AppAgentProviderRow | null> {
  const res = await db.query<AppAgentProviderRow>(
    `SELECT id, name, provider, model, enabled, secret_enc
     FROM nmt_providers
     WHERE enabled = TRUE
       AND LOWER(COALESCE(provider, '')) = 'openai-compatible'
     ORDER BY id ASC
     LIMIT 1`
  );
  return res.rows[0] ?? null;
}

function providerUsability(
  providerRow: AppAgentProviderRow | null | undefined,
  configModelName: string
): { usable: boolean; missing: string[]; providerLabel: string | null } {
  if (!providerRow) {
    return {
      usable: false,
      missing: ["provider"],
      providerLabel: null
    };
  }

  const missing: string[] = [];
  const providerLabel = String(providerRow.name || "").trim() || `Provider #${providerRow.id}`;
  const vendor = String(providerRow.provider || "").trim().toLowerCase();
  const baseUrl = parseProviderSecretBaseUrl(providerRow.secret_enc);
  const resolvedModel = String(configModelName || "").trim() || String(providerRow.model || "").trim();

  if (!providerRow.enabled) missing.push("provider_enabled");
  if (vendor !== "openai-compatible") missing.push("provider_vendor");
  if (!baseUrl) missing.push("provider_base_url");
  if (!resolvedModel) missing.push("model");

  return {
    usable: missing.length === 0,
    missing,
    providerLabel
  };
}

export async function evaluateAppAgentAvailability(
  configInput?: AppAgentConfig
): Promise<AppAgentAvailability> {
  const config = configInput ?? (await loadAppAgentConfig());
  const liveConfigured = config.connectionProvider === "gateway" && !config.mockMode;

  if (!config.enabled) {
    return {
      state: "disabled",
      enabled: false,
      usable: false,
      live: false,
      mock: false,
      needsAdminConfiguration: true,
      title: "App Agent is turned off",
      description: "An administrator has disabled the app-wide assistant. Enable it again in the admin panel to use chat here.",
      providerLabel: null,
      usingEndpointOverride: false,
      usingDefaultProvider: false,
      missing: ["enabled"]
    };
  }

  if (!liveConfigured) {
    return {
      state: "ready_mock",
      enabled: true,
      usable: true,
      live: false,
      mock: true,
      needsAdminConfiguration: false,
      title: "App Agent is available",
      description: "The assistant is running in mock mode. You can still chat here, but responses are deterministic rather than powered by a live provider.",
      providerLabel: null,
      usingEndpointOverride: false,
      usingDefaultProvider: false,
      missing: []
    };
  }

  const endpointOverride = String(config.endpoint || "").trim();
  if (endpointOverride) {
    const missing: string[] = [];
    if (!String(config.modelName || "").trim()) {
      missing.push("model");
    }
    const usable = missing.length === 0;
    return {
      state: usable ? "ready_live" : "needs_configuration",
      enabled: true,
      usable,
      live: usable,
      mock: false,
      needsAdminConfiguration: !usable,
      title: usable ? "App Agent is ready" : "App Agent setup still needs one more step",
      description: usable
        ? "The assistant is configured with a live endpoint and is ready to chat."
        : "A custom endpoint is configured, but the model name is still missing. Finish the App Agent setup in the admin panel.",
      providerLabel: endpointOverride,
      usingEndpointOverride: true,
      usingDefaultProvider: false,
      missing
    };
  }

  const selectedProvider =
    config.providerId != null && Number.isFinite(config.providerId) && config.providerId > 0
      ? await loadAppAgentProviderRow(config.providerId)
      : await loadDefaultAppAgentProviderRow();
  const providerStatus = providerUsability(selectedProvider, config.modelName);
  const usingDefaultProvider =
    config.providerId == null && selectedProvider != null;

  if (providerStatus.usable) {
    return {
      state: "ready_live",
      enabled: true,
      usable: true,
      live: true,
      mock: false,
      needsAdminConfiguration: false,
      title: "App Agent is ready",
      description: usingDefaultProvider
        ? "The assistant is using the default live provider and is ready to chat."
        : "The assistant is configured with a live provider and is ready to chat.",
      providerLabel: providerStatus.providerLabel,
      usingEndpointOverride: false,
      usingDefaultProvider,
      missing: []
    };
  }

  let description =
    "The assistant still needs a usable live provider before chat can start. Finish the App Agent setup in the admin panel.";
  if (providerStatus.missing.includes("provider")) {
    description =
      "No usable live provider is configured for the assistant yet. Finish the App Agent setup in the admin panel.";
  } else if (providerStatus.missing.includes("provider_enabled")) {
    description =
      "The selected provider is disabled. Re-enable it or choose another provider in the App Agent admin panel.";
  } else if (providerStatus.missing.includes("provider_vendor")) {
    description =
      "The selected provider type is not supported by the App Agent yet. Choose an OpenAI-compatible provider or use a custom endpoint.";
  } else if (providerStatus.missing.includes("provider_base_url")) {
    description =
      "The selected provider is missing its base URL. Update the provider or switch to a custom endpoint in the App Agent admin panel.";
  } else if (providerStatus.missing.includes("model")) {
    description =
      "The assistant still needs a model before chat can start. Finish the App Agent setup in the admin panel.";
  }

  return {
    state: "needs_configuration",
    enabled: true,
    usable: false,
    live: false,
    mock: false,
    needsAdminConfiguration: true,
    title: "App Agent setup still needs one more step",
    description,
    providerLabel: providerStatus.providerLabel,
    usingEndpointOverride: false,
    usingDefaultProvider,
    missing: providerStatus.missing
  };
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
