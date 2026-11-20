# SMT World — the art

Every still is drawn to `docs/SMT_WORLD_ARTIST_BRIEF.md` (style block § 1) and converted
with `convert.py` to about 3× the largest size the page draws it at. The page builds the
file name from data, so names are fixed (`tests/test_smt_world_art.py` checks they exist):

| File | Shown for |
|---|---|
| `island_{sunny,overcast,storm,frost}.webp` | an island's WEATHER — trend up · trend down · down ≥ `FALLING_FAST_PCT` in 24 h · no price read (`weatherArt` in `app.js`) |
| `ship_{tradewind,salvager,cutter,pilot}_{gold,canvas}.webp` | a held trade, moored beside its island and in the position lists — hull = setup family (`hullOf`), gold = live order, canvas = paper |
| `crew_<name>_face.webp` | an advisor's portrait in the coin panel (`CREW` in `app.js`); `crew_tidecaller_silent_face` when Flow sits a coin out |
| `crew_<name>_speaking.webp`, `crew_tidecaller_silent.webp`, `deckhand_idle.webp` | full-body crew for the crew deck / game shell (not drawn yet) |
| `lighthouse.webp` | the centre of the map |
| `island_{long,short,wait,block}.webp` | ⚠️ the pre-10-07 set, no longer drawn — kept until the operator OKs deleting them |

## Adding or replacing a still
1. Generate it with the brief's prompt + style block (Canva connector or the Gemini app), on plain white.
2. Remove the background (Canva `remove-background`), export a transparent PNG at full size.
   Judge it from the PNG — the connector's chat preview is a 200 px JPEG.
3. Convert:
   ```bash
   python3 smt_world/assets/convert.py new.png island_sunny 360          # islands
   python3 smt_world/assets/convert.py new.png ship_cutter_gold 240      # ships
   python3 smt_world/assets/convert.py new.png lighthouse 540
   python3 smt_world/assets/convert.py crew.png crew_herald_face 160 --box 340,10,740,410   # a portrait crop
   ```
4. Commit the `.webp` only (sources are 1–2 MB each and stay out of git).

## Concept art (reference only — never loaded by the page)
- `concept/crew_ship_gemini_v1.webp` — the crew on the ship as Gemini drew it (10-01), labelled by the
  operator. The style reference for the first pass; the 10-07 set supersedes it.
