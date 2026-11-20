# SMT World on Firebase — voice Ask SMT (Google AI Startup Buildathon, Kolkata, Nov 2026)

SMT World is the explainable-AI crypto trader's world: 8 islands for 8 coins, the trades SMT holds, the advisors it grades, calls against SMT, and **Ask SMT**. This folder is SMT World deployed on **Firebase (Google Cloud) on the free Spark plan, with no billing account**, plus the buildathon's major new feature:

**Ask SMT out loud, in Hindi, Bengali or English.** Tap 🎤, ask *"why are you holding ADA?"*, and hear the answer. It's grounded in the real position: the rule that opened it, that rule's tested record and its exit plan. Every reason shows whether it actually changed the decision. Cheat questions are refused on screen, with the reason why. The account is simulated, and nothing here is financial advice.

The original site, `smt-weex-trading-bot.jannet-ekka.workers.dev`, stays up as the backup.

## Who it's for

Someone like Priya: 22, in Kolkata, who lost her savings following a Telegram signal group. Nobody there could tell her why a call was made, or whether the reason was real.

- In India, **93% of the 1.13 crore individual traders in equity futures & options lost money from FY22 to FY24, about ₹2 lakh each on average**, costs included ([SEBI press release, Sept 2024](https://www.sebi.gov.in/media-and-notifications/press-releases/sep-2024/updated-sebi-study-reveals-93-of-individual-traders-incurred-losses-in-equity-fando-between-fy22-and-fy24-aggregate-losses-exceed-1-8-lakh-crores-over-three-years_86906.html)). That's equity F&O, not crypto. It's the closest official Indian figure for retail traders on leverage.
- In Taiwan's market from 1992 to 2006, **fewer than 1% of day traders** earned predictably after fees ([Barber, Lee, Liu & Odean, *Journal of Financial Markets* 18, 2014](https://faculty.haas.berkeley.edu/odean/papers/day%20traders/Day%20Trading%20Skill%20110523.pdf)).

SMT never tells her what to buy. It shows her, in her own language, what it holds and why, and which of its reasons survived its own check. The account is simulated; the reasons are real.

## Google products used (each one really runs)

| Product | What it does here | Where |
|---|---|---|
| **Firebase Hosting** (Google Cloud, Spark plan) | serves SMT World | `firebase.json`, `build.mjs` |
| **Firebase AI Logic** → Gemini Developer API | every Gemini call, straight from the browser; Firebase holds the Gemini key, so none ships in the page | `src/ask.js` |
| **Gemini 3.1 Flash-Lite**: **structured output** | each answer is JSON. Every reason must name a fact id from the live feed, because the schema makes `points[].fact` an enum of those ids, so the model cannot cite a reason the feed doesn't hold | `answerSchema()` in `src/ask.js` |
| **Gemini 3.1 Flash-Lite**: **audio understanding, multilingual** | writes down the spoken question in Hindi (Devanagari), Bengali (Bengali script) or English | `transcribe()` |
| **Gemini Live API** (`gemini-3.1-flash-live-preview`, native audio) | speaks the answer, and returns a transcript of what it actually said, shown under the answer | `speakLive()` |
| **Firebase App Check** + **reCAPTCHA Enterprise** (Google Cloud, free tier) | only this site can spend the project's Gemini quota | `initializeAppCheck` in `src/ask.js` |
| Gemini API via AI Studio (already in production) | the trading bot's sentiment persona and news labels | `smt/context/fetchers/sentiment.py` |

All the models above are on the Gemini Developer API free tier, according to Firebase's AI Logic docs (11-20). The trading daemon itself stays on Oracle Cloud's free tier.

## How one voice question flows

```
🎤 tap ─► browser records, stops on a 1.3 s pause, makes a 16 kHz WAV           (lib/wav.js)
       └► Gemini Live connection opens now, while you talk                         (saves time later)
   ─► 1 EARS     Gemini 3.1 Flash-Lite: audio → {transcript, language}             structured output
   ─► 2 GUARD    PLAIN CODE checks the words (EN / HI / BN, scripts + Hinglish)    lib/guardrails.js
                 "what should I buy" · "guaranteed?" · "my savings" · "ignore your rules"
                 → refused HERE; the answering model never sees it
   ─► 3 ANSWER   Gemini: {refuse, answer, points:[{fact: <enum of feed ids>, says}]}
                 grounded in the same LIVE FACTS the Worker's /api/chat sends, plus the CHECKED FACTS
   ─► 4 CHECK    model's own `refuse` (2nd line) · plain code scans the answer (3rd line)
   ─► 5 SHOW     answer + each reason with the FEED's verification, not the model's:
                 ✓ carried it — flipping this input changed the decision
                 ~~struck~~ removed: flipping it changed nothing
   ─► 6 SPEAK    Gemini Live reads it aloud; if Live can't, the browser's voice does — and says so
                 ⏱ "x.x s from the end of your question to my first spoken word" (measured, on screen)
```

**Where ✓ and struck-out come from.** Every cycle, SMT's explainer flips each advisor's input and re-runs the decision (`smt/explain/explainer.py` `ranked_drivers`, the counterfactual check in the patent). It writes the advisors that moved the call into `decisions.json` as `drivers`, at most two of them. `lib/grounding.js` turns that into labels, and only claims what the check actually showed:

| Label | Meaning |
|---|---|
| ✓ carried it | the advisor is listed in `drivers` |
| removed: flipping it changed nothing | same side as a driver, only one driver listed, so the check dropped it |
| removed: no advisor's flip changed this call | the feed lists no driver at all |
| not shown | same side, but two drivers were already listed, so it may simply have ranked third |
| voted the other way | only the winning side is ever flip-tested |
| not checked | a safety rule blocked the coin |

**Where the data comes from.** Firebase Hosting on Spark can't forward requests to another site. So the page reads the live feeds from the Worker (`account.json`, `decisions.json`, `/api/trend`), which sends `Access-Control-Allow-Origin: *` on those four public paths only (`worker.js` `PUBLIC_FEEDS`). If that read fails, the page falls back to the copy bundled at deploy time and says so ("deploy-time snapshot"). The bundled `account.json` goes through the Worker's own public-fields filter, and the founder feed is never copied.

## Jannet's steps (about 20 minutes, no card, no billing)

**1 · Firebase project.** Go to console.firebase.google.com and sign in with your Google AI Pro account. Click **Create a project**, name it `smt-world`, turn Google Analytics **off**, then **Create project**. It starts on **Spark**. Never click *Upgrade* or *Blaze*.

**2 · AI Logic.** In the left menu, open **AI Services → AI Logic → Get started**. When it asks for a Gemini API provider, choose **Gemini Developer API** (no cost), then continue through the workflow. It creates the Gemini key inside Firebase; you never see or paste it.

**3 · Register the web app.** Click ⚙ **Project settings → General → Your apps → `</>` (Web)**. Nickname it `SMT World`, tick **Also set up Firebase Hosting**, then **Register app**. It shows a `firebaseConfig = {…}` block. That block is public by design, so you can paste it into the chat. Note the **Project ID**.

**4 · App Check (proves the calls come from our site).** Firebase switched this on for AI Logic automatically on 2 Nov.
   - Open console.cloud.google.com/security/recaptcha (Google Cloud now calls it **Security → Fraud Defense**) with the **same project** selected. Enable the reCAPTCHA Enterprise API if asked.
   - Click **Create key**. Type: **Web**. Domains: `<project-id>.web.app` and `<project-id>.firebaseapp.com`. Leave *checkbox challenge* **off**. Create it and copy the **key ID**.
   - Back in Firebase, open **Security → App Check → Apps → SMT World → Fraud Defense (formerly reCAPTCHA Enterprise)**, paste the key, keep the threshold at 0.5, and **Save**. ⚠️ Not the row labelled plain **reCAPTCHA**: that's Classic v3, which is deprecated and takes a secret key.
   - On Spark this is reCAPTCHA's free tier (10,000 checks a month, no billing).
   - *If it fights you tonight:* **App Check → APIs → Firebase AI Logic → Unenforce** gets the demo working. Only the free quota is exposed, and there's no billing to abuse. Turn enforcement back on afterwards.

**5 · Deploy from Google Cloud Shell** (shell.cloud.google.com; firebase-tools and Node come preinstalled). Pick one route:
   - **Fast route:** use Cloud Shell's ⋮ → **Upload** to upload `smt-world-firebase.zip`, which Claude built from this branch. Then run:
     ```
     unzip -o smt-world-firebase.zip -d smt-world && cd smt-world
     firebase login --no-localhost        # only if the next command says you're not logged in
     node configure.mjs --project smt-buildathon --recaptcha <reCAPTCHA-key-id>
     firebase deploy --only hosting --project smt-buildathon
     ```
     `configure.mjs` reads your web app's config itself (`firebase apps:sdkconfig web`), so there's nothing to paste.
   - **Repo route:** clone the branch (GitHub asks for a token, since the repo is private), then run:
     ```
     cd smt-weex-trading-bot/smt_world/firebase
     node build.mjs --project <project-id> --recaptcha <reCAPTCHA-key-id>
     firebase deploy --only hosting --project <project-id>
     ```
   - It prints `Hosting URL: https://<project-id>.web.app`. That's the new SMT World.

**6 · Check it** on your phone:
   - Open the URL and tap **Ask SMT**.
   - Tap the first chip, *"Why are you holding …?"*. You should see the rule, its record and exit plan, and the advisors with ✓ or struck out.
   - Tap 🎤 and ask the same in Hindi. You should hear it, and see the transcript and the ⏱ line.
   - Tap **Tell me what to buy**. The refusal should say *"Stopped by plain code, before any AI answered."*

If a step shows an error, the page says which one (App Check, quota, microphone) in words.

## The end-to-end number (measure it, don't guess it)

Each spoken answer shows **⏱ seconds from the end of your question to my first spoken word**. Every turn is also in the browser console as `[ASK-TIMING] {…}`, with the steps split out: `heard_ms` (transcription), `guard_ms`, `answer_ms`, and `first_word_s`. To report it, ask five spoken questions on the deployed site, on the phone and network you'll demo on, and report the median and the range. There's no baseline to compare against, so the number stands on its own.

## Agent Skill

`skills/ask-smt-rules/SKILL.md` is the rulebook any coding agent (Claude Code, Gemini CLI, Antigravity) loads before touching Ask SMT. It covers deterministic-first guardrails, never inventing a reason, labels that match the flip test, and never failing silently, and it ends by naming the test command that proves each one.

## Accessibility

axe-core 4.10.3 reports 0 violations on the Ask SMT panel with an answer and a refusal on screen. The chat log is a keyboard-reachable `role="log"` live region. The mic and language buttons expose `aria-pressed`, and every answer carries its `lang` so screen readers use the right voice. Each spoken answer is also on screen as text, with Gemini Live's own transcript underneath. The world map has three moderate landmark notes in markup it shares with workers.dev; those are left for a separate change.

## Tests

`node --test smt_world/firebase/test/*.test.mjs` (also run by `tests/test_buildathon_firebase.py`) covers:
- guardrails in three languages, and the three refusal lines;
- the fact catalog, with each label matching what the flip test proved;
- a fact id the feed doesn't contain gets dropped;
- the build ships no founder feed and no server code, and its `account.json` has public fields only;
- the Worker's CORS applies to the public feeds and never to `/founder`;
- the WAV encoding.

The full voice path was also driven in headless Chromium with a fake microphone. In that test, stand-ins replaced Google's SDK files, so it checks the page's wiring, not Gemini's answers or speed.
