import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  APP_AGENT_TOOL_ALLOWLIST,
  type AppAgentConfigUpdateInput,
  evaluateAppAgentAvailability,
  loadAppAgentConfig,
  normalizeUpdatedAppAgentConfig,
  updateAppAgentConfig
} from "../lib/app-agent-config.js";
import { getRequestUser, requireAdmin, requireAuth, requestUserId } from "../middleware/auth.js";
import { registerAppAgentCreateProjectRoute } from "./app-agent.create-project.js";
import { registerAppAgentInternalToolRoutes } from "./app-agent.internal-tools.js";
import type { AppAgentRoutesOptions } from "./app-agent.shared.js";

export const appAgentRoutes: FastifyPluginAsync<AppAgentRoutesOptions> = async (app, opts) => {
  app.get("/admin/app-agent/config", { preHandler: [requireAdmin] }, async () => {
    const config = await opts.agentService.getConfig();
    const availability = await evaluateAppAgentAvailability(config);
    const providerRes = await db.query<{
      id: number;
      name: string;
      model: string | null;
      enabled: boolean;
    }>(
      `SELECT id, name, model, enabled
       FROM nmt_providers
       ORDER BY LOWER(name) ASC, id ASC`
    );

    return {
      config: {
        ...config,
        applyMode: "hot_reload"
      },
      availability,
      providers: providerRes.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name || ""),
        model: row.model ? String(row.model) : "",
        enabled: Boolean(row.enabled)
      })),
      allowlistedTools: APP_AGENT_TOOL_ALLOWLIST
    };
  });

  app.put("/admin/app-agent/config", { preHandler: [requireAdmin] }, async (req: any, reply) => {
    const body = (req.body as AppAgentConfigUpdateInput) || {};
    const current = await loadAppAgentConfig();
    const next = normalizeUpdatedAppAgentConfig(current, body);

    if (Object.prototype.hasOwnProperty.call(body, "endpoint")) {
      const endpointRaw = String(body.endpoint ?? "").trim();
      if (endpointRaw) {
        try {
          new URL(endpointRaw);
        } catch {
          return reply.code(400).send({ error: "endpoint must be a valid URL." });
        }
      }
    }

    if (next.providerId != null) {
      const providerRes = await db.query<{ id: number; enabled: boolean }>(
        `SELECT id, enabled
         FROM nmt_providers
         WHERE id = $1
         LIMIT 1`,
        [next.providerId]
      );
      const provider = providerRes.rows[0];
      if (!provider) {
        return reply.code(400).send({ error: "Selected providerId was not found." });
      }
      if (!provider.enabled) {
        return reply.code(400).send({ error: "Selected provider is disabled." });
      }
    }

    const actor = requestUserId(getRequestUser(req)) || "admin";
    const updated = await updateAppAgentConfig(body, actor);
    await opts.agentService.reloadConfig(updated);
    const availability = await evaluateAppAgentAvailability(updated);

    return {
      config: {
        ...updated,
        applyMode: "hot_reload"
      },
      availability
    };
  });

  app.get("/app-agent/status", { preHandler: [requireAuth] }, async () => {
    const config = await opts.agentService.getConfig();
    const availability = await evaluateAppAgentAvailability(config);
    return {
      enabled: config.enabled,
      connectionProvider: config.connectionProvider,
      mockMode: config.mockMode,
      availability
    };
  });

  await registerAppAgentCreateProjectRoute(app);
  await registerAppAgentInternalToolRoutes(app);
};
