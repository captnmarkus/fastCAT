import asyncio
import base64
import hashlib
import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse, urlunparse

import asyncpg
import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException

from app.app_agent_runtime import _env, _env_int


def _boolish_off(value: str | None) -> bool:
  if value is None:
    return False
  return value.strip().lower() in {"off", "none", "false", "0", "no"}


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
