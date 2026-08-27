# COUNTER SYSTEMS — what to build about the combos the sweep cannot win

Companion to [`winnability-sweep-findings.md`](./winnability-sweep-findings.md),
which is the measurement. This is the argument built on it.

> **STATUS, 2026-08-27 — one of the two shipped.**
>
> - **§2b THE THAW LANCE: SHIPPED**, as the eighth ship system
>   (`upgrades.ts`'s `thaw` track). What changed on the way in is recorded in
>   §2b itself and re-measured in the findings' §5a; the short version is that
>   the charge ladder went from 2/4/6 a bay to **3/6/9**, because the first
>   rung at two measured as buying nothing at all.
> - **§2a THE IMPACT CUSHION: still not built** — but no longer for the reason
>   this line was first written with. The blocker §3b named was volatile being
>   worth *not* neutralising, and the re-price that removed it has since landed
>   (`level.ts`'s `VOLATILE_LOSS_SHARE`). §3b now reads "the blocker is cleared
>   — it now has a job". Nothing about the lance turns on that; the two are
>   adjacent systems that shipped from one document in two branches, and the
>   cushion is the one still owed.
>
> Everything below the two verdict blocks is the argument as it was made, kept
> as the argued record rather than rewritten to match what shipped. Where the
> implementation disagreed with the proposal, the proposal is left standing and
> the disagreement is marked.

The prototypes lived in `app/sim/counters.ts`. The cushion still does — it
mutates a `LevelConfig` seam and ships no gameplay. The lance's prototype has
been **retired**: `thawKit` there now grants the real `LevelConfig.thawCharges`
and its hands pull the real `Game.useThawLance`, so the CLI that priced the
proposal now prices the system, on the same flags.

The order of the sections is the order the argument has to be made in, and the
first one is the one it is easiest to skip:

1. **Which findings license a new system at all.** A combo the sweep loses while
   the pilot is holding a charge it never fires is a statement about the pilot.
2. **The two systems seeded by the request** — a rear-bay cushion for volatile,
   a thaw rig for cryo — specified: priced, tiered, placed in the shop.
3. **What the data says about each.** One is validated. The other works
   perfectly and should not be built yet, and finding out why is the most
   useful thing this exercise produced.
4. **Where the data says the problem is NOT a missing system** — which is most
   of it, and includes the finding that dwarfs both proposals.

**Read §3 before §2.** §2 is the specification; §3 is the verdict, and for one
of the two systems the verdict is "not yet".

---

## 1. The bar a proposal has to clear

`hazards.ts` states the design's whole theory of counters in one sentence:

> A system does not DELETE a hazard, it makes one specific hazard cheap for you.
> Own the Launcher and crosswind is the notch you can afford.

That gives three tests, and a proposal that fails any of them is a difficulty
setting wearing a system's name:

| test | what it rules out |
|---|---|
| **The hazard survives it.** A counter changes the PRICE of a notch, never its existence. | A cushion that makes volatile inert |
| **It is bought against the same budget.** `upgrades.ts`: one shared 20/35/55 ladder, because "the tracks are meant to be balanced against each other by EFFECT, and a shared price keeps *which system do I want* the whole decision". | A proposal arriving with its own price table, i.e. asking not to be compared |
| **The measurement was taken against every EXISTING counter.** | Proposing a system to solve a problem demolition already solves |

The third is the one this work had to build an instrument for, and it is worth
recording what it changed. `sim/README.md` has carried the caveat since the
harness shipped — *the bots never use Bond Breaker or Demolition, so those
tracks measure as worthless* — and half of it closed when `bots.ts` grew `demo`.
`sim/counters.ts`'s `bondHands` closes the other half. The pilot every number
in the findings was measured against therefore fires **both**. What is still
open is listed in the findings' pessimism ledger and runs one way: no lookahead,
a fixed landing target, no reading of the pile. **A human clears bays this pilot
loses**, so every "needs a new system" below is a claim about a *floor*, not a
proof.

---

## 2a. THE IMPACT CUSHION — volatile's counter

> **Verdict first (§3b): specified, prototyped, measured — and NOT to be built
> until volatile is re-priced.** The prototype does exactly what this section
> describes. What it revealed is that the hazard it counters is currently an
> ADVANTAGE, so the system would be a correct answer to a question the game is
> not asking. The specification stands; the order of work changes.

### What it is

A shock-absorbing floor liner across the **deep end** of the bay: cargo that
lands past the cushion line arrives soft. It is bought like any other track, at
a refit stop and in the Workshop, and it does one thing — raise the impact speed
at which a **volatile** shipment detonates.

### Why the seam already exists

`level.ts` ships `volatileTriggerMult`, a per-bay multiplier on
`lineClear.ts`'s `VOLATILE_TRIGGER_SPEED`. Today exactly one thing writes it —
`finals.ts`'s Hair Trigger, at 0.85 — and only downward. The cushion is that
same seam driven the other way. Nothing new has to be invented in the config
layer, and the prototype is one line.

### The tiers, and where their numbers come from

`lineClear.ts`'s own note records the distribution the trigger was placed
against: *"measured over every angle/power the cannon can produce, first-contact
relative speed runs 17.3 to 30.8"*, with the median at 19.5 on the softest lob
and 25.5 at full power, and the threshold set to 22 so that *"lob it and it
survives (67% of launches), fire it hard and it goes off"*. The three tiers are
placed on that measured range, not on round numbers:

| tier | mult | effective trigger | what it buys |
|---|---|---|---|
| 1 | ×1.15 | 25.3 | a full-power shot is a coin flip instead of a detonation (its median is 25.5) |
| 2 | ×1.30 | 28.6 | inside the top decile of the arrival range |
| 3 | ×1.40 | 30.8 | the measured MAXIMUM: no launch the cannon can produce sets a cube off **on arrival** |

Price: the shared ladder, 20 / 55 / 110 cumulative — `TIER_COSTS` unchanged.

**Tier 3 stops exactly at the top of the range, and that is the design.** Past
it the material is inert and the cushion is a delete button. At ×1.40 volatile
still detonates when something lands hard *on top of it* — which is the
material's actual identity, *"the one material whose cost lands on cubes that
were already safely down"* — the cushion only buys back the arrival.

### Where it sits in the shop

Volatile opens at **Mark 7** (`hazards.ts`). `MATERIAL_DRAFT_BAYS` puts a forced
material one bay before each refit stop precisely so *"the player meets the
problem, plays a bay against it, and walks straight into the shop that answers
it"* — so the cushion belongs on the refit menu from Mark 7, and in the Workshop
as an install at the price band `meta.ts` reserves for a late system (70
salvage, beside Bond Emitter and Demolition Rack), gated `requiresMark: 6`.

### The finding this prototype produced on its own

`sim/systems.ts` pins it, because it is a live consequence rather than a
worry: **a maxed cushion overshoots Hair Trigger.** The clause primes at 0.85
and the cushion's ceiling is 1.40, so a Tier-7 final bay under Hair Trigger
lands at **1.19× stock** — the exam is not merely paid off, it is walked past
into a bay *safer* than an ordinary one.

The arithmetic is unavoidable: any cushion that achieves its stated job (no
arrival detonates, i.e. reaching 30.8/22 = 1.40) clears 1/0.85 = 1.176 on the
way. So the fix goes on the **clause** side, not the cushion's number, and there
are two candidates:

- Re-size Hair Trigger to bite proportionally on the rig that accepted it, the
  way `finals.ts`'s Rate Cut already does for the Reactor — the pair's own
  design language is "a flat raise vs a percentage cut", and a *floor* on the
  final trigger (never above stock, however cushioned) is the percentage
  reading.
- Or give the Tier-7 pair a second clause aimed at the half of volatile a
  cushion cannot touch — the neighbour detonation — so the exam still has a
  question for a cushioned rig.

`finals.ts` already carries a standing `TODO: re-size it` on the Tier-1 pair for
a neighbouring reason. This is a second instance of the same class of bug: **a
clause sized against a rig that did not yet exist.**

---

## 2b. THE THAW LANCE — cryo's counter

> **SHIPPED.** `upgrades.ts`'s `thaw` track, `game.ts`'s `useThawLance`,
> `lineClear.ts`'s `nextColdCryo`. Three things about the shipped system are
> NOT what this section proposed, and each is marked below: the **targeting
> rule** (§2b "Which cube"), the **charge ladder** (3/6/9, not 2/4/6), and the
> **Skydeck's resupply** (there is none).

### What it is

A charge, not a shot. Press it and it thaws one settled frozen cube — the same
state change `lineClear.ts`'s `strikeCryo` produces when a fast shipment hits a
resting cryo cube, minus the shipment. **Charges renew every bay** — on the
ladder. See "The Skydeck" below.

### WHICH CUBE — the one thing the proposal left open, answered

The proposal said "one settled frozen cube" and did not say which; the prototype
took the first in the field list and called that naive. The shipped rule is
**the frozen cube the press is about to reach** (`lineClear.ts`'s
`nextColdCryo`), and it follows from what the charge is for:

- The lance sits on the ability row beside the Bond Breaker, which takes no aim.
  A button that then thawed an ARBITRARY cube would be unreadable. This rule is
  one the player can hold in their head and predict.
- It is also the only cube worth a charge. `shatterColdCryo` is what happens to
  a frozen cube that reaches the advancing face — it breaks, and takes its row's
  alignment with it. The cube at the bar is the one whose cost is about to be
  paid; a cube three slots deeper is a problem a shipment can still answer,
  which is the counter-play cryo is supposed to be about.

Three exclusions, each a wasted charge rather than a nicety: stranded cargo left
of `compactor.strandCutoffX` (never pressed, and it would otherwise have the
smallest x on the field and swallow the whole rack), cubes above the bar's
reach, and cubes still in flight (`strikeCryo` refuses those too).

### THE SKYDECK — no yard, no resupply

Not in the original proposal, and it is the mode's own rule rather than a new
one: `skydeck.ts` shuts the yard, "the rig that undocks is the rig that lands".
So a Skydeck run's lance is **one rack for the whole run** — it falls as it is
spent and never comes back, exactly like the Bond Breaker magazine. A ladder run
docks three times and flies a rack that renews at every bay boundary.

Both rules are `run.ts`'s `advanceRun`, one branch apart, and that branch is why
the charges live on `RunState` rather than being re-derived per bay the way the
Demolition Rack's are: a config rebuilt from the tiers each bay cannot express
"and not on the Skydeck".

### Why per-bay charges, and not a run magazine

This is the proposal's one real disagreement with the Bond Emitter it would sit
beside, and it follows from what the two materials *are*:

- A Bond Breaker is an emergency reset — *"shatter the field flat, once, where
  it counts most"* — so a run-long magazine of three (`run.ts`'s
  `bondChargesFor`) is the right shape.
- Cryo is not an emergency, it is a **tax**. `hazards.ts` puts a first notch at
  `MATERIAL_BASE` 0.07 of the belt and `belt.ts` caps the belt at one special in
  three, so a cryo run meets frozen shipments in **every bay**, forever. A
  once-a-run answer to a per-bay tax is not an answer.

The user's framing — *"replenishable charges"* — is the same reading, and it is
why the tier ladder is stated in charges per bay:

| tier | charges/bay | answers |
|---|---|---|
| 1 | 2 | one notch of cryo (0.07 of the belt ≈ 3-4 frozen cubes a bay) |
| 2 | 4 | two notches |
| 3 | 6 | a cryo-heavy build, and still not a Cold Chain final |

Price: the shared ladder again, 20 / 55 / 110.

> **SHIPPED AT 3 / 6 / 9, and this table is what the measurement overruled.**
> Its own middle column is the argument against it: one notch puts *3-4 frozen
> cubes a bay* on the floor, and two charges covers half of them. At 48 paired
> seeds the first rung at two bought **nothing** — 29/48 against an un-lanced
> 29/48 — where at three it buys six bay-wins. The findings' §5a has both
> ladders side by side. The design's own bar is `upgrades.ts`'s: "a shop where a
> purchase projects nothing teaches that the purchase does nothing."
>
> **Salvage price: 50, not the 70 band.** The proposal put the cushion beside
> Bond Emitter and Demolition Rack; the lance is priced a band under both,
> because those two answer every build (an emitter flattens any pile, a rack is
> the only exit for dead cargo of any kind) and this one answers one axis and
> has a measured ceiling. It also keeps §5's open question 4 open rather than
> closing it: the shelf is 495 against 600 of income, not 585.

### Why it is NOT a Bond Breaker mode

The obvious cheap version is *"tier 4 of the Bond Emitter also thaws"*, and it
should be rejected. `upgrades.ts` gives the Bond Emitter a coherent identity —
bond control, charges plus the Seam Splitter passive — and thaw shares nothing
with it: different resource shape (per-bay vs per-run), different target (one
cube vs the whole field), different failure mode. Bolting it on would make the
emitter the track you buy for two unrelated reasons, which is exactly the
"which system do I want" decision the shared price ladder exists to protect.

The one place the two SHOULD share is the **control**: a thaw charge is armed
and spent the way a Bond Breaker is, on the HUD's ability row, so a player who
has learned one has learned the other.

### The other half of cryo the lance does not touch

`shatterColdCryo` is the consequence half — a cold cube that reaches the press
*shatters and knocks its row off the slot grid*. The lance answers the inert
half (the row that will not sell); the shatter stays a real punishment for
ignoring a cube, which is what keeps cryo about **sequencing** rather than about
owning a system. That is deliberate and it is what stops the lance being a
delete button.

---

## 3. What the measurements say

The tables are in the findings' [§5](./winnability-sweep-findings.md#5-counter-prototypes-measured);
this is the verdict on each proposal.

Both prototypes are deliberately **upper bounds** — stated in `counters.ts` and
worth repeating, because it is what makes a negative result decisive:

- The cushion is modelled **field-wide**, where the proposal is rear-bay only.
  So: *this is the most a cushion could possibly be worth.*
- The thaw rig **never misses and costs no launch**. So: *this is the most a
  lance could possibly be worth.* (It is naive in one direction too — it thaws
  the first eligible cube, not the most urgent one.)

### 3a. THE THAW LANCE: BUILD IT

Tier 5, bay 5 — the bay a run reaches immediately after `MATERIAL_DRAFT_BAYS`
forces its first material. 24 paired seeds on the `material` rig:

| | win | shots | end $ |
|---|---:|---:|---:|
| clean control | 23/24 | 23.8 | $1283 |
| `rebar:1` control (8 seeds) | 8/8 | 25.3 | $1281 |
| `time:3` control (8 seeds) | 8/8 | 26.6 | $1319 |
| **`cryo:1`** | **17/24** | **32.2** | **$921** |
| `cryo:1` + Lance 1 | 20/24 | 31.6 | $1105 |
| `cryo:1` + Lance 2 | 21/24 | 25.7 | $1140 |
| `cryo:1` + Lance 3 | **23/24** | 22.6 | $1347 |

Validated on every count a proposal can be:

1. **The problem is real and specific.** One notch of cryo — `MATERIAL_BASE`,
   7% of the belt — costs 6 bay-wins in 24. An identically-priced notch of
   REBAR costs nothing; THREE notches of Shift Cut cost nothing at all (that
   bay is lost on money long before the clock binds). This is not "materials
   are expensive"; it is cryo, on a table where most axes are free.
2. **The cost is where the design says it is.** Shots rise 23.8 → 32.2 while
   lines *also* rise and funds fall — the bay is not failing to clear rows, it
   is buying each one twice, which is exactly `strikeCryo`'s stated cost.
3. **The lance is priced in the same currency as the problem, and stops where
   the problem stopped.** Each tier buys back shots monotonically and tier 3
   lands *on* the clean control (23/24) rather than past it — the "makes one
   hazard cheap for you, does not delete it" test from §1.

**One boundary, and it is a real one: the lance does not scale.** At three
notches of cryo (17% of the belt) on a late bay, 24 paired seeds, the bay costs
twelve wins in 24 (21/24 clean → 9/24) and the full lance buys back two —
inside the noise. That is `counters.ts`'s own sizing working as stated ("two
charges answers a first notch and leaves the second notch genuinely
unanswered"), and it means the lance is an answer to the FORCED first notch, not
to a cryo build. If a cryo build should be survivable, the charge count is the
wrong lever and the material's rate is the right one.

(An earlier 8-seed pass read this as actively *harmful* and had a mechanism
ready — `shatterColdCryo` destroys a frozen cube that reaches the press, so
thawing keeps a cube on a field the pilot wants emptier. At 24 seeds the sign
reverses. The mechanism may be real; the measurement was not powered to say so.)

**What is still owed:** the harness has no bot that strikes cryo with a
shipment, so this measures the lance against a pilot with no counter-play at
all. Before implementation, the findings' §7 item — a striking bot — should
separate "cryo needs a system" from "cryo needs the counter-play it already
has". The measurement above says the first; it cannot yet rule out the second.

> **STILL OWED, and shipped anyway.** The striking bot was not built and this
> item is not closed. What made shipping the right call regardless: the item is
> a question about whether the lance is *necessary*, and the tables above and in
> the findings' §5a answer the questions about whether it is *well-shaped* — it
> makes one hazard cheap, monotonically, and stops short of the clean control at
> every tier. A striking bot would move the un-lanced baseline up; if it moves
> it far enough that cryo stops being an outlier, the lever to reach for is this
> constant, not a removal, and re-running `--mode counter` will say so.

### 3b. THE IMPACT CUSHION: the blocker is cleared — it now has a job

> **UPDATED.** This section used to read "do not build it yet". The blocker it
> named — volatile being worth *not* neutralising — has been removed:
> `level.ts`'s `VOLATILE_LOSS_SHARE` bills a detonation for the live cargo it
> destroys. The argument below is kept because it is why the re-price came
> first, and the verdict at the end of it has changed.

The prototype always worked, and that is how the finding was made. At Tier 7, 16
paired seeds, a maxed cushion returned a belt that was one-third volatile to
results *byte-identical* to a clean bay. The problem was the bay it returned to:

| Tier 7 bay 10, 16 seeds | clean | `volatile:6` BEFORE | `volatile:6` AFTER |
|---|---:|---:|---:|
| win | 14/16 | **16/16** | **10/16** |
| shots | 28.1 | 48.0 | 43.6 |
| end $ | $1694 | **$1962** | $1212 |

Before the re-price the volatile notch was an *advantage*, so a cushion sold
into that bay was a system a player should decline — cushioning cost you wins.
After it, the same prototype restores the clean baseline:

| | bare | + Cushion 1 (20 pts) | + Cushion 3 (110 pts) |
|---|---:|---:|---:|
| `volatile:6`, Tier 7 bay 10 | 10/16 | **14/16** | **14/16** |
| `volatile:6`, Tier 7 bay 5 | 8/16 | **15/16** | **15/16** |
| `volatile:3 wind:3`, bay 10 (8 seeds) | 5/8 | **8/8** | **8/8** |

It lands **on** the clean control (14/16 against 14/16, 15/16 against 15/16),
never past it — which is exactly the §1 test: a system makes one hazard cheap
for you, it does not delete it.

**What is still owed before it ships**, unchanged by any of this:

1. Tier 1 already restores the baseline on its own, so the three-tier ladder as
   specified in §2a is not what the data asks for. Either the tiers need
   re-sizing against the re-priced axis, or the system is one purchase rather
   than a track.
2. The model is still **field-wide** where the proposal is rear-bay only. That
   gap is stated in `sim/counters.ts` and is unchanged: these numbers remain the
   most a cushion could be worth.
3. §3c's Hair Trigger overshoot still stands and still wants fixing on the
   clause side.

### 3c. The Hair Trigger overshoot

`sim/systems.ts` pins it: a maxed cushion lifts a Tier-7 Hair Trigger bay to
**1.19× stock**, so the exam is not paid off but walked past. The arithmetic is
unavoidable — the clause primes at 0.85, and any cushion that achieves its
stated job (30.8/22 = 1.40) clears 1/0.85 = 1.176 on the way — so the fix goes
on the clause side. `finals.ts` already carries a standing `TODO: re-size it` on
the Tier-1 pair for a neighbouring reason; this is a second instance of the same
class: **a clause sized against a rig that did not yet exist.**

---

## 4. Where the data says the problem is NOT a missing system

This is the section that justifies the instrument. Most of what the sweep found
is answered by things that already exist, or by numbers that already exist, and
shipping a system for any of it would be building the wrong thing.

- **VOLATILE — done.** This was listed here as a number change rather than a
  system, and it has been made: `VOLATILE_LOSS_SHARE`. See §3b.
- **THE ECONOMY, which is the actual finding.** Every wall in the findings'
  §2 and §3 is `broke` — at Tier 1 as much as at Tier 10, under every draft
  policy, at every corner of the notch space. Tier 10 ran 112 runs across
  fourteen policies and **not one reached bay 5**. No counter system fixes an
  economy. The levers are `level.ts`'s `LAUNCH_BUDGET_SHOTS` / `scorePerLine` /
  the launch-cost ladder, `run.ts`'s `CARRY_CAP`, and `hazards.ts`'s
  `ladderStart` slide. **This is the work; the two systems above are the work
  after it.**
- **Slag.** On `--build spatial` (no Demolition Rack) slag looks unanswerable;
  on `--build material` it stops looking that way and is the *best* corner at
  Tier 10. Slag's counter shipped. What it needs is for the player to have
  bought it — a shop-and-signposting question.
- **Rebar.** Measured cost of a first notch: nothing. Its passive answer works.
- **Tar.** `upgrades.ts`'s Demolition capstone already names this case and
  answers it with `DEMO_BLAST_MULT`. The question is whether the capstone is
  *reachable* in a run that ratcheted tar, not whether an eighth system exists.
- **Shift Cut.** Three notches of the time axis at Tier 5 bay 5 produced results
  byte-identical to no notches at all: the bay is lost on money long before the
  clock binds. An axis with no measurable cost is its own finding, and it is not
  a counter-system one.

---

## 5. Open questions this document cannot close

1. **Does a rear-bay-only cushion retain enough of the field-wide effect?** The
   harness cannot say. It needs the positional rule written, which is gameplay
   code and out of scope here.
2. ~~**Is one cube per thaw charge the right unit?**~~ **ANSWERED BY SHIPPING
   IT:** one cube, and the middle option this question reached for — "thaw
   everything in the press band" — turned out to be the *targeting rule* rather
   than the unit. The shipped lance takes one cube and takes the one AT the
   press, which pairs with `shatterColdCryo` exactly as this question wanted
   while keeping the charge comparable to the shipment it replaces. A field-wide
   thaw remains untested and remains a different, larger proposal.
3. **Which Tier owns each exam?** If the cushion ships, Tier 7's Final
   Inspection pair is its exam and needs re-sizing (§2a). If the lance ships,
   Tier 4's pair (cold-chain / ice-wall) becomes the lance's exam and wants the
   same re-derivation.

   **STILL OPEN, and now it has a deadline.** The lance shipped, so Tier 4's
   pair IS its exam and was sized against a rig that could not carry one. It was
   deliberately left alone here — re-sizing a clause is a measurement of its own
   and belongs in its own branch, beside `finals.ts`'s two standing `TODO:
   re-size it` notes, not appended to the system that made it necessary.
4. **What comes off the shelf?** `meta.ts` prices the whole Workshop shelf at
   445 salvage against 600 of income, *"slack enough to make a wrong purchase
   survivable, tight enough that the choice is a choice"*. Two more installs at
   70 each is 585 against 600, which closes that slack to nothing. Either the
   income moves or one of these is not an install.

   **ANSWERED, for now, by shipping ONE of them at a band down.** The lance is
   an install at **50**, which puts the shelf at 495 against 600 — 105 of slack
   where two 70s would have left 15. Nothing came off. The question returns
   intact the day the cushion (or a ninth system) is argued for, and the answer
   then cannot be "another 70" twice.
