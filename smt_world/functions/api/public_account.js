// SMT World — the PUBLIC account feed, served by the Worker (A0, 10-07).
//
// `account.json` is no longer a static file (.assetsignore): this script bundles the
// committed copy and returns ONLY the fields in `public_fields.json` — the same list
// smt/explain/account_snapshot.py writes the public feed from. So whatever wrote the
// file — a daemon from before the split, the first hourly push after a merge (which
// runs the pre-merge push script), a hand edit — a guest never reads the freeze, the
// go-live ladder, a paper copy, a rule's own words or a record's source.
import SNAP from "../../account.json" with { type: "json" };
import FIELDS from "./public_fields.json" with { type: "json" };

// Written only by the daemon's public view, and only from public fields: the
// numberless setup words, the exit in words, the record without its source.
const DERIVED_ROW = ["setup_kind", "exit_kind", "record"];
const DERIVED_RECORD = ["quote"];

const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o && Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
  return out;
};

// Pure: any snapshot in, the public shape out.
export function projectPublic(snap) {
  const s = snap || {};
  const isPublic = s.feed === "public";
  const rowKeys = isPublic ? [...FIELDS.row, ...DERIVED_ROW] : FIELDS.row;
  const recKeys = isPublic ? [...FIELDS.record, ...DERIVED_RECORD] : FIELDS.record;
  const copySet = new Set(FIELDS.copy_setups || []);
  // a CLOSED row also drops its open time: the two stamps are the hold (operator 10-07)
  const dropClosed = FIELDS.closed_row_drop;
  // fail closed on a bad list (missing, or a string whose characters for..of would walk)
  if (!Array.isArray(dropClosed) || !dropClosed.every(k => typeof k === "string"))
    throw new Error("public_fields.json closed_row_drop must be a list of field names");
  // closed = by the list a row sits in (closes, history), not by a field it may lack
  const row = closed => x => { const o = pick(x, rowKeys); if (closed) for (const k of dropClosed) delete o[k]; return o; };
  const rows = (xs, closed = false) => (Array.isArray(xs) ? xs : [])
    .filter(x => x && !x.shadow_of && !copySet.has(x.setup)).map(row(closed));
  const live = s.live || {}, paper = s.paper || {};
  const out = pick(s, FIELDS.top);
  out.feed = "public";
  if (!isPublic) out.projected_by = "worker";   // the page can say a pre-split daemon wrote it
  out.live = Object.assign(pick(live, FIELDS.equity), { open: rows(live.open), recent_closes: rows(live.recent_closes, true) });
  const copies = new Set(FIELDS.copy_setups || []);
  const setupTotals = {};
  for (const [k, v] of Object.entries(paper.setup_totals || {})) if (!copies.has(k)) setupTotals[k] = v;
  out.paper = { open: rows(paper.open), totals: paper.totals || {}, recent_closes: rows(paper.recent_closes, true),
                setup_totals: setupTotals };
  out.history = {};
  for (const [c, h] of Object.entries(s.history || {}))
    out.history[c] = { live: rows((h || {}).live, true), paper: rows((h || {}).paper, true) };
  out.records = {};
  for (const [k, r] of Object.entries(s.records || {})) out.records[k] = r ? pick(r, recKeys) : null;
  return out;
}

const BODY = JSON.stringify(projectPublic(SNAP));

export function onPublicAccount() {
  return new Response(BODY, { headers: { "Content-Type": "application/json",
    "Cache-Control": "no-cache" } });
}
