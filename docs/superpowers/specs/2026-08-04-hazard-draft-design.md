# The hazard draft, and the four late materials

**Date:** 2026-08-04
**Status:** built on branch `claude/system-design-review-58ay1b`.
**Superseded in part (2026-08-24) by the tier ladder** — see `docs/ECONOMY.md`
and `level.ts`'s tier-ladder note. The ratchet, its notch sizes and everything
below about the draft still stand; what changed is the sentence "a Mark no
longer moves any number on the ladder". A Mark now states the bay's opening
terms (target, clock, launch cost) on an explicit per-tier curve, once at run
start, instead of a per-bay ramp nobody could read. Per-bay auto-scaling did
NOT come back: only the target steps per bay, by an amount the tier sets.
Sub-projects 2 and 3 of `2026-08-02-systems-and-hazards-design.md`, which is the
architecture this document implements. Phase 1 (the systems layer) shipped on
`systems-layer`.

---

## What phase 2 changed

**The between-bay draft stopped dealing modifier cards and started asking which
difficulty axis hardens.** The player picks one axis, it moves one notch, and it
stays moved for the rest of the run. There is no skip.

`makeBaseLevel` stops auto-scaling the three base axes at the same time. This is
the half that makes the ratchet mean anything — if the ladder kept hardening on
its own, a notch would be a rounding error on top of it.

| axis | before | after |
|---|---|---|
| `targetScore` | `800 + 150*i` | flat 800; **+300 per notch** |
| `launchCost` | `25 + 2*i` | flat 25; **+5 per notch** |
| `timeLimitSec` | `150 + 10*i` (relief) | flat 150; **−20s per notch**, floored at 45 |
| `MARK_TARGET_STEP` | 0.18 | **0** |

That last row is the one with a measurement behind it. `level.ts`'s calibration
note already recorded that three sweeps over the step returned byte-identical
win rates, that cutting bay 10's clock to 35% still gave 3/3 wins, and that
compactor-speed scaling was harmful enough to be pinned at 0. Target is a
*duration* knob, not a difficulty one: raise it and a competent player simply
plays longer. A ramp nobody can lose to is just a longer bay.

So a Mark no longer moves any number on the ladder. It is a statement about
**which hazards and systems exist**, and nothing else.

### The ladder

| Mark | axis it opens |
|---|---|
| 1 | quota · fuel levy · shift cut (the three base numbers together) |
| 2 | crosswind |
| 3 | sweeper (faster press, tighter bay) |
| 4 | slag |
| 5 | cryo |
| 6 | rebar |
| 7 | volatile |
| 8 | tar |
| 9 | magnetic |
| 10 | capstone — no new axis; **two** ratchets per bay |

Mark 1 opens three at once because a first rung offering one card is not a
draft. Every rung from 2 to 9 adds exactly one axis, which is asserted rather
than assumed — the ladder currently cannot claim a single no-op rung.

### Two rails the model needed and did not have

**`MIX_TOTAL_CAP`.** A per-material cap is not enough once six content axes
exist: 6 × 0.32 sums to 1.92, and the material roll is a *cumulative walk*, so
past 1.0 the later materials can never come up at all while the earlier ones
silently swallow the entire belt. Worse, "every shipment is a hazard" is not a
hard bay — it is an unplayable one, because the player needs cargo to build rows
out of. The mix is scaled down proportionally to 0.55 rather than clipped per
material, so a run that ratcheted slag three times and cryo once still faces
mostly slag.

**Floors on the clock and the open-cell count.** An axis that can reach an
unplayable bay is a lose button, not a knob, and the player taking the notch has
no way to know which one was the last survivable. The clock floors at 45s and
the bay never narrows below `compactorMinLineCells` — below that it cannot
physically hold a sellable row and no amount of play fixes it.

### The size-normalization bug

The spec found this and it is fixed here. The material roll is per **shipment**
while the cost is per **cube**, and cube count is 2/4/5 by size class — so at an
identical rate a Bulk shipment ate 2.5× the dead cargo of a Micro one. Bulk also
has the 1.6 `breakMult` that makes it hardest to disperse, and it already pays
+50% launch cost for its upside. That was an unpriced second tax on exactly the
build least able to absorb it.

The roll is now scaled by `std.cubes / own.cubes`, equalizing dead cubes per
**launch** — the unit the player actually spends. A Micro shipment is therefore
slag more *often* and a Bulk one less often, and both lose the same cargo per
shot. A check holds the three sizes within 0.12 cubes of each other over 4000
launches.

---

## What phase 3 changed

The four materials that had one line of design each in `DESIGN.md`'s table now
have rules. Each is a rule about how a cube interacts with the line-clear check
— none adds a system, a screen, or a new player verb, which is the constraint
the whole material vocabulary is built under.

| material | rule | the answer |
|---|---|---|
| **rebar** | joints never break, at any stretch | Bond Emitter — a Bond Breaker is the only thing that splits it |
| **volatile** | detonates on a hard landing, taking neighbours | a soft landing (`settleAssist`, raised by Press Hydraulics), or a deliberate chain |
| **tar** | welds permanently on contact; a Bond Breaker will not split the weld | avoidance; Demolition is the expensive answer |
| **magnetic** | snaps itself square once at rest | none, deliberately |

**Rebar and tar are deliberate inverses.** Rebar is rigid but breakable — a
Bond Breaker splits it, which finally gives that track a job beyond tidying a
messy pile. Tar is the joint that cannot be broken at all. Reading them as a
pair is what stops the second one being a re-skin of the first.

**Volatile is the only material whose cost is paid by cubes that were already
safely down**, so it scales with how full the bay is rather than with the
shipment itself. Its trigger sits above cryo's strike speed on purpose: the
landing that thaws ice must not also set off a bomb, or volatile stops being a
landing the player can control. It pays **no salvage** — that is the whole
difference between it and a demolition charge. A bomb is a tool the player aimed
at a dead pile; a detonation is a hazard that went off. Paying for it would make
ratcheting the volatile axis an income strategy.

**Magnetic gets no counter, and that is the point.** Cryo is the existing proof
that not every material needs a system: it teaches that a hazard is something
you absorb by playing well rather than by shopping. Magnetic is the other half
of that lesson — the helpful blocker, the reason the vocabulary is not uniformly
hostile. Giving a tool to a material that is already doing you a favour would
delete the only rung on the ladder that teaches a hazard can be welcome.

### Where welds live

A tar weld goes into `Game.constraints` behind a `welded` flag rather than into
a list of its own. That is not a style choice. Every path that destroys a cube —
a line clearing, a demolition charge, a cryo shatter — already calls
`removeConstraintsFor` against that list, and a weld kept outside it would
outlive its own cube and leave matter solving a constraint against a body no
longer in the world. `updateBreakableJoints` and `useBondBreaker` skip the flag
instead, and `useBondBreaker` counts only breakable joints so a field held
together entirely by tar cannot silently eat a charge.

---

## Known incomplete

**The cards did not unbundle.** The architecture calls for the 12 modifiers to
split into hazard halves (axes) and capability halves (systems), with `demo` and
`bond-breaker` becoming systems outright. That has not happened. `MODS` and
`UNLOCKS` are still in the tree, still priced, still purchasable in the
Workshop's Options tab — and nothing draws from them any more, because the draft
that used to deal them is gone.

This was a deliberate call, taken with the numbers visible, and it leaves the
Options half of the Workshop as dead content until the unbundling lands. The
alternative considered was running the ratchet and the mod draft side by side so
nothing went dark; it was rejected as the spec's stated end state is that the
draft offers axes.

**The notch sizes are unplayed.** +300 target / +$5 cost / −20s clock are sized
by arithmetic against the curve they replace: two of three base axes used to
harden every bay, so ~18 axis-steps across a run against the ratchet's 9, making
a notch about double a per-bay step. The architecture already names this as the
single most likely thing to need a play pass, and nothing here changes that.

**Marks 6-9 have no counter systems of their own.** Rebar, volatile and tar are
answered by tracks that already exist (Bond Emitter, Press Hydraulics,
Demolition Rack) rather than by new ones. Whether those answers are *good enough*
to make the notch worth taking is a play question, not a code one.
