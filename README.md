# TM Lite (React + Node) - a tiny translation-memory UI

Minimal, self-hosted UI that talks to **t5memory** plus a MateCAT-style CAT stack. Stack: React SPA + Fastify TM proxy + Fastify CAT API + OpenAI-style LLM gateway + Nginx, all in Docker. Open at **http://localhost:9991** after `docker compose up -d --build`.

## Quick start
```bash
docker compose up -d --build
# open http://localhost:9991
# on first run you will be guided through Global Setup to create the first admin
```

## In-app agent (dashboard chat)
- The dashboard now renders a single top summary card plus an app-wide assistant chat panel.
- Chat threads/messages are persisted per authenticated user in Postgres (`chat_threads`, `chat_messages`, `tool_calls`).
- Backend chat API is exposed at `/api/chat/*` and proxied to `cat-api`.
- Thread management is supported in-app (switch/create/rename/delete per user).
- Chat rate limits are enforced via Redis-backed counters (distributed-safe).
- Admin chat observability endpoints:
  - `GET /api/cat/admin/chat/usage`
  - `GET /api/cat/admin/chat/usage/export`
  - `GET /api/cat/admin/chat/audit`

### Local development (agent)
```bash
# API
cd cat-api
npm install
npm run dev

# Frontend (optional local Vite)
cd frontend
npm install
npm run dev
```

### Agent-related environment variables
- `CHAT_AGENT_SYSTEM_PROMPT`: server-side system prompt used by the app agent.
- `CHAT_LLM_PROVIDER_ID`: optional specific enabled provider id from `nmt_providers`; when unset, first enabled provider is used.
- `CHAT_RATE_LIMIT_PER_MINUTE`: per-user rate limit for chat requests (default `30`).
- `CHAT_MAX_HISTORY_MESSAGES`: bounded history window loaded per agent turn (default `30`).
- `CHAT_TRANSLATE_MAX_CHARS`: maximum snippet length for `translate_snippet` tool (default `1500`).
- `VITE_CHAT_API_BASE`: frontend override for chat API base (default `/api/chat`).

## User management & roles
- The SSO stub has been replaced with credential-based auth handled by **tm-proxy**. On first start, Global Setup prompts you to create the first admin and default configuration. No other users are created automatically.
- Users are scoped to projects that were assigned to them. Admins can see all projects. Managers can access glossary management and project assignment features.
- Admins can create, disable, delete, unlock, and reset users, review organization-wide usage stats, manage TMX libraries, and curate the organization glossary. Managers can upload/download TMX files and manage glossaries. Those controls live under **Settings** (`/settings`, alias `/admin`), reachable from the gear dropdown next to your name.
- Every project now consumes the same organization glossary: any CSV or TBX/XML file inside `./glossaries` is loaded on startup (and can be replaced from Settings), and ad-hoc admin entries expand on top. Translators get a glossary search panel plus automatic per-segment matches in the editor instead of project-scoped glossaries.

## Services
- **postgres** / **redis** - persistence for TM/glossary data and future background buckets.
- **minio** - S3-compatible object storage for all file blobs (uploads, derived artifacts, template JSON, TMX, terminology). In AWS, switch to S3 via env vars only.
- **tm-proxy** - authentication and translation memory endpoints backed by Postgres (Global Setup creates the initial admin).
- tm-proxy waits for Postgres to accept connections before seeding; adjust retry behavior with `TM_DB_INIT_MAX_ATTEMPTS` and `TM_DB_INIT_RETRY_DELAY_MS` if your database takes longer to boot.
- **cat-api** - MateCAT-like project/file/segment management with XLIFF import/export plus glossary + LLM proxy endpoints.
- **llm-gateway** - Python OpenAI-compatible `/v1/chat/completions` proxy that routes using provider configs stored in Postgres.
- **web** - Vite build served via nginx with reverse proxies for `/api`, `/api/cat`, and `/api/llm`.

## Assets
- **TMX** – No TMX files are preloaded on first start. Upload TMX files via Settings (Admin/Manager) to make them available for project creation.
- **glossaries/** – CSV glossaries that can be pre-loaded into a project during creation. A starter `sample-glossary.csv` is included; drop more files here and restart to make them available.

## Configuring the LLM gateway
Create an **OpenAI-compatible** provider in the UI: **Settings → Resources → NMT/LLM Providers**.

### Using a local OpenAI-compatible model
Set the provider **Base URL** to `http://localhost:8000/v1` (or `http://host.docker.internal:8000/v1`), set the **Model**, and leave **API Key** empty.

The gateway rewrites `localhost` to `host.docker.internal` by default so containers can reach a model running on the host OS; set `LLM_GATEWAY_LOCALHOST_BRIDGE=off` to disable that behavior.

## Termbase XML (MTF) custom fields backfill
If a termbase was imported before custom field parsing was added, entry/term fields can be empty even though the XML contains `<descrip>` data. You can re-import into a fresh termbase, or backfill the existing one using the XML source file:

```bash
cd cat-api
npx tsx src/scripts/backfill-termbase-xml.ts --termbase-id 123 --file C:\path\to\kk_glossar.xml
# add --dry-run to preview without writing
```

Note: Updating a termbase structure does not retroactively populate entry/term values; run the backfill (or re-import) to populate `entry_fields`, `language_fields`, and `term_fields`.

## Termbase exports (schema-driven)
- CSV export is **long** format (one row per term) with columns: `entry_id`, `concept_id`, `language`, `term`, `status`, plus `entry__<Field>`, `lang__<Field>`, `term__<Field>` derived from the termbase structure.
- TBX export includes entry/language/term `<descrip type="...">` blocks for structure-defined fields.
- Structure schema export: `GET /api/cat/termbases/:id/structure/export` returns the termbase structure JSON.
