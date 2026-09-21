# Promo capture harness

Renders the trailer's beats and the store screenshots with the **shipped App**
in a real headless Chromium, one exact frame at a time, played by the sim's
own pilots. Nothing here is a mock-up: the page imports `src/main.ts`, and the
bays are the ones `launchSandbox` builds.

**The owner's copy of this is [RUNBOOK.md](./RUNBOOK.md)** — which store wants
which size, where the files land, and how to re-shoot one PNG. This file is
the harness's own notes: what it does and why it is built the way it is.

```sh
npm run promo:beats                               # every beat, in edit order
npm run promo -- --beat=plan                      # one beat
npm run promo -- --beat=plan --beat=precision     # several
npm run promo:shots                               # every store, every size
npm run promo -- --shots --store=play|appstore|steam|all
npm run promo -- --shots --scene=leaderboard --store-size=2400x1350   # one PNG
npm run promo:verify -- --a=<dir>/store --b=<dir>/store [--diff=<dir>]
npm run promo:assemble -- [--cut=promo|materials] [--run] [--vertical] [--font=…]
```

Options: `--fps=60` `--size=1920x1080` `--out=<dir>` (default `sim/results/promo`,
gitignored) `--seeds=N` (luck's search width) `--no-webm` `--verbose[=frames]`.

No ffmpeg on the box is a SKIP, never a failure: the PNG frames and every
store shot still capture, the per-beat preview webm is skipped with a line
saying so, and `promo:assemble` still writes `mux.sh` for a box that has one.

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

## What makes a capture REPRODUCIBLE

The point of the whole rig is that the same command on the same tree produces
the same PNG, so the owner can re-shoot one screenshot in a year and have it
match its neighbours. Five things had to be closed for that to be true, and
`verify.ts` is what keeps them closed:

1. **The clock starts at zero** and moves only when the driver ticks it.
2. **Date is pinned** to `PROMO_EPOCH` plus the virtual clock, in UTC. Three
   screens are dated — the daily Contract board (`contracts.ts`'s dailySeed),
   the Skydeck's rules (`skydeck.ts`), and the FRONT DOOR's attract bay, which
   seeds itself `Date.now() ^ cycleIndex` on purpose (`attract.ts`:353). Before
   this the menu shot dealt a different demo bay on every run.
3. **Math.random is seeded** — `contracts.ts` leaves `rng` unseeded by design
   in two places a screen reaches.
4. **The stylesheet is frozen at a stated frame** before the shutter
   (harness.ts's `quiesce`): finite transitions finished, loops pinned to
   phase 0. Two runs used to catch the same modal at two points of its fade.
5. **The screen is entered through the App's own door.** A scene that needs a
   screen's entry work done — the leaderboard's board fetch — presses the
   App's `data-action` button rather than calling setState, and waits for the
   content (`waitFor`) instead of racing it.

Measured on this tree, two runs of the same command: BEFORE, 30 shots with 19
differing — whole screens, the leaderboard card at 22.75% of the frame and
maxΔ 218. AFTER, 33 shots with 24 byte-identical, every DOM screen among
them; the 9 that differ are gameplay scenes disagreeing only on the cannon
and the plant panel's frame, seven of them at maxΔ ≤ 6, and 31 of 33 pass at
`--tolerance=8`. What is left is the SPRITE BAKE, not the harness — see
RUNBOOK.md.

## What is where

- `beats.ts` — the beats (id, bay configuration, pilot, end condition, lead-in),
  the store SCENES, the SETUPS they are photographed on and the store SIZES.
  The one file to edit for a different shot.
- `verify.ts` — two capture runs compared pixel for pixel; the determinism
  claim's evidence, and the check to run after any redesign.
- `RUNBOOK.md` — the owner's session: commands, which store wants what, where
  to copy the keepers.
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

The sizes and what each store requires are in [RUNBOOK.md](./RUNBOOK.md); the
short version is Play 16:9 plus two tablet rows, the App Store's six landscape
device classes, and Steam's 1080p (the capsules are artwork, not screenshots —
only the main capsule's FRAME is rendered here, as something to compose over).

Each size states a CSS viewport per scene family and the DPR is derived, so
`px = css x dpr` exactly on both axes with an integer viewport — asserted in
`run.ts` before a page opens and pinned in `sim/systems.ts` so a bad row fails
in a second rather than eight minutes in.

The SETUPS are the different saves a screen is photographed on — `fresh` (a
new install), `ladder` (mid-ladder, the default), `contracts` (a board with
work against it), `rigged` (everything owned), `sealed` (every Mark sealed and
the roof open). The same Workshop on a starting rig and on a full one are two
different screenshots and only one of them sells the game.

The portrait row exists for completeness: the game is landscape-only and a
portrait viewport renders the rotate guard, so it is not a store shot.

## The hub redesign (#223)

`claude/double-gameplay-ux-refactor-rd54vn` rebuilds the hub. Nothing here
selects a screen by class name — scenes are AppState ids, `data-action`
presses and tower floors, which is what should make that survivable — but the
`menu` and `tier-hub` shots ARE the redesign and must be re-taken at every
size when it lands. A card-level scene is one `{ kind: "action", action: … }`
entry in `SCENES`. See RUNBOOK.md §4.
