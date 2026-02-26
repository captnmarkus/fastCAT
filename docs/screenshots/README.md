# Screenshot Capture

Use `scripts/capture-ui-screenshots.mjs` to generate wizard/filter screenshots.

## Defaults
- Base URL: `http://localhost:9991`
- Credentials fallback order:
  - `FASTCAT_ADMIN_USER` / `FASTCAT_ADMIN_PASS`
  - `FASTCAT_MANAGER_USER` / `FASTCAT_MANAGER_PASS`
- Output dir (default): `docs/screenshots/after`

## Commands
- One-time prerequisite (if Playwright is not installed in `frontend/node_modules`):
  - `cd frontend && npm install --no-save playwright`
- Capture current revision (after):
  - `node scripts/capture-ui-screenshots.mjs`
- Capture baseline (before) into a separate folder:
  - `FASTCAT_SCREENSHOT_DIR=docs/screenshots/before node scripts/capture-ui-screenshots.mjs`

Set env vars as needed for non-default credentials or host:
- `FASTCAT_BASE_URL`
- `FASTCAT_ADMIN_USER`, `FASTCAT_ADMIN_PASS`
- `FASTCAT_MANAGER_USER`, `FASTCAT_MANAGER_PASS`
