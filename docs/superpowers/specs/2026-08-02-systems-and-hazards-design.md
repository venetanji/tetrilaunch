# Systems and hazards: the Mark ladder as a tool ladder

**Date:** 2026-08-02
**Status:** approved (architecture) — **sub-project 1 (systems layer) shipped**
on branch `systems-layer`; the hazard draft and material counters are unbuilt.
**Superseded in part (2026-08-24) by the tier ladder** (`docs/ECONOMY.md`,
`level.ts`): "a Mark's numbers stop moving" no longer holds. A Mark states the
bay's opening terms — target, clock and launch cost — on an explicit per-tier
curve set once at run start. What this document says about the ratchet stands:
higher Marks still add axes rather than steepening notches, and the notch sizes
are the same at every Mark.
See `docs/superpowers/plans/2026-08-02-systems-layer.md` for what phase 1
actually landed, including three departures from this document's numbers.

## Why this

Two findings collide here, one old and one from tonight's play session.

**The old one.** `level.ts` records that the Mark ladder's numeric knobs do not
produce difficulty: three sweeps over `MARK_TARGET_STEP` returned byte-identical
win rates, cutting the clock to 35% still gave 3/3 wins, and compactor speed
scaling was harmful enough to be pinned at 0. Materials were the first answer —
difficulty from content. This is the general one.

**Tonight's.** The player owned the `demo` unlock and still went a whole run
without a demolition charge while slag was landing. That is not bad luck, it is
the model: a Workshop unlock does not grant a mod, it only makes the card
*eligible for the draft shuffle*. Simulated over 4000 runs at their unlock set:

| draft slots | demo offered at all | offered **by bay 2** | mean offers/run |
|---|---|---|---|
| 2 | 92.8% | **39.3%** | 2.33 |
| 3 | 98.7% | 56.3% | 3.52 |

Cryo starts at bay 3 and slag at bay 4, so **the counter beats the material to
the table in under half of runs** — and only if the player spends their pick on
it instead of a build card. Salvage bought a lottery ticket.

**And salvage has no sink.** The ten unlocks total 1400 salvage and are the only
thing salvage buys. The permanent loadout is bought against a Mark *budget*
(`budgetForMark`), and in-run refits are bought with *scrap*. A player who has
cleared the Workshop — as this one nearly has — earns salvage from every
Contract and every run for nothing at all.

## The shape

Three layers, three currencies, no overlap.

| layer | currency | when | what it does |
|---|---|---|---|
| **Workshop** | salvage | between runs | **installs** a system, permanently, at level 1 |
| **Refit** | scrap (per line) | after bays 3, 6, 9 | **tiers** an installed system 1 → 3 |
| **Hazard draft** | none — mandatory | before every bay | ratchets one difficulty axis |

Installing is the fix for tonight: owning a system means you *have* it, at level
1, in every run. The randomness moves off the answer and onto the question.

### Systems make hazards cheap; they do not remove them

This is why the hazard draft needs no reward attached, and it is the load-bearing
idea of the whole design.

A system does not delete a hazard — it makes *one specific hazard cheap for you*.
Own the Launcher, and crosswind is the notch you can afford. Own the Reactor, and
a target raise is. So the draft asks **"what have you prepared for?"**, and the
reward for taking a hazard is implicit: the poison you are equipped for costs you
nothing.

It is also what makes the player's own line work — *"instead of increasing launch
cost for the next level one can choose to have materials"*. That swap is only
attractive once the material's counter is installed, which is exactly the
incentive the Workshop should be selling.

### The hazard draft is a ratchet, not a card

A hazard pick is not an object the player collects. It is a choice of **which
difficulty axis ratchets one notch**, and it stays ratcheted for the rest of the
run. By bay 10 the player has authored their own curve — perhaps time −4 notches,
cost +3, target +3.

Higher Marks do not make the ratchet steeper. They **add axes to the offer**.

This replaces per-bay auto-scaling rather than stacking on top of it.
`makeBaseLevel` currently hardens all three of these every bay on its own:

| axis | today | under this design |
|---|---|---|
| `targetScore` | `800 + 150*i` | flat at 800; **+300 per notch** |
| `launchCost` | `25 + 2*i` | flat at 25; **+5 per notch** |
| `timeLimitSec` | `150 + 10*i` (relief) | flat at 150; **−20s per notch** |

Notch sizes are sized to hold roughly today's bay-10 pressure: today two of three
axes harden every bay (time is relief), so ~18 axis-steps across a run; the
ratchet gives 9. Notches are therefore about double a current per-bay step. This
is a first guess and the single most likely thing to need a play pass.

### The Mark ladder becomes the tool ladder

| Mark | new axis on offer | new system to install |
|---|---|---|
| 1 | time · launch cost · target $ | **Reactor** (`scorePerLine`), **Launcher** (`launchPower`) |
| 2 | crosswind | **Stabilizer** (`windAssist`, split out of Launcher) |
| 3 | sweeper — faster press, tighter bay | **Bay** (open cells), **Hydraulics** (`compactorSpeed`) |
| 4 | **slag** | **Demolition** (exists as a mod today) |
| 5 | **cryo** | none, deliberately — see below |
| 6 | rebar | undesigned — the material comes first |
| 7 | volatile | undesigned |
| 8 | tar | undesigned |
| 9 | magnetic | undesigned |
| 10 | capstone — no new axis; the offer becomes **two** ratchets per bay | none |

Every rung now means something, which the ladder currently cannot claim. Marks
6–9 are the four unbuilt materials from the design table, each arriving with its
own answer rather than as scheduled probability. Their counters cannot be
specified before the materials are, and are deliberately left blank rather than
guessed at.

**Not every material needs a system, and cryo is the proof.** Cryo is the rung
that *teaches what a hazard is*: it arrives before any material has an answer,
it is recoverable by playing well rather than by shopping, and its cost — a
second shipment spent striking it — is paid in the verb the player already has.
Giving it a tool would delete it; the sequencing cost IS the material. So Mark 5
is the rung where the player learns that a hazard is something you absorb, which
is what makes Mark 4's Demolition legible as a *choice* rather than a tax.

**A Mark's numbers stop moving.** If Marks add axes rather than steepen them,
then `MARK_TARGET_STEP` and every other per-Mark multiplier goes to zero and
stays there — which is what the calibration sweep already concluded on its own.
A Mark is a statement about *which hazards and systems exist*, and nothing else.

## What this costs to build

Less than it looks. Most of it is re-wiring.

**The systems for Marks 1–3 already exist** as refit tracks:

| ladder entry | existing track |
|---|---|
| Reactor | `scorePerLine += 15 * tier` |
| Launcher | `launchPower *= 1 + 0.06*tier` |
| Stabilizer | `windAssist += 0.2*tier` (today bundled into Launcher — split it) |
| Bay / Hydraulics | open cells, `compactorSpeed *= 1 + 0.08*tier` |

**Two ladder entries are not tracks yet.** Stabilizer is today bundled into
Launcher, and **Demolition is not a track at all** — it exists only as a drafted
mod, which is exactly the asymmetry that produced the bug. Installing the six
existing tracks would therefore not grant a single demolition charge. A
`demolition` track (`cfg.bombCharges += tier`, mirroring `bonds`) is a
prerequisite of phase 1, not a phase 4 concern.

Adding a track moves `FULL_BUILD_COST`, which is derived from `UPGRADES.length`
— 6 × 110 = 660 becomes 7 × 110 = 770, and `budgetForMark` moves with it. That
is a deliberate re-pricing of every Mark's budget and it breaks the
`a full rig costs 660` check in `sim/systems.ts`. Both are expected.

The refit stop already exists at bays 3/6/9. `kind: "bane"` is already cut into
`ModDef` with nothing using it — 9 of the 12 mods are `tradeoff`, 3 are `boon`,
and there are **zero** banes today.

**The cards unbundle.** Most are already *hazard + pay* fused into one object,
and the halves separate cleanly:

| card | hazard half → axis | capability half → system |
|---|---|---|
| `heavy` | ×1.15 gravity | +$25/line |
| `bulk` | pentominoes, +50% launch cost | +$40/line |
| `premium` | +$5 launch cost | +$50/line |
| `overtime` | +$10 launch cost | +30s clock |
| `rapid` | +$5 launch cost | −35% cooldown |
| `short-lines` | −$25/line | −1 cell per line |

`demo` and `bond-breaker` — the two pure boons — become systems outright, with
no hazard half to donate. `bond-breaker` is the precedent for the whole move: it
already exists on both sides of the line, as a 320-salvage draft card *and* as
the `bonds` refit track. Demolition only ever existed on the random side, which
is precisely the asymmetry that produced tonight's bug.

The draft stops offering mods and starts offering axes.

## Materials

Today's materials work survives intact — `fillsSlots`, the strike-at-rest rule,
the cold-press shatter, the render, the Contract exclusion. Only the
**scheduling** changes.

`materialMixFor(bay, mark)` currently derives a probability from bay index and
Mark. Under this design its input becomes *how far the player has ratcheted the
materials axis*. Materials stop being something the ladder inflicts and become
something the player accepts in place of a harder number.

The Contract exclusion (`NO_MATERIALS`, explicit) stands unchanged and for the
same reason: both Contract kinds size their limit from a model assuming every
launched cube can reach a completed row.

One live problem this must fix, found in play: the material roll is **per
shipment** while the cost is **per cube**, and cube count is 2/4/5 by size class.
At an identical 11% slag rate, Bulk eats 0.55 dead cubes per shipment against
Micro's 0.22 — 2.5× — and Bulk is also the size that resists coming apart
(`breakMult` 1.6), so the blob is hardest to disperse or shove out. Bulk already
pays +50% launch cost for its upside and then pays an unpriced second slag tax.
Whatever replaces `materialMixFor` must see `pieceSize`.

## Contracts

Contracts keep their current job and finally get a reason to exist beyond their
own reward: **Contract salvage is what installs the next Mark's system.** The
player's framing — *"the salvage accumulated with contracts should be enough to
buy the system needed to beat the deep run and go up a tier level"* — is the
pacing target. A day's Contracts should fund roughly one install.

### Installs spend the Mark's build budget — this is what keeps them honest

An earlier draft of this section claimed installs did not touch the monetization
invariant while also saying Contract salvage buys a permanent tier. **Both cannot
be true**, and `meta.ts:209` names the second one as "the one thing it must never
do": uncapped dailies → uncapped salvage → a permanently stronger rig.

The resolution is already the documented rule. `docs/DESIGN.md:121`, which calls
itself the load-bearing rule of the whole design:

> Mark N grants a fixed upgrade budget, spent freely across the six tracks.
> **Contracts unlock what you may spend it *on*.** Only beating Mark N raises
> the budget.

So an install is **`loadout[id] = 1` routed through `buyLoadoutTier`**, which
already refuses anything whose `tiersCost` exceeds `budgetForMark`. Salvage buys
*which* systems exist to spend budget on; the Mark caps *how much* can be spent
at all. Contract income changes when you install, never how many.

Concretely, with a seventh track added (see below) `budgetForMark(1)` is 77, so
Mark 1 affords exactly three tier-1 installs — a fourth costs 80 and is refused.

Two consequences that must be built, not assumed:

- **`requiresMark` compares against Marks *beaten*** (`meta.ts:166`,
  `main.ts:799`), while this document's ladder table is indexed by the Mark being
  *flown*. Every install's `requiresMark` is therefore **its ladder Mark minus
  one**.
- The check at `sim/systems.ts:514` — "a week of tier-1 dailies is a fraction of
  the tree" — encodes the *old* rule that Contracts must never be the fast route
  to a full tree. Install pricing deliberately inverts that, so this check is
  **abandoned explicitly** and replaced by the pacing assertion above.

Unchanged: a Contract still pays once, ever, so Unlimited still buys throughput.

## Open calls

Decisions made here that play should confirm, in the order they are likely to
be wrong:

1. **Notch sizes** (+300 target / +$5 cost / −20s). Sized by arithmetic against
   today's curve, not by playing.
2. **Ratchets persist for the whole run.** The alternative — a notch that decays
   after a few bays — makes late bays less punishing but also makes the player's
   choices matter less.
3. **One material per Mark for 4–9.** Every rung gains meaning; the drip may be
   too slow for a player who wants to see rebar. Pairing them into Marks 4–6 is
   the fallback.
4. **Mark 10's capstone** (two ratchets per bay) is a proposal, not a settled
   rung.
Cryo having no counter is **settled, not open** — see below.

## Build order

Three sub-projects. Each gets its own spec and plan; this document is the
architecture they share.

1. **Systems layer.** Mods become installed-and-tiered; salvage installs at
   level 1; scrap tiers at the existing refit stops. Independently shippable,
   fixes tonight's bug, and gives salvage its sink back. **Build first.**
2. **Hazard draft.** The mod draft becomes the axis ratchet; `makeBaseLevel`
   stops auto-scaling the three base axes; the Mark ladder gates which axes are
   on offer.
3. **Material counters.** The four unbuilt materials and their systems, one per
   Mark — content on top of a finished frame.
