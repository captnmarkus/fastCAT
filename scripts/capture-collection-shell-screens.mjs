#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE_URL = process.env.FASTCAT_BASE_URL || "http://localhost:9991";
const OUT_DIR = path.resolve(process.cwd(), "docs", "screenshots", "after");

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
  for (const candidate of LOGIN_CANDIDATES) {
    try {
      return await loginReady(candidate.username, candidate.password);
    } catch {
      // try next candidate
    }
  }
  throw new Error("No valid credentials available.");
}

async function getPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const fallback = pathToFileURL(path.resolve(process.cwd(), "frontend", "node_modules", "playwright", "index.mjs")).href;
    return import(fallback);
  }
}

async function waitAndClick(page, selector) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
}

async function captureDesktop(context, token) {
  await context.addInitScript((value) => {
    window.localStorage.setItem("token", value);
  }, token);

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/projects?view=cards`, { waitUntil: "networkidle" });
  await page.waitForSelector(".fc-project-card", { timeout: 20000 });
  await page.click(".fc-project-card");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, "collection-cards-details-open.png"), fullPage: true });

  await waitAndClick(page, "button[aria-label='List view']");
  await page.waitForSelector(".fc-table-row", { timeout: 15000 });
  await page.click(".fc-table-row");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, "collection-list-details-open.png"), fullPage: true });

  await waitAndClick(page, "button[aria-label='Collapse details']");
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT_DIR, "collection-details-collapsed.png"), fullPage: true });

  await page.close();
}

async function captureMobile(token) {
  const { chromium } = await getPlaywright();
  const context = await chromium.launch({ headless: true, channel: "msedge" }).then((browser) =>
    browser.newContext({ viewport: { width: 390, height: 844 } }).then((ctx) => ({ browser, ctx }))
  );

  const { browser, ctx } = context;
  try {
    await ctx.addInitScript((value) => {
      window.localStorage.setItem("token", value);
    }, token);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/inbox?view=list`, { waitUntil: "networkidle" });
    const collapseButtons = page.locator("button[aria-label='Collapse details']");
    if ((await collapseButtons.count()) > 0) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await page.waitForSelector(".fc-table-row", { timeout: 20000 });
    await page.click(".fc-table-row");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, "collection-mobile-drawer.png"), fullPage: true });
    await page.close();
  } finally {
    await ctx.close();
    await browser.close();
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const token = await resolveToken();
  const { chromium } = await getPlaywright();
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      await captureDesktop(context, token);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  await captureMobile(token);
}

run().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
