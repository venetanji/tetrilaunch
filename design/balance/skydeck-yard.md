# THE ROOF'S YARD — what a refit stop is worth on the Skydeck

What `app/sim/skyyard.ts` measured, and why the Skydeck's stops pay **half the
ladder's scrap** rather than being priced up or left shut.

Reproduce with:

```
cd app
npx tsx sim/skyyard.ts --mark 3 --seeds 20 --days 2 --pays 2/10,1/5,2/0,1/0
```

---

## 1. The brief, and the reversal behind it

The Skydeck shipped with **no yard at all**. The argument was the mode's
identity — "the rig that undocks is the rig that lands" — and the owner ruled it
in. Playtesting ruled it back out:

> "also I think we need the refit stops but either more expensive or less scrap
> given, we expect the maxed out in the workshop rig"

Two facts in one sentence, and the second is the whole problem. The roof opens
only to a player holding **every Mark's seal** (`meta.ts`'s `skydeckOpen`), and
that player's Workshop is *finished*: the shop sells to `UPRATE_MAX_TIER` and
stops, and Mark 10's build budget covers every track at that ceiling with room
to spare. So a Skydeck pilot walks into the yard owning everything the Workshop
has, and the only thing the stop can sell them is **tier 3** — the tier that
exists nowhere else.

## 2. Why "more expensive" and "less scrap given" are the same lever

Every tier-3 rung costs the same `TIER_COSTS[2]` = **55 scrap**. On the ladder
the yard sells a mix of 20s, 35s and 55s to a rig with gaps in it; on the roof it
sells eight identical 55s. With one flat price, *rungs bought* is
`floor(income / 55)` — so scaling the price and scaling the income are the same
arithmetic, and the choice between the owner's two levers is a choice about
**where the number lives**, not about what it does.

It lives on the payout, for three reasons:

1. **One price table.** `TIER_COSTS` is quoted by the Workshop, the refit card
   and the projection. A roof surcharge would give one rung two prices and make
   every screen that quotes one ask which mode is buying.
2. **The mode already owns its payout.** The Skydeck was already declining the
   bay's scrap at one seam (`main.ts`'s bay-clear banking). Halving it is a
   change to a number this mode already decides.
3. **It stays derived.** `SKYDECK_SCRAP_SHARE` is applied to the ladder's own
   `SCRAP_PER_LINE` / `SCRAP_PER_BAY`, so a play pass that re-prices a line moves
   the roof with the ladder — the same discipline the target/launch step keeps
   (`level.ts`'s `skydeckRungFor`).

## 3. The decisive table: purchasing power

Income is a function of exactly one thing the pilot controls — **lines cleared**
— and the price is flat, so what a run can buy is arithmetic. This table is not
bot-dependent, which matters: the bots' *weakest* statistic is lines, so a
number that only existed inside the flights would be reporting the pilot rather
than the economy.

Rungs bought at stops 1 / 2 / 3, and the run's total, at the shipped
55-scrap rung:

| payout | 6 lines/bay | 8 | 10 | 12 | 14 |
|---|---|---|---|---|---|
| **2/line + 10/bay** (the ladder's) | 1/1/1 = **3** | 1/1/2 = **4** | 1/2/1 = **4** | 1/2/2 = **5** | 2/2/2 = **6** |
| **1/line + 5/bay** (SHIPPED) | 0/1/0 = **1** | 0/1/1 = **2** | 0/1/1 = **2** | 0/1/1 = **2** | 1/1/1 = **3** |
| 2/line + 0/bay (lines only) | 0/1/0 = **1** | 0/1/1 = **2** | 1/1/1 = **3** | 1/1/1 = **3** | 1/2/1 = **4** |
| 1/line + 0/bay | 0/0/0 = **0** | 0/0/1 = **1** | 0/1/0 = **1** | 0/1/0 = **1** | 0/1/1 = **2** |

Three readings, in the order they decided things:

- **The ladder's payout is the gift the owner flagged.** At 10–12 lines a bay it
  hands over **four to five of the eight rungs a finished rig still wants** — half
  a ship, for free, on a floor whose whole pitch is that you fly what you
  brought. It also buys a rung at the **first** stop for every pilot down to six
  lines a bay, so the stop is something you arrive at rather than earn.
- **Half cuts the strong run and the weak one by the same fraction.** 3→1 at six
  lines, 5→2 at twelve: about 60% either way.
- **"Lines only" was the rejected idea, and the table is why.** Withholding the
  clear bonus reads beautifully — *the roof pays for dismantling bays, not for
  arriving* — and it taxes the wrong pilot: 3→1 at six lines a bay (−67%) but
  only 5→3 at twelve (−40%). The brief is explicitly about the player arriving
  with too much, and this is the one option that tightens them least.

The shipped share also puts the first stop where a stop at the top of the game
should be: **out of reach of an ordinary opening, and reachable by a great one.**
Three bays at 10 lines banks 45 against a 55 rung; at 14 lines it banks 57 and
buys one. Most runs make their first purchase at stop 2.

## 4. The flights: does the tightened yard still leave a run?

The table above says what an economy *buys*; it cannot say whether the run
survives to spend it. `sim/skyyard.ts` flies the real ten bays through
`run.ts`'s own `levelForRun` / `advanceRun` / `buyUpgrades` — no model of the
carry, the scrap or the ratchet — on paired seeds, the same rig and the same
day's clauses under every economy.

```
The roof's yard — Mark 3 + one step (rung 4), 20 seeds x 2 day(s), bot demo+bond
Rig: 8 tracks at the Workshop's ceiling (tier 2), magazine left off
Yard: stops after bays 3/6/9; every rung it can sell is tier 3 at 55 scrap, 8 of them
Bays: $660 -> $1614 at $23 a shot        Ladder payout: 2/line + 10/bay

economy                     bays   wall  clears  earned  spent  rungs
0 · LADDER run (control)     5.0      5    8/40     124     77    1.4
a · no yard (was shipped)    4.0      5    0/40       0      0    0.0
b · yard, 2/line + 10/bay    4.2      5    0/40     107     76    1.4
c · yard, 1/line + 5/bay     4.0      5    0/40      50     29    0.5   <- SHIPPED
c · yard, 2/line + 0/bay     4.0      5    0/40      61     33    0.6
c · yard, 1/line + 0/bay     4.0      5    0/40      32      7    0.1

Rungs bought at each stop (mean over ALL runs, including those that never reached it):
  0 · LADDER run (control)    0.65   0.50   0.25
  a · no yard (was shipped)   0.00   0.00   0.00
  b · yard, 2/line + 10/bay   0.55   0.53   0.30
  c · yard, 1/line + 5/bay    0.00   0.45   0.07
  c · yard, 2/line + 0/bay    0.10   0.35   0.15
  c · yard, 1/line + 0/bay    0.00   0.05   0.07
```

Four things the flights add to the table above:

- **At the ladder's payout the roof buys exactly what the LADDER buys** — 1.4
  rungs a run, against the control's 1.4 — even though its bays cost more and it
  takes one notch a bay instead of two. A yard that hands the dearest floor in
  the game the same purchasing power as the floor below it is the thing the
  owner's "we expect the maxed out rig" was pointing at.
- **The shipped share buys about a third of that**: 0.5 rungs, 29 scrap spent
  against 76. The stop is a real purchase and not a shopping trip.
- **It does not move the mode's difficulty at bot competence.** Rows (a) and the
  shipped (c) both read 4.0 bays cleared and a wall at bay 5 — the tightened
  yard leaves the run the mode already was, where the ladder's payout nudges it
  to 4.2. Whatever the yard is doing for the player, it is not paying for their
  bays.
- **The purchase lands at stop 2, exactly where §3 predicts.** Under the shipped
  share the first stop sells nothing (0.00) and the second sells 0.45 of a rung
  per run — and the stop-2 and stop-3 columns are DILUTED, because the median run
  here dies in bay 5 and never reaches them. Read them as "what the reachable
  stops sold", not as a per-visit rate.

The 0/40 clears is not a verdict on the mode: the control at the same Mark
clears 8/40 with two notches a bay and cheaper bays, and the roof's whole point
is to be dearer than that. `sim/skydeck.ts` is the harness for the clause stack's
own difficulty; this one is about the yard.

**Read the gaps, not the absolutes.** Every bias in the harness is pessimistic
and identical across rows (`sim/README.md`): the pilot fires demolition charges
and Bond Breakers, and still has no lookahead, a fixed landing target and no
read of the pile.

Two instrument notes, both of which cost something to get right:

- **The Mark is 3, not 10.** `sim/skydeck.ts` already wrote this argument: at
  Mark 10 the instrument has no resolution — a competent bot is at 0% implied
  run-clear there, and a control already on the floor cannot show that a change
  pushed it lower. Flown at Mark 10 on a maxed rig, every economy dies in bay 2
  and every row reads 0.0 rungs. The *structure* is unchanged by the flag: the
  step is defined as one rung above the Mark below it, the yard opens on the
  ladder's schedule, one notch a bay, three standing clauses.
- **The rig is the Workshop ceiling minus the Loader Magazine.** MAG cuts the
  reload cooldown and every bot fires on every cooldown, so it buys the pilot
  more shots at the same fixed arc and empties the float faster — `marks.ts`'s
  `CALIBRATION_TRACKS` refusal, borrowed. With MAG2 aboard the Mark-6 rows died
  in bay 2 broke on every seed under every economy, which measures the bot. A
  track at tier 0 is also a track the yard cannot sell (a refit *raises*, never
  installs), so the shelf is eight flat-priced rungs instead of nine and the
  argument in §2 is untouched.

## 5. What shipped

- `level.ts`: `SKYDECK_SCRAP_SHARE = 0.5`, applied to the ladder's own two rates
  and written onto every roof bay by `applySkydeckEconomy`.
- `run.ts`: `refitAfterBay` opens the ladder's three stops on the roof, and the
  schedule note carries the design history (owner ruled no-refit in, playtest
  ruled it out).
- Consumables are still **not resupplied** there: the stop sells a bigger rack,
  never a refill, so a Thaw Lance rung issues only the charges it adds.
- The run still undocks with an **empty hold** — the Scrap Cache's 30 starting
  scrap is declined, because everyone on the day's board flies the same day.

## 6. What this file is not entitled to say

- Nothing here is a human clear rate. §3 is arithmetic and §4 is a bot.
- The lines-a-bay figures the table is read at (10–12 for an endgame pilot) are a
  design estimate, not a measurement of real players. If telemetry ever says the
  roof's pilots clear materially more or fewer, §3 should be re-read at that
  number before the share is defended again.
- Nothing here prices the **step** (the roof's dearer bays). That is
  `level.ts`'s own note and the pins in `sim/systems.ts`; the two changes shipped
  together but they are separate claims.
