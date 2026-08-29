# TIMED CLEARS — grading a row by when it closed, and paying it accordingly

> Companion to `winnability-sweep-findings.md` and `aim-strategy-findings.md`.
> Those price notch combos and ship systems; this one prices the ACT — what a
> row was worth as a piece of play rather than as cargo.
>
> Instruments: `app/src/game/grades.ts` (the clock, the ladder and the two
> gates), `app/sim/timing.ts` (four modes: `arms`, `target`, `burn`, `scrap`),
> `app/sim/aim-strategies.ts`'s `timed` and `excellent` policies,
> `app/sim/_scratch-flight.ts` (the flight probe),
> `app/sim/_scratch-target.ts` (the target calibration) and
> `app/sim/_scratch-pacing.ts` (the pacing decomposition). Pins in
> `app/sim/systems.ts`.
>
> Every number below is a BOT number and carries this harness's standing
> pessimism (no lookahead, one landing target a shot, a fixed flight estimate).
> A human clears bays these pilots lose, and reaches grades these pilots miss.

---

## 0. THE COMPLAINT

The owner's verdict on the top of the ladder, verbatim:

> *"currently the game is not challenging at sky levels in the early part of the
> run, the maxed out systems carry you over and it's boring. I'm thinking we can
> increase the payout of lines and the targets so we can enforce good/excellent
> shots by simply raising the target in later tiers and skybridge"*

`level.ts`'s MARK SCALING note had already measured why the obvious half of that
does not work on its own:

> *TARGET is a DURATION knob, not a difficulty one. […] Once income per line
> exceeds spend per line, a competent player reaches ANY target given time.
> Three separate sweeps over 0.06-0.38 returned byte-identical win rates.*

That finding is **untouched**. What this change does is make its premise false:
income per line stops being one number, so a raised target has something to bite
on for the first time.

### 0b. The second brief — the ladder the owner actually wanted

The first version of this mechanic shipped, was played, and came back with six
more sentences. They are quoted where they are acted on, and collected here
because together they change the shape rather than the numbers:

| the ask | where it lands |
|---|---|
| *"no excellent or good should be awarded while in congestion. we need to punish congestion."* | §2e |
| *"the piece that has just been launched need to be part of the line."* | §2f |
| *"the only other occurrence in game of good timing is if the piece lands above a cube that couldn't form a line unless the weight of the impact actually pushed it down at the right time…"* | §2g |
| *"also shorten window for excellent, it should be within like 100ms from landing the line completes with that piece."* | §1, §2h |
| *"if the piece lands when the compactor is moving right and then clears, it's good."* | §1 |
| *"we need to differentiate the colors for each timing level."* | theme.ts's GRADE_COLOR |
| *"can the aim bot only do excellent launches?"* | §2i |
| *"given this extra boost of points, levels are feeling very short… raise the base target by like a lot"* | §3a |
| *"it also may be because my reactor is upgraded to tier 2 at tier 2… maybe we need to gate the upgrade"* | §9 |

Read together, they are one correction: the first ladder graded a row by the
PRESS's phase, and the owner wants it graded by the SHOT. Every one of the first
five is a way of asking the same question — *was this row yours?* — and the
answer needed a tighter clock (100ms), a rule about whose cargo closed it
(participation), and a refusal to pay a premium over a bay already lost
(congestion).

---

## 1. THE CLOCK — three integers, and the owner's own four sentences

A row's grade is a pure function of integers stamped on cargo and read again on
the step a row clears:

| counter | what it is |
|---|---|
| `strokes` | completed advances — the "sweep" the player watches |
| `halfCycles` | every stop flip, both ends: the finer hand |
| `stepCount` | the engine's FIXED step, the only clock that measures a duration |

Every cube is stamped with all three the **first** time it is seen at rest. A
row is graded on the landing that CLOSED it: the newest stamp among the cubes
that filled its slots, or — in the impact-assist case (§2g) — the shipment
resting on top of them.

**The third counter is new and it is not a regression.** The first version of
this mechanic split its top two bands on the bar's DIRECTION and needed no
tolerance constant at all, which was elegant. The owner then measured it against
the thing that actually matters:

> *"also shorten window for excellent, it should be within like 100ms from
> landing the line completes with that piece"*

A duration cannot be said in bar phases. It costs the determinism claim nothing,
because `stepCount` is not wall time — the engine steps at a fixed 1000/60 ms
whatever the display is doing, and the bar counters are themselves derived from
it. `now` still appears nowhere in the money.

### The ladder

| band | rule | reads as |
|---|---|---|
| **EXCELLENT** | the row completed within **100ms** of the landing that closed it | the shipment dropped into a ready row and the press took it on the spot |
| **GOOD** | the piece landed while the bar was **moving right**, and the row cleared on **that same** rightward stroke | timed into the approaching sweep; the sweep still had to finish it |
| **SWEPT** | the press had to bring it in: a retreat landing the next press sold, or 1-2 completed sweeps | *"lucky or planned?"* |
| **LUCKY** | 3+ sweeps | *"definitely lucky"* |

Both of the top two are the owner's own sentences. The second of them is
**exactly the predicate the old top band used**, so the change is not a rewrite:
the old EXCELLENT rule kept its meaning and moved down one rung to become GOOD,
and a genuinely tighter rule went above it. What used to be GOOD — a landing on
the RETREAT that the next press sold — falls to SWEPT, because the owner's GOOD
sentence asks for a rightward landing and that is not one.

**"On that same stroke" needs no direction field.** A row can only clear while
the bar is advancing (`updateLineClear` is gated on `pressing`). A cube that
landed during a retreat cannot be cleared without the bar first hitting its open
stop, and that stop ticks `halfCycles`. So `landing.halfCycle === clock.halfCycle`
says both halves of the sentence at once — landed on a rightward stroke, and no
stop since, i.e. still that stroke. One integer comparison.

**EXCELLENT is not required to be a subset of GOOD.** A slam can land on the
tail of a retreat, flip, and be crushed inside the window: leftward landing,
hundred-millisecond clear. The owner's EXCELLENT sentence says nothing about
direction and neither does the code — the window is the primary definition and
is checked FIRST. Pinned as its own case.

**The threshold is inclusive and lands on a whole tick.** 100ms is exactly 6
fixed steps (6 x 16.667 = 100.0), so there is no argument about which way to
round; `within 100ms` reads as "no more than", and an exclusive test would make
the owner's own number the first value that fails.

**First rest and never again.** Cargo a blast or a shatter kick throws back into
the air re-settles carrying its original landing. The alternative would let a
player refresh a stale pile's clock by disturbing it. The bias runs one way:
disturbed cargo can only grade a row **down**.

Nothing in the money reads `now`. `sim/` reproduces a bay's payouts bit-for-bit
at any frame rate, which the pins check by clearing identical sim state twice.

### 1b. The flight constant, and the bug the census caught

`aim-strategies.ts`'s `timed` policy has to predict where the bar will be when
its shipment finishes arriving. The first value for that constant was taken from
the reload cooldown — 120 steps, "about two seconds" — and it was wrong in a way
that only a census could see: at 120 the *timed* arm scored **0% EXCELLENT** at
bay 10 on every seed while the undisciplined control managed 7%. The pilot named
for the band was timing itself out of it.

Measured (`sim/_scratch-flight.ts`, launch to every cube of the shipment at rest,
over the aim search's own grid, wind pinned off):

| bay | min | p25 | median | p75 | max |
|---:|---:|---:|---:|---:|---:|
| 1 | 33 | 60 | **71** | 85 | 107 |
| 5 | 37 | 59 | **74** | 82 | 103 |
| 10 | 34 | 64 | **75** | 83 | 104 |

Flat across the ladder, which is the reason one constant is defensible:
`compactorSpeed` ramps per bay but gravity, drag and the muzzle range do not. It
is also exactly why EXCELLENT gets rarer as the ladder climbs — the press gets
faster while the flights stay the same length.

---

## 2. THE CENSUS — does the grade separate two ways of playing?

Four arms, one bot, one aim search; the only difference between rows is the
policy (`sim/timing.ts --mode arms`, full build, 4 seeds, **shipped numbers:
100ms window, both gates, the recalibrated target curve of §3**).

| Mark | Bay | Arm | Win | Lines | Shots | End/Tgt | Exc | Good | Swept | Lucky | Timed% |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 1 | sweep | 50% | 11.3 | 38.3 | 0.55 | 0% | 0% | 96% | 4% | **0%** |
| 4 | 1 | timed | 100% | 8.5 | 23.8 | 1.19 | 3% | 24% | 68% | 6% | 26% |
| 4 | 1 | excel | 100% | 8.8 | 24.3 | 1.12 | 0% | 26% | 63% | 11% | 26% |
| 4 | 1 | burn | 75% | 19.8 | 57.8 | 0.84 | 0% | 0% | 90% | 10% | **0%** |
| 4 | 10 | sweep | 75% | 30.0 | 81.8 | 1.02 | 0% | 0% | 73% | 28% | **0%** |
| 4 | 10 | timed | 100% | 8.8 | 23.3 | 1.12 | 0% | 60% | 29% | 11% | 60% |
| 4 | 10 | excel | 100% | 8.5 | 22.0 | 1.13 | 3% | 3% | 85% | 9% | 6% |
| 4 | 10 | burn | 75% | 25.8 | 73.8 | 0.96 | 0% | 0% | 87% | 13% | **0%** |
| 10 | 1 | sweep | 25% | 22.3 | 67.8 | 0.33 | 0% | 1% | 90% | 9% | 1% |
| 10 | 1 | timed | 100% | 13.3 | 34.8 | 1.12 | 2% | 19% | 66% | 13% | 21% |
| 10 | 1 | excel | 75% | 12.8 | 33.5 | 0.99 | 0% | 20% | 73% | 8% | 20% |
| 10 | 1 | burn | 0% | 27.8 | 85.0 | 0.10 | 0% | 0% | 91% | 9% | **0%** |
| 10 | 10 | sweep | 25% | 28.3 | 80.0 | 0.68 | 0% | 0% | 78% | 22% | **0%** |
| 10 | 10 | timed | 75% | 14.0 | 35.8 | 0.92 | 0% | 34% | 50% | 16% | 34% |
| 10 | 10 | excel | 75% | 14.5 | 38.3 | 0.92 | 0% | 3% | 66% | 31% | 3% |
| 10 | 10 | burn | 25% | 34.3 | 90.3 | 0.83 | 0% | 0% | 70% | 30% | **0%** |

Five readings, and the first one is the whole point of the change.

1. **The separation is now TOTAL, not graded.** Under the first ladder the
   undisciplined pilot still banked 20-31% timed rows — it caught the top band
   by accident, because "no reversal since the landing" happens to a lot of
   cargo. Under the owner's window plus the participation gate it banks **0%**
   on every row but one. Untimed play earns the base rate and nothing above it,
   which is exactly *"push the players in the right direction"* expressed as a
   ledger rather than as an intention.
2. **And the win rate follows it.** At Tier 10 the timed arm clears 100% / 75%
   where the untimed arm clears 25%. At Tier 4 it is 100% against 50-75%. The
   ladder's middle is still passable without timing; its top is not.
3. **Volume stopped paying.** `burn` — the arm that fires every cooldown — is at
   0-25% win at Tier 10 and 0% timed share everywhere. Manufacturing rows now
   manufactures SWEPT rows against a target 1.8x higher (§3).
4. **EXCELLENT is essentially unreachable for these bots, and that is a
   measurement rather than a failure.** See §2h: the band is 0-3% for every arm,
   and widening the window to 150ms changes the table by nothing at all.
5. **`End/Target` is still the WRONG statistic and is printed only to say so.**
   The bay opens a settle window the moment its target is met, so a pilot
   banking three times the money per shot ends with the same money and unused
   clock. Margin has to be measured by moving the bar — §3.

### 2c. The tick boundaries — one fencepost, found in review

`compactor.update()` advances the grade's counters partway through a step, and
the step read them on BOTH sides of that call: once to stamp landings, once to
grade the clears. Two reads of a moving clock are two clocks, and they disagree
on exactly one tick — the one the press completes. Found by codex on PR #168.

Reproduced deterministically (`sim/_scratch-tickboundary.ts`), replaying the real
step order with the real functions and driving the bar to each boundary rather
than placing it:

| landing, N steps short of full advance | cleared ON the stop tick? | live clock | step clock |
|---:|---|---|---|
| 0 (bar already turned) | no | good | good |
| **1** | **yes** | **swept** | **excellent** |
| 2 | no | excellent | excellent |
| 5 | no | excellent | excellent |

(Measured against the FIRST ladder, where EXCELLENT was the direction rule. The
same walk under the owner's window is §2c-bis below.)

**A row closed on the tick the press completes was charged a sweep it had not
survived** — the top band failing on the tick that earns it most literally.

**The pre-update sample is the right one, and it is not a coin flip.** `pressing`
is captured before the same call for the same reason, and the game already
treats that tick as part of the advancing stroke — it is why the clear runs on it
at all. Sampling post-update fixes the row above and breaks its neighbour: a
landing one step earlier, clearing on the stop tick, would then be charged the
sweep instead.

**The other boundary, audited rather than assumed.** The open stop has no
clear-side exposure at all — no clear is ever evaluated during a retreat — but it
has a stamp-side one, and it decides a band split:

| landed | bar was | grade (first ladder) | grade (owner's ladder) |
|---|---|---|---|
| flip−2, −1, +0 | retreating | good | **swept** |
| flip+1, +2 | advancing | excellent | **good** |

The band changes exactly at the flip with no tick in between, and both stops
obey one rule: **a tick belongs to the direction the bar had at the start of
it.** That is precisely what a single pre-update sample encodes, which is why
the fix is one sampled value rather than a special case at each stop. Under the
owner's ladder this boundary is where the fencepost's remaining bite lives:
stamping from a post-update read would move a landing across the flip and hand a
retreat landing the rightward band.

### 2c-bis. The window neutralised the clear-side fencepost, and the pin says so

Re-running the same walk under the 100ms window turns the headline row of the
table above into a **non-event**, and the reason is structural rather than lucky.
A row that clears ON the stop tick is, in this rig and in the game, about ONE
step from its landing: the row only becomes eligible when the zone narrows to
its width, which is the stop. One step is inside the window, so the band is
EXCELLENT whichever clock the bar was read from.

So the check that used to assert `swept` under the late clock now asserts
`excellent` and pins the ROBUSTNESS instead: **the shortened window makes the
top band immune to the fencepost in either direction.** The fix stays — the
stamp side still needs it (the table above), and `gradeClock`'s own pin in the
real-Game block still catches two of the three original mutants — but the
clear-side mutant is recorded in §7 as inert under the new ladder rather than
kept as a pin that would pass with the bug in place. An inert mutant is not
evidence either way, and this document's rule is to say so rather than to count
it.

`updateLineClear`'s clock is now a REQUIRED argument. It used to default to the
bar's live reading, and that default was the trap: there is no honest value to
default to, because "the bar right now" is the wrong answer inside a step that
has already moved it.

### 2d. Did the fix move the tables? Paired A/B, measured

The only difference between the two runs is which clock the clear is graded
against — same seeds, same bays, same everything:

| row | metric | live clock | step clock |
|---|---|---|---|
| T4 b10 `burn` | Exc / Lucky / End÷Tgt | 10% / 5% / 1.19 | 12% / 2% / 1.21 |
| T10 b1 `burn` | Exc / Swept / Timed% | 22% / 52% / 43% | 24% / 50% / 45% |
| **every other row** | **all columns** | — | **identical** |

**Two rows of twelve move, both `burn`, by at most 2 percentage points.** Win
rate, lines, shots and scrap are unchanged in every row including those two.

Only `burn` moves because it fires every cooldown and therefore has the most
landings, so it gets the most chances at a coincidence that needs a cube's
first-rest tick to fall exactly on the step that completes a stroke — about one
tick in 133 at bay 1's trim, and only for rows that complete right then.

**So the premium's table cannot have moved**, and did not: it is a table of win
rates, and no win rate changes between the two clocks. The choice of rung 8 and
+5% stands on the same measurement it was made on.

---

### 2e. THE CONGESTION GATE — which moment "while in congestion" means

The owner's rule, verbatim: *"no excellent or good should be awarded while in
congestion. we need to punish congestion."*

**What it removes is an inversion the ladder shipped with.** Congestion already
capped the payout multiplier (`PileTier.payMult`, 0.75 over the first knee), but
the GRADE was untouched — so a precision row closed in a congested bay sold at
1.5 x 0.75 = **1.125x base**, i.e. MORE than a clean SWEPT row at 1.0x. The bay
was paying a premium for board control the player had already lost.

**The moment is the CLEAR, read off `Game.stepPileTier`** — the bay as it stood
at the top of the step the row cleared. Three reasons, and the first is the
plainest: the award happens at the clear, so "awarded while in congestion" is a
fact about the clear's own step.

- **One reading, one moment, both of congestion's payout taxes.** `payoutMult`
  is handed the same `stepPileTier` four lines away. A cap sampled anywhere else
  could make a row congested for the multiplier and clean for the grade, and no
  HUD could tell that story.
- **It cannot flicker inside the step that pays.** `lastCongestionIdx` is
  latched once per step, at the top, before anything moves — and deliberately
  BEFORE `updateLineClear` pulls the crushed cubes out, so a four-row collapse
  out of a 60-cube stack is priced as the 60-cube stack it came out of rather
  than as the tidy bay it leaves behind.
- **There is no free way under the knee.** The only things that lower the cube
  count are a line clearing (which is tidying — the behaviour being asked for),
  cargo lost out of the bay (paid for with the spill fine) and the chute (a
  purchased hood). Every one of them is real board control.

**The alternative was to stamp congestion beside the LANDING** and it is the
gameable one. The grade reads only the newest contributing landing, so a player
could park a mess, wait for a collapse to dip the count under the knee for a
single step, drop the closing cube there, and sell a premium out of a bay that
was still full. Reading the state at the award cannot be dodged that way. It
also has the honest direction: a landing-time flag would cap rows placed in a
mess the player has SINCE cleaned up, which punishes the recovery the congestion
rules already refuse to punish elsewhere (the combo break fires on the crossing,
not while congested, for exactly that reason).

**Capped at SWEPT, not at LUCKY.** SWEPT pays exactly 1, so the cap withdraws a
premium rather than inventing a fine — congestion's own four pressures do the
charging on top. Capping at LUCKY would price the mess twice in one number and
would make the gate a **lose button**: a bay that congests at the wrong moment
would stop being able to pay for its own shots (a LUCKY row nets −$17 at Tier
10). The floor rule the ratchet axes obey applies to a payout ceiling for the
same reason. The LUCKY rung stays reachable below the cap, and a LUCKY row in a
congested bay is not reported as "capped" — it was already under the ceiling.

**The skydeck precision premium is not withheld, and the question was mis-framed
in the brief.** `precisionPremium` is a multiplier on a rung's TARGET, not on a
payout: there is nothing about it that could be "paid" on a capped clear. It is
a property of the bay, fixed when the level is built, and conditioning it on the
congestion state of an individual row would make the goalpost move mid-shift.
The decision, stated explicitly so nobody has to re-derive it: **the premium is
untouched; the cap is entirely payout-side.** What DOES stack is the pair the
owner asked for — the grade ceiling and `payMult` — and it stacks on purpose:
the pinned Tier-1 case sells a threaded row at `round(100 x 1.0) x 0.75 = $75`
where the ungated ladder paid `round(100 x 1.5) x 0.75 = $113`.

**THE GATE IS NOT RARE — measured, because "does this ever fire" is the first
question a gate has to answer.** `sim/_scratch-congestion.ts` counts the share
of CLEARED LINES sold out of a bay that was over its first knee, per arm, on the
shipped numbers (4 seeds, full build; the knee is 40 cubes at these bays):

| Mark | Bay | Arm | lines | of them congested | share | max pile |
|---:|---:|---|---:|---:|---:|---:|
| 4 | 1 | sweep | 45 | 27 | **60%** | 73 |
| 4 | 1 | timed | 34 | 6 | 18% | 48 |
| 4 | 1 | excel | 35 | 6 | 17% | 65 |
| 4 | 10 | sweep | 120 | 92 | **77%** | 119 |
| 4 | 10 | timed | 35 | 1 | **3%** | 46 |
| 4 | 10 | excel | 34 | 0 | **0%** | 31 |
| 10 | 1 | sweep | 89 | 63 | **71%** | 92 |
| 10 | 1 | timed | 53 | 14 | 26% | 49 |
| 10 | 10 | sweep | 113 | 78 | **69%** | 82 |
| 10 | 10 | timed | 56 | 16 | 29% | 78 |

**Three quarters of the untimed pilot's rows are sold out of a congested bay,
against 0-29% of the disciplined arms'.** The gate is not a rare event that
occasionally trims a premium; it is a standing condition of the play it targets,
and the pilot who holds fire for the press is also the pilot who does not
congest. That is one lever doing two jobs, which is why the census in §2 shows
the untimed arm at 0% timed share rather than merely a reduced one — its rows
are being refused the premium by BOTH gates at once, most of the time.

It also answers the brief's "measure, don't assume" about the interaction with
the timed pilots: holding fire for the window means fewer shipments in the air,
which means a smaller standing pile. At Tier 4 bay 10 the untimed arm peaks at
119 cubes and the crush-timed arm at 31.

**A caveat these numbers carry, from `sim/pile.ts`'s own header:** the census
bot fires every reload and holds roughly twice the standing pile a human's
slower, aimed cadence does. Read the `sweep` row as an upper bound on how often
a person meets the gate, and the `timed` rows as the shape of what happens when
you stop feeding the bay.

**The UI cannot lie about it.** The cap is applied inside `updateLineClear`, so
`GradedRow.grade` is the awarded band and the money, the tally, the end card and
the toast all read that one field; `raw` is carried beside it and nothing pays
it. A capped clear shows the band it was PAID at plus a `CONGESTED` tag under
the money in the bar's own alarm red. Only a congestion cap is tagged — a row
capped for non-participation is a row the player did not close, and the band
already says so.

### 2f. THE PARTICIPATION GATE — was this row the player's shot?

The owner: *"the piece that has just been launched need to be part of the
line."*

The clock alone cannot tell a threaded shipment from a cube that has been
sliding around the pile for four strokes and happens to settle now: both are
stamped at first rest, and both read as fresh. So a timed band additionally
requires that the **latest launched shipment** took part in the row.

Every cube carries the `shipmentSeq` it was launched under. A row is:

| verdict | when |
|---|---|
| `in-row` | a cube of the latest shipment fills one of the row's slots |
| `impact` | no cube of it is in the row, but one is at rest directly on top of it (§2g) |
| `none` | neither — the press closed a row the player was not working on |

`none` caps at SWEPT, the same ceiling congestion uses and for the same reason.

**Why the LATEST shipment and not "any recent one".** The premium is a reward
for the shot you just took. If you fired again before the previous shipment paid
off, you were not waiting for the press — and the ladder exists to price exactly
that. It also makes the two rules point the same way: hold your fire, watch the
press, close the row you aimed at. The census bears it out — `burn`, which
fires every cooldown, is at 0% timed share on every row in §2.

**A bomb is a shot and is not a shipment.** `shipmentSeq` advances only on a
real launch, so firing a demolition charge does not disown cargo already in the
air.

**A bay that has launched nothing participates in nothing.** `shipmentSeq` is 0
before the first launch and no cube carries 0, so an opening pile cannot sell a
premium.

### 2g. THE IMPACT ASSIST — the owner's slam, and what can honestly be claimed

> *"the only other occurrence in game of good timing is if the piece lands above
> a cube that couldn't form a line unless the weight of the impact actually
> pushed it down at the right time as the compactor triggered the line. i've had
> that a couple of times it was amazing and should be rewarded."*

**Causal detection is not available and would not be honest if it were
attempted.** matter-js has no counterfactual: the only way to ask "would this
row have closed had the shipment not landed on it" is to run the step twice with
different worlds, and a physics step is not reversible. Three proxies were
considered and all three are worse than the one shipped:

| rejected detector | why |
|---|---|
| "a row cube moved down this step" | fires on every ordinary settle, and on the compactor's own grind, which is most of what a pressing bay does |
| "a collision between the shipment and a row cube this step" | fires on any landing anywhere near the row, including one that bounced off it and away |
| "the row was incomplete on the previous step" | true of every row that ever clears — it is the definition of clearing, not of an assist |

**What is shipped is a CONFIGURATION plus the timing**, and it is stated as
exactly that rather than dressed up as causation: a cube of the current
shipment, at rest, resting directly over one of the row's slot cubes — within
`IMPACT_ASSIST_X_TOL` (0.6 cell) horizontally and between 0.5 and 1.5 cells
above. Each of those edges is pinned on both sides.

The residual false positive is a shipment dropped onto a row that was going to
close on that exact tick anyway. That is a coincidence of precisely the
tightness the EXCELLENT band already demands of every row it pays, so admitting
it costs the ladder nothing — and refusing the branch would throw away the play
the owner singled out as the best thing the mechanic does.

**The assist supplies the CLOCK as well as the verdict, and it has to.** The
row's own cubes are stale by construction in this case: they had already
settled, and what arrived is the shipment on top. Measured from them the window
is shut and the band is LUCKY. Measured from the landing that actually closed
the row — the shipment — it is EXCELLENT. `rowClaim` returns both, and
`updateLineClear` takes the newer of the row's own newest landing and the
assist. Pinned: the same stale row with nothing resting on it stays LUCKY and
unpaid.

**Direction matters.** A shipment UNDER the row did not press it down, and the
band check is one-sided.

### 2h. THE WINDOW — 100ms measured against 150, 250 and 400

The owner hedged his own number (*"like 100ms"*), so it is a named tunable and
it was measured before it was believed. Same seeds, same bays, same arms; the
ONLY thing that moves is `EXCELLENT_WINDOW_MS`:

| Mark | Bay | Arm | 100ms | 150ms | 250ms | 400ms |
|---:|---:|---|---:|---:|---:|---:|
| 4 | 1 | timed | 4% | 4% | 4% | 8% |
| 4 | 1 | excel | 0% | 0% | **6%** | **13%** |
| 10 | 1 | timed | 3% | 3% | 3% | 7% |
| 10 | 1 | excel | 0% | 0% | **5%** | **15%** |
| 4 | 10 / 10 | 10 | every arm | 0% | 0% | 0% | 0% |

(EXCELLENT share; the pre-recalibration ladder, so the numbers are comparable
across the four windows and not against §2's table.)

**100ms and 150ms are byte-identical across every column of the arms table**,
not merely close. That is not luck; it is what the mechanic's shape predicts.
The clear check runs on EVERY pressing step, so the elapsed time between a
closing landing and the sale is not a smooth distribution to threshold — it is a
spike at nearly zero (the row was ready; the press takes it on the spot) and a
long tail at whole strokes (the row needed grinding). There is nothing between 6
steps and 9 steps to move. Only at 250ms does the band start catching the tail's
near edge.

**100ms stands, and it is the owner's number.** Widening it to 150 buys nothing;
widening it to 400 starts paying premiums for rows the press ground flat, which
is the exact play the ladder exists to price down.

**What the same table says about the bots, and it is the honest caveat on
everything above.** EXCELLENT is 0-4% for every arm at the shipped window. These
pilots predict their flight with ONE constant (`TIMED_FLIGHT_STEPS` = 75)
against a measured 33-107 step spread, and they never read the pile, so they
cannot deliberately drop cargo into a row that is one cube short at the moment
the press arrives. **The top band is, by this instrument's measure, a human
band.** A device pass is what would price it.

### 2i. THE EXCELLENT PILOT — the ceiling arm, and the negative result

`aim-strategies.ts`'s `excellent` policy is the owner's *"can the aim bot only do
excellent launches?"*, and it is a second strategy rather than a constant on
`timed` because the two rules are in direct opposition:

- `timed` wants the press still COMING — at least 40 steps of advance left, so
  the grind has time to square the pile. That produces GOOD.
- `excellent` wants the press ARRIVING — the landing inside the last stretch of
  the advance, so a completed row sells on the step the cargo settles.

The window it aims at is **derived, not tuned**: a minimum-width row is only
eligible while `zoneGrid`'s `needed` has fallen to that width, i.e. while the
face is within half a cell of full advance — `0.5 * CELL / compactorSpeed`
steps, about 17 at stock Hydraulics and shorter on a refitted press.

**It needed a patience rule to be a pilot at all, and the failure is worth
recording.** Holding for the crush window alone, it took **7 shots in a
180-second bay and lost it with zero lines** (`sim/_scratch-excelprobe.ts`, seed
1000, Mark 1 bay 1, pre-recalibration targets — the control arms took 37 and 15
shots on the same bay and both won). The cause is a beat, not a probability: the
reload is a fixed 1350ms and the bar's round trip is a fixed ~222 steps, so a
pilot that can only fire in one seventeen-step slice of each round trip spends
most of them ready and watching the slice go past. An earlier fix reset its
patience counter whenever the window OPENED, which is most of what a starved
pilot does — same 7 shots. Counting against the last actual LAUNCH
(`shotsFired`) is what works: after one full round trip without firing, the arm
relaxes to `timed`'s rule and takes the grind. Re-run on the shipped
(recalibrated) bay the same probe now reads 19 shots and 3 lines against the
controls' 48 and 45 — still the weakest arm on a stock rig, no longer inert.

**With that, it is a real arm and it is still not a ceiling for EXCELLENT.** It
wins 100% at Tier 4 and 75% at Tier 10 (§2) and reaches GOOD at 20-26% — but 0-3%
EXCELLENT, the same as everything else. **The practical ceiling this instrument
can produce is `timed`, and the target calibration in §3 uses it as such.** The
arm is kept because a measured negative result about the top band is worth more
than an untested assumption that a bot could hit it.

## 3. THE TARGET RAISE

### 3a. THE RECALIBRATION — the base curve, x1.8, measured in SECONDS

The owner, after playing the graded economy: *"given this extra boost of points,
levels are feeling very short, i think we need to raise the base target by like
a lot."*

The ladder had never been calibrated against a DURATION, and "very short" is
one. `sim/_scratch-target.ts` multiplies each bay's own target and nothing else,
on that Mark's full build, and reports win rate **and seconds-to-win** against a
shift that is 180s at Tier 1 and 144s at Tier 10 (4 seeds, `demo` pilot, all
three arms, the shipped gates and window):

| Mark | Bay | Arm | x1.00 | x1.40 | x1.80 | x2.20 |
|---:|---:|---|---:|---:|---:|---:|
| 2 | 1 | sweep | 75%/26s | 75%/30s | 75%/38s | 75%/40s |
| 2 | 1 | timed | 100%/40s | 100%/56s | **100%/61s** | 100%/68s |
| 2 | 1 | excel | 75%/55s | 75%/68s | 50%/87s | 50%/93s |
| 2 | 5 | sweep | 100%/80s | 75%/62s | 75%/90s | 75%/115s |
| 2 | 5 | timed | 75%/58s | 75%/65s | 75%/72s | 50%/90s |
| 5 | 1 | sweep | 50%/14s | 50%/32s | 50%/64s | 50%/92s |
| 5 | 1 | timed | 100%/38s | 100%/45s | **100%/51s** | 100%/62s |
| 5 | 5 | sweep | 100%/39s | 75%/89s | 50%/112s | 50%/125s |
| 5 | 5 | timed | 100%/50s | 100%/56s | **100%/61s** | 100%/79s |
| 10 | 1 | sweep | 50%/56s | 50%/108s | 25%/148s | 0%/— |
| 10 | 1 | timed | 100%/43s | 100%/61s | **100%/71s** | 100%/76s |
| 10 | 5 | sweep | 50%/117s | 25%/85s | 25%/102s | 25%/131s |
| 10 | 5 | timed | 100%/55s | 100%/61s | **75%/68s** | 75%/73s |

**The x1.00 column IS the complaint, stated as a number.** A timed pilot cleared
every bay on the ladder in **38-55 seconds of a 144-180 second shift** — a bay
ended at barely a quarter of its own clock, so the clock was not a pressure at
all and the shift length was decoration.

**x1.80 is what the table chooses**, on two conditions at once rather than one:

- the timed arm still clears comfortably — 100% everywhere but Tier 10 bay 5,
  where it is 75% — at 51-71s, under half the shift. The raise buys pressure
  without turning the bay into a race;
- the untimed arm stops being carried: 75% at Tier 2, 50% at Tier 5, 25-50% at
  Tier 10.

x2.20 was refused: it takes the timed arm off 100% at two rows and the untimed
arm to **0%** at Tier 10 bay 1 — a difficulty tax on the ladder's middle, which
is the one thing the grade brief rules out.

**The four constants move, not a scale factor over them.** A scale factor is a
second curve, and every reader of this ladder — the pins that walk it, the
Skydeck's step off the end of it, the draft projection — would have to know
about two numbers where there is one decision. Each is its old value times 1.8,
rounded to the kind of round number it already was:

| constant | before | after |
|---|---:|---:|
| `TARGET_BASE` | 600 | **1080** |
| `TARGET_PER_TIER` | 20 | **36** |
| `TARGET_PER_BAY` | 100 | **180** |
| `TARGET_PER_BAY_PER_TIER` | 2 | **4** |

| bay | before | after | ratio |
|---|---:|---:|---:|
| Tier 1 bay 1 | $600 | $1080 | 1.80 |
| Tier 1 bay 10 | $1500 | $2700 | 1.80 |
| Tier 10 bay 1 | $858 | $1544 | 1.80 |
| Tier 10 bay 10 | $2026 | $3683 | 1.82 |
| Skydeck bay 1 / bay 10 | $920 / $2162 | $1656 / $3933 | 1.80 / 1.82 |

The precision premium below rides on top unchanged, and every structural pin on
the ladder — the exhaustive "tiers 1-8 are byte-identical to the pre-premium
formula" walk, the per-tier step, the per-bay step — passed without edit. Only
three pins moved, and all three were literal endpoint numbers.

### 3b. THE PREMIUM — measured by moving the bar

`--mode target` multiplies the bay's own target and nothing else, 6 seeds.

| Tier | Bay | Arm | x1.00 | x1.05 | x1.10 | x1.15 | x1.20 | x1.25 |
|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 4 | 5 | sweep | 100% | 100% | 100% | 100% | 83% | 83% |
| 4 | 5 | timed | 100% | 100% | 100% | 100% | 100% | 100% |
| 4 | 10 | sweep | 100% | 100% | 100% | 100% | 100% | 100% |
| 4 | 10 | timed | 100% | 100% | 100% | 100% | 100% | 100% |
| 8 | 5 | sweep | 100% | 100% | 83% | 83% | 67% | 67% |
| 8 | 5 | timed | 100% | 100% | 100% | 100% | 100% | 100% |
| 8 | 10 | sweep | 83% | 83% | 67% | 67% | 67% | 67% |
| 8 | 10 | timed | 100% | 100% | 100% | 100% | 100% | 100% |
| 10 | 5 | sweep | 100% | 83% | 67% | 67% | 67% | 67% |
| 10 | 5 | timed | 100% | 100% | 100% | 100% | 100% | 100% |
| 10 | 10 | sweep | 67% | 67% | 67% | 67% | 67% | 67% |
| 10 | 10 | timed | 83% | 83% | 83% | 83% | 83% | 83% |
| 11 | 5 | sweep (Skydeck) | 83% | 83% | 83% | 83% | 83% | 83% |
| 11 | 5 | timed (Skydeck) | 100% | 100% | 100% | 100% | 100% | 100% |
| 11 | 10 | sweep (Skydeck) | 67% | 67% | 67% | 67% | 67% | 67% |
| 11 | 10 | timed (Skydeck) | 83% | 83% | 83% | 83% | 67% | 67% |

**Read the ×1.00 column as the PRE-premium bay** — this is the table the premium
was chosen from, so its baseline is the ladder as it stood before. Re-run against
the SHIPPED bays (premium already in the ×1.00 column, so every step is a raise
on top of a raise), the same sweep confirms the choice landed where it was aimed:

| Tier | Bay | Arm | shipped (×1.00) |
|---:|---:|---|---:|
| 4 | 5 | sweep / timed | 100% / 100% |
| 8 | 5 | sweep / timed | 100% / 100% |
| 8 | 10 | sweep / timed | 83% / 100% |
| 10 | 5 | sweep / timed | **67% / 100%** |
| 10 | 10 | sweep / timed | 67% / 83% |

Tier 10 bay 5 at the shipped numbers is the design goal met exactly: the
sweep-reliant arm misses a third of its runs where the timed arm clears every
one. The mid ladder is untouched, and bay 10 is still flat — see below.

**What this chose.** Tier 4 does not separate until x1.20, and it separates by
breaking the swept arm rather than by rewarding the timed one — a difficulty tax
on the ladder's middle, which the brief rules out. Tier 8 separates at x1.10 and
Tier 10 at x1.05. So the **precision premium** is zero at and below rung 8 and
+5% a rung above it:

| rung | premium | bay 1 target | bay 10 target |
|---:|---:|---:|---:|
| 8 | x1.00 | $740 | $1766 |
| 9 | x1.05 | $798 | $1894 |
| 10 | x1.10 | $858 | $2026 |
| 11 (roof) | x1.15 | $920 | $2162 |

Tiers 1-8 are **byte-identical** — pinned exhaustively, every tier and every
bay, against the linear curve with no premium term in it, which is exactly the
formula that shipped before this change.

**What does NOT follow, and is the most important line in this section.** Bay 10
at Tier 10 does not move at all across the whole multiplier range (sweep 67%,
timed 83%, flat at every step). **The capstone is not lost on the target** — it
is lost on the pile and the purse — so this is honestly a bay-1-to-9 change, and
deep-bay difficulty still belongs to the ratchet. Any future claim that "the
premium made bay 10 harder" is unsupported by this table.

The roof's own row carries the other caveat: at x1.20 the *timed* arm drops to
67% on Skydeck bay 10. x1.15 is therefore the last step where the roof's hardest
bay is still comfortably timed-clearable, not a step chosen with headroom to
spare.

---

## 4. SCRAP — skill pays funds, volume pays scrap

The grade touches **line payouts only**. Scrap stays exactly what it was: flat
per row, combo-free, ungraded.

**The alternative was modelled and rejected.** Scaling scrap by the grade too
makes the strong run stronger on both axes at once — the timed pilot already
reaches the same target in a third of the shots, and paying it a capital premium
on top compounds one advantage into two. Leaving scrap on VOLUME gives the two
currencies orthogonal earners, which is what makes the conversion loop in §5 a
real decision rather than a tax on the weaker player.

### The roof's first refit stop

Measured before touching anything, and the finding is a bug: the Skydeck's first
stop was a **dead stop**. A roof run arrives with

    3 bays x (12 lines x 1 scrap + 5 scrap) = 51 scrap

against a tier-3 rung priced at 55. The pilot docks at the only yard the mode
has, is shown a shelf where nothing is affordable, and undocks.
`level.ts`'s own note describes that stop as *"reachable only by an opening that
really dismantled its three bays"* — which was the stated intent, and was four
scrap short of being true.

**The precision premium closes it with no second dial.** The roof's targets rise
15%, so a roof bay has to SELL 15% more rows; scrap is paid per row, so income
rises with demand:

| | lines/bay | scrap at stop 1 | rungs |
|---|---:|---:|---:|
| before | 12.0 | 51 | 0 |
| after | 13.8 | **56** | **1** |
| a weaker run, after | 10.0 → 11.5 | 49 | 0 |

Exactly one rung, and both halves are pinned. Every rung the roof's yard can
still sell costs the same `TIER_COSTS[2]` (the Workshop stops at
`UPRATE_MAX_TIER`), so *"how many rungs"* IS *"how many systems get chosen"* —
one is a decision the pilot can get wrong, two is a shopping trip.

The **rate** is untouched, and that is pinned too: "raise the target until the
yard works" and "pay more scrap per row" produce the same stop-1 total and are
completely different designs. One makes the pilot play more bay; the other hands
them the rung.

**The instrument could not confirm this and now does.** The same measurement
before the §3a recalibration, and after it (`--mode scrap --skydeck`, 4 seeds):

| arm | bays 1-3 lines (before → after) | scrap at stop 1 | rungs |
|---|---|---:|---:|
| sweep | 23.3 → **79.8** | 38 → **95** | 0 → **1** |
| timed | 22.7 → **45.0** | 38 → **60** | 0 → **1** |
| excel | — → 43.8 | — → 59 | **1** |
| burn | 32.5 → **86.5** | 48 → **102** | 0 → **1** |

The roof's dead stop is closed for EVERY arm, not just for the modelled human.
The mechanism is the same one the premium used and simply has more of it: a
target 1.8x higher means 1.8x the rows to sell, scrap is paid per row, so income
rises with demand. The RATE is still untouched, which is still pinned — "raise
the target until the yard works" and "pay more scrap per row" produce the same
stop-1 total and are completely different designs.

**And the ladder's own stop got RICHER, which is the thing to watch.** At the
ladder's full rate, stop 1 now banks 104-187 scrap against a tier-3 rung priced
at 55 — one to three rungs where every arm used to afford exactly one:

| arm | bays 1-3 lines | scrap at stop 1 | rungs |
|---|---:|---:|---:|
| sweep | 71.5 | 173 | **3** |
| timed | 43.8 | 118 | **2** |
| excel | 37.0 | 104 | **1** |
| burn | 78.5 | 187 | **3** |

Third-tier refits are therefore not merely still possible, they are easier — and
the arm that reaches the most rungs is the one that clears the fewest bays
(`sweep`, 25% win at Tier 10 in §2). That is the two currencies doing exactly
what `grades.ts` says they should: skill pays funds, volume pays scrap, and a
pilot can convert one into the other at a price it does not choose.

One thing the table does say on its own, and it is the design working: the arm
that gets CLOSEST to the rung is `burn`, the one that manufactures the most rows
and cares least what they are worth. Skill pays funds, volume pays scrap, and
the roof's yard is the place volume cashes in.

For contrast, the ladder's stop 1 was never the problem and still is not: at the
ladder's full rate the same three bays bank 71-92 scrap in this harness — one
rung for every arm, measured rather than modelled.

---

## 5. BURNING MONEY FOR LINES — the ROI curve

The owner asked for this loop to exist as a strategy: *"there could be
strategies where burning money to make more lines gives more scrap."* The `burn`
arm is the aim search's patience rule dropped — every cooldown taken, whatever
the shot.

Deltas are measured against **`timed`**, and the baseline is the argument: the
opportunity cost of spending a bay's bankroll on extra rows is the disciplined
play you gave up, not the undisciplined one you were not making. (`--baseline
sweep` prints the other reading, in which the loop is free almost everywhere —
free relative to a pilot who was wasting the money anyway.)

Re-measured on the shipped numbers (both gates, the 100ms window, the
recalibrated targets; 4 seeds):

| Tier | Bay | Arm | Win | Shots | Lines | Scrap | End$ | Δscrap | Δend$ | **$/scrap** |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 5 | sweep | 50% | 84.8 | 25.0 | 50.0 | 1041 | +28.5 | −1215 | 42.6 |
| 4 | 5 | timed | 100% | 30.3 | 10.8 | 21.5 | 2257 | — | — | — |
| 4 | 5 | excel | 75% | 32.3 | 10.3 | 20.5 | 1564 | −1.0 | −693 | *dominated* |
| 4 | 5 | burn | 75% | 73.5 | 26.8 | 53.5 | 1999 | +32.0 | −258 | **8.1** |
| 4 | 10 | sweep | 75% | 81.8 | 30.0 | 60.0 | 2966 | +42.5 | −303 | 7.1 |
| 4 | 10 | timed | 100% | 23.3 | 8.8 | 17.5 | 3269 | — | — | — |
| 4 | 10 | burn | 75% | 73.8 | 25.8 | 51.5 | 2785 | +34.0 | −484 | **14.2** |
| 10 | 5 | sweep | 25% | 81.5 | 26.3 | 52.5 | 1034 | +23.5 | −1511 | 64.3 |
| 10 | 5 | timed | 75% | 43.3 | 14.5 | 29.0 | 2545 | — | — | — |
| 10 | 5 | burn | 25% | 72.8 | 23.5 | 47.0 | 943 | +18.0 | −1602 | **89.0** |
| 10 | 10 | sweep | 25% | 80.0 | 28.3 | 56.5 | 2502 | +28.5 | −901 | 31.6 |
| 10 | 10 | timed | 75% | 35.8 | 14.0 | 28.0 | 3403 | — | — | — |
| 10 | 10 | burn | 25% | 90.3 | 34.3 | 68.5 | 3060 | +40.5 | −343 | **8.5** |

**The loop survived both gates and the raise, and it got more expensive where it
should.** At Tier 4 a scrap costs $8-14 of forgone funds and the burn arm still
clears three bays in four. At Tier 10 bay 5 it costs **$89** and takes the win
rate from 75% to 25% — the conversion is available where the player can afford
it and priced out of the exam, which is the same shape the first measurement
found at a third of the price.

**What the gates did to it is visible in §2's census rather than here:** `burn`
banks **0% timed rows on every row of the table**. It is not merely paying more
per scrap, it is buying its scrap entirely at the base rate, which is what
"volume pays scrap, skill pays funds" is supposed to mean and what the first
ladder only half enforced.

The earlier measurement, for comparison (pre-gates, pre-raise): $6.60 a scrap in
the mid ladder and $12.50-$28.60 at Tier 10, with `burn` at Tier 4 bay 5
*dominated on both axes*.

**The loop exists, it costs, and its price climbs with the ladder.** Priced
against the tier-3 rung it is buying (55 scrap):

| Tier | Bay | $/scrap | a rung costs | that bay's target | rung as a share of the bay |
|---:|---:|---:|---:|---:|---:|
| 4 | 10 | 6.6 | $363 | $1614 | 22% |
| 10 | 10 | 12.5 | $688 | $2026 | 34% |
| 10 | 5 | 28.6 | $1573 | $1377 | **114%** |

At Tier 10 bay 5 a rung bought by burning costs **more than the whole bay's
target**, and the arm's win rate falls from 100% to 67% doing it. That is the
shape the design wants without anyone having tuned for it: the conversion is
available where the player can afford it and priced out of the exam.

At Tier 4 bay 5 the burn arm is **dominated on both axes** (−5.3 scrap AND
−$99). That is not the loop failing; it is the arm's aim cost showing through at
a bay where the pile is small and a wasted shot is pure spill fine. The loop
needs a bay deep enough that extra rows are actually available.

---

## 6. DEGENERATE PLAY — seven holes, checked

**"The sweep clock is gameable by withholding fire."** It is, and that is the
mechanic rather than a hole: withholding fire until the press is coming IS the
skilled play the brief asked to reward. What matters is whether it is *free*. It
is not — the timed arm holds shots and pays for them in clock — but the measured
result is that it is nonetheless **strictly better on win rate at every row in
§2 and §3**. That is a tuning question this instrument cannot settle: see §7.

**"Excellent-only play is degenerate."** Not reachable. The pilot built to hunt
the band lands 18-32% of its rows in it (§2). The bar's phase, the flight spread
(33-107 steps) and the fact that rows are closed by whichever shipment happens to
complete them keep the top band scarce.

**"Spam cheap ungraded lines for scrap while ignoring timing."** Priced in §5 at
$6.60 a scrap in the mid ladder and $12.50-$28.60 at Tier 10, and it costs win
rate at the top. It is a strategy, not an exploit.

**"Disturb a stale pile to refresh its clock."** Closed by construction: a cube
is stamped on FIRST rest and never re-stamped, so knocking cargo loose can only
grade a row down. Pinned.

**"Duck under the congestion knee for one step and sell the premium."** Closed
by the sampling moment — §2e. The gate reads the bay at the top of the step the
row CLEARS, and the only things that lower the cube count are a clear (tidying),
a spill (fined) or the chute (purchased). The landing-time alternative would
have been open to exactly this and is why it was refused.

**"Let the press build the row, then fire one shot at it to claim the
premium."** Closed by the participation rule caring WHERE the shipment is, not
merely that one exists. A shot that lands somewhere else entirely leaves the row
at `none`; a shot that lands IN the row is the shot that closed it; a shot that
lands ON the row is the impact assist, and it still has to satisfy the clock.

**"Fire constantly so that some shipment is always 'the latest'."** Backwards:
firing again REPLACES the latest shipment, so cargo still settling from the
previous shot is disowned the moment the next one leaves the muzzle. Measured —
`burn` fires every cooldown and banks 0% timed rows on every row of §2.

---

## 7. THE MUTATION LEDGER — what the pins actually catch

`sim/systems.ts` has a long history of vacuous pins, so every claim in this
document was checked by **breaking the game and watching the pin fail**. Each
row is one mutation applied to shipped source, the two grade sections re-run,
and the source restored. A row that reports **0** is a pin that proves nothing —
recorded here rather than quietly fixed, because two of the three turned out to
be findings.

| mutation | fails |
|---|---:|
| `gradeForRow`: EXCELLENT/GOOD swapped | 9 |
| `gradeForRow`: LUCKY_SWEEPS boundary off by one | 3 |
| `gradeForRow`: an unknown landing graded generously | 1 |
| `GRADE_PAY`: SWEPT is no longer the anchor | 2 |
| `GRADE_PAY`: LUCKY no longer costs anything | 3 |
| `Compactor`: the open stop also counts a stroke | 2 |
| `Compactor`: the open stop's tick unguarded | **0** |
| `stampLandings`: re-stamps a disturbed cube | 1 |
| `stampLandings`: stamps cargo still in flight | 1 |
| `newestLanding`: takes the OLDEST cargo in the row | 1 |
| `headlineGrade`: announces the best grade present | **0** |
| `updateLineClear`: grades the crush off the removal set | **0** |
| `newGradeTally`: hands back one shared object | 2 |
| `addGradeTally`: mutates its left argument | 1 |

### Pass 2 — the two gaps closed, and the economy claims added

| mutation | fails |
|---|---:|
| `headlineGrade`: announces the OLDEST row's grade | 2 |
| `updateLineClear`: grades the crush off the removal set | 2 |
| `updateLineClear`: the graded list drifts out of step with `rows` | 2 |
| `gradedLinePay`: the ladder applied to the wrong band | 4 |
| `GRADE_CALLOUT`: LUCKY celebrates too | 1 |
| `GRADE_COLOR`: the losing band wears the payout green | 1 |
| `gradeBreakdownClause`: prints a band nobody earned | 2 |
| `precisionPremium`: the quiet band is not quiet | **0*** |
| `precisionPremium`: dead constant, nothing above the band moves | **0*** |
| `skydeckScrapAtFirstStop`: the premium left out of the yard arithmetic | **0*** |
| `advanceRun`: the grade tally lands on the wrong field | **0*** |

`*` **the harness, not the pins.** Passes 1 and 2 counted FAIL lines only
between the two "The timing grade" sections. The economy pins are not there —
the premium is checked in the tier-ladder section, the yard arithmetic in the
Skydeck section, `advanceRun`'s tail in the Incinerator section — so those four
rows report zero for a reason that has nothing to do with what is pinned.

### Pass 3 — the same four, counting the WHOLE run, plus three new mutants

| mutation | fails |
|---|---:|
| `precisionPremium`: the quiet band is not quiet | 10 |
| `precisionPremium`: dead constant, nothing above the band moves | 8 |
| `precisionPremium`: the premium is a flat sum, not a share | 5 |
| `skydeckScrapAtFirstStop`: the premium left out of the yard arithmetic | 2 |
| `SKYDECK_ENDGAME_LINES_PER_BAY`: the roof's stop sized off a weaker run | 2 |
| `advanceRun`: the grade tally lands on the wrong field | 4 |
| `advanceRun`: the tail's last two arguments transposed | 7 |

The first row is the one worth reading twice: widening the premium by seven
rungs — the accident a future retune is most likely to have — fails ten checks,
because the "every tier up to 8 is byte-identical" pin walks every tier and
every bay against the ladder's own pre-premium formula. The last is the
positional-tail hazard `run.ts` warns about in prose, made a failing test.

### Pass 4 — the tick-boundary fix, and the lesson that cost the most

The pins written for §2c's fencepost all passed. Then the mutants ran, and **all
three game.ts mutants came back 0** — putting the bug back changed nothing any of
them could see.

**A pin that replays the step order is a pin on the RULE, not on the WIRING.**
Those checks built their own sample/stamp/update/clear helper out of the real
functions, which is a faithful model of game.ts's sequence and therefore
completely blind to whether game.ts still follows it. The bug did not live in
`gradeForRow`, `stampLandings` or `updateLineClear` — every one of them was
correct throughout. It lived in the ORDER two of them were called in, and the
order is the one thing a replay cannot test.

So there is now a check that drives the **real `Game.update`** through the exact
tick: the bar walked to one step short of full advance, a complete unstamped row
injected, one `update()` call, and assertions on the payout FX's grade and on the
money that actually moved. With the fencepost restored:

| mutation | fails (replay pins only) | fails (with the live-Game pin) |
|---|---:|---:|
| the clear reads the clock AFTER the bar moved | 0 | 2 |
| the step clock is sampled after the bar moved | 0 | 3 |
| `gradeClock` is a live read, not the step's sample | 0 | 1 |

One further mutant from that pass is recorded as **inert rather than caught**:
moving the open stop's half-cycle tick across the `dir` flip. That branch is only
reachable with `dir === -1` (pass 1 established the guard is unreachable), so the
two orderings are the same program. An inert mutant is not evidence either way,
and it is dropped rather than counted.

**37 mutants across the four passes, every one of them accounted for.**

### Pass 5 — the second brief: two gates, a 100ms window and a raised bar

Twenty-seven mutations against the new surface, each applied to shipped source
with the whole `systems.ts` suite re-run and the source restored. Run four at a
time in throwaway copies of `app/` because the suite now takes 3m20 a pass (the
raised targets make the bays that pins actually PLAY run longer), which is
itself worth writing down.

**The congestion gate**

| mutation | fails |
|---|---:|
| the gate is deleted — congestion never caps | 13 |
| the gate is inverted — it caps only when NOT congested | **24** |
| the cap is LUCKY instead of the anchor | 9 |
| the cap CLAMPS instead of ceiling, so a late row is promoted | 4 |
| congestion is sampled LIVE instead of at the top of the step | **0** |

**The participation gate and the impact assist**

| mutation | fails |
|---|---:|
| the participation check is deleted — every row participates | 19 |
| participation reads ANY shipment, not the latest | 15 |
| the shipment counter never advances | 3 |
| a demolition charge advances the shipment counter too | 3 |
| the launcher forgets to stamp the shipment onto its cubes | 2 |
| the impact assist accepts cargo still in flight | 1 |
| the impact assist ignores the column — any cube above will do | 2 |
| the impact assist reaches any height | 3 |
| the assist's LANDING is dropped and only its verdict kept | 2 |

**The window and the ladder**

| mutation | fails |
|---|---:|
| the window is measured from the clear back to the landing (sign flipped) | 19 |
| the window is checked AFTER the phase rule | 16 |
| the window is off by one tick (exclusive instead of inclusive) | 1 |
| GOOD reads the stroke, not the half-cycle (the direction is dropped) | 4 |
| the landing stamp is one step stale | 2 |
| the landing stamp forgets the step entirely | 2 |
| the step is stamped from a post-update read | **0** |

**The money, the toast and the curve**

| mutation | fails |
|---|---:|
| the money reads the RAW band | 2 |
| the toast shows the RAW band, not the one paid | 1 |
| the toast never reports congestion | 1 |
| two bands share a colour again | 3 |
| the congestion tag wears a grade colour | 1 |
| the target curve loses its recalibration | 3 |

**The two zeros, and what each of them is.**

**`the shipment counter never advances` was a REAL GAP and is closed.** It
scored 0 on the first run, and the reason is the one Pass 4 already learned the
hard way: every check either set `shipmentSeq` by hand or passed a shipment id
straight into `updateLineClear`, so nothing exercised the LAUNCHER. A rule the
launcher does not implement is a rule the game does not have. There is now a
pin that fires the real cannon and asserts the counter advances, that every cube
of the shipment carries it, that a second launch takes the id, and that a
demolition charge advances the SHOT count and not the shipment. Three mutants
against that path now fail 3 / 3 / 2 where the first scored 0.

**`congestion is sampled LIVE` is INERT rather than uncaught, and the analysis
matters more than the number.** The mutant swaps `stepPileTier` for `pileTier`
at the call site — but the context object is built BEFORE `updateLineClear`
runs, so at that instant the live count has not yet lost the crushed cubes and
the two readings agree. They separate only when something else removed cargo
earlier in the same step, which in practice means a demolition charge detonating
on the tick a row closes; no pin constructs that, and building one through the
bomb's fuse would be a test of the fuse. `stepPileTier` is used anyway, and the
reason is four lines further down: `payoutMult` is handed the same reading at a
point where the crushed cubes ARE gone, so a call site that read the live tier
would make the two halves of congestion's payout tax disagree about the same
row. An inert mutant is not evidence either way; it is recorded rather than
counted, and the construction that would give it bite is named here for whoever
needs it.

**`the step is stamped from a post-update read` is inert BY CONSTRUCTION, and
that is the design working.** The mutant shifts `stepClock.step`, which shifts
the landing stamp and the clear's clock by the same amount — the difference the
grade takes is unchanged. That is not a weak pin; it is the property the whole
§2c fix bought: there is exactly ONE sample per step and nothing between the
stamp and the clear advances the step counter, so the step has no fencepost to
have. The mutants that DO bite are the ones that break the pairing —
`the landing stamp is one step stale` (2) and `forgets the step entirely` (2).

**One mutant from Pass 4 is now inert and is retired rather than kept.** `the
clear reads the clock AFTER the bar moved` used to fail 2 checks; under the
100ms window it fails none, because a clear on the stop tick is by construction
about one step from its landing and therefore inside the window whichever clock
the bar was read from. §2c-bis carries the reasoning, and the check that used to
assert the bug now asserts the robustness.

**64 mutants across the five passes.**

### The three genuine findings

**The open stop's guard is unreachable, and that is a fact about the code.**
Nothing in the bar's own travel can re-enter a stop branch it has just left —
one step after the clamp, `x` has moved off the stop by `pace` in the new
direction — so deleting either stop's guard changes no behaviour any bay can
produce. No pin can catch it because there is nothing to catch. The guard stays
(the two stops are one rule, and `dir` is writable from outside — the row
builder in `systems.ts` parks the bar and sets it by hand), and `compactor.ts`
now says all of that instead of claiming a double-tick it prevents.

**The `headlineGrade` mutant did not compile.** It referenced `GRADES`, which
`lineClear.ts` does not import, so `tsx` crashed and the harness counted zero
FAIL lines — a broken *mutant*, not a vacuous pin. Pass 2 re-ran it by inverting
the comparison instead, so the callout announces the oldest row: 2 failures.

**The crush mutant was valid and the pins were thin.** Every check at the time
built ONE row, so a grade computed across the whole crush's removal set had
nothing to corrupt. A two-row pin now clears both rows in a single call with
landings a run apart, and asserts the stale row above keeps its own LUCKY while
the fresh floor row sells EXCELLENT — 2 failures under the same mutant that
scored 0 before it existed.

---

## 8. WHAT THIS DOCUMENT CANNOT SAY

- **Whether holding fire is fun.** The `timed` arm proves the timing is
  reachable and prices it in shots. Only a device pass can say whether waiting
  for the press reads as skill or as dead air — and if it reads as dead air, the
  lever is the reload cooldown (`cooldownMs`, currently 1350) rather than the
  grade.
- **Whether EXCELLENT is reachable AT ALL by a person.** This is now the single
  biggest hole. Every arm banks 0-4% of its rows in the top band at the owner's
  100ms window (§2h), and the reason is the instrument rather than the design:
  these pilots predict flight with one constant against a 33-107 step spread and
  never read the pile, so they cannot deliberately drop cargo into a row that is
  one cube short at the moment the press arrives — which is the ONLY way into
  the band. A human watching the arc and the bar is doing exactly that. If a
  device pass finds the band is unreachable for people too, the lever is
  `EXCELLENT_WINDOW_MS`, and §2h says what each step of it buys.
- **Whether the untimed arm's collapse is fair or merely fatal.** §2 shows the
  untimed pilot at 25% at Tier 10 against the timed pilot's 75-100%. That is the
  separation the brief asked for; whether a person who has not yet LEARNED the
  timing experiences it as a lesson or as a wall is a playtest question.
- **Anything about the refit ladder's other early power spikes.** §9 establishes
  that the Reactor is not the cause of the short bays and flags the general
  pattern. Nothing here measures the other tracks.
- **Whether the reward is legible.** Because a bay ends the moment its target is
  met, the premium converts mostly into FEWER SHOTS rather than more money. A
  player may bank the benefit without ever noticing the payout. That is the
  whole argument for the callout being loud, and it is the thing to watch first
  on device. `sim/playtest.ts` §7 reports the band mix from a real session for
  exactly this, against the bots' 17-32% as a floor.
- **Whether the roof's stop-1 rung actually lands**, per §4: the claim is a
  derivation against a modelled human line rate, and these bots clear half of it.
- **Anything about bay 10 at Tier 10 under the PREMIUM.** §3b's table is flat
  there. The premium does not touch that bay's difficulty in either direction —
  the recalibration in §3a does, but it does so to every bay equally.

---

## 9. THE PACING DECOMPOSITION — the target, or the Reactor?

The owner's own second thought about the short bays: *"it also may be because my
reactor is upgraded to tier 2 at tier 2 so levels feel very short. maybe we need
to gate the upgrade until a later tier."*

Measured apart. `sim/_scratch-pacing.ts` runs one track at three tiers with
everything else stock — a controlled isolation, so the numbers are the
Reactor's contribution and nothing else's (4 seeds, pre-recalibration ladder so
the comparison is against the bay the owner was actually playing):

| Mark | Bay | Reactor | sweep: win / secs / End÷Tgt |
|---:|---:|---|---|
| 2 | 1 | T0 | 100% / 61s / 1.09 |
| 2 | 1 | T1 | 75% / 39s / 0.93 |
| 2 | 1 | T2 | 100% / **57s** / **1.28** |
| 5 | 1 | T0 | 75% / 59s / 0.84 |
| 5 | 1 | T1 | 75% / 42s / 0.91 |
| 5 | 1 | T2 | 100% / **42s** / **1.26** |

**The Reactor's second tier is real and it is not the cause.** It is worth
roughly +20-50% of a bay's end money and takes about a quarter off the time to
clear — but **the bay already ended at 59-61 seconds with the Reactor at
STOCK**, against a 176-second shift. Gating the refit would take back a quarter
of one track's contribution while leaving the bay ending in a third of its
clock. It cannot restore the pacing on its own.

**So the target raise carries the load and nothing is gated in this pass.** The
brief's own instruction was not to stack two punishments for one problem, and
§3a's table says the raise alone lands the pacing where it should be. A gate on
top of x1.80 would be a second tax on a bay the first one has already fixed.

**The general shape is real and is flagged rather than fixed.** The Reactor is
not unique: `refitTracks` offers ONLY the Reactor at Mark 1, which is precisely
what funnels a first run's scrap into one track and gets it to tier 2 early, and
nothing in `upgrades.ts` caps how high any track may be raised at any Mark. A
tier-2 refit reachable at the Mark where it trivialises pacing is a property of
the refit ladder, not of one system. Fixing it properly means measuring the
whole ladder — every track, every Mark, against the recalibrated targets — and
that is a pass of its own with its own instrument. What this pass establishes is
that it is not needed to solve the problem in front of it.

**And the recalibration moved the refit economy in the SAFE direction**, which
is the interaction the brief asked to watch: a target 1.8x higher means 1.8x the
rows, scrap is paid per row, so stop 1 now banks 104-187 scrap on the ladder
(one to three tier-3 rungs, where every arm used to afford exactly one) and 59-102
on the roof (one rung, where every arm used to afford none). See §4.
