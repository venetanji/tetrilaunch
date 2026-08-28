# TIMED CLEARS — grading a row by when it closed, and paying it accordingly

> Companion to `winnability-sweep-findings.md` and `aim-strategy-findings.md`.
> Those price notch combos and ship systems; this one prices the ACT — what a
> row was worth as a piece of play rather than as cargo.
>
> Instruments: `app/src/game/grades.ts` (the clock and the ladder),
> `app/sim/timing.ts` (four modes: `arms`, `target`, `burn`, `scrap`),
> `app/sim/aim-strategies.ts`'s `timed` policy, `app/sim/_scratch-flight.ts`
> (the flight probe). Pins in `app/sim/systems.ts`.
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

---

## 1. THE CLOCK — and the constant it did not need

A row's grade is a pure function of two integers the compactor already keeps:
`strokes` (completed advances, the "sweep" the player watches) and a new
`halfCycles` (every stop flip, both ends). Every cube is stamped with the pair
it was **first** seen at rest at; a row is graded on the newest stamp among the
cubes that filled its slots.

The brief asked for a band called "shortly after", which reads like a tunable
step window sitting in the middle of the money. It is not needed. A line can
only clear while the bar is advancing, so the direction of the bar splits the
top two bands for free:

| band | rule | reads as |
|---|---|---|
| **EXCELLENT** | the bar has not reversed since the landing | the row closed inside the stroke that was already running |
| **GOOD** | no sweep completed, but the bar did reverse | landed on the retreat, sold by the very next press |
| **SWEPT** | 1-2 sweeps since | the press had to grind it flat — *"lucky or planned?"* |
| **LUCKY** | 3+ sweeps since | *"definitely lucky"* |

Two consequences worth stating:

- The EXCELLENT/GOOD boundary survives every Hydraulics tier and every Bay
  Extension width. Both change how **long** a stroke takes; neither changes what
  one **is**.
- Nothing in the money reads `now` or `stepCount`. `sim/` reproduces a bay's
  payouts bit-for-bit at any frame rate, which the pins check by clearing
  identical sim state twice.

**First rest and never again.** Cargo a blast or a shatter kick throws back into
the air re-settles carrying its original landing. The alternative would let a
player refresh a stale pile's clock by disturbing it. The bias runs one way:
disturbed cargo can only grade a row **down**.

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

Three arms, one bot, one aim search; the only difference between rows is the
policy (`sim/timing.ts --mode arms`, full build, 4 seeds).

| Mark | Bay | Arm | Win | Lines | Shots | End/Tgt | Exc | Good | Swept | Lucky |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 1 | sweep | 50% | 4.3 | 20.3 | 0.66 | 24% | 29% | 47% | 0% |
| 4 | 1 | timed | 100% | 5.0 | 17.0 | 1.23 | 25% | 10% | 55% | 10% |
| 4 | 10 | sweep | 100% | 13.0 | 39.0 | 1.12 | 12% | 19% | 46% | 23% |
| 4 | 10 | timed | 100% | 5.5 | 13.5 | 1.26 | 32% | 5% | 50% | 14% |
| 10 | 1 | sweep | 50% | 4.0 | 18.5 | 0.54 | 25% | 38% | 38% | 0% |
| 10 | 1 | timed | 100% | 7.0 | 19.8 | 1.27 | 18% | 7% | 68% | 7% |
| 10 | 10 | sweep | 75% | 24.8 | 69.0 | 1.05 | 9% | 11% | 51% | 29% |
| 10 | 10 | timed | 100% | 10.3 | 28.8 | 1.06 | 17% | 10% | 49% | 24% |

Re-measured on the SHIPPED numbers after the premium and the clock fix landed.
The Tier 4 rows are byte-identical to the first run — that tier carries no
premium and the clock fix does not touch these two arms — and the Tier 10 rows
moved exactly the way a raised target predicts and nothing else does: more lines
and more shots to reach a bar that is 10% higher (sweep 23.5 → 24.8 lines, timed
7.0 → 10.3), with `End/Target` compressed toward 1. That is the premium showing
up in the census as arithmetic rather than as a surprise.

Four readings.

1. **The grade separates the arms, and separates them hardest where the
   complaint is.** At Tier 10 bay 10 the undisciplined pilot's rows are 30%
   LUCKY and it needs 66 shots; the timed pilot needs 21.
2. **The swept player's grades decay along the run.** LUCKY goes 0% at bay 1 to
   30% at bay 10 for the same pilot. Late bays are where the press finds rows
   for you, which is why the target premium is a share (it grows with the bay's
   own ramp) rather than a flat sum.
3. **`End/Target` is the WRONG statistic and is printed only to say so.** The
   bay opens a settle window the moment its target is met, so a pilot banking
   three times the money per shot ends with the same money and unused clock, not
   with three times the money. Margin has to be measured by moving the bar —
   which is §3.
4. **EXCELLENT does not dominate even for the pilot aiming at it.** The timed
   arm lands 18-32% of its rows in the top band. The mechanic does not collapse
   into one line of play.

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
has a stamp-side one, and it is the EXCELLENT/GOOD split:

| landed | bar was | grade |
|---|---|---|
| flip−2, −1, +0 | retreating | good |
| flip+1, +2 | advancing | excellent |

The band changes exactly at the flip with no tick in between, and both stops now
obey one rule: **a tick belongs to the direction the bar had at the start of it.**
That is precisely what a single pre-update sample encodes, which is why the fix
is one sampled value rather than a special case at each stop.

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

## 3. THE TARGET RAISE — measured by moving the bar

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

**The instrument cannot confirm this and says so.** Measured on the shipped
numbers (`--mode scrap --skydeck`, 6 seeds):

| arm | bays 1-3 lines | scrap at stop 1 | rungs |
|---|---:|---:|---:|
| sweep | 23.3 | 38 | 0 |
| timed | 22.7 | 38 | 0 |
| burn | 32.5 | **48** | 0 |

These bots clear 7.6-10.8 rows a bay on the roof, not 12, so none of them
reaches the rung. Twelve lines a bay is a model of a HUMAN — the figure
`level.ts`'s own SKYDECK_SCRAP_SHARE table is built on, now named as
`SKYDECK_ENDGAME_LINES_PER_BAY` so a check can reach it. The bots put a floor
under the claim; they do not verify it. **A device pass is what would.**

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

| Tier | Bay | Arm | Win | Shots | Lines | Scrap | End$ | Δscrap | Δend$ | **$/scrap** |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 5 | sweep | 100% | 24.3 | 7.7 | 15.3 | 1279 | +1.0 | −11 | 11.2 |
| 4 | 5 | timed | 100% | 22.2 | 7.2 | 14.3 | 1290 | — | — | — |
| 4 | 5 | burn | 100% | 16.2 | 4.5 | 9.0 | 1192 | −5.3 | −99 | *dominated* |
| 4 | 10 | sweep | 100% | 36.3 | 11.8 | 23.7 | 1884 | +10.0 | −68 | 6.8 |
| 4 | 10 | timed | 100% | 17.7 | 6.8 | 13.7 | 1952 | — | — | — |
| 4 | 10 | burn | 100% | 27.8 | 9.2 | 18.3 | 1921 | +4.7 | −31 | **6.6** |
| 10 | 5 | sweep | 67% | 43.7 | 12.3 | 24.7 | 1002 | +7.3 | −609 | 83.0 |
| 10 | 5 | timed | 100% | 25.2 | 8.7 | 17.3 | 1611 | — | — | — |
| 10 | 5 | burn | 67% | 54.0 | 17.2 | 34.3 | 1124 | +17.0 | −487 | **28.6** |
| 10 | 10 | sweep | 67% | 67.8 | 23.5 | 47.0 | 1789 | +24.7 | −175 | 7.1 |
| 10 | 10 | timed | 83% | 31.0 | 11.2 | 22.3 | 1964 | — | — | — |
| 10 | 10 | burn | 67% | 64.3 | 21.8 | 43.7 | 1697 | +21.3 | −267 | **12.5** |

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

## 6. DEGENERATE PLAY — four holes, checked

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
- **Whether the reward is legible.** Because a bay ends the moment its target is
  met, the premium converts mostly into FEWER SHOTS rather than more money. A
  player may bank the benefit without ever noticing the payout. That is the
  whole argument for the callout being loud, and it is the thing to watch first
  on device. `sim/playtest.ts` §7 reports the band mix from a real session for
  exactly this, against the bots' 17-32% as a floor.
- **Whether the roof's stop-1 rung actually lands**, per §4: the claim is a
  derivation against a modelled human line rate, and these bots clear half of it.
- **Anything about bay 10 at Tier 10.** §3's table is flat there. The premium
  does not touch that bay's difficulty in either direction.
