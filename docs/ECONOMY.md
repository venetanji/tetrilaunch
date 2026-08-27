# Economy & progression design

The record of what the three-currency rework is trying to do, so the numbers can
be tuned later without re-deriving the intent.

## The problem it replaced

The old economy had one currency. Funds were the score, the bay target, the
launch cost and the leaderboard entry all at once. Two things fell out of that:

1. **Bombs were dominated at every funds level.** A bomb consumed a full-price
   launch and paid literally nothing. There was no funds level, no pile state and
   no bay where firing one was the correct play — it was strictly worse than
   firing a piece. The mod existed but had no economic argument for taking it.
2. **A lost run paid nothing.** Ten bays, one currency, and death wiped it. The
   runs where a player most needs a new option to try — the ones that ended badly
   — were the ones that gave them nothing.

Two observations from playtesting shaped the fix:

- *"When money is tight it forces you to aim well; with lots of money you can
  stash — invest in launches — then break bonds and clear lots of lines at the
  end."* Tight funds and loose funds produce genuinely different, both-valid
  play. That's worth protecting: funds stay the bay's operating constraint, and
  nothing else got layered onto them.
- *"Wind against sometimes makes it impossible to win unless you extend to 18
  lines — it can feel a bit unfair."* A bay whose rolled headwind puts the back
  of the field out of reach isn't difficulty, it's a dead run the player can see
  coming and can't act on. The answer had to be an **agentive** one: a system the
  player can choose to invest in.

## The tier ladder — what a bay costs and pays at each Mark

The Deep Run bay used to demand the same thing at every Mark: $800 on the first
bay, a 150s clock, $25 a shot. The tier being flown now states all three
(`level.ts`'s `targetScoreFor` / `timeLimitFor` / `launchCostFor`), extending
that bay downward for a new player and upward for a veteran. The ladder's own
per-bay climb (`TARGET_PER_BAY`) is unchanged and rides on top — the tier sets
where the climb starts and steepens it slightly.

| Tier | Target, bay 1 → bay 10 | per bay | Clock | Launch | Float | Spill fine, bay 1 → bay 10 |
|---|---|---|---|---|---|---|
| 1 | $600 → $1500 | +$100 | 180s | $20 | $160 | $1 → $1 |
| 3 | $640 → $1576 | +$104 | 172s | $22 | $176 | $6 → $10 |
| 6 | $700 → $1690 | +$110 | 160s | $26 | $208 | $14 → $24 |
| 10 | $780 → $1842 | +$118 | 144s | $30 | $240 | $25 → $43 |

### The spill fine rides the ladder too

`penaltyPerLostPiece` was the last flat number on the bay: 25 + 2i at every
tier. It is billed **per cube**, so one bounced tetromino cost a Tier 1 player
$100 against a $160 float — 62% of the opening runway on a single bad shot, with
the bay unrecoverable after two. That is the beginner report; the fine was not
teaching precision, it was ending the lesson before it started.

It now ramps linearly across the tiers (`level.ts`'s `penaltyPerLostPieceFor`),
from $1 a cube at Tier 1 to exactly the historical ladder at Tier 10 — two named
endpoints (`SPILL_FINE_TIER1`, `SPILL_FINE_TOP_BASE`/`_PER_BAY`) and a straight
line between them, the same shape the other three tier curves have. Not zero at
the bottom, deliberately: a free spill would delete the rule on the very tier
the guide teaches it on.

Measured, `sim/sweep.ts`, bays 1-3, 5 seeds, no mods, before → after:

| Tier | Bay | `lob` | `lob-flat` | `aim` | `impatient` |
|---|---|---|---|---|---|
| 1 | 1 | 0% → **40%** | 0% → **20%** | 80% → 80% | 60% → 60% |
| 1 | 2 | 40% → **60%** | 20% → **40%** | 60% → 60% | 60% → **80%** |
| 1 | 3 | 0% → **40%** | 0% → **40%** | 40% → 40% | 80% → 80% |
| 2 | 1 | 0% → **40%** | 0% → **40%** | 80% → 80% | 60% → 60% |
| 2 | 2 | 40% → 40% | 20% → **40%** | 60% → 60% | 60% → **80%** |
| 2 | 3 | 0% → **40%** | 0% → **60%** | 40% → 40% | 80% → 80% |

The shape is the whole argument, not the deltas: the two SLOPPY bots (fixed lobs
that spill routinely) go from shut out of bays 1 and 3 entirely to winning some
of them, while `aim` — the calibration bot — is **byte-identical in all six
rows**: same win rate, same median seconds, same shots, same lines. The fine
only ever bit the player who was already missing. Bot caveats as always: no Bond
Breaker, only `demo` fires charges, fixed arcs never read the pile, so a human
clears bays these bots lose.

### The fine must always leave you another shot

The bar is not "you still have money". `game.ts`'s `fire` refuses to launch once
funds drop below `launchCost`, so a bankroll stranded under the price of a shot
is a **dead bay with a non-zero HUD**. Stated in shots, over the worst case a
stock bay can produce — opening float, one launch paid for, every cube of that
shipment spilled:

```
startingFunds − launchCost − cubes × fine  ≥  launchCost
```

Measured over all 10 bays × 10 tiers with the shipment a Deep Run bay actually
ships (`std`, 4 cubes):

- **After the ramp: 0 violations.** Tightest is Tier 10 bay 10 — $240 − $30 −
  4×$43 = **$38 against a $30 shot**, $8 of slack.
- **Before, on the flat fine: 32 of 100 bays failed.** From **bay 4 of a Tier 1
  run** onward ($160 − $20 − 4×$31 = $16 against a $20 shot) down to **−$52 at
  Tier 1 bay 10**, where one fully-spilled shipment on the opening float ended
  the bay outright.

So the flat fine really was the lose button its own comment claimed to prevent,
and the beginner report was reading a live bug rather than a taste problem.

**Known headroom, not a shipped hole.** At a `bulk` shipment's 5 cubes the same
arithmetic gives $240 − $30 − 5×$43 = **−$5** at Tier 10 bay 10 (8 of 100 bays
fail, all at Tiers 8–10). Nothing in a Deep Run ships bulk today — `mods.ts` is
the only writer and the game no longer drafts mods, while `contracts.ts` and
`drills.ts` write it but zero the fine. The pin reads `cubes` off the bay's own
`pieceSize`, so the day a Deep Run bay ships bulk this fails by itself. Left as
a tripwire deliberately rather than moving an endpoint the design decided.

Three things the ladder still deliberately does **not** touch:

- **The mistake budget stays eight launches** (`LAUNCH_BUDGET_SHOTS`). The float
  is derived from it rather than fixed in dollars, so a dearer shot at a high
  tier costs more money for the same runway instead of quietly shortening it —
  the sweep pinned the shot count, not the $200.
- **`scorePerLine` stays tier-invariant** (100 + 10/bay). A higher tier is *more
  lines*, not richer ones — which is why the leaderboard is per tier now: a
  shared board would rank the ladder rather than the play.
- **Contracts and drills still charge nothing for a spill** (`levelForContract`
  and `levelForDrill` both zero the fine). A Contract has a tier, so the ramp
  *could* reach it — but it has no bankroll, no launch price and no funding
  target, so a fine has nothing to be measured against. The answer to a spilled
  cube there is already the harshest the mode has: one fewer shipment left in
  the launch budget.

## Three currencies, three horizons

| | Lifetime | Earned by | Spent on |
|---|---|---|---|
| **Funds `$`** | one bay | line payouts, bomb salvage | launches. Also the bay's own target. |
| **Scrap `♻`** | one run | 2/line, 10/bay cleared | ship upgrades at refit stops |
| **Salvage** | forever | tier milestones — each of the tier's three first-clear Contracts, and its Deep Run win | permanent installs and unlocks in the Workshop |

They are deliberately **not** interchangeable. Funds are operating budget, scrap
is capital, salvage is R&D. Banking a huge surplus never buys upgrades, and a
rough bay you barely survive still moves the build forward. That separation is
what keeps the three decisions distinct instead of collapsing into "get more
money".

## The ship (FTL layer)

The compactor rig **is** the ship: fixed stock size, refitted with scrap at
**refit stops after bays 3, 6 and 9**. Nine systems, three tiers each, one
shared price ladder of **20 / 35 / 55** scrap (110 for a full track).

| Track | Tiers | What it's for |
|---|---|---|
| **BAY** | +2 / +4 / +6 open cells (→18) · +4 / +8 / +12 cubes before congestion | The "extend to 18" lever, and now the only one — the draft's old Wide Bay offer is gone, so width is earned capital rather than a roll. Buys **room and congestion headroom**: `pileAllowance` rises +4 a tier and lifts *every* knee, so the first tax moves from 32 cubes to 44 at T3. On the room half, `compactorSpeedFor` scales the bar's speed with its span, so a wider bay no longer stretches the press cycle. It used to — T3 took the cycle from 4.4s to 11.1s while the card advertised nothing but space, which made the most expensive purchase in the track a stealth *difficulty cut*. |
| **LAUNCHER** | +6/12/18% muzzle speed · 20/40/60% wind cancelled | **The wind answer.** More speed to throw through a headwind, plus a stabilizer that cancels part of it outright. |
| **HYDRAULICS** | ×1.6/2.2/2.8 settle assist · +8/16/24% stroke | Turns "nearly a line" into a payout. The upgrade for builds that land loose cubes. |
| **MAGAZINE** | −15/30/45% cooldown | Tempo. |
| **REACTOR** | +$60/120/180 float · +$15/30/45 per line | The economy track. |
| **BONDS** | +1/2/3 Bond Breaker charges **per run** · T2/T3 stamp S/Z bonds 30/50% weaker | Compaction for builds whose pieces don't flatten their own pile. The magazine belongs to the run, not the bay (`run.ts` overwrites the per-config grant with what's actually left), and the Seam Splitter passive is what the higher tiers newly pay for. |
| **DEMOLITION** | +2/4/6 charges per bay · T3 also returns +1 charge every 4 lines | Slag's only clean answer, and the salvage tool that gives a dead pile a price. |
| **THAW** | +3/6/9 Thaw Lance charges per bay | **Cryo's only bought answer.** A charge thaws the frozen cube the press is about to reach — `strikeCryo`'s sequencing cost paid out of a charge instead of out of a launch. It does not touch `shatterColdCryo`: a cube you ignore still breaks and still knocks its row off the grid, which is what keeps cryo about sequencing rather than about owning a system. **On the Skydeck the rack does not renew** — no yard, no resupply, so the charges are a run-long magazine there and a per-bay one on the ladder. |
| **CUSHION** | a shock liner 4/6/8 cells deep at the wall, softening arrivals ×1.15/1.30/1.40 | **Volatile's only bought answer**, and the only track whose effect is POSITIONAL — cargo landing in the lined slots takes a much harder shot before it goes off, and cargo landing short of them is untouched. The depths are sized from where detonations actually happen (41,393 measured first-contacts; a liner 8 cells deep covers 98% of them) and the top rung is `compactorMinLineCells` — the liner covers the slots a line is made in. It buys back the ARRIVAL and nothing else: a cube still goes off when something lands hard on top of it, still goes off outside the liner, and still bills the bay for every live cube it takes. So a rung buys a DEFERRAL rather than a deletion — every shipment it saves is a cube left lying in the line zone with a stock trigger on it, and the play the system asks for is to close that row before something lands on it (measured: `winnability-sweep-findings.md` §5b-ter). Passive, so it has no charges and the Skydeck's no-resupply rule does not reach it. |

**The stop is a plan, not a checkout.** Tapping a track *stages* a tier into an
order; nothing is paid for until **Undock**, which installs the lot in one
commit. That is what makes the stop's own claim — every track visible with its
whole ladder, because a refit is a build you commit to — actually true: a player
can assemble two rival builds and read what each does before spending a point of
scrap. While an order is staged the yard prices every remaining button against
what is *left* after it, and the projection beside the shelf redraws the next
bay's numbers with the whole order installed (drawn from `levelForRun`, so it is
the bay that will actually be flown).

**Income sizing.** A won bay clears ~12 lines → ~35 scrap (measured with
`sim/sweep.ts --bays 1,4,7,10 --seeds 4 --bots aim --mark 1`: won bays of 6–23
lines, mean 12.4). Stops arrive at roughly 105 / 210 / 315 cumulative scrap. A
refit only RAISES a track the Workshop already installed — `run.ts`'s
`buyUpgrade` refuses a tier-0 one — so the first stop buys "two owned tracks to
tier 2, or one to tier 3", never a new system. An FTL-shaped choice, not a
shopping spree.

**Upgrades vs. ratchets** are different in kind, and both exist on purpose:

- A **ratchet notch** is a hand you were *dealt* — two seeded axes at every
  bay-clear but the last (`hazards.ts`'s `hazardOffers`, count = 2; the draft
  after bay 9 deals the Final Inspection instead), and you don't pick which two
  you see. You take one, or two at the capstone (`picksPerBay`), and it sticks
  for the rest of the run. Unlike the mod draft it replaced it is never a
  trade-off: a notch is pure cost, and the compensation is bought in the
  Workshop.
- An **upgrade** is capital you *chose* to spend from a fully-visible menu with a
  known price. Nothing in a track is a downside; the cost is the opportunity cost
  of the scrap.

Application order is fixed in `run.ts`'s `levelForRun`: **upgrades, then
ratchets, then the Final Inspection's clause on bay 10**. A notch compounds on
top of whatever ship you refitted. The carry is added dead last so it is never
scaled by either — cash in hand, not a rate — and the bond magazine is written
last for the same reason.

## Bombs, made legible

Demolition Charges are now a **consumable**, not a launch cadence:

- **Armed**, not fire-on-tap (💥 / `X`), so the shot still goes where the player
  aimed and the muzzle ghost promises what actually fires.
- **Free to fire** — no launch cost. It was already paid for when drafted.
- **Refunds `$8` per cube vaporized**, plus a stingy trickle of scrap.

That refund is the whole point: it gives the bomb a price the player can reason
about. A cube in a pile that will never complete a line is worth **$0** as line
material and **$8** as scrap metal — so demolishing junk is a positive-value
play, while blowing up a row you were two cubes from closing is a clear,
self-inflicted loss. Both sides of the trade now exist, which is exactly what the
old version lacked.

## Slag: a bounty, and a resupply line

Slag was the one material that was never anything but a loss, and `hazards.ts`
said so out loud — "the one material with no passive counter". The Final
Inspection pass measured
the cost from the other side: one notch at the ladder's gentlest rate takes the
`aim` bot from 100% to 0%, because it cannot fire the charge that is slag's only
exit. Two different failures hid under that, and they got two different answers.

**You run out of bombs.** A bay is long enough to out-last six charges — the
Tier 6 `Slag Wall` clause opens one on 11 cubes of the stuff — and the seventh
dead shipment had no answer at all. That is scarcity, and no payout fixes it. So
the **maxed** Demolition Rack now returns a charge every **4 lines**, mid-bay:
~8 charges on a clean bay instead of 6, and a long grinding bay keeps paying.

The loop is circular on purpose. Resupply is earned in lines and slag is what
stops you clearing lines, so the tier pays out for charges spent *unblocking
rows* rather than hoarded. It will not rescue a bay that is already buried, and
should not. It also makes that capstone a change in **kind** rather than another
`+2`, which is the shape the track's own note was already reaching for ("a charge
you can PLAN for beats a charge you might be dealt").

**Slag has no upside.** A volatile detonation now pays **$20 per slag cube** it
removes — `$8` of scrap metal plus a `$12` denial premium, since a slag cube is
worth $0 as line material for its whole life *and* holds a slot in a row nothing
can close.

This looks like the payout `resolveVolatile` explicitly refuses, and the
distinction is the whole licence for it. That refusal is about paying for a
*detonation*: "paying for it would make ratcheting the volatile axis an income
strategy, which is the exact inversion of a hazard." The bounty is a property of
**slag**, not of volatile — live cargo a hazard obliterates is still a total
loss, so a run that ratchets volatile alone earns nothing from it. The money
exists only where the player took a **second** axis on purpose. Two ratchets,
one build.

The play was already the designed one. `lineClear.ts` names the answer to
volatile as "deliberately chaining it into a pile that was never going to
complete a row anyway", and a slag pile is definitionally exactly that. It just
paid nothing.

**Bombs keep no slag premium.** The denial premium stays exclusive to volatile,
which keeps the strategy's identity: the *renewable* channel is the profitable
one, because a bomb is capped per bay and the belt is not.

What a bomb pays did move, but on the **rack**, not on slag — see the capstone
below.

### The capstone: charges were not the whole answer

The resupply line answers "you run out of bombs" and answers it correctly. It
does not answer the bay a Tier-10 playtest actually lost: with replenishing
bombs aboard, *"I still couldn't clear all the slag and couldn't make new lines
because tar everywhere."* That is not a bay short of charges. It is a bay where
each charge does not do enough, and where what one returns no longer keeps up
with what a launch costs.

So the maxed rack now moves three numbers instead of one:

| | stock | maxed rack |
|---|---|---|
| charges per bay | — | **+6**, and **+1 every 4 lines** |
| blast radius | `CELL × 2.4` | **×1.35** — ×1.8 the *area* |
| salvage per cube | $8 | **$12** |

**Radius, not another `+2`.** Tar is the case the stock radius handles worst:
tar's welds are the one joint neither the press nor a Bond Breaker can split
(`game.ts`'s `resolveTarWelds`), so vaporizing the cubes is the *only* thing
that opens a crust — and a stock blast takes a bite about a piece wide out of
one that spans the bay. Area goes as the square, so ×1.35 on the radius is the
difference between chipping at a crust and cutting through it, while still
landing well short of the Bond Breaker's field-wide reset.

**$12 keeps disposal worth the shot.** `salvagePerCube` was tuned against a
Tier-1 launch at $20; at Tier 10 a launch is $30, so a line-sized salvage — 8
cubes, $64 — no longer covered the shots spent placing the row it unblocked. At
$12 that clear is $96, which is still under `scorePerLine` (100 + 10i, before
combo) at every bay. The hierarchy above survives intact: disposal clearly beats
the launch, and never out-earns playing the game.

Both are the **capstone only**. Tiers 1 and 2 stay a flat `+2`, so the track
keeps its shape — quantity, quantity, then a change in kind.

Sized to sit between two things. A volatile lobbed into a three-slag cluster
returns $60 against a launch that costs $20 at Tier 1 and $30 at Tier 10, so
disposal is clearly worth the shot; a line still pays 100+ before combo, so
disposal never out-earns playing the game — the same hierarchy the bomb's
quarter-rate scrap trickle already protects. Funds
only, no scrap: this is a bay-local relief valve, and paying scrap would turn a
slag ratchet into a route to permanent progression.

**Still to verify on device.** The bots cannot fire a charge or lob a soft
volatile, so neither half of this is measurable in `sim/sweep.ts` — the same
blind spot the Bond Breaker and Autoloader sit in. The numbers are reasoned, not
calibrated.

## Payload sizes

`pieceSize` drives cube count, per-cube **density** and joint **fragility**
together — so "tiny" isn't just smaller and "bulk" isn't just bigger.

| | Cubes | Density | Break threshold | Plays like |
|---|---|---|---|---|
| **tiny** (Micro) | 2 | ×0.70 | ×0.60 | Cheap, precise, brittle — and **too light for its own weight to square up the pile below it**. |
| **std** | 4 | ×1.00 | ×1.00 | Baseline. |
| **bulk** (Bulk) | 5 (pentominoes) | ×1.35 | ×1.60 | Expensive, rigid, and **heavy enough that landing presses the layers beneath flat**. |

The density asymmetry is the interesting part. A heavy shipment helps the
compactor reach the strict slot grid in `lineClear.ts` by physically settling
what's under it. A light one lands *on top of* a mess without ever fixing it — so
a micro build has to buy its compaction some other way, which is what makes
**Bond Breakers** a build requirement rather than a nice-to-have for that line.

Break thresholds are stamped **per constraint** at spawn, not read from one
global level value, because sizes coexist on the field: a micro run that later
drafts Bulk still has old dominoes lying around and they must keep the fragility
they were launched with.

## The Autoloader (micro endgame)

**Status: built, but currently UNREACHABLE in a shipped run.** The only thing
that writes `autoLaunchMs` is the retired modifier draft (`mods.ts`'s
autoloader, gated on the retired `auto` and `micro` unlocks), and `levelForRun`
never calls `applyMods` — so `stepAutoLaunch` returns immediately and the HUD
never shows the trigger. What follows is the record of the mechanic, not of a
live feature.

It was gated behind the `auto` salvage unlock **and** owning Micro Shipments
that run. **Hold** the rail trigger (or `F`) and the cannon fires every 420ms at
a ±9° spread around wherever you are pointing, at half launch cost, with a
random rotation. Fast, cheap, probabilistic — explicitly not trying to be a good
player.

It only works on top of the build it belongs to: cheap enough payloads to survive
the waste, and Bond Breakers (or Hydraulics) to flatten what it piles up.

It used to fire on a free-running timer, and that was a real bug rather than a
balance problem. Measured on device, one Autoloader bay threw **34 lost cubes
from 32 shots** (1.06 per shot, against a 0.11 baseline) at **16 shots per
line**, and its launches were spread evenly across the compactor cycle (z=0.71
retreat vs press) while the same player's manual shots were strongly biased
toward the open window (z=4.27). A metronome cannot see the compactor, so it
spent about half its shots firing into a shut bay and paying the lost-piece
penalty. Holding a trigger puts the WHEN in the player's hands and leaves the
WHERE scattered, which is the upgrade's identity: a stream you point and time,
never a better cannon.

## Salvage: tier milestones, not run receipts

Salvage is banked by **tier milestones** (`meta.ts`'s `tierSalvage`), not per
run played: each of the tier's three first-clear Contracts pays a 15-salvage
milestone and the tier's Deep Run win pays the fourth, a flat **60 per tier —
600 across the ten-tier ladder against a ~445 shelf** (installs 300 + the two
live unlocks 145). Grind-proof by construction: a Contract pays only on its
once-ever first clear, only at the current tier, and only for the first three,
so replaying can't farm the currency. (An earlier per-run formula —
`3 + 5×bays + …` — is long gone; this section used to quote it.)

Unlocks add **options**, never flat stat bumps: the bay's wind gets surveyed
before you launch, the first refit stop opens with 30 scrap already banked.
(Those two are the whole live shelf. The other eight entries in `meta.ts`'s
`UNLOCKS` sold a card into the retired modifier draft and are refunded on load.
Demolition, the Bond Emitter, the Thaw Lance and the Impact Cushion are ship systems bought through `INSTALLS`; the
bulk and micro shipment sizes are Deep Run finals clauses now.) That constraint
keeps a veteran's run harder-won rather than merely bigger-numbered.

## Congestion: pricing the spam endgame

**Status: shipped, on every bay.** `makeBaseLevel` carries `level.ts`'s
`PILE_TIERS` on every bay: two knees at **32 and 48** live cubes, charging
**×1.25 / ×2** launchCost, slowing the reload **×1.5 / ×2**, and capping the
line-payout multiplier at **0.75 / 0.5**. The clock burn measured below
shipped **off** (`clockSec: 0` — a 2026-08-22 device playtest read a hidden
bite out of the bay clock as unfair rather than as pressure; the wiring stays
for a future opt-in hazard axis). Everything below is the `npm run sim:pile`
work that shaped the design and is kept as the record of it; where it and the
shipped numbers disagree, `PILE_TIERS`'s note in `level.ts` is the authority —
most notably the bot census argued for thresholds of 48/64, and the owner's
device playtest falsified that (a bot fires every reload and holds roughly
twice the standing pile a human's aimed cadence does; the knees stay at the
human pile's 32/48).

### The problem

A bay's launch budget is loosest exactly when it should be tightest. Late in a
bay the player is sitting on the surplus every cleared line paid out, launchCost
is flat, and nothing prices a shot against the state of the field — so the
dominant endgame is to stop aiming and empty the bankroll into the bay, letting
gravity and the press resolve whatever lands. The economy *rewards* the strategy
that skips the game.

### The rule

Count live cubes on the field. Past a threshold, every launch costs a multiple
of the bay's launchCost and reloads slower, and a clear pays a capped multiple
(the clock-burn variant the sim tested below shipped off — see the status
note). Highest matching tier wins; the tiers do not stack. The tax is charged
**on the shot**, never held against the pile — a player who stops firing and
lets the press work pays nothing, which is what makes this a disincentive
rather than a punishment.

### What the sim found

Three findings, in descending order of how much they should change the design.

**1. The first-guess thresholds were far too tight.** 32 and 48 cubes was pitched
as "four lines' worth of cargo loose on the field, then six", which sounds like a
bay you have let get away from you. Measured (`--census`, `aim` bot, 5 bays ×
16 seeds, re-run on the shipped Tier 1 ladder), the median untaxed field holds
~25 cubes and the p90 is ~47 — and **34% of a clean bot's shots would pay tier
1, 10% tier 2**. At those numbers the tax is not an anti-spam rule; it is a rate
rise with extra steps, and the win rates agree: careful play falls from 84%
untaxed to 71% under `stock`.

**2. No field-state metric identifies a spammer.** `sim/pile-metrics.ts` tested
five readings — total cubes, settled cubes, moving cubes, cubes outside the
zone, cubes still in flight — against a careful bot and an impatient one on the
same seeds. Set any of them gently enough to leave 90% of careful shots untaxed
and it still catches only ~10% of spam shots, which is what a threshold drawn at
random would catch. The reason is structural: both players are capped by the same
cooldown, so the pile they build looks the same. **Congestion measures how far
into a bay you are, not how recklessly you are playing.**

That is not fatal, and it is worth being precise about why. The tax does not have
to detect spam to work — it has to make the correct response cheap and the
incorrect one expensive. "The bay is full, stop firing" is a true statement
whoever hears it, and stopping is exactly the behaviour the design wants.

**3. Money is the wrong axis; the clock is the right one.** Isolating the two
halves at the original thresholds (N=80 per cell, baseline 73% careful / 48%
spam — measured BEFORE #88 on the flat $800 / 150s / $25 / $200 bay, which no
longer exists):

| Tax | careful | spam | gap |
|---|---|---|---|
| none | 73% | 48% | 25 |
| money only (×1.5 / ×2) | 60% | 43% | 17 |
| clock only (2s / 5s) | 71% | 41% | **30** |
| both | 59% | 35% | 24 |

A funds tax turns into **bankruptcy**, which ends a bay early and unrecoverably,
and it does that to the careful player as readily as the reckless one — so it
*compresses* the skill gap, which is the opposite of the point. A clock tax turns
into a time loss, which still lets the bay settle what is in the air, and it
falls hardest on whoever fired the most shots.

**Re-measured after #88, the rates do not survive.** Tier 1 opens at $600 / 180s
/ $20 / $160 instead (`level.ts`'s `TARGET_BASE`, `TIME_BASE`,
`LAUNCH_COST_BASE`, `LAUNCH_BUDGET_SHOTS`), and re-running the same sweep there
at N=80 gives an untaxed baseline of **84% careful / 81% spam** — a gap of 3,
not 25. Every win rate in this section's tables is a record of a bay that no
longer exists. The mechanism is what to keep; the arithmetic on top of it
inverts, because on the Tier 1 bay the shipped `stock` ladder now *widens* the
gap the money-only row used to compress (71% careful / 60% spam under
`stock` — `level.ts`'s `PILE_TIERS`, whose cost multiplier is only one of
its four axes alongside reload, payout and a zero clock, so it is not the
"money only" row above re-run).

### Where the sim landed (superseded on device — see the status note)

Move the thresholds, keep the penalties. At **48 and 64 cubes** with the
originally-specced ×1.5/×2 and 2s/5s, the tax fires on 13% of careful shots
(about 6% tier 1, 7% tier 2) instead of 34%/10%, and:

| | careful | spam | gap |
|---|---|---|---|
| no tax | 73% | 48% | 25 |
| 48/64, ×1.5/×2, 2s/5s | 70% | 39% | **31** |

Careful play gives up 3 points, spam gives up 9, and the spread between them
widens. (Pre-#88 rates again, but the direction is the one thing that did
survive the ladder: re-run on the Tier 1 bay at the same N=80, careful goes 84%
→ 80% and spam 81% → 73%, so the spread goes 3 → 7.) The careful bot also
converts better under the tax than without it (3.9 shots per line against 4.2)
— waiting for the bay to drain means the shot
lands on a settled pile that can actually complete a row, which was true before
the tax existed and is the thing the tax gets the player to notice.

`pileAllowance` adds cubes to every threshold and is the upgrade seam: a track
that raises it sells back the right to fire into a fuller bay. Verified
equivalent to moving the thresholds outright (48/64 and 32/48-plus-16 produce
byte-identical sweeps).

### Caveats the sim cannot see past

- **Sample size.** N=80 per cell puts the 95% interval on any single win-rate
  difference at roughly ±14 points, so no one row above is significant on its
  own. The direction is consistent across every variant tested — spam falls in
  all of them, careful play barely moves in the loose ones — and that consistency
  is the claim, not any single number.
- **The bots cannot spam the way a human does.** Every bot fires the moment the
  cooldown allows, so `impatient` differs from `aim` only in shot *quality*, not
  tempo. The real complaint is about a player emptying a fat bankroll at the end
  of a bay, and no bot models the decision to do that. Telemetry shows humans
  time their shots to the compactor window (z=4.27) where bots do not, so a human
  has counter-play the sim cannot exercise.
- **Nothing here is a substitute for playing it.** The census is a direct
  measurement and should be trusted; the win rates are a direction, not a
  calibration.

## Escalating hazard notches

`Fuel Levy` and `Shift Cut` used to charge a flat +$5 and −5s however many
notches deep the run already was. Linear is the wrong shape for a ratchet taken
one notch at a time: under a flat step the tenth notch is the same decision as
the first, so the axis a player opened early never stops being the cheapest card
on the table and the draft collapses into one axis repeated.

Both now run Fibonacci ladders — time `1, 2, 3, 5, 8, 13`, money `1, 1, 2, 3, 5,
8`, continuing the recurrence past the written table. Every notch is affordable
relative to the one before it and brutal relative to the one before *that*, so an
axis prices itself out of the draft on its own. They are offset by one on
purpose: money has an in-run answer (the reactor track, a good line rate, a fat
carry) so it may lag, while the clock has none and leads.

Both ladders also start *gentler* than the flat step they replace — the first
notch is −1s and +$1 where both were 5 — which matters because the first notch is
taken by a player who has no idea yet what a notch feels like. That is the same
reasoning that already took `TIME_NOTCH` from 20 to 5, carried the rest of the
way.

## The belt: a ceiling on how much of a bay is special

`belt.ts`. A material used to be an **independent roll per shipment** — a
cumulative walk over `materialMix`, one draw, everything unclaimed is standard.
That was correct in the average and wrong in the moment, and the difference is
what a player meets.

The mix is a **sum of ratcheted axes**, and a Tier-10 run takes two notches a
bay. Every material card a run is dealt and takes puts ~0.47 on the belt by bay
6 — and an independent roll at 0.47 does not deliver "roughly half specials,
evenly spread". Measured over 200,000 shipments at exactly that mix:

| | old roll | scheduled belt |
|---|---|---|
| share of shipments carrying a material | 46.9% | **33.3%** |
| longest run of consecutive materials | **16** | **1** |
| 2-in-a-row, per 100 shipments | 11.6 | **0** |
| 3-in-a-row, per 100 shipments | 5.5 | **0** |
| 4-in-a-row, per 100 shipments | 2.6 | **0** |

A four-material streak is a bay you cannot build a row in — slag fills slots
nothing can close and tar welds the mess shut behind it — and at 5.5 three-plus
streaks per 100 shipments a ~40-shot bay meets two of them. The bay is lost to a
**streak**, not to a decision. This is what the Tier-10 device playtest ran into
at bay 6, with a full replenishing bomb rack aboard.

**A cap on the sum could not fix it, and there already was one.** At *any* rate
an independent roll floods and droughts; lowering it makes floods rarer, never
shorter. The fix has to be about spacing.

### Three rules, deliberately separable

1. **A ceiling.** Two standard shipments are guaranteed after every material, so
   the belt can never carry more than **one material in three**. Structural, not
   statistical: no seed, no ratchet and no Final clause produces two in a row on
   a bay the ladder built.
2. **A rate that escalates while the belt is clean.** Past the gap, each standard
   shipment makes the next one likelier, and firing a material spends that
   pressure back down — so a drought closes itself and a flood cannot start. The
   mechanism is stochastic rounding, chosen because it is **exact**: credit gains
   the bay's density every shipment and loses exactly 1 per material, so the
   long-run share *is* the density. `materialMix` therefore still means literally
   what it says, and the draft screen goes on printing each material's rate to
   the player unmediated.
3. **Which material is a separate draw,** weighted by the mix.

Splitting "how often" from "which" is what makes the ceiling affordable.
`MIX_TOTAL_CAP` now equals the ceiling (`0.55` → `1/3`), and `applyRatchets`
scales an over-full mix down **proportionally**, so notches past the ceiling stop
adding specials and start deciding **which** special: six notches of slag against
one of cryo is a belt that is 1-in-3 material and >80% of it slag. The pressure
still climbs; what stops climbing is the share of the bay you are allowed to
build rows out of.

**An authored bay is exempt.** A drill that ships rebar on every shipment, a
Contract built around one material, `Full Rebar` — those state a density above
the ceiling on purpose, and get it. The ceiling governs the **ratchet ladder**,
which is the thing that stacks behind the player's back; a bay that names its own
number is not stacking anything.

### The forced hands stopped forcing two

`MATERIAL_DRAFT_BAYS` deals a materials-only hand after bays 2, 5 and 8 so a run
cannot reach bay 10 having never met a material. At the capstone `picksPerBay` is
2 against a hand of 2, so the player took **both** — three bays × two materials
is six of a run's ten notches spent on materials before choosing anything, which
is the input side of the same flood. The hand now carries a number axis as a
third card: one material forced, the second pick free.

## The Final Inspection: the last choice of a run

`finals.ts`. Every bay-clear but one deals the axis ratchet — pick a notch, it
sticks for the rest of the run. That contract stops meaning anything at the last
draft, because there is no rest of the run: a notch taken before bay 10 is a
notch taken *for* bay 10 and nothing else, so the ratchet's whole shape (cheap
now, ruinous by the tenth repeat) is spent on a decision that will never repeat.

So the draft dealt after bay 9 deals something else: **two clauses attached to
the final bay, one of which the player must take.** Three properties.

**It is the Tier's own exam.** Each Tier from 2 to 9 opens exactly one new
hazard axis, and the Workshop stocks the system that makes it cheap; the
inspection asks that pairing as a question. The two ends are special: Tier 1
opens the base number axes together — dealing Fuel Levy and Shift Cut — and
Tier 10 opens no new axis at all, asking two notches a bay instead. Tier 1
taught the money axes and sold the Reactor, so its final bay is about money.
Tier 2 taught the wind and sold the Launcher, so its final bay is weather. The
card names the system, once, on the last screen where knowing it can still
change anything.

| Tier | System | Clause | …or |
|---|---|---|---|
| 1 | Reactor Output | **Rush Order** — quota +$750 | **Rate Cut** — every line pays 20% less |
| 2 | Launcher Coils | **Head Gale** — a dead-steady gale into the muzzle, at the cap | **Tail Gale** — a gale dead astern, at the cap, gusting 3× |
| 3 | Press / Bay | **Double Shift** — the press runs at 2× | **Tight Gauge** — the bay gives up 2 open cells |
| 4 | Bay Extension | **Cold Chain** — 22% of the belt frozen | **Ice Wall** — the bay opens on 11 cubes of unthawed salvage |
| 5 | Bond Emitter | **Rebar Run** — 32% of the belt rigid | **Cold Weld** — nothing in the bay comes apart on its own |
| 6 | Demolition Rack | **Slag Run** — 17% of the belt dead | **Slag Wall** — the bay opens on 11 cubes of somebody else's slag |
| 7 | Bay Extension | **Powder Run** — 27% of the belt volatile | **Hair Trigger** — 20% volatile, primed 15% finer |
| 8 | Demolition Rack | **Tar Run** — 18% of the belt tar | **Fouled Bay** — 12% tar, congestion bites 12 cubes earlier |
| 9 | Press Hydraulics | **Bled Hydraulics** — settle assist at 35% | **Haulage Bond** — spillage billed at 3× |
| 10 | Bond Emitter | **Odd Lots** — nothing standard ships: all six materials at once | **Full Rebar** — every standard shipment arrives as rebar |

**Both clauses are meant to be equally bad, and bad differently.** That is what
makes it a choice rather than a toll, and it is the part that had to be
measured. The unit is *extra lines the final bay demands*, and Tier 1 is the
clean case: a flat quota raise costs a fixed amount of revenue, so its price in
lines falls as your rate rises; a percentage cut costs a share of everything you
earn, so its price falls faster. The design wants the two to **cross** inside
the band of rigs that actually reach bay 10, so that the clause a player should
take is a direct readout of how good their rate actually is.

**On the shipped ladder they do not cross.** Re-deriving `finals.ts`'s own model
on Tier 1's bay 10 — a $1500 target, $190 a line, $20 a launch, a $160 float
plus run.ts's $150 carry, so at ~2.9 launches per line a line nets $132 and the
bay needs 9.0 lines — prices Rush Order at **+5.7 / +4.6 / +4.2** lines against
Rate Cut's **+3.6 / +2.5 / +2.1**, across stock / Reactor 2 / Reactor 3. The
flat raise is the dearer poison at *every* rig, and the two never converge: at
the precision printed here the gap holds at 2.1 lines across stock, Reactor 2
and Reactor 3 alike, so no rig that reaches bay 10 flips the answer.
`RUSH_ORDER_QUOTA` must be re-sized against the tier being flown before this
pair can be claimed to have a crossing at all. (It was already gone before #88:
the pre-#88 table in `finals.ts`'s header only reproduces at a 25% cut, and
`RATE_CUT` is 0.2.)

The owner's original sketch was +$1000 against −25%. Both moved: at $1000 the
percentage wins at every rig and the crossing falls off the bottom of the table,
which is a pair with a right answer, i.e. not a pair — which is exactly the
shape the numbers above now measure at $750 on Tier 1, one ladder later.

**Neither is a lose button.** Every clause is floored the way `Shift Cut` is
floored, for the reason `hazards.ts` gives — an axis that can reach an
unplayable bay is a lose button, not a difficulty knob — and harder here,
because this fires on the run's last bay where a dead bay costs the whole run.
`sim/systems.ts` builds the worst arrival it can (every axis the Tier deals,
ratcheted as deep as a run can take it) and asserts the resulting bay still has
a clock, a press stroke, a payable line and cargo to build rows out of.

### What the measurement could and could not settle

Two instruments: `contracts.ts`'s own launch-budget model (exact for money,
cargo size, line width and materials; blind to physics) and the `aim` bot at 20
seeds a cell. The full table lives in `finals.ts`'s header.

**Six of the twenty clauses measured at or above the bay they are meant to make
harder.** That looks like six broken cards. It is not — sorted by what each
clause takes away, all twenty fall into three groups with no exceptions:

| What the clause takes away | Clauses | Bot |
|---|---|---|
| **Cubes that can reach a line** | every material clause, plus Cold Weld and the retired Dead Weight | −15 to −70 |
| **Money** | Rush Order, Rate Cut, Haulage Bond, Bled Hydraulics | −5 to −10 |
| **Good placements** | Tight Gauge, Tail Gale, Rebar Run, Hair Trigger, Powder Run, the retired Short Measure | free or better |

The Tier 10 pair postdates the table. The size fork it replaced (**Dead
Weight** / **Short Measure**, the pentomino/domino pair) examined the cannon's
unit economics — launches per line, priced per cube — which nothing in the
ladder teaches. The full-belt cargo pair asks what the Tiers actually taught:
`Odd Lots` deals the whole material catalogue with the standard shipment
removed, and `Full Rebar` ships the capstone's own unbreakable format as
cargo. The bot cannot rank the two poles (a material flood collapses it, a
placement demand reads free), so the sizing argument is against the ladder
itself and lives in `finals.ts`'s Tier 10 header; only a device playtest can
say more.

The third group is the finding. The bot does not plan a row — it solves an angle
and fires on every cooldown — so a clause that shrinks the space of *good*
placements costs it nothing, while one that shrinks the space of *legal* ones
sometimes helps. `Tight Gauge` is the proof: a narrower bay took its conversion
from 4.30 shots per line to 2.87, because a nearer open stop packs the pile
tighter, which is the metric the bot is implicitly optimising.

So the table is **a measurement of the harness, not of those six clauses**: this
bot prices cubes-into-lines and money, and is blind to placement quality by
construction. It is equally not evidence that they *are* costs — nothing here,
and nothing else in the repo, measures how hard a bay is to plan. That gap is
what a device playtest fills, and it is where those six clauses live.

Two consequences are already in the numbers:

- **Material rates are set against the ladder, not the bot.** One notch of slag
  or cryo at `materialRate(1) = 0.07` — a rate the shipped game deals routinely
  — takes the bot from 100% to 0%. A 0% row says nothing about the number, so
  no rate a card QUOTES exceeds what `materialRate` reaches at six notches
  (`MATERIAL_CAP`, 0.32). The rate actually delivered can sit above it: a
  clause floors its material at the card's rate and then adds a notch on top,
  bounded by `FINAL_MATERIAL_CAP` (0.4) — see `finals.ts`'s `schedule`.
- **The bot's cadence is not a human's** — the same limit `PILE_TIERS` learned
  the hard way. `Fouled Bay` is priced in exactly that currency.

Two corrections fell out of the pricing and are worth stating on their own.

`applyFinal` runs *after* `applyRatchets`, which is where `MIX_TOTAL_CAP` is
enforced — so a material clause landing on an already-full belt pushed it to 0.78
against a cap that was then 0.55. It now re-caps, holding the clause's own
material at the rate its card quotes and taking the reduction from the ratcheted
ones. That re-cap matters more since the cap became the belt ceiling: a final bay
allowed over it would be the only bay in the game that could deal three materials
in a row — the hardest one, on the run's last life. `FINAL_MATERIAL_CAP` is held
*equal* to the ceiling rather than under it, so a clause can still fill the belt
with its own material (which is what `Full Rebar` is) and can still out-bid a
maxed ratchet by the last sliver, which is what keeps a mandatory clause from
being silently free.

Because that rate is a floor rather than a quantity, the six material cards
read **"at least N%"**. A run carrying two Slag notches meets `Slag Wall`'s 8%
card with a belt at 12%: the design is deliberate — a mandatory cost the
player's own earlier choices could pre-pay is not a cost — but a bare number
would be wrong on exactly the arrivals where it matters. `sim/systems.ts` pins
it: a clause whose delivered rate can exceed its own clean-bay rate must say so
on its face.

`penaltyPerLostPiece` is charged **per cube**, not per piece
(`lost = lostCubes.length`), so a spilled tetromino costs four times the number
the field is named for and a spilled pentomino five. The field keeps its name —
it is threaded through saves, telemetry and the harness — but the projection
tile now says which unit it is in. That multiplier is also why the tier ramp
above matters as much as it does: what the tier really moves is the price of one
bounced shipment, $4 at the bottom of the ladder and $100 at the top.

## Tuning

Everything is a named constant with a comment:

- `level.ts` — the tier ladder (`TARGET_BASE`, `TARGET_PER_TIER`,
  `TARGET_PER_BAY`, `TARGET_PER_BAY_PER_TIER`, `TIME_BASE`, `TIME_PER_TIER`,
  `LAUNCH_COST_BASE`, `LAUNCH_COST_TOP`, `LAUNCH_BUDGET_SHOTS`), the rest of
  `makeBaseLevel`, `SCRAP_PER_LINE`, `SCRAP_PER_BAY`, `SLAG_BOUNTY`,
  `DEMO_RESUPPLY_LINES`
- `upgrades.ts` — `TIER_COSTS`, per-track `apply`
- `meta.ts` — `UNLOCKS` and `INSTALLS` prices, `TIER_SALVAGE_BASE` /
  `TIER_SALVAGE_PER_TIER`, `TIER_CONTRACTS_REQUIRED`
- `pieces.ts` — `SIZE_SPEC`
- `run.ts` — `CARRY_CAP` (how much of a cleared bay's surplus reaches the next
  bay's float), `REFIT_EVERY`, `SCORE_PER_BAY` / `SCORE_PER_LINE`
- `level.ts` — `PILE_TIERS` (congestion thresholds and penalties)
- `hazards.ts` — `TIME_LADDER`, `COST_LADDER`
- `finals.ts` — `FINALS` (the Final Inspection's twenty clauses, one pair per
  Tier), `RUSH_ORDER_QUOTA`, `RATE_CUT`, `SALVAGE_PROFILE`, `FOULED_ALLOWANCE`

`npm run sim:balance` sweeps bays × bots × mods at one tier (`--mark`, default
1 — two sweeps only compare at the same Mark); `npm run sim:pile` sweeps the
congestion tax (and `--census` alone answers "how full is a bay actually");
`npx tsx sim/marks.ts` sweeps the tier ladder itself. Two caveats it can't see past:
the bots never use abilities (Bond Breaker, Demolition read as 0 delta), and the
Autoloader is now a held trigger no bot holds, so it reads as a clean 0 delta
too rather than the old *fight for the cannon* whose sweep numbers measured a
conflict that didn't exist in real play. All three need human playtesting.
