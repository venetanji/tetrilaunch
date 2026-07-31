# Workshop: modifiers as the unlock tree

**Date:** 2026-07-31
**Status:** approved

## Problem

The Workshop runs dry. The tree is five unlocks totalling 360 salvage against
~43 salvage per decent Deep Run and 30/day from three tier-3 dailies, so it is
paid off in roughly ten runs plus a week of Contracts. A player at Mark 2 owns
everything and salvage accrues with nothing to spend it on.

Separately, the screen does not fit a landscape phone: measured at 792x360 it is
663px tall, because each of the five shop cards is 209px.

## Constraints that shape the answer

Two are non-negotiable and come from `meta.ts` itself:

1. **Unlocks add options, never free numeric power.** Every existing unlock
   either puts a modifier in the draft pool, front-loads a choice, or surfaces
   information.
2. **Contracts must never be the fastest route to a full tree.** Unlimited sells
   *uncapped dailies*. Inflating the tree while Contracts pay 30/day makes this
   worse, not better: the subscription would start buying power.

A Mark is the lever that resolves (2). It is raised only by beating the previous
one and nothing purchasable may touch it, so anything gated behind a Mark is
categorically unreachable by grinding.

## Design

### Modifiers become the tree

`ModDef.unlock` already exists and three of thirteen modifiers use it. Extending
it to the rest turns the modifier list into the unlock tree — 5 items becomes 11
— with no new gameplay systems invented.

Salvage buys a modifier **into the draft pool**, not onto the ship. The draft
survives: you are still dealt three offers and still choose. That is what keeps
the purchase an option rather than power, and keeps constraint (1) satisfied.

Four modifiers stay free forever so a new player's first run still has a
roguelite loop: **Overtime, Premium Contracts, Wide Bay, Rapid Loader** — the
plain tradeoffs, none of which define a build.

### The tree

| rank | unlock | cost | gate |
|------|--------|------|------|
| 1 | Demolition Licence | 45 | — |
| 1 | Bulk Freight Permit | 55 | — |
| 1 | Weather Survey | 60 | — |
| 1 | Scrap Cache | 70 | — |
| 2 | Micro Freight Licence | 90 | — |
| 2 | Reinforced Bonds | 110 | — |
| 2 | Ballast Contract | 120 | — |
| 2 | Press Overclock | 140 | — |
| 2 | Line Recalibration | 150 | — |
| 3 | Bond Breaker Rig | 260 | Mark 2 beaten |
| 3 | Autoloader Rig | 300 | Demolition + Micro, Mark 3 beaten |

Total 1400, up from 360. Rank 1 keeps its current prices: it is the on-ramp, and
the player who most needs a first option is the one with the least salvage.

Autoloader rises 130 → 300 and gains a Mark 3 gate. It is described in its own
copy as "the endgame of the micro build", and it now requires the micro unlock
it was already synergy-gated on.

### Mark gating

`UnlockDef` gains `requiresMark?: number`, checked against `meta.mark` (highest
Mark *beaten*). `unlockAvailable` takes the mark alongside the owned list.

This is the mechanism that enforces constraint (2). No quantity of salvage from
any source finishes the tree; the last two entries are earned in the exam.

### Screen

Eleven cards cannot fit 360px while showing descriptions, so the screen stops
trying to show everything at equal weight:

- **Owned unlocks collapse to a compact strip.** You are shopping; owned entries
  are reference, not merchandise. This also means the screen gets *shorter* as
  the player progresses rather than longer.
- **Purchasable cards compact** — tighter padding, clamped description, more
  columns — and are ordered by rank.
- The header's explanatory paragraph is dropped on short viewports.

## Testing

- Every modifier is either free-forever or reachable by buying its unlock.
- The four free modifiers are draftable with no unlocks owned.
- A Mark-gated unlock is unavailable below its Mark and available at or above it.
- Tree total and per-rank ordering (cost rises with rank).
- The Workshop fits 360px at every ownership state from nothing to everything.

## Rejected

- **Buy and equip modifiers directly, no draft.** Makes salvage buy power and
  turns Unlimited into a power subscription.
- **Multi-rank unlocks.** Breaks the stated "unlocks never stack" invariant and
  is where "options, not power" starts to slip.
- **Repricing the existing five only.** Creates grind with nothing new to buy,
  and hits new players hardest.
