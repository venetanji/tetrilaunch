# THE VOLATILE EXAM — what the Impact Cushion actually sells, and the bay that would ask for it

> Companion to [`aim-strategy-findings.md`](./aim-strategy-findings.md) §3, which
> first measured the cushion as a decision rather than a rung, and to
> [`counter-systems-proposal.md`](./counter-systems-proposal.md) §2a, which
> specified it. Instruments: `app/sim/strategy-arms.ts`,
> `app/sim/_scratch-volclause.ts` (belt depth x liner tier),
> `app/sim/_scratch-cushtech.ts` (the technique/system split). Shipped shape:
> `app/src/game/upgrades.ts`'s CUSHION_TIERS, `app/src/game/lineClear.ts`'s
> `volatileBlast` / `cushionedTrigger`, `app/src/game/finals.ts`'s Tier-7 pair.
>
> **Everything here is measured on the RECALIBRATED target curve** (level.ts,
> 2026-08-28: every target x1.8). Numbers quoted from earlier documents are
> marked as such, because a bay that now demands 1.8x the money is not the bay
> those tables were flown on.
>
> Bot numbers, with `winnability.ts`'s standing pessimism ledger: no lookahead,
> no pile reading, a fixed landing target per shot. A human clears bays these
> pilots lose.

---

## 0. THE ASK

The owner, verbatim:

> *"I am wondering if we should limit the max systems slots so we force the
> strategy game in later tiers. For example, the cushion now lets me win a bay
> with only volatile, might be a good bay 10 inspection for the first tier with
> volatile."*

Two questions in one sentence. The slot half is answered in
[`system-slots.md`](./system-slots.md) §8. This document answers the volatile
half, and it answers it in three parts: **is the cushion too strong**, **what
shape would that inspection have to be**, and **is it winnable**.

The first volatile tier is **Tier 7** (`hazards.ts`: the Volatile Contract axis
opens at Mark 7), and the Impact Cushion installs at `requiresMark: 6` — so the
counter reaches the shelf exactly one tier before the hazard reaches the belt.
That alignment is what makes the owner's idea possible at all.

---

## 1. IS THE CUSHION TOO STRONG? THE ANSWER IS "MOSTLY IT IS NOT THE CUSHION"

### 1a. The shipped 2x2, re-flown on the recalibrated targets

`sim/strategy-arms.ts --system cushion --mark 7 --bay 10 --ratchets volatile:6`
— the belt cap (`BELT_CEILING` is 1/3, so six notches is as volatile as the
ratchet can make a bay), 24 paired seeds, `material` rig:

| arm | win | lines | shots | end$ | detonation bill |
|---|---:|---:|---:|---:|---:|
| no liner / naive | 12/24 | 11.6 | 67.8 | $2149 | $1029 |
| no liner / cushion *(control)* | 12/24 | 11.6 | 67.8 | $2149 | $1029 |
| Cushion 1 / naive | 13/24 | 9.7 | 53.0 | $2126 | $760 |
| Cushion 1 / **cushion** | **22/24** | 18.8 | 58.5 | $3233 | **$237** |
| Cushion 2 / **cushion** | 18/24 | 16.0 | 52.4 | $2785 | $220 |
| Cushion 3 / **cushion** | 17/24 | 14.9 | 50.2 | $2797 | $253 |

`aim-strategy-findings.md` §3's 96-seed table on the OLD targets read 55/96,
94/96, 91/96, 88/96. Every conclusion it drew survives the x1.8 recalibration:
the rungs are worth +1 / +1 / −3 unplayed and +9 / +5 / +8 played, the
detonation bill falls ~77%, and **the ladder still descends** — rung 1 is the
best rung.

So on the face of it the owner is right: **a played tier-1 liner takes a
volatile-capped bay-10 from a coin flip to 92%**, at a cost of 20 ladder points
and 50 salvage.

### 1b. …but the harness could never say WHICH HALF of that was the liner

`cushionAware` is gated on `g.level.cushionCells > 0` and refuses to act with no
rig aboard. That makes its no-system arm a control by construction — which is
what the tool needed — and it also means **the +38 has never been separated into
"the liner" and "the aiming policy the liner enables."** A player with no cushion
can still lob volatile at the wall and refuse to drop cargo onto an intact bomb.
Nothing in the game forbids it. Only the harness does.

**The separation needs no new strategy, only a liner that is all geometry and no
softening**: `cushionCells = 8` to switch the policy on, `cushionMult = 1.00` so
it protects nothing. `volatileBlast` reads the depth only to choose the
multiplier, so at x1.00 that arm is byte-identical to no liner in the physics and
identical to a maxed liner in the aiming.

**Tier 7 bay 10, `volatile:6`, 32 paired seeds** (`sim/_scratch-cushtech.ts`):

| arm | liner | softening | win | secs | lines | shots | end$ | bill$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| none / naive | 0 cells | x1.00 | 50% | 109 | 10.7 | 62.6 | $2058 | $947 |
| **TECHNIQUE / cushion** | 8 cells | **x1.00** | **75%** | 93 | 16.3 | 61.8 | $2802 | **$494** |
| t1 / naive | 4 cells | x1.15 | 56% | 100 | 10.0 | 55.0 | $2137 | $800 |
| t1 / cushion | 4 cells | x1.15 | 88% | 86 | 17.9 | 56.3 | $3152 | $221 |
| t3 / cushion | 8 cells | x1.40 | 72% | 70 | 15.1 | 51.1 | $2898 | $272 |

**Two thirds of what the Impact Cushion is credited with is a technique that
needs no Impact Cushion.** Of the +38 points of win rate the played liner buys
(50% → 88%), **+25 is the aiming policy alone** — lob volatile at the wall,
never drop other cargo on an intact bomb — and only +13 is the softening the
player paid for. The detonation bill tells the same story: $947 → $494 on
technique alone, $494 → $221 with the liner under it.

**So the verdict on "does the cushion trivialize volatile" is: not on its own.**
What trivializes volatile at ratchet depths is knowing how to land it, and the
game currently teaches that only by selling a liner with a line drawn on the
field. The liner's most valuable product may literally be **the line** — a place
the player can see to aim at — rather than the 15% of softening behind it.

### 1c. What that does and does not license

- **A nerf to CUSHION_TIERS is not what the data asks for.** Cutting the
  softening takes the +13, leaves the +25, and makes the shop card sell less of
  what it is already mostly not selling.
- **The ladder's real problem is unchanged and now has a cause.** Rungs 2 and 3
  are worth nothing at ratchet depths (88 / 72 at 32 seeds; 94 / 91 / 88 at 96
  on the old targets) because rung 1's threshold already covers every arc this
  cannon fires. §3 below finds the one belt where the three rungs DO separate,
  and it is the belt the owner's clause would deal.
- **The teaching gap is the actionable finding.** `guide.ts` has a volatile
  topic and an Impact Cushion topic; neither says *lob it at the wall and never
  drop cargo on an intact bomb*. That sentence is worth +25 points of win rate
  at Tier 7 bay 10 and costs nothing to say.

---

## 2. THE DEPTH CURVE — and the trough that decides the clause's shape

`sim/_scratch-volclause.ts` writes the belt's volatile share directly (what a
`fullBelt` FinalDef does) on a Tier-7 bay 10 whose arrival already poured every
notch into volatile, then grants the liner as a kit. **Tier 7 bay 10, 32-40
paired seeds:**

| belt volatile | none | t1 played | t2 played | t3 naive | t3 played |
|---:|---:|---:|---:|---:|---:|
| 27% *(16 seeds)* | 69% | 75% | 75% | 63% | 88% |
| **33%** *(the belt ceiling)* | **25%** | **81%** | **78%** | 56% | **88%** |
| 40% | 16% | 63% | — | 41% | 69% |
| 50% | 0% | 38% | 44% | 22% | 41% |
| 60% | 0% | 22% | — | 31% | 41% |
| 75% | 0% | 13% | 28% | 34% | 53% |
| **100%** | **0%** | **38%** | **58%** | **80%** | **83%** |

*(The probe WRITES the share, so rows below 0.32 are bays with less volatile
than the run's own arrival ratcheted — a depth curve, not a clause. The 33% row
IS a clause: it is what `schedule()` deals, see §3.)*

**The curve is not monotone, and the trough is the most useful fact in this
document.** A belt that is 50–75% volatile is HARDER than one that is 100%
volatile, for every liner tier — a maxed liner reads 41% / 41% / 53% across the
trough and 83% at the bottom of it — and the mechanism is exactly the one
`lineClear.ts` designed in:

> *the liner is bedding a volatile shipment comes down ON … a volatile cube AT
> REST in a lined slot reads its own position and softens an impact it played no
> part in, so ordinary cargo could be dropped on a bomb at full power and the
> bomb would sit there.*

`volatileBlast` softens **the landing**, not the cube. So on a mixed belt the
standard shipments are the detonator: they arrive unprotected by construction and
set off the volatile cargo already lying in the liner. Remove the standard cargo
entirely and there is nothing left that the liner does not insure — which is why
**a volatile-only belt is the one volatile belt a maxed liner can actually
tame.**

### 2a. And it is the only belt on which the cushion's ladder ascends

| belt volatile | t1 | t2 | t3 | shape |
|---:|---:|---:|---:|---|
| 32% (the ratchet's own cap, no clause) | 88% | 75% | 72% | **descending** — rung 1 is enough |
| 33% (Powder Run as dealt) | 81% | 78% | 88% | **flat** — inside noise at 32 seeds |
| 100% (full belt) | 38% | 58% | **83%** | **ascending** — every rung pays |

The Impact Cushion has shipped with an inverted ladder since it landed, and
`aim-strategy-findings.md` §3 says why: *"rung 1's threshold already insures
every arc this cannon can fire."* A volatile-only belt is the first bay in the
game where that stops being true — because on it the liner is not insuring the
occasional hard shot, it is insuring **every shipment**, and depth of liner (4 →
6 → 8 cells) becomes how much of the wall you may actually use.

**A clause built on this belt is therefore not just an exam for the cushion. It
is the only bay that makes the cushion's own three rungs mean anything.**

### 2b. Where the bare-handed cliff sits

**69% → 25% → 16% → 0%**, across 27 / 33 / 40 / 50 percent of belt. The cliff is
between a third and a half, and it is steep: six points of belt either side of
the ratchet's own ceiling is the difference between a bay a bare rig usually
takes and one it usually loses.

That bounds every clause that has to stay winnable without the system: **a
volatile clause may go to the belt ceiling and no further.** Past 40% there is
nothing between "a bare rig loses" and "a bare rig cannot play", and the trough
in §2 means the ground between 40% and 90% is worse for the SYSTEM as well.

### 2c. A finer trigger on a full belt is a lose button, measured

Folding Hair Trigger's priming into a full-belt clause was drafted and killed by
the instrument. **100% volatile at `volatileTriggerMult = 0.85`, 32 seeds:**

| liner | none | t1 | t2 | t3 |
|---|---:|---:|---:|---:|
| naive | 0% | 0% | 0% | 0% |
| played | — | 0% | 0% | **0%** |

Zero everywhere, including a maxed liner played by the aware pilot, and the
reason is `cushionedTrigger`'s own floor: *"where something has primed the bay
finer than stock, a cushion may lift it back to stock and no further."* A maxed
liner under a 0.85 clause lands at exactly 1.00 — the stock threshold of 22 — and
a 100% volatile belt at the stock threshold is unplayable (the t3/naive row of
§2, 80%, only exists because a maxed liner un-primed lifts the threshold to 30.8,
above every arc the cannon can fire).

So the two costs are mutually exclusive by arithmetic, not by taste: **a
full-belt volatile clause must ship at the stock trigger.**

---

## 3. THE TIER-7 EXAM IS THE CUSHION'S EXAM AND SAYS IT IS THE BAY'S

`finals.ts` deals Tier 7 a pair — Powder Run (27% volatile) and Hair Trigger (20%
volatile, primed x0.85) — and both are stamped `system: "bay"`.

**Both cards understate the belt they actually deal, and that is `schedule()`
working as designed.** A clause takes `max(rate, min(cap, arrived + one notch))`,
so a run that poured its notches into volatile arrives at `MATERIAL_CAP` (0.32)
and BOTH clauses land at the ceiling, **0.333**, not at the 0.27 and 0.20 on
their cards. The card's number is a floor for a clean arrival; the ceiling is
what a volatile run meets. Measured at the number actually dealt, 32 paired
seeds, Tier 7 bay 10:

| clause | belt | trigger | no liner | t1 played | t2 played | t3 played |
|---|---:|---:|---:|---:|---:|---:|
| **Powder Run** | 0.333 | x1.00 | **25%** | 81% | 78% | 88% |
| **Hair Trigger** | 0.333 | x0.85 | **53%** | 91% | 84% | 84% |

**So the pair DOES examine the cushion, hard** — +56 and +38 points of win rate
from a played liner — and it is stamped with the wrong system. Three consequences,
in descending order of how much they cost:

1. **The card names the wrong system.** `screens.ts` badges each clause with
   `FinalDef.system`, so the Tier-7 exam tells the player it is about Bay
   Extension while the measured swing is the Impact Cushion's. The code that
   makes the pair work says so itself — `cushionedTrigger`'s floor exists for
   this pair and its comment reads *"A cushion should be able to SIT that
   exam."*
2. **No Final Inspection anywhere on the ladder names `thaw`, `cushion` or
   `incinerator`.** The table covers reactor / launcher / hydraulics / bay /
   bonds / demolition only. The three decision-shaped counters —
   `aim-strategy-findings.md`'s three systems that are bought and not understood
   — are the three the ladder never examines. Retargeting this pair fixes a
   third of that for one word.
3. **Neither pole separates the cushion's rungs.** 81 / 78 / 88 and 91 / 84 / 84
   are flat inside noise at 32 seeds. At the belt ceiling the first rung is still
   the whole system, exactly as §1 found with no clause at all.

### 3a. And Hair Trigger is the EASIER pole, which is backwards from its card

53% bare-handed against Powder Run's 25%, on the same belt, from a clause whose
card warns that *"only the softest lob will not set it off."* The mechanism is
one `lineClear.ts` already names: **a detonation thins the pile.** Priming
volatile finer makes it go off more, and at the belt ceiling with no liner the
thinning is worth more than the bill — the detonation charge rises $713 → $910
and the win rate rises with it.

That is not a bug and it is arguably good design (the "cheap disposal" reading of
volatile is real), but the pair's two poles are not ordered the way their copy
implies, and a player choosing between them from the cards alone is choosing
against the wrong model.

## 4. THE DRAFTED CLAUSE

### 4a. Draft A — POWDER KEG (recommended shape, needs one rule to move)

```ts
{
  id: "powder-keg",
  name: "Powder Keg",
  desc: "Every standard shipment arrives volatile. Land one hard and it takes"
      + " its neighbours with it — and the bay pays for every live cube in the"
      + " blast. Only a deep liner beds a belt like this.",
  tier: 7,
  system: "cushion",
  fullBelt: true,
  apply: (cfg) => {
    // Full Rebar's shape exactly: the STANDARD share and no more, so a
    // ratcheted material keeps the rate the run walked in with and the clause
    // never refunds a notch with easier cargo.
    const keys = Object.keys(cfg.materialMix) as Array<keyof LevelConfig["materialMix"]>;
    const others = keys.reduce((a, k) => a + (k === "volatile" ? 0 : cfg.materialMix[k]), 0);
    cfg.materialMix = { ...cfg.materialMix, volatile: Math.max(0, 1 - others) };
  },
}
```

It replaces **Powder Run**, keeping Hair Trigger as the pair's other pole, and
both are retargeted `system: "cushion"`.

**Measured, Tier 7 bay 10, the rig a Tier-7 player flies, 32–40 paired seeds:**

| liner aboard | pilot | win | secs | lines | end$ / $3132 | detonation bill |
|---|---|---:|---:|---:|---:|---:|
| none | naive | **0%** | — | 0.0 | $3 | $239 |
| none | *technique only* | **0%** | — | 0.0 | $4 | $221 |
| Cushion 1 | naive | 0% | — | 0.0 | $3 | $227 |
| Cushion 1 | played | 38% | 118 | 22.3 | $1951 | $114 |
| Cushion 2 | naive | 3% | 97 | 1.8 | $165 | $371 |
| Cushion 2 | played | 58% | 77 | 18.0 | $2484 | $92 |
| Cushion 3 | naive | 80% | 78 | 15.1 | $2823 | $206 |
| **Cushion 3** | **played** | **83%** | 60 | 16.0 | **$3055** | **$6** |

**It is a wall without the system and an ordinary bay with it, and the middle is
a real ladder.** 0 / 38 / 58 / 83 across the three rungs is the first ascending
cushion ladder anything has measured.

**And it is the one bay where the technique of §1b is not enough.** The
technique-only arm — a pilot playing the full liner policy with x1.00 of
softening — reads **0%** here against 75% at the belt ceiling. On a full belt
there is no unlined slot to be clever about and no standard cargo to sequence
around; the only thing left is the threshold, which is the thing the player
bought. That is what makes this a clean exam for the system rather than for the
technique the system happens to teach.

**What it costs the player to be able to sign it**, priced in the shelf's own
currency: install the Impact Cushion (50 salvage, gated at `requiresMark: 6`),
uprate it to tier 2 (50 salvage — `UPRATE_MAX_TIER` is 2, so the Workshop stops
there), spend one of the rack's slots on it, and buy the third rung with 55
scrap at one of the run's three refit stops. That is four separate commitments
made across two currencies and three screens, every one of them before the
clause is dealt — which is exactly what an exam should ask.

**THE RULE IT BREAKS, stated plainly.** `sim/systems.ts` pins *"the capstone's
pair is the full-belt pair, and nothing else is"*, and `FinalDef.fullBelt`'s own
doc says taking the standard shipment away *"is the one cost that must never be
dealt before the ladder's last exam."* Draft A needs that rule narrowed, and the
honest version of the argument is:

- **The rule is about COST, and this clause's cost is answerable.** Odd Lots and
  Full Rebar are full belts nothing on the shelf counters — that is what makes
  them the capstone. A volatile-only belt has a counter, on the shelf, one tier
  earlier, and the measured spread (0% → 83%) is the counter's whole ladder.
- **But it is strictly harsher than either capstone clause bare-handed.** Full
  Rebar's belt is playable with no rig at all (rebar counts for lines; it merely
  refuses to split). Powder Keg's is 0%. So "full belt" is not the property that
  should gate this — "full belt with no answer on the shelf" is, and that is a
  rule with a fuzzier predicate than the one it replaces.

**This is the owner's call and it is a design call, not a measurement.** The
numbers say the bay is well-shaped; they cannot say whether the ladder should
deal its first no-standard-cargo belt at Tier 7.

**AT TIER 10 THE SAME CLAUSE IS STILL A CLAUSE**, which matters because the
Skydeck and the capstone fly the same belt machinery. 24 paired seeds, Tier 10
bay 10, target $3683:

| belt | none/naive | t2 played | t3 naive | t3 played |
|---:|---:|---:|---:|---:|
| 27% | 17% | 79% | 54% | 79% |
| **100%** | **0%** | **67%** | 67% | **50%** |

The wall is the same (0% bare) and the ceiling is lower (50-67% rather than
83%), which is what a tier three rungs deeper should look like. The t3-played
row dipping under t2 is the descending-ladder artefact of §1 reappearing once
the bay is hard enough that landing further from the wall costs more than the
extra threshold buys — at 24 seeds it is 12 wins against 16 and not a finding.

### 4b. Draft B — keep the pair, retarget it, and deepen it (no rule moves)

If the capstone rule stands, the same intent survives in a smaller change:

1. Retarget both Tier-7 clauses to `system: "cushion"`. One-line change; the card
   then names the system the bay is actually about, and the ladder stops having
   three counters it never examines.
2. Raise Powder Run's rate from **0.27 to `FINAL_MATERIAL_CAP`** (0.333), so the
   clause's own number is above the ratchet's ceiling and the card's promise is
   one the bay actually charges.
3. Leave Hair Trigger alone. Its priming is the pole the `cushionedTrigger` floor
   was written for and it remains the "how gently must it land" half.

**What Draft B buys, measured: almost nothing, and §3 is why.** `schedule()`
already floors both clauses at the ceiling on a volatile-ratcheted arrival, so
raising Powder Run's card number from 0.27 to 0.333 changes only the CLEAN
arrival — the run that never touched volatile and meets the clause cold. That
run currently gets 0.27 (69% bare-handed at 16 seeds) and would get 0.333 (25%).
Real, but it moves the clause for the player who prepared for it LEAST, which is
the wrong half of the audience.

The retarget in step 1 is the part of Draft B worth doing on its own: it is one
word, it costs nothing, and §3 says the badge is currently wrong.

**What Draft B does NOT buy:** the ascending cushion ladder. At the ceiling the
rungs read 81 / 78 / 88 — flat inside noise — and the Impact Cushion keeps
shipping with the inverted ladder `aim-strategy-findings.md` flagged. Only a full
belt fixes that, because only a full belt removes the standard cargo that defeats
the liner.

### 4c. What both drafts must NOT do

- **No finer trigger on a full belt** (§2c): 0% at every rung, measured.
- **No belt between 40% and 90%**: the trough. A clause landing there is harder
  than one that goes all the way, which is unreadable from the card and
  unrewarding for the system it examines.
- **No third clause at Tier 7.** `sim/systems.ts` pins every Tier at exactly two
  and two different ones. Anything new replaces something.

---

## 5. HOW IT MEETS THE DRAFT AND THE RATCHET

- **It is drafted, not imposed.** `finals.ts`'s pair is the last draft of the
  run, dealt before bay 10, and the player picks one of two sight-seen — the
  `desc` carries its own number, the same rule every hazard card follows. A
  clause that is a wall to one rig and a bay to another is the shape the capstone
  pair already has (`finals.ts`: *"Which pole is cheaper is legible from the rig
  — a Demolition/Bay ship eats Odd Lots' variety, a deep Bond Emitter magazine
  eats Full Rebar's rigidity"*). Draft A is that, one tier earlier and with the
  legibility carried by the `system` badge.
- **It composes with the run's own ratchets without refunding them.** Both
  drafts write only the STANDARD share, so a run that ratcheted cryo or slag
  keeps every notch it took. That is `schedule()`'s no-refund rule, which
  `sim/systems.ts` pins on every arrival it can construct.
- **It stands the belt's spacing rule down, which is the point.** `belt.ts`
  guarantees two standard shipments after every material below `BELT_CEILING`;
  an authored bay above it *"gets its own number"*. Powder Keg is the authored
  case, and back-to-back volatile is precisely the thing the liner is bought to
  survive.
- **The ratchet cannot pre-pay it.** `MATERIAL_CAP` is 0.32, so the deepest a run
  can ratchet volatile is a third of the belt; the clause's remaining two thirds
  is a cost no notch can have already bought. Draft B's 0.333 is the opposite
  case and is why its step is small.
- **`hazards.ts`'s floor rule holds either way.** *"A system makes one hazard
  cheap for you, it does not erase it."* Even at Cushion 3 the bay still bills
  for every live cube a blast takes ($6 at the top rung is the measured floor,
  not zero), volatile still detonates outside the liner, and a cube still goes
  off when something lands hard on top of it — which on a full belt means the
  next volatile shipment.

---

## 6. THE RECOMMENDATION

In order, cheapest first, and only the first is unconditional:

1. **Retarget the Tier-7 pair to `system: "cushion"`.** One word per clause. §3
   measures the pair's cushion swing at +56 and +38 points of win rate while the
   card badges it as Bay Extension, and no Final Inspection on the ladder names
   any of the three counters the player is least likely to understand.
2. **Teach the technique.** §1b prices *lob volatile at the wall, never drop
   cargo on an intact bomb* at +25 points of win rate with no rig at all — two
   thirds of what the Impact Cushion is credited with. It belongs in
   `guide.ts`'s volatile topic, and it makes the cushion card honest about what
   the extra 13 points are for.
3. **Do NOT nerf CUSHION_TIERS.** §1b says the softening is the smaller half of
   the system's measured value, and §2a says the rungs above the first are
   already worth nothing at every depth the ratchet can reach. A nerf takes the
   part that works and leaves the part that does not.
4. **Then, if the owner wants the exam: ship Powder Keg (Draft A).** It is the
   only volatile belt on which the cushion's three rungs separate upward
   (38 / 58 / 83), the only one the §1b technique cannot beat bare-handed (0%),
   and the only one above the ratchet's ceiling that is not in the trough. It
   costs one rule: `fullBelt` stops meaning "capstone only" and starts meaning
   "capstone only, or a belt the shelf already sells the answer to."

**And nothing here argues for a slot cap.** [`system-slots.md`](./system-slots.md)
§8 measures that separately and finds the cap has no power to remove — a rack of
six is the best rack in eight cells of eight — so the strategy game the owner is
asking for is bought with clauses, not with a ceiling.

---

## 7. WHAT THIS DOCUMENT CANNOT SAY

- **Whether 83% is the right number for an exam.** It is a bot number carrying
  the standing pessimism ledger, so a human clears more. Whether a Tier-7 last
  bay should be a 4-in-5 for a fully committed rig is a feel question.
- **Whether the technique in §1b is discoverable.** The +25 points it is worth
  are +25 to a pilot that was TOLD the rule. Nothing here says a player finds it,
  and the whole reason it shows up as the cushion's value today is that the
  cushion is how the game currently teaches it — by drawing the line.
- **Anything about cryo or slag at these depths.** Both columns of the slot sweep
  came back 0% for every rack at 0.17–0.22 of the belt (see
  [`system-slots.md`](./system-slots.md) §8), which measures the ratchet rather
  than the rig. Volatile is the only material corner this pass could resolve.
- **The Incinerator's interaction.** A hood remits a share of the detonation
  bill, and the bill is the axis this whole document is measured in — but no
  pilot in this harness aims into the flue, so the interaction reads as zero and
  is not reported.
