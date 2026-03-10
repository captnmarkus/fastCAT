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


