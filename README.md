# FastCAT

FastCAT is a self-hosted, browser-based CAT/TMS stack for translation teams. It combines project intake, translation memory, terminology, rules, MT/LLM provider management, a browser editor, and an app-wide assistant in one Docker deployment.

> License: source-available for non-commercial use only. Commercial use requires a separate paid license. See [LICENSE](./LICENSE).

## Current state

The repository is no longer a small "TM Lite" demo. The current application includes:

- Global Setup for first-run provisioning and first admin creation
- Role-based access for `admin`, `manager`, and `reviewer`
- Dashboard with summary metrics and the App Agent chat panel
- Projects area with a multi-step creation wizard, provisioning flow, downloads, and project detail views
- Inbox for assigned work
- Browser editor with classic and modern modes, TM/TB/MT/LLM suggestions, concordance, QA/issues, history, bulk actions, and rendered previews
- Resources area for project templates, file type configurations, JSON/extraction templates, translation engines, translation memories, termbases, rulesets, and NMT/LLM providers
- Admin pages for users, stats, language settings, departments, and App Agent configuration
- Background provisioning and pretranslation workers

The codebase and tests currently cover XLIFF/XML, HTML/XHTML/XTML, and Office document flows (`.docx`, `.pptx`, `.xlsx`). TMX-backed translation memory is handled through `t5memory` plus `tm-proxy`.

## Architecture

FastCAT runs as a multi-service Docker stack:

| Service | Purpose | Default port |
| --- | --- | --- |
| `web` | Nginx serving the frontend and reverse proxying the APIs | `9991` |
| `frontend` | React 19 + Vite single-page app | built into `web` |
| `cat-api` | Main CAT/TMS API, project handling, editor APIs, resources, chat backend | `4000` |
| `tm-proxy` | Auth, user management, and TM/TMX proxy APIs | `3001` |
| `llm-gateway` | OpenAI-compatible provider gateway and App Agent runtime support | `5005` |
| `tm-db` | Postgres persistence | `5433` |
| `redis` | Rate limits and worker/support state | `6379` |
| `minio` | S3-compatible object storage for uploads and generated artifacts | `9000` / `9001` |
| `t5memory` | Translation memory engine | `4040` |
| `tm-backup` | Periodic Postgres backup container | internal |

## Quick start

Requirements:

- Docker with Compose support

Start the full stack:

```bash
docker compose up -d --build
```

Then open `http://localhost:9991`.

On the first run, FastCAT redirects to **Global Setup**. Complete that flow to create the first admin account and initialize the application.

## Local development

For day-to-day development, the simplest path is to run the full Docker stack and optionally run the frontend or `cat-api` locally.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

CAT API:

```bash
cd cat-api
npm install
npm run dev
```

The remaining services are typically left on Docker unless you are working on them directly.

## Key runtime notes

- Authentication is handled by `tm-proxy`.
- Project, resource, and editor APIs are exposed from `cat-api`.
- Files and derived artifacts are stored in MinIO by default. In AWS-style deployments, the same code can point at S3 via environment variables.
- The App Agent stores chat threads, messages, and tool calls in Postgres.
- `llm-gateway` speaks an OpenAI-compatible API and can bridge `localhost` inside containers to `host.docker.internal` for local model endpoints.
- `./glossaries` is mounted into the stack and available to `cat-api` at startup.
- No TMX libraries are preloaded automatically; upload them through the UI.

## Testing

Service tests:

```bash
cd frontend
npm test
```

```bash
cd cat-api
npm test
```

Docker smoke checks:

```bash
node scripts/docker-smoke-check.mjs
node scripts/app-agent-project-flow-smoke.mjs
```

Optional UI/screenshot checks:

```bash
node scripts/capture-ui-screenshots.mjs
node scripts/capture-collection-shell-screens.mjs
```

The smoke scripts exercise admin, manager, and reviewer flows, project creation, termbase access rules, and guided App Agent project creation.

## Selected environment variables

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Shared JWT signing secret used by the app services |
| `TM_DB_URL`, `CAT_DB_URL` | Postgres connection strings |
| `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_PUBLIC_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Object storage configuration |
| `REDIS_URL` | Redis connection string |
| `TM_PROXY_URL` | `cat-api` to `tm-proxy` base URL |
| `LLM_GATEWAY_URL` | `cat-api` to `llm-gateway` base URL |
| `LLM_GATEWAY_LOCALHOST_BRIDGE` | Localhost rewrite for container-to-host model access |
| `APP_AGENT_INTERNAL_SECRET` | Internal auth between App Agent components |
| `CHAT_AGENT_SYSTEM_PROMPT` | Server-side system prompt for the App Agent |
| `CHAT_LLM_PROVIDER_ID` | Optional fixed provider for chat |
| `CHAT_RATE_LIMIT_PER_MINUTE` | Per-user chat rate limit |
| `CHAT_MAX_HISTORY_MESSAGES` | Chat history window loaded per turn |
| `CHAT_TRANSLATE_MAX_CHARS` | Character limit for snippet translation tool calls |

## Repository layout

- [`frontend/`](./frontend) - React UI
- [`cat-api/`](./cat-api) - main backend
- [`tm-proxy/`](./tm-proxy) - auth and TM/TMX proxy
- [`llm-gateway/`](./llm-gateway) - Python gateway for providers and agent runtime
- [`web/`](./web) - Nginx packaging for the frontend
- [`docs/`](./docs) - design notes, acceptance notes, and screenshot helpers
- [`scripts/`](./scripts) - smoke checks and screenshot capture helpers
- [`example_files/`](./example_files) - sample input files for manual testing

## License

FastCAT is source-available, not MIT-licensed.

- Non-commercial use is allowed under the terms in [`LICENSE`](./LICENSE).
- Commercial use is not granted by default.
- Any commercial use requires a separate written paid license from the copyright holder.
