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

APP_AGENT_BACKEND_URL = (_env("APP_AGENT_BACKEND_URL") or "http://cat-api:4000").rstrip("/")
APP_AGENT_INTERNAL_SECRET = (
  _env("APP_AGENT_INTERNAL_SECRET")
  or _env("CHAT_AGENT_INTERNAL_SECRET")
  or _env("JWT_SECRET")
  or "fastcat-app-agent-internal"
)
APP_AGENT_TRANSLATE_MAX_CHARS = max(200, _env_int("APP_AGENT_TRANSLATE_MAX_CHARS", 1500))
DEFAULT_PROVIDER_ID = _env_int("LLM_DEFAULT_PROVIDER_ID", 0) or None
SECRETS_KEY = (
  _env("LLM_SECRETS_KEY")
  or _env("CAT_SECRETS_KEY")
  or _env("CAT_SECRET_KEY")
  or _env("SECRETS_KEY")
  or _env("JWT_SECRET")
  or "fastcat-dev-secrets-key"
)
LOCALHOST_BRIDGE_TARGET = None
_localhost_bridge_raw = _env("LLM_GATEWAY_LOCALHOST_BRIDGE", "host.docker.internal")
if not _boolish_off(_localhost_bridge_raw):
  LOCALHOST_BRIDGE_TARGET = _localhost_bridge_raw
UPSTREAM_TIMEOUT_S = float(_env("LLM_GATEWAY_TIMEOUT_S", "60") or "60")
UPSTREAM_CONNECT_TIMEOUT_S = float(_env("LLM_GATEWAY_CONNECT_TIMEOUT_S", "10") or "10")
UPSTREAM_RETRIES = _env_int("LLM_GATEWAY_RETRIES", 1)

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


@dataclass(frozen=True)
class ProviderConfig:
  id: int
  title: str
  vendor: str
  model: str | None
  base_url: str
  api_key: str | None


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
      detail={"error": "No LLM provider configured. Create an OpenAI-compatible provider in Settings -> Resources."},
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



__all__ = [
  'APP_AGENT_TOOL_ALLOWLIST',
  'APP_AGENT_ADMIN_DENYLIST',
  'APP_AGENT_BACKEND_URL',
  'APP_AGENT_INTERNAL_SECRET',
  'APP_AGENT_TRANSLATE_MAX_CHARS',
  'AgentToolError',
  'AppAgentRuntimeConfig',
  'AppAgentUserContext',
  'ProviderConfig',
  '_normalize_lang_tag',
  '_normalize_lang_list',
  '_normalize_tool_set',
  '_normalize_runtime_config',
  '_load_runtime_config',
  '_parse_user_context',
  '_parse_history_messages',
  '_last_user_message_text',
  '_contains_admin_intent',
  '_extract_target_langs',
  '_extract_source_lang',
  '_extract_file_ids',
  '_extract_project_name',
  '_extract_uploaded_files_from_history',
  '_build_suggested_project_title',
  '_parse_project_title_choice',
  '_extract_translation_snippet',
  '_extract_wizard_context_from_history',
  '_is_create_project_intent',
  '_is_project_wizard_info_intent',
  '_main_menu_message',
  '_plan_action',
  '_sse',
  '_chunk_text',
  '_extract_content_from_chat_payload',
  '_call_backend_tool',
  '_dedupe_positive_ints',
  '_normalize_project_wizard_state',
  '_extract_lang_mentions',
  '_is_affirmative',
  '_is_cancel_intent',
  '_is_skip_choice',
  '_is_default_choice',
  '_parse_option_choice',
  '_parse_assignee_choice',
  '_resource_label_by_id',
  '_language_alternatives',
  '_parse_due_at_text',
  'chat_completions_url',
  'fetch_provider',
  'normalize_base_url',
  'proxy_chat_completions',
  'resolve_default_provider',
]
