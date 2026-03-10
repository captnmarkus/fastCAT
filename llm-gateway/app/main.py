import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse, urlunparse

import asyncpg
import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

LOG = logging.getLogger("llm-gateway")

_LOG_LEVELS: dict[str, int] = {
  "CRITICAL": logging.CRITICAL,
  "FATAL": logging.FATAL,
  "ERROR": logging.ERROR,
  "WARN": logging.WARN,
  "WARNING": logging.WARNING,
  "INFO": logging.INFO,
  "DEBUG": logging.DEBUG,
  "NOTSET": logging.NOTSET,
}


def _env(name: str, default: str | None = None) -> str | None:
  value = os.getenv(name)
  if value is None:
    return default
  value = value.strip()
  return value if value else default


def _env_int(name: str, default: int) -> int:
  raw = _env(name)
  if raw is None:
    return default
  try:
    return int(raw)
  except ValueError:
    return default


def _boolish_off(value: str | None) -> bool:
  if value is None:
    return False
  return value.strip().lower() in {"off", "none", "false", "0", "no"}


def _log_level_from_env(default: int = logging.INFO) -> int:
  raw = _env("LOG_LEVEL")
  if raw is None:
    return default
  raw = raw.strip()
  if not raw:
    return default
  if raw.isdigit():
    return int(raw)
  return _LOG_LEVELS.get(raw.upper(), default)


DB_URL = (
  _env("LLM_DB_URL")
  or _env("CAT_DB_URL")
  or _env("TM_DB_URL")
  or _env("DATABASE_URL")
  or "postgresql://tmlite:tmlitepass@localhost:5432/tmlite"
)

SECRETS_KEY = (
  _env("LLM_SECRETS_KEY")
  or _env("CAT_SECRETS_KEY")
  or _env("CAT_SECRET_KEY")
  or _env("SECRETS_KEY")
  or _env("JWT_SECRET")
  or "fastcat-dev-secrets-key"
)

PORT = _env_int("LLM_GATEWAY_PORT", 5005)
DEFAULT_PROVIDER_ID = _env_int("LLM_DEFAULT_PROVIDER_ID", 0) or None

LOCALHOST_BRIDGE_TARGET = None
_localhost_bridge_raw = _env("LLM_GATEWAY_LOCALHOST_BRIDGE", "host.docker.internal")
if not _boolish_off(_localhost_bridge_raw):
  LOCALHOST_BRIDGE_TARGET = _localhost_bridge_raw

UPSTREAM_TIMEOUT_S = float(_env("LLM_GATEWAY_TIMEOUT_S", "60") or "60")
UPSTREAM_CONNECT_TIMEOUT_S = float(_env("LLM_GATEWAY_CONNECT_TIMEOUT_S", "10") or "10")
UPSTREAM_RETRIES = _env_int("LLM_GATEWAY_RETRIES", 1)
APP_AGENT_BACKEND_URL = (_env("APP_AGENT_BACKEND_URL") or "http://cat-api:4000").rstrip("/")
APP_AGENT_INTERNAL_SECRET = (
  _env("APP_AGENT_INTERNAL_SECRET")
  or _env("CHAT_AGENT_INTERNAL_SECRET")
  or _env("JWT_SECRET")
  or "fastcat-app-agent-internal"
)
APP_AGENT_TRANSLATE_MAX_CHARS = max(200, _env_int("APP_AGENT_TRANSLATE_MAX_CHARS", 1500))


def _sha256_key(value: str) -> bytes:
  return hashlib.sha256(value.encode("utf-8")).digest()


def decrypt_json(value: str | None) -> dict[str, Any] | None:
  raw = (value or "").strip()
  if not raw:
    return None
  if not raw.startswith("v1:"):
    return None
  try:
    buf = base64.b64decode(raw[3:])
  except Exception:
    return None
  if len(buf) < 12 + 16:
    return None
  iv = buf[:12]
  tag = buf[12:28]
  ciphertext = buf[28:]
  try:
    aesgcm = AESGCM(_sha256_key(SECRETS_KEY))
    plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
    return json.loads(plaintext.decode("utf-8"))
  except Exception:
    return None


def normalize_base_url(value: str) -> str:
  trimmed = value.strip()
  if not trimmed:
    return trimmed
  if not LOCALHOST_BRIDGE_TARGET:
    return trimmed
  try:
    parsed = urlparse(trimmed)
  except Exception:
    return trimmed
  host = (parsed.hostname or "").lower()
  if host in {"localhost", "127.0.0.1", "::1"}:
    netloc = LOCALHOST_BRIDGE_TARGET
    if parsed.port:
      netloc = f"{netloc}:{parsed.port}"
    rebuilt = parsed._replace(netloc=netloc)
    return urlunparse(rebuilt)
  return trimmed


def chat_completions_url(base_url: str) -> str:
  trimmed = base_url.strip()
  if not trimmed:
    return trimmed
  if not trimmed.endswith("/"):
    trimmed = f"{trimmed}/"
  return f"{trimmed}chat/completions"


@dataclass(frozen=True)
class ProviderConfig:
  id: int
  title: str
  vendor: str
  model: str | None
  base_url: str
  api_key: str | None


async def fetch_provider(pool: asyncpg.Pool, provider_id: int) -> ProviderConfig:
  row = await pool.fetchrow(
    """
    SELECT id, name, provider, model, enabled, secret_enc
    FROM nmt_providers
    WHERE id = $1
    LIMIT 1
    """,
    provider_id,
  )
  if not row:
    raise HTTPException(status_code=400, detail={"error": "Selected LLM provider not found."})
  if not bool(row["enabled"]):
    raise HTTPException(status_code=400, detail={"error": "Selected LLM provider is disabled."})
  vendor = str(row["provider"] or "").strip().lower()
  if vendor != "openai-compatible":
    raise HTTPException(status_code=400, detail={"error": f"LLM vendor '{vendor or 'unknown'}' not supported yet."})

  secret = decrypt_json(row["secret_enc"])
  base_url = str((secret or {}).get("baseUrl") or (secret or {}).get("base_url") or "").strip()
  api_key = str((secret or {}).get("apiKey") or (secret or {}).get("api_key") or "").strip() or None
  if not base_url:
    raise HTTPException(status_code=400, detail={"error": "Selected LLM provider is missing baseUrl."})

  return ProviderConfig(
    id=int(row["id"]),
    title=str(row["name"] or ""),
    vendor=vendor,
    model=str(row["model"]).strip() if row["model"] is not None else None,
    base_url=normalize_base_url(base_url),
    api_key=api_key,
  )


async def resolve_default_provider(pool: asyncpg.Pool) -> ProviderConfig:
  if DEFAULT_PROVIDER_ID:
    return await fetch_provider(pool, DEFAULT_PROVIDER_ID)
  row = await pool.fetchrow(
    """
    SELECT id
    FROM nmt_providers
    WHERE enabled = TRUE AND LOWER(provider) = 'openai-compatible'
    ORDER BY id ASC
    LIMIT 1
    """
  )
  if not row:
    raise HTTPException(
      status_code=400,
      detail={
        "error": "No LLM provider configured. Create an OpenAI-compatible provider in Settings → Resources."
      },
    )
  return await fetch_provider(pool, int(row["id"]))


class UpstreamError(Exception):
  def __init__(self, kind: str):
    super().__init__(kind)
    self.kind = kind


def _timeout() -> httpx.Timeout:
  return httpx.Timeout(
    timeout=UPSTREAM_TIMEOUT_S,
    connect=UPSTREAM_CONNECT_TIMEOUT_S,
  )


async def proxy_chat_completions(
  client: httpx.AsyncClient,
  *,
  url: str,
  headers: dict[str, str],
  payload: dict[str, Any],
) -> httpx.Response:
  attempt = 0
  max_attempts = max(1, UPSTREAM_RETRIES + 1)
  while True:
    attempt += 1
    try:
      response = await client.post(url, headers=headers, json=payload, timeout=_timeout())
      if response.status_code in {429, 502, 503, 504} and attempt < max_attempts:
        await asyncio.sleep(min(0.25 * attempt, 1.0))
        continue
      return response
    except httpx.ConnectTimeout:
      if attempt < max_attempts:
        await asyncio.sleep(min(0.25 * attempt, 1.0))
        continue
      raise UpstreamError("connect_timeout")
    except httpx.ReadTimeout:
      raise UpstreamError("read_timeout")
    except httpx.ConnectError:
      if attempt < max_attempts:
        await asyncio.sleep(min(0.25 * attempt, 1.0))
        continue
      raise UpstreamError("connect_error")
    except httpx.RequestError:
      raise UpstreamError("request_error")


from app.app_agent_runtime import (
  APP_AGENT_ADMIN_DENYLIST,
  APP_AGENT_INTERNAL_SECRET,
  APP_AGENT_TOOL_ALLOWLIST,
  AgentToolError,
  AppAgentRuntimeConfig,
  AppAgentUserContext,
  _chunk_text,
  _contains_admin_intent,
  _extract_content_from_chat_payload,
  _last_user_message_text,
  _load_runtime_config,
  _main_menu_message,
  _normalize_lang_tag,
  _parse_history_messages,
  _parse_user_context,
  _plan_action,
  _sse,
)
from app.app_agent_wizard import (
  _build_wizard_help_message,
  _fetch_project_wizard_options,
  _load_workspace_languages,
  _resolve_project_wizard_plan_v2,
)
from app.app_agent_tools import (
  _resolve_provider_for_agent,
  _run_create_project_tool,
  _run_direct_completion,
  _run_list_projects_tool,
  _run_project_status_tool,
  _run_translation_tool,
)

app = FastAPI(title="llm-gateway", version="1.0.0")


@app.on_event("startup")
async def _startup() -> None:
  logging.basicConfig(level=_log_level_from_env())
  app.state.db_pool = await asyncpg.create_pool(DB_URL, min_size=1, max_size=5)
  app.state.http = httpx.AsyncClient()
  LOG.info("[llm-gateway] started")


@app.on_event("shutdown")
async def _shutdown() -> None:
  client: httpx.AsyncClient | None = getattr(app.state, "http", None)
  pool: asyncpg.Pool | None = getattr(app.state, "db_pool", None)
  if client:
    await client.aclose()
  if pool:
    await pool.close()


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
  return {"ok": True}


@app.post("/app-agent/chat")
async def app_agent_chat(request: Request) -> Response:
  try:
    body = await request.json()
  except Exception:
    raise HTTPException(status_code=400, detail={"error": "Invalid JSON body."})

  if not isinstance(body, dict):
    raise HTTPException(status_code=400, detail={"error": "Request body must be an object."})

  internal_secret = (request.headers.get("x-app-agent-secret") or "").strip()
  if not internal_secret or internal_secret != APP_AGENT_INTERNAL_SECRET:
    raise HTTPException(status_code=403, detail={"error": "Internal app-agent request denied."})

  trace_id = (request.headers.get("x-request-id") or str(body.get("requestId") or "")).strip() or None
  stream = bool(body.get("stream", True))
  user_context = _parse_user_context(body.get("userContext"))
  history = _parse_history_messages(body.get("messages"))
  pool: asyncpg.Pool = request.app.state.db_pool
  config = await _load_runtime_config(
    pool,
    body.get("config") if isinstance(body.get("config"), dict) else None,
  )

  last_user_text = _last_user_message_text(history)
  plan = _plan_action(last_user_text, config, history)
  request_id = trace_id or f"app-agent-{int(time.time() * 1000)}"

  LOG.info(
    "[app-agent] chat_request_started requestId=%s userId=%s threadId=%s",
    request_id,
    user_context.user_id,
    body.get("threadId"),
  )

  async def generate_events() -> Any:
    final_text = ""
    final_json: dict[str, Any] | None = None
    if not config.enabled:
      final_text = "The App Agent is currently disabled by an administrator."
    else:
      resolved_plan = plan
      if plan.get("mode") == "project_wizard":
        resolved_plan = await _resolve_project_wizard_plan_v2(
          request,
          trace_id=trace_id,
          user_context=user_context,
          history=history,
          last_user_text=last_user_text,
        )
      elif plan.get("mode") == "wizard_help":
        wizard_options = await _fetch_project_wizard_options(
          request,
          trace_id=trace_id,
          user_context=user_context,
        )
        wizard_text, wizard_json = _build_wizard_help_message(wizard_options)
        resolved_plan = {
          "mode": "direct",
          "message": wizard_text,
          "content_json": wizard_json,
        }
      elif plan.get("mode") == "translate_prompt_target":
        snippet = str(plan.get("snippet") or "").strip()
        source_lang = _normalize_lang_tag(plan.get("source_lang"))
        lang_cfg = await _load_workspace_languages(
          request,
          trace_id=trace_id,
          user_context=user_context,
        )
        suggestions = lang_cfg.get("default_targets") if isinstance(lang_cfg.get("default_targets"), list) else []
        if not suggestions:
          suggestions = lang_cfg.get("enabled") if isinstance(lang_cfg.get("enabled"), list) else []
        suggestions = [entry for entry in suggestions if entry and entry != source_lang][:6]
        hint = f" Suggested targets: {', '.join(suggestions)}." if suggestions else ""
        resolved_plan = {
          "mode": "direct",
          "message": f"Target language is required for snippet translation.{hint} Reply with a language code, for example: translate \"{snippet}\" to de.",
        }

      plan_content_json = (
        resolved_plan.get("content_json")
        if isinstance(resolved_plan.get("content_json"), dict)
        else None
      )

      if resolved_plan.get("mode") == "tool":
        tool_name = str(resolved_plan.get("tool_name") or "").strip()
        args = resolved_plan.get("args") if isinstance(resolved_plan.get("args"), dict) else {}
        if tool_name not in APP_AGENT_TOOL_ALLOWLIST or tool_name not in config.enabled_tools:
          final_text = "This tool is not enabled for the App Agent."
        else:
          yield _sse(
            "tool_call",
            {
              "toolName": tool_name,
              "status": "started",
            },
          )
          try:
            if tool_name == "translate_snippet":
              text, output, quick_actions = await _run_translation_tool(
                request,
                trace_id=trace_id,
                config=config,
                user_context=user_context,
                args=args,
              )
            elif tool_name == "create_project":
              text, output, quick_actions = await _run_create_project_tool(
                request,
                trace_id=trace_id,
                user_context=user_context,
                args=args,
              )
            elif tool_name == "list_projects":
              text, output, quick_actions = await _run_list_projects_tool(
                request,
                trace_id=trace_id,
                user_context=user_context,
                args=args,
              )
            else:
              text, output, quick_actions = await _run_project_status_tool(
                request,
                trace_id=trace_id,
                user_context=user_context,
                args=args,
              )

            LOG.info(
              "[app-agent] tool_called requestId=%s userId=%s tool=%s",
              request_id,
              user_context.user_id,
              tool_name,
            )
            yield _sse(
              "tool_call",
              {
                "toolName": tool_name,
                "status": "succeeded",
                "input": args,
                "output": output,
                "text": text,
                "quickActions": quick_actions,
              },
            )
            final_text = text
            final_json = dict(plan_content_json) if plan_content_json else None
            if quick_actions:
              if not isinstance(final_json, dict):
                final_json = {}
              final_json["quickActions"] = quick_actions
          except AgentToolError as exc:
            LOG.warning(
              "[app-agent] tool_failed requestId=%s userId=%s tool=%s error=%s",
              request_id,
              user_context.user_id,
              tool_name,
              str(exc),
            )
            yield _sse(
              "tool_call",
              {
                "toolName": tool_name,
                "status": "failed",
                "input": args,
                "message": str(exc),
              },
            )
            final_text = str(exc)
      else:
        direct_message = str(resolved_plan.get("message") or "").strip()
        final_json = dict(plan_content_json) if plan_content_json else None
        should_call_model = (
          not config.mock_mode
          and direct_message.startswith("I can ")
        )
        if should_call_model:
          try:
            final_text = await _run_direct_completion(
              request,
              trace_id=trace_id,
              config=config,
              history=history,
            )
          except AgentToolError:
            final_text = direct_message
        else:
          final_text = direct_message

    if not final_text:
      final_text = "I can help with snippet translation and your current projects."

    for chunk in _chunk_text(final_text):
      yield _sse("token", {"token": chunk})
      await asyncio.sleep(0)

    yield _sse(
      "final",
      {
        "contentText": final_text,
        "contentJson": final_json,
      },
    )
    LOG.info(
      "[app-agent] chat_request_succeeded requestId=%s userId=%s",
      request_id,
      user_context.user_id,
    )

  if stream:
    return StreamingResponse(generate_events(), media_type="text/event-stream")

  events: list[dict[str, Any]] = []
  final_payload: dict[str, Any] | None = None
  async for raw_event in generate_events():
    block = str(raw_event or "").strip()
    if not block:
      continue
    event_name = ""
    data_parts: list[str] = []
    for line in block.splitlines():
      if line.startswith("event:"):
        event_name = line[6:].strip()
      elif line.startswith("data:"):
        data_parts.append(line[5:].strip())
    if not event_name:
      continue
    data_payload: dict[str, Any] = {}
    if data_parts:
      try:
        parsed = json.loads("\n".join(data_parts))
        if isinstance(parsed, dict):
          data_payload = parsed
      except Exception:
        data_payload = {}
    events.append({"event": event_name, "data": data_payload})
    if event_name == "final":
      final_payload = data_payload
  return JSONResponse(status_code=200, content={"events": events, "final": final_payload})


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> Response:
  try:
    body = await request.json()
  except Exception:
    raise HTTPException(status_code=400, detail={"error": "Invalid JSON body."})

  if not isinstance(body, dict):
    raise HTTPException(status_code=400, detail={"error": "Request body must be an object."})
  if body.get("stream"):
    raise HTTPException(
      status_code=400,
      detail={"error": "streaming not supported yet", "code": "stream_not_supported"},
    )

  trace_id = (request.headers.get("x-request-id") or "").strip() or None
  provider_id_raw = (request.headers.get("x-llm-provider-id") or "").strip()
  base_url_override = (request.headers.get("x-llm-base-url") or "").strip()
  api_key_override = (request.headers.get("x-llm-api-key") or "").strip() or None

  pool: asyncpg.Pool = app.state.db_pool
  provider: ProviderConfig | None = None

  base_url: str
  api_key: str | None
  default_model: str | None

  if base_url_override:
    base_url = normalize_base_url(base_url_override)
    api_key = api_key_override
    default_model = None
  else:
    if provider_id_raw:
      try:
        provider_id = int(provider_id_raw)
      except ValueError:
        raise HTTPException(status_code=400, detail={"error": "Invalid x-llm-provider-id header."})
      provider = await fetch_provider(pool, provider_id)
    else:
      provider = await resolve_default_provider(pool)
    base_url = provider.base_url
    api_key = provider.api_key
    default_model = provider.model

  if not body.get("model"):
    if default_model:
      body["model"] = default_model
    else:
      raise HTTPException(status_code=400, detail={"error": "model is required"})

  url = chat_completions_url(base_url)
  if not url:
    raise HTTPException(status_code=400, detail={"error": "Invalid baseUrl"})

  headers: dict[str, str] = {"content-type": "application/json"}
  if api_key:
    headers["authorization"] = f"Bearer {api_key}"
  if trace_id:
    headers["x-request-id"] = trace_id

  start = time.monotonic()
  client: httpx.AsyncClient = app.state.http
  try:
    upstream = await proxy_chat_completions(client, url=url, headers=headers, payload=body)
  except UpstreamError as exc:
    ms = int((time.monotonic() - start) * 1000)
    LOG.warning(
      "[llm-gateway] upstream failure kind=%s providerId=%s latencyMs=%s",
      exc.kind,
      provider.id if provider else None,
      ms,
    )
    if exc.kind in {"connect_timeout", "read_timeout"}:
      raise HTTPException(status_code=504, detail={"error": "Upstream timeout."})
    raise HTTPException(status_code=502, detail={"error": "Upstream connection failed."})

  ms = int((time.monotonic() - start) * 1000)
  LOG.info(
    "[llm-gateway] chat.completions status=%s providerId=%s latencyMs=%s",
    upstream.status_code,
    provider.id if provider else None,
    ms,
  )

  content_type = (upstream.headers.get("content-type") or "").lower()
  if "application/json" in content_type:
    try:
      return JSONResponse(status_code=upstream.status_code, content=upstream.json())
    except Exception:
      raise HTTPException(status_code=502, detail={"error": "Upstream returned invalid JSON."})

  return Response(
    status_code=upstream.status_code,
    content=upstream.text,
    media_type=upstream.headers.get("content-type") or "text/plain",
  )


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> Response:
  detail = exc.detail
  if isinstance(detail, dict):
    return JSONResponse(status_code=exc.status_code, content=detail)
  return JSONResponse(status_code=exc.status_code, content={"error": str(detail)})


if __name__ == "__main__":
  import uvicorn

  uvicorn.run("app.main:app", host="0.0.0.0", port=PORT)
