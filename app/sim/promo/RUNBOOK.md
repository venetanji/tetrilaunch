# Promo & store capture runbook — 1.0.6

Everything below runs on the owner's machine (macOS, `brew install ffmpeg`),
from `app/`, in one session. Nothing here writes into `store/` — the harness
only ever writes under `app/sim/results/promo*` (gitignored); copying the
keepers into `store/` is the one manual step, and it is deliberate.

## 0. Once

```sh
cd app
npm ci
npx playwright install chromium     # NOT needed on a box that already has it
ffmpeg -version                     # needed for the trailer only, never for shots
```

Without ffmpeg the store shots and the beat FRAMES still capture; only the
per-beat preview `.webm` and `promo:assemble --run` are skipped, and the run
says so ("no ffmpeg on this box: skipping the preview webm").

## 1. Store screenshots

```sh
npm run promo:shots                          # every store, every size
npm run promo:shots -- --store=play          # one store: play | appstore | steam
npm run promo -- --shots --store=appstore --store-size=2868x1320   # one size
npm run promo -- --shots --scene=leaderboard --store-size=2400x1350 # one shot
```

Output: `app/sim/results/promo/store/<store>/<size>/NN-<scene>.png`, plus
`app/sim/results/promo/store/manifest.json` — which records, per PNG, the
scene, the SETUP (which save it was shot on), the CSS viewport and DPR, the
App state the shutter actually found, and what the freeze had to settle. A
`--scene`/`--store-size` run MERGES into that manifest rather than replacing
it, so re-shooting one PNG does not invalidate the other eighty.

A full matrix is ten PNGs per size plus the six reference-only scenes on the two reference sizes — 140 for the App Store's fourteen rows alone. Budget half an hour: every scene gets its own
browser context and flies its own bay, which is 20–40 seconds a shot on a
quiet machine and considerably more on a busy one.

### The scenes

| # | scene | setup | what it is |
|---|---|---|---|
| 1 | `mid-bay-launch` | ladder | a launch being aimed, arc over a working pile |
| 2 | `line-clear` | ladder | the moment a row pays |
| 3 | `blast` | ladder | a Demolition charge going off in a live pile |
| 4 | `congestion` | ladder | the bay tipped past the second congestion tier, the crest red |
| 5 | `bond-chain` | ladder | the Bond Breaker shattering a rebar pile |
| 6 | `cryo-thaw` | ladder | frozen cargo, and the Thaw Lance on it |
| 7 | `materials-bay` | ladder | every cargo material on the belt and in the pile |
| 8 | `hazard-run` | ladder | Tier 8 under wind, a tighter clock and a sweeper |
| 9 | `tier-hub` | sealed | the #223 hub: tower sealed to the roof, car on the Skydeck |
| 10 | `menu` | ladder | front door: wordmark, play plate, attract bay |
| 11 | `workshop` | ladder | the rig shop mid-ladder |
| 12 | `contracts` | contracts | the Contract board with work logged |
| 13 | `leaderboard` | ladder | the all-time board, rows fetched |
| 14 | `stacked-bay` | ladder | a tall Mark 9 bay under wind and sweeps |
| 15 | `menu-fresh` | fresh | the front door of a new install (Flight School) |
| 16 | `workshop-full` | rigged | every system owned, every slot bought |

1–10 are shot at **every** size, gameplay first (the 1.0.6 owner's note:
"too many UI shots, not enough gameplay" — Apple caps a slot at ten). 11–16
are the boards and the setup studies, pinned to the two reference sizes (Play
`2400x1350`, Steam `1920x1080`); widen one by dropping its `only:` in
`beats.ts`.

Every gameplay scene that is ABOUT a moment (`blast`, `line-clear`,
`bond-chain`, `cryo-thaw`, `congestion`) names `settleFrames`, and those
frames are the whole settle: the shutter goes that many frames after the
engine's own event (an `explosion` of kind `bomb`, a `clear`, a `congestion`
of tier 2). The manifest records the plant crest's state classes (`hud`) and
the live cube count at the shutter, which is how a congestion shot is checked
— `plant--congest-danger` present — rather than by its colour.

The SETUPS (`beats.ts`) are the different saves: `ladder` (mid-ladder, the
default), `fresh` (a new install), `contracts` (a board with work against it),
`rigged` (everything owned), `sealed` (every Mark sealed, roof open).

### The rig each gameplay bay flies

One rig per rung, not one for all of them (the 1.0.6 owner's note: "show a
progression of systems, not all full, something believable from an in game
tier that is shown"). `RIG_T2` … `RIG_T8_REFIT` in `beats.ts`; the rack grows
four plates → ten across the set, and the pips fill in behind it:

| shot | tier | plates | pips | priced at |
|---|---|---|---|---|
| `line-clear` | 2 | 4 | 7 | 185 / 220 |
| `mid-bay-launch` | 3 | 5 | 9 | 240 / 330 |
| `congestion` | 5 | 6 | 11 | 295 / 550 |
| `bond-chain` | 6 | 7 | 13 | 350 / 660 |
| `cryo-thaw` | 6 | 7 | 13 | 350 / 660 |
| `blast` | 7 | 8 | 15 | 405 / 770 |
| `materials-bay` | 8 | 9 | 16 | 425 / 880 |
| `hazard-run` | 8 (bay 5) | 10 | 20 | 480 / 880 + a refit |

"Priced at" is `tiersCost` against `budgetForMark(tier)` (upgrades.ts, 110 ×
mark) — the test of whether a player at the tier the HUD prints could be
holding that rack. THE THIRD PIP IS NOT FOR SALE at bay 1: the Workshop sells
to `UPRATE_MAX_TIER` (2) and tier 3 is fitted at a refit stop, which opens
after bays 3, 6 and 9 (`isRefitBay`). `hazard-run` is the one bay flown past
bay 1 — at `bay: 5`, one refit behind it — and so the only rack in the set
with a full pip row. Its four ratchet notches were never honest at bay 1
anyway: each one is a between-bay draft.

Two knock-on retunes the smaller rigs forced, both in `beats.ts`:
`blast`'s till went 1000 → 500 (a bay-track-2 field is narrower, rows close
sooner, and the bay was WON at 29.6s with the pile still at 17 cubes, so the
charge never had a pile to go off in) and its cue went `PILE_FOR_BOMB` → 16
for the same reason. `mid-bay-launch` went 900 → 400 funds and 8s/12 cubes →
16s/22 cubes so the arc has a pile to be drawn over.

The narrower early bay also FIXED `line-clear`: at `FULL_RIG` the pile sat
flush against the right field edge and the SWEPT payout stamp landed outside
it at every phone size (five cues tried). At `RIG_T2` it is in frame.

### The sizes, and what each store requires

**Google Play** — 2 to 8 phone screenshots required; tablet screenshots are
required for the tablet listings.

| dir | upload as | required |
|---|---|---|
| `play/2400x1350` | phone screenshots (16:9) | yes — at least 2, use 5–8 |
| `play/1920x1200` | 7" tablet | for the tablet listing |
| `play/2560x1600` | 10" tablet | for the tablet listing |
| `play/1024x500` | feature graphic SOURCE | yes, but ship the artwork from `npm run store:graphics`, not this raw render |
| `play/1350x2400-portrait` | nothing | the game is landscape-only; this row renders the rotate guard and exists to prove it |

**App Store** — 6.9" and 6.5" iPhone plus the 13" iPad are the required sets;
Apple up-scales the rest.

THE APP STORE ROWS FILE THEMSELVES BY DEVICE, not by resolution: `--store-size=`
still takes the pixel size (that is the row's identity and cannot drift), but
the PNGs land under `appstore/iPhone/…` and `appstore/iPad/…` in folders named
for the slot App Store Connect actually offers, because the upload page is a
list of device classes and nobody should have to read a resolution off a folder
to drag a set onto it (`StoreSize.dir` in `beats.ts`; the resolution stays on
the tail because two slots can share the same inches).

| `--store-size=` | lands in | upload as | required |
|---|---|---|---|
| `2868x1320` | `appstore/iPhone/6.9-inch-2868x1320-required` | iPhone 6.9" | yes |
| `2688x1242` | `appstore/iPhone/6.5-inch-2688x1242-required` | iPhone 6.5" | yes |
| `2752x2064` | `appstore/iPad/13-inch-2752x2064-required` | iPad 13" | yes |
| `2796x1290` | `appstore/iPhone/6.7-inch-2796x1290` | iPhone 6.7" | optional |
| `2208x1242` | `appstore/iPhone/5.5-inch-2208x1242` | iPhone 5.5" | older listings only |
| `2732x2048` | `appstore/iPad/12.9-inch-2732x2048` | iPad 12.9" | optional |
| `2622x1206` | `appstore/iPhone/6.3-inch-2622x1206` | iPhone 6.3" (6.1"/6.3" slot) | optional — Apple scales the 6.9" set otherwise |
| `2532x1170` | `appstore/iPhone/6.1-inch-2532x1170` | iPhone 6.1" (5.4"/5.8"/6.1" slot) | optional — Apple scales the 6.9" set otherwise |
| `1334x750` | `appstore/iPhone/4.7-inch-1334x750` | iPhone 4.7" | optional — Apple scales the 6.9" set otherwise |
| `1136x640` | `appstore/iPhone/4-inch-1136x640` | iPhone 4" | optional — Apple scales the 6.9" set otherwise |
| `960x640` | `appstore/iPhone/3.5-inch-960x640` | iPhone 3.5" (3:2) | optional — Apple scales the 6.9" set otherwise |
| `2420x1668` | `appstore/iPad/11-inch-2420x1668` | iPad 11" (8.3"/11" slot) | optional — Apple scales the 13" set otherwise |
| `2224x1668` | `appstore/iPad/10.5-inch-2224x1668` | iPad 10.5" | optional — Apple scales the 13" set otherwise |
| `2048x1536` | `appstore/iPad/9.7-inch-2048x1536` | iPad 9.7" (4:3) | optional — Apple scales the 13" set otherwise |

**Steam** (docs/steam-store-and-achievements-plan.md §1b)

| dir | upload as | required |
|---|---|---|
| `steam/1920x1080` | store screenshots | yes — 5 minimum, real gameplay |
| `steam/616x353` | main-capsule FRAME | source only: the shipped capsule is artwork with the logo over it |

The other Steam assets (header 460x215, small 231x87, vertical 374x448,
library 600x900, hero 3840x1240, background 1438x810) are artwork, not
screenshots — they come from `app/resources/` via `scripts/store-graphics.mjs`.

### Dropping shots into the repo

```sh
cp sim/results/promo/store/play/2400x1350/0*.png        ../store/play/screenshots-16x9/
cp "sim/results/promo/store/appstore/iPhone/6.9-inch-2868x1320-required"/0*.png ../store/appstore/screenshots-6.9/
```

Look at every PNG before it goes in. `store/` is committed art; the harness
must never write there directly, and this runbook is the only path in.

## 2. Proving a shot is reproducible

```sh
npm run promo:shots -- --out=sim/results/promo-A
npm run promo:shots -- --out=sim/results/promo-B
npm run promo:verify -- --a=sim/results/promo-A/store --b=sim/results/promo-B/store \
                        --diff=sim/results/promo-diff
```

Exit 0 means every PNG is byte-identical. A failure prints, per file, the
differing pixel count, the largest channel delta and the bounding box —
a bbox over the HUD's clock is a timer that moved, a bbox over the whole
field is a bay that was dealt differently, a bbox over one panel is a screen
that had not finished painting. `--diff` writes a red-over-grey image of each
disagreement to look at.

What to expect, measured on this tree (33 shots across Play 16:9, the 6.9"
iPhone and Steam 1080p, two runs of the same command):

- **24 of 33 byte-identical**, including every DOM screen at every size —
  menu, tier-hub, Workshop, Contracts, leaderboard, menu-fresh,
  workshop-full. Those are the shots a listing is mostly built from.
- The 9 that differ are all GAMEPLAY scenes, and every one of them differs
  only inside the cannon and the plant panel's frame — the two things
  render.ts stamps from baked glow sprites. Seven are at maxΔ ≤ 6 on ≤ 0.08%
  of the frame (invisible); the two `line-clear` shots reach maxΔ 38 on
  0.018%. The HUD's numbers are identical in all of them, so the bay is in
  the same state and it is the BAKE that moved: `trimToInk` crops a fresh
  bake to its inked pixels and records the scale from the crop, so a blur
  whose outermost alpha rounds differently crops a pixel differently and
  every stamp of that sprite lands a fraction of a pixel off.
- `--tolerance=8` passes 31 of 33. Use it for gameplay scenes until the bake
  is made exact in render.ts.

For comparison, before this harness was made deterministic the same check on
30 shots reported 19 differing, with whole screens — the leaderboard card at
22.75% of the frame, maxΔ 218 — rather than glow edges.

Determinism holds **on one machine**. Across machines the fonts, the GPU and
the Chromium build can all move a subpixel, so `--tolerance=N` exists; the
capture box is the source of truth, not the diff between two boxes.

If a scene will not capture at all, the run says so and carries on: a screen
with nothing moving on it can leave Chromium's compositor with no dirty
region and `captureScreenshot` then never answers. The scene is retaken in a
fresh page up to `--tries=3` times; anything still missing is named at the
end and the run exits non-zero, so a half-captured directory cannot pass for
a finished one. Re-shoot just those with `--scene=` and `--store-size=`.

## 3. Trailer beats

```sh
npm run promo:beats                                   # every beat, edit order
npm run promo -- --beat=plan --beat=precision         # two of them
npm run promo -- --beat=luck --seeds=8 --no-webm      # a quick look, no preview
npm run promo -- --all --fps=60 --size=1920x1080
```

Each beat writes `sim/results/promo/<beat>/frames/%06d.png`, `beat.json` (the
config, the seed, the frame count and the frame index of every notable event)
and `contact.png` (every 30th frame, tiled — look at this first). With an
ffmpeg present it also writes `<beat>.webm`, a preview only: the cut is made
from the PNGs.

```sh
npm run promo:assemble                 # dry run: prints and writes mux.sh
npm run promo:assemble -- --run        # needs a full ffmpeg (x264, aac, drawtext)
npm run promo:assemble -- --run --vertical   # adds the 9:16 crop
```

## 4. After #223 (the hub redesign) merges

*Done on the 1.0.6 store tree:* the Leaderboard button and the tower now live
on the hub (`AppState` `"tiers"`), not the front door, so `leaderboard` and
`tier-hub` carry `from: "tiers"` in `beats.ts` — the `tower` show kind gained a
`from` for it. Without that, `leaderboard` cannot find its button and
`tier-hub` quietly photographs the front door (pickTier is a no-op on a screen
with no shaft).


`claude/double-gameplay-ux-refactor-rd54vn` rebuilds the hub around a legend
Unlock button and run / Contract / Workshop cards. The harness selects screens
by AppState id, by `data-action` and by tower floor — never by class name — so
nothing should break. Two jobs on the day it lands:

1. **Re-shoot `menu` and `tier-hub` at every size.** They are the redesign.
2. **Add a card-level scene** if the new cards deserve their own shot: a new
   entry in `SCENES` (`beats.ts`) of the form

   ```ts
   { id: "hub-unlock", family: "menu",
     show: { kind: "action", action: "<the card's data-action>", from: "menu", warmSec: 1 } }
   ```

   `kind: "action"` presses the App's own button, so the screen runs its real
   entry path (which is how the leaderboard's rows get fetched at all).

Run `npm run promo:verify` after, against a fresh pair of runs: a redesign
that reintroduces an unseeded animation shows up there and nowhere else.

## 5. What makes a shot reproducible (so it stays that way)

- The page clock starts at 0 and moves only when the driver ticks it.
- `Date` is `PROMO_EPOCH` (2026-03-14 UTC) plus the virtual clock, and the
  context is pinned to UTC / en-US. The dated screens — the daily Contract
  board, the Skydeck's rules, the front door's attract bay — all read from it.
  **Changing the epoch re-deals the Contract board and the Skydeck**, so every
  store shot has to be re-taken and re-approved after such a change.
- `Math.random` is a fixed-seed mulberry32 (Contract beds and briefings
  default to an unseeded `rng` in `src/game/contracts.ts`).
- Fonts are force-loaded before the first frame, never awaited on a page timer.
- Every CSS transition is finished and every looping animation pinned to phase
  0 immediately before the shutter.
- The App state is read back after the shot and written into the manifest, so
  a scene that quietly photographs the wrong screen is caught.
