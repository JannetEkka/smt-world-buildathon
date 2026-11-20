#!/usr/bin/env node
// SMT World → Firebase Hosting: assemble smt_world/firebase/public/ (11-20, buildathon).
//
//   node build.mjs                       # uses src/firebase-config.js as it is
//   node build.mjs --project <id> --recaptcha <key>
//                                        # fills the config from `firebase apps:sdkconfig web`
//                                        # (Cloud Shell: firebase-tools is preinstalled and logged in)
//
// ONE copy of the world: the islands, advisors, calls and Ask SMT come from smt_world/ itself;
// this only adds the Firebase files (ask/) and two script tags. Node built-ins only — nothing
// to `npm install` (the Firebase SDK loads from Google's gstatic CDN, pinned to 13.2.0).
//
// What it NEVER copies: founder/ (the founder feed), worker.js, functions/ server code,
// wrangler config. account.json goes out through the SAME public-fields filter the Worker
// serves (functions/api/public_account.js), so a guest reads exactly what workers.dev shows.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD = path.resolve(HERE, "..");
const OUT = path.join(HERE, "public");
// the Worker keeps serving the LIVE feeds (it sends CORS for them, worker.js PUBLIC_FEEDS)
export const FEED_BASE = "https://smt-weex-trading-bot.jannet-ekka.workers.dev";

const COPY = ["index.html", "app.js", "style.css", "smt_logo.png", "decisions.json", "trend.json", "assets", "vendor"];
const NEVER = ["founder", "worker.js", "functions", "wrangler.jsonc", ".assetsignore", "firebase"];

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }

function sdkConfigFromCli(project) {
  try {
    const out = execFileSync("firebase", ["apps:sdkconfig", "web", "--project", project, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    // --json prints {status, result}; result.sdkConfig is the web config (firebase-tools
    // lib/commands/apps-sdkconfig.js). Parse from the JSON's own start, in case a spinner
    // line lands on stdout first.
    const at = out.search(/\{\s*"status"/);
    const j = JSON.parse(at >= 0 ? out.slice(at) : out);
    const cfg = (j.result && j.result.sdkConfig) || null;
    if (!cfg || !cfg.apiKey) throw new Error("no apiKey in the CLI's answer");
    return cfg;
  } catch (e) {
    console.error(`✘ could not read the web app config with \`firebase apps:sdkconfig web --project ${project}\`: ${String(e.message || e).split("\n")[0]}`);
    console.error("  Register a web app first (Firebase console → Project settings → Your apps → </>), or paste its config into src/firebase-config.js.");
    process.exit(1);
  }
}

export function injectScripts(html, feedBase) {
  if (!html.includes('<script src="app.js"></script>')) throw new Error('index.html no longer loads app.js with <script src="app.js"></script> — update build.mjs');
  return html
    .replace('<script src="app.js"></script>',
      `<script>window.SMT_FEED_BASE = ${JSON.stringify(feedBase)}; window.SMT_HOST = "firebase";</script>\n<script src="app.js"></script>\n` +
      `<link rel="stylesheet" href="ask/ask.css"/>\n<script type="module" src="ask/ask.js"></script>\n<script type="module" src="ask/account.js"></script>`)
    .replace("<title>SMT World — A market you can sail</title>", "<title>SMT World — A market you can sail</title>\n<meta name=\"description\" content=\"SMT World: an AI crypto trader that has to prove why it traded. Ask it out loud in English, Hindi or Bengali.\"/>");
}

export async function build({ project = null, recaptcha = null, screen = null, out = OUT } = {}) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of COPY) fs.cpSync(path.join(WORLD, f), path.join(out, f), { recursive: true });
  // the art's working files are not part of the site
  fs.rmSync(path.join(out, "assets", "concept"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "assets", "convert.py"), { force: true });
  fs.rmSync(path.join(out, "assets", "README.md"), { force: true });

  // account.json — the public projection, the Worker's own function
  const { projectPublic } = await import(path.join(WORLD, "functions", "api", "public_account.js"));
  const snap = JSON.parse(fs.readFileSync(path.join(WORLD, "account.json"), "utf8"));
  fs.writeFileSync(path.join(out, "account.json"), JSON.stringify(projectPublic(snap)));

  // ask/ — the Firebase Ask SMT, plus the chat's prompt text (one copy, shared with the Worker)
  fs.cpSync(path.join(HERE, "src"), path.join(out, "ask"), { recursive: true });
  fs.copyFileSync(path.join(WORLD, "functions", "api", "chat_prompt.js"), path.join(out, "ask", "chat_prompt.js"));
  if (project) {
    const cfg = sdkConfigFromCli(project);
    fs.writeFileSync(path.join(out, "ask", "firebase-config.js"),
      "// written by build.mjs from `firebase apps:sdkconfig web` — public by design\nexport const firebaseConfig = " + JSON.stringify(cfg, null, 2) + ";\n" +
      `export const recaptchaKey = ${JSON.stringify(recaptcha || "")};\n` +
      `export const screenUrl = ${JSON.stringify(screen || "")};\n`);
  } else if (recaptcha) {
    const p = path.join(out, "ask", "firebase-config.js");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/export const recaptchaKey = "[^"]*";/, `export const recaptchaKey = ${JSON.stringify(recaptcha)};`));
  }
  const cfgText = fs.readFileSync(path.join(out, "ask", "firebase-config.js"), "utf8");
  const configured = !/PASTE_FROM_FIREBASE_CONSOLE/.test(cfgText);
  const appCheck = /recaptchaKey = "[^"]+"/.test(cfgText);

  fs.writeFileSync(path.join(out, "index.html"), injectScripts(fs.readFileSync(path.join(WORLD, "index.html"), "utf8"), FEED_BASE));

  for (const n of NEVER) if (fs.existsSync(path.join(out, n))) throw new Error(`${n} must never be in the public build`);
  const acct = JSON.parse(fs.readFileSync(path.join(out, "account.json"), "utf8"));
  return { out, configured, appCheck, feedAt: acct.generated_at, files: countFiles(out) };
}
function countFiles(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1; return n; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await build({ project: arg("--project"), recaptcha: arg("--recaptcha"), screen: arg("--screen") });
  console.log(`✔ built ${r.files} files into ${path.relative(process.cwd(), r.out) || r.out}`);
  console.log(`  feed snapshot (fallback) written ${r.feedAt}; live feed read from ${FEED_BASE}`);
  if (!r.configured) console.log("  ⚠️ firebase-config.js still has the placeholder: the world works, but Ask SMT can't reach Gemini.\n     Run with --project <your-project-id>, or paste the config into src/firebase-config.js.");
  if (r.configured && !r.appCheck) console.log("  ⚠️ no reCAPTCHA key: App Check is OFF on this build. If Firebase enforces App Check for AI Logic\n     (it did by default from 2026-11-02), Gemini calls will be refused. Add --recaptcha <key> (README step 4).");
  if (r.configured) console.log("  Firebase config present ✔ — next: firebase deploy --only hosting" + (arg("--project") ? ` --project ${arg("--project")}` : ""));
}
