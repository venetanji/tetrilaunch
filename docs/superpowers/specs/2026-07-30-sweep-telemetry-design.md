# Sweep telemetry: pile skew, row rejection, and residual motion

**Date:** 2026-07-30
**Status:** approved, not yet implemented

## Why

`sim/playtest.ts` answers what the bots can't measure about *the player*. This
extends the same instrument to what neither bots nor players can see directly:
**what the pile is physically doing between shots.**

The motivating number is 2.91 shots per line, measured on device. That figure has
two very different explanations and the current telemetry cannot tell them apart:

1. Rows regularly reach full but are **rejected by the clear gate**, so the
   player is paying for shots that produced a line the game refused to count.
2. Rows rarely reach full at all, so it's a coverage/aim problem and pile
   geometry is a red herring.

A row clears only if **both** gates pass in `game/lineClear.ts`: every cube
axis-aligned within `ANGLE_TOL` (0.2 rad ≈ 11°) **and** on a wall-anchored slot
centre within `X_TOL`/`Y_TOL` (0.3 × `CELL`). Two independent failure modes,
currently indistinguishable from the outside.

Two further hypotheses, both from playtest observation, are cheap to test at the
same time:

- **Weight aids alignment.** `pieces.ts` documents `densityMult` as "the lever
  that decides whether a build's own weight helps it: a heavy shipment lands
  hard enough to press the layers below it flat and square". Sizes are `tiny`
  0.7 / `std` 1.0 / `bulk` 1.35. This is asserted in a comment and tested
  nowhere.
- **Cubes never settle.** `Matter.Engine.create()` is called without
  `enableSleeping`, which Matter.js defaults to `false`, so bodies jitter
  indefinitely. `settleZoneCubes` only assists cubes that are already slow, so
  perpetual motion is a plausible *cause* of jamming rather than a cosmetic
  quirk. Note `SETTLE` is 3.2 px/step — a cube can be visibly wiggling and still
  count as at rest.

**This spec measures all of it and changes no game behaviour.** In particular it
does not enable sleeping: that would alter the physics the telemetry exists to
sample. If the data indicts sleeping, that is a separate change made against a
baseline.

## Scope

Recording granularity is **one record per press stroke** — the moment the bar
reaches its right stop and flips to retreat, when compaction has done everything
it is going to do that pass.

Cadence, from `level.ts` and `engine.ts`: the bar travels 160px each way at
1.2–1.65 px/step, so a round trip is ~4.4s at bay 1 and ~3.2s by bay 10 —
roughly **35–70 press strokes per bay**, 350–700 per 10-bay run. At ~350 bytes
per record that is ~25KB/bay, against a 41KB export for three bays today.

Plus one **full pile snapshot at bay end** (~2KB) so final geometry can be
re-analysed offline without re-instrumenting.

## Architecture

Five changes, no new subsystem.

| File | Change |
|---|---|
| `game/compactor.ts` | **No change** — `strokes` already exists (see below) |
| `game/lineClear.ts` | Extract the shared gate predicate; add `diagnoseRows()`; `settleZoneCubes` returns assist accounting |
| `game/game.ts` | Accumulate per-step assist stats; build and emit the record on stroke completion |
| `lib/telemetry.ts` | `sweep(rec)` → `BayRecord.sweeps`; `endBay` stores `finalPile` |
| `sim/playtest.ts` | New reporting section |

### Detecting stroke completion: use `Compactor.strokes`

The Contracts work (`9e6b2df`) added `Compactor.strokes`, incremented exactly
once per completed press — on the step the bar reaches `rightX` while `dir` is
still `+1`. That is precisely the signal this spec needs, so **`compactor.ts` is
not modified**: `game.ts` records the last value it saw and emits a
`SweepRecord` when it observes an increment.

This matters beyond convenience. Contracts are *budgeted* in strokes
(`level.ts`'s `strokeBudget`), so that counter is now load-bearing game logic.
Changing `update()`'s signature to report stroke completion would duplicate an
existing signal and risk disturbing the budget check.

It also raises the value of this telemetry: in a Contract the press stroke is
the scarce resource, so "what did the pile do on each stroke" is directly the
thing the player is spending.

### Contract vs Deep Run

`BayRecord` gains `mode: "run" | "contract"`. Contract bays have no clock, no
launch cost, and a stroke budget, so pooling their sweeps with Deep Run sweeps
would corrupt every aggregate — `sim/playtest.ts` must group by mode, and the
existing aim-time/economy sections must exclude Contract bays.

### The extraction is load-bearing

`updateLineClear` decides what actually clears. If the diagnostic re-implements
that test, the two drift and the telemetry starts lying about the exact thing it
was built to measure. Both must call one helper:

```ts
function cubeGateStatus(cube, grid): {
  angleOk: boolean; slotXOk: boolean; rowYOk: boolean;
  skew: number;      // rad from nearest axis-aligned orientation
  slotDx: number;    // px from nearest slot centre
  rowDy: number;     // px from nearest row centre
}
```

This is an extraction, not a rewrite. Clear behaviour is unchanged, and the
test below pins that.

## Data shape

```ts
interface SweepRecord {
  t: number;          // Game.elapsedMs at the right stop
  n: number;          // sweep index within the bay
  zoneCells: number;  // zone width at full advance
  // ALL cubes in the zone regardless of motion — not just resting ones.
  // restingFrac below is the share of these under SETTLE; defining zoneCubes
  // as "settled" would make that fraction circular.
  zoneCubes: number;
  joined: number;     // still bonded to a neighbour (unshattered)

  // Angular deviation from nearest axis-aligned orientation, radians
  skew: { mean: number; median: number; p90: number; max: number };
  alignedFrac: number;   // within ANGLE_TOL
  onSlotXFrac: number;   // within X_TOL of a slot centre
  onRowYFrac: number;    // within Y_TOL of a row centre

  // Residual motion — the "wiggle". restingFrac uses the same SETTLE
  // threshold the clear check uses, so "at rest" means the same thing here
  // as it does there.
  speed: { median: number; p90: number };
  restingFrac: number;

  // Rows geometrically full but not cleared. A cube can fail more than one
  // gate, so these counts are not mutually exclusive.
  blocked: {
    row: number;
    angle: number; slotX: number; rowY: number;
    worstSkew: number;
  }[];
  cleared: number;   // lines actually cleared during this stroke

  assist: {
    reached: number;        // cubes settleZoneCubes touched
    outOfReach: number;     // in zone, out of the assist's reach
    angleCorrected: number; // total radians applied this stroke
    tooTilted: number;      // skipped: beyond SETTLE_ANGLE_CAP
  };
}
```

`BayRecord` gains `sweeps: SweepRecord[]` and
`finalPile: { x: number; y: number; a: number; joined: boolean }[]`.

`blocked` is the payoff: it names the row, which gate rejected it, and how badly.

`tooTilted` deserves emphasis. `settleZoneCubes` only grinds cubes already
within `SETTLE_ANGLE_CAP` (0.65 rad) of aligned; a cube tipped past that is
**permanently** beyond the assist's help. A routinely non-zero `tooTilted` is a
finding about the tunable, not about the player.

## Cost and gating

Stats are O(cubes), computed once per ~250 physics steps — negligible.

One real trap: `recording()` reads `localStorage` on every call, and assist
accounting accumulates **per step**. `game.ts` must cache the flag once at bay
start and never call `recording()` inside the physics loop.

Everything stays behind the existing opt-in, so a shipped build pays nothing and
records nothing. The privacy note in `lib/telemetry.ts` continues to hold: this
is local-only, exported by hand, and must never phone home.

## Testing

Added to `sim/systems.ts`, which CI runs (and which already carries the
Contracts generator sweep, so these append rather than restructure):

1. A synthetic pile with known angles produces the expected `skew` statistics.
2. A full row tilted past `ANGLE_TOL` is reported in `blocked` with the angle
   gate failing, and does **not** clear.
3. A full, aligned, on-slot row clears and is **absent** from `blocked`.
4. Emitting a sweep record does not perturb `Compactor.strokes` — Contracts
   budget on that counter, so telemetry must be strictly an observer.

(3) is what proves the extracted predicate did not change clear behaviour.

Synthetic cubes must use `CUBE_DENSITY` so they stay physics-identical to real
ones — `sim/perf.ts` already establishes this convention.

## Reporting

`sim/playtest.ts` gains a section covering:

- **Rejection** — share of full rows rejected, split by gate. Distinguishes the
  two explanations of shots-per-line.
- **Skew trend** — mean/p90 across sweeps within a bay: does the pile converge
  toward order, or jam?
- **Weight** — skew and `alignedFrac` grouped by the bay's `pieceSize`. Tests
  the `densityMult` hypothesis directly.
- **Motion** — `restingFrac` and residual speed. Quantifies the wiggle, and
  shows whether never-resting cubes correlate with blocked rows.
- **Assist** — `angleCorrected` per stroke, and `tooTilted` as a share of the
  zone.

## Out of scope

- Enabling `enableSleeping`, or any physics tuning. Measure first.
- Changing `ANGLE_TOL`, `ANGLE_RATE`, or `SETTLE_ANGLE_CAP`.
- Any network transmission of telemetry.
- Per-cube dumps every sweep (2–5MB/run; `persist()` swallows quota errors
  silently, so this could fail invisibly mid-run).
