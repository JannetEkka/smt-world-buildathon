import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, injectScripts, FEED_BASE } from "../build.mjs";
import * as W from "../src/lib/wav.js";

const WORLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIELDS = JSON.parse(fs.readFileSync(path.join(WORLD, "functions/api/public_fields.json"), "utf8"));

test("the Firebase build ships the world and Ask SMT, and never the founder feed or server code", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "smt-fb-"));
  const r = await build({ out });
  for (const f of ["index.html", "app.js", "style.css", "decisions.json", "account.json", "assets/lighthouse.webp",
                   "ask/ask.js", "ask/ask.css", "ask/chat_prompt.js", "ask/firebase-config.js", "ask/lib/guardrails.js"])
    assert.ok(fs.existsSync(path.join(out, f)), f);
  for (const f of ["founder", "worker.js", "functions", "wrangler.jsonc", "assets/concept"])
    assert.ok(!fs.existsSync(path.join(out, f)), `${f} must not ship`);
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.ok(html.indexOf("SMT_FEED_BASE") < html.indexOf('src="app.js"') && html.indexOf('src="app.js"') < html.indexOf("ask/ask.js"));
  // account.json is the Worker's public projection: no field outside public_fields.json
  const acct = JSON.parse(fs.readFileSync(path.join(out, "account.json"), "utf8"));
  const allowedRow = new Set([...FIELDS.row, "setup_kind", "exit_kind", "record"]);
  for (const x of [...acct.live.open, ...acct.paper.open, ...acct.live.recent_closes])
    for (const k of Object.keys(x)) assert.ok(allowedRow.has(k), `account.json row field ${k} is not public`);
  assert.equal(r.configured, false, "the committed config is the placeholder");
});

test("the build refuses an index.html it can't inject into, rather than shipping without Ask SMT", () => {
  assert.throws(() => injectScripts("<html><script src='app.js'></script></html>", FEED_BASE));
});

test("WAV: a valid 16 kHz mono 16-bit file, and the Live API's PCM decodes back", () => {
  const s = new Float32Array(48000).map((_, i) => Math.sin(i / 10) * 0.5);
  const d = W.downsample(s, 48000, 16000);
  assert.equal(d.length, 16000);
  const wav = W.encodeWav(d, 16000);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), "RIFF");
  assert.equal(Buffer.from(wav.subarray(8, 12)).toString(), "WAVE");
  const v = new DataView(wav.buffer);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(wav.length, 44 + 16000 * 2);
  const pcm = new Int16Array([0, 16384, -16384, 32767]);
  const back = W.pcm16ToFloat(Buffer.from(pcm.buffer).toString("base64"));
  assert.deepEqual([...back].map(x => Math.round(x * 4) / 4), [0, 0.5, -0.5, 1]);
  assert.ok(W.toBase64(wav).length > 0);
});
