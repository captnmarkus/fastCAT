export const INIT_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS parsing_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL DEFAULT 'html',
      config JSONB NOT NULL,
      source_json_path TEXT,
      source_json_original_name TEXT,
      source_json_size_bytes INTEGER,
      source_json_uploaded_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS parsing_template_json_uploads (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'html',
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      size_bytes INTEGER,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      src_lang TEXT NOT NULL,
      tgt_lang TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      created_by TEXT,
      assigned_user TEXT,
      tm_sample TEXT,
      tm_sample_tm_id INTEGER,
      glossary_file TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS file_artifacts (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER REFERENCES project_files(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      bucket TEXT NOT NULL,
      object_key TEXT NOT NULL,
      sha256 TEXT,
      etag TEXT,
      size_bytes BIGINT,
      content_type TEXT,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS segments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      file_id INTEGER NOT NULL REFERENCES project_files(id),
      task_id INTEGER,
      seg_index INTEGER NOT NULL,
      src TEXT NOT NULL,
      tgt TEXT,
      src_runs JSONB NOT NULL DEFAULT '[]'::jsonb,
      tgt_runs JSONB NOT NULL DEFAULT '[]'::jsonb,
      segment_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      origin_details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      state TEXT NOT NULL DEFAULT 'draft',
      generated_by_llm BOOLEAN NOT NULL DEFAULT FALSE,
      qe_score REAL,
      issue_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      issue_details JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_type TEXT NOT NULL DEFAULT 'none',
      source_score INTEGER,
      source_match_id TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS translation_tasks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      translator_user TEXT NOT NULL,
      reviewer_user TEXT,
      tmx_id INTEGER,
      seed_source TEXT NOT NULL DEFAULT 'none',
      engine_id INTEGER,
      glossary_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (project_id, file_id, target_lang)
    );

    CREATE TABLE IF NOT EXISTS project_file_html_templates (
      file_id INTEGER PRIMARY KEY REFERENCES project_files(id) ON DELETE CASCADE,
      template TEXT NOT NULL,
      markers TEXT NOT NULL,
      parsing_template_id INTEGER REFERENCES parsing_templates(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS template_versions (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES parsing_templates(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      artifact_id INTEGER NOT NULL REFERENCES file_artifacts(id) ON DELETE RESTRICT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (template_id, version)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER,
      actor_label TEXT,
      action TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      details_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS global_glossary_entries (
      id SERIAL PRIMARY KEY,
      source_lang TEXT,
      target_lang TEXT,
      term TEXT NOT NULL,
      translation TEXT NOT NULL,
      created_by TEXT,
      source_type TEXT NOT NULL DEFAULT 'managed',
      origin TEXT,
      origin_author TEXT,
      origin_date TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS segment_qa (
      id SERIAL PRIMARY KEY,
      segment_id INTEGER NOT NULL REFERENCES segments(id),
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      message TEXT NOT NULL,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS segment_history (
      id SERIAL PRIMARY KEY,
      segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      old_tgt TEXT,
      new_tgt TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tm_library (
      id SERIAL PRIMARY KEY,
      origin TEXT NOT NULL DEFAULT 'upload',
      label TEXT NOT NULL,
      comment TEXT,
      filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      uploaded_by TEXT,
      uploaded_at TIMESTAMPTZ,
      tm_name TEXT,
      tm_proxy_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tm_library_versions (
      version_id SERIAL PRIMARY KEY,
      tm_library_id INTEGER NOT NULL REFERENCES tm_library(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      comment TEXT,
      label TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      tm_name TEXT,
      tm_proxy_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS tm_file_segment_imports (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES translation_tasks(id) ON DELETE SET NULL,
      segment_id INTEGER REFERENCES segments(id) ON DELETE SET NULL,
      tm_id INTEGER NOT NULL,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source_text TEXT NOT NULL,
      target_text TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      target_hash TEXT NOT NULL,
      dedupe_mode TEXT NOT NULL DEFAULT 'skip',
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      imported_by TEXT,
      imported_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (project_id, file_id, tm_id, task_id, segment_id, source_hash, target_hash)
    );

    CREATE TABLE IF NOT EXISTS glossaries (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      filename TEXT,
      description TEXT,
        languages JSONB NOT NULL DEFAULT '[]'::jsonb,
        default_source_lang TEXT,
        default_target_lang TEXT,
        structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        visibility TEXT NOT NULL DEFAULT 'managers',
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      uploaded_by TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS org_language_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      enabled_language_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_source_tag TEXT,
      default_target_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      preferred_variants_by_primary JSONB NOT NULL DEFAULT '{}'::jsonb,
      allow_single_language BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE org_language_settings
      ADD COLUMN IF NOT EXISTS languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS defaults JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS glossary_entries (
      id SERIAL PRIMARY KEY,
      glossary_id INTEGER NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
      concept_id TEXT,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      term TEXT NOT NULL,
      translation TEXT NOT NULL,
      notes TEXT,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS glossary_entry_media (
      id SERIAL PRIMARY KEY,
      glossary_id INTEGER NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
      entry_id INTEGER REFERENCES glossary_entries(id) ON DELETE CASCADE,
      concept_id TEXT,
      media_type TEXT NOT NULL DEFAULT 'image',
      storage_path TEXT NOT NULL,
      original_filename TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS glossary_imports (
      id SERIAL PRIMARY KEY,
      import_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      label TEXT,
      description TEXT,
      languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      visibility TEXT NOT NULL DEFAULT 'managers',
      source_filename TEXT,
      source_object_key TEXT,
      source_sha256 TEXT,
      source_size_bytes BIGINT,
      source_content_type TEXT,
      images_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'App Agent',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      thread_id BIGINT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
      content_text TEXT,
      content_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT REFERENCES chat_messages(id) ON DELETE CASCADE,
      thread_id BIGINT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      output_json JSONB,
      status TEXT NOT NULL DEFAULT 'succeeded',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_audit_events (
      id BIGSERIAL PRIMARY KEY,
      request_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      thread_id BIGINT REFERENCES chat_threads(id) ON DELETE CASCADE,
      message_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_agent_config (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      connection_provider TEXT NOT NULL DEFAULT 'mock',
      provider_id INTEGER,
      model_name TEXT,
      endpoint TEXT,
      mock_mode BOOLEAN NOT NULL DEFAULT TRUE,
      system_prompt TEXT NOT NULL DEFAULT '',
      enabled_tools JSONB NOT NULL DEFAULT '["translate_snippet","create_project","list_projects","get_project_status"]'::jsonb,
      supported_languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_source_language TEXT,
      default_target_languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      provider_secret_enc TEXT,
      provider_api_key_masked TEXT,
      provider_org TEXT,
      provider_project TEXT,
      provider_region TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_file_processing_logs (
      id BIGSERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS translation_engines (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      system_prompt TEXT,
      user_prompt_template TEXT,
      temperature REAL,
      max_tokens INTEGER,
      top_p REAL,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS file_type_configs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      scope TEXT,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      src_lang TEXT NOT NULL,
      target_langs JSONB NOT NULL DEFAULT '[]'::jsonb,
      translation_engine_id INTEGER REFERENCES translation_engines(id),
      file_type_config_id INTEGER REFERENCES file_type_configs(id),
      default_tmx_id INTEGER,
      default_ruleset_id INTEGER,
      default_glossary_id INTEGER,
      tmx_by_target_lang JSONB NOT NULL DEFAULT '{}'::jsonb,
      ruleset_by_target_lang JSONB NOT NULL DEFAULT '{}'::jsonb,
      glossary_by_target_lang JSONB NOT NULL DEFAULT '{}'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS language_processing_rulesets (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      rules JSONB NOT NULL DEFAULT '[]'::jsonb,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS language_processing_ruleset_versions (
      id SERIAL PRIMARY KEY,
      ruleset_id INTEGER NOT NULL REFERENCES language_processing_rulesets(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      rules JSONB NOT NULL DEFAULT '[]'::jsonb,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      summary TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (ruleset_id, version)
    );

    CREATE TABLE IF NOT EXISTS nmt_providers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      description TEXT,
      model TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      secret_enc TEXT,
      secret_key_version INTEGER NOT NULL DEFAULT 1,
      base_url_masked TEXT,
      api_key_masked TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

