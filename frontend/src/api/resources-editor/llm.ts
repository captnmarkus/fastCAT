import { CAT_API_BASE, LLM_API_BASE, authHeaders, type ChatMessage } from "./shared";

export async function requestLLMCompletion(params: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}) {
  const payload: Record<string, any> = {
    messages: params.messages,
    temperature: params.temperature ?? 0.3,
    max_tokens: params.max_tokens
  };
  if (params.model) payload.model = params.model;

  const response = await fetch(`${LLM_API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`llm gateway ${response.status}`);
  return response.json();
}

export async function requestSegmentLLM(params: {
  segmentId: number;
  messages?: ChatMessage[];
  model?: string;
  provider?: string;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${CAT_API_BASE}/segments/${params.segmentId}/llm`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      messages: params.messages,
      model: params.model,
      provider: params.provider
    }),
    signal: params.signal
  });
  if (!response.ok) throw new Error(`llm proxy ${response.status}`);
  return response.json();
}
