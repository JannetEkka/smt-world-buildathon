// SMT World — Ask SMT's CHECKED FACTS (11-20, buildathon).
//
// The answering model may cite ONLY the facts built here, by id: the structured-output
// schema makes `points[].fact` an ENUM of these ids, so a reason the feed does not contain
// cannot be named. Each fact carries its VERIFICATION from the feed, never from the model:
//
//   rule        the setup that opened this position (account.json `setup_name/setup_kind`)
//   record      that rule's tested record (`record`, net of fees)
//   exit        its exit plan in words (`exit_kind`)
//   position    the position itself (entry, mark, P&L, book)
//   carried     an advisor in decisions.json `drivers`: flipping its input changed the call
//   removed     an advisor on the same side that the flip test DROPPED: flipping it changed nothing
//   not_shown   same side, not a driver, but the feed lists two drivers (it keeps the top
//               two), so it may have passed the flip test and ranked lower — not claimed either way
//   against     voted the other way; the flip test only tries the winning side
//   no_driver   the call had NO driver (`attributed: false`): no advisor's flip moved it
//   not_checked the coin was BLOCKED by a safety rule; nothing was flip-tested
//
// How the feed decides `drivers`: smt/explain/explainer.py ranked_drivers (k=2, only the
// side that won is eligible, a persona whose flip does not move the JUDGE is dropped).
//
// Pure: no DOM, no Firebase. Tested by smt_world/firebase/test/grounding.test.mjs.

export const PAIRS = ["BTC", "ETH", "BNB", "SOL", "LTC", "XRP", "ADA", "DOGE"];
export const PERSONA_NAMES = { flow: "Flow", regime: "Regime", flows: "Flows", sentiment: "Sentiment",
                               catalyst: "Catalyst", technical: "Technical" };
const LEGACY = { whale: "flows", onchain: "flows" };
// the advisors' own notes sometimes carry engineering references; a guest never sees them
// (same filter as app.js renderDetail)
const INTERNAL = /\bF-\d{2,}|learned cells|quorum|LEARNED SILENCE/i;

// Coin names as people say them, in three scripts.
const COIN_WORDS = {
  BTC: ["btc", "bitcoin", "बिटकॉइन", "बिटकोइन", "বিটকয়েন", "বিটকইন"],
  ETH: ["eth", "ether", "ethereum", "ईथर", "एथेरियम", "इथेरियम", "ইথার", "ইথেরিয়াম"],
  BNB: ["bnb", "binance coin", "बीएनबी", "বিএনবি"],
  SOL: ["sol", "solana", "सोल", "सोलाना", "सोलना", "সোল", "সোলানা"],
  LTC: ["ltc", "litecoin", "लाइटकॉइन", "লাইটকয়েন"],
  XRP: ["xrp", "ripple", "एक्सआरपी", "रिपल", "এক্সআরপি", "রিপল"],
  ADA: ["ada", "cardano", "कार्डानो", "एडा", "কার্ডানো"],
  DOGE: ["doge", "dogecoin", "डॉज", "डोजकॉइन", "डोगे", "ডজ", "ডোজকয়েন"],
};
export function coinsIn(text) {
  const s = String(text || "").normalize("NFC").toLowerCase();
  return PAIRS.filter(p => COIN_WORDS[p].some(w =>
    /^[a-z ]+$/.test(w) ? new RegExp("(^|[^a-z])" + w + "([^a-z]|$)").test(s) : s.includes(w)));
}

const r2 = v => (v == null || isNaN(v)) ? "?" : Number(v).toFixed(2);
const px = v => (v == null || isNaN(v)) ? "?" : (Math.abs(v) >= 100 ? Number(v).toFixed(1) : Number(v).toPrecision(4));

// One coin's advisors, each with its verification label from the feed.
export function advisorFacts(coin, d) {
  if (!d || !d.votes) return [];
  const votes = {};
  for (const [k, v] of Object.entries(d.votes)) votes[LEGACY[k] || k] = v;
  const drivers = [...new Set((d.drivers || []).map(x => LEGACY[x] || x))];
  const dir = Object.keys(votes).filter(k => Array.isArray(votes[k]) && (votes[k][0] === "LONG" || votes[k][0] === "SHORT"));
  const side = drivers.length && votes[drivers[0]] ? votes[drivers[0]][0] : null;
  const action = String(d.action || "WAIT").toUpperCase();
  return dir.map(k => {
    const [v, conf, note] = votes[k];
    let check;
    if (action === "BLOCK") check = "not_checked";
    else if (drivers.includes(k)) check = "carried";
    else if (!drivers.length) check = "no_driver";
    else if (v !== side) check = "against";
    else check = drivers.length < 2 ? "removed" : "not_shown";
    const lean = v === "LONG" ? "leans up" : "leans down";
    const plainNote = note && !INTERNAL.test(String(note)) ? ` (its note: ${String(note).slice(0, 160)})` : "";
    return { id: `${coin}.adv.${k}`, coin, kind: "advisor", persona: k, name: PERSONA_NAMES[k] || k,
             vote: v, conf: Number(conf) || 0, check,
             text: `${PERSONA_NAMES[k] || k} (advisor) ${lean}, ${Math.round((Number(conf) || 0) * 100)}% sure${plainNote}.` };
  });
}

// Every position, rule, record, exit and advisor fact the feeds hold — the ONLY ids the
// model may cite. `coins` narrows it (the coins a question names); empty = all coins.
export function buildCatalog(account, decisions, coins = []) {
  const want = c => !coins.length || coins.includes(c);
  const out = [];
  const A = account || {};
  if (A.live) {
    const lanes = Object.entries(A.lane_modes || {}).map(([l, m]) => `${l}=${m}`).join(", ");
    out.push({ id: "account", coin: null, kind: "account", check: "fact",
               text: `My account: ${A.account || "WEEX-granted simulated funds"} (a sandbox, not real money), equity ${r2(A.live.equity_usd)} ${A.live.equity_asset || "USDT"}. Lanes live or paper: ${lanes}. I only go long right now.` });
  }
  const books = [["live", (A.live || {}).open || []], ["paper", (A.paper || {}).open || []]];
  const seen = {};
  for (const [book, rows] of books) for (const x of rows) {
    if (!x || !x.pair || !want(x.pair)) continue;
    const i = seen[x.pair] = (seen[x.pair] ?? -1) + 1;
    const base = `${x.pair}.p${i}`;
    const bookWord = book === "live" ? "LIVE (a real order on the exchange's simulated account)" : "PAPER (practice, no order sent)";
    out.push({ id: `${base}.position`, coin: x.pair, kind: "position", check: "fact", book,
               text: `I hold ${x.pair} ${x.side} on ${bookWord}, ${x.lane} lane, opened ${String(x.opened_at || "?").slice(0, 10)}: entry ${px(x.entry)}, now ${px(x.mark)} (${r2(x.upnl_pct)}% so far), ${x.leverage || 1}x leverage.` });
    if (x.setup_name || x.setup_kind)
      out.push({ id: `${base}.rule`, coin: x.pair, kind: "rule", check: "rule",
                 text: `The rule that opened it: “${x.setup_name || x.setup}”${x.setup_kind ? ` — ${x.setup_kind}` : ""}` });
    if (x.record)
      out.push({ id: `${base}.record`, coin: x.pair, kind: "record", check: "record",
                 text: `That rule's tested record (history since 2020, after fees): ${x.record}.` });
    if (x.exit_kind)
      out.push({ id: `${base}.exit`, coin: x.pair, kind: "exit", check: "exit", text: `Exit plan: ${x.exit_kind}` });
  }
  for (const c of PAIRS) {
    if (!want(c)) continue;
    const d = (decisions || {})[c];
    if (!d) continue;
    out.push({ id: `${c}.call`, coin: c, kind: "call", check: "fact",
               text: `My six advisors' current call on ${c}: ${d.action} (${Math.round((Number(d.conf) || 0) * 100)}%). Advisors are graded; they never open or close a trade — written rules do.` });
    out.push(...advisorFacts(c, d));
  }
  return out;
}

// The catalog as the model reads it: one line per fact, id first, verification named.
const CHECK_WORDS = {
  rule: "THE RULE THAT OPENED IT", record: "TESTED RECORD", exit: "EXIT PLAN", fact: "FACT",
  carried: "CARRIED IT — flipping this input changed the call",
  removed: "REMOVED — flipping it changed nothing; never give it as a reason",
  not_shown: "NOT SHOWN — the two carriers above outranked it; never give it as a reason",
  against: "AGAINST — voted the other way; not a reason for the call",
  no_driver: "REMOVED — no advisor's flip changed this call; never give it as a reason",
  not_checked: "NOT CHECKED — a safety rule blocked this coin",
};
export function catalogText(catalog) {
  return catalog.map(f => `${f.id} | ${CHECK_WORDS[f.check] || f.check} | ${f.text}`).join("\n");
}

// The strongest tested record in the public feed — the number the guarantee refusal quotes.
export function bestRecord(account) {
  let best = null;
  for (const r of Object.values((account || {}).records || {})) {
    if (!r || !r.n || r.win_rate == null) continue;
    const score = (r.t_week || 0);
    if (!best || score > best.score) best = { n: r.n, win: r.win_rate, score };
  }
  return best;
}

// The model's points, kept only where they name a real fact (the enum should already
// guarantee it; this is the check that does not trust the schema), de-duplicated.
export function keepPoints(points, catalog) {
  const byId = new Map(catalog.map(f => [f.id, f]));
  const out = [], seen = new Set();
  for (const p of Array.isArray(points) ? points : []) {
    const f = p && byId.get(p.fact);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push({ fact: f, says: String(p.says || "").slice(0, 400) });
  }
  return out;
}

// The coins an answer is about: those the question names, else those the model cited.
export function answerCoins(question, points) {
  const named = coinsIn(question);
  if (named.length) return named;
  return [...new Set(points.map(p => p.fact.coin).filter(Boolean))];
}
