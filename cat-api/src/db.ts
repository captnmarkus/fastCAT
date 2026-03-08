import { Pool, PoolClient } from "pg";
import { CONFIG } from "./config.js";
import { decryptJson, encryptJson } from "./lib/secrets.js";
import { INIT_SCHEMA_SQL } from "./db/init-schema-sql.js";

export const db = new Pool({ connectionString: CONFIG.DB_URL });
const DB_INIT_LOCK_NAMESPACE = 47972;
const DB_INIT_LOCK_ID = 1;

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function withDatabaseInitLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [DB_INIT_LOCK_NAMESPACE, DB_INIT_LOCK_ID]);
    return await fn();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [DB_INIT_LOCK_NAMESPACE, DB_INIT_LOCK_ID]);
    } catch {
      /* ignore unlock failure */
    }
    client.release();
  }
}

async function runInitDatabaseMigrations() {
  await db.query(INIT_SCHEMA_SQL);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'project_status'
          AND n.nspname = 'public'
      ) THEN
        CREATE TYPE project_status AS ENUM ('provisioning', 'ready', 'failed');
      END IF;
    END $$;
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'project_status'
          AND e.enumlabel = 'draft'
      ) THEN
        ALTER TYPE project_status ADD VALUE 'draft';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'project_status'
          AND e.enumlabel = 'canceled'
      ) THEN
        ALTER TYPE project_status ADD VALUE 'canceled';
      END IF;
    END $$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS provision_jobs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      step TEXT,
      progress JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_pretranslate_jobs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      target_lang TEXT NOT NULL,
      engine_id INTEGER REFERENCES translation_engines(id),
      status TEXT NOT NULL DEFAULT 'pending',
      overwrite_existing BOOLEAN NOT NULL DEFAULT FALSE,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      segments_total INTEGER NOT NULL DEFAULT 0,
      segments_processed INTEGER NOT NULL DEFAULT 0,
      segments_skipped INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (project_id, file_id, target_lang)
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
      connection_provider TEXT NOT NULL DEFAULT 'gateway',
      provider_id INTEGER REFERENCES nmt_providers(id) ON DELETE SET NULL,
      model_name TEXT,
      endpoint TEXT,
      mock_mode BOOLEAN NOT NULL DEFAULT FALSE,
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
  `);

  await db.query(`
    UPDATE projects
    SET status = 'ready'
    WHERE status IS NULL
       OR LOWER(status::text) NOT IN ('draft', 'provisioning', 'ready', 'failed', 'canceled');

    ALTER TABLE projects
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE project_status
        USING CASE
          WHEN status IS NULL THEN 'ready'::project_status
          WHEN LOWER(status::text) IN ('draft', 'provisioning', 'ready', 'failed', 'canceled')
            THEN LOWER(status::text)::project_status
          ELSE 'ready'::project_status
        END,
      ALTER COLUMN status SET DEFAULT 'ready'::project_status,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS assigned_user TEXT,
      ADD COLUMN IF NOT EXISTS tm_sample TEXT,
      ADD COLUMN IF NOT EXISTS tm_sample_tm_id INTEGER,
      ADD COLUMN IF NOT EXISTS glossary_file TEXT,
      ADD COLUMN IF NOT EXISTS glossary_id INTEGER,
      ADD COLUMN IF NOT EXISTS project_template_id INTEGER REFERENCES project_templates(id),
      ADD COLUMN IF NOT EXISTS translation_engine_id INTEGER REFERENCES translation_engines(id),
      ADD COLUMN IF NOT EXISTS file_type_config_id INTEGER REFERENCES file_type_configs(id),
      ADD COLUMN IF NOT EXISTS project_settings JSONB,
      ADD COLUMN IF NOT EXISTS target_langs JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS department_id INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS init_error TEXT,
      ADD COLUMN IF NOT EXISTS provisioning_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS provisioning_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS provisioning_finished_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS provisioning_progress INTEGER,
      ADD COLUMN IF NOT EXISTS provisioning_current_step TEXT,
      ADD COLUMN IF NOT EXISTS owner_user_id INTEGER,
      ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER;

    ALTER TABLE translation_engines
      ADD COLUMN IF NOT EXISTS system_prompt TEXT,
      ADD COLUMN IF NOT EXISTS user_prompt_template TEXT,
      ADD COLUMN IF NOT EXISTS llm_provider_id INTEGER REFERENCES nmt_providers(id),
      ADD COLUMN IF NOT EXISTS temperature REAL,
      ADD COLUMN IF NOT EXISTS max_tokens INTEGER,
      ADD COLUMN IF NOT EXISTS top_p REAL;

    ALTER TABLE nmt_providers
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS model TEXT,
      ADD COLUMN IF NOT EXISTS secret_key_version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS base_url_masked TEXT,
      ADD COLUMN IF NOT EXISTS api_key_masked TEXT;

    ALTER TABLE app_agent_config
      ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS connection_provider TEXT NOT NULL DEFAULT 'gateway',
      ADD COLUMN IF NOT EXISTS provider_id INTEGER REFERENCES nmt_providers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS model_name TEXT,
      ADD COLUMN IF NOT EXISTS endpoint TEXT,
      ADD COLUMN IF NOT EXISTS mock_mode BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS system_prompt TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS enabled_tools JSONB NOT NULL DEFAULT '["translate_snippet","create_project","list_projects","get_project_status"]'::jsonb,
      ADD COLUMN IF NOT EXISTS supported_languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS default_source_language TEXT,
      ADD COLUMN IF NOT EXISTS default_target_languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS provider_secret_enc TEXT,
      ADD COLUMN IF NOT EXISTS provider_api_key_masked TEXT,
      ADD COLUMN IF NOT EXISTS provider_org TEXT,
      ADD COLUMN IF NOT EXISTS provider_project TEXT,
      ADD COLUMN IF NOT EXISTS provider_region TEXT,
      ADD COLUMN IF NOT EXISTS updated_by TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

    UPDATE app_agent_config
    SET enabled_tools = '["translate_snippet","create_project","list_projects","get_project_status"]'::jsonb
    WHERE enabled_tools IS NULL
       OR enabled_tools = '[]'::jsonb
       OR enabled_tools = '["translate_snippet","create_project"]'::jsonb;

    UPDATE app_agent_config
    SET connection_provider = 'gateway',
        mock_mode = FALSE,
        updated_at = NOW()
    WHERE id = 1
      AND COALESCE(updated_by, 'system') = 'system'
      AND provider_id IS NULL
      AND NULLIF(BTRIM(COALESCE(model_name, '')), '') IS NULL
      AND NULLIF(BTRIM(COALESCE(endpoint, '')), '') IS NULL
      AND provider_secret_enc IS NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_app_agent_config_provider'
      ) THEN
        ALTER TABLE app_agent_config
          ADD CONSTRAINT fk_app_agent_config_provider
            FOREIGN KEY (provider_id)
            REFERENCES nmt_providers(id)
            ON DELETE SET NULL;
      END IF;
    END $$;

    ALTER TABLE segments
      ADD COLUMN IF NOT EXISTS word_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS src_runs JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS tgt_runs JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS segment_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS origin_details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS source_score INTEGER,
      ADD COLUMN IF NOT EXISTS source_match_id TEXT,
      ADD COLUMN IF NOT EXISTS task_id INTEGER,
      ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS generated_by_llm BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS qe_score REAL,
      ADD COLUMN IF NOT EXISTS issue_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS issue_details JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS updated_by TEXT;

    ALTER TABLE segments
      ALTER COLUMN state SET DEFAULT 'draft';

    ALTER TABLE project_file_html_templates
      ADD COLUMN IF NOT EXISTS parsing_template_id INTEGER REFERENCES parsing_templates(id);

    ALTER TABLE project_files
      ADD COLUMN IF NOT EXISTS file_type TEXT,
      ADD COLUMN IF NOT EXISTS file_type_config_id INTEGER REFERENCES file_type_configs(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'created',
      ADD COLUMN IF NOT EXISTS original_artifact_id INTEGER REFERENCES file_artifacts(id),
      ADD COLUMN IF NOT EXISTS client_temp_key TEXT;

    ALTER TABLE file_artifacts
      ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

    ALTER TABLE translation_tasks
      ADD COLUMN IF NOT EXISTS tmx_id INTEGER,
      ADD COLUMN IF NOT EXISTS seed_source TEXT NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS engine_id INTEGER,
      ADD COLUMN IF NOT EXISTS glossary_id INTEGER,
      ADD COLUMN IF NOT EXISTS ruleset_id INTEGER REFERENCES language_processing_rulesets(id) ON DELETE SET NULL;

    ALTER TABLE project_pretranslate_jobs
      ADD COLUMN IF NOT EXISTS engine_id INTEGER REFERENCES translation_engines(id),
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS overwrite_existing BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3,
      ADD COLUMN IF NOT EXISTS segments_total INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS segments_processed INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS segments_skipped INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS error_message TEXT,
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

    ALTER TABLE project_templates
      ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS default_tmx_id INTEGER,
      ADD COLUMN IF NOT EXISTS default_ruleset_id INTEGER,
      ADD COLUMN IF NOT EXISTS default_glossary_id INTEGER,
      ADD COLUMN IF NOT EXISTS tmx_by_target_lang JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS ruleset_by_target_lang JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS glossary_by_target_lang JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE parsing_templates
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'html',
      ADD COLUMN IF NOT EXISTS source_json_path TEXT,
      ADD COLUMN IF NOT EXISTS source_json_original_name TEXT,
      ADD COLUMN IF NOT EXISTS source_json_size_bytes INTEGER,
      ADD COLUMN IF NOT EXISTS source_json_uploaded_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS source_artifact_id INTEGER REFERENCES file_artifacts(id),
      ADD COLUMN IF NOT EXISTS created_by TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE parsing_template_json_uploads
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'html',
      ADD COLUMN IF NOT EXISTS artifact_id INTEGER REFERENCES file_artifacts(id);

    ALTER TABLE global_glossary_entries
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'managed',
      ADD COLUMN IF NOT EXISTS origin TEXT,
      ADD COLUMN IF NOT EXISTS origin_author TEXT,
      ADD COLUMN IF NOT EXISTS origin_date TEXT;

    ALTER TABLE tm_library
      ADD COLUMN IF NOT EXISTS size_bytes INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'upload',
      ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS uploaded_by TEXT,
      ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS comment TEXT,
      ADD COLUMN IF NOT EXISTS tm_name TEXT,
      ADD COLUMN IF NOT EXISTS tm_proxy_id INTEGER,
      ADD COLUMN IF NOT EXISTS artifact_id INTEGER REFERENCES file_artifacts(id),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE tm_library_versions
      ADD COLUMN IF NOT EXISTS artifact_id INTEGER REFERENCES file_artifacts(id);

    ALTER TABLE glossaries
      ADD COLUMN IF NOT EXISTS artifact_id INTEGER REFERENCES file_artifacts(id);

      ALTER TABLE glossaries
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS languages JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS default_source_lang TEXT,
        ADD COLUMN IF NOT EXISTS default_target_lang TEXT,
        ADD COLUMN IF NOT EXISTS structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'managers',
      ADD COLUMN IF NOT EXISTS updated_by TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE glossary_imports
      ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE glossary_entries
      ADD COLUMN IF NOT EXISTS concept_id TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_by TEXT,
      ADD COLUMN IF NOT EXISTS updated_by TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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
  `);

  // Backfill/normalize legacy parsing template kinds (e.g. older installs storing "xhtml").
  await db.query(`
    UPDATE projects
    SET target_langs = jsonb_build_array(tgt_lang)
    WHERE (target_langs IS NULL OR jsonb_array_length(target_langs) = 0)
      AND tgt_lang IS NOT NULL
      AND tgt_lang <> '';

    UPDATE projects
    SET status = 'ready'
    WHERE status IS NULL
       OR LOWER(status::text) NOT IN ('draft', 'provisioning', 'ready', 'failed', 'canceled');

    UPDATE projects
    SET published_at = COALESCE(published_at, created_at)
    WHERE status = 'ready'
      AND published_at IS NULL;

    UPDATE parsing_templates
    SET kind = 'html'
    WHERE LOWER(kind) IN ('xhtml', 'xhtm', 'xtml');

    UPDATE parsing_templates
    SET kind = LOWER(kind)
    WHERE kind IS NOT NULL AND kind <> LOWER(kind);

    UPDATE parsing_template_json_uploads
    SET kind = 'html'
    WHERE LOWER(kind) IN ('xhtml', 'xhtm', 'xtml');

    UPDATE parsing_template_json_uploads
    SET kind = LOWER(kind)
    WHERE kind IS NOT NULL AND kind <> LOWER(kind);
  `);

  // Status migration: "approved" was merged into "reviewed"
  await db.query(`
    UPDATE segments
    SET status = 'reviewed'
    WHERE LOWER(status) = 'approved'
  `);

  await db.query(`
    UPDATE segments
    SET state = CASE
      WHEN LOWER(status) = 'reviewed' THEN 'reviewed'
      WHEN COALESCE(generated_by_llm, FALSE) = TRUE OR LOWER(COALESCE(source_type, '')) = 'nmt' THEN 'nmt_draft'
      ELSE 'draft'
    END
    WHERE state IS NULL
       OR state = ''
       OR LOWER(state) IN ('llm_draft', 'needs_review', 'under_review')
    `);

  await db.query(`
    UPDATE segments
    SET state = 'draft'
    WHERE LOWER(COALESCE(state, '')) = 'nmt_draft'
      AND COALESCE(generated_by_llm, FALSE) = FALSE
      AND LOWER(COALESCE(source_type, 'none')) NOT IN ('nmt', 'mt')
  `);

  await db.query(`
    UPDATE segments
    SET issue_summary = '{}'::jsonb
    WHERE issue_summary IS NULL
  `);

  await db.query(`
    UPDATE segments
    SET issue_details = '[]'::jsonb
    WHERE issue_details IS NULL
  `);

  await migrateNmtProviderSecrets();

  await enforceGlossaryUniqueness();
  await enforceGlossaryLabelUniqueness();

  await db.query(`
    UPDATE glossaries
    SET updated_at = COALESCE(updated_at, uploaded_at, created_at, NOW())
    WHERE updated_at IS NULL;
  `);

  await db.query(`
    UPDATE glossaries
    SET updated_by = COALESCE(updated_by, uploaded_by)
    WHERE updated_by IS NULL;
  `);

  await db.query(`
    UPDATE glossary_entries
    SET updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE updated_at IS NULL;
  `);

  await db.query(`
    UPDATE glossary_entries e
    SET created_by = COALESCE(e.created_by, g.uploaded_by, 'system')
    FROM glossaries g
    WHERE g.id = e.glossary_id
      AND e.created_by IS NULL;
  `);

  await db.query(`
    UPDATE glossary_entries e
    SET updated_by = COALESCE(e.updated_by, g.uploaded_by, e.created_by, 'system')
    FROM glossaries g
    WHERE g.id = e.glossary_id
      AND e.updated_by IS NULL;
  `);

  await db.query(`
    UPDATE tm_library
    SET updated_at = COALESCE(updated_at, uploaded_at, created_at, NOW())
    WHERE updated_at IS NULL;
  `);

  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) THEN
        UPDATE projects p
        SET created_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(p.created_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(p.created_by)::int;

        UPDATE projects p
        SET assigned_user = u.username
        FROM users u
        WHERE BTRIM(COALESCE(p.assigned_user, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(p.assigned_user)::int;

        UPDATE segment_history h
        SET updated_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(h.updated_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(h.updated_by)::int;

        UPDATE global_glossary_entries g
        SET created_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(g.created_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(g.created_by)::int;

        UPDATE tm_library t
        SET uploaded_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(t.uploaded_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(t.uploaded_by)::int;

        UPDATE glossaries g
        SET uploaded_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(g.uploaded_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(g.uploaded_by)::int;

        UPDATE glossaries g
        SET updated_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(g.updated_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(g.updated_by)::int;

        UPDATE glossary_entries e
        SET created_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(e.created_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(e.created_by)::int;

        UPDATE glossary_entries e
        SET updated_by = u.username
        FROM users u
        WHERE BTRIM(COALESCE(e.updated_by, '')) ~ '^[0-9]+$'
          AND u.id = BTRIM(e.updated_by)::int;
      END IF;
    END $$;
  `);

  await enforceTmLibraryLabelUniqueness();
  await enforceProjectNameUniqueness();

  await db.query(`
    INSERT INTO departments(id, name, slug, disabled)
    VALUES (1, 'General', 'general', false)
    ON CONFLICT (id) DO NOTHING;
  `);

  await db.query(
    `
    INSERT INTO app_agent_config(
      id,
      enabled,
      connection_provider,
      provider_id,
      model_name,
      endpoint,
      mock_mode,
      system_prompt,
      enabled_tools,
      provider_secret_enc,
      provider_api_key_masked,
      provider_org,
      provider_project,
      provider_region,
      updated_by
    )
    VALUES (
      1,
      TRUE,
      'gateway',
      NULL,
      NULL,
      NULL,
      FALSE,
      $1,
      '["translate_snippet","create_project","list_projects","get_project_status"]'::jsonb,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'system'
    )
    ON CONFLICT (id) DO NOTHING;
  `,
    [
      "You are the Fastcat App Agent. Help with short snippet translation and project actions for the current user. If project creation is requested without files, ask for at least one file first."
    ]
  );

  await db.query(`
    DELETE FROM app_agent_config
    WHERE id <> 1;
  `);

  await db.query(`
    INSERT INTO tm_library_versions(
      tm_library_id,
      created_at,
      created_by,
      comment,
      label,
      filename,
      stored_path,
      size_bytes,
      disabled,
      tm_name,
      tm_proxy_id
    )
    SELECT
      t.id,
      COALESCE(t.uploaded_at, t.created_at, NOW()),
      COALESCE(t.uploaded_by, 'system'),
      'initial',
      t.label,
      t.filename,
      t.stored_path,
      t.size_bytes,
      t.disabled,
      t.tm_name,
      t.tm_proxy_id
    FROM tm_library t
    WHERE NOT EXISTS (
      SELECT 1 FROM tm_library_versions v
      WHERE v.tm_library_id = t.id
    );
  `);

  await db.query(`
    CREATE OR REPLACE FUNCTION enforce_project_has_file_refs()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM project_files
        WHERE project_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'Project must have at least one file reference.'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_projects_require_file_refs ON projects;
    CREATE CONSTRAINT TRIGGER trg_projects_require_file_refs
    AFTER INSERT ON projects
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION enforce_project_has_file_refs();
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_global_glossary_term
      ON global_glossary_entries(term, source_lang, target_lang);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_unique
      ON departments(LOWER(name));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_slug_unique
      ON departments(LOWER(slug)) WHERE slug IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_departments_disabled
      ON departments(disabled);

    DROP INDEX IF EXISTS idx_tm_library_filename;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_library_origin_filename
      ON tm_library(origin, filename);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_library_origin_label_unique
      ON tm_library(origin, LOWER(label));

    CREATE INDEX IF NOT EXISTS idx_tm_library_disabled
      ON tm_library(disabled);

    CREATE INDEX IF NOT EXISTS idx_tm_library_versions_entry
      ON tm_library_versions(tm_library_id, created_at DESC, version_id DESC);

    CREATE INDEX IF NOT EXISTS idx_tm_file_segment_imports_lookup
      ON tm_file_segment_imports(project_id, file_id, tm_id, target_lang, status, imported_at DESC);

    CREATE INDEX IF NOT EXISTS idx_tm_file_segment_imports_task_segment
      ON tm_file_segment_imports(task_id, segment_id, tm_id);

    CREATE INDEX IF NOT EXISTS idx_segments_project_file_idx
      ON segments(project_id, file_id, seg_index);

    CREATE INDEX IF NOT EXISTS idx_segments_task_idx
      ON segments(task_id, seg_index);

    CREATE INDEX IF NOT EXISTS idx_project_files_project
      ON project_files(project_id);

    CREATE INDEX IF NOT EXISTS idx_projects_assigned_user
      ON projects(assigned_user);

    CREATE INDEX IF NOT EXISTS idx_projects_created_by
      ON projects(created_by);

    CREATE INDEX IF NOT EXISTS idx_projects_status_updated
      ON projects(status, provisioning_updated_at DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_projects_idempotency_key
      ON projects((project_settings->>'createIdempotencyKey'))
      WHERE project_settings ? 'createIdempotencyKey';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_assigned_user_name_unique
      ON projects(assigned_user, LOWER(name));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_artifacts_bucket_key_unique
      ON file_artifacts(bucket, object_key);

    CREATE INDEX IF NOT EXISTS idx_file_artifacts_file_kind_created
      ON file_artifacts(file_id, kind, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_template_versions_template_created
      ON template_versions(template_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_events_object
      ON audit_events(object_type, object_id, timestamp DESC, id DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_parsing_templates_name_unique
      ON parsing_templates(LOWER(name));

    CREATE INDEX IF NOT EXISTS idx_glossaries_disabled
      ON glossaries(disabled);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_glossaries_label_unique
      ON glossaries(LOWER(label));

    CREATE INDEX IF NOT EXISTS idx_glossary_entries_glossary
      ON glossary_entries(glossary_id);

    CREATE INDEX IF NOT EXISTS idx_glossary_entries_lookup
      ON glossary_entries(glossary_id, source_lang, target_lang, term);

    CREATE INDEX IF NOT EXISTS idx_glossary_entries_created_at
      ON glossary_entries(glossary_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_glossary_entries_updated_at
      ON glossary_entries(glossary_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_glossary_entry_media_glossary
      ON glossary_entry_media(glossary_id);

    CREATE INDEX IF NOT EXISTS idx_glossary_entry_media_entry
      ON glossary_entry_media(entry_id);

    CREATE INDEX IF NOT EXISTS idx_glossary_imports_status
      ON glossary_imports(status, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_translation_engines_name_unique
      ON translation_engines(LOWER(name));

    CREATE INDEX IF NOT EXISTS idx_pretranslate_jobs_status
      ON project_pretranslate_jobs(status);

    CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
      ON chat_threads(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
      ON chat_messages(thread_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_tool_calls_message_created
      ON tool_calls(message_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_chat_audit_user_created
      ON chat_audit_events(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_audit_request_created
      ON chat_audit_events(request_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_provision_jobs_status
      ON provision_jobs(status);

    CREATE INDEX IF NOT EXISTS idx_provision_jobs_project
      ON provision_jobs(project_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_project_file_processing_logs_file_created
      ON project_file_processing_logs(project_id, file_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_type_configs_name_unique
      ON file_type_configs(LOWER(name));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_templates_name_unique
      ON project_templates(LOWER(name));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_language_processing_rulesets_name_unique
      ON language_processing_rulesets(LOWER(name));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_nmt_providers_name_unique
      ON nmt_providers(LOWER(name));
  `);
}

export async function initDatabase() {
  await withDatabaseInitLock(async () => {
    await runInitDatabaseMigrations();
  });
}

function maskApiKey(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  const last4 = v.length >= 4 ? v.slice(-4) : "";
  const prefix = v.startsWith("sk-") ? "sk-" : "";
  return `${prefix}****${last4 || "****"}`;
}

function maskBaseUrl(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  try {
    const url = new URL(v);
    const host = url.host;
    if (!host) return "stored";
    return `${url.protocol}//${host}/...`;
  } catch {
    return "stored";
  }
}

async function migrateNmtProviderSecrets() {
  type Row = {
    id: number;
    config: any;
    secret_enc: string | null;
    base_url_masked: string | null;
    api_key_masked: string | null;
  };

  const res = await db.query<Row>(
    `SELECT id, config, secret_enc, base_url_masked, api_key_masked
     FROM nmt_providers
     ORDER BY id ASC`
  );

  for (const row of res.rows) {
    const cfg = row.config && typeof row.config === "object" ? row.config : {};
    const configBaseUrl = String((cfg as any).baseUrl ?? (cfg as any).base_url ?? "").trim();
    const hasConfigBaseUrl = Boolean(configBaseUrl);
    const decrypted = row.secret_enc ? decryptJson(row.secret_enc) : null;
    const encryptedBaseUrl = String(decrypted?.baseUrl ?? decrypted?.base_url ?? "").trim();
    const apiKey = String(decrypted?.apiKey ?? decrypted?.api_key ?? "").trim();

    const baseUrl = encryptedBaseUrl || configBaseUrl;

    const needsConfigCleanup = (cfg as any).baseUrl !== undefined || (cfg as any).base_url !== undefined;
    const needsBaseUrlEncryption = hasConfigBaseUrl && !encryptedBaseUrl;
    const needsBaseUrlMasked = !String(row.base_url_masked || "").trim() && Boolean(baseUrl);
    const needsApiKeyMasked = !String(row.api_key_masked || "").trim() && Boolean(apiKey);

    if (!needsConfigCleanup && !needsBaseUrlEncryption && !needsBaseUrlMasked && !needsApiKeyMasked) {
      continue;
    }

    const nextSecretEnc = needsBaseUrlEncryption
      ? encryptJson({
          ...(decrypted && typeof decrypted === "object" ? decrypted : {}),
          baseUrl,
          apiKey: apiKey || undefined
        })
      : row.secret_enc;

    const nextBaseUrlMasked = needsBaseUrlMasked ? maskBaseUrl(baseUrl) : null;
    const nextApiKeyMasked = needsApiKeyMasked ? maskApiKey(apiKey) : null;

    await db.query(
      `UPDATE nmt_providers
       SET config = config - 'baseUrl' - 'base_url',
           secret_enc = COALESCE($2, secret_enc),
           base_url_masked = COALESCE(NULLIF(base_url_masked, ''), $3),
           api_key_masked = COALESCE(NULLIF(api_key_masked, ''), $4)
       WHERE id = $1`,
      [row.id, nextSecretEnc, nextBaseUrlMasked, nextApiKeyMasked]
    );
  }
}

export async function enforceGlossaryUniqueness() {
  await db.query(`
    DELETE FROM global_glossary_entries a
    USING global_glossary_entries b
    WHERE a.id > b.id
      AND a.term = b.term
      AND a.translation = b.translation
      AND a.source_lang IS NOT DISTINCT FROM b.source_lang
      AND a.target_lang IS NOT DISTINCT FROM b.target_lang;
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_global_glossary_unique
      ON global_glossary_entries(term, translation, source_lang, target_lang) NULLS NOT DISTINCT;
  `);
}

export async function enforceGlossaryLabelUniqueness() {
  await db.query(`
    UPDATE glossaries
    SET label = BTRIM(label)
    WHERE label <> BTRIM(label);
  `);

  await db.query(`
    UPDATE glossaries
    SET label = 'Glossary #' || id
    WHERE BTRIM(label) = '';
  `);

  await db.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY LOWER(label) ORDER BY created_at ASC, id ASC) AS rn
      FROM glossaries
    )
    UPDATE glossaries g
    SET label = g.label || ' (duplicate #' || g.id || ')'
    FROM ranked r
    WHERE g.id = r.id
      AND r.rn > 1;
  `);
}

export async function enforceTmLibraryLabelUniqueness() {
  await db.query(`
    UPDATE tm_library
    SET label = BTRIM(label)
    WHERE label <> BTRIM(label);
  `);

  await db.query(`
    UPDATE tm_library
    SET label = 'TMX #' || id
    WHERE BTRIM(label) = '';
  `);

  await db.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY origin, LOWER(label)
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM tm_library
    )
    UPDATE tm_library t
    SET label = t.label || ' (duplicate #' || t.id || ')'
    FROM ranked r
    WHERE t.id = r.id
      AND r.rn > 1;
  `);
}

export async function enforceProjectNameUniqueness() {
  await db.query(`
    UPDATE projects
    SET name = BTRIM(name)
    WHERE name <> BTRIM(name);
  `);

  await db.query(`
    UPDATE projects
    SET assigned_user = created_by
    WHERE assigned_user IS NULL
      AND created_by IS NOT NULL;
  `);

  await db.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY assigned_user, LOWER(name)
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM projects
      WHERE assigned_user IS NOT NULL
        AND BTRIM(name) <> ''
    )
    UPDATE projects p
    SET name = p.name || ' (duplicate #' || p.id || ')'
    FROM ranked r
    WHERE p.id = r.id
      AND r.rn > 1;
  `);
}



