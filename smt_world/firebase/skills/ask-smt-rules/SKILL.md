---
name: ask-smt-rules
description: Rules for any coding agent changing SMT World's Ask SMT (smt_world/firebase/src). Load before editing ask.js, lib/guardrails.js, lib/grounding.js or the answer schema. Enforces deterministic-first guardrails, "never invent a reason", and checked-reason labels that match the feed's flip test.
---

# Ask SMT: rules a change must keep

Ask SMT answers beginners about a trading bot's real positions, by voice or text, in English, Hindi and Bengali. Two promises make it safe to put in front of someone who lost money to a signal group. This skill exists so no edit quietly breaks them.

## 1. Plain code checks the question before any answering model sees it

- `checkQuestion()` in `lib/guardrails.js` runs first, on typed text and on voice transcripts. A hit returns the fixed refusal and **makes no answering-model call**.
- The categories, in precedence order: `injection`, `savings`, `guarantee`, `advice`. Each category needs patterns in all three languages: English, Hindi (Devanagari and romanised), Bengali (Bengali script and romanised). Don't use `\b` next to Indic text or `%`.
- The model's `refuse` field is the second line, and `checkAnswer()` on the model's text is the third. Don't remove a line to "simplify".
- Every refusal says why it refuses and what SMT does instead, and the badge names which line stopped it (`STOPPED_BY`).
- Before you finish: add a test case in `test/guardrails.test.mjs` for any new pattern, and a benign question proving it doesn't over-block.

## 2. Never invent a reason

- The answer schema's `points[].fact` must stay an **enum built from `buildCatalog()`**, the ids of facts in the live feed. Don't loosen it to a free string.
- `keepPoints()` re-checks every cited id against the catalog. Keep it; it doesn't trust the schema.
- The ✓ / struck-out label comes from the **feed** (`decisions.json` `drivers`), never from the model. Each label claims only what `smt/explain/explainer.py ranked_drivers` proves:

| feed state | label |
|---|---|
| advisor in `drivers` | carried: flipping it changed the decision |
| same side, one driver listed | removed: flipping it changed nothing |
| same side, two drivers listed | not shown (it may have passed and ranked third) |
| other side | against (only the winning side is tested) |
| no drivers | no_driver |
| action BLOCK | not_checked |

- Only public fields reach the model. The account feed goes through `projectPublic()`; never add a rule's trigger, own words, stop or target.

## 3. Say it when something falls back

A feed snapshot instead of the live feed, browser speech instead of Gemini Live, App Check off: each one is said on screen and logged. Never fail silently.

## Check before you finish

```
node --test smt_world/firebase/test/*.test.mjs
```

All tests must pass. Name the count in your summary.
