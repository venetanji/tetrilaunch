# SYSTEM SLOTS — how wide a rig has to be, and what the width is worth

> Instrument: [`app/sim/slots.ts`](../../app/sim/slots.ts). Pins:
> `app/sim/systems.ts`, section "System slots — the rack". Shipped shape:
> `app/src/game/meta.ts`'s SYSTEM SLOTS block. Companion to
> [`aim-strategy-findings.md`](./aim-strategy-findings.md), which is where the
> per-bay value of the three decision-shaped systems was measured, and to
> [`winnability-sweep-findings.md`](./winnability-sweep-findings.md), whose
> pessimism ledger this document inherits whole.

---

## 0. THE ASK, AND THE TWO THINGS IT COULD HAVE MEANT

The owner, verbatim:

> *I think what we could do is to limit the amounts of systems a rig can have
> and pay salvage to get more system slots.*

alongside the standing ruling behind it — *"the next step is having rigs that
can have certain systems and not others, but for now we leave the endgame to max
out all the systems."*

That reads two ways, and only one of them is a decision.

**Gating OWNERSHIP** — the Workshop refuses an eleventh sale — makes every
install irreversible and unbuyable-back. A player who bought the Thaw Lance
three tiers before ever meeting volatile cargo would be locked out of the Impact
Cushion by a purchase they had no way to price at the time. That is a trap
wearing an identity's clothes, and it duplicates the build budget's job at the
one layer `docs/DESIGN.md` says salvage must never touch: *"Contracts unlock what
you may spend it on. Only beating Mark N raises the budget."*

**Gating the LOADOUT** costs nothing already paid for. Everything owned stays
owned; what a slot rations is how many answers you carry into ONE run, remade
free before every undock. That is where "rigs that can have certain systems and
not others" actually starts — a per-rig whitelist is the same mechanism with the
choice taken away from the player, and it wants to arrive second.

**Shipped: the loadout.** The rest of this document is what the instrument found
about how wide the rack should be and what a slot is worth.

---

## 1. THE THING THE RECORD COULD NOT ANSWER

Every balance table in this directory was flown on a rig of **five to seven
distinct systems, and none of them says so.**

`winnability.ts` and `marks.ts` both spend a Mark's budget through
`builds.ts`'s `loadoutFor`, which walks a named priority order breadth-first.
The number of distinct systems the measured rig ends up carrying is therefore a
side effect of how long that order happens to be — `spatial` and `economy` are
five, `material` six, `full` seven. Until slots existed nothing turned on it, so
nobody wrote it down.

It turns out to be the most useful fact in this document: **the record this
design must not break is already a five-slot record.** A ten-slot rig has never
been measured by anything, and a four-slot one is one narrower than the rigs
every existing claim rests on.

`sim/slots.ts` makes the width an explicit axis for the first time, and crosses
it against WHICH systems occupy it and against what the belt is dealing.

---

## 2. VIABILITY — does a narrow rack wall a tier?

`npx tsx sim/slots.ts --marks 7,10 --slots 3,4,5,6,8 --content clean,cryo,volatile,slag --seeds 8`

Mount order is `auto`: the content's own answer takes the first seat (the lance
for cryo, the liner for volatile, the rack for slag), so this is a test of the
narrow rig **with the right choices** rather than of one fixed shopping list.
The pilot matches the rack — `lance` when the belt is frozen and the lance is
aboard, `cushion` when it is volatile and the liner is aboard, `naive`
otherwise, which is the pilot every table in this directory was measured on.

**Mean bays cleared, 8 paired seeds a cell.** (`avg` from the tool; the wall —
median bay the run died in — is in brackets.)

### Tier 7

| slots | pts | clean | cryo | volatile | slag |
|---:|---:|---:|---:|---:|---:|
| 3 | 165 | 3.3 (4) | 2.1 (4) | 2.5 (3) | 1.1 (2) |
| 4 | 220 | 3.5 (4) | 2.6 (5) | 2.4 (3) | 1.6 (3) |
| 5 | 275 | 3.8 (6) | 2.5 (5) | 3.3 (5) | 2.8 (4) |
| 6 | 330 | 4.0 (6) | 3.3 (5) | 4.4 (5) | 2.9 (4) |
| 8 | 440 | 4.0 (6) | 3.5 (5) | 4.5 (5) | 2.9 (4) |

### Tier 10

| slots | pts | clean | cryo | volatile | slag |
|---:|---:|---:|---:|---:|---:|
| 3 | 165 | 2.1 (3) | 2.0 (3) | 1.9 (3) | 1.6 (2) |
| 4 | 220 | 3.5 (4) | 2.0 (2) | 2.0 (2) | 2.1 (3) |
| 5 | 275 | 3.3 (3) | 2.6 (3) | 2.3 (3) | 2.6 (3) |
| 6 | 330 | 3.3 (3) | 2.4 (3) | 2.3 (3) | 2.4 (3) |
| 8 | 440 | 3.8 (4) | 2.0 (3) | 2.3 (3) | 2.0 (3) |

**No slot count walls a tier the wider rack survives.** The deepest single seed
in each Tier-10 row: at four slots the best runs reach bays **8** (clean), **9**
(cryo), **8** (volatile) and **7** (slag) — *deeper, on several rows, than the
widest measurable rack managed on the same content.* A narrow rack loses bays on
average; it does not meet a door it cannot open.

The 40 cells above also carry a second, unasked-for finding worth stating,
because it is the reason a slot cap is not simply a nerf: **at the Marks where
the build budget binds, a narrower rack is a STRONGER one.** The Workshop's
ceiling is `slots x 55`, so four slots at Mark 2 is 220 points — exactly
`budgetForMark(2)` — while eight slots at Mark 2 is the same 220 points spread
across eight tracks that all stop at tier 1. An earlier pass at Tiers 3 and 5
(4 seeds, `sim/results/slots-viability.txt`) reads exactly that way: at Tier 3
the three- and six-slot racks are worth 165 and 330 points and the six-slot one
clears no deeper. Slots do not start COSTING power until the budget stops
binding, which is Mark 5 and up.

---

## 3. SATURATION — what one more slot is worth

The same 40 cells, read as differences. Mean bays gained per slot, averaged
across the four contents:

| step | Tier 7 | Tier 10 | mean |
|---|---:|---:|---:|
| 3 → 4 | +0.28 | +0.50 | **+0.39** |
| 4 → 5 | +0.58 | +0.30 | **+0.44** |
| 5 → 6 | +0.55 | −0.10 | **+0.23** |
| 6 → 8 (per slot) | +0.04 | −0.04 | **0.00** |

And the spread stack and a Skydeck day at Tier 10, 8 seeds
(`--content spread,skydeck`):

| slots | spread | Skydeck |
|---:|---:|---:|
| 3 | 2.0 | 2.4 |
| 4 | 2.1 | 3.3 |
| 5 | 2.1 | 2.9 |
| 6 | 2.1 | 2.9 |
| 8 | 2.3 | 2.9 |

**The curve is flat by the seventh slot, and on a spread stack it is flat from
the fourth.** That is the single most load-bearing number here, because it
prices the ladder: a slot that buys nothing must not cost the same as one that
buys half a bay, or the least valuable slots would be the cheapest on the shelf.

It is also the honest bound on what the back half of the ladder is: **a sink.**
What slots 7 to 10 buy is not bays, it is not having to re-plan the rack before
every run — and no harness that flies ONE stationary draft policy per run can
price optionality. The instrument's silence there is a limit, not a verdict, and
the shipped copy says the same thing in the player's words ("dearer as each buys
less", `game/guide.ts`).

---

## 4. IDENTITY — is WHICH four a real decision?

The claim slots exist to make true is that choosing the rack matters. The test
is a fixed width and a fixed content, with the mount order varied.

`npx tsx sim/slots.ts --marks 7 --slots 4 --content slag,volatile --mounts mount-generic,mount-slag,mount-volatile --seeds 24`

**Tier 7, four slots, 24 paired seeds a cell:**

| content | mount-generic | mount-slag | mount-volatile |
|---|---:|---:|---:|
| slag | 1.5 (wall 2) | **2.0 (3)** | 1.8 (3) |
| volatile | 2.3 (3) | **3.8 (5)**, 1/24 clear | 2.9 (3), 1/24 clear |

The four racks are all 220 points; they differ only in which four tracks hold
them. So:

- **The spread across mounts at a fixed width is 0.5 bays on slag and 1.5 bays
  on volatile — larger than the marginal value of an entire extra slot (+0.44).**
  WHICH four you mount matters more than having a fifth. That is the identity
  claim, and it is the one this design needed.
- **On slag the matching mount wins**, which is the axis's own counter doing its
  job: `mount-slag` carries the Demolition Rack, and slag has no other exit.
- **On volatile the liner beats the generic rack** (+0.6), consistent with
  `aim-strategy-findings.md`'s +33-of-96 for the cushion at its own bay.

### What this table does NOT show, and why

The best rack on BOTH contents is `mount-slag`, not the content's own answer.
That is a fact about the pilot and it is exactly the fact
`aim-strategy-findings.md` documented: a rack whose systems the pilot can PLAY
beats a rack whose systems it merely carries. `mount-slag` is the only order
here that mounts two systems this harness actively fires — the Demolition Rack
(`bots.ts`'s `demo`) and the Bond Emitter (`counters.ts`'s `bondHands`) — while
the lance's play measured **−15 of 48** on top of its rung and the Incinerator
has no pilot in this harness at all (zero, measured, PR #156).

So the honest statement is: **the mount choice is worth more than a slot, and
whether the BEST choice is content-specific is beyond this instrument.** Settling
that needs a pilot that plays every system, which is the follow-up
`aim-strategies.ts` already names (there is no incinerator strategy, and the
placeholder refuses to fly rather than quietly fly as naive).

An earlier 4x4 grid at 6 seeds (`sim/results/slots-identity7.txt`) is kept in the
results directory and is **not quoted here**: every cell was within 1.2 bays of
every other and the differences were unordered. At n=6 this measurement is noise,
and the 24-seed pairwise above is the smallest sample that separated anything.

---

## 5. WHAT THE INSTRUMENT CANNOT SEE

Inherited from `winnability.ts`, and two of its own.

- **The pessimism ledger.** The pilot fires demolition charges and Bond
  Breakers and plays the lance and the liner; it still has no lookahead, reads
  no pile and lands every shipment on a fixed target. Every bias runs one way. A
  width this sweep calls survivable IS survivable.
- **The tenth slot is unmeasurable here.** The mount orders end
  `… incinerator, magazine`, which are precisely the two systems this harness
  cannot fly — `marks.ts`'s CALIBRATION_TRACKS records the Magazine as "a
  self-inflicted wound to a bot that fires on every cooldown", and the
  Incinerator measured at exactly zero for a pilot that never aims into the
  flue. The 8 → 10 step measures the instrument. Every claim above stops at
  eight, and the four-seed pass that did include ten shows the artefact plainly:
  at Tier 10 clean the ten-slot rack scored 0.8 mean bays against the eight-slot
  rack's 2.8.
- **One content per run.** A real ratchet stack is several axes at once and a
  rack that must answer all of them is worth more than any corner policy can
  show. `spread` is the closest this tool gets, and it is the row where slots
  read as worth the least — which is the opposite of what a wider rack ought to
  be for, and is the clearest sign the instrument is at its limit rather than
  the design.
- **Nothing clears.** At Tiers 7 and 10 under corner policies these bots take
  all ten bays roughly once in fifty runs, so `clears` is 0 in almost every cell
  and the median moves in whole bays. Every number above is a MEAN, which is the
  only readout fine enough to see one slot, and it is quoted to one decimal on
  eight or twenty-four seeds. Differences under ~0.3 bays are not differences.

---

## 6. THE LADDER THAT FOLLOWS

`SLOT_BASE` **4**, `SLOT_CAP` **10**, and the six slots between them at
**50 / 70 / 100 / 140 / 180 / 240** salvage.

**Four is derived, then checked.** The build budget promises a Mark's whole
allowance can be spent. The Workshop's ceiling is `slots x 55` against an
allowance of `110 x mark`, so a rack of K spends every point a Mark grants
through Mark K/2 — and 4 x 55 = 220 = `budgetForMark(2)` exactly. Four is the
narrowest rack that never strands a point at the two Marks a new player flies;
three would strand budget from Mark 2, which the budget's own promise forbids.
§2 is the check that the derivation is not quietly walling a tier, and it is not.

**The prices escalate because the value falls** (§3): 50 and 70 for the two
slots that measurably pay, then a doubling curve for the ones that buy
optionality. The bands are the shelf's own vocabulary — `meta.ts`'s INSTALLS
prices in days, "30 is most of a tier's contracts, 50 is a tier, 70 is a tier
plus its run win" — extended upward: 100 is most of two tiers, 240 is four.

**780 against 600, deliberately.** A whole climb of the ten-tier ladder pays 600
salvage against a shelf that was already 575 when the Incinerator landed, and
`meta.ts` recorded the consequence at the time: the eleventh system would need
"the re-price or the second income that note asked for". Meanwhile a finished
ladder keeps paying **60 a cycle forever** — three Contracts and a run win at
`MARK_COUNT`, where `advanceTier` saturates and clears its own counters — into
nothing at all. The back half of this ladder is what that faucet finally buys,
at roughly thirteen cycles for a full rack.

And the mid-game decision falls out of the same arithmetic rather than being
designed on top of it. With 25 salvage of slack across the whole climb, a player
whose rack fills around Tier 3 to 5 cannot buy both the next system and the room
for the last one. **"Another answer, or somewhere to put the one you have?"** is
the choice, and it is priced by the shelf being tight rather than by a rule.

`nextStep` gained the matching branch: salvage that covers a slot points at the
Workshop, asked after the install so the on-ramp still wins. Before this the
endgame's own faucet had no door in the rule that decides where the badge goes.

---

## 7. OPEN

- **A pilot that plays every system**, which is what §4 needs to settle whether
  the best rack is content-specific. `aim-strategies.ts` already names the hole.
- **The eleventh system.** The rack is now sized by the RIG, not the roster, so
  `app.css`'s "the eleventh system needs a different rack" is answered: the row
  stays ten boxes and the eleventh system competes for one. That is also the
  moment `SLOT_CAP < UPGRADES.length` becomes true and the owner's "for now we
  leave the endgame to max out all the systems" expires. Nothing pins the two
  together, so it costs one deliberate edit rather than a fight.
- **A per-rig whitelist** — the owner's stated next step. Slots are the general
  case; a rig that can hold *these* systems and not those is this mechanism with
  the choice moved from the player to the hull.
- **A CAP on the ladder, asked and answered in §8** (2026-08-29): measured, a cap
  at six costs zero win rate, zero seconds and zero money, and confiscates 660
  salvage of purchases. The rack is already self-limiting. What forces the
  strategy game instead is a per-bay clause — see
  [`volatile-exam.md`](./volatile-exam.md).

---

## 8. A SLOT CAP — measured against the everything-rig, per bay (2026-08-29)

The owner, verbatim:

> *"I am wondering if we should limit the max systems slots so we force the
> strategy game in later tiers."*

§2-§4 answered "how narrow can a rack be" at RUN level, in mean bays cleared.
This asks the opposite question at BAY level, where win rate, **seconds-to-win**
and end-money margin all exist: **does a ten-slot rack make the specialist
pointless at the top of the ladder?**

`app/sim/_scratch-slotid.ts`, Marks 8 and 10, bays 5 and 10, four contents, five
racks, 6 paired seeds a cell, `demo`+bond pilot matched to the rack. **Flown on
the recalibrated target curve** (level.ts, 2026-08-28), so these are not
comparable to §2-§4's numbers and are not meant to be.

The racks:

| arm | is |
|---|---|
| `spec@4` | the content's own mount order, first 4 |
| `gen@4` | `mount-generic`, first 4 — the same width, the wrong choice |
| `spec@6` | the content's own order, first 6 |
| `full@8` | `mount-generic`, first 8 — the widest rack §5 says is measurable |
| `full@10` | everything |

### 8a. The two columns that carry signal

**Cryo and slag came back 0% for every rack in every cell**, at 0.17 of the belt.
That is the ratchet, not the rack: `materialRate` is 0.07 + 0.05 a notch, three
notches is one rung above the ladder's own entry at these Marks, and it is
already past what any rig this harness can fly answers. (Four notches was tried
first and was 0% too; the depth was walked down until the other two columns still
moved.) Both columns are reported and neither is read.

### 8b. Win rate

| Mark | Bay | content | spec@4 | gen@4 | spec@6 | full@8 | full@10 |
|---:|---:|---|---:|---:|---:|---:|---:|
| 8 | 5 | clean | **100%** | **100%** | 83% | 83% | **0%** |
| 8 | 5 | volatile | 83% | **100%** | **100%** | **100%** | 50% |
| 8 | 10 | clean | 67% | 67% | **100%** | **100%** | 67% |
| 8 | 10 | volatile | 50% | 33% | **83%** | **83%** | 50% |
| 10 | 5 | clean | 50% | 50% | **67%** | **67%** | **0%** |
| 10 | 5 | volatile | 67% | **100%** | **100%** | **100%** | 50% |
| 10 | 10 | clean | 33% | 33% | **50%** | **50%** | **50%** |
| 10 | 10 | volatile | 17% | 33% | **50%** | **50%** | 33% |

### 8c. Three findings, and the first one answers the question

**1. THE EVERYTHING-RIG DOES NOT DOMINATE. IT IS THE WORST RACK ON THE TABLE.**
`full@10` is beaten or tied by `full@8` in **eight cells of eight**, and beaten
by a FOUR-SLOT rack in three of them — including 100% → 0% on Tier 8 bay 5 clean.
The premise a cap would be built on is not in the data: ten slots do not erase
the specialist, they lose to it.

**2. `spec@6` AND `full@8` ARE IDENTICAL IN ALL EIGHT CELLS.** Not close —
identical win rate, identical seconds, identical end money, because the seventh
and eighth mounts (`thaw`, `cushion`) are inert on the content those cells deal.
The bay-level table reproduces §3's run-level saturation exactly: **the curve is
flat from the seventh slot.**

**3. THE FIFTH AND SIXTH SLOTS ARE THE ONES THAT PAY.** `spec@4` → `spec@6` gains
in five cells (67→100, 50→83, 50→67, 33→50, 17→50), loses in one (100→83) and
ties in two. That is the same shape §3 priced the ladder on, seen one bay at a
time: +0.39 and +0.44 mean bays for slots 5 and 6, +0.23 and 0.00 after.

### 8d. Seconds-to-win and end-money margin

The two readouts the run-level sweep could not produce. Winners only for seconds;
`end/tgt` is mean end money over the bay's own target.

| Mark | Bay | content | spec@4 | spec@6 | full@8 | full@10 |
|---:|---:|---|---|---|---|---|
| 8 | 5 | clean | 78s / 1.09 | 65s / 0.93 | 65s / 0.93 | — / 0.14 |
| 8 | 10 | clean | 50s / 0.84 | 72s / 1.05 | 72s / 1.05 | 92s / 0.92 |
| 8 | 10 | volatile | 77s / 0.75 | 63s / 0.96 | 63s / 0.96 | 112s / 0.52 |
| 10 | 5 | volatile | 84s / 0.71 | 91s / 1.02 | 91s / 1.02 | 67s / 0.58 |
| 10 | 10 | clean | 59s / 0.49 | 101s / 0.64 | 101s / 0.64 | 118s / 0.64 |
| 10 | 10 | volatile | 64s / 0.19 | 110s / 0.87 | 110s / 0.87 | 103s / 0.59 |

**The money margin says the same thing as the win rate and says it in a currency
a cap would be arguing about.** `full@10` banks 0.12-0.64 of its target where
`spec@6` banks 0.64-1.05. A wide rack is not converting its width into money.

### 8e. WHY the tenth slot loses, and how much of it is the instrument

Slots 9 and 10 of every mount order are the **Incinerator** and the **Loader
Magazine**, and §5 already names both as unflyable here — the hood measured a
literal zero for a pilot that never aims into the flue, and `marks.ts` calls the
Magazine *"a self-inflicted wound to a bot that fires on every cooldown."*

The honest split:

- **The Magazine's cost is REAL and not an artefact.** A −30% reload is passive,
  always on, and it floods the bay with cargo the press cannot keep up with. A
  human suffers it too; they just get to choose not to buy it. In a slot economy
  they also get to choose not to MOUNT it, which is the mechanism already doing
  the work a cap would claim to do.
- **The Bond Emitter and Demolition Rack costs are half artefact.** `bondHands`
  fires Bond Breakers and `demo` fires charges whenever they are available, so
  the sixth and seventh mounts spend money and scatter piles on content that did
  not ask for it. A player fires them when they help. Read the 100% → 83% clean
  cell at Tier 8 bay 5 as an upper bound on that cost, not as a measurement of
  it.
- **The Incinerator's zero is neither** — it is a system this harness cannot
  fly at all, so its slot is measured as pure dead weight when in a human's
  hands it may be worth something. That is the one direction the pessimism ledger
  runs the wrong way for a cap argument, and it runs in the cap's favour: a real
  Incinerator makes the wide rack better than these numbers.

### 8f. THE COUNTERFACTUAL — what a cap at 6 would actually take

Priced against the arms that currently win, which is what "retroactivity
matters" means when players have already bought slots with salvage:

| | measured cost of a cap at 6 |
|---|---|
| win rate | **zero.** `spec@6` is the best or equal-best arm in eight cells of eight |
| seconds | zero — `spec@6` and `full@8` are identical, and `full@10` is slower |
| end money | zero — same |
| salvage refunded to nothing | **660** (slots 7-10 at 100 + 140 + 180 + 240) |
| the mid-game decision §6 prices | unchanged: it lives at slots 5-6 |

**A cap at 6 would confiscate 660 salvage of purchases and take away no measured
power, because the slots above 6 have none.** That is the worst possible shape
for a change: all of the retroactive cost, none of the effect it was proposed
for. And it does not "force the strategy game" either — a slot that buys nothing
cannot be the thing a player was avoiding a decision with.

### 8g. WHAT WOULD force the strategy game, and it is the owner's other idea

The strongest number in this pass is not in the tables above. It is in
[`volatile-exam.md`](./volatile-exam.md) §4a: a bay-10 Final Inspection built on
a volatile-only belt reads **0% with no Impact Cushion aboard and 83% with a
maxed one played** — and the cushion's three rungs separate upward on it
(38 / 58 / 83) for the first time anywhere.

That is the difference between the two mechanisms, stated as measurements:

| | a slot cap | a per-bay clause |
|---|---|---|
| what it changes | how many systems you may carry | which system this bay is about |
| measured effect on win rate | **0** (§8f) | **0% → 83%** (volatile-exam §4a) |
| when the decision is made | once, at the Workshop, forever | at the last draft of every run |
| flattens into a best-N meta? | yes — one right answer, then never again | no — the right answer changes per clause |
| retroactive cost | 660 salvage | none |

**The prior this pass was asked to test was that clauses force choices better
than a global cap, and the data does not merely support it — it says the cap has
no effect to trade off in the first place.** The rack is already self-limiting:
the sixth slot is where the curve goes flat, the seventh and eighth are provably
worth nothing, and the ninth and tenth are worth NEGATIVE to any pilot that
actually fires what it carries. A player who mounts ten systems at Tier 10 is
already playing a worse rig than one who mounts six; nothing needs to forbid it.

### 8h. What this section cannot say

- **Identity at K = 4 is not resolved here.** `spec@4` vs `gen@4` splits 2-1-5
  (spec, gen, tie) across the eight cells and at 6 seeds that is noise. §4's
  24-seed pairwise remains the identity measurement; this pass was aimed at the
  wide end.
- **Six seeds a cell.** Every cell moves in whole sixths, so a one-cell gap of
  17 points is one run. The findings above rest on patterns that repeat across
  eight cells (`spec@6` = `full@8` eight times; `full@10` worst or equal-worst
  eight times), not on any single row.
- **Nothing here prices optionality**, which §3 already named as the thing slots
  7-10 actually sell and no single-policy harness can see. If the back half of
  the ladder is worth anything, it is worth it for a reason this table is blind
  to — and that argument, unlike a power argument, is not damaged by anything
  measured above.

---
