# Promo capture harness

Renders the trailer's beats and the store screenshots with the **shipped App**
in a real headless Chromium, one exact frame at a time, played by the sim's
own pilots. Nothing here is a mock-up: the page imports `src/main.ts`, and the
bays are the ones `launchSandbox` builds.

```sh
npm run promo -- --beat=plan                      # one beat
npm run promo -- --beat=plan --beat=precision     # several
npm run promo -- --all                            # every beat, in edit order
npm run promo -- --shots [--store=play|appstore|all]
npm run promo:assemble -- [--cut=promo|materials] [--run] [--vertical] [--font=…]
```

Options: `--fps=60` `--size=1920x1080` `--out=<dir>` (default `sim/results/promo`,
gitignored) `--seeds=N` (luck's search width) `--no-webm`.

## Run order

1. `npm run promo -- --all` — or the beats you want. Each writes
   `<out>/<beat>/frames/%06d.png`, `<out>/<beat>/beat.json`,
   `<out>/<beat>/contact.png` (every 30th frame tiled) and, when an ffmpeg is
   found, `<out>/<beat>.webm` (a preview; the assembled cuts come from the
   PNGs). `beat.json` carries the configuration, the seed, the frame count and
   the frame index of every notable event — line clears, grade stamps, blasts,
   congestion, the loss, the buzzer — which is what the assembly cues sound on.
2. `npm run promo:assemble` — dry run: prints and writes `<out>/mux.sh` from
   `timeline.json` and the beat.json files. Add `--run` where a full ffmpeg is
   installed (x264, aac, drawtext, concat, amix). Produces
   `promo-1920x1080.mp4` (60s) and `materials-1920x1080.mp4` (20s);
   `--vertical` adds the 9:16 crop of the promo.
3. `npm run promo -- --shots` — store screenshots at exact pixel sizes under
   `<out>/store/<store>/<size>/<NN>-<scene>.png`, with `manifest.json`. Never
   writes into `store/` in the repo; copy what you keep by hand.

## What is where

- `beats.ts` — the beats (id, bay configuration, pilot, end condition, lead-in),
  the store scenes and sizes. The one file to edit for a different shot.
- `run.ts` — the driver: Vite dev server, Chromium, the clock, frames, mux.
- `harness.ts` / `harness.html` — the page: the App plus `window.__promo`.
- `preroll.ts` — flies a bay without filming it, to find `luck`'s seed and
  each beat's event time. Runs inside the page (see below); its CLI
  (`npx tsx sim/promo/preroll.ts --beat=luck`) is for exploring in node.
- `hands.ts` — the scripted bomb / thaw / bond, through Game's own entry points.
- `events.ts` — the event recorder over the App's callbacks.
- `timeline.json` — the edit: order, durations, cards, beds, stinger cues.
- `assemble.ts` — turns the timeline and the captures into ffmpeg commands.

## How time works

The page's `performance.now`, timers and `requestAnimationFrame` are replaced
before the App loads by a clock that moves only when the driver ticks it, by
exactly one frame — so a 60fps capture is 60 physics steps a second by
construction. Chromium's own virtual time (CDP) drives the stylesheet's
transitions in lockstep. Every beat is first flown un-filmed in the same page
to learn when its event lands; the filmed bay reproduces that flight to the
step (`beat.json` → `preroll.phases[].match`). Two things made that exact:
the clock is reset to zero as the bay launches, and the frame delta carries a
2⁻³⁶ ms nudge so `main.ts`'s fixed-step accumulator can never land one ulp
short of a step (beats.ts's `PROMO_DT` says why). node's V8 and Chromium's
differ in the last bit of enough arithmetic that a bay flown in node parts
ways with the same bay in the browser after a few hundred steps — hence the
preroll running in the page.

## What the harness adds to the App, and what it does not

- `funds`: a Tier S bay launches cold (four launches in the till; the first
  paying sweep is ~10s in), so every beat opens its bay with a bankroll set
  on `Game.score` after launch, and flies un-filmed until its lead-in.
- `.kbd-hint` and `.build-tag` are hidden; `fullGame()` is shadowed so the
  tower's paid floors are open; the coach card, if any, is dismissed with its
  own button (docs/PLAY.md's recipe). Audio is off in the seeded settings.
- No edits to `src/`. Bots come from `sim/bots.ts`, `sim/aim-strategies.ts`
  and `sim/counters.ts`. The `demo` preset fires charges only at dead cargo,
  so the `improvise` bomb into a live pile is a scripted hand (`hands.ts`)
  aimed through the same `armBomb`/`shoot` a finger would use.

## Beats

| id | bay | pilot | ends on |
|---|---|---|---|
| plan | Tier 1, stock | `patient` | 2nd line clear |
| precision | Tier 3, Bond Emitter | `aim` + `excellent` policy | a T or S piece closing a double in the bottom-right corner (`isCornerDouble`, beats.ts) |
| slip | Tier 5, Crosswind ×2, slag ×1 | `impatient` + slip handicap | first congestion rung ("warn") |
| improvise | Tier 7, Demolition Rack T2 + Thaw Lance, cryo ×2 + volatile ×2 | `demo` + `lance` policy, scripted bomb & thaw | a clear after the blast |
| luck | Tier 6, clock ×3 | `aim`; seed searched for a lucky last clear at the buzzer | the buzzer |
| loss | Tier 9, sweeper ×2, wind ×2 | `lob-tall` | the loss, held through the collapse and the end card |
| climb | DOM holds | none | menu with seals (uifit fixture), Contract-clear salvage banner over a paused bay, Workshop with the Rack installed, the elevator ride into the paid floors |
| materials-* | Tier 6, one material on the belt | problem: `impatient`; answer: the counter's pilot | 2.5s + 2.5s, placed on the event |

## Store shots

Play 16:9 follows docs/PLAY.md: 960×540 @2.5 for the menu and boards,
1280×720 @1.875 for gameplay → 2400×1350. Apple's sizes are the current App
Store Connect landscape requirements (2868×1320, 2688×1242, 2752×2064), each
rendered at half size @2 — docs/ios.md names the device classes only, so
these are stated here rather than found in the repo. The portrait row exists
for completeness: the game is landscape-only and a portrait viewport renders
the rotate guard, so it is not a meaningful store shot.
