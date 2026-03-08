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


APP_AGENT_TOOL_ALLOWLIST = {
  "translate_snippet",
  "create_project",
  "list_projects",
  "get_project_status",
}

APP_AGENT_ADMIN_DENYLIST = [
  re.compile(r"\buser\s+management\b", re.IGNORECASE),
  re.compile(r"\bmanage\s+users?\b", re.IGNORECASE),
  re.compile(r"\bbilling\b", re.IGNORECASE),
  re.compile(r"\bintegrations?\b", re.IGNORECASE),
  re.compile(r"\bworkspace\s+settings\b", re.IGNORECASE),
  re.compile(r"\borg(?:anization)?\s+settings\b", re.IGNORECASE),
  re.compile(r"\bpermissions?\b", re.IGNORECASE),
]

LANG_TAG_RE = re.compile(r"^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$")


class AgentToolError(Exception):
  pass


@dataclass(frozen=True)
class AppAgentRuntimeConfig:
  enabled: bool
  connection_provider: str
  provider_id: int | None
  model_name: str
  endpoint: str
  mock_mode: bool
  system_prompt: str
  enabled_tools: set[str]
  translate_max_chars: int


@dataclass(frozen=True)
class AppAgentUserContext:
  user_id: int
  username: str
  role: str
  department_id: int | None


def _normalize_lang_tag(value: str | None) -> str | None:
  raw = str(value or "").strip().replace("_", "-").lower()
  if not raw or not LANG_TAG_RE.match(raw):
    return None
  return raw


def _normalize_lang_list(value: Any) -> list[str]:
  if isinstance(value, str):
    try:
      value = json.loads(value)
    except Exception:
      value = []
  if not isinstance(value, list):
    return []
  deduped: list[str] = []
  seen: set[str] = set()
  for entry in value:
    normalized = _normalize_lang_tag(str(entry))
    if not normalized or normalized in seen:
      continue
    seen.add(normalized)
    deduped.append(normalized)
  return deduped


def _normalize_tool_set(value: Any) -> set[str]:
  if isinstance(value, str):
    try:
      value = json.loads(value)
    except Exception:
      value = []
  if not isinstance(value, list):
    value = []
  out = {
    str(entry or "").strip()
    for entry in value
    if str(entry or "").strip() in APP_AGENT_TOOL_ALLOWLIST
  }
  if not out:
    out = {"translate_snippet", "create_project", "list_projects", "get_project_status"}
  return out


def _normalize_runtime_config(raw: dict[str, Any] | None) -> AppAgentRuntimeConfig:
  raw = raw or {}
  system_prompt = str(raw.get("systemPrompt") or raw.get("system_prompt") or "").strip()
  enabled_tools = _normalize_tool_set(raw.get("enabledTools") or raw.get("enabled_tools") or [])
  provider_id_raw = raw.get("providerId") if raw.get("providerId") is not None else raw.get("provider_id")
  provider_id: int | None = None
  if provider_id_raw is not None:
    try:
      provider_id_val = int(provider_id_raw)
      if provider_id_val > 0:
        provider_id = provider_id_val
    except Exception:
      provider_id = None

  translate_max_chars_raw = raw.get("translateMaxChars") or raw.get("translate_max_chars")
  try:
    translate_max_chars = int(translate_max_chars_raw) if translate_max_chars_raw is not None else APP_AGENT_TRANSLATE_MAX_CHARS
  except Exception:
    translate_max_chars = APP_AGENT_TRANSLATE_MAX_CHARS

  return AppAgentRuntimeConfig(
    enabled=bool(raw.get("enabled", True)),
    connection_provider="gateway"
    if str(raw.get("connectionProvider") or raw.get("connection_provider") or "").strip().lower() == "gateway"
    else "mock",
    provider_id=provider_id,
    model_name=str(raw.get("modelName") or raw.get("model_name") or "").strip(),
    endpoint=str(raw.get("endpoint") or "").strip(),
    mock_mode=bool(raw.get("mockMode", raw.get("mock_mode", True))),
    system_prompt=system_prompt
    or "You are the Fastcat App Agent. Help with short snippet translation and project actions for the current user.",
    enabled_tools=enabled_tools,
    translate_max_chars=max(200, translate_max_chars),
  )


async def _load_runtime_config(pool: asyncpg.Pool, override: dict[str, Any] | None) -> AppAgentRuntimeConfig:
  if override is not None:
    return _normalize_runtime_config(override)

  row = await pool.fetchrow(
    """
    SELECT
      enabled,
      connection_provider,
      provider_id,
      model_name,
      endpoint,
      mock_mode,
      system_prompt,
      enabled_tools
    FROM app_agent_config
    WHERE id = 1
    LIMIT 1
    """
  )
  if not row:
    return _normalize_runtime_config(None)
  return _normalize_runtime_config(dict(row))


def _parse_user_context(payload: Any) -> AppAgentUserContext:
  if not isinstance(payload, dict):
    raise HTTPException(status_code=400, detail={"error": "userContext is required"})
  try:
    user_id = int(payload.get("userId"))
  except Exception as exc:
    raise HTTPException(status_code=400, detail={"error": "userContext.userId is required"}) from exc
  username = str(payload.get("username") or "").strip()
  if user_id <= 0 or not username:
    raise HTTPException(status_code=400, detail={"error": "Invalid userContext"})
  role = str(payload.get("role") or "").strip().lower()
  dept_raw = payload.get("departmentId")
  department_id = None
  try:
    if dept_raw is not None:
      dept_val = int(dept_raw)
      if dept_val > 0:
        department_id = dept_val
  except Exception:
    department_id = None
  return AppAgentUserContext(
    user_id=user_id,
    username=username,
    role=role,
    department_id=department_id,
  )


def _parse_history_messages(payload: Any) -> list[dict[str, Any]]:
  if not isinstance(payload, list):
    return []
  out: list[dict[str, Any]] = []
  for entry in payload:
    if not isinstance(entry, dict):
      continue
    role = str(entry.get("role") or "").strip().lower()
    if role not in {"user", "assistant", "tool"}:
      continue
    content_text = str(entry.get("contentText") or entry.get("content_text") or "").strip()
    content_json = entry.get("contentJson") if isinstance(entry.get("contentJson"), dict) else None
    if not content_json and isinstance(entry.get("content_json"), dict):
      content_json = entry.get("content_json")
    if not content_text and content_json is not None:
      try:
        content_text = json.dumps(content_json, ensure_ascii=False)
      except Exception:
        content_text = ""
    if not content_text:
      continue
    out.append(
      {
        "role": role,
        "content_text": content_text,
        "content_json": content_json if isinstance(content_json, dict) else None,
      }
    )
  return out


def _last_user_message_text(history: list[dict[str, Any]]) -> str:
  for entry in reversed(history):
    if entry.get("role") == "user":
      return str(entry.get("content_text") or "").strip()
  return ""


def _contains_admin_intent(text: str) -> bool:
  if not text:
    return False
  return any(pattern.search(text) for pattern in APP_AGENT_ADMIN_DENYLIST)


def _extract_target_langs(text: str) -> list[str]:
  raw_text = str(text or "")
  match = re.search(
    r"\b(?:target\s+languages?|targets?)\s*(?:are|is|=|:)?\s*"
    r"([a-z]{2,3}(?:-[a-z0-9]{2,8})?\b(?:\s*,\s*[a-z]{2,3}(?:-[a-z0-9]{2,8})?\b)*)",
    raw_text,
    re.IGNORECASE,
  )
  if not match:
    match = re.search(
      r"\bto\s+([a-z]{2,3}(?:-[a-z0-9]{2,8})?\b(?:\s*,\s*[a-z]{2,3}(?:-[a-z0-9]{2,8})?\b)*)",
      raw_text,
      re.IGNORECASE,
    )
  if not match:
    return []
  raw = match.group(1).split(",")
  out: list[str] = []
  for entry in raw:
    normalized = _normalize_lang_tag(entry)
    if normalized and normalized not in out:
      out.append(normalized)
  return out


def _extract_source_lang(text: str) -> str | None:
  match = re.search(r"\bfrom\s+([a-z]{2,3}(?:-[a-z0-9]{2,8})?)", text, re.IGNORECASE)
  if not match:
    return None
  return _normalize_lang_tag(match.group(1))


def _extract_file_ids(text: str) -> list[int]:
  out: list[int] = []
  explicit = re.search(r"\bfile(?:s)?(?:\s*ids?)?\s*[:#]?\s*([0-9,\s]+)", text, re.IGNORECASE)
  raw_numbers: list[str] = []
  if explicit:
    raw_numbers.extend(re.findall(r"\d+", explicit.group(1)))
  raw_numbers.extend(re.findall(r"\bfile\s*#?(\d+)\b", text, re.IGNORECASE))
  raw_numbers.extend(re.findall(r"\bfiles?\s+(\d+)\b", text, re.IGNORECASE))
  for candidate in raw_numbers:
    try:
      value = int(candidate)
    except Exception:
      continue
    if value > 0 and value not in out:
      out.append(value)
  return out


def _extract_project_name(text: str) -> str | None:
  labeled = re.search(
    r"\b(?:project\s*name|name)\s*(?:is|=|:)\s*[\"'`]?(?P<name>[a-z0-9 _.\-]{3,80})[\"'`]?\s*$",
    str(text or "").strip(),
    re.IGNORECASE,
  )
  if labeled:
    return labeled.group("name").strip()
  quoted = re.search(r"\b(?:named|called)\s+[\"']([^\"']+)[\"']", text, re.IGNORECASE)
  if quoted:
    return quoted.group(1).strip()
  plain = re.search(r"\b(?:named|called)\s+([a-z0-9 _.-]{3,80})", text, re.IGNORECASE)
  if plain:
    return plain.group(1).strip()
  return None


def _extract_uploaded_files_from_history(history: list[dict[str, Any]]) -> dict[int, str]:
  out: dict[int, str] = {}
  for entry in history:
    if str(entry.get("role") or "").lower() != "user":
      continue
    content_json = entry.get("content_json")
    if not isinstance(content_json, dict):
      continue
    uploaded = content_json.get("uploadedFiles")
    if not isinstance(uploaded, list):
      continue
    for row in uploaded:
      if not isinstance(row, dict):
        continue
      try:
        file_id = int(row.get("fileId"))
      except Exception:
        continue
      if file_id <= 0:
        continue
      filename = str(row.get("filename") or "").strip() or f"file #{file_id}"
      out[file_id] = filename
  return out


def _build_suggested_project_title(file_names: list[str]) -> str | None:
  if not file_names:
    return None
  first_name = str(file_names[0] or "").strip()
  if not first_name:
    return None
  stem = re.sub(r"\.[^.]+$", "", first_name).strip()
  stem = re.sub(r"[_\-]+", " ", stem)
  stem = re.sub(r"\s+", " ", stem).strip()
  if not stem:
    stem = "Project"
  return f"{stem} {datetime.utcnow().strftime('%Y-%m-%d')}"


def _parse_project_title_choice(text: str, suggested_title: str | None) -> dict[str, Any]:
  raw = str(text or "").strip()
  if not raw:
    return {"action": "none"}
  if _is_default_choice(raw):
    return {"action": "suggested"}
  if suggested_title and re.search(r"^\s*(use|keep)\s+(?:the\s+)?suggest(?:ed)?(?:\s+title)?\s*$", raw, re.IGNORECASE):
    return {"action": "suggested"}

  explicit = _extract_project_name(raw)
  if explicit:
    normalized = explicit.strip().strip("\"'`")
    if normalized:
      return {"action": "set", "title": normalized[:120]}

  prefixed = re.match(
    r"^\s*(?:title|project\s+title)\s*(?:is|=|:)\s*(.+?)\s*$",
    raw,
    re.IGNORECASE,
  )
  if prefixed:
    normalized = str(prefixed.group(1) or "").strip().strip("\"'`")
    if normalized:
      return {"action": "set", "title": normalized[:120]}

  if suggested_title and _is_skip_choice(raw):
    return {"action": "suggested"}

  return {"action": "none"}


def _extract_translation_snippet(text: str) -> str:
  quoted = re.search(r"[\"']([^\"']+)[\"']", text)
  if quoted:
    return quoted.group(1).strip()
  snippet = re.sub(r"^[\s\S]*?\btranslate\b", "", text, flags=re.IGNORECASE).strip()
  snippet = re.sub(r"\bto\s+[a-z]{2,3}(?:-[a-z0-9]{2,8})?[\s\S]*$", "", snippet, flags=re.IGNORECASE).strip()
  return snippet


def _extract_wizard_context_from_history(history: list[dict[str, Any]]) -> dict[str, Any] | None:
  for entry in reversed(history):
    if str(entry.get("role") or "").lower() != "assistant":
      continue
    content_json = entry.get("content_json")
    if not isinstance(content_json, dict):
      continue
    wizard = content_json.get("wizard")
    if not isinstance(wizard, dict):
      continue
    return {
      "active": bool(wizard.get("active")),
      "step": str(wizard.get("step") or "").strip().lower(),
      "state": wizard.get("state") if isinstance(wizard.get("state"), dict) else {},
    }
  return None


def _is_create_project_intent(text: str) -> bool:
  raw = str(text or "")
  if not raw:
    return False
  has_project_word = bool(re.search(r"\bproject\b", raw, re.IGNORECASE))
  has_file_ids = len(_extract_file_ids(raw)) > 0
  return bool(
    re.search(
      r"\b(create|creating|new|setup|set\s*up|start|begin|build|make)\b[\s\S]{0,120}\bproject\b",
      raw,
      re.IGNORECASE,
    )
    or re.search(r"\bproject\s+wizard\b", raw, re.IGNORECASE)
    or (
      has_project_word
      and has_file_ids
      and bool(re.search(r"\b(step[\s-]*by[\s-]*step|wizard|guide|use)\b", raw, re.IGNORECASE))
    )
  )


def _is_project_wizard_info_intent(text: str) -> bool:
  raw = str(text or "")
  if not raw:
    return False
  return bool(
    re.search(r"\b(project\s+wizard|wizard)\b", raw, re.IGNORECASE)
    and re.search(r"\b(config|configure|configuration|options?|settings?|steps?)\b", raw, re.IGNORECASE)
  ) or bool(re.search(r"\bwhat\s+can\s+be\s+configured\b", raw, re.IGNORECASE))


def _main_menu_message() -> str:
  return "\n".join(
    [
      "What do you want to do?",
      "1) Translate snippet",
      "2) Create project",
      "3) List projects",
      "4) Project status",
    ]
  )


def _plan_action(text: str, config: AppAgentRuntimeConfig, history: list[dict[str, Any]]) -> dict[str, Any]:
  raw = str(text or "").strip()
  raw_lower = raw.lower()
  wizard_context = _extract_wizard_context_from_history(history)
  wizard_active = bool(wizard_context and wizard_context.get("active"))
  create_intent = _is_create_project_intent(raw)
  translate_intent = bool(re.search(r"\btranslate|translation\b", raw, re.IGNORECASE))

  if not raw:
    if wizard_active and "create_project" in config.enabled_tools:
      return {"mode": "project_wizard"}
    return {
      "mode": "direct",
      "message": "Do you want to translate a small snippet or create a project?",
    }

  if _contains_admin_intent(raw):
    return {
      "mode": "direct",
      "message": "I cannot perform admin operations. I can help with translation snippets and your own projects.",
    }

  # Quick numeric menu shortcuts
  if raw_lower in {"1", "translate", "translate snippet"}:
    return {
      "mode": "direct",
      "message": "Share the text snippet and target language code (for example: translate \"Hello\" to de).",
    }
  if raw_lower in {"2", "create", "create project"}:
    if "create_project" not in config.enabled_tools:
      return {"mode": "direct", "message": "Project creation is currently disabled for the App Agent."}
    return {"mode": "project_wizard"}
  if raw_lower in {"3", "list projects", "my projects"}:
    if "list_projects" in config.enabled_tools:
      return {"mode": "tool", "tool_name": "list_projects", "args": {}}
  if raw_lower in {"4", "project status", "status"}:
    return {
      "mode": "direct",
      "message": "Tell me the project ID (for example: project 42 status).",
    }

  if create_intent and translate_intent and not wizard_active:
    return {
      "mode": "direct",
      "message": "Do you want to translate a small snippet or create a project?",
    }

  if create_intent or wizard_active:
    if "create_project" not in config.enabled_tools:
      return {
        "mode": "direct",
        "message": "Project creation is currently disabled for the App Agent.",
      }
    return {"mode": "project_wizard"}

  if _is_project_wizard_info_intent(raw):
    return {"mode": "wizard_help"}

  status_match = re.search(r"\bproject\s+#?(\d+)\b", raw, re.IGNORECASE)
  if status_match and re.search(r"\b(status|progress|state)\b", raw, re.IGNORECASE):
    if "get_project_status" in config.enabled_tools:
      return {
        "mode": "tool",
        "tool_name": "get_project_status",
        "args": {"projectId": int(status_match.group(1))},
      }

  if re.search(r"\b(list|show|display)\b[\s\S]{0,40}\bprojects?\b", raw, re.IGNORECASE) or re.search(r"\bmy\s+projects?\b", raw, re.IGNORECASE):
    if "list_projects" in config.enabled_tools:
      return {"mode": "tool", "tool_name": "list_projects", "args": {}}

  if re.search(r"\btranslate\b", raw, re.IGNORECASE):
    if "translate_snippet" not in config.enabled_tools:
      return {
        "mode": "direct",
        "message": "Snippet translation is currently disabled for the App Agent.",
      }
    target_langs = _extract_target_langs(raw)
    target_lang = target_langs[0] if target_langs else None
    snippet = _extract_translation_snippet(raw)
    if not snippet:
      return {
        "mode": "direct",
        "message": "Please provide the snippet text to translate.",
      }
    if not target_lang:
      return {
        "mode": "translate_prompt_target",
        "snippet": snippet,
        "source_lang": _extract_source_lang(raw),
      }
    return {
      "mode": "tool",
      "tool_name": "translate_snippet",
      "args": {
        "text": snippet,
        "target_lang": target_lang,
        "source_lang": _extract_source_lang(raw),
        "tone": None,
      },
    }

  return {
    "mode": "direct",
    "message": "Do you want to translate a small snippet or create a project?",
  }


def _sse(event_type: str, payload: dict[str, Any]) -> str:
  return f"event: {event_type}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _chunk_text(text: str, chunk_size: int = 22) -> list[str]:
  normalized = str(text or "")
  if not normalized:
    return []
  words = re.findall(r"\S+\s*", normalized)
  if not words:
    return [normalized]
  out: list[str] = []
  current = ""
  for word in words:
    if current and len(current) + len(word) > chunk_size:
      out.append(current)
      current = word
      continue
    current += word
  if current:
    out.append(current)
  return out


def _extract_content_from_chat_payload(payload: dict[str, Any]) -> str:
  message = ((payload.get("choices") or [{}])[0] or {}).get("message") or {}
  content = message.get("content")
  if isinstance(content, str):
    return content.strip()
  if isinstance(content, list):
    parts: list[str] = []
    for entry in content:
      if isinstance(entry, dict) and isinstance(entry.get("text"), str):
        parts.append(entry["text"])
    return "\n".join(parts).strip()
  return ""


async def _call_backend_tool(
  request: Request,
  *,
  path: str,
  payload: dict[str, Any],
  trace_id: str | None,
) -> dict[str, Any]:
  client: httpx.AsyncClient = request.app.state.http
  headers = {
    "content-type": "application/json",
    "x-app-agent-secret": APP_AGENT_INTERNAL_SECRET,
  }
  if trace_id:
    headers["x-request-id"] = trace_id
  response = await client.post(
    f"{APP_AGENT_BACKEND_URL}{path}",
    json=payload,
    headers=headers,
    timeout=_timeout(),
  )
  if not response.is_success:
    detail = "Tool call failed"
    try:
      data = response.json()
      if isinstance(data, dict):
        detail = str(data.get("error") or detail)
    except Exception:
      pass
    raise AgentToolError(detail)
  try:
    data = response.json()
  except Exception as exc:
    raise AgentToolError("Tool returned invalid JSON") from exc
  if not isinstance(data, dict):
    raise AgentToolError("Tool returned invalid response")
  return data


def _dedupe_positive_ints(values: list[int]) -> list[int]:
  out: list[int] = []
  seen: set[int] = set()
  for value in values:
    try:
      as_int = int(value)
    except Exception:
      continue
    if as_int <= 0 or as_int in seen:
      continue
    seen.add(as_int)
    out.append(as_int)
  return out


def _normalize_project_wizard_state(raw: dict[str, Any] | None) -> dict[str, Any]:
  raw = raw or {}
  raw_file_ids = raw.get("file_ids")
  if not isinstance(raw_file_ids, list):
    raw_file_ids = []
  file_ids = _dedupe_positive_ints([int(v) for v in raw_file_ids if str(v).isdigit()])
  file_names_raw = raw.get("file_names") if isinstance(raw.get("file_names"), dict) else {}
  file_names = {str(k): str(v) for k, v in file_names_raw.items() if str(k).strip() and str(v).strip()}
  source_lang = _normalize_lang_tag(str(raw.get("source_lang") or "")) if raw.get("source_lang") else None
  target_langs = _normalize_lang_list(raw.get("target_langs") or [])
  if source_lang:
    target_langs = [entry for entry in target_langs if entry != source_lang]
  project_name = str(raw.get("project_name") or raw.get("name") or "").strip() or None
  owner_user_id = None
  translation_engine_id = None
  ruleset_id = None
  tmx_id = None
  termbase_id = None
  try:
    owner_user_id_raw = raw.get("owner_user_id")
    if owner_user_id_raw is not None:
      owner_user_id_val = int(owner_user_id_raw)
      if owner_user_id_val > 0:
        owner_user_id = owner_user_id_val
  except Exception:
    owner_user_id = None
  try:
    engine_raw = raw.get("translation_engine_id")
    if engine_raw is not None:
      engine_val = int(engine_raw)
      if engine_val > 0:
        translation_engine_id = engine_val
  except Exception:
    translation_engine_id = None
  try:
    rules_raw = raw.get("ruleset_id")
    if rules_raw is not None:
      rules_val = int(rules_raw)
      if rules_val > 0:
        ruleset_id = rules_val
  except Exception:
    ruleset_id = None
  try:
    tmx_raw = raw.get("tmx_id")
    if tmx_raw is not None:
      tmx_val = int(tmx_raw)
      if tmx_val > 0:
        tmx_id = tmx_val
  except Exception:
    tmx_id = None
  try:
    termbase_raw = raw.get("termbase_id")
    if termbase_raw is not None:
      termbase_val = int(termbase_raw)
      if termbase_val > 0:
        termbase_id = termbase_val
  except Exception:
    termbase_id = None
  owner_username = str(raw.get("owner_username") or "").strip() or None

  return {
    "project_name": project_name,
    "title_done": bool(raw.get("title_done", False)),
    "file_ids": file_ids,
    "file_names": file_names,
    "source_lang": source_lang,
    "target_langs": target_langs,
    "owner_user_id": owner_user_id,
    "owner_username": owner_username,
    "assignment_done": bool(raw.get("assignment_done", False)),
    "translation_engine_id": translation_engine_id,
    "engine_done": bool(raw.get("engine_done", False)),
    "ruleset_id": ruleset_id,
    "rules_done": bool(raw.get("rules_done", False)),
    "tmx_id": tmx_id,
    "tmx_done": bool(raw.get("tmx_done", False)),
    "termbase_id": termbase_id,
    "termbase_done": bool(raw.get("termbase_done", False)),
    "awaiting_confirm": bool(raw.get("awaiting_confirm", False)),
  }


def _extract_lang_mentions(text: str, allowed_languages: set[str] | None = None) -> list[str]:
  matches = re.findall(r"\b[a-z]{2,3}(?:-[a-z0-9]{2,8})?\b", str(text or "").lower())
  out: list[str] = []
  seen: set[str] = set()
  for entry in matches:
    normalized = _normalize_lang_tag(entry)
    if not normalized or normalized in seen:
      continue
    if allowed_languages and normalized not in allowed_languages:
      continue
    seen.add(normalized)
    out.append(normalized)
  return out


def _is_affirmative(text: str) -> bool:
  return bool(
    re.search(r"^\s*(yes|y|ok|okay|sure|confirm|create|go ahead|do it|proceed)\s*!?\s*$", str(text or ""), re.IGNORECASE)
  )


def _is_cancel_intent(text: str) -> bool:
  return bool(re.search(r"\b(cancel|stop|never mind|abort)\b", str(text or ""), re.IGNORECASE))


def _is_skip_choice(text: str) -> bool:
  return bool(re.search(r"^\s*(skip|none|no|not now|n/a|nope)\s*$", str(text or ""), re.IGNORECASE))


def _is_default_choice(text: str) -> bool:
  return bool(re.search(r"^\s*(default|auto|recommended)\s*$", str(text or ""), re.IGNORECASE))


def _parse_option_choice(
  raw_text: str,
  options: list[dict[str, Any]],
  *,
  label_keys: tuple[str, ...] = ("name", "label"),
) -> dict[str, Any]:
  text = str(raw_text or "").strip()
  if not text:
    return {"action": "none"}
  if _is_skip_choice(text):
    return {"action": "skip"}
  if _is_default_choice(text):
    return {"action": "default"}

  id_match = re.search(r"\b(?:id|#)\s*(\d+)\b", text, re.IGNORECASE)
  if not id_match:
    id_match = re.search(r"^\s*(\d+)\s*$", text)
  if id_match:
    try:
      selected_id = int(id_match.group(1))
      if selected_id > 0:
        for option in options:
          try:
            if int(option.get("id")) == selected_id:
              return {"action": "select", "id": selected_id}
          except Exception:
            continue
    except Exception:
      pass

  lowered = text.lower()
  for option in options:
    labels = [str(option.get(key) or "").strip() for key in label_keys]
    labels = [entry for entry in labels if entry]
    if not labels:
      continue
    if any(label.lower() in lowered or lowered in label.lower() for label in labels):
      try:
        return {"action": "select", "id": int(option.get("id"))}
      except Exception:
        continue
  return {"action": "none"}


def _parse_assignee_choice(raw_text: str, users: list[dict[str, Any]]) -> dict[str, Any]:
  text = str(raw_text or "").strip()
  if not text:
    return {"action": "none"}
  if _is_skip_choice(text) or _is_default_choice(text):
    return {"action": "default"}
  if re.search(r"\b(me|myself|self)\b", text, re.IGNORECASE):
    return {"action": "self"}
  lowered = text.lower()
  explicit_ids = [int(value) for value in re.findall(r"\b\d+\b", text)]
  if explicit_ids:
    wanted = explicit_ids[0]
    for user in users:
      try:
        candidate_id = int(user.get("userId") or user.get("id"))
      except Exception:
        continue
      if candidate_id == wanted:
        return {"action": "select", "id": candidate_id}

  for user in users:
    labels = [str(user.get("username") or "").strip(), str(user.get("name") or "").strip()]
    labels = [entry for entry in labels if entry]
    if not labels:
      continue
    if any(label.lower() in lowered or lowered in label.lower() for label in labels):
      try:
        return {"action": "select", "id": int(user.get("userId") or user.get("id"))}
      except Exception:
        continue

  return {"action": "none"}


def _resource_label_by_id(options: list[dict[str, Any]], value: int | None) -> str | None:
  if value is None:
    return None
  for option in options:
    try:
      option_id = int(option.get("id"))
    except Exception:
      continue
    if option_id != value:
      continue
    label = str(option.get("name") or option.get("label") or "").strip()
    return label or str(option_id)
  return None


def _language_alternatives(requested: str, enabled_languages: list[str]) -> list[str]:
  requested_norm = _normalize_lang_tag(requested) or requested
  if not requested_norm:
    return enabled_languages[:3]
  primary = requested_norm.split("-")[0]
  by_primary = [
    entry for entry in enabled_languages if (entry.split("-")[0] == primary and entry != requested_norm)
  ]
  if by_primary:
    return by_primary[:3]
  by_prefix = [entry for entry in enabled_languages if entry.startswith(requested_norm[:2])]
  return by_prefix[:3] if by_prefix else enabled_languages[:3]


def _parse_due_at_text(text: str) -> dict[str, Any]:
  raw = str(text or "").strip()
  if not raw:
    return {"status": "none", "iso": None}
  if _is_skip_choice(raw):
    return {"status": "skip", "iso": None}

  now_local = datetime.now().astimezone()
  local_tz = now_local.tzinfo
  lowered = raw.lower()
  if lowered in {"today", "end of day", "eod"}:
    dt = now_local.replace(hour=23, minute=59, second=59, microsecond=0)
    return {"status": "ok", "iso": dt.isoformat()}
  if lowered in {"tomorrow"}:
    dt = (now_local + timedelta(days=1)).replace(hour=23, minute=59, second=59, microsecond=0)
    return {"status": "ok", "iso": dt.isoformat()}

  date_only_match = re.match(r"^\s*(\d{4})[-/](\d{2})[-/](\d{2})\s*$", raw)
  if date_only_match:
    try:
      year = int(date_only_match.group(1))
      month = int(date_only_match.group(2))
      day = int(date_only_match.group(3))
      dt = datetime(year, month, day, 23, 59, 59, tzinfo=local_tz)
      return {"status": "ok", "iso": dt.isoformat()}
    except Exception:
      return {"status": "invalid", "iso": None}

  parsed_dt: datetime | None = None
  try:
    parsed_dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
  except Exception:
    parsed_dt = None
  if parsed_dt is None:
    try:
      parsed_dt = parsedate_to_datetime(raw)
    except Exception:
      parsed_dt = None
  if parsed_dt is None:
    return {"status": "invalid", "iso": None}
  if parsed_dt.tzinfo is None:
    parsed_dt = parsed_dt.replace(tzinfo=local_tz)
  return {"status": "ok", "iso": parsed_dt.isoformat()}


async def _fetch_project_wizard_options(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
) -> dict[str, Any]:
  try:
    payload = await _call_backend_tool(
      request,
      path="/api/chat/internal/tools/project-wizard-options",
      payload={
        "userContext": {
          "userId": user_context.user_id,
          "username": user_context.username,
          "role": user_context.role,
          "departmentId": user_context.department_id,
        }
      },
      trace_id=trace_id,
    )
  except AgentToolError:
    return {}

  wizard = payload.get("wizard") if isinstance(payload, dict) else None
  return wizard if isinstance(wizard, dict) else {}


def _extract_workspace_languages(wizard_options: dict[str, Any] | None) -> dict[str, Any]:
  options = wizard_options if isinstance(wizard_options, dict) else {}
  configurable = options.get("configurable") if isinstance(options.get("configurable"), dict) else {}
  languages_cfg = configurable.get("languages") if isinstance(configurable.get("languages"), dict) else {}
  enabled = _normalize_lang_list(languages_cfg.get("enabled") or [])
  default_source = _normalize_lang_tag(str(languages_cfg.get("defaultSource") or "")) or (
    enabled[0] if enabled else None
  )
  default_targets = [
    entry for entry in _normalize_lang_list(languages_cfg.get("defaultTargets") or []) if entry != default_source
  ]
  allow_single_language = bool(languages_cfg.get("allowSingleLanguage", True))
  return {
    "enabled": enabled,
    "default_source": default_source,
    "default_targets": default_targets,
    "allow_single_language": allow_single_language,
  }


async def _load_workspace_languages(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
) -> dict[str, Any]:
  wizard_options = await _fetch_project_wizard_options(
    request,
    trace_id=trace_id,
    user_context=user_context,
  )
  return _extract_workspace_languages(wizard_options)


def _wizard_content_json(state: dict[str, Any], *, active: bool, step: str) -> dict[str, Any]:
  return {
    "wizard": {
      "active": bool(active),
      "step": str(step or ""),
      "state": state,
    }
  }


def _build_wizard_help_message(options: dict[str, Any]) -> tuple[str, dict[str, Any]]:
  configurable = options.get("configurable") if isinstance(options.get("configurable"), dict) else {}
  file_types = configurable.get("fileTypes") if isinstance(configurable.get("fileTypes"), list) else []
  engines = configurable.get("translationEngines") if isinstance(configurable.get("translationEngines"), list) else []
  rulesets = configurable.get("rulesets") if isinstance(configurable.get("rulesets"), list) else []
  tmx_entries = configurable.get("tmx") if isinstance(configurable.get("tmx"), list) else []
  termbases = configurable.get("termbases") if isinstance(configurable.get("termbases"), list) else []
  assignment_cfg = configurable.get("assignment") if isinstance(configurable.get("assignment"), dict) else {}
  notices = configurable.get("notices") if isinstance(configurable.get("notices"), list) else []
  lang_cfg = _extract_workspace_languages(options)
  source_default = lang_cfg.get("default_source")
  target_defaults = lang_cfg.get("default_targets") if isinstance(lang_cfg.get("default_targets"), list) else []
  can_assign_others = bool(assignment_cfg.get("canAssignOthers"))

  file_type_parts: list[str] = []
  for entry in file_types[:6]:
    if not isinstance(entry, dict):
      continue
    file_type = str(entry.get("fileType") or "").strip().lower()
    extensions = entry.get("extensions") if isinstance(entry.get("extensions"), list) else []
    ext_text = ", ".join(str(ext) for ext in extensions if str(ext).strip())
    if file_type and ext_text:
      file_type_parts.append(f"{file_type.upper()} ({ext_text})")

  lines = [
    "Project wizard uses configured settings (no project templates):",
    "1) Project title",
    "2) File upload or file selection (required)",
    "3) Target languages (required, limited to configured app languages)",
    "4) Assignment (role-aware)",
    "5) Translation engine, rules, TMX, and termbase (optional when available)",
    "6) Summary + confirmation",
  ]
  if source_default:
    lines.append(f"Default source language: {source_default}")
  if target_defaults:
    lines.append(f"Default target languages: {', '.join(target_defaults)}")
  if file_type_parts:
    lines.append(f"Configured file types: {'; '.join(file_type_parts)}")
  lines.append(
    f"Engines: {len(engines)} | rulesets: {len(rulesets)} | TMX: {len(tmx_entries)} | termbases: {len(termbases)}"
  )
  lines.append(
    "Assignment: managers/admins can assign eligible users; all other roles are self-assigned."
    if can_assign_others
    else "Assignment: this role is self-assigned."
  )
  for notice in notices[:4]:
    if not isinstance(notice, dict):
      continue
    message = str(notice.get("message") or "").strip()
    if message:
      lines.append(f"Notice: {message}")
  lines.append("If you want, I can start a guided project setup now and ask one step at a time.")

  return "\n".join(lines), _wizard_content_json(
    _normalize_project_wizard_state(None),
    active=False,
    step="capabilities",
  )


async def _describe_wizard_files(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
  file_ids: list[int],
) -> tuple[dict[int, str], str | None]:
  if not file_ids:
    return {}, None
  try:
    payload = await _call_backend_tool(
      request,
      path="/api/chat/internal/tools/describe-files",
      payload={
        "userContext": {
          "userId": user_context.user_id,
          "username": user_context.username,
          "role": user_context.role,
          "departmentId": user_context.department_id,
        },
        "args": {"file_ids": file_ids},
      },
      trace_id=trace_id,
    )
  except AgentToolError as exc:
    return {}, str(exc)

  files = payload.get("files") if isinstance(payload.get("files"), list) else []
  out: dict[int, str] = {}
  for row in files:
    if not isinstance(row, dict):
      continue
    try:
      file_id = int(row.get("fileId"))
    except Exception:
      continue
    if file_id <= 0:
      continue
    filename = str(row.get("filename") or "").strip() or f"file #{file_id}"
    out[file_id] = filename
  return out, None


async def _resolve_project_wizard_plan(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
  history: list[dict[str, Any]],
  last_user_text: str,
) -> dict[str, Any]:
  options = await _fetch_project_wizard_options(request, trace_id=trace_id, user_context=user_context)
  configurable = options.get("configurable") if isinstance(options.get("configurable"), dict) else {}
  file_types_raw = configurable.get("fileTypes") if isinstance(configurable.get("fileTypes"), list) else []
  assignment_cfg = configurable.get("assignment") if isinstance(configurable.get("assignment"), dict) else {}
  engines_raw = configurable.get("translationEngines") if isinstance(configurable.get("translationEngines"), list) else []
  rulesets_raw = configurable.get("rulesets") if isinstance(configurable.get("rulesets"), list) else []
  tmx_raw = configurable.get("tmx") if isinstance(configurable.get("tmx"), list) else []
  termbases_raw = configurable.get("termbases") if isinstance(configurable.get("termbases"), list) else []
  defaults_cfg = configurable.get("defaults") if isinstance(configurable.get("defaults"), dict) else {}
  availability_cfg = configurable.get("availability") if isinstance(configurable.get("availability"), dict) else {}

  assignable_users = [entry for entry in assignment_cfg.get("assignableUsers", []) if isinstance(entry, dict)]
  default_owner = assignment_cfg.get("defaultOwner") if isinstance(assignment_cfg.get("defaultOwner"), dict) else {}
  can_assign_others = bool(assignment_cfg.get("canAssignOthers"))
  engines = [entry for entry in engines_raw if isinstance(entry, dict)]
  rulesets = [entry for entry in rulesets_raw if isinstance(entry, dict)]
  tmx_entries = [entry for entry in tmx_raw if isinstance(entry, dict)]
  termbases = [entry for entry in termbases_raw if isinstance(entry, dict)]

  file_type_summaries: list[str] = []
  for entry in file_types_raw:
    if not isinstance(entry, dict):
      continue
    file_type = str(entry.get("fileType") or "").strip().upper()
    extensions = entry.get("extensions") if isinstance(entry.get("extensions"), list) else []
    ext_text = ", ".join(str(ext) for ext in extensions if str(ext).strip())
    if file_type and ext_text:
      file_type_summaries.append(f"{file_type}: {ext_text}")

  language_cfg = _extract_workspace_languages(options)
  enabled_languages = language_cfg.get("enabled") if isinstance(language_cfg.get("enabled"), list) else []
  allowed_languages = set(enabled_languages)
  default_source = language_cfg.get("default_source")
  default_targets = language_cfg.get("default_targets") if isinstance(language_cfg.get("default_targets"), list) else []
  default_engine_id = int(defaults_cfg.get("translationEngineId")) if str(defaults_cfg.get("translationEngineId") or "").isdigit() else None
  default_ruleset_id = int(defaults_cfg.get("rulesetId")) if str(defaults_cfg.get("rulesetId") or "").isdigit() else None
  default_owner_id = int(defaults_cfg.get("ownerUserId")) if str(defaults_cfg.get("ownerUserId") or "").isdigit() else None

  wizard_context = _extract_wizard_context_from_history(history)
  prev_state_raw = wizard_context.get("state") if isinstance(wizard_context, dict) else None
  state = _normalize_project_wizard_state(prev_state_raw if isinstance(prev_state_raw, dict) else None)
  if not state.get("source_lang"):
    state["source_lang"] = default_source
  if not state.get("owner_user_id") and default_owner_id:
    state["owner_user_id"] = default_owner_id
  if not state.get("owner_username"):
    state["owner_username"] = str(default_owner.get("username") or user_context.username)

  raw = str(last_user_text or "").strip()
  if _is_cancel_intent(raw):
    return {
      "mode": "direct",
      "message": "Project setup wizard cancelled. Say 'create project' when you want to start again.",
      "content_json": _wizard_content_json(state, active=False, step="cancelled"),
    }

  state_changed = False
  current_step = str(wizard_context.get("step") if wizard_context else "").strip().lower()

  incoming_file_ids = _extract_file_ids(raw)
  if incoming_file_ids:
    merged_ids = _dedupe_positive_ints(state["file_ids"] + incoming_file_ids)
    if merged_ids != state["file_ids"]:
      state["file_ids"] = merged_ids
      state_changed = True
  file_describe_error: str | None = None
  if state["file_ids"] and (state_changed or not state.get("file_names")):
    described, describe_error = await _describe_wizard_files(
      request,
      trace_id=trace_id,
      user_context=user_context,
      file_ids=state["file_ids"],
    )
    if describe_error:
      file_describe_error = describe_error
    if described:
      state["file_names"] = {str(file_id): name for file_id, name in described.items()}
      state_changed = True

  source_error: str | None = None
  parsed_source = _extract_source_lang(raw)
  if parsed_source:
    if allowed_languages and parsed_source not in allowed_languages:
      source_error = f"Source language `{parsed_source}` is not enabled. Ask a manager/admin to enable it."
    elif parsed_source != state.get("source_lang"):
      state["source_lang"] = parsed_source
      state_changed = True

  target_error: str | None = None
  invalid_target_langs: list[str] = []
  assignment_intent = bool(re.search(r"\b(assign|owner|assignee)\b", raw, re.IGNORECASE))
  parsed_targets = _extract_target_langs(raw)
  if (
    not parsed_targets
    and not assignment_intent
    and (current_step == "target_languages" or re.search(r"\b(?:target|targets?)\b", raw, re.IGNORECASE))
  ):
    parsed_targets = _extract_lang_mentions(raw, None)
  if parsed_targets:
    normalized_targets: list[str] = []
    for entry in parsed_targets:
      normalized = _normalize_lang_tag(entry)
      if not normalized or normalized in normalized_targets:
        continue
      normalized_targets.append(normalized)

    valid_targets: list[str] = []
    for target in normalized_targets:
      if allowed_languages and target not in allowed_languages:
        invalid_target_langs.append(target)
        continue
      if state.get("source_lang") and target == state.get("source_lang"):
        continue
      valid_targets.append(target)

    if valid_targets and valid_targets != state["target_langs"]:
      state["target_langs"] = valid_targets
      state_changed = True
    if invalid_target_langs and not valid_targets:
      primary = invalid_target_langs[0]
      alternatives = _language_alternatives(primary, enabled_languages)
      alt_text = f" Suggested alternatives: {', '.join(alternatives)}." if alternatives else ""
      target_error = f"Language `{primary}` is not enabled.{alt_text} A manager/admin can enable it in Language Settings."

  if state.get("source_lang") and state.get("target_langs"):
    filtered_existing = [entry for entry in state["target_langs"] if entry != state["source_lang"]]
    if filtered_existing != state["target_langs"]:
      state["target_langs"] = filtered_existing
      state_changed = True

  due_error: str | None = None
  if current_step == "due_date" or re.search(r"\bdue\b", raw, re.IGNORECASE):
    due_parsed = _parse_due_at_text(raw)
    if due_parsed["status"] == "ok":
      due_iso = str(due_parsed.get("iso") or "").strip()
      if due_iso != state.get("due_at"):
        state["due_at"] = due_iso
        state_changed = True
      if not state.get("due_done"):
        state["due_done"] = True
        state_changed = True
    elif due_parsed["status"] == "skip":
      if state.get("due_at") is not None:
        state["due_at"] = None
        state_changed = True
      if not state.get("due_done"):
        state["due_done"] = True
        state_changed = True
    elif due_parsed["status"] == "invalid":
      due_error = "I could not parse that date/time. Please share an ISO-like date/time, or `skip`."

  assignment_error: str | None = None
  assignment_restriction_message: str | None = None
  if can_assign_others:
    if current_step == "assignment" or re.search(r"\b(assign|owner|assignee)\b", raw, re.IGNORECASE):
      choice = _parse_assignee_choice(raw, assignable_users)
      if choice.get("action") in {"default", "self"}:
        selected_owner_id = default_owner_id or user_context.user_id
        selected_owner_name = str(default_owner.get("username") or user_context.username)
        if state.get("owner_user_id") != selected_owner_id:
          state["owner_user_id"] = selected_owner_id
          state_changed = True
        if selected_owner_name and state.get("owner_username") != selected_owner_name:
          state["owner_username"] = selected_owner_name
          state_changed = True
        if not state.get("assignment_done"):
          state["assignment_done"] = True
          state_changed = True
      elif choice.get("action") == "select":
        selected_id = int(choice.get("id"))
        selected_user = next((entry for entry in assignable_users if int(entry.get("userId", 0)) == selected_id), None)
        if selected_user:
          selected_username = str(selected_user.get("username") or "").strip()
          if state.get("owner_user_id") != selected_id:
            state["owner_user_id"] = selected_id
            state_changed = True
          if selected_username and state.get("owner_username") != selected_username:
            state["owner_username"] = selected_username
            state_changed = True
          if not state.get("assignment_done"):
            state["assignment_done"] = True
            state_changed = True
      elif raw and current_step == "assignment":
        assignment_error = "Please choose a user by ID or username from the assignable list."
  else:
    if re.search(r"\b(assign|owner|assignee)\b", raw, re.IGNORECASE) and not re.search(
      r"\b(me|myself|self)\b", raw, re.IGNORECASE
    ):
      assignment_restriction_message = (
        "Only managers/admins can assign projects to other users. I'll create it for you, or ask a manager/admin to create/assign it."
      )
    if state.get("owner_user_id") != user_context.user_id:
      state["owner_user_id"] = user_context.user_id
      state_changed = True
    if state.get("owner_username") != user_context.username:
      state["owner_username"] = user_context.username
      state_changed = True
    if not state.get("assignment_done"):
      state["assignment_done"] = True
      state_changed = True

  engine_error: str | None = None
  has_engines = bool(availability_cfg.get("hasEngines", len(engines) > 0))
  if has_engines and (current_step == "translation_engine" or re.search(r"\bengine\b", raw, re.IGNORECASE)):
    choice = _parse_option_choice(raw, engines)
    if choice.get("action") == "select":
      selected_engine_id = int(choice.get("id"))
      if state.get("translation_engine_id") != selected_engine_id:
        state["translation_engine_id"] = selected_engine_id
        state_changed = True
      if not state.get("engine_done"):
        state["engine_done"] = True
        state_changed = True
    elif choice.get("action") in {"default", "skip"}:
      fallback_engine_id = default_engine_id
      if fallback_engine_id is None and engines:
        fallback_engine_id = int(engines[0].get("id"))
      if fallback_engine_id is None:
        engine_error = (
          "No translation engine is configured/enabled for your account/project scope. A manager/admin can enable it for you."
        )
      else:
        if state.get("translation_engine_id") != fallback_engine_id:
          state["translation_engine_id"] = fallback_engine_id
          state_changed = True
        if not state.get("engine_done"):
          state["engine_done"] = True
          state_changed = True
    elif raw and current_step == "translation_engine":
      engine_error = "Please choose a translation engine by ID or name."
  if not has_engines:
    state["engine_done"] = False

  rules_error: str | None = None
  if rulesets and (current_step == "ruleset" or re.search(r"\b(?:rules?|ruleset)\b", raw, re.IGNORECASE)):
    choice = _parse_option_choice(raw, rulesets)
    if choice.get("action") == "select":
      selected_ruleset_id = int(choice.get("id"))
      if state.get("ruleset_id") != selected_ruleset_id:
        state["ruleset_id"] = selected_ruleset_id
        state_changed = True
      if not state.get("rules_done"):
        state["rules_done"] = True
        state_changed = True
    elif choice.get("action") in {"skip", "none"}:
      if state.get("ruleset_id") is not None:
        state["ruleset_id"] = None
        state_changed = True
      if not state.get("rules_done"):
        state["rules_done"] = True
        state_changed = True
    elif choice.get("action") == "default":
      resolved_ruleset = default_ruleset_id if default_ruleset_id is not None else int(rulesets[0].get("id"))
      if state.get("ruleset_id") != resolved_ruleset:
        state["ruleset_id"] = resolved_ruleset
        state_changed = True
      if not state.get("rules_done"):
        state["rules_done"] = True
        state_changed = True
    elif raw and current_step == "ruleset":
      rules_error = "Please choose a ruleset by ID or name, or `skip`."

  tmx_error: str | None = None
  if tmx_entries and (current_step == "tmx" or re.search(r"\b(?:tmx|tm)\b", raw, re.IGNORECASE)):
    choice = _parse_option_choice(raw, tmx_entries)
    if choice.get("action") == "select":
      selected_tmx_id = int(choice.get("id"))
      if state.get("tmx_id") != selected_tmx_id:
        state["tmx_id"] = selected_tmx_id
        state_changed = True
      if not state.get("tmx_done"):
        state["tmx_done"] = True
        state_changed = True
    elif choice.get("action") in {"skip", "none", "default"}:
      if state.get("tmx_id") is not None:
        state["tmx_id"] = None
        state_changed = True
      if not state.get("tmx_done"):
        state["tmx_done"] = True
        state_changed = True
    elif raw and current_step == "tmx":
      tmx_error = "Please choose a TMX by ID, or `skip` for none."

  termbase_error: str | None = None
  if termbases and (current_step == "termbase" or re.search(r"\btermbase|glossary|terminology\b", raw, re.IGNORECASE)):
    choice = _parse_option_choice(raw, termbases, label_keys=("label", "name"))
    if choice.get("action") == "select":
      selected_termbase_id = int(choice.get("id"))
      if state.get("termbase_id") != selected_termbase_id:
        state["termbase_id"] = selected_termbase_id
        state_changed = True
      if not state.get("termbase_done"):
        state["termbase_done"] = True
        state_changed = True
    elif choice.get("action") in {"skip", "none", "default"}:
      if state.get("termbase_id") is not None:
        state["termbase_id"] = None
        state_changed = True
      if not state.get("termbase_done"):
        state["termbase_done"] = True
        state_changed = True
    elif raw and current_step == "termbase":
      termbase_error = "Please choose a termbase by ID, or `skip` for none."

  if state_changed:
    state["awaiting_confirm"] = False

  if file_describe_error:
    return {
      "mode": "direct",
      "message": f"{file_describe_error}\nProjects require at least one file. Please upload/select a file first.",
      "content_json": _wizard_content_json(state, active=True, step="files"),
    }

  if not state["file_ids"]:
    message_parts = [
      "Projects require at least one file. Please upload/select a file first.",
      "Share one or more file IDs to continue.",
    ]
    if file_type_summaries:
      message_parts.append("Configured upload types: " + "; ".join(file_type_summaries))
    message_parts.append("Example: file IDs 101, 102")
    return {
      "mode": "direct",
      "message": "\n".join(message_parts),
      "content_json": _wizard_content_json(state, active=True, step="files"),
    }

  if source_error:
    return {
      "mode": "direct",
      "message": source_error,
      "content_json": _wizard_content_json(state, active=True, step="target_languages"),
    }

  if target_error:
    return {
      "mode": "direct",
      "message": target_error,
      "content_json": _wizard_content_json(state, active=True, step="target_languages"),
    }

  if not state["target_langs"]:
    hint = f" Suggested targets: {', '.join(default_targets)}." if default_targets else ""
    return {
      "mode": "direct",
      "message": f"Which target languages do you need?{hint}",
      "content_json": _wizard_content_json(state, active=True, step="target_languages"),
    }

  if not state.get("due_done"):
    if due_error:
      return {
        "mode": "direct",
        "message": due_error,
        "content_json": _wizard_content_json(state, active=True, step="due_date"),
      }
    return {
      "mode": "direct",
      "message": "What's the due date/time? Reply with a date/time, or `skip`.",
      "content_json": _wizard_content_json(state, active=True, step="due_date"),
    }

  if assignment_restriction_message:
    return {
      "mode": "direct",
      "message": assignment_restriction_message,
      "content_json": _wizard_content_json(state, active=True, step="assignment"),
    }

  if not state.get("assignment_done"):
    if assignment_error:
      return {
        "mode": "direct",
        "message": assignment_error,
        "content_json": _wizard_content_json(state, active=True, step="assignment"),
      }
    if can_assign_others:
      suggestions: list[str] = []
      for entry in assignable_users[:5]:
        try:
          suggestions.append(f"{int(entry.get('userId'))} ({str(entry.get('username') or '').strip()})")
        except Exception:
          continue
      suggestion_text = f" Available: {', '.join(suggestions)}." if suggestions else ""
      return {
        "mode": "direct",
        "message": "Who should this project be assigned to / owned by?" + suggestion_text,
        "content_json": _wizard_content_json(state, active=True, step="assignment"),
      }

  if not has_engines:
    return {
      "mode": "direct",
      "message": "No translation engine is configured/enabled for your account/project scope. A manager/admin can enable it for you.",
      "content_json": _wizard_content_json(state, active=True, step="translation_engine"),
    }

  if not state.get("engine_done"):
    if engine_error:
      return {
        "mode": "direct",
        "message": engine_error,
        "content_json": _wizard_content_json(state, active=True, step="translation_engine"),
      }
    engine_suggestions = [f"{int(entry.get('id'))} ({str(entry.get('name') or '').strip()})" for entry in engines[:5]]
    suggestion_text = f" Available engines: {', '.join(engine_suggestions)}." if engine_suggestions else ""
    return {
      "mode": "direct",
      "message": "Which translation engine should I use?" + suggestion_text,
      "content_json": _wizard_content_json(state, active=True, step="translation_engine"),
    }

  rules_warning: str | None = None
  if not state.get("rules_done"):
    if rulesets:
      if rules_error:
        return {
          "mode": "direct",
          "message": rules_error,
          "content_json": _wizard_content_json(state, active=True, step="ruleset"),
        }
      rule_suggestions = [f"{int(entry.get('id'))} ({str(entry.get('name') or '').strip()})" for entry in rulesets[:5]]
      suggestion_text = f" Available rulesets: {', '.join(rule_suggestions)}." if rule_suggestions else ""
      return {
        "mode": "direct",
        "message": "Select a ruleset, or `skip` to continue without rules." + suggestion_text,
        "content_json": _wizard_content_json(state, active=True, step="ruleset"),
      }
    state["rules_done"] = True
    state["ruleset_id"] = None
    rules_warning = "No rulesets are available. Continuing without rules."

  tmx_warning: str | None = None
  if not state.get("tmx_done"):
    if tmx_entries:
      if tmx_error:
        return {
          "mode": "direct",
          "message": tmx_error,
          "content_json": _wizard_content_json(state, active=True, step="tmx"),
        }
      tmx_suggestions = [f"{int(entry.get('id'))} ({str(entry.get('label') or '').strip()})" for entry in tmx_entries[:5]]
      suggestion_text = f" Available TMX: {', '.join(tmx_suggestions)}." if tmx_suggestions else ""
      return {
        "mode": "direct",
        "message": "Use an existing TMX? Reply with ID, or `skip` for none." + suggestion_text,
        "content_json": _wizard_content_json(state, active=True, step="tmx"),
      }
    state["tmx_done"] = True
    state["tmx_id"] = None
    tmx_warning = "TMX is not enabled for your account/project scope. A manager/admin can enable it for you."

  termbase_warning: str | None = None
  if not state.get("termbase_done"):
    if termbases:
      if termbase_error:
        return {
          "mode": "direct",
          "message": termbase_error,
          "content_json": _wizard_content_json(state, active=True, step="termbase"),
        }
      termbase_suggestions = [
        f"{int(entry.get('id'))} ({str(entry.get('label') or entry.get('name') or '').strip()})"
        for entry in termbases[:5]
      ]
      suggestion_text = f" Available termbases: {', '.join(termbase_suggestions)}." if termbase_suggestions else ""
      return {
        "mode": "direct",
        "message": "Use a termbase? Reply with ID, or `skip` for none." + suggestion_text,
        "content_json": _wizard_content_json(state, active=True, step="termbase"),
      }
    state["termbase_done"] = True
    state["termbase_id"] = None
    termbase_warning = "Termbase is not enabled for your account/project scope. A manager/admin can enable it for you."

  if state_changed:
    state["awaiting_confirm"] = False

  args: dict[str, Any] = {
    "source_lang": state["source_lang"] or default_source,
    "target_langs": state["target_langs"],
    "file_ids": state["file_ids"],
    "due_at": state.get("due_at"),
    "assigned_user_id": state.get("owner_user_id"),
    "translation_engine_id": state.get("translation_engine_id"),
    "ruleset_id": state.get("ruleset_id"),
    "tmx_id": state.get("tmx_id"),
    "termbase_id": state.get("termbase_id"),
  }
  if not args.get("due_at"):
    args.pop("due_at", None)

  file_names = [
    str(state.get("file_names", {}).get(str(file_id)) or f"file #{file_id}")
    for file_id in state.get("file_ids", [])
  ]
  engine_label = _resource_label_by_id(engines, state.get("translation_engine_id"))
  ruleset_label = _resource_label_by_id(rulesets, state.get("ruleset_id"))
  tmx_label = _resource_label_by_id(tmx_entries, state.get("tmx_id"))
  termbase_label = _resource_label_by_id(termbases, state.get("termbase_id"))
  due_display = str(state.get("due_at") or "none")
  owner_display = str(state.get("owner_username") or user_context.username)

  summary_lines: list[str] = []
  for warning in [rules_warning, tmx_warning, termbase_warning]:
    if warning:
      summary_lines.append(f"Notice: {warning}")
  summary_lines.extend(
    [
      "Create the project with these settings?",
      f"Files: {len(state['file_ids'])} ({', '.join(file_names)})",
      f"Source + targets: {args.get('source_lang') or 'auto'} -> {', '.join(state['target_langs'])}",
      f"Due date: {due_display}",
      f"Owner/assignee: {owner_display}",
      f"Engine: {engine_label or state.get('translation_engine_id') or 'none'}",
      f"Ruleset: {ruleset_label or 'none'}",
      f"TMX: {tmx_label or 'none'}",
      f"Termbase: {termbase_label or 'none'}",
    ]
  )

  if state["awaiting_confirm"] and _is_affirmative(raw):
    return {
      "mode": "tool",
      "tool_name": "create_project",
      "args": args,
      "content_json": _wizard_content_json(state, active=False, step="completed"),
    }

  state["awaiting_confirm"] = True
  summary_lines.append("Reply `create` to continue, or tell me what to change.")
  return {
    "mode": "direct",
    "message": "\n".join(summary_lines),
    "content_json": _wizard_content_json(state, active=True, step="confirm"),
  }


async def _resolve_project_wizard_plan_v2(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
  history: list[dict[str, Any]],
  last_user_text: str,
) -> dict[str, Any]:
  options = await _fetch_project_wizard_options(request, trace_id=trace_id, user_context=user_context)
  configurable = options.get("configurable") if isinstance(options.get("configurable"), dict) else {}
  file_types_raw = configurable.get("fileTypes") if isinstance(configurable.get("fileTypes"), list) else []
  assignment_cfg = configurable.get("assignment") if isinstance(configurable.get("assignment"), dict) else {}
  engines_raw = configurable.get("translationEngines") if isinstance(configurable.get("translationEngines"), list) else []
  rulesets_raw = configurable.get("rulesets") if isinstance(configurable.get("rulesets"), list) else []
  tmx_raw = configurable.get("tmx") if isinstance(configurable.get("tmx"), list) else []
  termbases_raw = configurable.get("termbases") if isinstance(configurable.get("termbases"), list) else []
  defaults_cfg = configurable.get("defaults") if isinstance(configurable.get("defaults"), dict) else {}
  availability_cfg = configurable.get("availability") if isinstance(configurable.get("availability"), dict) else {}

  assignable_users = [entry for entry in assignment_cfg.get("assignableUsers", []) if isinstance(entry, dict)]
  default_owner = assignment_cfg.get("defaultOwner") if isinstance(assignment_cfg.get("defaultOwner"), dict) else {}
  can_assign_others = bool(assignment_cfg.get("canAssignOthers"))
  engines = [entry for entry in engines_raw if isinstance(entry, dict)]
  rulesets = [entry for entry in rulesets_raw if isinstance(entry, dict)]
  tmx_entries = [entry for entry in tmx_raw if isinstance(entry, dict)]
  termbases = [entry for entry in termbases_raw if isinstance(entry, dict)]

  file_type_summaries: list[str] = []
  for entry in file_types_raw:
    if not isinstance(entry, dict):
      continue
    file_type = str(entry.get("fileType") or "").strip().upper()
    extensions = entry.get("extensions") if isinstance(entry.get("extensions"), list) else []
    ext_text = ", ".join(str(ext) for ext in extensions if str(ext).strip())
    if file_type and ext_text:
      file_type_summaries.append(f"{file_type}: {ext_text}")

  language_cfg = _extract_workspace_languages(options)
  enabled_languages = language_cfg.get("enabled") if isinstance(language_cfg.get("enabled"), list) else []
  allowed_languages = set(enabled_languages)
  default_source = language_cfg.get("default_source")
  default_targets = language_cfg.get("default_targets") if isinstance(language_cfg.get("default_targets"), list) else []
  default_engine_id = int(defaults_cfg.get("translationEngineId")) if str(defaults_cfg.get("translationEngineId") or "").isdigit() else None
  default_ruleset_id = int(defaults_cfg.get("rulesetId")) if str(defaults_cfg.get("rulesetId") or "").isdigit() else None
  default_owner_id = int(defaults_cfg.get("ownerUserId")) if str(defaults_cfg.get("ownerUserId") or "").isdigit() else None

  wizard_context = _extract_wizard_context_from_history(history)
  prev_state_raw = wizard_context.get("state") if isinstance(wizard_context, dict) else None
  state = _normalize_project_wizard_state(prev_state_raw if isinstance(prev_state_raw, dict) else None)
  if not state.get("source_lang"):
    state["source_lang"] = default_source
  if not state.get("owner_user_id") and default_owner_id:
    state["owner_user_id"] = default_owner_id
  if not state.get("owner_username"):
    state["owner_username"] = str(default_owner.get("username") or user_context.username)

  raw = str(last_user_text or "").strip()
  if _is_cancel_intent(raw):
    return {
      "mode": "direct",
      "message": "Project setup wizard cancelled. Say 'create project' when you want to start again.",
      "content_json": _wizard_content_json(state, active=False, step="cancelled"),
    }

  state_changed = False
  current_step = str(wizard_context.get("step") if wizard_context else "").strip().lower()

  def _message_with_notices(message: str, notices: list[str]) -> str:
    clean = [str(entry or "").strip() for entry in notices if str(entry or "").strip()]
    if not clean:
      return message
    if message:
      return "\n".join(clean + ["", message])
    return "\n".join(clean)

  uploaded_file_names = _extract_uploaded_files_from_history(history)
  incoming_file_ids = _extract_file_ids(raw)
  merged_ids = _dedupe_positive_ints(state["file_ids"] + incoming_file_ids + list(uploaded_file_names.keys()))
  if merged_ids != state["file_ids"]:
    state["file_ids"] = merged_ids
    state_changed = True
  for uploaded_file_id, uploaded_name in uploaded_file_names.items():
    key = str(uploaded_file_id)
    if state["file_names"].get(key) != uploaded_name:
      state["file_names"][key] = uploaded_name
      state_changed = True

  file_describe_error: str | None = None
  missing_name_ids = [
    file_id
    for file_id in state["file_ids"]
    if not str(state.get("file_names", {}).get(str(file_id)) or "").strip()
  ]
  if state["file_ids"] and (state_changed or missing_name_ids):
    described, describe_error = await _describe_wizard_files(
      request,
      trace_id=trace_id,
      user_context=user_context,
      file_ids=state["file_ids"],
    )
    if describe_error:
      file_describe_error = describe_error
    if described:
      for file_id, name in described.items():
        key = str(file_id)
        if state["file_names"].get(key) != name:
          state["file_names"][key] = name
          state_changed = True

  known_file_names = [
    str(state.get("file_names", {}).get(str(file_id)) or f"file #{file_id}")
    for file_id in state.get("file_ids", [])
  ]
  suggested_title = _build_suggested_project_title(known_file_names)
  title_choice = _parse_project_title_choice(raw, suggested_title)
  explicit_title_skip = bool(current_step == "title" and _is_skip_choice(raw))
  title_error: str | None = None
  if title_choice.get("action") == "set":
    resolved_title = str(title_choice.get("title") or "").strip()
    if resolved_title and resolved_title != state.get("project_name"):
      state["project_name"] = resolved_title
      state_changed = True
    if not state.get("title_done"):
      state["title_done"] = True
      state_changed = True
  elif title_choice.get("action") == "suggested":
    if suggested_title:
      if state.get("project_name") != suggested_title:
        state["project_name"] = suggested_title
        state_changed = True
      if not state.get("title_done"):
        state["title_done"] = True
        state_changed = True
  elif current_step == "title" and raw and not state.get("title_done"):
    has_other_progress = bool(
      incoming_file_ids
      or uploaded_file_names
      or _extract_target_langs(raw)
      or _extract_source_lang(raw)
      or re.search(r"\b(assign|owner|assignee|engine|llm|rules?|tmx|termbase|glossary|terminology)\b", raw, re.IGNORECASE)
    )
    if not has_other_progress and not explicit_title_skip:
      title_error = "Please give me a project title, or say `skip` and I'll suggest one from the uploaded file name."

  source_error: str | None = None
  parsed_source = _extract_source_lang(raw)
  if parsed_source:
    if allowed_languages and parsed_source not in allowed_languages:
      source_error = f"Source language `{parsed_source}` is not enabled. Ask a manager/admin to enable it."
    elif parsed_source != state.get("source_lang"):
      state["source_lang"] = parsed_source
      state_changed = True

  target_error: str | None = None
  invalid_target_langs: list[str] = []
  assignment_intent = bool(re.search(r"\b(assign|owner|assignee)\b", raw, re.IGNORECASE))
  parsed_targets = _extract_target_langs(raw)
  if (
    not parsed_targets
    and not assignment_intent
    and (current_step == "target_languages" or re.search(r"\b(?:target|targets?)\b", raw, re.IGNORECASE))
  ):
    parsed_targets = _extract_lang_mentions(raw, None)
  if parsed_targets:
    normalized_targets: list[str] = []
    for entry in parsed_targets:
      normalized = _normalize_lang_tag(entry)
      if not normalized or normalized in normalized_targets:
        continue
      normalized_targets.append(normalized)

    valid_targets: list[str] = []
    for target in normalized_targets:
      if allowed_languages and target not in allowed_languages:
        invalid_target_langs.append(target)
        continue
      if state.get("source_lang") and target == state.get("source_lang"):
        continue
      valid_targets.append(target)

    if valid_targets and valid_targets != state["target_langs"]:
      state["target_langs"] = valid_targets
      state_changed = True
    if invalid_target_langs and not valid_targets:
      primary = invalid_target_langs[0]
      alternatives = _language_alternatives(primary, enabled_languages)
      alt_text = f" Suggested alternatives: {', '.join(alternatives)}." if alternatives else ""
      target_error = f"Language `{primary}` is not enabled.{alt_text} A manager/admin can enable it in Language Settings."

  if state.get("source_lang") and state.get("target_langs"):
    filtered_existing = [entry for entry in state["target_langs"] if entry != state["source_lang"]]
    if filtered_existing != state["target_langs"]:
      state["target_langs"] = filtered_existing
      state_changed = True

  assignment_error: str | None = None
  assignment_restriction_message: str | None = None
  assignment_notice: str | None = None
  if can_assign_others:
    if current_step == "assignment" or re.search(r"\b(assign|owner|assignee)\b", raw, re.IGNORECASE):
      choice = _parse_assignee_choice(raw, assignable_users)
      if choice.get("action") in {"default", "self"}:
        selected_owner_id = default_owner_id or user_context.user_id
        selected_owner_name = str(default_owner.get("username") or user_context.username)
        if state.get("owner_user_id") != selected_owner_id:
          state["owner_user_id"] = selected_owner_id
          state_changed = True
        if selected_owner_name and state.get("owner_username") != selected_owner_name:
          state["owner_username"] = selected_owner_name
          state_changed = True
        if not state.get("assignment_done"):
          state["assignment_done"] = True
          state_changed = True
      elif choice.get("action") == "select":
        selected_id = int(choice.get("id"))
        selected_user = next((entry for entry in assignable_users if int(entry.get("userId", 0)) == selected_id), None)
        if selected_user:
          selected_username = str(selected_user.get("username") or "").strip()
          if state.get("owner_user_id") != selected_id:
            state["owner_user_id"] = selected_id
            state_changed = True
          if selected_username and state.get("owner_username") != selected_username:
            state["owner_username"] = selected_username
            state_changed = True
          if not state.get("assignment_done"):
            state["assignment_done"] = True
            state_changed = True
      elif raw and current_step == "assignment":
        assignment_error = "Please choose a user by ID or username from the assignable list."
  else:
    if re.search(r"\b(assign|owner|assignee)\b", raw, re.IGNORECASE) and not re.search(
      r"\b(me|myself|self)\b", raw, re.IGNORECASE
    ):
      assignment_restriction_message = (
        "With your role, this project can only stay assigned to you. A manager or admin can assign it to someone else."
      )
    if state.get("owner_user_id") != user_context.user_id:
      state["owner_user_id"] = user_context.user_id
      state_changed = True
    if state.get("owner_username") != user_context.username:
      state["owner_username"] = user_context.username
      state_changed = True
    if not state.get("assignment_done"):
      state["assignment_done"] = True
      state_changed = True
      assignment_notice = f"With your role, this project has to stay assigned to you, so I'll keep {user_context.username} as the assignee."

  engine_error: str | None = None
  has_engines = bool(availability_cfg.get("hasEngines", len(engines) > 0))
  if has_engines and (
    current_step == "translation_engine"
    or re.search(r"\b(?:engine|llm|model|mt)\b", raw, re.IGNORECASE)
  ):
    choice = _parse_option_choice(raw, engines)
    if choice.get("action") == "select":
      selected_engine_id = int(choice.get("id"))
      if state.get("translation_engine_id") != selected_engine_id:
        state["translation_engine_id"] = selected_engine_id
        state_changed = True
      if not state.get("engine_done"):
        state["engine_done"] = True
        state_changed = True
    elif choice.get("action") == "default":
      resolved_engine_id = default_engine_id if default_engine_id is not None else int(engines[0].get("id"))
      if state.get("translation_engine_id") != resolved_engine_id:
        state["translation_engine_id"] = resolved_engine_id
        state_changed = True
      if not state.get("engine_done"):
        state["engine_done"] = True
        state_changed = True
    elif choice.get("action") in {"skip", "none"}:
      if state.get("translation_engine_id") is not None:
        state["translation_engine_id"] = None
        state_changed = True
      if not state.get("engine_done"):
        state["engine_done"] = True
        state_changed = True
    elif raw and current_step == "translation_engine":
      engine_error = "Please choose a translation engine by ID or name, or say `skip`."
  if not has_engines and state.get("translation_engine_id") is not None:
    state["translation_engine_id"] = None
    state_changed = True

  rules_error: str | None = None
  if rulesets and (current_step == "ruleset" or re.search(r"\b(?:rules?|ruleset)\b", raw, re.IGNORECASE)):
    choice = _parse_option_choice(raw, rulesets)
    if choice.get("action") == "select":
      selected_ruleset_id = int(choice.get("id"))
      if state.get("ruleset_id") != selected_ruleset_id:
        state["ruleset_id"] = selected_ruleset_id
        state_changed = True
      if not state.get("rules_done"):
        state["rules_done"] = True
        state_changed = True
    elif choice.get("action") in {"skip", "none"}:
      if state.get("ruleset_id") is not None:
        state["ruleset_id"] = None
        state_changed = True
      if not state.get("rules_done"):
        state["rules_done"] = True
        state_changed = True
    elif choice.get("action") == "default":
      resolved_ruleset = default_ruleset_id if default_ruleset_id is not None else int(rulesets[0].get("id"))
      if state.get("ruleset_id") != resolved_ruleset:
        state["ruleset_id"] = resolved_ruleset
        state_changed = True
      if not state.get("rules_done"):
        state["rules_done"] = True
        state_changed = True
    elif raw and current_step == "ruleset":
      rules_error = "Please choose a ruleset by ID or name, or say `skip`."

  tmx_error: str | None = None
  if tmx_entries and (current_step == "tmx" or re.search(r"\b(?:tmx|tm)\b", raw, re.IGNORECASE)):
    choice = _parse_option_choice(raw, tmx_entries)
    if choice.get("action") == "select":
      selected_tmx_id = int(choice.get("id"))
      if state.get("tmx_id") != selected_tmx_id:
        state["tmx_id"] = selected_tmx_id
        state_changed = True
      if not state.get("tmx_done"):
        state["tmx_done"] = True
        state_changed = True
    elif choice.get("action") in {"skip", "none", "default"}:
      if state.get("tmx_id") is not None:
        state["tmx_id"] = None
        state_changed = True
      if not state.get("tmx_done"):
        state["tmx_done"] = True
        state_changed = True
    elif raw and current_step == "tmx":
      tmx_error = "Please choose a TMX by ID or name, or say `skip`."

  termbase_error: str | None = None
  if termbases and (current_step == "termbase" or re.search(r"\b(?:termbase|glossary|terminology)\b", raw, re.IGNORECASE)):
    choice = _parse_option_choice(raw, termbases, label_keys=("label", "name"))
    if choice.get("action") == "select":
      selected_termbase_id = int(choice.get("id"))
      if state.get("termbase_id") != selected_termbase_id:
        state["termbase_id"] = selected_termbase_id
        state_changed = True
      if not state.get("termbase_done"):
        state["termbase_done"] = True
        state_changed = True
    elif choice.get("action") in {"skip", "none", "default"}:
      if state.get("termbase_id") is not None:
        state["termbase_id"] = None
        state_changed = True
      if not state.get("termbase_done"):
        state["termbase_done"] = True
        state_changed = True
    elif raw and current_step == "termbase":
      termbase_error = "Please choose a termbase by ID or name, or say `skip`."

  if state_changed:
    state["awaiting_confirm"] = False

  if file_describe_error:
    return {
      "mode": "direct",
      "message": f"{file_describe_error}\nProjects require at least one uploaded file. Please upload or select a file first.",
      "content_json": _wizard_content_json(state, active=True, step="files"),
    }
  if title_error:
    return {
      "mode": "direct",
      "message": title_error,
      "content_json": _wizard_content_json(state, active=True, step="title"),
    }

  title_deferred = bool(explicit_title_skip and not state.get("project_name") and not suggested_title)
  if not state.get("title_done") and not title_deferred:
    if suggested_title:
      title_prompt = (
        f'What should I call the project? I can use "{suggested_title}" based on the uploaded file. '
        "Reply with a title, or say `default`."
      )
    else:
      title_prompt = "What should I call the project? Reply with a title, or say `skip` and I'll choose one after you upload a file."
    return {
      "mode": "direct",
      "message": title_prompt,
      "content_json": _wizard_content_json(state, active=True, step="title"),
    }

  if not state["file_ids"]:
    message_parts = [
      "Projects require at least one uploaded file before I can create them.",
      "Please upload or select a file to continue.",
    ]
    if file_type_summaries:
      message_parts.append("Configured upload types: " + "; ".join(file_type_summaries))
    message_parts.append("If you already uploaded it here, send the file ID or tell me the upload is ready.")
    return {
      "mode": "direct",
      "message": "\n".join(message_parts),
      "content_json": _wizard_content_json(state, active=True, step="files"),
    }

  if not state.get("title_done"):
    follow_up = (
      f'What should I call the project? I can use "{suggested_title}" based on the uploaded file. '
      "Reply with a title, or say `default`."
      if suggested_title
      else "What should I call the project? Reply with a title."
    )
    return {
      "mode": "direct",
      "message": follow_up,
      "content_json": _wizard_content_json(state, active=True, step="title"),
    }

  if source_error:
    return {
      "mode": "direct",
      "message": source_error,
      "content_json": _wizard_content_json(state, active=True, step="target_languages"),
    }
  if target_error:
    return {
      "mode": "direct",
      "message": target_error,
      "content_json": _wizard_content_json(state, active=True, step="target_languages"),
    }
  if not state["target_langs"]:
    default_hint = f" Suggested targets: {', '.join(default_targets)}." if default_targets else ""
    enabled_hint = f" Use configured languages only: {', '.join(enabled_languages[:8])}." if enabled_languages else ""
    return {
      "mode": "direct",
      "message": f"Which target languages do you need?{default_hint}{enabled_hint}",
      "content_json": _wizard_content_json(state, active=True, step="target_languages"),
    }

  if assignment_restriction_message:
    return {
      "mode": "direct",
      "message": assignment_restriction_message,
      "content_json": _wizard_content_json(state, active=True, step="assignment"),
    }
  if not state.get("assignment_done"):
    if assignment_error:
      return {
        "mode": "direct",
        "message": assignment_error,
        "content_json": _wizard_content_json(state, active=True, step="assignment"),
      }
    if can_assign_others:
      suggestions: list[str] = []
      for entry in assignable_users[:6]:
        try:
          suggestions.append(f"{int(entry.get('userId'))} ({str(entry.get('username') or '').strip()})")
        except Exception:
          continue
      suggestion_text = f" Available assignees: {', '.join(suggestions)}." if suggestions else ""
      role_text = "You can keep it for yourself or assign it to another eligible user."
      return {
        "mode": "direct",
        "message": f"Who should I assign this project to? {role_text}{suggestion_text}",
        "content_json": _wizard_content_json(state, active=True, step="assignment"),
      }

  step_notices: list[str] = []
  if assignment_notice:
    step_notices.append(assignment_notice)

  if not state.get("engine_done"):
    if has_engines:
      if engine_error:
        return {
          "mode": "direct",
          "message": _message_with_notices(engine_error, step_notices),
          "content_json": _wizard_content_json(state, active=True, step="translation_engine"),
        }
      engine_suggestions = [f"{int(entry.get('id'))} ({str(entry.get('name') or '').strip()})" for entry in engines[:5]]
      suggestion_text = f" Available engines: {', '.join(engine_suggestions)}." if engine_suggestions else ""
      return {
        "mode": "direct",
        "message": _message_with_notices(
          "Should this project use a translation engine? Reply with an engine ID or name, or say `skip`."
          + suggestion_text,
          step_notices,
        ),
        "content_json": _wizard_content_json(state, active=True, step="translation_engine"),
      }
    state["engine_done"] = True
    state["translation_engine_id"] = None
    state["awaiting_confirm"] = False
    step_notices.append("No translation engine is configured right now, so I will continue without one. An admin can add one later.")

  if not state.get("rules_done"):
    if rulesets:
      if rules_error:
        return {
          "mode": "direct",
          "message": _message_with_notices(rules_error, step_notices),
          "content_json": _wizard_content_json(state, active=True, step="ruleset"),
        }
      rule_suggestions = [f"{int(entry.get('id'))} ({str(entry.get('name') or '').strip()})" for entry in rulesets[:5]]
      suggestion_text = f" Available rulesets: {', '.join(rule_suggestions)}." if rule_suggestions else ""
      return {
        "mode": "direct",
        "message": _message_with_notices(
          "Do you want to apply rules to this project? Reply with a ruleset ID or name, or say `skip`."
          + suggestion_text,
          step_notices,
        ),
        "content_json": _wizard_content_json(state, active=True, step="ruleset"),
      }
    state["rules_done"] = True
    state["ruleset_id"] = None
    state["awaiting_confirm"] = False
    step_notices.append("No rules are configured right now, so this project will run without rules.")

  if not state.get("tmx_done"):
    if tmx_entries:
      if tmx_error:
        return {
          "mode": "direct",
          "message": _message_with_notices(tmx_error, step_notices),
          "content_json": _wizard_content_json(state, active=True, step="tmx"),
        }
      tmx_suggestions = [f"{int(entry.get('id'))} ({str(entry.get('label') or '').strip()})" for entry in tmx_entries[:5]]
      suggestion_text = f" Available TMX: {', '.join(tmx_suggestions)}." if tmx_suggestions else ""
      return {
        "mode": "direct",
        "message": _message_with_notices(
          "Do you want to use a TMX resource? Reply with a TMX ID or name, or say `skip`."
          + suggestion_text,
          step_notices,
        ),
        "content_json": _wizard_content_json(state, active=True, step="tmx"),
      }
    state["tmx_done"] = True
    state["tmx_id"] = None
    state["awaiting_confirm"] = False
    step_notices.append("No TMX resource is configured right now.")

  if not state.get("termbase_done"):
    if termbases:
      if termbase_error:
        return {
          "mode": "direct",
          "message": _message_with_notices(termbase_error, step_notices),
          "content_json": _wizard_content_json(state, active=True, step="termbase"),
        }
      termbase_suggestions = [
        f"{int(entry.get('id'))} ({str(entry.get('label') or entry.get('name') or '').strip()})"
        for entry in termbases[:5]
      ]
      suggestion_text = f" Available termbases: {', '.join(termbase_suggestions)}." if termbase_suggestions else ""
      return {
        "mode": "direct",
        "message": _message_with_notices(
          "Do you want to attach a termbase? Reply with a termbase ID or name, or say `skip`."
          + suggestion_text,
          step_notices,
        ),
        "content_json": _wizard_content_json(state, active=True, step="termbase"),
      }
    state["termbase_done"] = True
    state["termbase_id"] = None
    state["awaiting_confirm"] = False
    step_notices.append("No termbase is configured right now.")

  if state.get("awaiting_confirm") and current_step == "confirm" and raw and not _is_affirmative(raw) and not state_changed:
    return {
      "mode": "direct",
      "message": "Tell me what you want to change: title, files, target languages, assignee, or resources.",
      "content_json": _wizard_content_json(state, active=True, step="confirm"),
    }

  final_project_name = state.get("project_name") or suggested_title or f"Project {datetime.utcnow().strftime('%Y-%m-%d')}"
  args: dict[str, Any] = {
    "name": final_project_name,
    "source_lang": state["source_lang"] or default_source,
    "target_langs": state["target_langs"],
    "file_ids": state["file_ids"],
    "assigned_user_id": state.get("owner_user_id"),
    "translation_engine_id": state.get("translation_engine_id"),
    "ruleset_id": state.get("ruleset_id"),
    "tmx_id": state.get("tmx_id"),
    "termbase_id": state.get("termbase_id"),
  }
  file_names = [
    str(state.get("file_names", {}).get(str(file_id)) or f"file #{file_id}")
    for file_id in state.get("file_ids", [])
  ]
  engine_label = _resource_label_by_id(engines, state.get("translation_engine_id"))
  ruleset_label = _resource_label_by_id(rulesets, state.get("ruleset_id"))
  tmx_label = _resource_label_by_id(tmx_entries, state.get("tmx_id"))
  termbase_label = _resource_label_by_id(termbases, state.get("termbase_id"))
  assignee_display = str(state.get("owner_username") or user_context.username)

  summary_lines = step_notices + [
    "Please confirm the project details:",
    f"Title: {final_project_name}",
    f"Uploaded files: {', '.join(file_names)}",
    f"Target languages: {', '.join(state['target_langs'])}",
    f"Assignee: {assignee_display}",
    f"TMX: {tmx_label or 'none'}",
    f"LLM / engine: {engine_label or 'none'}",
    f"Rules: {ruleset_label or 'none'}",
    f"Termbase: {termbase_label or 'none'}",
  ]

  if state["awaiting_confirm"] and _is_affirmative(raw):
    return {
      "mode": "tool",
      "tool_name": "create_project",
      "args": args,
      "content_json": _wizard_content_json(state, active=False, step="completed"),
    }

  state["awaiting_confirm"] = True
  summary_lines.append("Reply `create` to confirm, or tell me what to change.")
  return {
    "mode": "direct",
    "message": "\n".join(summary_lines),
    "content_json": _wizard_content_json(state, active=True, step="confirm"),
  }


async def _resolve_provider_for_agent(pool: asyncpg.Pool, config: AppAgentRuntimeConfig) -> tuple[str, str | None, str]:
  provider: ProviderConfig | None = None
  if config.provider_id:
    provider = await fetch_provider(pool, config.provider_id)
  elif config.connection_provider == "gateway" and not config.endpoint:
    provider = await resolve_default_provider(pool)

  if config.endpoint:
    base_url = normalize_base_url(config.endpoint)
    api_key = provider.api_key if provider else None
    model = config.model_name or (provider.model if provider else None) or ""
    if not model:
      raise AgentToolError("model_name is required when endpoint override is used.")
    return (base_url, api_key, model)

  if provider:
    model = config.model_name or provider.model or ""
    if not model:
      raise AgentToolError("No model configured for App Agent.")
    return (provider.base_url, provider.api_key, model)

  provider = await resolve_default_provider(pool)
  model = config.model_name or provider.model or ""
  if not model:
    raise AgentToolError("No model configured for App Agent.")
  return (provider.base_url, provider.api_key, model)


async def _run_translation_tool(
  request: Request,
  *,
  trace_id: str | None,
  config: AppAgentRuntimeConfig,
  user_context: AppAgentUserContext,
  args: dict[str, Any],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
  text = str(args.get("text") or "").strip()
  source_lang = _normalize_lang_tag(args.get("source_lang") or args.get("sourceLang"))
  target_lang = _normalize_lang_tag(args.get("target_lang") or args.get("targetLang"))
  tone = str(args.get("tone") or "").strip() or None

  if not text:
    raise AgentToolError("translate_snippet requires text.")
  if not target_lang:
    raise AgentToolError("translate_snippet requires target_lang.")
  if len(text) > config.translate_max_chars:
    raise AgentToolError(
      f"Text is too long for snippet translation (max {config.translate_max_chars} characters). Please create a project instead."
    )

  language_cfg = await _load_workspace_languages(
    request,
    trace_id=trace_id,
    user_context=user_context,
  )
  enabled_languages = language_cfg.get("enabled") if isinstance(language_cfg.get("enabled"), list) else []
  enabled_set = set(enabled_languages)
  if enabled_set and target_lang not in enabled_set:
    raise AgentToolError(f"Target language '{target_lang}' is not enabled in Language Settings.")
  if source_lang and enabled_set and source_lang not in enabled_set:
    raise AgentToolError(f"Source language '{source_lang}' is not enabled in Language Settings.")

  if config.mock_mode:
    translation = f"[mock:{target_lang}] {text[::-1]}"
    return (
      f"Translated to {target_lang}: {translation}",
      {
        "translation": translation,
        "sourceLang": source_lang,
        "targetLang": target_lang,
        "tone": tone,
        "mock": True,
      },
      [],
    )

  pool: asyncpg.Pool = request.app.state.db_pool
  base_url, api_key, model = await _resolve_provider_for_agent(pool, config)
  url = chat_completions_url(base_url)
  if not url:
    raise AgentToolError("Invalid provider endpoint for translation.")

  prompt_lines = [
    f"Source language: {source_lang or 'auto-detect'}",
    f"Target language: {target_lang}",
    f"Tone: {tone or 'preserve original'}",
    "Return only the translated text.",
    f'Text: """{text}"""',
  ]
  payload = {
    "model": model,
    "messages": [
      {"role": "system", "content": "You are a translation engine."},
      {"role": "user", "content": "\n".join(prompt_lines)},
    ],
    "temperature": 0.2,
    "max_tokens": 900,
  }
  headers = {"content-type": "application/json"}
  if api_key:
    headers["authorization"] = f"Bearer {api_key}"
  if trace_id:
    headers["x-request-id"] = trace_id

  client: httpx.AsyncClient = request.app.state.http
  upstream = await proxy_chat_completions(
    client,
    url=url,
    headers=headers,
    payload=payload,
  )
  if not upstream.is_success:
    raise AgentToolError("Translation provider request failed.")
  try:
    data = upstream.json()
  except Exception as exc:
    raise AgentToolError("Translation provider returned invalid JSON.") from exc
  if not isinstance(data, dict):
    raise AgentToolError("Translation provider returned invalid response.")
  translation = _extract_content_from_chat_payload(data).strip()
  if not translation:
    raise AgentToolError("Translation provider returned an empty translation.")
  return (
    f"Translated to {target_lang}: {translation}",
    {
      "translation": translation,
      "sourceLang": source_lang,
      "targetLang": target_lang,
      "tone": tone,
      "mock": False,
    },
    [],
  )


async def _run_create_project_tool(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
  args: dict[str, Any],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
  file_ids = _extract_file_ids(json.dumps(args)) if "file_ids" not in args and "fileIds" not in args else []
  if not file_ids:
    file_ids = [int(value) for value in args.get("file_ids", args.get("fileIds", [])) if str(value).isdigit()]
  file_ids = [value for value in file_ids if value > 0]
  if len(file_ids) == 0:
    raise AgentToolError("Project creation requires at least one file ID.")

  payload = await _call_backend_tool(
    request,
    path="/api/chat/internal/tools/create-project",
    payload={
      "userContext": {
        "userId": user_context.user_id,
        "username": user_context.username,
        "role": user_context.role,
        "departmentId": user_context.department_id,
      },
      "args": {
        "name": args.get("name"),
        "source_lang": args.get("source_lang") or args.get("sourceLang"),
        "target_langs": args.get("target_langs") or args.get("targetLangs"),
        "file_ids": file_ids,
        "due_at": args.get("due_at") or args.get("dueAt"),
        "assigned_user_id": args.get("assigned_user_id") or args.get("assignedUserId") or args.get("owner_user_id") or args.get("ownerUserId"),
        "translation_engine_id": args.get("translation_engine_id") or args.get("translationEngineId"),
        "ruleset_id": args.get("ruleset_id") or args.get("rulesetId"),
        "tmx_id": args.get("tmx_id") or args.get("tmxId"),
        "termbase_id": args.get("termbase_id") or args.get("termbaseId") or args.get("glossary_id") or args.get("glossaryId"),
      },
    },
    trace_id=trace_id,
  )

  project = payload.get("project") if isinstance(payload, dict) else None
  if not isinstance(project, dict):
    raise AgentToolError("Project tool returned an invalid project response.")
  project_id = int(project.get("id") or 0)
  if project_id <= 0:
    raise AgentToolError("Project tool did not return a valid project ID.")
  project_name = str(project.get("name") or f"Project {project_id}")
  status = str(project.get("status") or "provisioning").strip().lower() or "provisioning"
  file_processing = payload.get("fileProcessing") if isinstance(payload.get("fileProcessing"), list) else []
  next_action = str(payload.get("nextAction") or "").strip().upper()
  ready_files = 0
  failed_files = 0
  processing_files = 0
  for row in file_processing:
    if not isinstance(row, dict):
      continue
    row_status = str(row.get("status") or "").strip().upper()
    if row_status == "READY":
      ready_files += 1
    elif row_status == "FAILED":
      failed_files += 1
    else:
      processing_files += 1

  text_parts = [f'Created project "{project_name}" (ID {project_id}).']
  if file_processing:
    text_parts.append(f"Files: {ready_files} ready, {processing_files} processing, {failed_files} failed.")
  if status == "ready":
    text_parts.append("Segments are ready.")
  elif status == "failed":
    text_parts.append("Project import failed. Open Logs/Status and retry import.")
  else:
    text_parts.append("Project is preparing segments.")
  text = " ".join(text_parts)
  output = {
    "projectId": project_id,
    "name": project_name,
    "status": str(project.get("status") or "provisioning"),
    "sourceLang": project.get("sourceLang"),
    "targetLangs": project.get("targetLangs"),
    "assignedUserId": project.get("assignedUserId"),
    "assignedUsername": project.get("assignedUsername"),
    "translationEngineId": project.get("translationEngineId"),
    "rulesetId": project.get("rulesetId"),
    "tmxId": project.get("tmxId"),
    "termbaseId": project.get("termbaseId"),
    "dueAt": project.get("dueAt"),
    "nextAction": next_action or None,
    "fileProcessing": file_processing,
    "fileIds": payload.get("fileIds"),
  }
  open_payload_type = "open_project"
  open_label = "Open project"
  if next_action == "SHOW_PROCESSING" or status in {"provisioning", "failed"}:
    open_payload_type = "open_project_provisioning"
    open_label = "Open Logs/Status"
  quick_actions = [
    {
      "id": f"open-project-{project_id}",
      "label": open_label,
      "payload": {"type": open_payload_type, "projectId": project_id},
    }
  ]
  return text, output, quick_actions


async def _run_list_projects_tool(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
  args: dict[str, Any],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
  payload = await _call_backend_tool(
    request,
    path="/api/chat/internal/tools/list-projects",
    payload={
      "userContext": {
        "userId": user_context.user_id,
        "username": user_context.username,
        "role": user_context.role,
        "departmentId": user_context.department_id,
      },
      "args": {"limit": args.get("limit"), "status": args.get("status")},
    },
    trace_id=trace_id,
  )
  projects = payload.get("projects") if isinstance(payload, dict) else None
  if not isinstance(projects, list):
    projects = []
  lines: list[str] = []
  quick_actions: list[dict[str, Any]] = []
  for idx, project in enumerate(projects):
    if not isinstance(project, dict):
      continue
    project_id = int(project.get("projectId") or 0)
    name = str(project.get("name") or "")
    status = str(project.get("status") or "")
    progress = int(project.get("progressPct") or 0)
    if project_id > 0:
      lines.append(f"#{project_id} {name} ({status}, {progress}%)")
      if idx < 3:
        quick_actions.append(
          {
            "id": f"open-project-{project_id}",
            "label": f"Open {project_id}",
            "payload": {"type": "open_project", "projectId": project_id},
          }
        )
  summary = "\n".join(lines) if lines else "You have no projects yet."
  return summary, {"projects": projects}, quick_actions


async def _run_project_status_tool(
  request: Request,
  *,
  trace_id: str | None,
  user_context: AppAgentUserContext,
  args: dict[str, Any],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
  try:
    project_id = int(args.get("projectId"))
  except Exception as exc:
    raise AgentToolError("get_project_status requires a valid projectId.") from exc
  if project_id <= 0:
    raise AgentToolError("get_project_status requires a valid projectId.")

  payload = await _call_backend_tool(
    request,
    path="/api/chat/internal/tools/get-project-status",
    payload={
      "userContext": {
        "userId": user_context.user_id,
        "username": user_context.username,
        "role": user_context.role,
        "departmentId": user_context.department_id,
      },
      "args": {"projectId": project_id},
    },
    trace_id=trace_id,
  )
  project = payload.get("project") if isinstance(payload, dict) else None
  if not isinstance(project, dict):
    raise AgentToolError("Project status tool returned an invalid response.")

  progress = project.get("progress") if isinstance(project.get("progress"), dict) else {}
  translated = int(progress.get("translatedSegments") or 0)
  total = int(progress.get("totalSegments") or 0)
  translated_pct = int(progress.get("translatedPct") or 0)
  reviewed = int(progress.get("reviewedSegments") or 0)
  summary = "\n".join(
    [
      f'Project #{int(project.get("projectId") or project_id)}: {project.get("name") or ""}',
      f'Status: {project.get("status") or ""}',
      f'Language pair: {project.get("sourceLang") or ""} -> {project.get("targetLang") or ""}',
      f"Progress: {translated}/{total} translated ({translated_pct}%)",
      f"Reviewed: {reviewed}/{total}",
    ]
  )
  quick_actions = [
    {
      "id": f"open-project-{project_id}",
      "label": "Open project",
      "payload": {"type": "open_project", "projectId": project_id},
    }
  ]
  return summary, {"project": project}, quick_actions


async def _run_direct_completion(
  request: Request,
  *,
  trace_id: str | None,
  config: AppAgentRuntimeConfig,
  history: list[dict[str, Any]],
) -> str:
  last_user_text = _last_user_message_text(history)
  if config.mock_mode:
    if last_user_text:
      return f"[mock] I received your request: {last_user_text}"
    return "[mock] Ask me to translate a snippet or manage your projects."

  pool: asyncpg.Pool = request.app.state.db_pool
  base_url, api_key, model = await _resolve_provider_for_agent(pool, config)
  url = chat_completions_url(base_url)
  if not url:
    raise AgentToolError("Invalid provider endpoint for App Agent.")

  messages: list[dict[str, Any]] = [{"role": "system", "content": config.system_prompt}]
  for entry in history[-20:]:
    role = str(entry.get("role") or "")
    content = str(entry.get("content_text") or "").strip()
    if not content:
      continue
    if role == "assistant":
      messages.append({"role": "assistant", "content": content})
    elif role == "user":
      messages.append({"role": "user", "content": content})
  if len(messages) == 1 and last_user_text:
    messages.append({"role": "user", "content": last_user_text})

  payload = {
    "model": model,
    "messages": messages,
    "temperature": 0.2,
    "max_tokens": 900,
  }
  headers = {"content-type": "application/json"}
  if api_key:
    headers["authorization"] = f"Bearer {api_key}"
  if trace_id:
    headers["x-request-id"] = trace_id

  client: httpx.AsyncClient = request.app.state.http
  upstream = await proxy_chat_completions(client, url=url, headers=headers, payload=payload)
  if not upstream.is_success:
    raise AgentToolError("App Agent completion request failed.")
  try:
    data = upstream.json()
  except Exception as exc:
    raise AgentToolError("App Agent completion returned invalid JSON.") from exc
  if not isinstance(data, dict):
    raise AgentToolError("App Agent completion returned invalid response.")
  content = _extract_content_from_chat_payload(data)
  if not content:
    raise AgentToolError("App Agent completion returned an empty response.")
  return content


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
