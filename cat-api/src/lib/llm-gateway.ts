import fetch from "node-fetch";
import { db } from "../db.js";
import { CONFIG } from "../config.js";

export type GatewayToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type GatewayChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type GatewayResponseMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

export type ResolvedGatewayProvider = {
  id: number;
  model: string;
};

function appendToolCallDelta(target: GatewayResponseMessage, delta: any) {
  if (!Array.isArray(delta)) return;
  if (!Array.isArray(target.tool_calls)) target.tool_calls = [];

  delta.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const indexRaw = Number((entry as any).index);
    const index = Number.isFinite(indexRaw) && indexRaw >= 0 ? Math.trunc(indexRaw) : target.tool_calls!.length;
    while (target.tool_calls!.length <= index) {
      target.tool_calls!.push({
        id: "",
        type: "function",
        function: {
          name: "",
          arguments: ""
        }
      });
    }

    const current = target.tool_calls![index] || {
      id: "",
      type: "function",
      function: {
        name: "",
        arguments: ""
      }
    };

    const fn = (entry as any).function || {};
    const nextFn = {
      name: `${String(current.function?.name || "")}${String(fn.name || "")}`,
      arguments: `${String(current.function?.arguments || "")}${String(fn.arguments || "")}`
    };

    target.tool_calls![index] = {
      id: String((entry as any).id || current.id || ""),
      type: "function",
      function: nextFn
    };
  });
}

function mergeFinalMessage(target: GatewayResponseMessage, message: any) {
  if (!message || typeof message !== "object") return;
  if (message.role && !target.role) target.role = String(message.role);

  if (message.content !== undefined) {
    if (typeof message.content === "string") {
      target.content = `${String(target.content || "")}${message.content}`;
    } else if (target.content === undefined) {
      target.content = message.content;
    }
  }

  if (Array.isArray(message.tool_calls)) {
    if (!Array.isArray(target.tool_calls)) target.tool_calls = [];
    message.tool_calls.forEach((call: any, index: number) => {
      const current = target.tool_calls![index] || {
        id: "",
        type: "function",
        function: {
          name: "",
          arguments: ""
        }
      };
      target.tool_calls![index] = {
        id: String(call?.id || current.id || ""),
        type: "function",
        function: {
          name: String(call?.function?.name || current.function?.name || ""),
          arguments: String(call?.function?.arguments || current.function?.arguments || "")
        }
      };
    });
  }
}

function parseSseDataBlock(block: string) {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith(":")) return [];
  const lines = trimmed.split(/\r?\n/);
  return lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
}

async function parseStreamedGatewayResponse(
  response: any,
  onToken?: (token: string) => void
): Promise<GatewayResponseMessage | null> {
  const stream = response?.body;
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
    return null;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const message: GatewayResponseMessage = {
    role: "assistant",
    content: ""
  };

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });

    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator && separator.index != null) {
      const splitIndex = separator.index;
      const separatorLength = separator[0].length;
      const block = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + separatorLength);

      const dataLines = parseSseDataBlock(block);
      for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") continue;
        let payload: any;
        try {
          payload = JSON.parse(dataLine);
        } catch {
          continue;
        }

        const choice = payload?.choices?.[0];
        if (!choice || typeof choice !== "object") continue;

        const delta = choice.delta;
        if (delta && typeof delta === "object") {
          if (delta.role && !message.role) {
            message.role = String(delta.role);
          }

          if (typeof delta.content === "string" && delta.content.length > 0) {
            message.content = `${String(message.content || "")}${delta.content}`;
            onToken?.(delta.content);
          } else if (Array.isArray(delta.content)) {
            const joined = delta.content
              .map((entry: any) => (typeof entry?.text === "string" ? entry.text : ""))
              .join("");
            if (joined) {
              message.content = `${String(message.content || "")}${joined}`;
              onToken?.(joined);
            }
          }

          appendToolCallDelta(message, delta.tool_calls);
        }

        if (choice.message) {
          mergeFinalMessage(message, choice.message);
        }
      }

      separator = buffer.match(/\r?\n\r?\n/);
    }
  }

  const hasContent = Boolean(normalizeGatewayMessageContent(message.content));
  const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return hasContent || hasToolCalls ? message : null;
}

export function normalizeGatewayMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        return typeof (part as any).text === "string" ? (part as any).text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export async function resolveEnabledGatewayProvider(
  preferredProviderId: number | null = CONFIG.CHAT_LLM_PROVIDER_ID
): Promise<ResolvedGatewayProvider | null> {
  if (preferredProviderId != null && Number.isFinite(preferredProviderId) && preferredProviderId > 0) {
    const preferredRes = await db.query<{ id: number; model: string | null }>(
      `SELECT id, model
       FROM nmt_providers
       WHERE id = $1
         AND enabled = TRUE
         AND secret_enc IS NOT NULL
       LIMIT 1`,
      [preferredProviderId]
    );
    const preferredRow = preferredRes.rows[0];
    if (preferredRow?.model) {
      return { id: Number(preferredRow.id), model: String(preferredRow.model) };
    }
  }

  const res = await db.query<{ id: number; model: string | null }>(
    `SELECT id, model
     FROM nmt_providers
     WHERE enabled = TRUE
       AND secret_enc IS NOT NULL
     ORDER BY id ASC
     LIMIT 1`
  );
  const row = res.rows[0];
  if (!row || !row.model) return null;
  return {
    id: Number(row.id),
    model: String(row.model)
  };
}

export async function callGatewayChatCompletion(params: {
  provider: ResolvedGatewayProvider;
  messages: GatewayChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: GatewayToolDefinition[];
  toolChoice?: "auto" | "none";
  traceId?: string;
  stream?: boolean;
  onToken?: (token: string) => void;
}): Promise<GatewayResponseMessage | null> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-llm-provider-id": String(params.provider.id)
  };
  if (params.traceId) headers["x-request-id"] = params.traceId;

  const body: Record<string, unknown> = {
    model: params.provider.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 900
  };
  if (Array.isArray(params.tools) && params.tools.length > 0) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice ?? "auto";
  }
  if (params.stream) {
    body.stream = true;
  }

  const response = await fetch(`${CONFIG.LLM_GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    return null;
  }

  if (params.stream) {
    return parseStreamedGatewayResponse(response, params.onToken);
  }

  const payload = (await response.json()) as any;
  const message = payload?.choices?.[0]?.message;
  if (!message || typeof message !== "object") return null;
  return message as GatewayResponseMessage;
}
