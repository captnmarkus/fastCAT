#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE_URL = process.env.FASTCAT_BASE_URL || "http://localhost:9991";
const LOGIN_CANDIDATES = [
  {
    username: process.env.FASTCAT_ADMIN_USER || "admin",
    password: process.env.FASTCAT_ADMIN_PASS || "FastCAT!12345"
  },
  {
    username: process.env.FASTCAT_MANAGER_USER || "smoke_manager",
    password: process.env.FASTCAT_MANAGER_PASS || "FastCAT!12345"
  }
];
const OUT_DIR = path.resolve(
  process.cwd(),
  process.env.FASTCAT_SCREENSHOT_DIR || path.join("docs", "screenshots", "after")
);

const TARGETS = [
  { path: "/projects/create", file: "projects-create.png" },
  { path: "/resources/file-types/create", file: "file-types-wizard.png" },
  { path: "/resources/templates/new", file: "project-template-wizard.png" },
  { path: "/resources/translation-engines/create", file: "translation-engine-wizard.png" },
  { path: "/resources/translation-memories/new", file: "translation-memory-wizard.png" },
  { path: "/resources/rules/new", file: "ruleset-wizard.png" },
  { path: "/resources/terminology/create", file: "termbase-wizard.png" },
  { path: "/resources/nmt-providers/create", file: "nmt-provider-wizard.png" },
  { path: "/projects", file: "projects-filters.png" },
  { path: "/inbox", file: "inbox-filters.png" }
];

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { res, payload };
}

async function login(username, password) {
  const { res, payload } = await requestJson(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok || !payload?.token) {
    throw new Error(`login failed for ${username}: status=${res.status}`);
  }
  return { token: payload.token, user: payload.user || {} };
}

async function rotatePassword(username, currentPassword, targetPassword) {
  const { token } = await login(username, currentPassword);
  const interim = `${targetPassword}X`;
  const first = await requestJson(`${BASE_URL}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword: interim })
  });
  if (!first.res.ok) throw new Error(`password rotate step 1 failed for ${username}`);
  const { token: interimToken } = await login(username, interim);
  const second = await requestJson(`${BASE_URL}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${interimToken}` },
    body: JSON.stringify({ currentPassword: interim, newPassword: targetPassword })
  });
  if (!second.res.ok) throw new Error(`password rotate step 2 failed for ${username}`);
}

async function loginReady(username, password) {
  let auth = await login(username, password);
  if (auth.user?.mustChangePassword) {
    await rotatePassword(username, password, password);
    auth = await login(username, password);
  }
  return auth.token;
}

async function resolveToken() {
  const unique = [];
  for (const candidate of LOGIN_CANDIDATES) {
    if (!candidate.username || !candidate.password) continue;
    if (unique.some((entry) => entry.username === candidate.username && entry.password === candidate.password)) continue;
    unique.push(candidate);
  }
  for (const candidate of unique) {
    try {
      return await loginReady(candidate.username, candidate.password);
    } catch {
      // try next candidate
    }
  }
  throw new Error("No valid credentials available for screenshot capture.");
}

async function run() {
  const playwrightModule = await (async () => {
    try {
      return await import("playwright");
    } catch {
      const fallback = pathToFileURL(
        path.resolve(process.cwd(), "frontend", "node_modules", "playwright", "index.mjs")
      ).href;
      return import(fallback);
    }
  })();

  const { chromium } = playwrightModule;
  const token = await resolveToken();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript((value) => {
    window.localStorage.setItem("token", value);
  }, token);
  const page = await context.newPage();

  try {
    for (const target of TARGETS) {
      await page.goto(`${BASE_URL}${target.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT_DIR, target.file), fullPage: true });
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
