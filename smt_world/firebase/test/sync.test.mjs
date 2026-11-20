// Unit tests: a signed-in user's Calls and questions (src/lib/sync.js)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../src/lib/sync.js";

const call = (o = {}) => ({ coin: "ADA", dir: "UP", t0: 1763600000, due: 1763614400, smt: "UP", smtWhy: null, smtConv: 41, ...o });

test("a call keeps only known fields; anything that isn't a call is refused", () => {
  assert.deepEqual(Object.keys(S.cleanCall(call({ evil: "x", __proto__x: 1 }))).sort(), ["coin", "dir", "due", "smt", "smtConv", "smtWhy", "t0"]);
  for (const bad of [null, {}, call({ coin: "PEPE" }), call({ dir: "SIDEWAYS" }), call({ t0: "1763600000" }), call({ t0: 1.5 })])
    assert.equal(S.cleanCall(bad), null);
});

test("merge: the same call on two devices appears once, and the GRADED copy wins either way round", () => {
  const open = call(), graded = call({ graded: true, move: 1.2, you: "right", smtOut: "right" });
  assert.equal(S.mergeCalls([open], [graded])[0].graded, true);
  assert.equal(S.mergeCalls([graded], [open])[0].graded, true);
  assert.equal(S.mergeCalls([open], [open]).length, 1);
});

test("merge: calls from both sides are kept, oldest first, capped at the app's 200", () => {
  const a = Array.from({ length: 150 }, (_, i) => call({ t0: 1000 + i }));
  const b = Array.from({ length: 150 }, (_, i) => call({ coin: "BTC", t0: 2000 + i }));
  const m = S.mergeCalls(a, b);
  assert.equal(m.length, S.CALLS_MAX);
  assert.ok(m.every((c, i) => i === 0 || m[i - 1].t0 <= c.t0));
  assert.equal(m[m.length - 1].t0, 2149, "the newest are the ones kept");
});

test("only calls that changed since the last write are written again", () => {
  const w = new Map([[S.callDocId(call()), JSON.stringify(S.cleanCall(call()))]]);
  assert.equal(S.changedCalls([call()], w).length, 0);
  assert.equal(S.changedCalls([call({ graded: true, move: 0.5, you: "wrong", smtOut: "right" })], w).length, 1);
  assert.equal(S.changedCalls([call({ t0: 5 })], w).length, 1);
});

test("score counts graded calls only and leaves 'not scored' out", () => {
  const s = S.score([call(), call({ t0: 2, graded: true, you: "right", smtOut: "wrong" }), call({ t0: 3, graded: true, you: "wrong", smtOut: "not scored" })]);
  assert.deepEqual(s, { you: { right: 1, of: 2 }, smt: { right: 0, of: 1 } });
});

test("a question record is capped and its fields are only the ones the rules allow", () => {
  const r = S.questionRecord("x".repeat(900), "fr", "weird", "rule");
  assert.equal(r.q.length, 500); assert.equal(r.lang, "en"); assert.equal(r.outcome, "answered");
  assert.deepEqual(Object.keys(S.questionRecord("q", "hi", "refused", null)).sort(), ["lang", "layer", "outcome", "q"]);
});

test("the security rules allow exactly the call fields the app writes, and the doc id it uses", () => {
  const rules = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "firestore.rules"), "utf8");
  const listed = (/calls\/\{callId\}[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/.exec(rules) || [])[1];
  assert.deepEqual(listed.match(/'([a-zA-Z0-9]+)'/g).map(s => s.slice(1, -1)), S.CALL_KEYS);
  assert.match(rules, /callId == request\.resource\.data\.coin \+ '@' \+ string\(request\.resource\.data\.t0\)/);
  assert.equal(S.callDocId(call()), "ADA@1763600000");
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
});
