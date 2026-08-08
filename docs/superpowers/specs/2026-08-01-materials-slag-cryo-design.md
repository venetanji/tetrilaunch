# Materials: slag and cryo

**Date:** 2026-08-01
**Status:** approved, shipped

## Why this, and why now

`level.ts`'s Mark calibration recorded a finding that made this the next thing
to build: **the Mark ladder's numeric knobs do not produce difficulty.** Three
sweeps over `MARK_TARGET_STEP` returned byte-identical win rates; cutting the
clock to 35% still gave 3/3 wins; scaling compactor speed was actively harmful
and is now pinned at 0. A fully-kitted rig trivializes the existing ladder, so
no multiplier on the ladder's own numbers grades it.

`docs/DESIGN.md` names the alternative: difficulty has to come from **content**
— tile types, in the match-3 sense. Nothing here is a new system, a new screen,
or a new verb. Each material is one rule about whether a cube can fill a line
slot.

Scope is **slag and cryo**, per DESIGN.md's build order (step 2, "starting with
slag and cryo") and the Shipaton scope line ("two materials"). Rebar, volatile,
tar and magnetic stay in the design table, unbuilt.

## Model

A material belongs to a whole **shipment**, not to individual cubes within one.
Per-cube mixing was rejected: the next-shipment preview and the pattern-Contract
tiler both reason about a piece as a single object, and a queue entry meaning "an
O, but two of its cubes are dead" is not something either could show or plan
around.

`Cube` gains two fields, both stamped at spawn:

- `material: Material` — `"standard" | "slag" | "cryo"`.
- `struck: boolean` — cryo's thawed flag. Per-cube rather than per-piece,
  because a cryo shipment shatters into loose cubes like any other and hitting
  one corner of a pile must not thaw a cube nothing has touched. Always `true`
  for materials that never need striking, so the line-clear test reads one
  boolean instead of re-deriving each material's rules.

`fillsSlots(cube)` in `lineClear.ts` is the single definition of "worth a slot",
and the tests assert against it directly.

## Slag

Occupies a slot, never counts. `updateLineClear` skips it as a candidate, so its
row reads as holed and cannot clear until the cube is demolished or shoved left
out of the zone. It is denial by **occupancy** — the row-scan learns no new rule.

Slag is the chocolate: no timer, no escalation, nothing to race. The answer is a
demolition charge, or eating the lost-piece penalty to push it out.

## Cryo

Two clauses, and the second is what stops it being a second slag.

1. **Will not compact until struck.** A cold cryo cube is not a slot candidate,
   so a row containing one is *not yet* winnable rather than *never* winnable.
2. **Pressed cold, it shatters the line.** `shatterColdCryo` runs on the
   advancing stroke only, before the clear check. The cube breaks, and its
   row-mates to the right take an impulse that knocks them off their slot
   centers.

Row-mates are **kicked, not teleported**. Both would break the alignment the
clear check needs, but a kick lets the physics resettle them into a genuinely
new arrangement that more pressing can recover; a teleport would be the game
rearranging the player's pile for them, and could drop two cubes into one slot.

### Striking is asymmetric, and that is the whole mechanic

A cryo cube thaws only when it is **already at rest** and something fast hits
it. Its own arrival never counts.

This was not the first implementation. The symmetric version — "any hard impact
involving a cryo cube thaws it" — was measured in a real bay and **every cryo
cube arrived pre-thawed**, because the landing impact of the shot that delivered
it cleared the threshold. The material did nothing at all.

With the asymmetry, cryo costs a shipment: land it, then spend a second shot
hitting it. That is the sequencing the design asks for, and it is also what
makes the cold-press failure reachable — the player who ignores the cube is the
one it punishes.

## Introduction schedule

`materialMixFor(bay, mark)` is a per-shipment probability, not a fixed count per
bay: the player must not be able to count slag off and conclude the rest of the
bay is clean, and the preview already tells them what is actually coming.

| material | first Mark | first bay | base | step/bay | cap |
|---|---|---|---|---|---|
| slag | 2 | 4 | 0.05 | +0.01 | 0.12 |
| cryo | 3 | 3 | 0.06 | +0.012 | 0.16 |

**Mark 1 is entirely clean**, at every bay. A player's first rung has to be the
game as it has always played, or the baseline they learn on is not the baseline.
Bay 1 is clean at every Mark, so a run always opens with a few shipments of
rhythm before the bay starts arguing.

Slag is rarer and capped lower than cryo for a reason that is not cosmetic:
**cryo is recoverable and slag is not**. A slag cube in the wrong slot costs a
charge or a penalty, so its rate is the one that can quietly make a bay
unwinnable.

Measured at bay 10 / Mark 10 over 6000 rolls: slag 0.1097 against a configured
0.11, cryo 0.146 against 0.144.

## Contracts get no materials — and that is a feasibility guarantee

`levelForContract` sets `materialMix` to `NO_MATERIALS` **explicitly**, not by
inheritance. Inheriting it is true only by accident (contracts build at Mark 1,
below every material's `firstMark`) and would silently stop being true the day a
Contract is generated at a Mark.

Both Contract kinds derive their limit from a model that assumes every launched
cube *can* reach a completed row: a pattern queue tiles the goal exactly, and
`launchesFor` prices a lines budget off cubes-needed ÷ efficiency. Slag
satisfies neither. Dropping it into either would reintroduce exactly the defect
class that once made **35% of generated Contracts unwinnable**.

Materials reach Contracts when the budget model accounts for them. DESIGN.md's
"in both pools" is therefore deferred, not dropped, and a test pins the
guarantee in the meantime.

## Readability

A material the player cannot identify at a glance is a trap rather than a
puzzle, so both of the ones that change what a cube is *worth* carry a colour
**and** a non-colour cue:

- **Slag** — matte grey-brown, and the only thing on the field that does not
  glow. Its interior is rubble hatching rather than the per-type pattern; it has
  no shipment identity left to advertise.
- **Cryo** — pale ice, with white frost needles over the type pattern (so a cryo
  O still reads as an O) and a *stronger* glow while frozen. The frost vanishes
  the instant it thaws, and that transition is the feedback that the strike
  landed.

The belt preview carries the material too. Cryo is only fair if you can sequence
around it before firing, and slag is only a decision if you know it is coming.

## Verification

33 new checks in `sim/systems.ts`, including the schedule gates and caps, the
ramp's monotonicity, preview-matches-delivery, stream determinism per seed, the
Contract exclusion across 27 generated Contracts, and the strike asymmetry.

The line-clear claims run through the **real** `updateLineClear` against
hand-placed rows rather than a reimplementation: a full standard row clears, the
same row with one slag cube does not, the same row with one cold cryo cube does
not, and it clears again once that cube is struck.

Renders confirmed by sampling the centre pixel of a cube of each material:
standard `#ffe500` (its own type colour), slag `#272436` (matte), cryo `#fcfeff`
(frost hub) with `struck: false`.

## Not done

- Materials in Contracts (see above — blocked on the budget model).
- The other four materials from the design table.
- No balance pass on device. The rates above are a first guess sized against
  what slag costs when it lands badly; only play settles whether the caps are
  right.
