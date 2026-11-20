// SMT World — a signed-in user's Calls against SMT, synced to Firestore (11-20). Pure: no DOM,
// no Firebase, so the merge and the field allowlist are unit-tested (test/sync.test.mjs).
//
// A call (app.js makeCall / _gradeDue): {coin, dir, t0, due, smt, smtWhy, smtConv} when made,
// plus {graded, move, px0, px1, gsrc, you, smtOut} or {void} when graded, {tried} while it waits.
// Firestore rules (firestore.rules) accept ONLY these keys — the same list as CALL_KEYS.

export const PAIRS = ["BTC", "ETH", "BNB", "SOL", "LTC", "XRP", "ADA", "DOGE"];
export const CALL_KEYS = ["coin", "dir", "t0", "due", "smt", "smtWhy", "smtConv", "graded", "move", "px0", "px1", "gsrc", "you", "smtOut", "void", "tried"];
export const CALLS_MAX = 200;   // = app.js CALLS_MAX

// The Firestore document id of a call: its coin and the second it was made (app.js callId).
export const callDocId = c => `${c.coin}@${c.t0}`;

// Only known keys, only sensible values; null for anything that isn't a call.
export function cleanCall(c) {
  if (!c || !PAIRS.includes(c.coin) || !["UP", "DOWN"].includes(c.dir) || !Number.isInteger(c.t0)) return null;
  const out = {};
  for (const k of CALL_KEYS) if (c[k] !== undefined) out[k] = c[k];
  return out;
}

// Local (this browser) and remote (the account) lists → one list. Same call on both sides:
// the GRADED copy wins (grading happens once, on whichever device saw the horizon first);
// otherwise the remote copy. Sorted oldest first, the newest CALLS_MAX kept.
export function mergeCalls(local, remote) {
  const by = new Map();
  for (const c of [...(remote || []), ...(local || [])]) {
    const x = cleanCall(c); if (!x) continue;
    const id = callDocId(x), have = by.get(id);
    if (!have || (!have.graded && x.graded)) by.set(id, x);
  }
  return [...by.values()].sort((a, b) => a.t0 - b.t0).slice(-CALLS_MAX);
}

// Which calls changed since they were last written, so each save writes only those.
export function changedCalls(calls, lastWritten) {
  return (calls || []).map(cleanCall).filter(Boolean)
    .filter(c => lastWritten.get(callDocId(c)) !== JSON.stringify(c));
}

// "You 3/5 · SMT 2/5": graded calls, "not scored" ones left out (app.js renderCalls).
export function score(calls) {
  const g = (calls || []).filter(c => c && c.graded);
  const sc = k => { const s = g.filter(c => c[k] && c[k] !== "not scored"); return { right: s.filter(c => c[k] === "right").length, of: s.length }; };
  return { you: sc("you"), smt: sc("smtOut") };
}

// A question as it is kept in the user's history: text capped, the outcome of the turn.
export function questionRecord(q, lang, outcome, layer) {
  return { q: String(q || "").slice(0, 500), lang: ["en", "hi", "bn"].includes(lang) ? lang : "en",
           outcome: outcome === "refused" ? "refused" : "answered", layer: layer || null };
}
