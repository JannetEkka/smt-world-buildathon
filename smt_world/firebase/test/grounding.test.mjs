import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "../src/lib/grounding.js";
import { projectPublic } from "../../functions/api/public_account.js";

const WORLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const A = projectPublic(JSON.parse(fs.readFileSync(path.join(WORLD, "account.json"), "utf8")));
const D = JSON.parse(fs.readFileSync(path.join(WORLD, "decisions.json"), "utf8"));
const votes = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v, 0.5, "note"]]));
const checks = facts => Object.fromEntries(facts.map(f => [f.persona, f.check]));

// The labels must claim exactly what smt/explain/explainer.py ranked_drivers tested:
// k=2 drivers, only the winning side is eligible, a persona whose flip does not move the
// JUDGE is dropped.
test("one driver: the other same-side advisor was DROPPED by the flip test → removed", () => {
  const f = F.advisorFacts("ADA", { action: "WAIT", drivers: ["flows"], votes: votes({ flows: "LONG", sentiment: "LONG", flow: "SHORT", regime: "NEUTRAL" }) });
  assert.deepEqual(checks(f), { flows: "carried", sentiment: "removed", flow: "against" });
});

test("two drivers: a third same-side advisor may have passed and ranked lower → not_shown, never 'removed'", () => {
  const f = F.advisorFacts("BTC", { action: "LONG", drivers: ["flow", "flows"], votes: votes({ flow: "LONG", flows: "LONG", sentiment: "LONG" }) });
  assert.deepEqual(checks(f), { flow: "carried", flows: "carried", sentiment: "not_shown" });
});

test("no driver at all (attributed false) → every directional advisor shows as removed", () => {
  const f = F.advisorFacts("SOL", { action: "WAIT", drivers: [], attributed: false, votes: votes({ flow: "LONG", sentiment: "SHORT" }) });
  assert.deepEqual(checks(f), { flow: "no_driver", sentiment: "no_driver" });
});

test("a BLOCKED coin was never flip-tested → not_checked", () => {
  const f = F.advisorFacts("DOGE", { action: "BLOCK", drivers: [], votes: votes({ flow: "LONG" }) });
  assert.deepEqual(checks(f), { flow: "not_checked" });
});

test("legacy whale/onchain drivers fold onto flows", () => {
  const f = F.advisorFacts("ETH", { action: "LONG", drivers: ["whale"], votes: votes({ whale: "LONG", flow: "LONG" }) });
  assert.deepEqual(checks(f), { flows: "carried", flow: "removed" });
});

test("an advisor's engineering note never reaches the model", () => {
  const f = F.advisorFacts("ADA", { action: "WAIT", drivers: ["flow"], votes: { flow: ["LONG", 0.4, "see F-282 learned cells"] } });
  assert.doesNotMatch(f[0].text, /F-282|learned cells/);
});

test("the real committed feed: unique ids, every held position has its rule, record and exit", () => {
  const cat = F.buildCatalog(A, D);
  const ids = cat.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const held = [...(A.live.open || []), ...(A.paper.open || [])];
  assert.ok(held.length > 0, "the committed snapshot holds nothing — pick a fixture with positions");
  for (const x of held) for (const k of ["position", "rule", "exit"])
    assert.ok(cat.some(f => f.coin === x.pair && f.kind === k), `${x.pair} ${k}`);
  for (const p of F.PAIRS) if (D[p]) assert.ok(ids.includes(`${p}.call`));
});

test("the catalog carries only PUBLIC fields — never a rule's trigger or its own words", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(WORLD, "account.json"), "utf8"));
  const text = F.catalogText(F.buildCatalog(A, D));
  for (const x of [...((raw.live || {}).open || []), ...((raw.paper || {}).open || [])]) {
    for (const k of ["trigger", "trigger_plain", "why", "stop", "target"])
      if (x[k] && String(x[k]).length > 12) assert.ok(!text.includes(String(x[k])), `${k} leaked: ${x[k]}`);
  }
});

test("a coin named in the question narrows the catalog; names work in three scripts", () => {
  assert.deepEqual(F.coinsIn("why are you holding SOL?"), ["SOL"]);
  assert.deepEqual(F.coinsIn("तुम सोलाना क्यों पकड़े हो"), ["SOL"]);
  assert.deepEqual(F.coinsIn("তুমি বিটকয়েন নিয়ে কী ভাবো"), ["BTC"]);
  assert.deepEqual(F.coinsIn("the solution is"), []);
  const cat = F.buildCatalog(A, D, ["SOL"]);
  assert.ok(cat.every(f => f.coin === "SOL" || f.coin === null));
});

test("a point naming a fact the feed does not contain is dropped (the schema's enum, checked again)", () => {
  const cat = F.buildCatalog(A, D);
  const kept = F.keepPoints([{ fact: cat[1].id, says: "real" }, { fact: "SOL.p9.rule", says: "invented" },
                             { fact: cat[1].id, says: "duplicate" }, null], cat);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].says, "real");
});

test("the guarantee refusal's number is the feed's strongest record", () => {
  const b = F.bestRecord(A);
  assert.ok(b && b.n > 0 && b.win > 0 && b.win < 1);
});
