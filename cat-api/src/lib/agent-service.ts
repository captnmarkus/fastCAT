import { randomUUID } from "crypto";
import fetch from "node-fetch";
import type { FastifyBaseLogger } from "fastify";
import { db } from "../db.js";
import { CONFIG } from "../config.js";
import { chatMetrics } from "./chat-metrics.js";
import {
  type AppAgentConfig,
  type AppAgentGatewayConfig,
  type AppAgentToolName,
  loadAppAgentConfig,
  loadAppAgentGatewayConfig
} from "./app-agent-config.js";

type ChatRole = "user" | "assistant" | "tool";

export type AgentUserContext = {
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
};

export type AgentToolCallEvent = {
  requestId: string;
  toolName: string;
  status: "started" | "succeeded" | "failed";
  message?: string;
};

export type PersistedChatMessage = {
  id: number;
  threadId: number;
  userId: number;
  role: ChatRole;
  contentText: string;
  contentJson: Record<string, unknown> | null;
  createdAt: string;
};

type AgentCallbacks = {
  onToken?: (token: string) => void;
  onToolCall?: (event: AgentToolCallEvent) => void;
};

export type AgentRunParams = {
  threadId: number;
  userMessageId: number;
  requestId: string;
  userContext: AgentUserContext;
  callbacks?: AgentCallbacks;
};

export type AgentRunResult = {
  assistantMessage: PersistedChatMessage;
};

type GatewayMessage = {
  role: ChatRole;
  contentText: string;
  contentJson: Record<string, unknown> | null;
};

type GatewayToolEvent = {
  toolName: AppAgentToolName;
  status: "started" | "succeeded" | "failed";
  message?: string;
  text?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  quickActions?: Array<{
    id: string;
    label: string;
    payload?: Record<string, unknown>;
  }>;
};

type GatewayChatResult = {
  finalText: string;
  finalJson: Record<string, unknown> | null;
  streamedTokenCount: number;
  toolEvents: GatewayToolEvent[];
};

function parseSseBlock(block: string): { event?: string; data?: string } | null {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  const lines = trimmed.split(/\r?\n/);
  let eventName: string | undefined;
  const dataParts: string[] = [];
  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trim());
    }
  });
  return {
    event: eventName,
    data: dataParts.join("\n")
  };
}

function parseGatewayToolEvent(payload: any): GatewayToolEvent | null {
  const toolName = String(payload?.toolName || "").trim() as AppAgentToolName;
  const statusRaw = String(payload?.status || "").trim().toLowerCase();
  const status =
    statusRaw === "started" || statusRaw === "succeeded" || statusRaw === "failed"
      ? statusRaw
      : null;
  if (!toolName || !status) return null;
  const input =
    payload?.input && typeof payload.input === "object" && !Array.isArray(payload.input)
      ? (payload.input as Record<string, unknown>)
      : undefined;
  const output =
    payload?.output && typeof payload.output === "object" && !Array.isArray(payload.output)
      ? (payload.output as Record<string, unknown>)
      : undefined;
  const quickActions = Array.isArray(payload?.quickActions)
    ? payload.quickActions
        .map((entry: any) => ({
          id: String(entry?.id || "").trim(),
          label: String(entry?.label || "").trim(),
          payload:
            entry?.payload && typeof entry.payload === "object" && !Array.isArray(entry.payload)
              ? (entry.payload as Record<string, unknown>)
              : undefined
        }))
        .filter((entry: any) => entry.id && entry.label)
    : [];
  return {
    toolName,
    status,
    message: payload?.message ? String(payload.message) : undefined,
    text: payload?.text ? String(payload.text) : undefined,
    input,
    output,
    quickActions
  };
}

function parseGatewayFinal(payload: any): { finalText: string; finalJson: Record<string, unknown> | null } {
  const finalText = String(payload?.contentText ?? payload?.text ?? "").trim();
  const finalJson =
    payload?.contentJson && typeof payload.contentJson === "object" && !Array.isArray(payload.contentJson)
      ? (payload.contentJson as Record<string, unknown>)
      : null;
  return { finalText, finalJson };
}

export class AgentService {
  private readonly log: FastifyBaseLogger;
  private readonly historyLimit: number;
  private readonly gatewayUrl: string;
  private readonly gatewayTimeoutMs: number;
  private readonly fallbackSystemPrompt: string;
  private appConfig: AppAgentConfig | null = null;
  private gatewayConfig: AppAgentGatewayConfig | null = null;

  constructor(params: {
    log: FastifyBaseLogger;
    historyLimit?: number;
    gatewayUrl?: string;
    gatewayTimeoutMs?: number;
    systemPrompt?: string;
  }) {
    this.log = params.log;
    this.historyLimit = Math.max(6, params.historyLimit ?? CONFIG.CHAT_MAX_HISTORY_MESSAGES);
    this.gatewayUrl = String(params.gatewayUrl || CONFIG.LLM_GATEWAY_URL).replace(/\/+$/, "");
    this.gatewayTimeoutMs = Math.max(30_000, params.gatewayTimeoutMs ?? CONFIG.APP_AGENT_GATEWAY_TIMEOUT_MS);
    this.fallbackSystemPrompt = String(params.systemPrompt || "").trim();
  }

  async init() {
    const config = await loadAppAgentConfig();
    const gatewayConfig = await loadAppAgentGatewayConfig();
    this.appConfig = this.applyFallbackSystemPrompt(config);
    this.gatewayConfig = this.applyFallbackSystemPrompt(gatewayConfig);
    this.log.info(
      {
        event: "agent_initialized",
        enabled: this.appConfig.enabled,
        connectionProvider: this.appConfig.connectionProvider,
        mockMode: this.appConfig.mockMode,
        historyLimit: this.historyLimit
      },
      "agent_initialized"
    );
  }

  async getConfig() {
    if (!this.appConfig) {
      await this.init();
    }
    return this.appConfig as AppAgentConfig;
  }

  private async getGatewayConfig() {
    if (!this.gatewayConfig) {
      await this.init();
    }
    return this.gatewayConfig as AppAgentGatewayConfig;
  }

  async reloadConfig(_config?: AppAgentConfig) {
    const loaded = await loadAppAgentConfig();
    const gatewayLoaded = await loadAppAgentGatewayConfig();
    this.appConfig = this.applyFallbackSystemPrompt(loaded);
    this.gatewayConfig = this.applyFallbackSystemPrompt(gatewayLoaded);
    this.log.info(
      {
        event: "agent_config_reloaded",
        enabled: this.appConfig.enabled,
        connectionProvider: this.appConfig.connectionProvider,
        mockMode: this.appConfig.mockMode
      },
      "agent_config_reloaded"
    );
    return this.appConfig;
  }

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const { threadId, userContext, callbacks, requestId, userMessageId } = params;
    chatMetrics.increment("chat_requests_total");

    this.log.info(
      {
        event: "chat_request_started",
        requestId,
        threadId,
        userId: userContext.userId
      },
      "chat_request_started"
    );

    await this.insertAuditEvent({
      requestId,
      userId: userContext.userId,
      threadId,
      messageId: userMessageId,
      eventType: "chat_request_started"
    });

    try {
      const gatewayConfig = await this.getGatewayConfig();
      if (!gatewayConfig.enabled) {
        const messageText = "The App Agent is currently disabled by an administrator.";
        callbacks?.onToken?.(messageText);
        const assistantMessage = await this.persistAssistantMessage({
          threadId,
          userId: userContext.userId,
          contentText: messageText,
          contentJson: null
        });
        await this.insertAuditEvent({
          requestId,
          userId: userContext.userId,
          threadId,
          messageId: assistantMessage.id,
          eventType: "chat_request_completed"
        });
        return { assistantMessage };
      }

      const history = await this.loadThreadHistory(threadId, userContext.userId);
      const gatewayResult = await this.streamGatewayChat({
        requestId,
        threadId,
        userContext,
        config: gatewayConfig,
        history,
        callbacks
      });

      for (const toolEvent of gatewayResult.toolEvents) {
        await this.persistToolOutcome({
          requestId,
          threadId,
          userId: userContext.userId,
          toolEvent
        });
      }

      const assistantText =
        gatewayResult.finalText ||
        this.fallbackAssistantSummary(gatewayResult.toolEvents) ||
        "I can help with snippet translation and your current projects.";
      if (gatewayResult.streamedTokenCount === 0 && assistantText) {
        callbacks?.onToken?.(assistantText);
      }

      const assistantMessage = await this.persistAssistantMessage({
        threadId,
        userId: userContext.userId,
        contentText: assistantText,
        contentJson: gatewayResult.finalJson
      });

      await this.insertAuditEvent({
        requestId,
        userId: userContext.userId,
        threadId,
        messageId: assistantMessage.id,
        eventType: "chat_request_completed"
      });

      this.log.info(
        {
          event: "chat_request_succeeded",
          requestId,
          threadId,
          userId: userContext.userId,
          toolEvents: gatewayResult.toolEvents.length
        },
        "chat_request_succeeded"
      );

      return { assistantMessage };
    } catch (error: any) {
      chatMetrics.increment("chat_request_errors_total");
      this.log.error(
        {
          event: "chat_request_failed",
          requestId,
          threadId,
          userId: userContext.userId,
          error: String(error?.message || error || "unknown")
        },
        "chat_request_failed"
      );
      await this.insertAuditEvent({
        requestId,
        userId: userContext.userId,
        threadId,
        eventType: "chat_request_failed",
        metadata: {
          error: String(error?.message || error || "unknown")
        }
      });
      throw error;
    }
  }

  private applyFallbackSystemPrompt<T extends { systemPrompt: string }>(config: T): T {
    if (config.systemPrompt.trim()) return config;
    if (!this.fallbackSystemPrompt) return config;
    return {
      ...config,
      systemPrompt: this.fallbackSystemPrompt
    };
  }

  private async loadThreadHistory(threadId: number, userId: number): Promise<GatewayMessage[]> {
    const res = await db.query<{
      role: ChatRole;
      content_text: string | null;
      content_json: Record<string, unknown> | null;
      created_at: string;
      id: number;
    }>(
      `SELECT id, role, content_text, content_json, created_at
       FROM chat_messages
       WHERE thread_id = $1
         AND user_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [threadId, userId, this.historyLimit]
    );
    return [...res.rows].reverse().map((row) => ({
      role: row.role,
      contentText: String(row.content_text || ""),
      contentJson: row.content_json ?? null
    }));
  }

  private async streamGatewayChat(params: {
    requestId: string;
    threadId: number;
    userContext: AgentUserContext;
    config: AppAgentGatewayConfig;
    history: GatewayMessage[];
    callbacks?: AgentCallbacks;
  }): Promise<GatewayChatResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.gatewayTimeoutMs);
    try {
      const response = await fetch(`${this.gatewayUrl}/app-agent/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": params.requestId,
          "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET
        },
        body: JSON.stringify({
          requestId: params.requestId,
          threadId: params.threadId,
          userContext: params.userContext,
          config: {
            enabled: params.config.enabled,
            connectionProvider: params.config.connectionProvider,
            providerId: params.config.providerId,
            modelName: params.config.modelName,
            endpoint: params.config.endpoint,
            mockMode: params.config.mockMode,
            systemPrompt: params.config.systemPrompt,
            enabledTools: params.config.enabledTools,
            providerApiKey: params.config.providerApiKey,
            providerOrg: params.config.providerOrg,
            providerProject: params.config.providerProject,
            providerRegion: params.config.providerRegion,
            translateMaxChars: CONFIG.CHAT_TRANSLATE_MAX_CHARS
          },
          messages: params.history,
          stream: true
        }),
        signal: controller.signal as any
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
          `App Agent gateway request failed (${response.status}): ${String(bodyText || "unknown error").slice(0, 400)}`
        );
      }

      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("text/event-stream")) {
        const payload = (await response.json().catch(() => null)) as any;
        const finalText = String(payload?.final?.contentText ?? payload?.contentText ?? "").trim();
        const finalJson =
          payload?.final?.contentJson &&
          typeof payload.final.contentJson === "object" &&
          !Array.isArray(payload.final.contentJson)
            ? (payload.final.contentJson as Record<string, unknown>)
            : null;
        return {
          finalText,
          finalJson,
          streamedTokenCount: finalText ? 1 : 0,
          toolEvents: []
        };
      }

      const bodyStream = response.body as NodeJS.ReadableStream | null;
      if (!bodyStream) {
        throw new Error("App Agent gateway stream body missing.");
      }

      let buffer = "";
      const decoder = new TextDecoder();
      let streamedTokenCount = 0;
      let finalText = "";
      let finalJson: Record<string, unknown> | null = null;
      const toolEvents: GatewayToolEvent[] = [];

      for await (const chunk of bodyStream as AsyncIterable<Buffer | string>) {
        buffer += decoder.decode(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), { stream: true });

        let separator = buffer.match(/\r?\n\r?\n/);
        while (separator && separator.index != null) {
          const splitIndex = separator.index;
          const separatorLength = separator[0].length;
          const block = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + separatorLength);

          const parsed = parseSseBlock(block);
          if (!parsed?.event) {
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
            const token = String(payload?.token || "");
            if (token) {
              streamedTokenCount += 1;
              params.callbacks?.onToken?.(token);
              finalText += token;
            }
          } else if (parsed.event === "tool_call") {
            const toolEvent = parseGatewayToolEvent(payload);
            if (toolEvent) {
              toolEvents.push(toolEvent);
              params.callbacks?.onToolCall?.({
                requestId: params.requestId,
                toolName: toolEvent.toolName,
                status: toolEvent.status,
                message: toolEvent.message
              });
            }
          } else if (parsed.event === "final") {
            const parsedFinal = parseGatewayFinal(payload);
            if (parsedFinal.finalText) {
              finalText = parsedFinal.finalText;
            }
            finalJson = parsedFinal.finalJson;
          } else if (parsed.event === "error") {
            throw new Error(String(payload?.message || "App Agent gateway returned an error."));
          }

          separator = buffer.match(/\r?\n\r?\n/);
        }
      }

      return {
        finalText: finalText.trim(),
        finalJson,
        streamedTokenCount,
        toolEvents
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private fallbackAssistantSummary(toolEvents: GatewayToolEvent[]) {
    const toolTexts = toolEvents
      .filter((event) => event.status === "succeeded")
      .map((event) => String(event.text || "").trim())
      .filter(Boolean);
    if (toolTexts.length === 0) return "";
    return toolTexts.join("\n");
  }

  private async persistToolOutcome(params: {
    requestId: string;
    threadId: number;
    userId: number;
    toolEvent: GatewayToolEvent;
  }) {
    const { requestId, threadId, userId, toolEvent } = params;

    if (toolEvent.status === "started") {
      await this.insertAuditEvent({
        requestId,
        userId,
        threadId,
        eventType: "tool_call_started",
        toolName: toolEvent.toolName
      });
      return;
    }

    chatMetrics.increment("chat_tool_calls_total");

    if (toolEvent.status === "succeeded") {
      const contentText = String(toolEvent.text || `${toolEvent.toolName} completed.`).trim();
      const outputJson = toolEvent.output ?? {};
      const quickActions = Array.isArray(toolEvent.quickActions) ? toolEvent.quickActions : [];

      const contentJson: Record<string, unknown> = {
        toolName: toolEvent.toolName,
        output: outputJson
      };
      if (quickActions.length > 0) {
        contentJson.quickActions = quickActions;
      }

      const message = await this.insertChatMessage({
        threadId,
        userId,
        role: "tool",
        contentText,
        contentJson
      });

      await db.query(
        `INSERT INTO tool_calls(message_id, thread_id, user_id, tool_name, input_json, output_json, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'succeeded')`,
        [
          message.id,
          threadId,
          userId,
          toolEvent.toolName,
          JSON.stringify(toolEvent.input ?? {}),
          JSON.stringify(outputJson)
        ]
      );
      await this.insertAuditEvent({
        requestId,
        userId,
        threadId,
        messageId: message.id,
        eventType: "tool_call_succeeded",
        toolName: toolEvent.toolName
      });
      this.log.info(
        {
          event: "tool_called",
          requestId,
          threadId,
          userId,
          toolName: toolEvent.toolName
        },
        "tool_called"
      );
      return;
    }

    await db.query(
      `INSERT INTO tool_calls(message_id, thread_id, user_id, tool_name, input_json, output_json, status)
       VALUES (NULL, $1, $2, $3, $4::jsonb, $5::jsonb, 'failed')`,
      [
        threadId,
        userId,
        toolEvent.toolName,
        JSON.stringify(toolEvent.input ?? {}),
        JSON.stringify({ error: toolEvent.message || "Tool failed" })
      ]
    );
    await this.insertAuditEvent({
      requestId,
      userId,
      threadId,
      eventType: "tool_call_failed",
      toolName: toolEvent.toolName,
      metadata: {
        error: toolEvent.message || "Tool failed"
      }
    });
    this.log.warn(
      {
        event: "tool_failed",
        requestId,
        threadId,
        userId,
        toolName: toolEvent.toolName
      },
      "tool_failed"
    );
  }

  private async insertAuditEvent(params: {
    requestId: string;
    userId: number;
    threadId: number;
    messageId?: number | null;
    eventType: string;
    toolName?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await db.query(
        `INSERT INTO chat_audit_events(request_id, user_id, thread_id, message_id, event_type, tool_name, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          params.requestId,
          params.userId,
          params.threadId,
          params.messageId ?? null,
          params.eventType,
          params.toolName ?? null,
          JSON.stringify(params.metadata ?? {})
        ]
      );
    } catch {
      // audit failures must not fail request flow
    }
  }

  private async persistAssistantMessage(params: {
    threadId: number;
    userId: number;
    contentText: string;
    contentJson: Record<string, unknown> | null;
  }): Promise<PersistedChatMessage> {
    const message = await this.insertChatMessage({
      threadId: params.threadId,
      userId: params.userId,
      role: "assistant",
      contentText: params.contentText,
      contentJson: params.contentJson
    });
    await db.query("UPDATE chat_threads SET updated_at = NOW() WHERE id = $1 AND user_id = $2", [
      params.threadId,
      params.userId
    ]);
    return message;
  }

  private async insertChatMessage(params: {
    threadId: number;
    userId: number;
    role: ChatRole;
    contentText: string;
    contentJson: Record<string, unknown> | null;
  }): Promise<PersistedChatMessage> {
    const res = await db.query<{
      id: number;
      thread_id: number;
      user_id: number;
      role: ChatRole;
      content_text: string | null;
      content_json: Record<string, unknown> | null;
      created_at: string;
    }>(
      `INSERT INTO chat_messages(thread_id, user_id, role, content_text, content_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, thread_id, user_id, role, content_text, content_json, created_at`,
      [
        params.threadId,
        params.userId,
        params.role,
        params.contentText || "",
        params.contentJson ? JSON.stringify(params.contentJson) : null
      ]
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error("Failed to persist chat message.");
    }
    return {
      id: Number(row.id),
      threadId: Number(row.thread_id),
      userId: Number(row.user_id),
      role: row.role,
      contentText: String(row.content_text || ""),
      contentJson: row.content_json ?? null,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  buildInternalToolAuthHeaders(traceId?: string) {
    const headers: Record<string, string> = {
      "x-app-agent-secret": CONFIG.APP_AGENT_INTERNAL_SECRET
    };
    if (traceId) headers["x-request-id"] = traceId;
    return headers;
  }

  makeInternalToolRequestId() {
    return randomUUID();
  }
}
