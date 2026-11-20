// SMT World — built on the Stitch "Market Ocean" design, made REAL.
// The visuals (fbm water shader, three.js lighthouse, glass islands, orbit forces)
// are from the Stitch export; everything is now data-driven from decisions.json
// (the daemon's live output) with an embedded fallback, and the bot's line is the
// actual SMT "why" — not a random quote. Never throws into the UI.

// ── Persona → world element (taught once, in the Tutorial) ────────────────
// "personas" is SMT's canonical jargon for the 6 signals; the ocean/lighthouse
// art is just the visual metaphor on top — the words the user reads stay "persona"
// and "Judge" (operator 2026-06-30).
// V6.1.93 (F-185(a)) — `whale` + `onchain` are ONE persona, `flows`: they read the
// same exchange-flow family, so two votes were one signal wearing two hats. And
// `catalyst` joined the committee back in V6.1.65 and was never wired in here.
// This tuple is the THIRD instance of the same defect (cf. S6/D35 and the V6.1.93
// `_PERSONA_ORDER` slip) — and the first one a USER could see: the world was
// drawing two retired personas and hiding the one carrying 0.20 of the vote.
// It must stay identical to `smt/personas/base.py::JUDGE_SEED_PRIORS`.
const PERSONAS = {
  flow:      {n:"Flow",      icon:"cyclone",      tx:0,    ty:-210},
  regime:    {n:"Regime",    icon:"storm",        tx:182,  ty:-105},
  flows:     {n:"Flows",     icon:"water_drop",   tx:182,  ty:105},
  sentiment: {n:"Sentiment", icon:"mood",         tx:0,    ty:210},
  catalyst:  {n:"Catalyst",  icon:"tsunami",      tx:-182, ty:105},
  technical: {n:"Technical", icon:"query_stats",  tx:-182, ty:-105},
};
const PERSONA_KEYS = ["flow","regime","flows","sentiment","catalyst","technical"];
// Each advisor's crew portrait (docs/SMT_WORLD_ARTIST_BRIEF.md § 5). The Tidecaller has
// a drawn "silent" pose; the others dim in code when they sit a coin out.
const CREW = {flow:"tidecaller", regime:"skywarden", flows:"twins", sentiment:"windvane",
              catalyst:"herald", technical:"cartographer"};
const crewFace = (k, vote) => (k === "flow" && vote === "neutral") ? "crew_tidecaller_silent_face" : `crew_${CREW[k]}_face`;
// Pre-merge records (and any daemon still on <V6.1.93) name `whale`/`onchain`.
// Fold them onto `flows` on read so a replayed old snapshot still renders six
// personas instead of two blanks — the same reason `explainer.DISPLAY` keeps
// both old names. Highest-confidence reading wins; it is one signal family.
const LEGACY_VOTE_KEYS = ["whale", "onchain"];
function normaliseVotes(votes){
  const v = Object.assign({}, votes || {});
  if(v.flows === undefined){
    const legacy = LEGACY_VOTE_KEYS.map(k=>v[k]).filter(Boolean)
                     .sort((a,b)=>(b[1]||0)-(a[1]||0));
    if(legacy.length) v.flows = legacy[0];
  }
  LEGACY_VOTE_KEYS.forEach(k=>{ delete v[k]; });
  return v;
}

// island positions (from the Stitch layout — orbital scatter around the lighthouse)
const POS = {
  BTC:{x:-220,y:-180}, ETH:{x:220,y:-150}, SOL:{x:-300,y:50}, BNB:{x:280,y:120},
  LTC:{x:-110,y:235}, XRP:{x:150,y:255}, ADA:{x:-380,y:-110}, DOGE:{x:360,y:-230},
};
const PAIRS = Object.keys(POS);
const cls = a => a==="LONG"?"long":a==="SHORT"?"short":a==="BLOCK"?"block":"wait";
const pct = c => Math.round((c||0)*100)+"%";

// ── 10-02: an island's look = what SMT is DOING on that coin ──────────────────
// Since the redesign (R1–R6) written setups open every trade and the committee only
// advises, so the island no longer wears the committee's lean, and SHORT is off
// everywhere, so no island means "selling". The weather is read HERE, in the browser,
// from Binance's free daily candles with the same rule the live trend setup uses
// (`playbook.trend_reading`: the last CLOSED daily bar's 28- and 56-day returns, both
// > 0 = up) — so the world stays true even when the bot's own feed is old.
const TREND_LOOKBACKS = [28, 56];                 // = smt/core/playbook.py TREND_LOOKBACK_D
const TREND_KLINES = s => `https://data-api.binance.vision/api/v3/klines?symbol=${s}USDT&interval=1d&limit=60`;
const TREND_24H = "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=";
// Binance refuses many US visitors (HTTP 451, even on public market data) — and
// 16VC's reviewers are in the US/UK. CoinGecko (free, CORS-open, works in the US)
// answers for any coin Binance did not: its daily series is one point per 00:00 UTC
// plus a live point, so dropping the last point leaves closed days, like Binance.
const CG_IDS = {BTC:"bitcoin", ETH:"ethereum", BNB:"binancecoin", SOL:"solana",
                XRP:"ripple", LTC:"litecoin", ADA:"cardano", DOGE:"dogecoin"};
const CG_CHART = id => `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=60&interval=daily`;
const CG_24H = "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids=";
const FALLING_FAST_PCT = -8;                      // display only: flag a fast 24h drop
const TREND_EVERY_MS = 15 * 60 * 1000;
const TREND_OLD_MS = 2 * 60 * 60 * 1000;          // older than two of the box's hourly reads: say so
let TREND = {}, TREND_AT = null, TREND_TRIED = false;   // TRIED: the first read has finished
const fmtPct = v => (v==null||isNaN(v)) ? "—" : (v>=0?"+":"−")+Math.abs(v).toFixed(1)+"%";
async function _getJSON(url, ms){
  const ctl = new AbortController(); const to = setTimeout(()=>ctl.abort(), ms || 6000);
  try{ const r = await fetch(url, {cache:"no-store", signal:ctl.signal}); return r.ok ? await r.json() : null; }
  catch(e){ return null; } finally{ clearTimeout(to); }
}
function _trendOf(closes, src){
  const need = Math.max(...TREND_LOOKBACKS) + 1;
  if(closes.length < need) return null;
  const last = closes[closes.length-1];
  const rets = TREND_LOOKBACKS.map(L => (last / closes[closes.length-1-L] - 1) * 100);
  return {up: rets.every(r => r > 0), r28: rets[0], r56: rets[1], ch24: null, src};
}
async function loadTrend(){
  // 10-02: the Worker's cached read first (one read per 15 min for every visitor);
  // the browser reads Binance / CoinGecko itself only when that route can't answer.
  const w = await _getJSON(FEED_BASE + "/api/trend", 12000);   // the Worker answers within ~9 s
  const fromWorker = (w && w.trend) ? w.trend : {};
  const out = {};
  PAIRS.forEach(p => { if(fromWorker[p] && fromWorker[p].up != null) out[p] = fromWorker[p]; });
  // any coin the Worker couldn't read, the browser reads itself
  await Promise.all(PAIRS.filter(p => !out[p]).map(async p => {
    const k = await _getJSON(TREND_KLINES(p));
    const closed = Array.isArray(k) ? k.slice(0, -1) : [];    // drop the day in progress
    let t = _trendOf(closed.map(r => parseFloat(r[4])).filter(v => v > 0), "Binance");
    if(!t){                                                     // e.g. a US visitor: Binance said 451
      const c = await _getJSON(CG_CHART(CG_IDS[p]));
      const pts = (c && Array.isArray(c.prices)) ? c.prices.slice(0, -1) : [];   // drop the live point
      t = _trendOf(pts.map(x => parseFloat(x[1])).filter(v => v > 0), "CoinGecko");
    }
    out[p] = t || {up:null};
  }));
  const needs24 = () => PAIRS.some(p => out[p] && out[p].up != null && out[p].ch24 == null);
  if(needs24()){                                  // the Worker's read carries ch24 already
    const t = await _getJSON(TREND_24H + encodeURIComponent(JSON.stringify(PAIRS.map(p=>p+"USDT"))));
    (Array.isArray(t)?t:[]).forEach(x => { const p = String(x.symbol||"").replace(/USDT$/,"");
      const v = parseFloat(x.priceChangePercent); if(out[p] && out[p].ch24 == null && !isNaN(v)) out[p].ch24 = v; });
  }
  if(needs24()){
    const g = await _getJSON(CG_24H + PAIRS.map(p => CG_IDS[p]).join(","));
    PAIRS.forEach(p => { const v = g && g[CG_IDS[p]] ? parseFloat(g[CG_IDS[p]].usd_24h_change) : NaN;
      if(out[p] && out[p].ch24 == null && !isNaN(v)) out[p].ch24 = v; });
  }
  // the tutorial's frozen-DOGE step is on screen: keep it frozen, restore the FRESH read
  if(_dogeReal){ _dogeReal.t = out.DOGE; out.DOGE = {up:null}; }
  TREND = out; TREND_TRIED = true;
  TREND_AT = Object.values(out).some(v => v.up != null) ? ((w && Date.parse(w.at)) || Date.now()) : null;
  renderIslands(); if(focused) focusIsland(focused, true);
}
// A0 (10-07): "founder" is what the WORKER verified this page load (the founder feed
// answered behind Cloudflare Access) — never a flag in this browser's storage, which
// anyone can set. The remembered role only means "try the founder feed".
let FOUNDER = {ok:false, tried:false, email:null, why:null};
const isFounder = () => !!FOUNDER.ok;
// One place decides the look; renderIslands, the coin panel and the tutorial read it.
function isleState(p){
  const live = liveOn(p)[0], paper = paperOn(p)[0], t = TREND[p];
  const fall = !!(t && t.ch24 != null && t.ch24 <= FALLING_FAST_PCT);
  const img = weatherArt(t, fall);
  if(live)  return {art:"long", k:"held", badge:liveWord().toUpperCase(), fall, img, ship:shipArt(live, "live"),
                    tip:`holding ${live.side} · ${liveWord()}`, verdict:`HOLDING ${live.side} · ${liveWord().toUpperCase()}`};
  if(paper) return {art:"long", k:"paper", badge:"PAPER", fall, img, ship:shipArt(paper, "paper"),
                    tip:"a paper trade · no real order", verdict:"PAPER TRADE · no real order"};
  if(!TREND_TRIED) return {art:"wait", k:"loading", badge:"", fall, img,      // never "failed" before it tried
                    tip:"reading the weather…", verdict:"READING · prices loading"};
  if(!t || t.up == null) return {art:"block", k:"nodata", badge:"", fall, img,
                    tip:"no price read right now", verdict:"NO READ · prices didn't load"};
  if(t.up)  return {art:"wait", k:"fair", badge:"", fall, img,
                    tip:"trend up · waiting for a setup", verdict:"WATCHING · trend up"};
  return          {art:"short", k:"storm", badge:"", fall, img,
                    tip:"trend down · staying out", verdict:"STAYING OUT · trend down"};
}
// 10-07 art: an island's picture is its WEATHER (the market), never the book —
// a held trade is the ship moored beside it. No read yet / no read = frost.
function weatherArt(t, fall){
  if(!TREND_TRIED || !t || t.up == null) return "frost";
  if(fall) return "storm";
  return t.up ? "sunny" : "overcast";
}
// Four hulls, one per setup family (docs/SMT_WORLD_ARTIST_BRIEF.md § 4); the setup's
// own name is written beside it. Gold sails = a real order · plain canvas = paper.
const HULLS = [["salvager", /crash|cascade|climax|flush|funding_extreme|capitulation/],
               ["cutter",   /fast_breakout|ftr_4h|volbreak/],
               ["pilot",    /range|statarb|fvg/]];
function hullOf(setup){
  const s = String(setup || "");
  for(const [h, re] of HULLS) if(re.test(s)) return h;
  return "tradewind";                      // trend family, and any setup not named above
}
const shipArt = (x, book) => `ship_${hullOf(x && x.setup)}_${book === "live" ? "gold" : "canvas"}`;
function weatherLine(p){
  const t = TREND[p];
  if(!TREND_TRIED) return "Reading prices…";
  if(!t || t.up == null) return "No price read right now — no call instead of a guess.";
  const old = TREND_AT && Date.now() - TREND_AT > TREND_OLD_MS ? `read ${ago(new Date(TREND_AT).toISOString())}` : "";
  // the box's read ("SMT box (Binance)") IS Binance — only a different source is news to a visitor
  const caveat = [t.src && !/Binance/.test(t.src) ? `via ${t.src}` : "", old].filter(Boolean).join(", ");
  const nums = isFounder() ? ` (28d ${fmtPct(t.r28)}, 56d ${fmtPct(t.r56)}, ${t.src||"public"} ${ago(new Date(TREND_AT||Date.now()).toISOString())})`
                           : caveat ? ` (${caveat})` : "";   // a visitor still hears a backup source or an old read
  const day = t.ch24 == null ? "" : ` · 24h ${fmtPct(t.ch24)}`;
  const held = liveOn(p)[0] || paperOn(p)[0];
  // only a TREND trade leaves on the trend turn; every other setup has its own exit (/code-review)
  const isTrend = held && (held.exit_rule === "trend_hold" || /^slow_t/.test(String(held.setup || "")));
  const what = held ? (!isTrend ? "Holding — it exits by its own rule."
                     : t.up ? "Holding — exits when the daily trend turns down."
                            : "Trend turned — exits at the next daily close.")
             : t.up ? "Waiting for my trend setup's trigger."
                    : "Staying out until it turns up.";
  const fall = (t.ch24 != null && t.ch24 <= FALLING_FAST_PCT) ? " Falling fast — my crash-buy setup watches this." : "";
  return `Trend ${t.up ? "up" : "down"}${day}${nums}. ${what}${fall}`;
}

// ── Embedded fallback (same shape as decisions.json) ──────────────────────
let DECISIONS = {
  BTC:{action:"LONG",conf:.74,drivers:["flow","technical"],votes:{flow:["LONG",.9,"Order book's stacking bids — buyers in control."],technical:["LONG",.8,"Reclaimed the 4H structure; clean higher-low."],flows:["LONG",.62,"Wallets quietly accumulating off-exchange, and exchange balances are falling with them."],sentiment:["SHORT",.55,"Bearish as always — but I only get a veto."],regime:["NEUTRAL",0,""],catalyst:["NEUTRAL",0,"Nothing on the calendar this window."]},why:"My committee leans LONG — Flow & Technical carried it (advisory; my written setups decide the trades)."},
  ETH:{action:"WAIT",conf:.29,drivers:["flow"],votes:{flow:["LONG",.5,"Mild bid, nothing convincing."],technical:["NEUTRAL",0,""],flows:["LONG",.4,"Slight Lido inflow uptick; no big wallets moving either way."],sentiment:["SHORT",.6,"Still doom, always doom."],regime:["NEUTRAL",0,""],catalyst:["NEUTRAL",0,"Nothing on the calendar this window."]},why:"My committee is sitting out — nothing lined up (advisory; my written setups decide the trades)."},
  BNB:{action:"SHORT",conf:.76,drivers:["flow","technical"],votes:{flow:["SHORT",.85,"Asks heavy — sellers leaning on it."],technical:["SHORT",.7,"Rejected the range high; wick city."],flows:["SHORT",.74,"Big wallet sent to a CEX deposit address — that is distribution."],sentiment:["LONG",.4,"BNB? I mostly stay quiet."],regime:["NEUTRAL",0,""],catalyst:["NEUTRAL",0,"Nothing on the calendar this window."]},why:"My committee leans SHORT — Flow & Technical carried it (advisory; my written setups decide the trades)."},
  SOL:{action:"LONG",conf:.7,drivers:["flow","technical"],votes:{flow:["LONG",.72,"Tape's lifting offers."],technical:["LONG",.88,"Textbook breakout retest."],flows:["LONG",.45,"DEX volume above the 30d 80th pct."],sentiment:["NEUTRAL",0,""],regime:["LONG",.55,"Trending up."],catalyst:["LONG",.5,"A network upgrade lands inside my holding window."]},why:"My committee leans LONG — Flow & Technical carried it (advisory; my written setups decide the trades)."},
  XRP:{action:"WAIT",conf:.32,drivers:["flow"],votes:{flow:["LONG",.5,"Slight bid."],technical:["NEUTRAL",0,""],flows:["NEUTRAL",0,""],sentiment:["NEUTRAL",0,"Regulatory pair — I abstain."],regime:["NEUTRAL",0,""],catalyst:["NEUTRAL",0,"Nothing on the calendar this window."]},why:"My committee is sitting out — nothing lined up (advisory; my written setups decide the trades)."},
  LTC:{action:"WAIT",conf:.2,drivers:["technical"],votes:{flow:["NEUTRAL",0,""],technical:["LONG",.45,"Minor coil."],flows:["NEUTRAL",0,""],sentiment:["NEUTRAL",0,""],regime:["NEUTRAL",0,""],catalyst:["NEUTRAL",0,"Nothing on the calendar this window."]},why:"My committee is sitting out — nothing lined up (advisory; my written setups decide the trades)."},
  ADA:{action:"WAIT",conf:.3,drivers:["flow","flows"],votes:{flow:["LONG",.48,"Light bid."],technical:["NEUTRAL",0,""],flows:["LONG",.4,"Small accumulation."],sentiment:["SHORT",.55,"Contra-pair: euphoria = top."],regime:["NEUTRAL",0,""],catalyst:["NEUTRAL",0,"Nothing on the calendar this window."]},why:"My committee is sitting out — nothing lined up (advisory; my written setups decide the trades)."},
  DOGE:{action:"BLOCK",conf:0,drivers:[],votes:{flow:["LONG",.55,"Thin meme bid trying to lift."],technical:["NEUTRAL",0,""],flows:["LONG",.4,"Small retail accumulation."],sentiment:["NEUTRAL",0,""],regime:["NEUTRAL",0,""],catalyst:["NEUTRAL",0,"Nothing on the calendar this window."]},why:"My committee won't back this one — a safety rule learned from past losses."},
};

// ── WHERE THE FEEDS COME FROM (V6.1.201, F-568) ─────────────────────────────
// The daemon uploads both feeds to a public bucket EVERY CYCLE (~2 min); this
// site's own copy is the hourly git push. The bucket's NAME is read from the
// hourly account.json (`feed_bucket` — the daemon's setting, one source; null =
// the per-cycle feed is OFF). Both copies are read and the NEWER one wins, so a
// stalled upload can never pin the page to an old book; a copy stamped in the
// future is refused (a bad or foreign file cannot win by lying about its time).
// FEED_SRC says which copy is showing and, if the hourly one, why.
const FEED_FUTURE_SKEW_MS = 5 * 60 * 1000;
let FEED_SRC = {}, FEED_BUCKET = null;
// 11-20 (buildathon): the Firebase Hosting build sets window.SMT_FEED_BASE to the Worker's
// origin, because Hosting on the free Spark plan cannot proxy to another site. The page
// reads the Worker's LIVE copy (the Worker sends CORS for these public feeds) and falls
// back to the snapshot bundled at deploy time, and says which one it shows (FEED_FROM;
// A FALLBACK MUST NEVER BE SILENT). On workers.dev the base is "" and nothing changes.
const FEED_BASE = (typeof window !== "undefined" && window.SMT_FEED_BASE) || "";
const FEED_FROM = {};
async function getJSON(url, ms){
  try{ const ctl = new AbortController(); const to = setTimeout(()=>ctl.abort(), ms);
    const r = await fetch(url, {cache:"no-store", signal:ctl.signal}); clearTimeout(to);
    return r.ok ? await r.json() : null;
  }catch(e){ return null; }
}
const bucketURL = b => /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(String(b||""))
  ? `https://storage.googleapis.com/${b}/` : null;
async function getFeedCopy(name, ms){
  if(!FEED_BASE){ FEED_FROM[name] = "same-origin"; return getJSON(name, ms); }
  const live = await getJSON(FEED_BASE + "/" + name, ms);
  if(live){ FEED_FROM[name] = "worker"; return live; }
  console.warn("[FEED] " + name + ": the Worker's live copy did not load, showing the snapshot bundled at deploy time");
  FEED_FROM[name] = "snapshot";
  return getJSON(name, ms);
}
async function loadFeed(name, stamp, ms, hourlyFirst){
  const hourly = hourlyFirst !== undefined ? hourlyFirst : await getFeedCopy(name, ms);
  if(name==="account.json" && hourly) FEED_BUCKET = bucketURL(hourly.feed_bucket);
  if(!FEED_BUCKET){ FEED_SRC[name] = hourly ? "hourly:off" : null; return hourly; }
  const live = await getJSON(FEED_BUCKET + name + "?t=" + Date.now(), ms);
  const ts = j => { const t = j ? Date.parse(stamp(j)) : NaN;
    return (isNaN(t) || t > Date.now() + FEED_FUTURE_SKEW_MS) ? -1 : t; };
  if(live && ts(live) >= 0 && ts(live) >= ts(hourly)){ FEED_SRC[name] = "cycle"; return live; }
  FEED_SRC[name] = hourly ? (!live ? "hourly:unreadable" : ts(live) < 0 ? "hourly:refused" : "hourly:older") : null;
  return hourly;
}
const decisionsStamp = j => Object.values(j||{}).map(d=>d&&d.as_of||"").sort().pop();
// The embedded rows above are SAMPLES; the page says so whenever it shows them
// (FEATURES #117: they used to render unlabelled when the feed failed).
let DECISIONS_ARE_SAMPLE = true;
async function loadDecisions(){
  const j = await loadFeed("decisions.json", decisionsStamp, 4000);
  if(j && typeof j==="object" && Object.keys(j).length){ DECISIONS = j; DECISIONS_ARE_SAMPLE = false; }
  /* else keep the fallback — offline / no daemon / slow fetch (aborts at 4s) */
}
// first-timer? (no completed onboarding on this device yet)
// blocked site data makes localStorage THROW (/code-review 10-07: a blank page) — treat as a first visit
const isFirstVisit = () => { try{ return !localStorage.getItem("smt_onboarded"); }catch(e){ return true; } };

// ── Enter the world ───────────────────────────────────────────────────────
async function enter(restoring){
  // 10-07 (operator): land straight in — everyone sees the world; the tour is one
  // tap, never a wall. Until onboarding finishes, every visit offers it again.
  const firstTime = isFirstVisit();
  document.getElementById("ocean").classList.remove("hidden");
  if(firstTime) document.getElementById("tourChip")?.classList.remove("hidden");
  document.querySelectorAll("[data-call-h]").forEach(e => { e.textContent = CALL_HORIZON_H; });   // one number, one place
  await loadAccount(); await loadDecisions();   // V6.1.200: islands show held trades (account first: it names the feed bucket)
  renderIslands();   // lighthouse is now the webp centerpiece (#lighthouseArt)
  const lf = document.getElementById("legFall"); if(lf) lf.textContent = Math.abs(FALLING_FAST_PCT);   // one number, one place
  loadLivePrices();
  loadTrend(); setInterval(loadTrend, TREND_EVERY_MS);   // 10-02: the islands' weather
  startIslandDrift(); // gentle orbit around each island's base spot (paused while focusing)
}

// ── Gentle orbital drift — the islands slowly circle their home spot, like the 3D world.
// Each island offsets from its base POS by a small per-island ellipse; paused while a pair
// is focused so focus-centering isn't disturbed. Pure CSS-var nudge — no layout churn.
let _driftStarted = false;
function startIslandDrift(){
  if(_driftStarted) return; _driftStarted = true;
  const islandsEl = document.getElementById("islands");
  function frame(t){
    if(islandsEl && !islandsEl.classList.contains("focusing")){
      PAIRS.forEach((p,i)=>{
        const node = document.getElementById("isle-"+p);
        // don't drift a focused/selected island — keep it pinned (e.g. under the
        // walkthrough spotlight, and steadier when its detail panel is open)
        if(!node || node.classList.contains("focused") || node.classList.contains("sel")) return;
        const ph = i * 0.8;                                  // per-island phase offset
        const ox = Math.cos(t/4200 + ph) * 13;               // px, slow horizontal sway
        const oy = Math.sin(t/3600 + ph) * 11;               // px, slower vertical bob
        node.style.setProperty("--ix", (POS[p].x + ox).toFixed(1) + "px");
        node.style.setProperty("--iy", (POS[p].y + oy).toFixed(1) + "px");
      });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ── Islands (appearance = verdict) ────────────────────────────────────────
// V6.1.200 (operator 09-29): LTC showed a plain "sitting out" island while a
// live LONG was open on it — the island drew the committee's vote on a NEW
// entry and ignored the book. A held live position now sets the island's look
// (gold glow + LIVE badge); the committee's view moves under it, labelled.
function renderIslands(){
  document.getElementById("islands").innerHTML = PAIRS.map((p,i)=>{
    const st = isleState(p);
    const badge = st.badge ? `<span class="isle-held${st.k==="paper"?" isle-paper":""}">${esc(st.badge)}</span>` : "";
    // 10-07: a fast 24h fall is the STORM picture now (weatherArt) — no separate flag
    return `<div class="island-node ${st.art}${st.k==="held"?" held":""}${st.k==="paper"?" paper":""}" id="isle-${p}" onclick="focusIsland('${p}')"
              style="--ix:${POS[p].x}px;--iy:${POS[p].y}px">
        <div class="isle-inner" style="animation-delay:${(i*0.4).toFixed(1)}s">
          ${badge}
          <img class="isle-art" src="assets/island_${st.img}.webp" alt="${p}" draggable="false"/>
          ${st.ship ? `<img class="isle-ship" src="assets/${st.ship}.webp" alt="" draggable="false"/>` : ""}
          <div class="isle-label">${p}</div>
          <div class="isle-tip tip-${st.art}">${p} · ${esc(st.tip)}</div>
        </div>
      </div>`;
  }).join("");
}

// ── Focus: open the right-side detail panel (island + 6 personas + why) ────
let focused = null;
// What I HOLD on this coin comes first; the committee is an advisor on a NEW entry.
function renderCoinPos(p){
  const held = liveOn(p), paper = paperOn(p);
  document.getElementById("dPos").innerHTML =
    (held.length ? `<div class="detail-sub">Open now · ${liveWord()}</div><ul class="acct-positions">${held.map(x=>posRow(x,"live")).join("")}</ul>` : "") +
    (paper.length ? `<div class="detail-sub">Open now · paper (no real order)</div><ul class="acct-positions">${paper.map(x=>posRow(x,"paper")).join("")}</ul>` : "") +
    (!ACCOUNT ? `<p class="muted small">The account feed could not be read, so held positions can't be shown.</p>` : "");
}
function focusIsland(p, refresh){
  if(!refresh && didPan){ didPan=false; return; }     // the click that ends a drag shouldn't open a panel
  const d = DECISIONS[p] || {action:"WAIT", conf:0, drivers:[], votes:{}, why:""};
  if(!refresh) saveSession({view:"coin", coin:p});
  hideSidePanels();                                                // the coin panel shares the right slot
  if(focused) document.getElementById("isle-"+focused)?.classList.remove("sel");
  focused = p;
  document.getElementById("isle-"+p)?.classList.add("sel");

  const held = liveOn(p), st = isleState(p);
  document.getElementById("dArt").src = "assets/island_"+st.img+".webp";
  document.getElementById("dPair").textContent = p;
  const dv = document.getElementById("dVerdict"); dv.className = "dverdict "+st.art;
  dv.textContent = st.verdict;
  const dw = document.getElementById("dWeather"); if(dw) dw.textContent = weatherLine(p);
  renderCoinPos(p);
  document.getElementById("dSub").textContent = "Advisors · graded, they don't trade";
  document.getElementById("dForces").innerHTML = PERSONA_KEYS.map(k=>{
    const f = PERSONAS[k]; const v = normaliseVotes(d.votes)[k] || ["NEUTRAL",0,""];
    const vc = v[0]==="LONG"?"long":v[0]==="SHORT"?"short":"neutral";
    // Drivers from a pre-merge record still name `whale`/`onchain`; fold them
    // onto `flows` too, or the persona that actually carried it loses its tag.
    const drv = (d.drivers||[]).map(x => LEGACY_VOTE_KEYS.includes(x) ? "flows" : x);
    const lead = drv.includes(k);
    // 10-02: the bot's own notes sometimes carry engineering references (F-numbers,
    // "learned cells"); a visitor sees a plain line instead, never the internals.
    const raw = String(v[2] || "");
    const plain = {long:"Leans up.", short:"Leans down.", neutral:"No call."}[vc];
    const note = !raw || /\bF-\d{2,}|learned cells|quorum|LEARNED SILENCE/i.test(raw) ? "" : raw;
    const say = isFounder() && note ? esc(note) : plain;
    return `<div class="dforce ${vc} ${lead?'lead':''}">
      <img class="ico crew" src="assets/${crewFace(k, vc)}.webp" alt="${f.n}" draggable="false"/>
      <div class="meta"><div class="row1"><span class="nm">${f.n}</span>
        ${lead?'<span class="lead-tag">carried it</span>':''}<span class="vt">${esc(v[0])}</span></div>
        <div class="say">${say}</div></div></div>`;
  }).join("");
  const lean = {LONG:"lean long", SHORT:"lean short"}[d.action] || "sit out";
  const one = `Advisors ${lean}${d.conf ? ` (${Math.round(d.conf*100)}%)` : ""}. ${held.length ? "The open trade exits by its own rule, not their vote." : "Written setups trade, not advisors."}`;
  document.getElementById("dWhy").textContent = (DECISIONS_ARE_SAMPLE ? "SAMPLE — the decision feed didn't load. " : "") +
    (isFounder() && d.why ? `${one} ${d.why}` : one);
  renderCoinHist();
  document.getElementById("detail").classList.remove("hidden");
}
function exitFocus(){
  closePos();
  if(focused) saveSession({view:"world"});
  if(focused){ document.getElementById("isle-"+focused)?.classList.remove("sel"); focused = null; }
  const det = document.getElementById("detail");
  det.classList.remove("walk-lit");   // drop any walkthrough panel-lift
  det.classList.add("hidden");
}

// ══════════════════════════════════════════════════════════════════════════
//  ONBOARDING — meet a zero-knowledge user at the door.
//  Gate (3 buttons) → Tutor chat (crash course) → World walkthrough.
//  The chat is GUIDED today (staged ELI5 + follow-up chips + keyword FAQ for
//  free text). The seam `answerFree()` is the single place to later swap in a
//  live LLM (Gemini proxy) without touching the rest.
// ══════════════════════════════════════════════════════════════════════════
function blurWorld(on){ document.getElementById("stage").classList.toggle("blurred", on);
  document.getElementById("sea").classList.toggle("blurred", on); }
// bottom-nav active tab (gold). "world" while exploring, "tutorial" while onboarding.
function setNav(view){
  document.getElementById("navAccount")?.classList.toggle("active", view==="account");
  document.getElementById("navWorld")?.classList.toggle("active", view==="world");
  document.getElementById("navTutorial")?.classList.toggle("active", view==="tutorial");
  document.getElementById("navChat")?.classList.toggle("active", view==="chat");
  document.getElementById("navCalls")?.classList.toggle("active", view==="calls");
}
// The account and Calls share the right-hand slot with the coin panel: opening any
// one, or leaving to the world / the tour / the chat, closes the others and their
// tabs (/code-review 10-07: each opener hid a different subset, so Calls stayed
// docked under the tour and the chat, and its tab stayed lit over a coin).
function hideSidePanels(){
  document.getElementById("account")?.classList.add("hidden");
  document.getElementById("calls")?.classList.add("hidden");
  ["navAccount","navCalls"].forEach(id => document.getElementById(id)?.classList.remove("active"));
}
function openGate(){ exitFocus(); hideSidePanels(); saveSession({view:"world"}); closeTutor(); document.getElementById("walk").classList.add("hidden");
  document.getElementById("tourChip")?.classList.add("hidden");   // hidden while touring; NOT remembered — only finishing or tapping the chip is
  blurWorld(true); document.getElementById("gate").classList.remove("hidden"); setNav("tutorial"); }
function closeGate(){ document.getElementById("gate").classList.add("hidden"); }
function dismissTour(){ document.getElementById("tourChip")?.classList.add("hidden");
  try{ localStorage.setItem("smt_onboarded","1"); }catch(e){} }
function takeTour(){ dismissTour(); openGate(); }
// leave any onboarding overlay and return to the live world (World tab goes gold)
function backToWorld(){ restoreDoge(); closeGate(); closeTutor(); document.getElementById("walk").classList.add("hidden");
  hideSidePanels();
  blurWorld(false); exitFocus(); saveSession({view:"world"}); setNav("world"); }
function goWorld(){ backToWorld(); }   // bottom-nav "World" tab

// ── Crash-course content (SMT voice, ELI5) ────────────────────────────────
const TUTOR = {
  crypto:{ title:"Crypto, from scratch", lessons:[
    {say:["Crypto is just <b>money that lives on the internet</b> — not in any bank. Instead of one company keeping the record of who owns what, thousands of computers around the world keep it <b>together</b>, so no one can quietly change it."],
     chips:[["Why does it have value?","value"],["Who controls it?","control"],["Is it real money?","real"]]},
    {say:["Each crypto is a <b>coin</b> or <b>token</b> — like BTC (Bitcoin) or ETH (Ethereum). Think of them as different currencies, each with its own community and use."],
     chips:[["Why are there so many?","many"],["Coin vs token?","token"]]},
    {say:["Prices <b>move</b> when more people want to buy than sell (up) — or the reverse (down). News, big buyers, and overall mood shove them around, fast."],
     chips:[["What's a whale?","whale"],["Why so volatile?","volatile"]]},
    {say:["And it's not just individuals — <b>big institutions</b>, funds and companies trade too. They move serious money, so watching what they do matters. That's most of the picture."],
     chips:[["What's an institution?","institution"]]},
  ], bridgeSay:"That's crypto in a nutshell 🎉 Want me to show you how <b>trading</b> it works next — buying, selling, and reading the moves? Or jump straight into my world?",
     bridge:[["Teach me trading →","go:trading","act"],["I'm ready — dive in ⛵","go:walk","act"]] },

  trading:{ title:"Trading, from scratch", lessons:[
    {say:["Trading is making money from a price <b>moving</b>. I trade crypto <b>futures</b> — contracts that track a coin's price — so I never actually buy the coins. Futures can bet on a fall too, but right now I only go long: every short rule I tested lost money."],
     chips:[["Profit when it falls?","short"],["Isn't this gambling?","gambling"]]},
    {say:["Going <b>long</b> = betting the price rises. Going <b>short</b> = betting it falls. Futures allow both; I only go long, on the 8 pairs I watch, until a short rule proves itself on years of prices."],
     chips:[["I already know stocks — same thing?","stock"]]},
    {say:["<b>Leverage</b> lets you trade with more than you put in — like sailing a bigger boat. 10× turns $100 into a $1,000 position: bigger wins, but it sinks faster if you're wrong. The cash you put down is your <b>margin</b>."],
     chips:[["What if I'm wrong?","liquidation"],["What's a pool?","pool"]]},
  ], bridgeSay:"Now you've got the basics 🙌 Ready to see how I read all of this — live — for eight coins at once?",
     bridge:[["Yes — dive in ⛵","go:walk","act"],["Wait, crypto basics first","go:crypto","act"]] },
};

// keyword FAQ for free-text questions (the one place to later swap for a live LLM)
const FAQ = [
  {k:["value","worth","backed","why valuable"], a:"Good one. Value comes from <b>scarcity + usefulness + trust</b> — same as gold or a currency. If lots of people want it and there's a limited supply (only 21M Bitcoin will ever exist), it holds value. No promise from a bank behind it."},
  {k:["control","who runs","government","owns it"], a:"<b>No single owner.</b> The network is run by thousands of independent computers agreeing on the record. That's the whole point — nobody can secretly print more or freeze your funds."},
  {k:["real","scam","fake"], a:"It's as real as the people and money using it — billions trade daily, and big institutions hold it. It's volatile and there are scams to avoid, but the technology itself is real and here to stay."},
  {k:["many","so many","thousands of coins"], a:"Most are experiments; a handful actually matter. I only watch 8 serious ones (BTC, ETH, BNB, SOL, LTC, XRP, ADA, DOGE) — the liquid, established names."},
  {k:["token","coin difference"], a:"Loosely: a <b>coin</b> has its own blockchain (Bitcoin, Ethereum); a <b>token</b> lives on top of someone else's chain. For trading, the distinction rarely matters — both just move in price."},
  {k:["whale"], a:"A <b>whale</b> is someone holding a huge amount — enough that when they buy or sell, the price visibly moves. I literally watch their wallets — that, plus what moves on-chain, is my Flows persona. 🐋"},
  {k:["volatile","swings","risky","up and down"], a:"Crypto is young and trades 24/7 with no 'closing bell,' so it swings hard. That's risk — and also the opportunity I'm built to read."},
  {k:["institution","funds","companies"], a:"Banks, hedge funds and public companies now trade and hold crypto. They move size, so their flows leave footprints — which my Flows persona is built to catch."},
  {k:["short","fall","sell first","don't own"], a:"With futures, <b>shorting</b> just means opening a contract that <i>gains</i> when the price drops — no borrowing or owning coins needed. I don't short right now: every short rule I tested on six years of prices lost money, because crypto falls tend to bounce. In a downtrend I simply stay out."},
  {k:["gambl","luck","casino"], a:"Fair question — and honestly, trading <b>without</b> a process IS gambling. The difference is a record: I only trade when a written rule fires, and each rule had to make money after fees on years of past prices. No rule firing → I wait."},
  {k:["stock","stocks","shares","equit"], a:"Smart question — not a silly one. The <b>idea</b> is the same (buy low, sell high), but crypto trades <b>24/7</b> with no earnings reports, is far more volatile, lets you short with leverage easily, and its value comes from usage + scarcity + sentiment rather than company profits. So the reflexes differ even if the instinct carries over."},
  {k:["leverage"], a:"Leverage = trading with borrowed size. 10× turns $100 into $1,000 of position. Multiplies wins AND losses — powerful, and the fastest way to get hurt if you over-do it."},
  {k:["margin"], a:"Margin is the cash you put down as collateral to open a leveraged trade. If the trade moves against you too far and your margin can't cover it, it gets <b>liquidated</b> (force-closed)."},
  {k:["liquidat","wrong","lose"], a:"If a leveraged trade moves against you past your margin, it's <b>liquidated</b> — auto-closed at a loss so you can't owe more. Higher leverage = liquidation hits sooner. It's why I size carefully."},
  {k:["pool","liquidity"], a:"A <b>liquidity pool</b> is a shared pot of coins that lets trades happen instantly without a matching buyer/seller. You don't need to manage one to follow me — just good to know the word."},
];

// ── Live Gemini chat (set CHAT_ENDPOINT once the function is deployed) ─────
// Cloudflare Pages (same origin): "/api/chat". GCP Cloud Function: its full URL.
// Empty → the chat runs the offline scripted course below (used as fallback too).
// 10-02: the Cloud Run chat died with the GCP billing account; the same-origin
// Cloudflare Worker route answers now (worker/index.js → functions/api/chat.js,
// a free AI Studio key in the Worker secret GEMINI_API_KEY).
const CHAT_ENDPOINT = "/api/chat";
const useGemini = () => !!CHAT_ENDPOINT;
let chatHist = [];                 // [{role:"user"|"model", content}] for Gemini
function mdToHtml(s){ return String(s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")        // **bold**
  .replace(/\*(.+?)\*/g,"<i>$1</i>")            // *italic*
  .replace(/^\s*[*-]\s+/gm,"• ")                // stray list markers → bullet
  .replace(/\*/g,"")                            // drop any lone/truncated asterisk
  .replace(/\n/g,"<br>"); }
// V6.1.200 (operator 09-29): asked how the LTC trade was chosen, the chat said
// the personas decided and then called the reason "proprietary" — it had no
// facts, so it made some up. It now gets what this page already shows: each
// open position's setup, trigger and the setup's own reason, recent closes,
// and each coin's committee view (labelled advisory).
function liveFacts(){
  const A = ACCOUNT, L = [], paperLines = [];
  if(!A || !A.live){ L.push("The account feed could not be read — I cannot see my positions right now."); }
  else {
    L.push(`Feed written ${A.generated_at} (${A.version}). Account: WEEX-granted SIMULATED funds (sandbox, not money); equity ${A.live.equity_usd} ${A.live.equity_asset||""}. ` +
      (A.daemon_shadow ? "The whole bot runs in SHADOW mode: no real orders. " : "") +
      `Lanes: ${Object.entries(A.lane_modes||{}).map(([l,m])=>l+"="+m).join(", ")}.`);
    const pos = (x, book) => `OPEN ${book.toUpperCase()} ${x.pair} ${x.side} (lane ${x.lane}) since ${x.opened_at}: entry ${x.entry}, now ${x.mark} (${x.upnl_pct}%), ${"stop" in x ? `stop ${x.stop}, ` : ""}${x.leverage||"?"}x. ` +
      `SETUP ${x.setup||"none (a lane plan from before the written setups)"}: ${x.setup_plain||x.setup_kind||""} ` +
      (isFounder() ? `TRIGGER: ${x.trigger_plain||x.trigger||"—"}. WHY (the setup's own words): ${x.why||"not stored — opened before this was recorded"}. `
                   : `(public view: the rule's numbers, trigger and own words are in the founder section — say so if asked). `) +
      `EXIT: ${x.exit_plain||x.exit_kind||"—"}. ` +
      `RECORD (history, net of fees): ${x.record||"none — a lane plan"}` +
      (x.shadow_of ? ` (a paper COPY of the live ${x.shadow_of} trade)` : "");
    (A.live.open||[]).forEach(x=>L.push(pos(x,"live")));
    if(!(A.live.open||[]).length) L.push("No live position open.");
    ((A.paper||{}).open||[]).forEach(x=>paperLines.push(pos(x,"paper")));
    (A.live.recent_closes||[]).slice(0,5).forEach(x=>L.push(
      `CLOSED LIVE ${x.pair} ${x.side} at ${x.closed_at}: net $${x.net_usd==null?"?":x.net_usd.toFixed(2)}, ${x.reason_plain||""} (${x.reason||""}); setup ${x.setup||"none"}.`));
  }
  L.push("COMMITTEE (six personas — graded ADVISORS, they do not open or close trades):");
  PAIRS.forEach(p=>{ const d = DECISIONS[p]; if(d) L.push(`${p}: ${d.action} ${pct(d.conf)} — ${d.why||""}`); });
  // Paper positions LAST: the server cuts at its limit (and says so), so the
  // least important lines are the ones a cut drops (/code-review).
  paperLines.forEach(x=>L.push(x));
  return L.join("\n");
}
async function askSMT(){
  // 11-20: on Firebase Hosting there is no /api/chat; smt_world/firebase/src/ask.js installs
  // window.SMT_CHAT (Firebase AI Logic, the same prompt text: functions/api/chat_prompt.js)
  if(window.SMT_CHAT){
    if(tutorTrack==="ask" && !ACCOUNT) await loadAccount();
    return window.SMT_CHAT({track:tutorTrack, messages:chatHist, context: tutorTrack==="ask" ? liveFacts() : ""});
  }
  try{
    if(tutorTrack==="ask" && !ACCOUNT) await loadAccount();
    const r = await fetch(CHAT_ENDPOINT, {method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({track:tutorTrack, messages:chatHist,
                           context: tutorTrack==="ask" ? liveFacts() : ""})});
    const j = await r.json(); return j && j.reply ? j.reply : null;
  }catch(e){ return null; }
}
// one entry point for chip taps, free text and "next" — routes to Gemini or script
async function askGuide(userText, opts){
  opts = opts||{};
  // 11-20: the Firebase build's Ask SMT answers with checked reasons + guardrails (ask.js)
  if(tutorTrack==="ask" && window.SMT_ASK_TURN) return window.SMT_ASK_TURN(userText, opts);
  if(userText && !opts.silent){ bubble("user", userText); }
  if(userText){ chatHist.push({role:"user", content:userText}); }
  if(useGemini()){
    const t = typingBubble();
    const reply = await askSMT();
    t.remove();
    const text = reply || "Hmm, my line to shore dropped for a second — ask me again? (Meanwhile: it's a simulated, risk-free world to learn in.)";
    if(reply) chatHist.push({role:"model", content:reply});
    bubble("smt", mdToHtml(text));
    geminiChips();
  } else {
    if(userText) bubble("smt", answerFree(userText));   // offline FAQ
  }
}
function typingBubble(){ const b=document.createElement("div"); b.className="bub smt"; b.textContent="…";
  const log=document.getElementById("chatlog"); log.appendChild(b); log.scrollTop=log.scrollHeight; return b; }
// Chips under a Gemini reply. Track-aware so the crypto course still offers the
// trading step (and vice-versa) instead of only ever jumping to the world walk.
function geminiChips(){
  if(tutorTrack==="ask"){ setChips(ASK_CHIPS); return; }
  const cross = tutorTrack==="crypto"
    ? ["Teach me trading →","go:trading","act"]      // crypto → trading (next step)
    : ["Wait, crypto basics first","go:crypto","act"];
  setChips([["Give me an example","ex"], cross, ["I'm ready — dive in ⛵","go:walk","act"]]);
}

let tutorTrack=null, lessonIdx=0;
function startTutor(track){
  closeGate(); tutorTrack=track; lessonIdx=-1; chatHist=[];
  document.getElementById("tutorTitle").textContent = TUTOR[track].title;
  document.getElementById("chatlog").innerHTML = "";
  document.getElementById("gotIt").style.display = "";
  document.getElementById("tutor").classList.remove("hidden");
  if(useGemini()){
    bubble("smt", track==="crypto" ? "Perfect — we'll start at zero, no jargon. Ask me anything. 🌊"
                                   : "Great — let's demystify trading. Curiosity is welcome.");
    askGuide(track==="crypto" ? "I'm brand new to crypto. Start me from the very beginning."
                              : "I'm new to trading. Start me from the very beginning.", {silent:true});
  } else {
    bubble("smt", track==="crypto"
      ? "Perfect — we'll start at zero, no jargon. Ask me anything as we go. 🌊"
      : "Great — let's demystify trading. Curiosity is welcome; interrupt me any time.");
    nextLesson();
  }
}
// ── "Ask SMT" (bottom-nav tab): the chat with NO course attached ──────────
// The chat used to be reachable only through Tutorial → "I'm new to …", so a
// visitor who picked "I know both", or entered as founder, never saw it
// (operator, 09-24: "theres no chat option at all!"). This opens the same
// chatbot in free-question mode: no lesson, no "I've got it" step, and no
// opening call to Gemini until the visitor actually asks something.
// V6.1.200: the chat is sent the page's live facts (liveFacts), so "what are
// you holding, and why?" is answered from the record, not guessed.
const ASK_CHIPS = [["What are you holding, and why?","holding"],
                   ["How do you decide a trade?","decide"],
                   ["What do the islands mean?","islands"],
                   ["What are your lanes?","lanes"],
                   ["Live vs paper — what's the difference?","paper"]];
function openChat(){
  exitFocus(); closeGate(); closeAccount(); hideSidePanels(); document.getElementById("walk").classList.add("hidden");
  blurWorld(true); tutorTrack="ask"; lessonIdx=-1; chatHist=[];
  document.getElementById("tutorTitle").textContent = "Ask SMT";
  document.getElementById("chatlog").innerHTML = "";
  document.getElementById("gotIt").style.display = "none";
  document.getElementById("tutor").classList.remove("hidden");
  bubble("smt", "Ask me anything — what I'm doing, why, or how any of it works. 🗼");
  setChips(ASK_CHIPS); setNav("chat");
}
function closeTutor(){ document.getElementById("tutor").classList.add("hidden"); }
function bubble(who, html){
  const b=document.createElement("div"); b.className="bub "+who; b.innerHTML=html;
  const log=document.getElementById("chatlog"); log.appendChild(b); log.scrollTop=log.scrollHeight;
}
function setChips(list){
  document.getElementById("chips").innerHTML = (list||[]).map((c,i)=>
    `<button class="chip2 ${c[2]||''}" onclick="chipTap(${i})">${c[0]}</button>`).join("");
  window._chips = list||[];
}
// F-530: facts the page already knows are answered HERE, word for word —
// Gemini shortened the islands legend and dropped "frozen" (operator, 09-24).
const ASK_FIXED = {
  // 10-07 art: an island's picture is its WEATHER (the market); a trade I hold is a SHIP beside it
  islands: "Each island is one coin I watch (BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LTC), and its weather " +
           "is that coin's market. <b>Sunny</b> = the trend is up · <b>Overcast</b> = the trend is down, " +
           "so I stay out (I don't short) · <b>Storm</b> = it fell " + Math.abs(FALLING_FAST_PCT) + "%+ in " +
           "the last 24h · <b>Frost</b> = I couldn't read that coin's prices just now. A <b>ship</b> moored " +
           "beside an island is a trade I hold: <b>gold sails</b> = a live order, <b>white sails</b> = paper. " +
           "Tap any island to see the trade, the rule behind it, its history, and my six personas' " +
           "votes (advisors I grade — they don't open trades; my written setups do)."
};
function chipTap(i){
  const c = window._chips[i]; if(!c) return;
  if(tutorTrack==="ask" && ASK_FIXED[c[1]]){
    bubble("user", c[0]); bubble("smt", ASK_FIXED[c[1]]);
    chatHist.push({role:"user", content:c[0]});
    chatHist.push({role:"model", content:ASK_FIXED[c[1]].replace(/<[^>]+>/g,"")});
    return;
  }
  if(c[1] && c[1].startsWith("go:")){ const dest=c[1].slice(3);
    bubble("user", c[0]);
    if(dest==="walk"){ closeTutor(); startWalk(); } else { startTutor(dest); } return; }
  if(useGemini()){ askGuide(c[0]); return; }
  bubble("user", c[0]);
  bubble("smt", answerFree(c[1]));
}
function nextLesson(){
  if(useGemini()){ askGuide("Got it — what's the next small step?"); return; }
  const t = TUTOR[tutorTrack]; lessonIdx++;
  if(lessonIdx < t.lessons.length){
    const l = t.lessons[lessonIdx];
    l.say.forEach(s=>bubble("smt", s));
    setChips(l.chips);
    document.getElementById("gotIt").textContent = lessonIdx===t.lessons.length-1 ? "Makes sense →" : "I've got it →";
  } else {
    bubble("smt", t.bridgeSay); setChips(t.bridge);
    document.getElementById("gotIt").style.display="none";
  }
}
// free-text answer — TODAY: keyword FAQ. LATER: replace body with a Gemini call.
function answerFree(keyOrText){
  const q = String(keyOrText).toLowerCase();
  for(const f of FAQ){ if(f.k.some(kw=>q.includes(kw))) return f.a; }
  return "Love the curiosity — that one's a bit deeper than my starter notes go. The honest best answer: watch me actually trade it in a minute and it'll click. (Soon I'll answer anything here directly.) Anything else for now?";
}
function sendUser(){
  const inp=document.getElementById("tutorInput"); const t=(inp.value||"").trim(); if(!t) return;
  inp.value="";
  if(useGemini()){ askGuide(t); return; }
  bubble("user", t); bubble("smt", answerFree(t));
}

// ── World walkthrough (guided coachmarks over the REAL elements) ──────────
const WALK = [
  {text:"Welcome to my world. This whole ocean is the <b>live crypto market</b> — always moving."},
  {sel:"#lighthouseArt", center:true, r:110, text:"That lighthouse is my <b>rulebook</b>: written setups, rules tested on years of prices. Only they open trades. My six personas advise, and I grade them."},
  {sel:"#isle-BTC", text:"Each island is a <b>coin</b>, and its weather is that coin's market: <b style='color:#f2ca50'>sunny</b> = trend up, <b>overcast</b> = trend down (I stay out — I don't short), <b style='color:#ffb4ab'>storm</b> = it fell hard in a day. A <b>ship</b> beside it is a trade I hold: <b style='color:#f2ca50'>gold sails</b> = live, white = paper."},
  {sel:"#isle-DOGE", action:"lockDoge", text:"A <b>frosted</b> island means I couldn't read that coin's prices just now, so I show no call instead of a guess. ❄️"},
  {action:"focusBTC", sel:"#isle-BTC", text:"Tap an island — say <b>BTC</b> here — and the panel on the right shows any trade I hold there (tap it for the full story), the coin's trade history, and my <b>six personas</b>' votes — advisors, coloured by vote (green = bullish, red = bearish, faded = quiet). Drag the panel's left edge to widen it."},
  {action:"exitFocus", text:"That's the whole idea — every call, every reason, in the open. It's a <b>simulated, risk-free</b> account. Go read the water. ⛵"},
];
// Tutorial: force DOGE to render as the frozen/locked island while teaching that step,
// then snap it back to the bot's real live call when the walkthrough ends/exits.
let _dogeReal = null;
function lockDogeForTutorial(){            // 10-02: teaches the FROZEN (no-read) island
  if(_dogeReal) return;
  if(liveOn("DOGE").length || paperOn("DOGE").length) return;   // a held island can't look frozen (/code-review)
  _dogeReal = {t: TREND.DOGE};
  TREND.DOGE = {up:null};
  renderIslands();
}
function restoreDoge(){ if(_dogeReal){ TREND.DOGE = _dogeReal.t; _dogeReal = null; renderIslands(); } }
let walkIdx=-1;
function startWalk(){ closeGate(); closeTutor(); blurWorld(false);
  document.getElementById("walk").classList.remove("hidden"); walkIdx=-1; walkNext(); }
function walkNext(){
  walkIdx++;
  if(walkIdx>=WALK.length){ endWalk(); return; }
  const step = WALK[walkIdx];
  if(step.action==="focusBTC"){ didPan=false; focusIsland("BTC");
    // raise the detail panel above the walkthrough dim so it reads as "focused"
    // (otherwise the spotlight overlay greys it out — issue: "side panel not focused")
    document.getElementById("detail")?.classList.add("walk-lit"); }
  if(step.action==="exitFocus") exitFocus();
  if(step.action==="lockDoge") lockDogeForTutorial();
  document.getElementById("coachText").innerHTML = step.text;
  document.getElementById("coachDots").innerHTML = WALK.map((_,i)=>`<i class="${i===walkIdx?'on':''}"></i>`).join("");
  document.getElementById("walkNextBtn").textContent = walkIdx===WALK.length-1 ? "Explore ⛵" : "Next →";   // by id: "Skip tour" is the first button now
  positionCoach(step);
  // opening/closing the panel docks/undocks it and the world slides: re-aim after
  if(step.action==="focusBTC" || step.action==="exitFocus") setTimeout(()=>positionCoach(step), 420);
}
function positionCoach(step){
  const spot=document.getElementById("spot"), coach=document.getElementById("coach");
  let cx=innerWidth/2, cy=innerHeight/2, r=step.r||0, rect=null;
  if(step.sel){ const el=document.querySelector(step.sel); if(el){ rect=el.getBoundingClientRect();
    cx=rect.left+rect.width/2; cy=rect.top+rect.height/2; r=step.center?(step.r||90):Math.max(rect.width,rect.height)/2+14; } }
  if((step.sel||step.center) && r){ spot.style.opacity="1"; spot.style.width=spot.style.height=(r*2)+"px";
    spot.style.left=(cx-r)+"px"; spot.style.top=(cy-r)+"px"; }
  else { spot.style.opacity="0"; }
  // place the coach card clear of the spotlight (below if room, else above; clamp on screen)
  const cw=300, ch=150, below=cy+r+16;
  let top = (below+ch<innerHeight) ? below : Math.max(16, cy-r-ch-16);
  if(!step.sel && !step.center) top = innerHeight/2 - ch/2;
  let left = Math.min(Math.max(16, cx-cw/2), innerWidth-cw-16);
  coach.style.top=top+"px"; coach.style.left=left+"px";
}
function endWalk(){ restoreDoge(); document.getElementById("walk").classList.add("hidden"); blurWorld(false); exitFocus();
  setNav("world"); dismissTour(); }
addEventListener("resize", ()=>{ if(!document.getElementById("walk").classList.contains("hidden") && walkIdx>=0) positionCoach(WALK[walkIdx]); });

document.getElementById("tutorInput")?.addEventListener("keydown", e=>{ if(e.key==="Enter") sendUser(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ backToWorld(); } });

// ── Movable map: drag-to-pan + gentle parallax + responsive scale ─────────
let panX=0, panY=0, parX=0, parY=0;            // pan = drag offset · par = mouse parallax
let dragging=false, didPan=false, dragSX=0, dragSY=0, panSX=0, panSY=0;
const isTouch = matchMedia("(pointer:coarse)").matches;
// V6.1.200: the STAGE's width, not the window's — a docked panel narrows it.
const stageW = () => document.getElementById("stage")?.clientWidth || innerWidth;
function mapScale(){ return Math.max(.5, Math.min(1, stageW()/1080)); }    // shrink archipelago on small screens
function clampPan(){ const lim = innerWidth<700 ? 240 : 460;                // keep the map from flying off-screen
  panX=Math.max(-lim,Math.min(lim,panX)); panY=Math.max(-lim,Math.min(lim,panY)); }
function applyMap(){ const el=document.getElementById("islands");
  if(el) el.style.transform=`translate(${panX+parX}px,${panY+parY}px) scale(${mapScale()})`; }

function onDown(e){ if(focused) return; dragging=true; didPan=false;
  dragSX=e.clientX; dragSY=e.clientY; panSX=panX; panSY=panY; }
function onMove(e){
  if(dragging){ const dx=e.clientX-dragSX, dy=e.clientY-dragSY;
    if(Math.abs(dx)+Math.abs(dy)>6) didPan=true;                           // distinguish a pan from a tap
    panX=panSX+dx; panY=panSY+dy; clampPan(); applyMap(); return; }
  if(!isTouch && !focused){ parX=(e.clientX-innerWidth/2)/60; parY=(e.clientY-innerHeight/2)/60; applyMap(); }
}
(function initMap(){
  const stage=document.getElementById("stage"); if(!stage) return;
  stage.style.touchAction="none"; stage.style.cursor="grab";
  stage.addEventListener("pointerdown", e=>{ onDown(e); if(!focused) stage.style.cursor="grabbing"; });
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", ()=>{ dragging=false; stage.style.cursor="grab"; });
  addEventListener("resize", applyMap); applyMap();
  if(innerWidth<640) document.getElementById("legend")?.classList.add("collapsed");  // declutter on phones
})();

// ── three.js lighthouse (from the Stitch export) ──────────────────────────
function initLighthouse(){
  const container = document.getElementById("lighthouse3d");
  if(!container || typeof THREE==="undefined" || container.dataset.init) return;
  container.dataset.init = "1";
  const w = innerWidth, h = innerHeight;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true});
  renderer.setSize(w, h); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  container.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff,0.6));
  const dir = new THREE.DirectionalLight(0xffffff,0.8); dir.position.set(5,10,5); scene.add(dir);
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.7,2,8), new THREE.MeshPhongMaterial({color:0x253b53}));
  g.add(base);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.4,12,12), new THREE.MeshPhongMaterial({color:0xd4af37,emissive:0xd4af37}));
  top.position.y = 1.2; g.add(top);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2,10,32), new THREE.MeshBasicMaterial({color:0xd4af37,transparent:true,opacity:0.28,side:THREE.DoubleSide}));
  beam.rotation.x = Math.PI/2; beam.position.z = 5; g.add(beam);
  scene.add(g);
  camera.position.set(0,9,15); camera.lookAt(0,0,0);
  (function loop(){ requestAnimationFrame(loop); g.rotation.y += 0.01; renderer.render(scene,camera); })();
  addEventListener("resize", ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
}

// ── fbm water shader (from the Stitch export) ─────────────────────────────
(function initSea(){
  const canvas = document.getElementById("sea"); if(!canvas) return;
  function size(){ const dpr=Math.min(devicePixelRatio,2), w=Math.floor(innerWidth*dpr), h=Math.floor(innerHeight*dpr);
    if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; } }
  addEventListener("resize", size); size();
  const gl = canvas.getContext("webgl")||canvas.getContext("experimental-webgl"); if(!gl) return;
  const vs=`attribute vec2 a_position;varying vec2 v;void main(){v=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}`;
  const fs=`precision highp float;varying vec2 v;uniform float u_time;
  float noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
  float sn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    float a=noise(i),b=noise(i+vec2(1,0)),c=noise(i+vec2(0,1)),d=noise(i+vec2(1,1));
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
  float fbm(vec2 p){float val=0.0,a=0.5;for(int i=0;i<5;i++){val+=a*sn(p);p*=2.0;a*=0.5;}return val;}
  void main(){vec2 uv=v;vec2 p=uv*3.0;
    float n1=fbm(p+u_time*0.1);float n2=fbm(p-u_time*0.05+n1);
    vec3 c1=vec3(0.031,0.102,0.204);vec3 c2=vec3(0.05,0.15,0.3);
    vec3 col=mix(c1,c2,n2);
    float rays=pow(sn(uv*1.5+u_time*0.02),5.0)*0.1;col+=rays*vec3(0.83,0.69,0.22);
    float vig=smoothstep(0.85,0.2,length(uv-0.5));col*=vig+0.25;
    gl_FragColor=vec4(col,1.0);}`;
  function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);return o;}
  const prog=gl.createProgram();
  gl.attachShader(prog,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const pos=gl.getAttribLocation(prog,"a_position"); gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
  const uTime=gl.getUniformLocation(prog,"u_time");
  (function render(t){ size(); gl.viewport(0,0,canvas.width,canvas.height);
    gl.uniform1f(uTime,t*0.001); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); requestAnimationFrame(render); })(0);
})();

// ══════════════════════════════════════════════════════════════════════════
//  LOGIN + ACCOUNT
//  V6.1.183 (F-522 #6): the account view reads `account.json`, which the daemon
//  writes every cycle and the hourly log push publishes — what SMT ACTUALLY
//  holds, in two tabs: LIVE (the WEEX simulated account: real orders) and PAPER
//  (the lanes set to paper: no orders). It used to be SYNTHESISED here: today's
//  LONG/SHORT verdicts treated as positions opened 24h ago on a hardcoded
//  $10,000, priced off CoinGecko, and labelled "SMT's live book". Nothing on
//  this page is invented now: a missing value shows "—", and when the feed
//  cannot be read the panel says so instead of drawing numbers.
// ══════════════════════════════════════════════════════════════════════════
// ── SESSION (operator 09-29: "everytime i reload the page … i have to relogin
// and go to the account again"). This browser remembers who entered (guest or
// founder) and what was open — the account and its tab, or a coin — for
// SESSION_DAYS, and a reload lands back there. It is a convenience, NOT a login:
// the founder view shows the same public feed anyone can fetch, and nothing
// secret is stored. "Sign out" in the account panel forgets it.
const SESSION_KEY = "smt_session", SESSION_DAYS = 30;
function loadSession(){
  try{ const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if(s && s.role && Date.now() - (s.ts||0) < SESSION_DAYS*864e5) return s; }catch(e){}
  return null;
}
function saveSession(patch){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify(Object.assign(loadSession() || {role:"guest"}, patch, {ts:Date.now()}))); }catch(e){}
}
function signOut(){ const wasFounder = isFounder();
  try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  // A0: a founder also leaves Cloudflare Access, or the next visit is still signed in
  if(wasFounder) location.href = "/cdn-cgi/access/logout"; else location.reload(); }
async function restoreSession(){
  // A0: back from Cloudflare Access (/founder/ → the Worker → /?founder=1)
  try{ const u = new URL(location.href);
    if(u.searchParams.get("founder") === "1"){
      const cur = loadSession() || {};
      saveSession({role:"founder", view: cur.view || "account"});
      u.searchParams.delete("founder"); history.replaceState(null, "", u.pathname + u.search + u.hash);
    } }catch(e){}
  if(!loadSession()) saveSession({role:"guest", view:"world"});   // no sign-in to watch
  const S = loadSession() || {role:"guest", view:"world"};         // storage may refuse the write
  document.getElementById("login")?.classList.add("hidden");
  await enter(true);
  if(S.view==="account"){ acctTab = S.tab==="paper" ? "paper" : "live"; openAccount(); setAcctTab(acctTab); }
  else if(S.view==="calls"){ openCalls(); }
  else if(S.view==="coin" && S.coin){ didPan = false; focusIsland(S.coin); if(S.coinTab) setCoinTab(S.coinTab); }
}
function openLogin(){ document.getElementById("login").classList.remove("hidden"); }
function closeLogin(){ document.getElementById("login").classList.add("hidden"); }
// A0 (10-07): the founder signs in through Cloudflare Access at /founder/ (their
// email, a one-time code); the Worker checks Access's token and sends them back
// here with ?founder=1. Without that, the page shows the public feed and says so.
function enterAdmin(){ closeLogin(); saveSession({role:"founder", view:"account"}); location.href = "/founder/"; }
// Exchange login is not built yet, and there is no backend to receive an email,
// so the page no longer asks for one (it used to keep it in this browser only
// and promise "we'll email you").
function showWaitlist(){ document.getElementById("wlBox")?.classList.remove("hidden"); }

const esc = v => String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtN = n => (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString(undefined,{maximumFractionDigits: Math.abs(n)<10?4:2});
const fmtUsd = n => (n==null||isNaN(n)) ? "—" : (n>=0?"+":"−")+"$"+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:2});
const colr = n => n==null ? "" : (n>=0 ? "#73fad0" : "#ffb4ab");
function ago(iso){
  if(!iso) return "unknown";
  const s = (Date.now()-Date.parse(iso))/1000;
  if(isNaN(s)) return "unknown";
  if(s<90) return "just now";
  if(s<5400) return Math.round(s/60)+" min ago";
  if(s<172800) return Math.round(s/3600)+" h ago";
  return Math.round(s/86400)+" days ago";
}

let ACCOUNT = null, acctTab = "live";
// A0: the founder feed (the whole snapshot: each setup's rule, trigger and own
// sentence, the freeze, the go-live ladder, the paper copies) answers only behind
// Cloudflare Access; anything else — not signed in, expired, not set up — falls
// back to the PUBLIC account.json and the page says which one it shows.
async function loadFounderFeed(){
  try{
    const ctl = new AbortController(); const to = setTimeout(()=>ctl.abort(), 6000);
    const r = await fetch("/founder/feed.json", {cache:"no-store", credentials:"same-origin",
                                                 redirect:"manual", signal:ctl.signal});
    clearTimeout(to);
    if(r.type === "opaqueredirect" || r.status === 0) return {ok:false, why:"sign-in needed"};
    let j = null; try{ j = await r.json(); }catch(e){}
    if(!r.ok) return {ok:false, why:(j && j.error) || ("HTTP " + r.status)};
    return (j && j.feed === "founder") ? {ok:true, feed:j, email:j.founder_email || null}
                                       : {ok:false, why:"the founder feed did not parse"};
  }catch(e){ return {ok:false, why:"the founder feed could not be reached"}; }
}
async function loadAccount(){
  const s = loadSession();
  // a failed founder read is not retried every minute this page load (/code-review:
  // each retry cost a Worker round trip before the public feed showed) — signing in
  // reloads the page, and a session that expires mid-visit drops to public once
  if(s && s.role === "founder" && !(FOUNDER.tried && !FOUNDER.ok)){
    const f = await loadFounderFeed();
    FOUNDER = {ok:f.ok, tried:true, email:f.email || null, why:f.why || null};
    if(f.ok){
      ACCOUNT = f.feed; FEED_SRC["account.json"] = "founder";
      // the per-cycle bucket (when on) is named in the feed; decisions.json reads it
      FEED_BUCKET = bucketURL(f.feed.feed_bucket);
      applyLivePrices(); syncPill(); return ACCOUNT;
    }
  }
  ACCOUNT = await loadFeed("account.json", j => j.generated_at, 5000);
  applyLivePrices(); syncPill();
  return ACCOUNT;
}
// The HUD pill says what the Worker verified, re-read with every account read: a
// session that expires mid-visit turns it back into "Sign in" (/code-review 10-07).
function syncPill(){
  const pill = document.getElementById("hudSignin"); if(!pill) return;
  pill.textContent = isFounder() ? "Founder ✓" : "Sign in";
  pill.onclick = isFounder() ? openAccount : openLogin;
}

// ── LIVE PRICES (operator 09-29: "will the open positions not update real time?")
// The POSITIONS come from account.json, which the bot writes every cycle but the
// VM publishes only hourly. The PRICE doesn't have to wait: the browser reads it
// every few seconds and re-marks every open row. WEEX's price endpoint sends no
// CORS header (a browser may not read it — checked 09-29), so this is Binance's
// public market-data mirror (free, CORS-open): SPOT, a hair off WEEX's perp.
// Said on the page; when it can't be read, the rows fall back to the feed's own
// price AND say so — never silently.
const LIVE_PX_URL = "https://data-api.binance.vision/api/v3/ticker/price?symbols=";
const LIVE_PX_EVERY_MS = 10000;
let LIVE_PX = {}, LIVE_PX_AT = null;
function openRows(){ const A = ACCOUNT || {}; return [...((A.live||{}).open||[]), ...((A.paper||{}).open||[])]; }
async function loadLivePrices(){
  const pairs = [...new Set(openRows().map(x=>x.pair))];
  if(!pairs.length){ LIVE_PX = {}; LIVE_PX_AT = null; return; }
  try{
    const ctl = new AbortController(); const to = setTimeout(()=>ctl.abort(), 5000);
    const r = await fetch(LIVE_PX_URL + encodeURIComponent(JSON.stringify(pairs.map(p=>p+"USDT"))),
                          {cache:"no-store", signal:ctl.signal}); clearTimeout(to);
    const j = r.ok ? await r.json() : [];
    const m = {}; (Array.isArray(j)?j:[]).forEach(t=>{ const v = parseFloat(t.price); if(v>0) m[t.symbol.replace(/USDT$/,"")] = v; });
    LIVE_PX = m; LIVE_PX_AT = Object.keys(m).length ? Date.now() : null;
  }catch(e){ LIVE_PX = {}; LIVE_PX_AT = null; }
  applyLivePrices(); refreshViews(true);
}
function applyLivePrices(){
  openRows().forEach(x=>{
    if(x.feed_mark === undefined) x.feed_mark = x.mark;
    const live = LIVE_PX[x.pair];
    x.mark = live != null ? live : x.feed_mark;
    x.mark_src = live != null ? "live" : "feed";
    x.upnl_pct = (x.mark!=null && x.entry) ? (x.side==="LONG"?1:-1)*(x.mark-x.entry)/x.entry*100 : null;
  });
}
function priceNote(){
  if(!openRows().length) return "no open position to price";
  if(LIVE_PX_AT) return `prices live (Binance spot, ${Math.round((Date.now()-LIVE_PX_AT)/1000)}s ago)`;
  return ACCOUNT ? `prices from the feed (${ago(ACCOUNT.generated_at)}) — the live price could not be read` : "";
}
// Redraw whatever is showing, keeping scroll positions. A PRICE tick redraws only
// the position lists (/code-review: not the personas, the history or the islands).
let _posOpen = null;
function refreshViews(pricesOnly){
  const acct = document.getElementById("account");
  if(acct && !acct.classList.contains("hidden")) renderAccount();
  const det = document.getElementById("detail");
  if(focused && det && !det.classList.contains("hidden")){ const y = det.scrollTop;
    if(pricesOnly) renderCoinPos(focused); else focusIsland(focused, true);
    det.scrollTop = y; }
  const pd = document.getElementById("posd");
  if(_posOpen && pd && !pd.classList.contains("hidden")){ const y = pd.scrollTop; openPos(_posOpen.id, true); pd.scrollTop = y; }
}

function openAccount(){
  exitFocus(); hideSidePanels();
  document.getElementById("account").classList.remove("hidden");
  setNav("account");
  saveSession({view:"account", tab:acctTab});
  markAccount();
}
function closeAccount(){ closePos(); saveSession({view:"world"}); document.getElementById("account").classList.add("hidden");
  document.getElementById("navAccount")?.classList.remove("active"); setNav("world"); }
function setAcctTab(t){ acctTab = t; saveSession({tab:t});
  document.getElementById("tabLive")?.classList.toggle("on", t==="live");
  document.getElementById("tabPaper")?.classList.toggle("on", t==="paper");
  renderAccount(); }

// ── V6.1.200: positions are OPENABLE (operator 09-29: "i should be able to
// open a position and see its history properly"). Every row carries its date
// and time, the setup's name, and — for a setup with no take-profit — how it
// exits, instead of the "target 0" the old row printed.
// The short name comes from the feed (account_snapshot.SETUP_NAME), never a copy here.
const setupName = x => x.setup_name || x.setup || (x.setup === undefined ? "setup not in this feed" : "lane plan");
const EXIT_SHORT = {trend_hold:"no target — rides the trend", time_only:"no target — closes on its clock"};
const liveWord = () => (ACCOUNT && ACCOUNT.daemon_shadow) ? "shadow" : "live";
const liveOn = p => (((ACCOUNT||{}).live||{}).open||[]).filter(x=>x.pair===p);
const paperOn = p => (((ACCOUNT||{}).paper||{}).open||[]).filter(x=>x.pair===p);
function fmtWhen(iso){
  if(!iso) return "—";
  const d = new Date(iso); if(isNaN(d)) return "—";
  return d.toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
}
function fmtHold(h){
  if(h==null || isNaN(h)) return "—";
  return h<1 ? Math.round(h*60)+" min" : h<48 ? h.toFixed(1)+" h" : (h/24).toFixed(1)+" days";
}
const hoursSince = iso => { const t = Date.parse(iso); return isNaN(t) ? null : (Date.now()-t)/3.6e6; };
// Rows the panels drew, by id — a click opens one. Oldest dropped past the cap.
const ROWS_KEPT = 2000; let _rowSeq = 0; const _rows = new Map();
function rowRef(x, book, state){
  _rows.set(++_rowSeq, {x, book, state});
  if(_rows.size > ROWS_KEPT) _rows.delete(_rows.keys().next().value);
  return _rowSeq;
}
const upUsd = p => (p.mark!=null && p.entry!=null && p.qty!=null) ? (p.side==="LONG"?1:-1)*(p.mark-p.entry)*p.qty : null;
function posRow(p, book){
  const up = p.upnl_pct, usd = upUsd(p);
  // a guest's row carries no stop, target or exit rule (operator 10-07) — say nothing
  // rather than "stop —" or a "no target" that isn't known
  const ex = p.target ? `target ${fmtN(p.target)}` : (EXIT_SHORT[p.exit_rule] || ("target" in p ? "no target" : ""));
  const lim = ["stop" in p ? `stop ${fmtN(p.stop)}` : "", ex].filter(Boolean).join(" · ");
  return `<li class="rowlink" onclick="openPos(${rowRef(p, book||acctTab, "open")})"><img class="pos-ship" src="assets/${shipArt(p, book||acctTab)}.webp" alt="" draggable="false"/><div class="acct-pp"><b>${esc(p.pair)} <span class="muted small">${esc(p.lane)}</span></b>
      <span class="sd ${p.side==="SHORT"?"short":"long"}">${esc(p.side)}${p.leverage?" "+fmtN(p.leverage)+"x":""}</span></div>
    <span class="acct-px"><span class="setup-tag">${esc(setupName(p))}</span> · opened ${fmtWhen(p.opened_at)}<br>${fmtN(p.entry)} → ${fmtN(p.mark)}${lim ? `<br><span class="muted">${esc(lim)}</span>` : ""}</span>
    <span class="acct-up" style="color:${colr(up)}">${up==null?"—":(up>=0?"+":"")+up.toFixed(2)+"%"}<br><span class="small">${fmtUsd(usd)}</span></span></li>`;
}
function closeRow(c, book){
  return `<li class="rowlink" onclick="openPos(${rowRef(c, book||acctTab, "closed")})"><div class="acct-pp"><b>${esc(c.pair)} <span class="muted small">${esc(c.lane)}</span></b>
      <span class="sd ${c.side==="SHORT"?"short":"long"}">${esc(c.side)}</span></div>
    <span class="acct-px"><span class="setup-tag">${esc(setupName(c))}</span> · ${esc(c.reason_plain||c.reason||"")}<br><span class="muted">${c.opened_at ? `${fmtWhen(c.opened_at)} → ${fmtWhen(c.closed_at)} (${fmtHold(c.hours)})` : `closed ${fmtWhen(c.closed_at)}`}</span></span>
    <span class="acct-up" style="color:${colr(c.net_usd)}">${fmtUsd(c.net_usd)}</span></li>`;
}

// ── One position, in full: what opened it, why, how it exits, its timeline.
// The same trade in the CURRENT feed (the feed is re-read every minute and the
// prices every few seconds, so a view kept open must re-find its row).
const rowKey = x => [x.pair, x.side, x.lane, x.setup, x.opened_at, x.closed_at, x.exit, x.net_usd].join("|");   // a guest's close has no opened_at
function findCurrent(r){
  const A = ACCOUNT || {}, B = r.book==="paper" ? (A.paper||{}) : (A.live||{});
  const pool = r.state==="open" ? (B.open||[])
    : [...(B.recent_closes||[]), ...(((A.history||{})[r.x.pair]||{})[r.book]||[])];
  return pool.find(y=>rowKey(y)===rowKey(r.x)) || r.x;
}
function openPos(i, refresh){
  let r = refresh && _posOpen ? _posOpen.r : _rows.get(i); if(!r) return;
  r = Object.assign({}, r, {x: findCurrent(r)});
  _posOpen = {id: i, r};
  const x = r.x, open = r.state==="open", paper = r.book==="paper";
  const kind = paper ? (x.shadow_of ? "paper copy" : "paper") : liveWord();
  const row = (k, v) => v==null || v==="" ? "" : `<div class="pd-row"><span class="muted">${k}</span><span>${v}</span></div>`;
  const stopPct = (x.stop!=null && x.entry) ? ` (${((x.stop/x.entry-1)*100).toFixed(0)}% from entry)` : "";
  const held = open ? hoursSince(x.opened_at) : x.hours;
  const copies = (!paper && open) ? paperOn(x.pair).filter(c=>c.shadow_of===x.setup) : [];
  const pnl = open
    ? `${x.upnl_pct==null?"—":(x.upnl_pct>=0?"+":"")+x.upnl_pct.toFixed(2)+"%"} · ${fmtUsd(upUsd(x))} <span class="muted small">unrealised</span>`
    : `${fmtUsd(x.net_usd)} <span class="muted small">net of fees${paper?" and funding":""}</span>`;
  document.getElementById("pdBody").innerHTML = `
    <div class="detail-hero" style="margin-bottom:8px"><div>
      <h2 class="font-display">${esc(x.pair)} <span class="sd-big ${x.side==="SHORT"?"short":"long"}">${esc(x.side)}</span></h2>
      <div class="dverdict ${open?cls(x.side):"wait"}">${open?"OPEN":"CLOSED"} · ${esc(kind)} · ${esc(x.lane||"")}</div></div></div>
    <div class="pd-pnl" style="color:${colr(open?x.upnl_pct:x.net_usd)}">${pnl}</div>
    <div class="detail-sub">What opened it</div>
    <div class="pd-card">${(()=>{ const t = String(x.setup_plain||x.setup_kind||setupName(x)), i = t.indexOf(" — ");
        return i>0 ? `<b>${esc(t.slice(0,i))}</b>${esc(t.slice(i))}` : esc(t); })()}
      ${x.trigger_plain?`<div class="pd-trig">Trigger: ${esc(x.trigger_plain)}.</div>`:""}
      ${x.shadow_of?`<div class="pd-trig">A paper copy of the live <b>${esc(x.shadow_of_name||x.shadow_of)}</b> trade — no real order.</div>`:""}</div>
    ${isFounder() ? `<div class="detail-sub">Why — the setup's own words</div>
    <div class="pd-why">${x.why ? esc(x.why) : "Not stored for this position: it opened before V6.1.200 started recording it. The daemon log's <code>[PLAYBOOK] AUTHORED</code> line for this entry holds it."}</div>`
    : ""}
    ${x.record ? `<div class="detail-sub">Its record (history, net of fees)</div><div class="pd-card">${esc(x.record)}</div>` : ""}
    <div class="detail-sub">How it exits</div>
    <div class="pd-card">${esc(x.exit_plain || x.exit_kind || (x.setup === undefined ? "Not in this feed — it predates V6.1.200; the next publish carries it." : "—"))}</div>
    ${row("Stop", x.stop!=null ? fmtN(x.stop)+stopPct : null)}
    ${"target" in x ? row("Target", x.target ? fmtN(x.target) : "none") : ""}
    ${isFounder() ? row("Time limit", x.hold_max_h ? fmtHold(x.hold_max_h) : null) : ""}
    <div class="detail-sub">Timeline</div>
    ${x.opened_at ? row("Opened", fmtWhen(x.opened_at)+` <span class="muted small">(${ago(x.opened_at)})</span>`) : ""}
    ${open ? "" : row("Closed", fmtWhen(x.closed_at)+` <span class="muted small">(${ago(x.closed_at)})</span>`)}
    ${held==null || !isFounder() ? "" : row(open?"Held so far":"Held", fmtHold(held))}
    ${open ? "" : row("Why it closed", esc(x.reason_plain||"—")+(x.reason&&x.reason!==x.reason_plain?`<br><span class="muted small mono">${esc(x.reason)}</span>`:""))}
    <div class="detail-sub">Numbers</div>
    ${row("Entry", fmtN(x.entry))}
    ${row(open?"Now":"Exit", fmtN(open?x.mark:x.exit) + (open?` <span class="muted small">(${x.mark_src==="live"?"live":"feed"})</span>`:""))}
    ${row("Size", x.qty!=null ? fmtN(x.qty)+" "+esc(x.pair)+(x.entry?` <span class="muted small">(≈$${fmtN(x.qty*x.entry)})</span>`:"") : null)}
    ${row("Leverage", x.leverage ? fmtN(x.leverage)+"x" : null)}
    ${row("Best point", x.peak_pct!=null ? (x.peak_pct>=0?"+":"")+x.peak_pct.toFixed(2)+"%" : null)}
    ${row("Lots", x.lots && x.lots>1 ? fmtN(x.lots) : null)}
    ${row("Funding paid", x.funding_usd ? fmtUsd(-x.funding_usd) : null)}
    ${copies.length ? `<div class="detail-sub">Paper copies of this trade (no real orders)</div><ul class="acct-positions">${copies.map(c=>posRow(c,"paper")).join("")}</ul>` : ""}`;
  const pd = document.getElementById("posd"); if(!refresh) pd.scrollTop = 0; pd.classList.remove("hidden");
}
function closePos(){ _posOpen = null; document.getElementById("posd")?.classList.add("hidden"); }

// ── The coin's own history, live and paper (operator 09-29: "same goes for the pairs")
let coinTab = "live";
function setCoinTab(t){ coinTab = t; saveSession({coinTab:t}); renderCoinHist(); }
function renderCoinHist(){
  const el = document.getElementById("dHist"); if(!el || !focused) return;
  const H = ((ACCOUNT||{}).history||{})[focused] || {live:[], paper:[]};
  const rows = H[coinTab] || [];
  el.innerHTML = `<div class="acct-tabs">
      <button class="acct-tab ${coinTab==="live"?"on":""}" onclick="setCoinTab('live')">Live (${(H.live||[]).length})</button>
      <button class="acct-tab ${coinTab==="paper"?"on":""}" onclick="setCoinTab('paper')">Paper (${(H.paper||[]).length})</button></div>
    <ul class="acct-positions">${rows.map(c=>closeRow(c, coinTab)).join("") ||
      `<li class="muted small" style="border:none">${ACCOUNT ? "No "+coinTab+" closes on "+esc(focused)+" in the feed yet." : "The account feed could not be read."}</li>`}</ul>`;
}

function renderAccount(){
  const A = ACCOUNT, $ = id => document.getElementById(id);
  const mode = $("acctMode"), pos = $("acctPositions"), cls = $("acctCloses"), note = $("acctNote");
  if(!A || !A.live){
    mode.textContent = "account feed unavailable";
    ["acctBal","acctEq","acctPnl"].forEach(id => { $(id).textContent = "—"; $(id).style.color=""; });
    pos.innerHTML = `<li class="muted small" style="border:none">The account feed (account.json) could not be read, so nothing is shown rather than a made-up number.</li>`;
    cls.innerHTML = ""; note.textContent = ""; return;
  }
  const lanes = Object.entries(A.lane_modes||{}).map(([l,m])=>`${l}=${m}`).join(" · ");
  const shadow = !!A.daemon_shadow;
  const src = {"cycle":"updated every cycle",
               "hourly:off":"hourly copy — the per-cycle feed is off",
               "hourly:older":"hourly copy — the per-cycle copy is older (its uploads have stalled)",
               "hourly:unreadable":"hourly copy — the per-cycle feed could not be read",
               "hourly:refused":"hourly copy — the per-cycle copy was refused (no valid timestamp)",
               "founder":"the founder feed, hourly copy"}[FEED_SRC["account.json"]] || "hourly copy";
  const who = isFounder() ? `FOUNDER VIEW${FOUNDER.email ? " (" + FOUNDER.email + ")" : ""}`
            : (FOUNDER.tried ? `PUBLIC VIEW — founder feed not available: ${FOUNDER.why || "sign-in needed"}` : "PUBLIC VIEW");
  mode.textContent = isFounder() ? `${who} · ${A.version||""} · positions as of ${fmtWhen(A.generated_at)} (${ago(A.generated_at)}; ${src}) · ${priceNote()}`
                                  : [`Updated ${ago(A.generated_at)}`,
                                     // a fallback is never silent, even in the short line (/code-review 10-07)
                                     openRows().length ? (LIVE_PX_AT ? "prices live" : "live price unavailable — feed prices") : "",
                                     /^hourly:(older|unreadable|refused)$/.test(FEED_SRC["account.json"] || "") ? "backup copy — the per-cycle feed is down" : "",
                                     // 11-20: the Firebase build's deploy-time copy, when the Worker's live one did not load
                                     FEED_FROM["account.json"] === "snapshot" ? "deploy-time snapshot — the live feed did not load" : ""]
                                    .filter(Boolean).join(" · ");
  const signin = (FOUNDER.tried && !FOUNDER.ok)
    ? `<div class="pd-trig" style="margin-bottom:8px">🔒 You are seeing the <b>public</b> feed (${esc(FOUNDER.why || "sign-in needed")}). <a href="#" onclick="enterAdmin();return false" style="color:#f2ca50">Founder sign-in →</a></div>` : "";
  if(acctTab==="live"){
    const L = A.live, open = L.open||[];
    // A sum over only the positions that have a price would be shown as the
    // total, so any missing mark makes the card "—" instead (`/code-review`).
    const vals = open.map(p=>(p.mark!=null&&p.entry!=null&&p.qty!=null)?(p.side==="LONG"?1:-1)*(p.mark-p.entry)*p.qty:null);
    const u = vals.some(v=>v==null) ? null : vals.reduce((s,v)=>s+v,0);
    $("acctLbl1").textContent = "Equity (WEEX sim)"; $("acctBal").textContent = L.equity_usd==null?"—":fmtN(L.equity_usd)+" "+(L.equity_asset||""); $("acctBal").style.color="";
    $("acctLbl2").textContent = "Open positions";   $("acctEq").textContent = String(open.length);
    $("acctLbl3").textContent = "Unrealised";        $("acctPnl").textContent = (open.length&&u!=null)?fmtUsd(u):"—"; $("acctPnl").style.color = (open.length&&u!=null)?colr(u):"";
    pos.innerHTML = open.map(x=>posRow(x,"live")).join("") || `<li class="muted small" style="border:none">No live trade open. Sitting out is a call too. ⛵</li>`;
    cls.innerHTML = (L.recent_closes||[]).map(x=>closeRow(x,"live")).join("") || `<li class="muted small" style="border:none">No live closes yet.</li>`;
    note.innerHTML = signin + (shadow
      ? `⚠️ The bot is running in <b>shadow mode</b>: these positions are simulated, no orders are sent.`
      : isFounder() ? `Real orders on SMT's <b>WEEX-granted simulated account</b> (sandbox funds, not money). Equity read from WEEX ${ago(L.equity_read_at)}. Lanes: ${esc(lanes)}.`
                    : `Real orders on WEEX's simulated account — sandbox funds, not money.`);
  } else {
    const P = A.paper||{}, open = P.open||[], tot = Object.values(P.totals||{});
    const net = tot.reduce((s,t)=>s+(t.net_usd||0),0), n = tot.reduce((s,t)=>s+(t.n||0),0), w = tot.reduce((s,t)=>s+(t.wins||0),0);
    $("acctLbl1").textContent = "Paper net";   $("acctBal").textContent = n?fmtUsd(net):"—"; $("acctBal").style.color = n?colr(net):"";
    $("acctLbl2").textContent = "Paper trades"; $("acctEq").textContent = n?`${n} (${w} won)`:"0";
    $("acctLbl3").textContent = "Open";         $("acctPnl").textContent = String(open.length); $("acctPnl").style.color="";
    pos.innerHTML = open.map(x=>posRow(x,"paper")).join("") || `<li class="muted small" style="border:none">No paper position open right now.</li>`;
    cls.innerHTML = (P.recent_closes||[]).map(x=>closeRow(x,"paper")).join("") || `<li class="muted small" style="border:none">No paper closes yet.</li>`;
    const per = Object.entries(P.totals||{}).map(([l,t])=>`${esc(l)}: n=${t.n}, net ${fmtUsd(t.net_usd)}`).join(" · ");
    const bySetup = Object.entries(P.setup_totals||{}).map(([k,t])=>`${esc(k)}: n=${t.n}, net ${fmtUsd(t.net_usd)}`).join(" · ");
    // V6.1.206 (R9): the go-live ladder — each paper setup's closes against its bar.
    const lad = Object.entries((ACCOUNT && ACCOUNT.ladder)||{}).map(([k,t])=>`${esc(k)} ${t.n}/${t.bar}${t.ready?" ✅ READY (operator's call)":""}`).join(" · ");
    // V6.1.216 (F-632): several paper setups on one coin = one market move graded several times.
    const setupWord = s => (open.find(x=>x.setup===s)||{}).setup_name || s;   // the row's own plain name
    const ovl = Object.entries(P.overlap||{}).map(([c,s])=>`<b>${esc(c)}</b> is held by ${s.length} paper setups (${s.map(x=>esc(setupWord(x))).join(", ")})`).join(" · ");
    // A0: the copies, the go-live ladder and the overlap grouping are founder-only
    // (PATENT_SIDENOTES § 9 rows 11, 12, 16) — the public feed does not carry them.
    note.innerHTML = signin + (isFounder()
      ? `${ovl?`⚠️ ${ovl} — one price move, graded once per setup: read those rows together, not as ${Object.values(P.overlap).reduce((a,s)=>a+s.length,0)} separate results. `:""}Paper trades pass every check but send <b>no order</b>; they exit by their setup's own rule at the cycle price (no slippage), and pay funding at the live rate. <b>Copies</b> are paper twins of a live trade at another size or with adds (each copy's row says which) — graded on their own, never counted in the lane totals. Tap any row for its full story. ${per?"By lane: "+per+".":""} ${bySetup?"By setup (copies included): "+bySetup+".":""} ${lad?"Go-live ladder (paper closes vs the bar of 30 with net > 0): "+lad+".":""}`
      : `Practice trades — no real order. Tap a row for its story.`);
  }
}
async function markAccount(){
  if(!document.getElementById("account")) return;
  await loadAccount(); renderAccount();
}
// Every minute: re-read the feed; redraw whatever is showing (islands always —
// a new live position changes an island's look).
const islandSig = () => PAIRS.map(p=>{ const h = liveOn(p)[0], d = DECISIONS[p]||{};
  return p + (h ? "H" + h.side : (d.action||"") + pct(d.conf)); }).join(",");
setInterval(async ()=>{
  const before = islandSig();
  await loadAccount(); await loadDecisions();
  const ocean = document.getElementById("ocean");
  if(islandSig() !== before && ocean && !ocean.classList.contains("hidden")
     && document.getElementById("walk").classList.contains("hidden")){
    renderIslands();
    if(focused) document.getElementById("isle-"+focused)?.classList.add("sel");
  }
  refreshViews();
}, 60000);
setInterval(()=>{ if(document.visibilityState==="visible" && ACCOUNT) loadLivePrices(); }, LIVE_PX_EVERY_MS);

// ── Drag a panel's LEFT edge to widen it (operator 09-29). One fixed handle per
// panel, kept at the panel's left edge; the width is remembered per panel in
// this browser only. Double-click the edge to reset. Off on phones (full-screen).
// SPLIT VIEW, not an overlay (operator: "it moves sideways and the website gets
// responsive at the same time"): an open panel DOCKS — the world shrinks to the
// space left of it and re-centres, live while you drag.
function syncDock(){
  const open = [...document.querySelectorAll("aside.detail")].filter(p=>!p.classList.contains("hidden"));
  const w = innerWidth > 640 && open.length ? Math.max(...open.map(p=>p.offsetWidth)) : 0;
  document.body.classList.toggle("docked", w > 0);
  document.body.style.setProperty("--dock", w + "px");
  applyMap();
  // a narrow world has no room for the open legend AND the nav: fold it while
  // docked narrow, and unfold it again only if it was this that folded it
  // 10-07: five nav tabs — any desktop world narrower than this folds it, docked or not
  const lg = document.getElementById("legend"), narrow = innerWidth > 640 && innerWidth - w < LEGEND_ROOM_W;
  document.body.classList.toggle("dock-narrow", narrow);
  if(lg && narrow && !lg.classList.contains("collapsed")){ lg.classList.add("collapsed"); lg._autoFold = true; }
  if(lg && !narrow && lg._autoFold){ lg.classList.remove("collapsed"); lg._autoFold = false; }
}
const LEGEND_ROOM_W = 1080;    // legend (244) + five-tab nav (~520) centred, with a gap
const PANEL_MIN_W = 320, PANEL_GUTTER = 40;
function syncHandle(panel){
  const h = panel._rs; if(!h) return;
  const show = !panel.classList.contains("hidden") && innerWidth > 640;
  h.style.display = show ? "block" : "none";
  if(show){ h.style.right = (panel.offsetWidth - 5) + "px";
    h.style.zIndex = String((parseInt(getComputedStyle(panel).zIndex)||45) + 1); }
  syncDock();
}
function initResize(){
  document.querySelectorAll("aside.detail").forEach(panel=>{
    const key = "smt_w_" + panel.id, h = document.createElement("div");
    h.className = "rs-handle"; h.title = "Drag to resize · double-click to reset";
    document.body.appendChild(h); panel._rs = h;
    try{ const w = parseInt(localStorage.getItem(key)); if(w) panel.style.width = w + "px"; }catch(e){}
    h.addEventListener("pointerdown", e=>{
      e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId);
      panel.classList.add("resizing"); document.body.classList.add("dock-drag");
      const mv = ev=>{ panel.style.width = Math.max(PANEL_MIN_W, Math.min(innerWidth-PANEL_GUTTER, innerWidth-ev.clientX)) + "px"; syncHandle(panel); };
      const up = ()=>{ h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up);
        panel.classList.remove("resizing"); document.body.classList.remove("dock-drag");
        try{ localStorage.setItem(key, String(parseInt(panel.style.width))); }catch(e){} };
      h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up);
    });
    h.addEventListener("dblclick", ()=>{ panel.style.width = ""; try{ localStorage.removeItem(key); }catch(e){} syncHandle(panel); });
    new MutationObserver(()=>syncHandle(panel)).observe(panel, {attributes:true, attributeFilter:["class"]});
    syncHandle(panel);
  });
  addEventListener("resize", ()=>document.querySelectorAll("aside.detail").forEach(syncHandle));
}
initResize();

// ══════════════════════════════════════════════════════════════════════════
//  CALLS (10-07, operator: "users come and play with SMT") — Clock In's core
//  (smt-solana-hack, clockin/Grading.kt), without its streaks, leaderboard or
//  reminders (the game rules: no streaks, no leaderboard, no nudges; a right and
//  a wrong call look the same). You call a coin UP or DOWN for CALL_HORIZON_H
//  hours; SMT's lean at that moment is saved beside your call. It is a scorecard,
//  not a blind test: the coin panel shows the advisors' votes to anyone, so a
//  visitor may well copy SMT (/code-review 10-07: the page used to claim the lean
//  was hidden until you called — it never was). Both calls are graded on market
//  prices at the call and at its horizon — never on a price this page stored.
//  Calls live in this browser only (localStorage): nothing is sent anywhere.
// ══════════════════════════════════════════════════════════════════════════
const CALL_HORIZON_H = 4;                 // = ClockInCall.HORIZON_HOURS
const CALL_STALE_H = 6;                   // = STALE_AFTER_SEC: an older feed has no lean (not graded)
const CALL_VOID_D = 7;                    // no source can price it a week past its horizon: closed unscored, so it never blocks its coin
const CALL_RETRY_S = 600;                 // an unpriced call is re-read at most every 10 min, not every tick
const CALLS_KEY = "smt_calls_v1", CALLS_MAX = 200;
const CANDLE_1M = (c, ms) => `https://data-api.binance.vision/api/v3/klines?symbol=${c}USDT&interval=1m&startTime=${ms}&limit=1`;
const CG_RANGE = (id, a, b) => `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${a}&to=${b}`;
// CoinGecko's range data is 5-minute inside the last day and HOURLY beyond it (a
// 90-minute window three days back returned one point, on the hour — /code-review
// 10-07), so its first point at or after the moment within 65 minutes. Clock In's
// 45 left about a quarter of older calls with no point at all.
const CG_WINDOW_S = 3900;
const CALL_SOURCES = ["Binance", "CoinGecko"];
let callCoin = "BTC", _calling = false, _grading = null;
function loadCalls(){ try{ const a = JSON.parse(localStorage.getItem(CALLS_KEY) || "[]"); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
function saveCalls(a){ try{ localStorage.setItem(CALLS_KEY, JSON.stringify(a.slice(-CALLS_MAX))); }catch(e){} }
const callId = c => `${c.coin}@${c.t0}`;
// SMT's lean on a coin: its committee's LONG/SHORT, or on a WAIT the conviction-weighted
// sum of the advisors' votes — labelled a LEAN, never a trade (SmtFeed.kt `lean`). A
// BLOCK is the safety rule refusing the coin: no lean. Only a LONG/SHORT carries a
// percentage — a WAIT's conviction is for sitting out, not for the lean (/code-review).
function smtLean(coin){
  const d = DECISIONS[coin];
  if(DECISIONS_ARE_SAMPLE || !d) return {lean:"FLAT", why:"NOFEED", conv:null};
  const age = d.as_of ? (Date.now() - Date.parse(d.as_of)) / 36e5 : Infinity;
  if(!(age < CALL_STALE_H)) return {lean:"FLAT", why:"STALE", conv:null};
  const conv = Math.round((d.conf || 0) * 100);
  if(d.action === "LONG") return {lean:"UP", why:"LONG", conv};
  if(d.action === "SHORT") return {lean:"DOWN", why:"SHORT", conv};
  if(d.action === "BLOCK") return {lean:"FLAT", why:"BLOCK", conv:null};
  const v = normaliseVotes(d.votes), sum = Object.values(v).reduce((t, x) =>
    t + (x && x[0] === "LONG" ? +x[1] || 0 : x && x[0] === "SHORT" ? -(+x[1] || 0) : 0), 0);
  return {lean: sum > 1e-9 ? "UP" : sum < -1e-9 ? "DOWN" : "FLAT", why:"WAIT", conv:null};
}
// The market price at a moment, read the SAME way at both ends of a call: the first
// price at or after it — a price the caller had not yet seen. Binance: the open of the
// 1-minute candle starting on the next whole minute (it must be that minute's candle,
// not a later one after a gap). CoinGecko: its first point within CG_WINDOW_S.
async function priceAt(coin, sec, src){
  if(src === "Binance"){
    const start = Math.ceil(sec / 60) * 60;
    const k = await _getJSON(CANDLE_1M(coin, start * 1000));
    return (Array.isArray(k) && k[0] && +k[0][0] === start * 1000 && parseFloat(k[0][1]) > 0)
      ? {px: parseFloat(k[0][1]), src} : null;
  }
  const g = await _getJSON(CG_RANGE(CG_IDS[coin], sec, sec + CG_WINDOW_S));
  let best = null;
  ((g && g.prices) || []).forEach(([t, v]) => { t = t / 1000;
    if(t >= sec && t <= sec + CG_WINDOW_S && v > 0 && (!best || t < best.t)) best = {t, px: v}; });
  return best ? {px: best.px, src} : null;
}
// Both ends from ONE source: Binance if it prices both, else CoinGecko for both.
async function pricePair(coin, t0, t1){
  for(const src of CALL_SOURCES){
    const a = await priceAt(coin, t0, src); if(!a) continue;
    const b = await priceAt(coin, t1, src); if(b) return {a, b, src};
  }
  return null;
}
const outcome = (dir, move) => move === 0 ? "not scored" : ((dir === "UP") === (move > 0) ? "right" : "wrong");
// No network before the save: the call is the coin on screen at the tap, saved at once,
// so a coin switch or a grading pass in flight cannot change or drop it (/code-review).
function makeCall(dir){
  const coin = callCoin;
  if(_calling) return;
  _calling = true;
  try{
    const calls = loadCalls(), now = Math.floor(Date.now() / 1000);
    if(calls.some(c => c.coin === coin && !c.graded)){ renderCalls(`You already have an open call on ${coin}.`); return; }
    const smt = smtLean(coin);
    calls.push({coin, dir, t0: now, due: now + CALL_HORIZON_H * 3600, smt: smt.lean, smtWhy: smt.why, smtConv: smt.conv});
    saveCalls(calls); renderCalls();
  }finally{ _calling = false; }
}
// Grade every call past its horizon. One pass at a time; its results are merged into
// the list as it is NOW, so a call made while prices were being read is kept.
function gradeDueCalls(){
  if(!_grading) _grading = _gradeDue().finally(() => { _grading = null; });
  return _grading;
}
async function _gradeDue(){
  const now = Date.now() / 1000, upd = {};
  for(const c of loadCalls()){
    if(c.graded || now < Math.ceil(c.due / 60) * 60 + 5) continue;   // its horizon minute has not opened
    if(c.tried && now - c.tried < CALL_RETRY_S) continue;
    const q = await pricePair(c.coin, c.t0, c.due);
    if(q){
      const move = (q.b.px - q.a.px) / q.a.px * 100;
      upd[callId(c)] = {graded:true, move, px0:q.a.px, px1:q.b.px, gsrc:q.src, you: outcome(c.dir, move),
                        smtOut: c.smt === "FLAT" ? "not scored" : outcome(c.smt, move)};
    }else if(now - c.due > CALL_VOID_D * 86400){
      upd[callId(c)] = {graded:true, void:true, move:null, you:"not scored", smtOut:"not scored"};
    }else upd[callId(c)] = {tried: now};
  }
  if(!Object.keys(upd).length) return;
  const calls = loadCalls();
  calls.forEach(c => { const u = upd[callId(c)]; if(u && !c.graded) Object.assign(c, u); });
  saveCalls(calls); renderCalls();
}
const arrow = d => d === "UP" ? "▲ UP" : d === "DOWN" ? "▼ DOWN" : "— no lean";
// two decimals: a 4-hour move is often under 0.1%, and "−0.0% · you right" reads as a bug
const fmtMove = v => (v==null||isNaN(v)) ? "—" : (v>=0?"+":"−")+Math.abs(v).toFixed(2)+"%";
function renderCalls(msg){
  const el = document.getElementById("callsBody"); if(!el) return;
  const calls = loadCalls(), open = calls.find(c => c.coin === callCoin && !c.graded);
  const g = calls.filter(c => c.graded);
  const sc = k => { const s = g.filter(c => c[k] !== "not scored"); return `${s.filter(c => c[k] === "right").length}/${s.length}`; };
  const whyNo = {NOFEED:"SMT's feed didn't load", STALE:"SMT's feed is over " + CALL_STALE_H + " h old",
                 BLOCK:"SMT's safety rule refuses this coin"};
  const smtSay = c => c.smt === "FLAT" ? `no lean${whyNo[c.smtWhy] ? ` (${whyNo[c.smtWhy]})` : ""}`
                                       : `leans ${arrow(c.smt)}${c.smtConv ? ` (${c.smtConv}%)` : ""}`;
  const row = c => `<li><b>${esc(c.coin)}</b> ${arrow(c.dir)} <span class="muted small">· ${fmtWhen(new Date(c.t0*1000).toISOString())}</span><br>
      <span class="small">${c.void ? "No price could be read for it — not scored."
        : c.graded ? `${fmtMove(c.move)} in ${CALL_HORIZON_H} h · you <b>${c.you}</b> · SMT ${arrow(c.smt)} <b>${c.smtOut}</b>`
        : `SMT ${smtSay(c)} · result at ${fmtWhen(new Date(c.due*1000).toISOString())}`}</span></li>`;
  el.innerHTML = `
    <div class="call-coins">${PAIRS.map(p => `<button class="call-coin${p === callCoin ? " on" : ""}" onclick="callCoin='${p}';renderCalls()">${p}</button>`).join("")}</div>
    <div class="call-q">${callCoin} in ${CALL_HORIZON_H} hours?</div>
    <div class="call-btns"><button class="call-up" onclick="makeCall('UP')">▲ UP</button><button class="call-down" onclick="makeCall('DOWN')">▼ DOWN</button></div>
    ${msg ? `<p class="call-note">${esc(msg)}</p>` : ""}
    ${open ? `<div class="pd-card">You: ${arrow(open.dir)} · SMT: ${smtSay(open)}</div>` : ""}
    <div class="call-score">You ${sc("you")} · SMT ${sc("smtOut")} <span class="muted small">(graded calls)</span></div>
    <ul class="acct-positions call-list">${calls.slice().reverse().map(row).join("") || `<li class="muted small" style="border:none">No calls yet.</li>`}</ul>
    <p class="call-note">Graded on Binance prices (CoinGecko if Binance is blocked). Saved in this browser only.</p>`;
}
function openCalls(coin){
  exitFocus(); hideSidePanels();
  if(coin) callCoin = coin;
  document.getElementById("calls").classList.remove("hidden");
  setNav("calls");
  saveSession({view:"calls"});
  renderCalls(); gradeDueCalls();
}
function closeCalls(){ document.getElementById("calls")?.classList.add("hidden");
  saveSession({view:"world"}); setNav("world"); }
setInterval(() => { if(!document.getElementById("calls")?.classList.contains("hidden")) gradeDueCalls(); }, 60 * 1000);

restoreSession();
