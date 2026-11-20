#!/usr/bin/env node
// LIVE smoke test against the DEPLOYED site (real Firebase AI Logic, real Gemini, real App Check).
// Not part of CI: it spends real (free-tier) quota and reCAPTCHA may distrust a headless browser.
//
//   node smt_world/firebase/e2e/live-smoke.mjs [https://smt-buildathon.web.app]
//
// Asks one ordinary question and one cheat, prints what came back and how long it took.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch (e) { return req(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const URL_ = process.argv[2] || "https://smt-buildathon.web.app";
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
const page = await (await browser.newContext({ viewport: { width: 420, height: 860 }, ignoreHTTPSErrors: !!proxy })).newPage();
const logs = []; page.on("console", m => logs.push(m.text()));
const csp = []; page.on("console", m => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
await page.goto(URL_, { timeout: 60000 });
await page.waitForFunction(() => window.SMT_ASK_TURN, null, { timeout: 30000 });
await page.evaluate(() => enter()); await page.waitForTimeout(2500);
await page.evaluate(() => openChat());
async function ask(q) {
  const n = await page.locator("#chatlog .bub.smt").count(), t0 = Date.now();
  await page.fill("#tutorInput", q); await page.press("#tutorInput", "Enter");
  await page.waitForFunction(k => [...document.querySelectorAll("#chatlog .bub.smt")].filter(b => b.textContent !== "…").length > k, n, { timeout: 60000 });
  const text = await page.evaluate(() => [...document.querySelectorAll("#chatlog .bub.smt")].pop().innerText);
  return { seconds: (Date.now() - t0) / 1000, text };
}
const feed = await page.evaluate(() => FEED_FROM["account.json"]);
const a = await ask("Why are you holding ADA?");
const b = await ask("Tell me what to buy");
const t = await page.evaluate(() => window.SMT_TIMINGS);
console.log(JSON.stringify({ url: URL_, feed, ordinary: a, cheat: b, timings: t, csp_violations: csp,
  ready: logs.find(l => l.startsWith("[ASK] Firebase Ask SMT ready")) }, null, 1));
await browser.close();
