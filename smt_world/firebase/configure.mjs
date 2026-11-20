#!/usr/bin/env node
// Fill an already-built public/ask/firebase-config.js — for the deploy zip, where the repo
// isn't there to rebuild from (11-20). Node built-ins only.
//
//   node configure.mjs --project smt-buildathon [--recaptcha <reCAPTCHA-Enterprise-key-id>]
//
// Reads the web app's config with `firebase apps:sdkconfig web` (Cloud Shell: firebase-tools
// is preinstalled). The config and the reCAPTCHA key are both public by design.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const project = arg("--project"), recaptcha = arg("--recaptcha") || "";
if (!project) { console.error("usage: node configure.mjs --project <project-id> [--recaptcha <key-id>]"); process.exit(2); }

let out;
try {
  out = execFileSync("firebase", ["apps:sdkconfig", "web", "--project", project, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.error("✘ `firebase apps:sdkconfig web` failed: " + String(e.stderr || e.message).split("\n").filter(Boolean).slice(-2).join(" "));
  console.error("  Not logged in? run: firebase login --no-localhost   ·   No web app yet? Firebase console → Project settings → Your apps → </>");
  process.exit(1);
}
const at = out.search(/\{\s*"status"/);
const cfg = JSON.parse(at >= 0 ? out.slice(at) : out).result?.sdkConfig;
if (!cfg || !cfg.apiKey) { console.error("✘ the CLI answered without a web config (does the project have a Web app?)"); process.exit(1); }

const target = path.join(HERE, "public", "ask", "firebase-config.js");
fs.writeFileSync(target, "// written by configure.mjs from `firebase apps:sdkconfig web` — public by design\n" +
  "export const firebaseConfig = " + JSON.stringify(cfg, null, 2) + ";\n" +
  `export const recaptchaKey = ${JSON.stringify(recaptcha)};\n`);
console.log(`✔ Firebase config for ${cfg.projectId} written to public/ask/firebase-config.js`);
console.log(recaptcha ? "✔ App Check: reCAPTCHA Enterprise key set"
                      : "⚠️ no --recaptcha key: App Check is OFF in the page. If AI Logic enforces App Check, Gemini calls will be refused (README step 4).");
console.log(`next: firebase deploy --only hosting --project ${project}`);
