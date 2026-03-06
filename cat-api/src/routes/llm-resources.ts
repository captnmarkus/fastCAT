import { FastifyInstance } from "fastify";
import fetch from "node-fetch";
import { db } from "../db.js";
import { CONFIG } from "../config.js";
import { maskApiKey as maskApiKeyValue, maskBaseUrl as maskBaseUrlValue } from "../lib/masking.js";
import { requireManagerOrAdmin, getRequestUser, requestUserId } from "../middleware/auth.js";
import { encryptJson } from "../lib/secrets.js";

type ProviderVendor = "openai-compatible";

function normalizeVendor(input: any): ProviderVendor | null {
  const v = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (v === "openai-compatible") return v;
  return null;
}

function isBlank(value: any) {
  return String(value ?? "").trim().length === 0;
}

function maskApiKey(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  const last4 = v.length >= 4 ? v.slice(-4) : "";
  const prefix = v.startsWith("sk-") ? "sk-" : "";
  return `${prefix}••••${last4 || "••••"}`;
}

function maskBaseUrl(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  try {
    const url = new URL(v);
    const host = url.host;
    if (!host) return "stored";
    return `${url.protocol}//${host}/…`;
  } catch {
    return "stored";
  }
}

type ProviderRow = {
  id: number;
  name: string;
  provider: string;
  description: string | null;
  model: string | null;
  enabled: boolean;
  secret_enc: string | null;
  secret_key_version: number | null;
  base_url_masked: string | null;
  api_key_masked: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function rowToProvider(row: ProviderRow) {
  return {
    id: Number(row.id),
    title: String(row.name || ""),
    vendor: String(row.provider || ""),
    description: row.description ? String(row.description) : "",
    model: String(row.model || ""),
    enabled: Boolean(row.enabled),
    baseUrlMasked: row.base_url_masked ? String(row.base_url_masked) : row.secret_enc ? "stored" : "",
    apiKeyMasked: row.api_key_masked ? String(row.api_key_masked) : "",
    keyVersion: row.secret_key_version != null ? Number(row.secret_key_version) : 1,
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

type EngineRow = {
  id: number;
  name: string;
  description: string | null;
  disabled: boolean;
  llm_provider_id: number | null;
  system_prompt: string | null;
  user_prompt_template: string | null;
  temperature: number | null;
  max_tokens: number | null;
  top_p: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  llm_provider_name?: string | null;
  llm_provider_vendor?: string | null;
  llm_provider_model?: string | null;
};

function rowToEngineListItem(row: EngineRow) {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    description: row.description ? String(row.description) : "",
    disabled: Boolean(row.disabled),
    llmProviderId: row.llm_provider_id != null ? Number(row.llm_provider_id) : null,
    llmProviderName: row.llm_provider_name ? String(row.llm_provider_name) : null,
    llmProviderVendor: row.llm_provider_vendor ? String(row.llm_provider_vendor) : null,
    llmProviderModel: row.llm_provider_model ? String(row.llm_provider_model) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function rowToEngineDetail(row: EngineRow) {
  return {
    ...rowToEngineListItem(row),
    systemPrompt: row.system_prompt ? String(row.system_prompt) : "",
    userPromptTemplate: row.user_prompt_template ? String(row.user_prompt_template) : "",
    generation: {
      temperature: row.temperature != null ? Number(row.temperature) : null,
      maxTokens: row.max_tokens != null ? Number(row.max_tokens) : null,
      topP: row.top_p != null ? Number(row.top_p) : null
    }
  };
}

export async function llmResourcesRoutes(app: FastifyInstance) {
  // --- NMT/LLM Providers ---
  app.get("/api/nmt-providers", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query<ProviderRow>(
      `SELECT *
       FROM nmt_providers
       ORDER BY updated_at DESC, id DESC`
    );
    return { items: res.rows.map(rowToProvider) };
  });

  app.get("/api/nmt-providers/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid provider id" });
    const res = await db.query<ProviderRow>("SELECT * FROM nmt_providers WHERE id = $1", [id]);
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Not found" });
    return { item: rowToProvider(row) };
  });

  app.post("/api/nmt-providers", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const body = (req.body as any) || {};
    const title = String(body.title || body.name || "").trim();
    const vendor = normalizeVendor(body.vendor ?? body.provider);
    const baseUrl = String(body.baseUrl ?? body.base_url ?? "").trim();
    const apiKey = String(body.apiKey ?? body.api_key ?? "").trim();
    const model = String(body.model || "").trim();
    const description = String(body.description || "").trim();

    if (!title) return reply.code(400).send({ error: "title is required" });
    if (!vendor) return reply.code(400).send({ error: "vendor is required" });
    if (!baseUrl) return reply.code(400).send({ error: "baseUrl is required" });
    if (!model) return reply.code(400).send({ error: "model is required" });

    // Validate base URL without leaking it.
    try {
      // eslint-disable-next-line no-new
      new URL(baseUrl);
    } catch {
      return reply.code(400).send({ error: "Invalid baseUrl" });
    }

    const secretEnc = encryptJson({ baseUrl, ...(apiKey ? { apiKey } : {}) });
    const baseUrlMasked = maskBaseUrlValue(baseUrl);
    const apiKeyMasked = apiKey ? maskApiKeyValue(apiKey) : null;

    try {
      const insertRes = await db.query<ProviderRow>(
        `INSERT INTO nmt_providers(
           name,
           provider,
           description,
           model,
           enabled,
           config,
           secret_enc,
           secret_key_version,
           base_url_masked,
           api_key_masked,
           created_by,
           updated_by,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, TRUE, '{}'::jsonb, $5, 1, $6, $7, $8, $8, NOW(), NOW())
         RETURNING *`,
         [title, vendor, description || null, model, secretEnc, baseUrlMasked, apiKeyMasked, userId]
      );
      const row = insertRes.rows[0];
      return { item: row ? rowToProvider(row) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A provider with this title already exists." });
      }
      throw err;
    }
  });

  app.delete("/api/nmt-providers/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid provider id" });
    try {
      const res = await db.query("DELETE FROM nmt_providers WHERE id = $1 RETURNING id", [id]);
      if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    } catch (err: any) {
      if (err?.code === "23503") {
        return reply.code(409).send({ error: "Provider is in use and cannot be deleted." });
      }
      throw err;
    }
  });

  app.post("/api/nmt-providers/test", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const body = (req.body as any) || {};
    const vendor = normalizeVendor(body.vendor ?? body.provider);
    const baseUrl = String(body.baseUrl ?? body.base_url ?? "").trim();
    const apiKey = String(body.apiKey ?? body.api_key ?? "").trim();
    const model = String(body.model || "").trim();

    if (!vendor) return reply.code(400).send({ error: "vendor is required" });
    if (!baseUrl) return reply.code(400).send({ error: "baseUrl is required" });
    if (!model) return reply.code(400).send({ error: "model is required" });

    const start = Date.now();
    try {
      const traceId = (req.headers["x-request-id"] as string | undefined) ?? req.id;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-llm-base-url": baseUrl
      };
      if (apiKey) headers["x-llm-api-key"] = apiKey;
      if (traceId) headers["x-request-id"] = traceId;

      const res = await fetch(`${CONFIG.LLM_GATEWAY_URL}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Connectivity test." },
            { role: "user", content: "Reply with: OK" }
          ],
          temperature: 0,
          max_tokens: 8
        })
      });
      const ms = Date.now() - start;
      if (!res.ok) {
        let msg = "Connection failed";
        try {
          const data: any = await res.json();
          msg = String(data?.error || data?.message || msg);
        } catch {
          /* ignore */
        }
        return reply.code(502).send({ ok: false, error: msg, status: res.status, latencyMs: ms });
      }
      return { ok: true, status: res.status, latencyMs: ms };
    } catch (err: any) {
      const ms = Date.now() - start;
      const msg = err?.message ? String(err.message) : "Connection failed";
      return reply.code(502).send({ ok: false, error: msg, latencyMs: ms });
    }
  });

  // --- Translation Engines ---
  app.get("/api/translation-engines", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query<EngineRow>(
      `SELECT te.id,
              te.name,
              te.description,
              te.disabled,
              te.llm_provider_id,
              te.created_by,
              te.updated_by,
              te.created_at,
              te.updated_at,
              np.name AS llm_provider_name,
              np.provider AS llm_provider_vendor,
              np.model AS llm_provider_model
       FROM translation_engines te
       LEFT JOIN nmt_providers np ON np.id = te.llm_provider_id
       ORDER BY te.updated_at DESC, te.id DESC`
    );
    return { items: res.rows.map(rowToEngineListItem) };
  });

  app.get("/api/translation-engines/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid engine id" });
    const res = await db.query<EngineRow>(
      `SELECT te.*,
              np.name AS llm_provider_name,
              np.provider AS llm_provider_vendor,
              np.model AS llm_provider_model
       FROM translation_engines te
       LEFT JOIN nmt_providers np ON np.id = te.llm_provider_id
       WHERE te.id = $1
       LIMIT 1`,
      [id]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: "Not found" });
    return { item: rowToEngineDetail(row) };
  });

  app.post("/api/translation-engines", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const userId = requestUserId(getRequestUser(req));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const body = (req.body as any) || {};
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const disabled = Boolean(body.disabled);
    const llmProviderIdRaw = body.llmProviderId ?? body.llm_provider_id ?? null;
    const llmProviderId = Number(llmProviderIdRaw);
    const systemPrompt = String(body.systemPrompt ?? body.system_prompt ?? "").trimEnd();
    const userPromptTemplate = String(body.userPromptTemplate ?? body.user_prompt_template ?? "").trimEnd();
    const temperature =
      body.temperature !== undefined && body.temperature !== null && body.temperature !== ""
        ? Number(body.temperature)
        : null;
    const maxTokens =
      body.maxTokens !== undefined && body.maxTokens !== null && body.maxTokens !== ""
        ? Number(body.maxTokens)
        : null;
    const topP =
      body.topP !== undefined && body.topP !== null && body.topP !== ""
        ? Number(body.topP)
        : null;

    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!Number.isFinite(llmProviderId) || llmProviderId <= 0) {
      return reply.code(400).send({ error: "llmProviderId is required" });
    }
    if (isBlank(systemPrompt)) return reply.code(400).send({ error: "systemPrompt is required" });
    if (isBlank(userPromptTemplate)) return reply.code(400).send({ error: "userPromptTemplate is required" });

    if (temperature != null && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
      return reply.code(400).send({ error: "temperature must be between 0 and 2" });
    }
    if (maxTokens != null && (!Number.isFinite(maxTokens) || maxTokens < 1 || maxTokens > 32000)) {
      return reply.code(400).send({ error: "maxTokens must be a positive integer" });
    }
    if (topP != null && (!Number.isFinite(topP) || topP < 0 || topP > 1)) {
      return reply.code(400).send({ error: "topP must be between 0 and 1" });
    }

    const providerRes = await db.query<ProviderRow>("SELECT * FROM nmt_providers WHERE id = $1 LIMIT 1", [llmProviderId]);
    const providerRow = providerRes.rows[0];
    if (!providerRow) return reply.code(400).send({ error: "Selected LLM provider not found." });
    if (!providerRow.secret_enc) return reply.code(400).send({ error: "Selected LLM provider is missing credentials." });

    try {
      const insertRes = await db.query<EngineRow>(
        `INSERT INTO translation_engines(
           name,
           description,
           config,
           disabled,
           llm_provider_id,
           system_prompt,
           user_prompt_template,
           temperature,
           max_tokens,
           top_p,
           created_by,
           updated_by,
           created_at,
           updated_at
         )
         VALUES ($1, $2, '{}'::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $10, NOW(), NOW())
         RETURNING *`,
        [
          name,
          description || null,
          disabled,
          llmProviderId,
          systemPrompt,
          userPromptTemplate,
          temperature,
          maxTokens,
          topP,
          userId
        ]
      );
      const row = insertRes.rows[0];
      return { item: row ? rowToEngineDetail({ ...row, llm_provider_name: providerRow.name, llm_provider_vendor: providerRow.provider, llm_provider_model: providerRow.model } as any) : null };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "A translation engine with this name already exists." });
      }
      throw err;
    }
  });

  app.delete("/api/translation-engines/:id", { preHandler: [requireManagerOrAdmin] }, async (req: any, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid engine id" });
    try {
      const res = await db.query("DELETE FROM translation_engines WHERE id = $1 RETURNING id", [id]);
      if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    } catch (err: any) {
      if (err?.code === "23503") {
        return reply.code(409).send({ error: "Engine is in use and cannot be deleted." });
      }
      throw err;
    }
  });
}
