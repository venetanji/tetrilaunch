# Who ends a bay: convergence, a held reset, and the Deep Run seal

**Date:** 2026-08-26
**Status:** designed, not implemented

## Why

A Tier 9 *Sorting Floor · Narrow Gauge* Contract was lost with the win sitting
on the floor. Read off the device at the game-over screen:

| Readout | Value |
|---|---|
| Lines | 3 / 4 |
| Shipments | 6 / 6 |
| Manifest | `I×3 L×1 J×1 Z×1` — 24 cubes = 4 × 6-cell lines, exact |
| Modal subtitle | "The manifest ran out before the goal did." |

That subtitle only renders when `cubesWasted === 0`, i.e. when
`cubesAvailable >= cubesRequired`. **Six live cubes were in the bay and six were
what the last line needed.** Not one cube had been lost. The goal was still
arithmetically reachable and the game called the bay anyway.

The cost is not one lost Contract. Getting down to an exact remainder on a
zero-waste bay takes planning and luck, and the payoff the mode promises is
watching the compactor close it out. Cutting that off is the mode failing at the
exact moment it is supposed to deliver.

## Root cause

`Game.update()`'s exact-inventory branch (`app/src/game/game.ts:1567`):

```ts
if (this.piecesUpStep === null) this.piecesUpStep = this.stepCount;
const waited = this.stepCount - this.piecesUpStep;
const strokeDone = this.lastFullAdvanceStep > this.piecesUpStep;
const done = this.objectiveUnreachable
  ? waited > UNREACHABLE_GRACE_STEPS
  : (strokeDone && this.cubes.every((c) => isAtRest(c.body))) ||
    waited > this.brokeGraceSteps;
```

The gate grants **exactly one** compactor full-advance. It was written as *"let
the last shipment land"* — and as that, it is correct. But on an exact-inventory
bay the last shipment landing is not the end of the play:

- A row clears only when every slot holds a cube that is at rest,
  `isAxisAligned`, and inside `X_TOL` / `Y_TOL` (`lineClear.ts`'s
  `updateLineClear`).
- What brings a near-miss cube inside those tolerances is `settleZoneCubes` —
  vibro-compaction, which grinds at `ANGLE_RATE` 0.02 rad/step and `X_RATE`
  0.5 px/step, and **only runs on pressing steps** (`game.ts:1431`).

So a row one grind short of square needs *another stroke*, and the gate ends the
bay before that stroke happens. The `waited > brokeGraceSteps` cap is no escape
either — it is `cycleSteps + 2s`, still about one stroke.

Measured: **one compactor cycle is 193.9 steps ≈ 3.23 s at Tier 9** (4.27 s at
Tier 1). Cycle length is span-independent, because `compactorSpeedFor` scales
the bar's speed with its span — Narrow Gauge's 6-cell line cycles at the same
rate as a stock 8-cell one.

### Why this is not a Contract-only bug

`piecesLeft <= 0` is the exact-inventory path, but the same one-stroke shape is
used by the launch-budget gate (`game.ts:1593`) and the clock gate
(`game.ts:1609`). A Deep Run bay whose final shot completes a row that has not
been ground square loses that row's payout the same way — and there it costs a
run, not a free retry.

### Two facts that shaped the fix

**The branch is already the narrow case.** `cubesAvailable` and `cubesRequired`
start equal on an exact-inventory bay and only ever move together (a clear drops
both by `lineCells`) or apart when a cube is *lost*. So `!objectiveUnreachable`
is identically "zero waste still intact". No extra "is this a whole number of
lines" test buys anything — the branch already is that test.

**Slow settling is ordinary, not exotic.** A bond breaking drops a piece into
loose cubes that fall and re-settle; that is a normal end to a normal bay, not a
pathological pile. Any rule that ends the bay on a timer will sometimes land in
the middle of it.

## Decisions

### 1. The bay ends when nothing is changing — not on a stroke count

A clock cannot tell "still settling" from "settled". Convergence can: sample the
field at each compactor full-advance, and end the window once a stroke passes
with no cube having moved measurably since the previous one. A pile still being
ground keeps the bay alive; a pile that has stopped responding to the press ends
it in about two strokes.

Rejected: "three strokes then end". It is a clock wearing a stroke's clothes —
it would have to be tuned against the slowest legitimate settle, and it makes
every dead bay wait the full three.

Rejected: gating on "is a row loosely full". It narrows to the case observed
here rather than to the case that is real, and a loose row scan can report a row
that physically cannot square (a cube resting on top of another indexes to the
same slot).

### 2. One helper, three call sites

`pieces`, `launches` and `time` all resolve overtime the same way today and get
the same convergence helper. Behaviour stays consistent across modes, and the
Deep Run version of this bug dies with the Contract one.

`objectiveUnreachable` keeps `UNREACHABLE_GRACE_STEPS` (~1 s) unchanged. That
branch is arithmetic, already decided; nothing that happens next can change the
answer, so there is nothing to converge toward.

`resolveWin` also shares the helper. It has the same one-stroke shape and the
same failure mode, with `WIN_SETTLE_MAX_STEPS` (4 s) as its cap.

### 3. The player gets an easier way out: hold the pause button

Convergence means a bay can legitimately run longer, so the player needs a
faster exit than pause → *Restart Bay* (two taps, through a modal).

**Tap ⏸ = pause, unchanged. Hold ⏸ ≈ 1 s = restart the bay.**

This is the second citizen of a pattern already in the game, not a new one. Bond
Breaker's triggers are held, not tapped: `BOND_HOLD_MS = 1000`,
`BOND_HOLD_SLOP = 24` (a thumb may wander 24 px before the hold cancels), a
charge meter filling the button from the bottom (`.bond-trigger--holding`,
`--bond-hold`). `main.ts:214` gives the reason, and it is exactly the reason
here: *a tap must not be able to spend one.*

Rejected: a dedicated ⟲ rail button. `layout.ts:82-88` records that budgeting an
8-slot rail "permanently priced the vertical rail off every 360dp-tall landscape
phone" — an 8-slot column at the 44 px floor needs 410 px. `RAIL_SLOTS_BASE` is
4 and a fully-drafted run already reaches 7. A new always-on slot spends exactly
the budget that note was written to protect.

The dispatch works out cleanly: `data-action` buttons act on **click**, while
`data-game` buttons act on **pointerdown**. So a completed hold can suppress the
click that follows, and a released-early hold simply lets the normal click
pause. No change to what a tap does.

### 4. A Deep Run completed without a single restart is sealed

A free restart is right for Contracts — they cost nothing and re-deal the
identical puzzle, so a held reset there is ordinary routine. In a Deep Run a
restart is a real concession: `restartBay()` leaves `this.run` untouched, so the
carry, the scrap and the drafted ratchets survive. That is what makes "cleared
it without ever restarting" worth marking.

The seal is per-Mark and lives on the tower floor for that tier — the badge in
the elevator. It is cosmetic by construction: it must never touch `mark`,
`salvage` or a loadout budget, because docs/DESIGN.md's rule is that nothing
purchasable may move the ladder, and a seal that paid out would be a second
progression axis.

## The shape of the change

### Convergence (`app/src/game/game.ts`)

A small private helper owns the sampling, so the three overtime branches and
`resolveWin` share one definition of "settled".

```
private fieldQuiet(): boolean
```

- Samples every cube's body position and angle at each full-advance tick
  (the tick `lastFullAdvanceStep` already records).
- On the next full advance, compares against the previous sample **by body id**,
  so a cube added or removed between strokes is not silently matched to another.
- Quiet = the maximum centre displacement is under `CONVERGED_EPS_PX` and the
  maximum angle change under `CONVERGED_EPS_RAD`, across all matched cubes.
- **Any line clear resets the window.** A clear is progress; the bay has earned
  more strokes, and on a Deep Run the score may now cross the target (the win
  test runs first, so a clear here can still win the bay).
- A cube count that changed between samples is also not quiet — something is
  still happening.

`CONVERGED_EPS_PX` and `CONVERGED_EPS_RAD` are **to be measured, not guessed**
(see Testing). The bracket they must separate: a cube under active
vibro-compaction moves at up to 0.5 px/step positionally and 0.02 rad/step
angularly, against a settled pile's contact jitter.

The absolute backstop stays, raised to fit the new window: a pile in permanent
contact-jitter must still resolve. Cap at `min(6 × cycleSteps, 30 s)` worth of
steps — the 30 s ceiling is the one `brokeGraceSteps` already uses, and for the
same reason (a degenerate `compactorSpeed` mutator must not make the window
effectively infinite).

### Held reset (`app/src/main.ts`, `screens.ts`, `app.css`)

`startBondHold` / `clearBondHold` / `onBondHoldMove` generalise into a hold
primitive taking `(el, pointerId, ms, onComplete)`; Bond Breaker becomes its
first caller and the pause button its second. Copying the machinery would leave
two hold implementations to keep in step, and the drift would show up as a
gesture that behaves differently on two buttons.

- `App.resetBay()` — accepts state `playing` or `paused`. `restartBay()` (the
  pause-modal path, `main.ts:2836`) delegates to it, keeping its own
  `state === "paused"` guard so neither entry point fires from the other's
  screen.
- On completion: a haptic, the reset, and the pending click suppressed.
- The hint strip (`hintStripHTML`) gains the gesture. It is rendered from live
  bindings, so this is a line of data, not a hardcoded string.
- CSS: no new rules. The charge meter is the existing `.bond-trigger--holding`
  treatment and `--bond-hold` property, now applied to both buttons — the class
  names the *treatment*, and renaming it would put a cosmetic churn in a
  bug-fix diff.

### Seal (`meta.ts`, `run.ts`, `main.ts`, `screens.ts`, `store.ts`)

- `RunState` gains `restarts: number`, seeded 0 in `newRun`, incremented by
  `resetBay()` when a Deep Run is live. Sandbox runs are excluded — Tier S files
  to its own board and earns no salvage, so it has no ladder to seal.
- `MetaState` gains `sealedMarks: number[]` — the Marks beaten with zero
  restarts. A list rather than a flag, because `mark` is a single high-water
  number and the tower draws every floor; each floor needs its own answer.
- `recordRunEnd(meta, runMark, won, bayReached)` takes the run's `restarts` and
  adds `runMark` to `sealedMarks` when the run was won with zero.
- `loadMeta()` merges over `newMeta()` defaults, so this is additive. It gets
  the same defensive read the other lists have — non-array or non-finite entries
  fail closed to `[]`, never to a free seal.
- `TowerState` gains `sealed: number[]`; `floorHTML` renders a seal mark on
  those floors. It must not disturb the 44 px floor arithmetic the tower's
  height budget depends on.

## Testing

`npm test` (`sim/systems.ts`) drives the real `Game` headlessly through
`sim/runner.ts`, so all of this is testable without a browser.

1. **A failing check first, at the reported case.** Build a pattern Contract
   level, run the bay to an empty manifest with one row's cubes present but not
   squared, and assert the bay is still `playing`. This must fail against
   today's code before anything is changed.
2. **Measure the epsilons.** Instrument per-stroke max displacement across a
   sweep of pattern bays, and read the two populations — actively-compacting
   versus settled — off real data. Record the numbers in the constant's comment,
   in the house style, so a later physics change shows up as a changed number
   rather than being absorbed invisibly.
3. **Convergence terminates.** A bay with cubes scattered so no row can complete
   must still end, and within ~2 strokes — the fix must not turn every loss into
   a 30 s wait.
4. **The backstop holds.** A pile kept in permanent jitter ends at the cap.
5. **Seal arithmetic.** `recordRunEnd` seals on a won run with 0 restarts and
   does not on 1; a corrupt `sealedMarks` loads as `[]`; a sealed Mark does not
   move `mark` or `salvage`.
6. **UI fit.** `npm run test:uifit` — the hint strip gains a line and the tower
   floors gain a mark; both are height-budgeted. Read the `new` count, not the
   total.

The held gesture itself is verified on-device over adb + CDP **by selector, not
by coordinate tap** — blind taps derived from a screenshot land on the wrong
control often enough to cost more time than they save. Forward the debug
WebView's devtools socket, drive `pointerdown` on `[data-action="pause"]`, hold
past the threshold, release, and read the resulting state back as a number.
The same route produced every device figure quoted in this document.

## Out of scope

- Any change to `SPARE_SHIPMENTS`. The manifest stays exact; this is about when
  the bay is judged, not how much slack it is given.
- Any change to the physics tolerances (`X_TOL`, `Y_TOL`, `SETTLE_*`). Loosening
  those would quietly change every other mode.
- Reworking the pause modal. `Restart Bay` stays exactly where it is; the hold
  is a faster route to the same call.
