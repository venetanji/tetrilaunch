# Slag: a bounty on disposal, and a resupply line

**Date:** 2026-08-24
**Status:** approved, implementing

## Why

Slag is the one material with no passive counter — `hazards.ts:339-349` says so
in as many words, and PR #70 measured what that costs: *one* notch of slag at
`materialRate(1) = 0.07` takes the aim bot from 100% to 0%, because it "cannot
fire the charge that is slag's only exit". The harness overstates it (a human
can fire the charge) but the direction is real, and the owner's playtest
complaint is the same one from the other side: **once slag is down, lines get
very hard, and there are only ever 6 charges.**

Two distinct failures hide under that one complaint, and they want different
answers:

1. **You run out of bombs.** A bay is long. At `materialRate` 2-3 notches, or
   under PR #70's Tier 6 clauses (`Slag Run` at 17% of the belt, `Slag Wall`
   opening the bay on 11 cubes of it), more than six slag shipments can arrive.
   The seventh has no answer at all. This is **scarcity**, and paying more money
   per cube does not fix it.
2. **Slag is pure denial with no upside.** It is the only material that is never
   anything but a loss. This is an **economy** problem.

## What this is not

The obvious version — "pay for volatile detonations" — is already refused in the
code, at `game.ts:1557-1566`:

> Deliberately pays NO salvage... Paying for it would make ratcheting the
> volatile axis an income strategy, which is the exact inversion of a hazard.

That argument is correct and survives intact here, because **the bounty is a
property of slag, not of volatile.** Volatile that eats live cargo still pays
exactly nothing, so a run that ratchets volatile alone earns not one dollar from
it. The money appears only where the player took *both* axes — which is a build
they chose twice, not a hazard paying for itself.

The design was already pointing here. `lineClear.ts:158` names the intended
answer to volatile as "deliberately chaining it into a pile that was never going
to complete a row anyway". A slag pile *is*, definitionally, a row that was never
going to complete. The play existed; it just paid nothing.

## A. The bounty

`resolveVolatile` pays `level.slagBounty` in funds for every destroyed cube whose
material is `slag`. Everything else it destroys pays zero, as now.

| | bomb | volatile |
|---|---|---|
| **slag** | `salvagePerCube` ($8) | **`slagBounty` ($20)** |
| **anything else** | `salvagePerCube` ($8) | $0 |

**Bombs are deliberately left at $8 on slag.** Their problem is that they run
out, not that they underpay, and (B) fixes that directly. Keeping the premium
exclusive to volatile also keeps the strategy's identity sharp: the renewable
channel is the profitable one, because a bomb is capped at 6 per bay and the belt
is not.

**$20 reads as `$8` scrap metal plus a `$12` denial premium.** The existing
refund is justified at `game.ts:1543-1555` as "a cube... that will never complete
a line is worth $0 as line material and salvagePerCube as scrap metal". A slag
cube is worth $0 as line material *always*, and additionally denies the row it
sits in — so its removal is worth strictly more than a standard cube's.

Sizing: a volatile lobbed into a 3-slag cluster returns $60 against a $25
launch. A line still pays `scorePerLine` (100+) before combo. Farming slag
therefore never beats clearing lines, which is the hierarchy `game.ts:1685-1687`
already protects for the bomb's scrap trickle.

**Funds only, no scrap.** Funds are the bay's operating budget (ECONOMY.md's
three horizons) and the bounty is a bay-local relief valve. Paying scrap would
feed the ship, making a slag ratchet a route to permanent progression — a much
larger claim than this change wants to make.

The existing `salvage` effect (`render.ts:1653-1670`) is reused for the toast, so
the player sees the number at the blast. A payout the player only meets in the
end screen teaches nothing — the same rule `PILE_TIERS` follows for its clock
burn.

## B. The resupply line

At **Demolition Rack tier 3 only**, every 4 lines cleared returns one charge,
mid-bay.

A clean bay clears ~8 lines (ECONOMY.md's income sizing), so the capstone goes
from 6 charges to ~8, and a long grinding bay keeps paying. Tiers 1 and 2 are
untouched.

This makes the third tier a change in **kind** rather than another `+2`. The
track's own comment (`upgrades.ts:237-244`) already argues the bomb should be
"the abundant consumable" and that "a charge you can PLAN for beats a charge you
might be dealt"; a resupply is the end of that same sentence.

**The loop is deliberately circular.** Resupply is earned in lines, and slag is
what stops you clearing lines. That is the point: it pays out for charges spent
*unblocking rows*, not for charges hoarded, so the tier rewards using the tool
for the thing it is for. It will not rescue a bay that is already buried, and it
should not — that position stays lost.

Rejected: metering resupply on compactor strokes. DESIGN.md:311 already rejected
strokes as a currency, and the same reasoning applies — a stroke-metered
resupply pays a player who is doing nothing.

## Seams

Two new `LevelConfig` fields, each read in exactly one place:

- `slagBounty: number` — funds per slag cube destroyed by a volatile
  detonation. Read by `game.ts`'s `resolveVolatile`.
- `bombResupplyLines: number` — lines per returned charge; `0` disables. Read by
  `game.ts`'s line-clear payout path. Written by `upgrades.ts`'s `demolition`
  track at tier 3.

`Game` gains `bombsResupplied` so the grant is idempotent against a cumulative
`linesTotal` rather than a per-clear delta — a 4-line clear at once must return
exactly one charge, not risk being missed by an equality test.

## Out of scope

- **Chain reactions.** `volatileBlast` does not chain and nothing promises it —
  "chaining" in `lineClear.ts:158` means *aiming* volatile into junk, not a
  propagating blast.
- **A slag SFX.** There is no slag-specific cue today (`audio.ts:34-66`); the
  blast already plays the pitched-up `volatile` voice.
- **Contracts.** Slag is structurally excluded (`contracts.ts:103-108`) because a
  cube that cannot count toward a line cannot be priced by a cube-denominated
  budget. A bounty does not change that.
- **`volatileTriggerMult`.** PR #70 adds it to `volatileBlast`; this change stays
  out of that function entirely so the two do not collide.

## Verification

`npm test` (`sim/systems.ts`), with each check written failing first:

1. A volatile blast on slag pays `slagBounty` per slag cube.
2. A volatile blast on standard cargo still pays 0 — the anti-inversion rule.
3. A mixed blast pays for the slag only.
4. A bomb on slag still pays `salvagePerCube`, not the bounty.
5. `demolition` tier 3 sets `bombResupplyLines`; tiers 0-2 leave it 0.
6. Charges are returned once per interval and not re-granted.

Plus `npm run typecheck` and `npm run build`.
