# Pattern Contracts: exact-inventory puzzles

**Date:** 2026-07-31
**Status:** implemented, with two departures — see [As built](#as-built) at the
foot of this file.

## Why

Today's Contract is "clear N lines, you have M launches" — a budgeted version of
the same thing Deep Run asks for. A **pattern Contract** is a different question:
here is an exact set of shipments that tiles the goal perfectly, land them.

That makes the piece queue a designed object rather than a random stream, and it
turns a Contract into a planning problem instead of a physics grind. It also
gives Contracts an identity Deep Run cannot copy, since Deep Run's queue must
stay random for its own reasons.

## The shape

A line spans `CUBES_PER_LINE` (8) cubes at full compactor advance, so:

| Goal | Cubes | An exact set |
|---|---|---|
| 2 lines | 16 | one O + three I |
| 3 lines | 24 | two O + four I |

(Note the arithmetic differs from classic Tetris, whose 10-wide line makes 2
lines = 20 cubes. Here it is 8.)

The generator picks a multiset of pieces whose cube count is **exactly**
`goal * CUBES_PER_LINE`.

## Decisions

**1. Truly exact — zero waste.** The queue is precisely the cubes needed. One
piece off the side, or one shatter that strands a cube, ends the attempt.

This was taken with the counter-evidence on the table: measured efficiency is
**0.62 (browser) / 0.69 (phone)**, so about a third of fired cubes currently
never reach a completed line. Zero waste asks for roughly **1.5x better than
anyone has yet played**, in a sandbox where the compactor shatters pieces and
`settleZoneCubes` cannot un-tip a cube past `SETTLE_ANGLE_CAP`. Retries are
free, so the cost of failure is low — but this WILL be hard, and if playtesting
shows it is merely tedious rather than satisfying, the fix is a spare piece, not
a nudge to the tolerances.

**2. Known set, random order.** The card shows exactly which pieces you get, not
when. You can plan what goes where without the sequence being solved for you.

**3. The set is seeded; the ORDER is re-rolled every attempt.** This is the
non-obvious one, and it exists to prevent a specific catastrophic failure.

Contracts regenerate identically from their id — that is what makes a daily
board shared and a per-Contract leaderboard meaningful. If the order were seeded
too, then **one unlucky permutation would make that Contract permanently
unwinnable for every player**, and free retries would hand back the identical
bad order forever. That is the same defect class as the launch budgets that were
35% infeasible, and it is not detectable without solving the physics.

Re-rolling the order per attempt keeps the puzzle shared (everyone gets the same
*set*) while guaranteeing no permutation is a permanent wall. It costs
determinism the leaderboard does not need: the set defines the challenge.

## Generation

```
cubesNeeded = goal * CUBES_PER_LINE
```

Choose a multiset from the tier's available piece types summing exactly to
`cubesNeeded`. Constraints:

- **Solvable by construction on paper.** With 8-wide lines and 4-cube
  tetrominoes, any multiset summing to a multiple of 8 can tile flat rows —
  but only if the pieces can be *oriented* to do so. The generator must build
  from a known-tiling template rather than a random sum, or it will emit sets
  that are arithmetically exact and geometrically impossible.
- **Piece variety scales with tier.** Low tiers draw from O and I (the two
  easiest to place flat); higher tiers admit S/Z/T/L/J, which cannot tile a row
  alone and force interlocking.
- **No wind at any tier.** A zero-waste objective plus a lateral force the
  player cannot fully cancel is not a puzzle, it is a dice roll. Pattern
  Contracts set `windMax = 0` regardless of the difficulty budget, which also
  means the difficulty budget must not spend on wind for this objective kind.

## Objective and failure

`ObjectiveKind` gains `"pattern"`. The bay is won on `objectiveLines` as today.
It is lost when the queue is exhausted and the goal is unmet — there is no
launch budget, because the queue **is** the budget.

`LossReason` gains `"pieces"` ("Out of shipments"), distinct from `"launches"`.

The last piece is still airborne when the queue empties, so exhaustion uses the
same settle gate the launch budget uses — a completed press plus a field at rest
— or the winning shot would lose the bay.

## UI

- The Contract card lists the exact set, e.g. **`◻ x1  ▬ x3 -> 2 lines`**.
- The HUD replaces the launches readout with **shipments remaining**, and shows
  the full remaining multiset rather than only the next two, since planning
  against the whole set is the point.
- The end screen states the set and what was wasted, because "you lost by one
  cube" is the feedback that makes a retry interesting.

## Testing

- Generated sets sum to exactly `goal * CUBES_PER_LINE`, across all tiers and
  many seeds.
- Every generated set is drawn from a tiling template, so a flat solution
  provably exists.
- The set is stable for a given Contract id; the order is not.
- Pattern Contracts always have `windMax === 0`.
- A pattern Contract has no launch budget, and a launch-budget Contract has no
  pattern — the two objective kinds do not compose.

## Risks

**This may simply be too hard**, and the spec should not pretend otherwise. The
efficiency gap above is the honest measure of it. The cheapest way to find out
is to build the generator and play three of them; the cheapest fix, if it is
grim, is a single spare piece — which changes one constant, not the design.

The sweep telemetry spec would answer *why* a failed attempt failed (a shatter,
a tip past the assist's reach, or a cube off the side), which is the difference
between "tune the tolerance" and "add a spare".

## Out of scope

- Authored (hand-designed) patterns. Generated only, for the same content-
  treadmill reason `contracts.ts` already records.
- Non-line objectives (deliver a crate, clear all slag).
- Changing Deep Run's queue, which stays random.

## As built

Everything above holds except where noted here.

**The tiling template was dropped, because the premise was wrong for this game.**
The spec requires generating from a known-tiling template or risk sets that are
"arithmetically exact and geometrically impossible". That is the right worry for
a tetromino puzzle where pieces keep their shape — but here they don't:
`pieces.ts`'s `breakJointsInBand` shatters whatever the compactor presses, and
`lineClear.ts` fills a row slot-by-slot from *loose* cubes. So no multiset
summing to `goal * CUBES_PER_LINE` can be geometrically impossible. Only delivery
can fail. The tier pool (I/O → +L/J → all seven) survives, because piece type
still decides how hard delivery is — which is what it was really scaling.

**Piece size is std-only, on arithmetic rather than taste.** A queue is exact
only if `goal * 8` divides by the piece's cube count. 4 always does; bulk's 5
only does at goals that are multiples of 5, making the smallest legal bulk
pattern 40 cubes. Micro divides fine but is the size playtesting already found
tedious, and tedium is the failure mode a zero-waste objective sits nearest to.

**Added, not in the spec: provable-infeasibility detection.** With an exact
manifest, one lost cube ends the attempt *immediately* — but nothing said so, and
the player would keep firing a bay that could not be won. `Game.objectiveUnreachable`
compares available cubes (field, minus those already blinking out, plus the
queue) against what the unmet lines still demand, and calls the bay about a
second later — long enough to watch the cube that killed it blink out. It is
monotone by construction, so it cannot flicker: a line clear drops both sides by
the same 8. This is what makes the spec's own "you lost by one cube is the
feedback that makes a retry interesting" actually reach the player, and what
makes free retries a fast loop rather than a slow one.

The spec's other UI notes are built as written: the card lists the exact set, the
HUD shows the full remaining multiset rather than a count, and the end screen
names the margin. The order is re-rolled per attempt via an unseeded default
`rng` argument on `levelForContract`, with the seeded path kept for tests.

**Still unmeasured:** whether zero waste is achievable in practice. The 0.62/0.69
efficiency gap the spec flags is unchanged, and nobody has yet cleared a pattern
Contract by hand. `SPARE_SHIPMENTS` is the constant that answers it.
