// SMT World — /api/screen: screen an Ask SMT question with Google Cloud Model Armor (11-20).
//
// Why here: Model Armor is called with a Google service account, and a service-account key can
// never ship in a web page. The Firebase page (smt_world/firebase/src/ask.js screenModelArmor)
// POSTs {text} here with its Firebase App Check token; this Worker
//   1. checks the token is a real App Check token for the SMT World Firebase project
//      (Firebase "custom backend" rules: JWKS, RS256, typ JWT, iss + aud = the project number),
//   2. gets a Google access token for the service account (signed JWT, cached ~50 min),
//   3. calls modelarmor.<loc>.rep.googleapis.com/v1/<template>:sanitizeUserPrompt,
//   4. answers {verdict: "block"|"allow", category, filters}.
// Blocks on prompt injection / jailbreak and malicious URLs; other filters are reported, not acted
// on (SMT's own refusals cover advice, guarantees and savings).
//
// Config (Cloudflare → Worker → Settings → Variables and Secrets):
//   MODEL_ARMOR_SA        SECRET  the service account's JSON key (role: Model Armor User)
//   MODEL_ARMOR_TEMPLATE  text    projects/<project>/locations/<loc>/templates/<id>
//   APPCHECK_PROJECT_NUMBER text  optional, default the smt-buildathon project number
//   SCREEN_ORIGINS        text    optional, comma list, default the two Firebase Hosting origins
// Missing config = 503 with the reason; the page then says Model Armor is unavailable and its
// other layers still run (A FALLBACK MUST NEVER BE SILENT).

const DEFAULT_PROJECT_NUMBER = "600097193499";   // smt-buildathon (its web appId "1:600097193499:web:…")
const DEFAULT_ORIGINS = ["https://smt-buildathon.web.app", "https://smt-buildathon.firebaseapp.com"];
const JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";
const MAX_TEXT = 4000;

const b64urlToBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const bytesToB64url = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jsonB64url = o => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));

// ── App Check token → {ok, appId} or {ok:false, why}. `jwks` is the key set (fetched by the caller).
export async function verifyAppCheck(token, { projectNumber, jwks, now = Date.now() }) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return { ok: false, why: "no App Check token" };
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (header.alg !== "RS256" || header.typ !== "JWT") return { ok: false, why: "wrong token type" };
    const jwk = (jwks && jwks.keys || []).find(k => k.kid === header.kid);
    if (!jwk) return { ok: false, why: "unknown signing key" };
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!good) return { ok: false, why: "bad signature" };
    if (payload.iss !== `https://firebaseappcheck.googleapis.com/${projectNumber}`) return { ok: false, why: "wrong issuer" };
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(`projects/${projectNumber}`)) return { ok: false, why: "wrong audience" };
    if (!payload.exp || payload.exp * 1000 < now) return { ok: false, why: "token expired" };
    return { ok: true, appId: payload.sub };
  } catch (e) {
    return { ok: false, why: "unreadable token" };
  }
}

// ── Model Armor's answer → our verdict (pure). Response shape: Model Armor docs, sanitizeUserPrompt.
export function readArmor(j) {
  const r = (j && j.sanitizationResult) || {};
  const f = r.filterResults || {};
  const m = x => x && x.matchState === "MATCH_FOUND";
  const filters = {
    pi_and_jailbreak: m(f.pi_and_jailbreak && f.pi_and_jailbreak.piAndJailbreakFilterResult),
    malicious_uris: m(f.malicious_uris && f.malicious_uris.maliciousUriFilterResult),
    rai: m(f.rai && f.rai.raiFilterResult),
    sdp: m(f.sdp && f.sdp.sdpFilterResult && f.sdp.sdpFilterResult.inspectResult),
    csam: m(f.csam && f.csam.csamFilterFilterResult),
  };
  const block = filters.pi_and_jailbreak || filters.malicious_uris;
  return { verdict: block ? "block" : "allow", category: block ? "injection" : null, filters, match: r.filterMatchState || null };
}

// ── Google access token for the service account (JWT bearer grant), cached per isolate.
let _tok = null;
async function googleToken(sa, now = Date.now()) {
  if (_tok && _tok.exp - 120000 > now) return _tok.value;
  const pem = String(sa.private_key || "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const unsigned = jsonB64url({ alg: "RS256", typ: "JWT" }) + "." + jsonB64url({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + unsigned + "." + bytesToB64url(sig) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google token refused: " + (j.error_description || j.error || r.status));
  _tok = { value: j.access_token, exp: now + (j.expires_in || 3600) * 1000 };
  return _tok.value;
}

let _jwks = null;
async function appCheckKeys(now = Date.now()) {
  if (_jwks && _jwks.exp > now) return _jwks.value;
  const r = await fetch(JWKS_URL);
  const v = await r.json();
  _jwks = { value: v, exp: now + 6 * 3600 * 1000 };   // Firebase rotates these keys; 6 h is their documented cache
  return v;
}

function corsFor(request, env) {
  const origins = env && env.SCREEN_ORIGINS ? String(env.SCREEN_ORIGINS).split(",").map(s => s.trim()) : DEFAULT_ORIGINS;
  const o = request.headers.get("Origin") || "";
  return origins.includes(o) ? { "Access-Control-Allow-Origin": o, "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Firebase-AppCheck" } : {};
}
const reply = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

export function onScreenOptions(request, env) { return new Response(null, { status: 204, headers: corsFor(request, env) }); }

export async function onScreen(request, env) {
  const cors = corsFor(request, env);
  const started = Date.now();
  try {
    if (!env || !env.MODEL_ARMOR_SA || !env.MODEL_ARMOR_TEMPLATE)
      return reply({ error: "Model Armor is not configured on this Worker (MODEL_ARMOR_SA / MODEL_ARMOR_TEMPLATE)" }, 503, cors);
    const projectNumber = String(env.APPCHECK_PROJECT_NUMBER || DEFAULT_PROJECT_NUMBER);
    const ac = await verifyAppCheck(request.headers.get("X-Firebase-AppCheck"), { projectNumber, jwks: await appCheckKeys() });
    if (!ac.ok) return reply({ error: "App Check: " + ac.why }, 401, cors);
    const { text } = await request.json();
    const t = String(text || "").slice(0, MAX_TEXT);
    if (!t.trim()) return reply({ error: "empty text" }, 400, cors);
    const template = String(env.MODEL_ARMOR_TEMPLATE);
    const loc = (/\/locations\/([^/]+)\//.exec(template) || [])[1];
    if (!loc) return reply({ error: "MODEL_ARMOR_TEMPLATE must look like projects/P/locations/L/templates/T" }, 503, cors);
    const token = await googleToken(JSON.parse(env.MODEL_ARMOR_SA));
    const r = await fetch(`https://modelarmor.${loc}.rep.googleapis.com/v1/${template}:sanitizeUserPrompt`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ userPromptData: { text: t } }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      console.log(`[ARMOR] Model Armor ${r.status}: ${JSON.stringify(j && j.error || {}).slice(0, 300)}`);
      return reply({ error: `Model Armor ${r.status}` }, 502, cors);
    }
    const out = readArmor(j);
    console.log(JSON.stringify({ tag: "cloudflare:model_armor", verdict: out.verdict, filters: out.filters, latency_ms: Date.now() - started }));
    return reply(out, 200, cors);
  } catch (e) {
    console.log("[ARMOR] screen failed — " + String(e).slice(0, 200));
    return reply({ error: String(e).slice(0, 200) }, 500, cors);
  }
}
