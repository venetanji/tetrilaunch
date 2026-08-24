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

## Three currencies, three horizons

| | Lifetime | Earned by | Spent on |
|---|---|---|---|
| **Funds `$`** | one bay | line payouts, bomb salvage | launches. Also the bay's own target. |
| **Scrap `♻`** | one run | 2/line, 10/bay cleared | ship upgrades at refit stops |
| **Salvage** | forever | every finished run, win or lose | permanent unlocks in the Workshop |

They are deliberately **not** interchangeable. Funds are operating budget, scrap
is capital, salvage is R&D. Banking a huge surplus never buys upgrades, and a
rough bay you barely survive still moves the build forward. That separation is
what keeps the three decisions distinct instead of collapsing into "get more
money".

## The ship (FTL layer)

The compactor rig **is** the ship: fixed stock size, refitted with scrap at
**refit stops after bays 3, 6 and 9**. Six systems, three tiers each, one shared
price ladder of **20 / 35 / 55** scrap (110 for a full track).

| Track | Tiers | What it's for |
|---|---|---|
| **BAY** | +2 / +4 / +6 open cells (→18) | The "extend to 18" lever, and now the only one — the draft's old Wide Bay offer is gone, so width is earned capital rather than a roll. Buys **room only**: `compactorSpeedFor` scales the bar's speed with its span, so a wider bay no longer stretches the press cycle. It used to — T3 took the cycle from 4.4s to 11.1s while the card advertised nothing but space, which made the most expensive purchase in the track a stealth *difficulty cut*. |
| **LAUNCHER** | +6/12/18% muzzle speed · 20/40/60% wind cancelled | **The wind answer.** More speed to throw through a headwind, plus a stabilizer that cancels part of it outright. |
| **HYDRAULICS** | ×1.6/2.2/2.8 settle assist · +8/16/24% stroke | Turns "nearly a line" into a payout. The upgrade for builds that land loose cubes. |
| **MAGAZINE** | −15/30/45% cooldown | Tempo. |
| **REACTOR** | +$60/120/180 float · +$15/30/45 per line | The economy track. |
| **BONDS** | +1/2/3 Bond Breaker charges per bay | Compaction for builds whose pieces don't flatten their own pile. |

**Income sizing.** A clean bay clears ~8 lines → ~26 scrap. Stops arrive at
roughly 78 / 156 / 234 cumulative scrap, i.e. "one track nearly maxed, or two
opened" at the first stop. An FTL-shaped choice, not a shopping spree.

**Upgrades vs. mods** are different in kind, and both exist on purpose:

- A **mod** is a hand you were *dealt* — three seeded offers every bay, often a
  trade-off, sometimes a bane, and you don't pick which three you see.
- An **upgrade** is capital you *chose* to spend from a fully-visible menu with a
  known price. Nothing in a track is a downside; the cost is the opportunity cost
  of the scrap.

Application order is fixed in `run.ts`'s `levelForRun`: **upgrades, then mods**.
A contract's multipliers compound on top of whatever ship you refitted, which is
the intended reading ("this contract applies to the ship you're flying").

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

Gated behind the `auto` salvage unlock **and** owning Micro Shipments this run.
**Hold** the rail trigger (or `F`) and the cannon fires every 420ms at a ±9°
spread around wherever you are pointing, at half launch cost, with a random
rotation. Fast, cheap, probabilistic — explicitly not trying to be a good player.

It only works on top of the build it belongs to: cheap enough payloads to survive
the waste, and Bond Breakers (or Hydraulics) to flatten what it piles up.

It used to fire on a free-running timer, and that was a real bug rather than a
balance problem. Measured on device, one Autoloader bay threw **34 lost pieces
from 32 shots** (106%, against an 11% baseline) at **16 shots per line**, and
its launches were spread evenly across the compactor cycle (z=0.71 retreat vs
press) while the same player's manual shots were strongly biased toward the open
window (z=4.27). A metronome cannot see the compactor, so it spent about half
its shots firing into a shut bay and paying the lost-piece penalty. Holding a
trigger puts the WHEN in the player's hands and leaves the WHERE scattered,
which is the upgrade's identity: a stream you point and time, never a better
cannon.

## Salvage always pays

`salvageForRun = 3 + 5×bays + 1×⌊lines/2⌋ + 25 if the run completed`

The `+3` floor is deliberate. "Dying gives you resources" has to be true even for
a bay-1 flameout, or the worst runs pay nothing.

Unlocks add **options**, never flat stat bumps: a new modifier enters the draft
pool, a new consumable exists, the wind gets surveyed. That constraint keeps a
veteran's run harder-won rather than merely bigger-numbered, while still making a
failed run worth having played.

## Congestion: pricing the spam endgame

**Status: measured, not shipped.** `makeBaseLevel` sets `pileTiers: []`, so the
mechanic is inert until one line in `level.ts` turns it on. Everything below is
what `npm run sim:pile` says about it.

### The problem

A bay's launch budget is loosest exactly when it should be tightest. Late in a
bay the player is sitting on the surplus every cleared line paid out, launchCost
is flat, and nothing prices a shot against the state of the field — so the
dominant endgame is to stop aiming and empty the bankroll into the bay, letting
gravity and the press resolve whatever lands. The economy *rewards* the strategy
that skips the game.

### The rule

Count live cubes on the field. Past a threshold, every launch costs a multiple of
the bay's launchCost and burns seconds off the bay clock. Highest matching tier
wins; the tiers do not stack. The tax is charged **on the shot**, never held
against the pile — a player who stops firing and lets the press work pays
nothing, which is what makes this a disincentive rather than a punishment.

### What the sim found

Three findings, in descending order of how much they should change the design.

**1. The first-guess thresholds were far too tight.** 32 and 48 cubes was pitched
as "four lines' worth of cargo loose on the field, then six", which sounds like a
bay you have let get away from you. Measured (`--census`, `aim` bot, 5 bays ×
16 seeds), the median untaxed field holds ~24 cubes and the p90 is ~65 — and
**58% of a clean bot's shots would pay tier 1, 29% tier 2**. At those numbers the
tax is not an anti-spam rule; it is a rate rise with extra steps, and the win
rates agree: careful play fell from 73% to 49%.

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
spam):

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

### Where it landed

Move the thresholds, keep the penalties. At **48 and 64 cubes** with the
originally-specced ×1.5/×2 and 2s/5s, the tax fires on 23%/17% of careful shots
instead of 58%/29%, and:

| | careful | spam | gap |
|---|---|---|---|
| no tax | 73% | 48% | 25 |
| 48/64, ×1.5/×2, 2s/5s | 70% | 39% | **31** |

Careful play gives up 3 points, spam gives up 9, and the spread between them
widens. The careful bot also converts better under the tax than without it
(3.9 shots per line against 4.2) — waiting for the bay to drain means the shot
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

## The Final Inspection: the last choice of a run

`finals.ts`. Every bay-clear but one deals the axis ratchet — pick a notch, it
sticks for the rest of the run. That contract stops meaning anything at the last
draft, because there is no rest of the run: a notch taken before bay 10 is a
notch taken *for* bay 10 and nothing else, so the ratchet's whole shape (cheap
now, ruinous by the tenth repeat) is spent on a decision that will never repeat.

So the draft dealt after bay 9 deals something else: **two clauses attached to
the final bay, one of which the player must take.** Three properties.

**It is the Tier's own exam.** A Tier opens exactly one new hazard axis and the
Workshop sells exactly the system that makes it cheap; the inspection asks that
pairing as a question. Tier 1 taught the money axes and sold the Reactor, so its
final bay is about money. Tier 2 taught the wind and sold the Launcher, so its
final bay is weather. The card names the system, once, on the last screen where
knowing it can still change anything.

| Tier | System | Clause | …or |
|---|---|---|---|
| 1 | Reactor Output | **Rush Order** — quota +$800 | **Rate Cut** — every line pays 20% less |
| 2 | Launcher Coils | **Head Gale** — a dead-steady gale into the muzzle, at the cap | **Tail Gale** — a gale dead astern, at the cap, gusting 3× |
| 3 | Press / Bay | **Double Shift** — the press runs at 2× | **Tight Gauge** — the bay gives up 2 open cells |
| 4 | Bay Extension | **Cold Chain** — 22% of the belt frozen | **Ice Wall** — the bay opens on 11 cubes of unthawed salvage |
| 5 | Bond Emitter | **Rebar Run** — 32% of the belt rigid | **Cold Weld** — nothing in the bay comes apart on its own |
| 6 | Demolition Rack | **Slag Run** — 17% of the belt dead | **Slag Wall** — the bay opens on 11 cubes of somebody else's slag |
| 7 | Bay Extension | **Powder Run** — 27% of the belt volatile | **Hair Trigger** — 20% volatile, primed 15% finer |
| 8 | Demolition Rack | **Tar Run** — 18% of the belt tar | **Fouled Bay** — 12% tar, congestion bites 12 cubes earlier |
| 9 | Press Hydraulics | **Bled Hydraulics** — settle assist at 35% | **Haulage Bond** — spillage billed at 3× |
| 10 | Bond Emitter | **Dead Weight** — every shipment a pentomino, +50% a launch | **Short Measure** — every shipment a domino, −40% a launch |

**Both clauses are equally bad, and bad differently.** That is what makes it a
choice rather than a toll, and it is the part that had to be measured. The unit
is *extra lines the final bay demands*, and Tier 1 is the clean case: a flat
quota raise costs a fixed amount of revenue, so its price in lines falls as your
rate rises; a percentage cut costs a share of everything you earn, so its price
falls faster. The two **cross**, and the crossing is parked at the mid-track
Reactor — which is what a bay-10 rig typically carries. Below it take the flat
raise, above it take the percentage. The right answer is a direct readout of how
good your rate actually is.

The owner's original sketch was +$1000 against −25%. Both moved: at $1000 the
percentage wins at every rig and the crossing falls off the bottom of the table,
which is a pair with a right answer, i.e. not a pair.

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
| **Cubes that can reach a line** | every material clause, plus Cold Weld and Dead Weight | −15 to −70 |
| **Money** | Rush Order, Rate Cut, Haulage Bond, Bled Hydraulics | −5 to −10 |
| **Good placements** | Tight Gauge, Tail Gale, Rebar Run, Hair Trigger, Powder Run, Short Measure | free or better |

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
enforced — so a material clause landing on an already-full belt pushed it to
0.78 against a cap of 0.55. It now re-caps, holding the clause's own material at
the rate its card quotes and taking the reduction from the ratcheted ones.

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
tile now says which unit it is in.

## Tuning

Everything is a named constant with a comment:

- `level.ts` — `makeBaseLevel` formulas, `SCRAP_PER_LINE`, `SCRAP_PER_BAY`
- `upgrades.ts` — `TIER_COSTS`, per-track `apply`
- `meta.ts` — `UNLOCKS` prices, `SALVAGE_*` weights
- `mods.ts` — per-mod numbers
- `pieces.ts` — `SIZE_SPEC`
- `run.ts` — `REFIT_EVERY`
- `level.ts` — `PILE_TIERS` (congestion thresholds and penalties)
- `hazards.ts` — `TIME_LADDER`, `COST_LADDER`
- `finals.ts` — `FINALS` (the Final Inspection's twenty clauses, one pair per
  Tier), `RUSH_ORDER_QUOTA`, `RATE_CUT`, `SALVAGE_PROFILE`, `FOULED_ALLOWANCE`

`npm run sim:balance` sweeps bays × bots × mods; `npm run sim:pile` sweeps the
congestion tax (and `--census` alone answers "how full is a bay actually"). Two caveats it can't see past:
the bots never use abilities (Bond Breaker, Demolition read as 0 delta), and the
Autoloader is now a held trigger no bot holds, so it reads as a clean 0 delta
too rather than the old *fight for the cannon* whose sweep numbers measured a
conflict that didn't exist in real play. All three need human playtesting.
