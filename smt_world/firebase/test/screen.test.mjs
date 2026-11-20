// Unit tests: the Worker's Model Armor route (functions/api/screen.js) — App Check verification
// with REAL RS256-signed tokens, the Model Armor response mapping, and its refusals.
import test from "node:test";
import assert from "node:assert/strict";
import { verifyAppCheck, readArmor, onScreen, onScreenOptions } from "../../functions/api/screen.js";

const PN = "600097193499";
const b64url = b => Buffer.from(b).toString("base64url");
async function keys() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  return { kp, jwks: { keys: [jwk] } };
}
async function token(kp, payload, header = { alg: "RS256", typ: "JWT", kid: "k1" }) {
  const unsigned = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(unsigned));
  return unsigned + "." + b64url(new Uint8Array(sig));
}
const good = () => ({ iss: `https://firebaseappcheck.googleapis.com/${PN}`, aud: [`projects/${PN}`, "projects/smt-buildathon"],
                      sub: "1:600097193499:web:abc", exp: Math.floor(Date.now() / 1000) + 3600 });

test("App Check: a token signed by the project's key, for the project, unexpired → accepted", async () => {
  const { kp, jwks } = await keys();
  const r = await verifyAppCheck(await token(kp, good()), { projectNumber: PN, jwks });
  assert.deepEqual(r, { ok: true, appId: "1:600097193499:web:abc" });
});

test("App Check: wrong issuer, wrong audience, expired, wrong alg, bad signature, junk → refused with the reason", async () => {
  const { kp, jwks } = await keys();
  const other = await keys();
  const cases = [
    [{ ...good(), iss: "https://firebaseappcheck.googleapis.com/999" }, undefined, "wrong issuer"],
    [{ ...good(), aud: ["projects/999"] }, undefined, "wrong audience"],
    [{ ...good(), exp: Math.floor(Date.now() / 1000) - 10 }, undefined, "token expired"],
    [good(), { alg: "HS256", typ: "JWT", kid: "k1" }, "wrong token type"],
  ];
  for (const [p, h, why] of cases)
    assert.equal((await verifyAppCheck(await token(kp, p, h), { projectNumber: PN, jwks })).why, why);
  assert.equal((await verifyAppCheck(await token(other.kp, good()), { projectNumber: PN, jwks })).why, "bad signature");
  assert.equal((await verifyAppCheck("not.a.token", { projectNumber: PN, jwks })).ok, false);
  assert.equal((await verifyAppCheck("", { projectNumber: PN, jwks })).why, "no App Check token");
});

// The two responses Google's Model Armor docs show for sanitizeUserPrompt.
const DOC_MATCH = { sanitizationResult: { filterMatchState: "MATCH_FOUND", invocationResult: "SUCCESS", filterResults: {
  csam: { csamFilterFilterResult: { executionState: "EXECUTION_SUCCESS", matchState: "NO_MATCH_FOUND" } },
  malicious_uris: { maliciousUriFilterResult: { executionState: "EXECUTION_SUCCESS", matchState: "NO_MATCH_FOUND" } },
  rai: { raiFilterResult: { executionState: "EXECUTION_SUCCESS", matchState: "MATCH_FOUND", raiFilterTypeResults: { dangerous: { matchState: "MATCH_FOUND" } } } },
  pi_and_jailbreak: { piAndJailbreakFilterResult: { executionState: "EXECUTION_SUCCESS", matchState: "MATCH_FOUND" } },
  sdp: { sdpFilterResult: { inspectResult: { executionState: "EXECUTION_SUCCESS", matchState: "NO_MATCH_FOUND" } } } } } };
const DOC_CLEAN = { sanitizationResult: { filterMatchState: "NO_MATCH_FOUND", filterResults: {
  pi_and_jailbreak: { piAndJailbreakFilterResult: { executionState: "EXECUTION_SUCCESS", matchState: "NO_MATCH_FOUND" } } } } };

test("Model Armor: a prompt-injection match blocks as 'injection'; a clean prompt is allowed", () => {
  const m = readArmor(DOC_MATCH);
  assert.equal(m.verdict, "block"); assert.equal(m.category, "injection");
  assert.equal(m.filters.pi_and_jailbreak, true); assert.equal(m.filters.rai, true);
  assert.deepEqual(readArmor(DOC_CLEAN).verdict, "allow");
});

test("Model Armor: a responsible-AI match alone is reported but does not block (SMT's own refusals cover it)", () => {
  const onlyRai = JSON.parse(JSON.stringify(DOC_MATCH));
  onlyRai.sanitizationResult.filterResults.pi_and_jailbreak.piAndJailbreakFilterResult.matchState = "NO_MATCH_FOUND";
  const r = readArmor(onlyRai);
  assert.equal(r.verdict, "allow"); assert.equal(r.filters.rai, true);
});

test("/api/screen says why when it is not configured, and answers CORS only for the Firebase origins", async () => {
  const req = (origin) => new Request("https://w.dev/api/screen", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
  const r = await onScreen(req("https://smt-buildathon.web.app"), {});
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /not configured/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://smt-buildathon.web.app");
  const evil = onScreenOptions(new Request("https://w.dev/api/screen", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), {});
  assert.equal(evil.headers.get("Access-Control-Allow-Origin"), null);
});

test("/api/screen refuses a request without a valid App Check token before calling Google", async () => {
  const realFetch = globalThis.fetch; const called = [];
  globalThis.fetch = async (u) => { called.push(String(u)); return new Response(JSON.stringify({ keys: [] })); };
  try {
    const r = await onScreen(new Request("https://w.dev/api/screen", { method: "POST", headers: { Origin: "https://smt-buildathon.web.app", "X-Firebase-AppCheck": "x.y.z" },
      body: JSON.stringify({ text: "hi" }) }), { MODEL_ARMOR_SA: "{}", MODEL_ARMOR_TEMPLATE: "projects/p/locations/us-central1/templates/t" });
    assert.equal(r.status, 401);
    assert.ok(called.every(u => u.includes("firebaseappcheck")), "only the App Check key set may be fetched: " + called);
  } finally { globalThis.fetch = realFetch; }
});
