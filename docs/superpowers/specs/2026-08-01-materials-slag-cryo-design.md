# Materials: slag and cryo

**Date:** 2026-08-01
**Status:** approved, shipped
**Superseded in part (2026-08-24) by the hazard draft** (`hazards.ts`,
`docs/superpowers/specs/2026-08-04-hazard-draft-design.md`): the introduction
SCHEDULE below is retired — `materialMixFor` is gone, and a material now reaches
the belt only where the player ratchets its content axis — and Contracts ship one
priced material rather than none. The materials themselves stand, and so does
everything below about what a slag or a cryo cube DOES.

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

## Introduction schedule — RETIRED (2026-08-24)

**This section shipped on 2026-08-01 and has since been retired whole.**
`materialMixFor(bay, mark)` was a per-shipment probability ramp — slag from
Mark 2, cryo from Mark 3, each with a base rate, a per-bay step and a cap — and
it was a probability rather than a fixed count per bay so the player could not
count slag off and conclude the rest of the bay was clean. The function is gone;
`level.ts` keeps a RETIRED note where it stood. Every bay now ships
`NO_MATERIALS`, and a material reaches the belt only when the player ratchets
its content axis in the between-bay draft.

The reason is the design's rather than a refactor's. Under a schedule the ladder
inflicted a material on a player who might own no answer to it — which is the
same bug the hazard draft was built to fix, in its other half. Now the material
and the decision to face it are the same act, and the Workshop system that
answers it is the reason a player would take that notch at all.

What replaced the ramp is `hazards.ts`. A ratcheted axis ships its material at
`materialRate(notches)`: 0.07 at the first notch, +0.05 for each one after,
capped per material at 0.32 (`MATERIAL_CAP`). The combined mix is then scaled
DOWN proportionally if it would pass `MIX_TOTAL_CAP` (0.55), so a clear majority
of shipments stay standard even at maximum ratchet and the player's relative
emphasis survives the clamp. Mark gating did not disappear with the schedule, it
moved to the ladder's rungs: **cryo 4, rebar 5, slag 6, volatile 7, tar 8,
magnetic 9**.

Two of this section's claims outlived the mechanism that made them true.
**Mark 1 is still entirely clean**, because the first content axis is four rungs
up the ladder — a player's first rung has to be the game as it has always
played, or the baseline they learn on is not the baseline. And **bay 1 is still
clean at every Mark**, now because a run opens with no notches at all
(`newRun`'s empty `ratchets`) rather than because a schedule said so, so a run
still opens with a few shipments of rhythm before the bay starts arguing.

The ordering reason also outlived it, and got sharper: **cryo is recoverable and
slag is not**. A slag cube in the wrong slot costs a charge or a penalty, so its
rate is the one that can quietly make a bay unwinnable. Under the schedule that
bought slag a lower rate and a lower cap than cryo; under the ratchet it buys
slag two rungs of delay, so it arrives behind the materials a bare-handed player
can survive (playtest call, 2026-08-08).

## Contracts ship exactly one material, priced into the budget

**Updated 2026-08-24.** As written, this section said Contracts get no materials
at all and that the feasibility guarantee depended on it. Half of that survives.

`levelForContract` still sets `materialMix` to `NO_MATERIALS` **explicitly**,
not by inheritance, and for exactly the reason given here: inheriting a clean mix
is true only by accident (contracts build at Mark 1, below every material's rung)
and would silently stop being true the day a Contract is generated at a Mark.
What changed is the line immediately after it — the Contract's own material is
then written back in, at the rate its launch budget was computed against.

Both Contract kinds still derive their limit from a model that assumes every
launched cube *can* reach a completed row: a pattern queue tiles the goal
exactly, and `launchesFor` prices a lines budget off cubes-needed ÷ efficiency.
The guarantee is now kept by PRICING the material instead of banning it.
`contractEfficiency` discounts the planning efficiency by that material's
expected waste (`MATERIAL_WASTE`), and `sim/systems.ts` asserts feasibility
against the same function the generator priced with — the whole guarantee is
that these are one formula, not two copies.

**Slag is the exception, and it is structural rather than policy.** A slag cube
can never count toward a line (`theme.ts`'s `countsForLines`), so no budget
priced on "cubes that can reach a row" can be honest about it — which is why
`ContractMaterial` is `Exclude<Material, "standard" | "slag">` and the exclusion
lives in the type. Dropping it into either kind would reintroduce exactly the
defect class that once made **35% of generated Contracts unwinnable**.

Pattern Contracts are narrower still. Their belt carries the material at rate 1
rather than as a per-shipment roll — a variant that ships rebar ships rebar, and
a probability would make "nothing shatters" true of only most of the bay, which
is a different and much worse promise than the card's — so only **rebar and
magnetic** are eligible there; the other four would un-prove the tiling.

DESIGN.md's "in both pools" is therefore delivered rather than deferred, for
every material whose cubes can count.

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
