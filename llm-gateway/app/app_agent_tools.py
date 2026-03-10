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
from app.app_agent_runtime import *
from app.app_agent_wizard import _load_workspace_languages

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


