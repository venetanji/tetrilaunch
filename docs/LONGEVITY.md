# Longevity — what the game is after the ladder ends

Companion to [`docs/DESIGN.md`](DESIGN.md), which covers the Tier ladder and the
two modes, and [`docs/ECONOMY.md`](ECONOMY.md), which covers the three
currencies. This one covers the part neither of them has: **what a player does
on day 40**, and what stops the ten Tiers from being ten things you throw away.

Three features, one shape. They are written as one document because they only
work as one: the ladder panel is what makes Commissions playable, Commissions
are what make the ladder panel worth using, and God Tier is where the ladder
empties into a loop that does not run out.

## The two holes

**Hole one: the ladder is a corridor, not a place.** `meta.ts`'s
`markUnlocked` returns `mark + 1`, and `main.ts`'s `startGame` flies exactly
that. So the Tier you may attempt is the *only* Tier you may attempt. Beat Tier
3 and Tier 3 is gone — its hazard rungs, its Final Inspection pair, the specific
bay-6 shape it produced, all unreachable forever. That is nine tenths of the
authored content spending most of the game's life switched off, and it is also
why there is nowhere to *practise*: a player stuck on Tier 7 can only fail Tier
7 again.

**Hole two: Tier 10 is a cliff.** `advanceTier` clamps `mark` at `MARK_COUNT`,
so a finished player re-completes Tier 10 forever for 60 salvage a time against
a shelf (`INSTALLS` + the live `UNLOCKS`) of about 445 that they finished
climbing somewhere around Tier 8. The exam has no eleventh question and the
currency has nothing left to buy. The game does not end badly; it just stops
having an opinion about what you should do next, which is the same thing
measured in retention.

Both holes have the same fix available, and it is not new content: **the
ladder already contains ten difficulty settings, twenty authored Final
Inspection clauses, eleven hazard axes and six materials.** What is missing is
permission to re-enter it and a reason to.

## 1. The tower — replaying a Tier

The menu's attract demo (`game/attract.ts`) is a live bay with no HUD over it,
and it spends its best corner — the plant panel's footprint, bottom-left, the
one place nothing the autopilot does ever reaches — on the **TETRILAUNCH**
wordmark. That corner gets the ladder instead: a **tower**, ten floors rising
off the bay floor, the capstone as a spire above them, and each floor's windows
lit in proportion to the Commissions claimed at that Tier. A save's whole
history reads at a glance, from the ground up, in the part of the menu that was
pure decoration.

`DESIGN.md` already asks for this in another voice — "progress that only exists
as a number in a menu doesn't read as progress." A building with eight lit
floors is the progress; the spire is the thing you are climbing toward.

**The tower is a readout and a door, not the control.** Ten floors share the
demo panel's height, which on a landscape phone is about 157px — 14px a floor,
a quarter of the 44px a tap target owes. So the whole tower is one button and
it opens the **ladder modal**, where the rungs are full size: ten of them in an
`auto-fit` grid that resolves to five columns and two rows inside the modal's
`min(560px, 94vw)`, the capstone underneath, and a confirm that names the Tier
it will fly. The Tier chip in the status strip opens the same modal — it is
already the ladder's one-line summary, so tapping it to see the whole thing is
the gesture a player would guess.

A third menu column was the first build of this and it does not fit a phone.
Ten rungs at 44px is 440px of height against the ~348px a landscape phone has,
and 236px of width the two existing columns have already spent; the version
that did fit starved the brand stack to a zero-width grid cell on all five
landscape phones. The demo panel is a box that already exists, is already sized
by `--brand-w`, and was already spending its best corner on a wordmark.

The wordmark goes, in both demo states. It stays in the DOM — it is the
canvas's accessible name and the reduced-motion fallback's headline — but the
plate and the letters both hide, because that corner holds one thing and the
ladder is the one that changes. The game's name is still the splash screen, the
tab title and the icon. Dropping it from the fallback is not only consistency:
that state pays `clamp(30px, 6.2vw, 66px)` for the wordmark and fits today only
because it asks for nothing else, so a tower beside it overflowed three
landscape phones. Where the demo is inert (reduced motion, no 2D context) there
is no bay for a building to stand in, and the tower lays on its side as a 44px
progress strip instead.

All thirteen devices in `sim/uifit` render the tower, the modal and the menu
with zero fit violations.

### The budget clamp is what makes it honest

> **Flying Tier N flies Tier N's build budget**, whatever your Mark is.

`upgrades.ts`'s `budgetForMark(N)` already takes the Mark as a parameter, and
`loadoutLegal(tiers, mark)` already validates against it. Replay simply passes
the *chosen* Tier where `markUnlocked(meta)` was passed before.

Without the clamp the feature is worthless and actively harmful. The
load-bearing rule of the whole design is that "every rig at Mark N has identical
total power" — that is the only reason a Mark-N board ranks skill rather than
grind. Bringing a 660-point rig to Tier 3 turns Tier 3's board into a ranking of
how far past Tier 3 you have climbed, which is precisely the leak the budget
model exists to close. So a Tier-3 replay flies 198 points, exactly as a Tier-3
player does.

A saved loadout that is *over* the replayed Tier's budget has to become a legal
one. `trimLoadout` does it deterministically — drop the most expensive installed
tier, ties broken by `UPGRADES` order, until it fits — and it is a stopgap with
a stated successor: the loadout screen (`DESIGN.md`'s build-order item 5) is
where the player picks, and the day it exists the trim becomes the default it
opens on rather than the answer.

### What a replay does and does not pay

- **It does not touch tier progress.** `recordRunEnd` already guards on
  `runMark === markUnlocked(meta)`, so a lower-Tier win cannot tick the current
  Tier's run half. That guard was written for stale saves and turns out to be
  exactly the rule replay needs; nothing changes.
- **It does not pay salvage.** Same guard, same reason. A replayable Tier that
  paid would be a salvage farm, and the whole `TIER_SALVAGE_PER_TIER = 0`
  correction was about income that outran its sink.
- **It pays a board place and it pays Commissions.** Which is the point.

### Boards per Tier

Today `main.ts` submits every run with `level: 1` — one global board for ten
different games. That was survivable while only one Tier was reachable at a
time and is indefensible once they all are. Boards become **keys**:
`tier:3`, `god:20260824`. See §4.

## 2. Commissions — achievements that are load-bearing

A **Commission** is a clause a run can be flown under: *no upgrades bought*,
*every material your Tier offers, ratcheted*, *nothing lost over the wall*. It
is checked at run end from state the run already carries, and it is claimed as a
**(clause, Tier) pair** — `bare-hands@3` — not as a clause alone.

That pairing is the whole design. A clause claimed alone would make higher Tiers
strictly dominate: satisfy it once at Tier 9 and every lower Tier is dead
content again. Paired, "Bare Hands" is ten separate achievements, the ladder
panel has ten rows of them to show, and replaying Tier 3 has a permanent job.

### Can Commissions gate Tiers? — the honest answer

The question that prompted this document, and the answer is **not as a fourth
requirement, but yes as a second door through an existing one.**

Adding a Commission requirement to tier completion breaks two things:

- **The integrity rule.** `DESIGN.md`: a Tier "completes only when both halves
  are done at that tier … that's what makes a Mark N clear mean the same thing
  for every player who has one." Add a style clause and "cleared Tier 7" starts
  meaning "beat Tier 7 *and* happened to enjoy no-upgrade runs", which is a
  different and much weaker claim.
- **It can hard-stick a player.** Every existing gate yields to playing better.
  A style clause sometimes does not — a player who cannot clear Tier 6 bare-
  handed has the entire rest of the game closed, permanently, with no
  alternative route. The current gate has never had that property and should not
  acquire it.

But the want behind the question is real and the ladder does have a soft spot to
fix: the Contract half of a Tier is **throughput-capped**. Three a day, and a
Contract counts once ever, so a free player who wants to push a Tier today
simply cannot — the door is closed by the clock, not by their play. So:

> **A Commission claimed at the Tier you are currently flying counts as one of
> that Tier's three Contract milestones, and pays the same milestone share of
> salvage.**

Read what that does:

- The ladder does not get **longer** — three milestones, same as today.
- The ladder gets a **second route**, and it is the route that is *not* daily-
  capped, so it helps exactly the player the cap was pressing on.
- It is **monetization-safe in the right direction**: Commissions live in Deep
  Run, which is uncapped for everyone, so this route is worth precisely nothing
  to a subscriber and quite a lot to a free player. Unlimited keeps selling
  throughput.
- Nobody is stuck: Contracts still work, unchanged, for anyone who does not want
  to fly a clause.
- And "max out materials in a run" becomes a legitimate way to *progress*, which
  is what the question was really asking for.

Below the current Tier a Commission pays nothing but the record — no salvage, no
milestone. That is the grind-proofing, and it is the same rule
`recordContractClear` already applies to an off-tier Contract clear. Deliberately
the same rule, not a parallel one: the moment two currencies-of-progress have
different anti-grind logic, one of them is wrong.

### What Commissions are ultimately *for*

Salvage is a poor prize by Tier 8 and a joke by Tier 10. The long-term sink for
Commission claims is **rigs** — `DESIGN.md`'s build-order item 6, currently
specced as bought with salvage, which is the wrong currency for them: a rig is
an *option*, and options bought with a grindable currency are a treadmill
wearing a choice's clothes. Unlocked by Commission instead, a rig is earned by
**playing the way that rig plays**:

| Rig | Earned by |
|---|---|
| **Scrapper** | Demolition Economy — refund enough funds by charge in one run |
| **Overpressure** | Bare Hands at a high Tier — you already fly with nothing |
| **Swarm** | Volume — clear a Tier's run under a launch ceiling |
| **Longshore** | Sweeper Detail taken to the floor and cleared anyway |
| **Twin-Press** | a God Tier finish |

That is the best unlock condition available: the requirement is a tutorial for
the thing it unlocks. Rigs are out of scope for this pass; the claim ledger is
built so they can read it without a migration.

### The clause pool

Every clause is checked from counters the run already keeps or can keep cheaply
(`RunStats` in `run.ts`), and every one is *observable at run end* — nothing
needs a mid-run interrupt. The pool is deliberately small and deliberately
spread across what the game measures: money, placement, restraint, and the
hazard draft.

| Clause | Min Tier | Satisfied by |
|---|---|---|
| **Bare Hands** | 1 | finish with a stock rig — no loadout spent, nothing refitted |
| **Tight Ship** | 1 | finish having lost at most a handful of cubes over the wall |
| **Cold Store** | 1 | finish without firing a Demolition charge or a Bond Breaker |
| **Full Manifest** | 4 | ratchet **every content axis your Tier offers** |
| **Iron Column** | 2 | put four or more notches on one axis and still clear |
| **Salvage Yard** | 3 | refund enough funds by Demolition charge in one run |
| **Sharpshooter** | 2 | clear the run under a launches-per-line ceiling |
| **Clockwork** | 3 | never finish a bay with less than a set margin on the clock |
| **Deep Pockets** | 1 | end the run holding a large float |
| **Full Sweep** | 1 | clear all ten bays — the completion clause, so Tier 1 has one |

"Full Manifest" is the user's *max out materials in a run*, written so it scales
with the Tier rather than needing one clause per material count: at Tier 4 that
is one content axis, at Tier 9 it is six, and both are the same sentence.

The numbers behind "a handful", "enough" and "a set margin" live in
`commissions.ts` as named constants and are a **first pass**. They are the most
likely thing here to need a play pass, and they are the cheapest to move.

## 3. God Tier — the eleventh rung

Past Tier 10 there is one more rung, and it is a different kind of thing: not a
harder Tier but a **daily**. Ten bays, one seed, the same ten bays for everybody
on Earth that day, a board that resets at midnight UTC.

That shape is chosen because it is the only one that does not need feeding.
Authored endgame content is a treadmill nobody on this project has time to run —
the same argument that made Contracts procedural in the first place. A daily
generated from a seed produces a genuinely new object every day forever at a
fixed content cost of zero.

### It is generated the way a Contract is generated

`DESIGN.md`: "**seed + template + difficulty budget** … difficulty becomes a
number you spend rather than an accident of the roll." God Tier uses exactly
that, one level up: the unit being generated is a **run**, not a bay.

- **Seed** — `contracts.ts`'s `dailySeed()`, already shared, already UTC-dated.
- **Template** — a named **day shape** drawn from a small set, so days differ in
  character rather than only in numbers, and the card can say what today is
  before you fly it. `Gauntlet` (bosses, several of them), `Foundry` (materials
  on every belt), `Austerity` (launch ceilings), `Squeeze` (clock and fuel),
  `Wildcat` (spend it anywhere). A template is a *weighting* over the pressure
  menu, not a fixed layout — two Foundry days are not the same day.
- **Budget** — one scalar, spent bay by bay on a menu of pressures, with the
  per-bay allowance rising across the run so bay 1 is a warm-up and bay 10 is
  not.

The pressure menu is entirely made of things that already exist and are already
calibrated:

| Pressure | What it spends | Reuses |
|---|---|---|
| **Notch** | one pre-applied ratchet on a number axis open at Mark 10 | `hazards.ts` |
| **Content** | one pre-applied ratchet on a material axis | `hazards.ts` |
| **Boss** | a Final Inspection clause applied to the bay, un-chosen | `finals.ts` |
| **Ration** | the bay loses its clock and runs to launches instead | `level.ts`'s `launchBudget` |
| **Quota** | a bump to the bay's funding target | `level.ts` |

**A ration is not a launch ceiling on top of the clock**, and the difference
was measured rather than argued. A 150s bay at the ladder's 1350ms cooldown
physically permits about 111 shots, and a human aiming at the measured ~4.5s a
shot fits about 33; the launch model prices bay 2 at 87 launches for a stock
rig, so a ceiling sized off it was never once the binding constraint. Taking
the clock *away* instead makes it the one pressure that changes what **kind** of
bay you are in rather than how much it asks for — which is worth more to a
daily than another multiplier, because a day with four rationed bays is
structurally a different run and not merely a harder one. `DESIGN.md`'s
argument for launch budgets transfers intact: a budget is spent only by acting,
so it is worth the same to a fast player and a deliberate one.

Two rules bound it, both from a two-year sweep of generated days rather than
from taste. **One structural pressure per bay** — a ration never shares a bay
with a boss — and **a rationed bay never buys quota**, because a ration is
*sized* from what the bay demands and stacking a Rush Order plus two quota
units onto a clockless bay produced 179-launch bays, about thirteen minutes.
With both rules the range is 62–105 launches, four to eight minutes.

Templates come out with real identities, which is the test that mattered
(days per template over 730 generated days):

| Template | bosses/day | rations/day | notches/day | quota units/day |
|---|---|---|---|---|
| Gauntlet | 4.3 | 0 | 1.3 | 0.1 |
| Foundry | 1.4 | 0 | 9.1 | 2.2 |
| Austerity | 1.1 | 4.3 | 3.6 | 0.4 |
| Squeeze | 1.0 | 0 | 11.9 | 3.4 |
| Wildcat | 2.0 | 1.0 | 6.1 | 1.9 |

The structural pressures are **placed before the per-bay spend, not rolled
inside it**, and that is the whole reason those rows differ. A bay's allowance
is a tenth or so of the day; a boss costs 30 and a ration 18, so when
everything rolled together the cheap pressures always got there first and every
template produced the same run with different notches on it. Gauntlet — the day
whose entire identity is bosses — dealt exactly the one forced onto bay 10.

**A boss bay is a Final Inspection you did not get to choose.** That is the
whole trick and it is worth stating plainly, because it buys twenty authored,
play-tested, individually sized boss encounters for the price of not passing
`null`. `finals.ts` already carries twenty clauses across ten Tiers, each one
priced in "extra lines the bay demands" against a measured baseline, each with
card copy that names its own number. Applied to an arbitrary bay instead of only
to bay 10, they are exactly what a boss should be: announced, unduckable,
specific, and about one system.

Bay 10 of a God Tier run is **always** a boss, and the run is flown at Mark 10,
which means `level.ts` sends its joints to `Infinity` — the capstone format,
where nothing shatters and the Bond Breaker is the only shatter in the bay. The
run's last bay was already the most authored thing in the game; God Tier just
stops it being the only one.

### The player still drafts

The ratchet draft runs between bays exactly as it always has, and the
pre-applied notches sit *under* the player's picks. Removing the draft would
make the day a fixed obstacle course; keeping it makes the day a **shared
position** that everyone plays their own way — which is what a competitive daily
wants. Chess dailies are not less competitive for letting both sides move.

The offers are seeded off the day, so everyone is dealt the same hands. What
you take is yours.

### Retries, ranking, and the one rule this cannot break

The brief was *limited retries unless you have Unlimited*, and this is the
sharpest tension in the whole document, so it gets stated flat:

> **`DESIGN.md`, twice, in the modes table and again in Monetization: purchasable
> power — none. "You can pay to progress faster, never to rank higher."**

Selling retries on a ranked daily sells rank. Best-of-N against best-of-∞ is not
a subtle advantage on a seeded board; it is the whole board. It would also be
the *first* time the project sold something usable in the exam, and the reason
that line has held is that it is much easier to never cross than to walk back.

What ships instead keeps everything the brief wanted except the part that sells
rank:

- **Today's seed: a fixed number of attempts, the same number for everyone.**
  Best attempt counts. Retries exist, they are limited, and they are limited
  identically whether you pay or not. (`GOD_ATTEMPTS` — one constant, and it is
  the constant to change if this call is overruled. See below.)
- **Unlimited buys the Archive**: every *past* God Tier day, replayable without
  limit, each with its own all-time board. That is a large, genuinely
  attractive, permanently growing product — a new day joins it every 24 hours at
  no content cost — and it cannot move a single live daily ranking, because
  those days are closed.

So the subscription still sells throughput and still lifts a cap, which is what
it has always sold. It just lifts the cap on the days that are not being
scored, exactly as it lifts the cap on Contracts rather than on the exam.

If this call is overruled, the change is `GOD_ATTEMPTS` becoming
entitlement-dependent in one place and this section being rewritten to say the
line was crossed knowingly. It should not be crossed quietly.

### What God Tier pays

Not salvage. The shelf is finished by the time anyone gets here and paying a
currency with nothing to buy is a worse reward than paying nothing.

- **Board rank**, daily, and the archive board forever after.
- **A standing** — best depth, best score, and a **streak** of days attempted.
  A streak is the retention mechanic that costs nothing and pressures nobody:
  missing a day loses a number, never an entitlement or a currency.
- **Commissions**, at a Tier above the ladder. The hardest clauses want a bay
  ladder harsher than Tier 10 to be interesting, and this is it.

## 4. Boards

One table, one new column. `scores` gains `board TEXT NOT NULL DEFAULT 'run'`
and an index on `(board, score DESC)`; `level` stays exactly as it is so
existing rows keep meaning what they meant and the old client keeps working.

| Board key | What it ranks |
|---|---|
| `run` | every score written before this change — the legacy board |
| `tier:N` | Deep Run at Tier N, replays included, budget-clamped so it is fair |
| `god:YYYYMMDD` | that God Tier day |

`finalRunScore` is unchanged and already ranks *failed* runs sensibly (bays
cleared dominate, lines next, funds as a tie-break) — which matters more here
than anywhere else, because most God Tier runs are supposed to end short of bay
10 and a board that only ranked finishers would be empty for a week.

The Worker is a manual, rare deploy (see the README), and this is one of the
rare times: `app/worker/`, `migrations/` and `wrangler.jsonc` are all in scope,
migration first.

## Build order

1. **`RunStats` on `RunState`** — nothing else can be checked until the run
   counts what it did.
2. **Commissions**, model layer — the clause pool, the `(clause, Tier)` ledger,
   the at-Tier milestone rule folded into `meta.ts` beside the Contract rule it
   copies.
3. **Tier replay** — `safeLoadout(meta, tier)`, `trimLoadout`, and the one line
   in `startGame` that stops assuming `markUnlocked`.
4. **The tower** — the attract demo's corner, plus the ladder modal behind it;
   the only piece of this that is pure UI.
5. **Boards** — migration, Worker, `api.ts`, and deleting the hardcoded `1`.
6. **God Tier** — the generator and its sim proof, then its screens.
7. **Rigs**, later, reading the Commission ledger that step 2 built.

## Settled

- **A replay flies the replayed Tier's budget.** Not the player's. The board is
  the reason, and it is not negotiable without giving up what a Tier board
  means.
- **Commissions do not add a gate.** They open a second, uncapped door through
  the Contract gate that already exists, at the current Tier only.
- **A Commission is a (clause, Tier) pair.** Claimed once, ever, per pair.
- **Below-Tier claims pay nothing but the record.** Same anti-grind rule as an
  off-tier Contract, deliberately the same rule.
- **A boss bay is an unchosen Final Inspection.** Twenty of them already exist,
  already priced.
- **Ranked attempts are equal for everyone.** The subscription lifts the cap on
  closed days, never on the live one.

## Open calls

- **How many attempts on a live day?** Three is the first pass — enough to
  recover from one bad opening, few enough that the board is not an endurance
  test. Wants play.
- **The clause thresholds.** All first-pass. `sim/` can price some of them (a
  launches-per-line ceiling is exactly what `PLANNING_EFFICIENCY` measures) but
  the restraint clauses are invisible to a bot that never uses an ability, which
  is the same blind spot `ECONOMY.md` already records.
- **Does the ladder show locked Tiers' content?** Showing Tier 7's hazard axis
  on a locked rung spoils a reveal; hiding it makes the ladder a row of
  question marks. Currently: number and lock state only.
- **Does the tower survive losing the wordmark?** The menu no longer says what
  the game is called anywhere except the tab title. That is the right trade for
  a screen a returning player sees every session and the wrong one for a
  screenshot in a store listing, and the store listing is a real constituency.
- **"God Tier" is the working name.** It reads as a meme next to Launch Bay,
  Cargo Dock and Freight Yard. `DEAD SHIFT`, `BLACK SHIFT` and `THE LONG HAUL`
  all fit the world better. Not renamed yet because the brief named it and a
  rename is one constant.
- **Streak reset rule** — miss a day and lose it, or a grace day? The former is
  cleaner and the latter retains better, which is the same trade `DESIGN.md`
  already has open for the daily Contract refresh, and the two should be settled
  together.
