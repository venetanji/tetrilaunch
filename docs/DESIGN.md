# Design direction — Contracts, Marks and the rig

The record of where the game is going after the three-currency rework, so the
shape can be argued with before it's built and the numbers can be tuned later
without re-deriving the intent. Companion to `docs/ECONOMY.md`, which covers the
in-run economy this sits on top of.

Shorthand used throughout: **"Candy Crush meets FTL."** Contracts are the Candy
Crush half (short, repeatable, daily, generous). Deep Run is the FTL half (long,
permadeath, unforgiving). The rig is what connects them.

## The problem this solves

The game today is all FTL and no Candy Crush: one mode, ten bays, permadeath,
25–40 minutes a run. That's a good roguelite and a bad mobile product, and it
boxes in monetization badly — the only thing you could sell mid-run is power,
and power sold into a leaderboard game turns the board into a ranking of who
paid.

There's a second, quieter problem. **The compactor is the title mechanic and the
least developed system in the game.** It has five tunables (`compactorSpeed`,
`compactorOpenCells`, `compactorMinLineCells`, `compactorWidth`,
`compactorHeightFrac`) and exactly one behaviour: sweep in, sweep out. Every
interesting decision happens to the *pieces*. Making the compactor the axis of
both progression and difficulty fixes the retention problem and the depth
problem with the same work.

## Two modes, one rig

| | **Contracts** | **Deep Run** |
|---|---|---|
| Shape | procedurally generated single bays | the 10-bay run, permadeath |
| Session | 60–120s | 25–40 min |
| Failure | costs nothing, retry freely | ends the run |
| Earns | permanent rig upgrades | leaderboard rank, the next Mark |
| Board | per-contract, seeded | per-Mark global board |
| Purchasable power | **none** | **none** |
| Daily cap | yes (see below) | **never** |
| Role | training, economy, the daily habit | the exam |

Contracts are where you *build* the rig. Deep Run is where you find out whether
the rig you built is good enough. Neither mode is the "real" game.

## The loop

1. Run Contracts. They pay the permanent currency and teach one material at a time.
2. Spend it on your rig — pick a direction, because you cannot afford every track.
3. Attempt **Deep Run at Mark 1**. This is a gated exam, not an endless score chase.
4. Beat it. That unlocks Mark 2 Contracts *and* raises your rig's ceiling.
5. Repeat. Each Mark is harder, introduces new materials, and demands a build.

The critical property: **Deep Run is a gate, not a treadmill.** You don't grind
into the next Mark, you beat your way into it. That's what makes a Mark N clear
mean the same thing for every player who has one.

## Rig tier ceilings — the integrity rule

This is the load-bearing rule of the whole design, so it goes first.

> **Mark N unlocks rig tier ceiling N. Contracts fill you toward the ceiling.
> Only beating Mark N raises it.**

Without it the design has a leak. Contracts grant permanent upgrades, and
Unlimited grants more Contracts per day, so paying would mean a stronger rig
sooner — and the Mark 5 board would quietly become a ranking of who ran the most
Contracts. With it:

- Everyone who arrives at Mark N converges on the same maximum rig.
- Paying compresses *time-to-ceiling*. It can never buy a higher ceiling.
- Leaderboards segment per Mark, so a Mark 5 clear is the same achievement for a
  whale and a free player.

Stated in the product's own words, and worth saying out loud in the UI: **you
can pay to progress faster, never to rank higher.**

The rule also solves a design problem for free. Once a player caps their rig for
the current Mark, further Contract income has nowhere to go — which is exactly
the pressure that sends it into *other rigs*.

## Rigs as FTL ships

Plural rigs are the retention engine, and each one should be a **layout, not a
power level**: a distinct base profile, one signature mechanic, and a
differently-shaped upgrade tree. An FTL ship isn't better than the starting one,
it's a different set of problems.

| Rig | Identity | Trade |
|---|---|---|
| **Standard Hauler** | balanced, all six tracks available | the tutorial rig |
| **Scrapper** | starts with Demolition; bombs refund more | weak launcher — plays the salvage economy |
| **Overpressure** | huge hydraulics and settle assist | brutal cooldown; few shots, each flattens |
| **Swarm** | micro payloads native, fast cooldown | can't run bulk; Bond Breaker dependent |
| **Longshore** | starts at 18 open cells | higher `compactorMinLineCells` — more room, harder lines |
| **Twin-Press** | compactors close from *both* sides | double compaction, but you must build in the middle |

Twin-Press earns its place by turning a hazard into a playable identity, which is
how a small mechanic set stretches a long way.

Rigs are bought with the permanent currency and each carries its own tier
progress. The ceiling rule applies per rig, so a second rig starts from scratch
and is a genuine investment rather than a free power spike.

## The Mark ladder

A Mark is a difficulty tier of Deep Run *and* a content gate. Each one:

1. **Changes the rig visibly on screen** — more hydraulic rams, a wider press
   plate, hotter glow. Progress that only exists as a number in a menu doesn't
   read as progress.
2. **Unlocks the next Contract tier.**
3. **Adds one material or hazard to both content pools.** An option, never a
   stat — the constraint `meta.ts` already commits to, extended to the ladder.
4. **Raises Deep Run's base difficulty *and* the rig ceiling together.**

Point 4 is what keeps the ladder honest: a Mark raises the floor and the bar at
once, so a Mark 9 player isn't posting inflated numbers, they're playing a harder
game with a better rig.

**Contracts teach what Deep Run tests.** Mark N's Contracts introduce the
material Mark N's Deep Run will throw at you. Without that relationship the two
modes are merely parallel and Contracts degrade into a currency chore.

### What actually gets harder

Beyond the existing `makeBaseLevel(i)` ramp:

- **Compactor tempo** — faster sweeps, shorter dwell.
- **Tolerance** — `compactorMinLineCells` rises, slot alignment narrows.
- **Stroke budgets** — see below.
- **Materials** — one new type per Mark, in both pools.
- **Hazards** — lowering ceiling, tilted floor, drifting conveyor, two-sided press.

### Uncapping Deep Run

`makeBaseLevel(i)` is linear in `i` and every formula already extrapolates; the
only thing stopping bay 11 existing is `LEVEL_NAMES[i]` returning `undefined`.
Add a name generator past index 9 and Deep Run runs endless past bay 10, which is
what a score board actually needs — unbounded headroom so the top of each Mark's
board is a skill expression rather than a completion checkmark.

## Strokes: the third constraint

Tetrilaunch constrains funds and time. Candy Crush's real engine is
**moves-limited** puzzles, and the native translation here is a **compactor
stroke budget** — "clear this in 6 strokes."

It's worth adding for three reasons: it's readable at a glance in a way a
countdown isn't, it makes tightly-specified short puzzles possible at all, and it
is a constraint on *the compactor*, which is the system that most needs to
become something the player thinks about.

## Materials — the content engine

Match-3 games get thousands of levels out of one verb by never adding mechanics
and always adding **tile types**. The physics translation, roughly in
introduction order:

| Material | Behaviour | Answers with |
|---|---|---|
| **Slag** | occupies a slot, can never count toward a line | Demolition, or shove it out |
| **Cryo** | must be struck before it will compact; pressed cold it shatters the line | sequencing |
| **Rebar** | joints never break — a rigid anchor | building around it |
| **Volatile** | detonates on hard impact, taking neighbours | soft landings, or deliberate chains |
| **Tar** | bonds permanently on contact; Bond Breaker won't split it | avoidance |
| **Magnetic** | self-aligns to neighbours — a *helpful* blocker | pairs with loose builds |

Slag is the chocolate. Magnetic exists so the vocabulary isn't uniformly
punishing — a material the player is glad to see keeps the others from reading as
noise.

None of these need a new system. All of them are content on the engine that
exists.

## Procedural Contracts

Authored bays were considered and **rejected** — a hand-tuned map is a content
treadmill nobody on this project has time to feed. A Contract is instead
**seed + template + difficulty budget**:

- **Objective** — reach $X · N lines in M strokes · clear all slag · deliver a
  marked crate to the floor · precision (≤K launches) · survive N strokes losing
  ≤K pieces
- **Materials** — drawn from the pool unlocked at the player's Mark
- **Complication** — one, occasionally two: wind character, hazard, pre-seeded
  pile, mod-style constraint
- **Budget** — every element carries a weighted cost, and the generator spends a
  scalar budget derived from Mark and tier

The budget is what separates this from slop: difficulty becomes a number you
spend rather than an accident of the roll.

### Validation is the part that makes it shippable

**Generate, then run `sim/sweep.ts`'s bot against the candidate headlessly and
reject anything it can't clear at threshold.** The harness was built for balance
sweeps; reused as a fairness gate it makes "impossible Contract" structurally
impossible rather than a bug report. This is the single highest-leverage reuse
available in the codebase and it should be built alongside the generator, not
after.

Its known blind spots (from `ECONOMY.md`) still apply: bots don't use Bond
Breaker or Demolition, so objectives that *require* an ability need a human pass
or a bot that can use them.

### Daily Contracts

A **global daily seed** gives every player the same 3–5 Contracts, each with its
own board. Cheap to build on the Worker and D1 that already serve the
leaderboard, and it's the entire social hook.

## Monetization

One subscription, **Tetrilaunch Unlimited**. The entitlement identifier is
`Tetrilaunch Unlimited` (see `UNLIMITED_ENTITLEMENT` in
`app/src/lib/purchases.ts` — it must match the dashboard byte for byte).

**What it buys:** the daily Contract cap lifted, Contracts on demand, cosmetics,
run history, cloud save. **What it never buys:** rig ceilings, Marks, leaderboard
position, or anything usable in Deep Run.

### The daily cap, designed not to feel like lives

- **Free** — 3 daily Contracts. A complete, satisfying daily ritual.
- **Unlimited** — the dailies plus endless generated Contracts.
- **A failed Contract does not consume the allowance.** Only completions count.
- **Deep Run is uncapped for everyone.** The exam is always free to attempt.

That last pair is what separates this from an energy system. Candy Crush's lives
punish failure; this caps *throughput* and leaves failure free, so a stuck player
is never locked out — and the core of the game never reads as paywalled.

**Rejected:** energy/lives (punishes the players who most need practice, and a
retention mechanic is invisible in a demo video anyway), and consumable power
sold directly (the daily cap is a cleaner lever and keeps one earned currency).

### Virtual currencies

RevenueCat can hold a persistent balance, and salvage is the only currency that
fits — funds are per-bay and scrap dies with the run, so both would be latency
for nothing.

The client SDK is **read-only** (`getVirtualCurrencies()`); deposits and spends
require Developer API v2 with a *secret* key, so they belong in the Cloudflare
Worker and nowhere else.

It earns its keep **the moment a currency bundle is sold**: Apple does not
restore consumables, so a grant lost to a crash or reinstall means a player paid
for nothing, and RevenueCat handles grant, restore and refund clawback. Until
something is purchasable, Worker + D1 is simpler and survives offline.

Two prerequisites before salvage moves there: RevenueCat mints **anonymous app
user IDs**, so a reinstall loses the balance unless `logIn()` supplies a stable
one (Sign in with Apple being the low-friction route); and offline play needs
awards queued under the run id as an idempotency key, with spends blocked while
disconnected.

Worth noting the ceiling rule makes selling salvage *safe* if it ever happens — a
bundle can only accelerate a player toward the Mark N ceiling, never past it, so
it is identical in effect to selling Contract throughput.

## Build order

1. **Mark ladder + rig tier ceilings.** The spine — Contracts and monetization
   both hang off it, it's mostly `run.ts`/`meta.ts`, and it's testable headlessly.
2. **Contract generator + sim validation**, together.
3. **Materials**, starting with slag and cryo.
4. **Rigs** beyond the Standard Hauler.
5. **Daily seed + per-Contract boards** on the existing Worker.

## Scope for Shipaton

The window is Aug 1 – Sep 30 and the iOS ship is concurrent, so the minimum that
reads as "Candy Crush meets FTL" to a judge:

Mark ladder with visible rig changes · generated Contracts across three tiers ·
stroke-limited objectives · two materials (slag, cryo) · Unlimited with the
daily cap · one alternate rig.

Everything else here is post-hackathon runway — which is worth having written
down when judges ask where it goes next.

## Open questions

- **How many Marks?** Ten is a placeholder that rhymes with the ten bays. The
  real answer depends on how long a Mark takes to beat, which needs playtesting.
- **Does Deep Run reset the rig, or fly the one you built?** The doc assumes you
  fly what you built. The alternative — Deep Run normalizes every rig to the Mark
  ceiling — makes the board even purer but makes Contracts feel pointless.
- **Contract currency: salvage, or a fourth currency?** Reusing salvage keeps the
  count at three; a separate one lets Contracts and Deep Run pay independently.
- **What do the three daily Contracts refresh against** — wall-clock midnight, or
  24h from first completion? The former is fairer, the latter retains better.
