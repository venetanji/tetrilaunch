# WINNABILITY SWEEP — which notch combos a Deep Run cannot survive

What `app/sim/winnability.ts` measured on `origin/staging`, and what it is and
is not entitled to say.

> **§5a RE-MEASURED ON THE SHIPPED THAW LANCE, 2026-08-27.** The lance is no
> longer a prototype — it is `upgrades.ts`'s `thaw` track, and `sim/counters.ts`'s
> `thawKit` now grants the real charges and pulls the real trigger. The
> re-measurement moved two things and is folded into §5a below with the old
> table kept beside it: the charge ladder shipped at **3/6/9 a bay** rather than
> 2/4/6, and the numbers are no longer an upper bound on what a lance could be
> worth — they are what the lance is worth.
>
> **§5b was re-measured separately, by the volatile re-price** (`level.ts`'s
> `VOLATILE_LOSS_SHARE`), and carries its own before/after. The two branches
> shipped from one proposal document and touch different halves of it; nothing
> in §5a's tables depends on §5b's, because `--mode counter` prices one bay
> against one explicit ratchet stack and neither stack contains the other's
> material. Every other section of this file is the measurement as taken and is
> unchanged.

**Re-measured after #124 (Skydeck).** The tables below were first collected at
the merge of #122; #124 landed a second run mode underneath them, so they were
re-run on the merged tree. The headline comparisons reproduce **byte for byte** —
Tier 5 bay 5 over 24 paired seeds is 23/24 clean, 17/24 at `cryo:1`, 20/21/23
across the thaw tiers at the same shot counts and the same ending funds; Tier 7
bay 10 over 16 seeds is 14/16 clean, 16/16 at `volatile:6`, and 14/16 cushioned
at 28.1 shots and $1694, identical to the clean control. The ladder re-runs
agree too, including the cliff §2 is written around: Tier 4 comes back 1/8
clears / wall 10 / `winnable` and Tier 5 comes back 0/8 / wall 4 /
`unwinnable`, exactly as recorded. That is the expected result rather than a
lucky one: a Skydeck run's standing clauses reach a config
through `standingClauses(run)`, which returns nothing for a ladder run, so #124
moves no number the walls below are made of. The counter-system
argument built on this lives in
[`counter-systems-proposal.md`](./counter-systems-proposal.md); this file is the
measurement, and every table names the command that reproduces it.

**The headline, before the tables.** Nothing here is what the sweep was built
expecting to find. The Deep Run's failure mode is not a material and not a
notch — **it is bankruptcy, at every Tier, under every draft policy, in
essentially every run**. What the notch combos change is how fast the purse
empties. Two materials are outliers on that measure and they point opposite
ways: **cryo's FIRST notch — 7% of the belt — costs a quarter of a bay's wins
where an identically-priced notch of rebar costs nothing**, and **volatile at
the belt cap makes a bay EASIER than a clean one**.

---

## 1. What this instrument is, and what it replaces

Three sweeps in `app/sim/` already price difficulty, and none can be asked this
question. `sweep.ts` prices a **bay**, `marks.ts` prices a **Mark**, `pile.ts`
prices the **congestion tax** — and a *build of the run* is eight ratchet picks
whose entire cost is that they compound across ten bays.

Both existing sweeps replace that compounding with a model, and say so:
`ratchet-model.ts` invents an average run's notches round-robin over the NUMBER
axes and **excludes content axes outright**; `sweep.ts` stands a flat
`--carry 100` in for a surplus nobody computed; `marks.ts`'s `tiersForBay` hands
the rig a scrap schedule taken from the design's own sizing estimate. Each is
the right approximation for the question that tool asks. Stacked, they describe
a run nobody flies — `ratchet-model.ts` is blunt about it:

> Three bays a run (`MATERIAL_DRAFT_BAYS`) deal a hand the player cannot answer
> with a number, so the modelled run is one nobody flies. […] Tier 10 bay 5
> takes **83%** of bays with the number axes alone and **8-17%** once the
> materials a run would really be carrying are on the belt.

`winnability.ts` removes the approximations by not needing them. `deeprun.ts`
flies ten bays through `run.ts`'s own `advanceRun` / `buyUpgrades` /
`levelForRun`; `draft-space.ts` deals the real hands from `hazardOffers` and
takes only picks `togglePick` would accept; the pilot fires demolition charges
**and** Bond Breakers.

### The pilot, and the ledger

Every bias runs one way, and a document whose headline word is *unwinnable* has
to keep the list visible.

| | |
|---|---|
| **Closed** (open in `sim/README.md` until now) | demolition charges are fired (`bots.ts`'s `demo`); Bond Breakers are fired (`counters.ts`'s `bondHands`) |
| **Still open** | no lookahead; a fixed landing target per shot; no reading of the pile's shape; the draft policy never changes its mind mid-run |

So: a combo called **winnable is winnable**. A combo called **unwinnable beat a
competent pair of hands holding every counter the game already sells** — the
strongest claim this instrument can make, and still not a proof. **A human
clears bays this pilot loses.**

### Covered vs sampled

The notch-combo space is **enumerated exhaustively** and **played in part**. The
sweep prints both numbers on every run.

| | |
|---|---|
| **Enumerated (free)** | every reachable path. 8 ratchet drafts (the 9th is the Final Inspection), a two-card hand each, 1 pick below Mark 10 and 2 at it → **2^8 = 256** paths below the capstone (9 distinct terminal combos at Tier 1, 64 at Tier 3, 168 at Tier 7) and **3^8 = 6561** paths / **3645** distinct combos at Tier 10. Milliseconds. |
| **Played exhaustively** | the CORNERS — one `max:<axis>` policy per axis the Mark deals (2 at Tier 1, 6 at Tier 5, 8 at Tier 7, 10 at Tier 10). A cliff is found by walking to the edge, not by sampling the middle. |
| **Played sampled** | the interior — `spread`, `dodge`, and seeded `random:N` walks. |
| **Not played at all** | policies that change their mind mid-run; the second Final Inspection clause (unless `--finals both`); seeds beyond `--seeds`; loadouts outside the named `--build` priority orders. |

### Why the verdict reads the WALL, not the clear rate

`marks.ts`'s own arithmetic makes the obvious statistic useless here: a run
needs every bay, so 90% a bay is 35% of runs and 80% a bay is 11%. At any seed
count this sweep can afford, **0 clears is exactly what a correctly-tuned Tier
looks like**. What separates a correct Tier from a wall is *where the run
stops*: dying on bay 2 every seed and dying on bay 9 every seed both score zero
and are nothing alike.

- **wall** = median bay the run died in; **best** = deepest bay any seed cleared.
- **winnable** = a seed took all ten bays.
- **marginal** = wall ≥ 6 (`MARGINAL_WALL`) — the run cleared five bays with a
  refit stop behind it, so it was handed the scrap lever and used it.
- **unwinnable** = wall < 6 — the run ended before its first refit paid off.

---

## 2. THE LADDER — where each Tier walls

```sh
npm run sim:winnability -- --marks 1,2,3,4,5,6,7,8,9,10 --seeds 8 --random 0 \
  --policies dodge --build spatial,economy,material
```

`dodge` is the most forgiving draft policy in the tool — it refuses a material
wherever the hand allows one — so this table is a **ceiling on the ladder**: no
stationary policy does better. Best of three priority orders per Tier, the way
`marks.ts` judges a Mark ("we test several shapes and judge the Mark by the BEST
of them"). 8 seeds.

| Tier | best build | clears | wall | best bay | verdict | combo reached (seed 1) |
|---:|---|---:|---:|---:|---|---|
| 1 | spatial | 1/8 | 7 | 10 | **winnable** | `cost:3 time:3` |
| 2 | economy | 1/8 | 7 | 10 | **winnable** | `cost:3 time:2 wind:3` |
| 3 | economy | 4/8 | 10 | 10 | **winnable** | `cost:2 sweeper:2 time:2 wind:2` |
| 4 | material | 1/8 | 10 | 10 | **winnable** | `cost:2 sweeper:1 time:4 wind:1` |
| 5 | spatial | 0/8 | **4** | 4 | **unwinnable** | `cryo:1 time:1` |
| 6 | economy | 0/8 | 6 | 5 | marginal | `time:1` |
| 7 | spatial | 0/8 | 5 | 5 | **unwinnable** | `rebar:1 slag:1 wind:3` |
| 8 | spatial | 0/8 | 4 | 8 | **unwinnable** | `rebar:1 slag:1 sweeper:2 time:2 volatile:1 wind:1` |
| 9 | economy | 0/8 | 5 | 6 | **unwinnable** | `cryo:1 wind:1` |
| 10 | spatial | 0/8 | **4** | 6 | **unwinnable** | `cryo:2 time:2 wind:2` |

*(The combo column here is the FIRST seed's stack — the shipped tool now prints
the DEEPEST run's instead, a change made after this table was collected because
a run that died on bay 2 banked one draft and its combo says nothing about the
policy that chose it. Re-running the command will therefore show a same-or-deeper
stack in that column; the `clears` / `wall` / `best` columns are unaffected.)*

### The cliff is at Tier 5, and it is exactly where the material dodge is taken away

Tiers 1-4 all reach bay 10 and one seed in eight goes the distance. Tier 5 drops
to a median death in **bay 4** and never gets past it. That is not a gradual
step in the tier ladder — `level.ts` moves the opening target $600→$680 and the
clock 180s→164s between Tier 1 and Tier 5, which the earlier rungs absorbed
fine.

What changes at Tier 5 is stated in `hazards.ts`, and the combos the runs
actually reached confirm it:

> "Materials only" is exact at the ONE-PICK rungs where the Mark has two or more
> materials […] Where the Mark has exactly one — Mark 4, cryo alone — the hand
> is that material plus the run's hardest active axis, so the player CAN still
> take the number and dodge. […] **these bays force a material from Mark 5
> onward and merely offer one at Mark 4.**

- Tier 4's seed-1 run banked `cost:2 sweeper:1 time:4 wind:1` across eight
  drafts — **no material at all**. The dodge worked, and the Tier reached bay 10.
- Tier 5's seed-1 run banked `cryo:1 time:1` and stopped there. The dodge was
  gone, cryo was taken at bay 2's forced hand, and the run was over in bay 3.

The single design change between those two rows is that `MATERIAL_DRAFT_BAYS`
became mandatory. §3 and §5 show it is *which* material that does the damage.

### Every loss is `broke`

Across all ten Tiers, the two most common deaths per row are bankruptcy in 19 of
20 cases; the only other reason to appear at all is `time`, once at Tier 2 and
once at Tier 10's `dodge` row. No row anywhere in this sweep is dominated by
`topout`. **The Deep Run does not kill the player by burying them. It kills them
by emptying the purse**, and that is true at Tier 1 as much as at Tier 10.

---

## 3. THE CORNERS — which axis walls hardest

```sh
npm run sim:winnability -- --marks 5,7,10 --seeds 4 --random 2 \
  --build spatial,material
```

Exhaustive over the axes each Tier deals; 4 seeds; best of two priority orders
(`spatial` is the strongest measured rig, `material` is the one that carries the
DEMOLITION RACK, which is slag's only exit). Sorted by wall.

*(The `random:*` rows were re-flown after review found the sampler carrying its
RNG stream between runs — one built policy per table row, reused across every
seed and `--build` order, so a run's draws depended on how many drafts the runs
before it had reached. `sim/README.md` has the full note. Only these rows moved:
every `max:<axis>`, `spread` and `dodge` policy is stateless, and all of their
numbers below re-ran byte-for-byte identical.)*

### Tier 5 — six axes

| policy | cover | build | clears | wall | best | verdict |
|---|---|---|---:|---:|---:|---|
| `max:cryo` | corner | spatial | 0/4 | **2** | 2 | **unwinnable** |
| `random:20973` | interior | spatial | 0/4 | 2 | 3 | unwinnable |
| `random:28892` | interior | spatial | 0/4 | 3 | 3 | unwinnable |
| `max:cost` | corner | spatial | 0/4 | 4 | 4 | unwinnable |
| `max:time` | corner | spatial | 0/4 | 4 | 4 | unwinnable |
| `max:wind` | corner | spatial | 0/4 | 4 | 3 | unwinnable |
| `max:sweeper` | corner | spatial | 0/4 | 4 | 4 | unwinnable |
| `spread` | interior | spatial | 0/4 | 4 | 4 | unwinnable |
| `dodge` | interior | spatial | 0/4 | 4 | 4 | unwinnable |
| `max:rebar` | corner | material | 0/4 | **7** | 8 | marginal |

**The spread between the two material corners is the whole Tier-5 story.**
Pouring notches into **rebar** is the *best* build at Tier 5 (wall 7, and one
seed reached bay 8); pouring them into **cryo** is the worst (wall 2), and every
number axis sits between them at 4. A five-bay spread between two axes that cost
a player the same one notch is not a difficulty curve, it is a trap.

### Tier 7 — eight axes

| policy | cover | build | clears | wall | best | verdict |
|---|---|---|---:|---:|---:|---|
| `random:20973` | interior | spatial | 0/4 | 4 | 3 | unwinnable |
| `max:time` | corner | spatial | 0/4 | 5 | 5 | unwinnable |
| `max:sweeper` | corner | spatial | 0/4 | 5 | 4 | unwinnable |
| `max:cryo` | corner | spatial | 0/4 | 5 | 6 | unwinnable |
| `max:rebar` | corner | spatial | 0/4 | 5 | 5 | unwinnable |
| `max:slag` | corner | material | 0/4 | 5 | 4 | unwinnable |
| `spread` | interior | spatial | 0/4 | 5 | 5 | unwinnable |
| `random:28892` | interior | material | 0/4 | 5 | 5 | unwinnable |
| `max:cost` | corner | spatial | 0/4 | 6 | 5 | marginal |
| `max:wind` | corner | spatial | 0/4 | 6 | 5 | marginal |
| `max:volatile` | corner | material | 0/4 | **6** | 6 | marginal |
| `dodge` | interior | material | 0/4 | **8** | 7 | marginal |

Tier 7 is flat: every corner lands within one bay of every other, and the two
BEST rows are `dodge` (take no material you do not have to) and `max:volatile`.
**Volatile was the easiest axis on the table at the Tier that introduces it** —
§5b shows why, and it is not a rounding error. That is what the re-price
(`VOLATILE_LOSS_SHARE`) was made to fix; this table is the pre-change reading
and the `max:volatile` row is the one it moves.

### Tier 10 — ten axes, two picks a bay

| policy | wall | best | verdict |
|---|---:|---:|---|
| every corner except `max:slag` | **3** | 2-4 | **unwinnable** |
| `max:slag`, `dodge`, `random:28892` | 4 | 3-4 | **unwinnable** |

Fourteen policies, 112 runs, **not one reached bay 5**, and every death but one
is `broke`. Tier 10 is not a hard notch combo — it is a Tier where the ratchet
is irrelevant because the economy has already failed. `marks.ts` at the same
commit calls Mark 10 `IMPOSSIBLE` (0% implied run clear) *with the number axes
alone*; this sweep says the same thing with the materials on the belt and
localises it: **the wall is bay 3.**

### The headline unwinnable combos, by Tier

Named as the sweep found them. Every one is a combo a player can be DEALT — the
enumeration only produces reachable stacks — and every one killed a pilot
holding demolition charges and Bond Breakers.

| Tier | combo | wall | why |
|---:|---|---:|---|
| 5 | **cryo, from the first forced notch** (`max:cryo`) | **bay 2** | §5a: one notch costs a quarter of a bay's wins, and Tier 5 is the first Mark that cannot dodge it |
| 5 | anything at all (`dodge`, the most forgiving policy) | bay 4 | the Tier itself, once the dodge is gone |
| 7 | every number axis, and cryo/rebar/slag alike | bay 5 | flat: no axis is the problem, the purse is |
| 5 | `cryo:3` on a late bay | **9/24 wins** | measured directly (`--mode counter`, Tier 5 bay 10, 24 seeds) against a 21/24 clean control — and a maxed thaw rig buys back only two |
| 8 | `cryo:3 slag:2` on a late bay | **0/8 wins** | measured directly (Tier 8 bay 10): $21 of ending funds against a target in the thousands, with or without a thaw rig |
| 10 | **all ten corners and every interior sample** | bay 3 | 112 runs, none past bay 4 |

And the combos that are NOT the problem, which is the more useful half:

| combo | measured cost |
|---|---|
| `rebar:1` | nothing (8/8 vs 8/8 control) — **§8 followed this thread to the end and it was the whole axis, not the first notch** |
| `time:3` (three Shift Cut notches) | **byte-identical to no notches at all** — the bay is lost on money long before the clock binds |
| `volatile:6` (the belt cap) | **negative** — 16/16 vs a 14/16 clean control |
| `max:slag` at Tier 10 | the BEST corner at that Tier, on a rig carrying the Demolition Rack |

---

## 4. CHEAPEST WINNING STRATEGY

```sh
npm run sim:winnability -- --marks 1,3,5,7 --seeds 4 --mode cheapest --build economy
```

The search walks the loadout ladder UPWARD in real `tiersCost` steps and reports
the first rung at which a seed goes the distance, for two refit stances. It is
**a ceiling, not an optimum**: one priority order (`economy`), one draft policy
(`dodge`), and "clears" means one seed in four went all ten bays. At four seeds
the rung it lands on is noisy, and the two stances' answers are not directly
comparable to each other — each is an existence proof at its own price, not a
threshold.

The two currencies are different in kind and are reported separately:
**ladder points** are the permanent Workshop loadout, bought with salvage
against `budgetForMark`; **scrap** is earned in-run and spendable only at the
three refit stops, and only on tracks the loadout already installed
(`run.ts`'s `buyUpgrade` refuses a tier-0 track).

| Tier | budget | refit stance | loadout pts | scrap spent | rig | clears |
|---:|---:|---|---:|---:|---|---:|
| 1 | 77 | none | 75 | 0 | `lau1 rea2` | 1/4 |
| 1 | 77 | greedy | **20** | 45 | `rea1` | 1/4 |
| 3 | 231 | none | 60 | 0 | `bay1 hyd1 rea1` | 1/4 |
| 3 | 231 | greedy | 135 | 135 | `bay1 lau1 hyd1 rea2 bon1` | 2/4 |
| 5 | 385 | none | — | 0 | **NONE FOUND** | 0/4 |
| 5 | 385 | greedy | **20** | 23 | `rea1` | 1/4 |
| 7 | 539 | none | — | 0 | **NONE FOUND** | 0/4 |
| 7 | 539 | greedy | — | 0 | **NONE FOUND** | 0/4 |

### The refit stop is not an optional upgrade path — at Tier 5 it is the only one

The Tier-5 row is the finding. **No loadout clears Tier 5 on its own**, at any
rung of the ladder up to the full 385-point Workshop ceiling, with refits
switched off. Turn refits on and the run clears from the *first rung of all* —
20 ladder points, a single Reactor install, plus 23 scrap.

That is a strong statement about where a run is won. `meta.ts` prices the
Reactor install at 15 salvage and calls it the on-ramp — *"a player's first
cleared Contract buys their first system"* — and this says that on-ramp is not
merely the cheapest way in, it is very nearly the *whole* purchase. What the
extra 365 points of Workshop budget buy, measured here, is nothing; what the
scrap buys is the run.

Two readings, and they want separating by a human playtest:

- **The optimistic one.** The design is working as `upgrades.ts` intends —
  "salvage buys the rig you START with; scrap buys the rig you BUILD during a
  run" — and the run is genuinely built rather than bought.
- **The worrying one.** `budgetForMark` climbs 77 → 770 across the ladder and
  the sweep can find no use for the top 95% of it. `marks.ts` already records
  half of this ("Above Mark 3 the binding constraint is not the budget but the
  PRIORITY ORDER"); this measures the consequence end-to-end.

**And at Tier 7 there is no strategy at all.** Both stances walked the entire
loadout ladder — every rung from stock to the 385-point Workshop ceiling, with
and without refit spending — and no rung cleared on any seed. The search's answer
is `NONE FOUND` twice. That is the §2 ladder's Tier-7 row seen from the other
side: not "expensive", not "requires the right build", but *no reachable
combination of the two purchasing levers, under the most forgiving draft policy
this tool has, clears the run at this pilot's competence*.

Also worth noting against the Tier-1 row: the cheapest CLEARING strategy there
is **20 points**, where the full-budget rig is 75. A Tier is not made easier by
spending its whole budget, which is the same shape `marks.ts`'s MAGAZINE note
found on a single bay.

---

## 5. COUNTER PROTOTYPES, MEASURED

### Why the run-level sweep could not answer this, and what replaced it

The first attempt priced the counters by re-running the whole combo sweep with
the kit installed. It produced this, at Tier 7 on `max:volatile`, 6 seeds:

| kit | clears | wall | best |
|---|---:|---:|---:|
| baseline | 0/6 | 6 | 8 |
| `cushion1` | 0/6 | 4 | 6 |
| `cushion2` | 0/6 | 4 | 6 |
| `cushion3` | 0/6 | 4 | 6 |

Three tiers, identical to each other and two bays from the baseline *in the
wrong direction*. That is not an effect — it is leverage. A counter changes the
physics, the physics changes where every later shipment lands, and ten bays of
divergence moves the wall by more than the counter is worth.

So `--mode counter` was added: **ONE bay, ONE explicit ratchet stack, the same
seeds with and without the kit** — the paired shape `pile.ts` already uses for
the congestion tax, and the recipe `ratchet-model.ts` prescribes for pricing a
material. Every number below is from that mode, on the `material` rig
(`bay2 lau2 hyd2 rea2 bon2 dem2`, 330 pts) with the `demo`+bond pilot and
`CARRY_CAP` in hand.

### 5a. Cryo — the material that needs a system

```sh
npm run sim:winnability -- --mode counter --marks 5 --bay 5 \
  --ratchets cryo:1 --counters thaw1,thaw2,thaw3 --seeds 24 --build material
```

Tier 5, bay 5 — the bay a run reaches **immediately after** the forced material
hand at `MATERIAL_DRAFT_BAYS`'s bay 2. 24 paired seeds, on the PROTOTYPE:

| | cost | win | lines | shots | end $ | losses |
|---|---:|---:|---:|---:|---:|---|
| **CONTROL** — no ratchets | 0 | **23/24** | 7.3 | 23.8 | $1283 | broke×1 |
| **CONTROL** — `rebar:1` (8 seeds) | 0 | **8/8** | 7.9 | 25.3 | $1281 | — |
| **CONTROL** — `time:3` (8 seeds) | 0 | **8/8** | 8.8 | 26.6 | $1319 | — |
| `cryo:1` | 0 | **17/24** | 8.8 | 32.2 | $921 | broke×6, time×1 |
| `cryo:1` + Thaw Lance 1 (2 charges/bay) | 20 | 20/24 | 9.6 | 31.6 | $1105 | broke×2, time×2 |
| `cryo:1` + Thaw Lance 2 (4/bay) | 55 | 21/24 | 7.2 | 25.7 | $1140 | broke×3 |
| `cryo:1` + Thaw Lance 3 (6/bay) | 110 | **23/24** | 7.0 | 22.6 | $1347 | broke×1 |

Four things at once, and they are all load-bearing:

1. **One notch of cryo — `MATERIAL_BASE`, 7% of the belt — costs 6 bay-wins in
   24**, 96% → 71%.
2. **It is not "materials are hard", and it is not "notches are hard".**
   `rebar:1`, an identically-priced notch of a material with a *passive* answer,
   costs nothing measurable. Neither does `time:3` — three notches of Shift Cut
   returned results byte-identical to no notches at all, because at Tier 5 the
   bay is lost on money long before the clock binds. Cryo is the outlier on a
   table where most axes cost nothing.
3. **The cost is paid in SHOTS, and shots are cash.** 23.8 shots clean → 32.2
   with cryo, and lines go UP (7.3 → 8.8) while ending funds fall $362. The
   pilot is not failing to clear rows; it is being made to buy each one twice —
   exactly the sequencing cost `lineClear.ts`'s `strikeCryo` describes ("cryo
   costs a shipment: land it, then spend a second shot hitting it") — and at a
   bay-5 launch price that is the margin.
4. **The Thaw Lance buys it back monotonically and lands ON the control.**
   17 → 20 → 21 → 23 of 24, with shots falling 32.2 → 22.6 as the second
   shipment per frozen cube stops being needed, and tier 3 arriving at exactly
   the clean bay's 23/24. A ladder that moves one way and stops where the
   hazard stopped is the shape a counter is supposed to have.

### 5a-bis. THE SAME TABLE, ON THE SHIPPED SYSTEM

```sh
npm run sim:winnability -- --mode counter --marks 5 --bay 5 \
  --ratchets cryo:1 --counters thaw1,thaw2,thaw3 --seeds 48 --build material
```

Same command, same rig (`bay2 lau2 hyd2 rea2 bon2 dem2`, 330 pts — the Workshop
ceiling binds there, not the Mark's allowance, so the eighth track's effect on
`budgetForMark` moved no control), **48** paired seeds because the first pass at
24 could not resolve the bottom rung:

| | win | lines | shots | end $ |
|---|---:|---:|---:|---:|
| clean control | **46/48** | 8.1 | 25.6 | $1260 |
| `cryo:1` | **29/48** | 8.3 | 33.3 | $776 |
| + Lance 1 (2/bay) | 29/48 | 9.4 | 35.8 | $813 |
| + Lance 2 (4/bay) | 38/48 | 8.0 | 29.6 | $1033 |
| + Lance 3 (6/bay) | 42/48 | 8.3 | 28.0 | $1149 |
| **+ Lance 1 (3/bay)** | **35/48** | 8.8 | 32.6 | $962 |
| **+ Lance 2 (6/bay)** | **42/48** | 8.3 | 28.0 | $1149 |
| **+ Lance 3 (9/bay)** | **43/48** | 8.2 | 26.9 | $1201 |

**The finding is the first rung.** At the proposal's 2/4/6 the tier-1 lance
returns 29/48 against an un-lanced 29/48 — a purchase that buys nothing, which
is the failure `upgrades.ts` names in its own refit-projection note. At 3/6/9 it
buys six bay-wins, and the ladder is monotone on all three measures: shots fall
33.3 → 32.6 → 28.0 → 26.9 against the clean bay's 25.6, ending funds climb $776
→ $962 → $1149 → $1201 against its $1260. **It converges on the control and does
not reach it** — the hazard survives the counter, which is the shape
`hazards.ts` asks for and a slightly better one than the prototype's "lands ON
the control".

*(A 24-seed pass of the shipped 2/4/6 ladder read tier 1 as actively harmful,
15/24 against 17/24. It is flat, not harmful. That is this document's own rule
biting: no number at 24 seeds where a 48-seed one exists.)*

**Where it stops working, stated plainly.** The lance is sized for the FIRST
notch. At three notches (17% of the belt) on a late bay, on the PROTOTYPE,
24 paired seeds:

| Tier 5 bay 10, 24 seeds | win | shots | end $ |
|---|---:|---:|---:|
| clean control | 21/24 | 26.3 | $1658 |
| `cryo:3` | **9/24** | 34.2 | $752 |
| `cryo:3` + Lance 1 | 10/24 | 38.5 | $831 |
| `cryo:3` + Lance 2 | 10/24 | 37.2 | $889 |
| `cryo:3` + Lance 3 | 11/24 | 38.4 | $866 |

Three notches of cryo cost **twelve** bay-wins in 24 (88% → 38%), and the full
lance buys back two of them — inside the noise. That is the tier ladder
behaving exactly as `counters.ts` sizes it ("two charges answers a first notch
and leaves the second notch genuinely unanswered"), and it is also a warning:
at the belt cap even six charges a bay are under-provisioned, so a run that
ratchets cryo hard is not rescued by owning the counter.

**AND THE SHIPPED LANCE SCALES FURTHER THAN THE PROTOTYPE DID.** Same bay, 48
paired seeds, the shipped 9-charge capstone:

| Tier 5 bay 10, 48 seeds | win | lines | shots | end $ |
|---|---:|---:|---:|---:|
| clean control | 45/48 | 7.9 | 25.2 | $1760 |
| `cryo:3` | **21/48** | 6.8 | 34.4 | $846 |
| `cryo:3` + Lance 3 (9/bay) | **34/48** | 7.4 | 30.8 | $1304 |

Three notches still cost 24 bay-wins in 48, and the maxed lance buys back
thirteen — a little over half, where the prototype's six charges bought back
two. Two things did that and they are worth separating: three more charges a
bay, and a strictly better target. `counters.ts`'s rig thawed the first eligible
cube in the field list; the shipped lance takes the cube the press is about to
reach, and the more cryo there is on the floor the more that choice is worth.

The boundary the proposal drew still holds, one notch further out: **the lance
does not erase a cryo build.** A maxed rack on a belt that is 17% cryo leaves
the bay eleven wins short of a clean one, and the lower two tiers stay inside
the noise there. It is an answer to the FORCED first notch, not to a build.

**A note on an earlier reading, kept because it is the kind of mistake this
harness exists to catch.** At 8 seeds the same comparison came back 4/8 → 2/8,
and at Tier 8 `cryo:6` it came back 2/8 → 0/8 — apparently *harmful*, with a
plausible mechanism attached (`shatterColdCryo` destroys a frozen cube that
reaches the press, so thawing it keeps a cube on a field the pilot wants
emptier). At 24 seeds the sign reverses and the effect is flat. The mechanism
may well be real; the measurement that suggested it was not powered enough to
say so, and no number in this document should be read at 8 seeds where a 24-seed
one exists.

### 5b. Volatile — the material that was not a hazard, and now is

> **RESOLVED.** This section's finding was acted on: `level.ts`'s
> `VOLATILE_LOSS_SHARE` now bills a detonation for the live cargo it destroys.
> The *before* numbers below are kept because they are the argument for the
> change, and the *after* numbers are what it bought.

```sh
npm run sim:winnability -- --mode counter --marks 7 --bay 10 \
  --ratchets volatile:6 --counters cushion1,cushion3 --seeds 16 --build material
```

16 paired seeds, on the Tier that introduces volatile:

| Tier 7 bay 10 | clean control | `volatile:6` BEFORE | `volatile:6` AFTER | AFTER + Cushion 1 | AFTER + Cushion 3 |
|---|---:|---:|---:|---:|---:|
| win | 14/16 | **16/16** | **10/16** | 14/16 | 14/16 |
| shots | 28.1 | 48.0 | 43.6 | 28.9 | 28.1 |
| end $ | $1694 | **$1962** | **$1212** | $1700 | $1694 |
| losses | broke×2 | — | broke×6 | broke×2 | broke×2 |

| Tier 7 bay 5 | clean control | `volatile:6` BEFORE | `volatile:6` AFTER | AFTER + Cushion 1 | AFTER + Cushion 3 |
|---|---:|---:|---:|---:|---:|
| win | 15/16 | 16/16 | **8/16** | 15/16 | 15/16 |
| end $ | $1244 | $1295 | $649 | $1326 | $1244 |

**What the BEFORE column was.** At the belt cap an un-cushioned volatile belt
won **16/16** against a 14/16 clean control, ended $268 richer, and ran a mean
pile of 20.2 cubes against 31.4. `hazards.ts` states the contract that broke, in
the plainest words in the file: *"It is mandatory and unrewarded. […] **A notch
is pure cost.**"* It was not. Detonations thinned the pile for free, and
`lineClear.ts`'s own trigger sizing is why the arrival cost was never paid — 22
sits above a lob's 19.5, and the `aim` search always lobs.

**The bot-bias caveat, discharged rather than repeated.** The obvious objection
was that one bot's arc produced the whole result. It did not: `lob-flat`, a
fixed high arc with a third the detonation rate (6.5 a bay against 19.4), showed
the same advantage before (15/16) and pays the same price after (10/16). Both
profiles land on 63% after the re-price — the price does not depend on how you
fly.

**And the cushion now has a job.** This is the reversal worth reading twice. The
proposal's §3b said the Impact Cushion worked perfectly and should NOT be built,
because it was correctly neutralising a hazard that was worth *not*
neutralising — cushioning volatile cost you wins (16/16 → 14/16). Re-priced, the
same prototype **buys them back**: 10/16 → 14/16, landing exactly on the clean
control rather than past it, which is the "makes one specific hazard cheap for
you, does not delete it" test. Same code, opposite verdict, because the thing it
counters finally costs something.

The crosswind case sharpened too — `volatile:3 wind:3` at bay 10 over 8 seeds
now reads 5/8 bare against 8/8 cushioned, where before it was 6/8 against 8/8.

---

### 5b-bis. THE SAME TABLE, ON THE SHIPPED SYSTEM

> **SUPERSEDED BY §5b-ter.** Every number in this section was measured against a
> liner that softened *any* impact on a volatile cube lying inside it, arrival
> or not — which is not the system `upgrades.ts`, `ECONOMY.md` and §2a of the
> proposal all describe. The gate is closed now, so the table below reads as
> what the defect was worth; §5b-ter is the same flags against the rule.

Everything above measured a **field-wide** multiplier standing in for a system
nobody had built, and `counters.ts` said so in as many words: *"every cushion
number this harness prints reads: this is the most a cushion could possibly be
worth."* The Impact Cushion has since shipped as `upgrades.ts`'s ninth track,
positional — a liner 4/6/8 cells deep at the wall, softening ×1.15/×1.30/×1.40
— and `cushionKit` now installs it through `applyUpgrades`. So these are the
same flags against the real thing, at 48 seeds rather than 16.

Tier 7 bay 10, material rig, `demo+bond` pilot, 48 paired seeds:

| | win | lines | shots | end $ | detonation bill |
|---|---:|---:|---:|---:|---:|
| clean control | 45/48 | 8.5 | 26.4 | $1866 | $0 |
| `volatile:6` bare | **27/48** | 6.6 | 41.8 | $1190 | $632 |
| + Cushion 1 (20 pts) | 38/48 | 8.4 | 42.6 | $1602 | $542 |
| + Cushion 2 (55) | 42/48 | 9.2 | 37.5 | $1757 | $270 |
| + Cushion 3 (110) | **46/48** | 10.0 | 31.0 | $1913 | $36 |

**The ladder is real, and the upper bound is what hid it.** The proposal's §3b
open item was that "tier 1 already restores the baseline on its own, so the
three-tier ladder as specified is not what the data asks for" — true of a
cushion covering the whole floor, false of one covering a quarter of it. Every
rung now buys wins, and the detonation bill falls by roughly half at each.

**It converges on the control without becoming it.** 46 against 45 is one seed
on a sample whose standard error is two, and the bay is still visibly a volatile
bay: 31.0 shots against the control's 26.4, and $36 a bay still going to
detonations that a maxed liner does not reach.

**Where the value is at the notch counts a player actually meets.** One or three
notches barely cost wins at all (46/48 and 44/48 against 45/48), so at the
shallow end the cushion buys *efficiency*, not survival:

| | shots bare → maxed | detonation bill bare → maxed |
|---|---:|---:|
| `volatile:1` | 31.2 → 26.2 | $106 → $5 |
| `volatile:3` | 37.3 → 28.7 | $295 → $17 |

**THE CROSSWIND CLAIM ABOVE DOES NOT SURVIVE.** `wind:3` on its own is
**byte-identical at every cushion tier** — 44/48, 9.7 lines, 29.5 shots, $1838 —
because the only thing this system touches is the speed a volatile cube goes off
at, and wind alone detonates nothing. The `volatile:3 wind:3` result is real and
reproduces (40/48 bare → 44 → 46 → 44), but it is the single-axis case: the
combo's damage runs *through* volatile. This is what moved the shipped price out
of the 70 band and down beside the Thaw Lance at 50.

**Two more boundaries, same table.** A clean bay is byte-identical at every tier
(45/48, 8.5 lines, 26.4 shots, $1866) — the system is inert where there is no
volatile to soften. So is a `cryo:3` bay, at 18/48 across all four rows. Under
**Powder Run** (27% volatile) it works fully: 21/48 → 37 → 43 → 43.

**Under Hair Trigger it is worth about two bay-wins**, 27/48 bare against
25/29/29, and that is by construction: `lineClear.ts`'s `cushionedTrigger`
floors a cushioned bay at stock wherever a clause has primed it finer, so the
exam can be paid off and not walked past. It is also the least informative row
here — at the belt cap Hair Trigger costs nothing over stock (27/48 either way),
because a belt already one-third volatile detonates constantly whatever the
threshold is.

---

### 5b-ter. THE SAME TABLE AGAIN, WITH THE ARRIVAL GATE CLOSED

The liner is **insurance on a landing**. That is what the shop card sells (*"the
deep slots it lines are where volatile lands without going off"*), what
`ECONOMY.md` spells out (*"a cube still goes off when something lands hard on
top of it"*), and what §2a of the proposal argues is the whole reason tier 3 can
sit at the top of the arrival range without deleting the material. The collision
side did not ask that question. It softened by the position of *whichever cube
in the pair was volatile*, so a cube already at rest in a lined slot raised the
threshold on an impact it played no part in — and a maxed liner made volatile
inert everywhere it lay deep, which is the one thing `hazards.ts` forbids
outright.

`lineClear.ts`'s `volatileBlast` now asks it: the liner is read off the volatile
cube that **arrived**. Same flags, same seeds, same pilot — and this is the
paired before/after, not a re-run of one side.

**Tier 7 bay 10, `volatile:6` (the belt cap), 96 paired seeds:**

| | win before → after | detonation bill before → after | shots before → after |
|---|---:|---:|---:|
| bare | 55/96 → **55/96** | $687 → $687 | 45.7 → 45.7 |
| + Cushion 1 (20 pts) | 70/96 → **56/96** | $543 → $552 | 42.3 → 38.6 |
| + Cushion 2 (55) | 81/96 → **63/96** | $252 → $525 | 36.3 → 40.0 |
| + Cushion 3 (110) | 91/96 → **59/96** | $32 → $481 | 28.3 → 37.3 |

**The bare row is byte-identical, and that is the control that says the change
is the gate and nothing else.** A bay with no liner aboard cannot tell the two
builds apart, at 48 seeds or 96.

**THE LADDER IN §5b-bis WAS MOSTLY THE DEFECT.** It went 38 → 42 → 46 (of 48)
because each rung lined more of the floor, and lining more of the floor defused
more cubes *permanently*. Against the rule the three rungs land at 56 / 63 / 59
of 96 — not monotone, and spread across about two standard errors of each other.
What a rung buys is no longer "more bay wins".

**What it buys instead is a DEFERRAL, and the bill is where that shows.** Under
the defect the bill fell to $32 at maxed: those detonations never happened. Now
it falls to $481 from $687 — the liner converts an arrival detonation into a
later one, in a bay that is fuller by the time it goes off, which is the
expensive kind. Every volatile cube the liner saves is a cube left lying in the
line zone with a stock trigger on it.

**The efficiency claim at shallow notch counts does not survive either.** Same
harness, 48 paired seeds:

| | shots bare → maxed | detonation bill bare → maxed |
|---|---:|---:|
| `volatile:1`, before | 31.2 → 26.2 | $106 → $5 |
| `volatile:1`, **after** | 31.2 → **31.4** | $106 → **$94** |
| `volatile:3`, before | 37.3 → 28.7 | $295 → $17 |
| `volatile:3`, **after** | 37.3 → **38.1** | $295 → **$240** |

**Two boundaries are unchanged by construction, not by measurement.** A bay with
no volatile in it — the clean control, `cryo:3`, `wind:3` — never reaches the
gate at all: `volatileBlast` leaves before it, on the same `find` it always did.
The rows in §5b-bis that carry volatile *and* a second condition
(`volatile:3 wind:3`, Powder Run, Hair Trigger) were measured before the gate
and should be read as stale by the same argument as the headline table.

**THE PESSIMISM LEDGER NOW CARRIES THE SYSTEM'S WHOLE CASE, which is an open
item and not a finding.** The defect paid the player passively: cubes in the
liner were safe whatever they did next. The rule asks for play — land the
shipment soft in the liner, then *close the row before something lands on it* —
and this pilot cannot make that play. It has no lookahead, a fixed landing
target per shot, no reading of the pile, and `sim/README.md`'s standing caveat
that **no bot lobs a volatile shipment on purpose**. So these numbers understate
the shipped system by more than any earlier table in this document understated
its subject, and the honest reading is *"the instrument can no longer see what
this system is for"* rather than *"the system does not work"*.

What that leaves open, in the order it should be answered:

1. **A play pass, before any re-tune.** The question is whether a human holding
   a maxed liner plays around the deferred bomb. Nothing in `sim/` can answer
   it; the field drawing (`drawCushionBed`) exists precisely so a player *can*.
2. **The price, which was argued from the superseded table.** 50 salvage was
   placed beside the Thaw Lance on the strength of "every rung buys wins". The
   rungs no longer separate under this pilot, so the price is now an untested
   claim rather than a measured one.
3. ~~**A pilot that can lob on purpose**~~ **DONE, and it did not do what this
   item expected.** `sim/aim-strategies.ts`'s `cushion` strategy lands volatile
   in the liner on the slowest arc the search can fly and refuses to drop
   anything hard onto a volatile cube already lying there. The re-run is in
   `aim-strategy-findings.md`; the short version is that the play is worth real
   wins and the three rungs *still* do not separate, for a reason no table here
   could have shown: the aim search's softest power candidate arrives at 22.7
   px/step and the FIRST liner rung already insures it at 25.3, so rungs 2 and 3
   buy this pilot depth of liner and nothing else.

### 5c. THE INCINERATOR — a system with no passive floor at all

> **SHIPPED** (`upgrades.ts`'s `incinerator` track, tenth system, 30 salvage,
> `requiresMark: 4`). Unlike §5a and §5b this section is not a prototype being
> priced and then re-measured: the instrument work and the system landed in one
> branch, so every number below is the shipped track.

#### What it is

A flare hood over the recycling plant. Cargo destroyed **inside the flue** —
`chute.ts`'s `inIncinerator`, i.e. at or above the plant's roofline, plus the
machine's own intake — is billed at **75% / 50% / 25%** of what it would
otherwise have cost. It touches both of the bay's loss bills: the spill fine
(`penaltyPerLostPiece`) and volatile's live-cargo charge (`volatileLoss`).

The region is authored world geometry (`CHUTE_SURFACE_Y`, the plane the HUD's
power bar is mounted on), never `layout.ts`'s `skyTop`. A rule written against
`skyTop` would vary with the player's aspect ratio, i.e. would charge two
players different money for the same seed — the argument `chute.ts` already
makes for its own rect.

#### The measurement that came FIRST, and what it licensed

Before any of this was built, the harness was asked the obvious question: *where
does destroyed cargo actually die?* Twelve Tier-10 bay-10 bays with
`volatile:3 slag:2 tar:1 cryo:1`, and twelve more at Tier 7 bay 10 at
`volatile:6`, tracking the last position of every cube the bay was CHARGED for:

| Tier 7 bay 10, `volatile:6` | charged cubes | share |
|---|---:|---:|
| y < 400 (the upper half of the bay, and the whole open sky) | 0 | 0% |
| y 400–499 | 30 | 2.4% |
| y 500–599 | 453 | 35.5% |
| y 600–719 (the floor and the pile on it) | 792 | 62.1% |

**Nothing dies high.** Volatile detonates where a shipment lands, spilled cargo
decays where it settled, and both of those are the bottom third of the bay. So a
passive positional discount — the system as it was first specified — is worth
exactly zero to a pilot that keeps aiming at the pile, at any boundary you care
to draw. That is not a reason not to build it; it is the whole shape of the
thing, and it is what the tables below are arranged to show.

#### The instrument that had to exist first

`counters.ts` grew **`dumpHands`**, the deliberate discard. `chute.ts` has always
said the maw gives "the deliberate discard a home — dumping a slag shipment when
there's no demolition charge to spare"; no bot had ever made that move, because
every bot in `bots.ts` aims at a landing slot and the machine is not one. The
rule is the simplest honest one: a shipment that can never complete a row
(`countsForLines`, not `material === "slag"`) is fired at the intake, and nothing
else is. This is an instrument fix of the same kind as `bondHands` and `demo` —
it was a harmless gap until a system's whole value lived on the other side of it.

`winnability.ts --mode counter` also grew a **`saved$`** column
(`runner.ts`'s `incineratedFunds`). It is the only handle a headless sweep has on
a passive: in every other column, a charge that was never levied is
indistinguishable from a bay that was never charged.

#### Tier 7 bay 10, three notches of slag — 48 paired seeds

`demo+bond` pilot, `material` rig, against a **45/48 clean control**:

| counter | cost | win | lines | shots | end $ | saved $ |
|---|---:|---:|---:|---:|---:|---:|
| none | 0 | 4/48 | 3.8 | 38.3 | $197 | $0 |
| Incinerator 3 alone | 110 | 4/48 | 3.8 | 38.4 | $195 | **$6** |
| discard alone | 0 | 29/48 | 14.1 | 50.6 | $1188 | $0 |
| discard + Incinerator 1 | 20 | 35/48 | 13.9 | 48.3 | $1411 | $231 |
| discard + Incinerator 2 | 55 | 39/48 | 14.6 | 49.8 | $1581 | $476 |
| discard + Incinerator 3 | 110 | **41/48** | 13.5 | 46.3 | $1676 | $701 |

Read the second row first. **A maxed hood on a pilot that never aims into it is
worth $6 a bay and zero wins** — byte-identical to no hood at all on every other
column. The system has no passive floor; it is the first track on the shelf of
which that is true.

> **THE `saved$` COLUMN WAS CORRECTED AFTER REVIEW** (codex, PR #156), and the
> figures above are the corrected ones. The discount is applied BEFORE the
> balance clamp — `settleBlast`'s own note argues why it must be — and the
> ledger had quietly inherited that rule for a different question. A bay holding
> $10 that meets a $40 gross fine loses the same $10 with or without a maxed
> hood, because the clamp was taking everything either way; the old arithmetic
> scaled the nominal $30 discount by the share of the *discounted* bill that
> landed and reported a saving. The rule now is: clamp both bills
> independently, subtract (`lineClear.ts`'s `reliefRealised` / `blastRelief`).
>
> **Nothing else in either table moved** — win counts, lines, shots and ending
> funds are byte-identical, because this is a readout and never touched the
> bankroll. What moved is the money the readout CLAIMED: at Tier 7 $7 → $6 and
> $705 → $701, and at Tier 10 $191 → $176, which is the largest correction and
> is exactly where the reviewer predicted it — the near-broke losing rows, whose
> ending funds are $180-$197.
>
> The correction makes the section's own argument slightly stronger rather than
> weaker: the row that saves the most while buying nothing now claims less.

Then the ladder. The discard alone is worth 25 bay-wins and is still losing 17
bays to `broke`, because a dump is a launch that buys nothing and is *fined* for
the privilege. Each hood rung buys wins on top of it — 29 / 35 / 39 / 41 — and
the bill falls in very nearly the proportion the ladder promises: $231 / $476 /
$701 is 1 : 2.06 : 3.03 — the drift is the rounding on a per-cube quarter, plus
the bays where the clamp took the charge before the hood could reduce it. The top row lands **under** the 45/48 clean control, which is the
shape `hazards.ts` asks a counter to have: it converges on a clean bay without
reaching one.

#### Tier 10 bay 10, three notches of slag — the case this was asked for

48 paired seeds, against a **48/48 clean control**:

| counter | cost | win | lines | shots | end $ | saved $ |
|---|---:|---:|---:|---:|---:|---:|
| none | 0 | 4/48 | 5.3 | 39.9 | $180 | $0 |
| Incinerator 3 alone | 110 | 4/48 | 5.4 | 41.9 | $186 | $176 |
| discard alone | 0 | 18/48 | 14.3 | 48.9 | $902 | $0 |
| discard + Incinerator 1 | 20 | 30/48 | 15.4 | 51.4 | $1376 | $390 |
| discard + Incinerator 2 | 55 | 36/48 | 15.5 | 52.4 | $1557 | $773 |
| discard + Incinerator 3 | 110 | **38/48** | 13.7 | 47.9 | $1616 | $1109 |

The owner's sentence was *"this makes tier 10 bay 10 with all special materials
more playable"*, and 4/48 → 38/48 is that, measured. Note the second row again,
and note that it is a **stronger** null than Tier 7's: at Tier 10 the hood saves
$176 a bay without the discard policy — the bills are bigger and this pilot
strays more cargo into the maw — and it still buys **not one win**. Money saved
is not the same as a bay won, and this is the row that says so.

#### The boundaries, on the same instrument

- **A clean bay is untouched.** Tier 7 bay 10 with no notches: 45/48 at every
  tier, 8.5 lines, 26.4 shots, and $1 a bay saved. Tier 10 clean: 48/48 either
  way. Where there is no cargo to write off, the hood does nothing — and the
  discard policy does nothing either, because there is nothing dead to discard.
  (Tier 10 clean ends $30 poorer with a hood aboard on identical wins; that is
  the seed-level divergence a changed bankroll produces, not a cost. Wins,
  lines and shots are what the sample can resolve at 48 seeds.)
- **It is NOT a second volatile counter.** Tier 7 bay 10 at `volatile:6`, the
  Impact Cushion's own test bed: 27/48 at every hood tier, ending funds $1190 /
  $1190 / $1190 / $1191 — **one dollar across 48 bays.** Tier 10 at the same cap:
  11/48 / 11 / 11 / 10, saving $2 / $3 / $5. Volatile detonates at the pile, and
  the pile is below the flue. The two positional systems on the shelf do not
  overlap at all, which is the thing a tenth track most needed to prove.
- **One notch is efficiency, not survival**, exactly as the cushion's is. Tier 7
  `slag:1`: 25/48 bare, 40/48 with the discard, 42/48 at every hood rung. The
  rungs stop separating once the bay is no longer losing on the fine.

#### Deep runs, and why they are a footnote here

Tier 7, `max:slag` corner policy, `material` rig, 8 seeds: clears stay 0/8 and
the wall stays at bay 5 for all three of bare / discard / discard+hood. The
`best` column moves 4 → 5 → 9. That is suggestive and it is not evidence: at 8
seeds the corner policy reaches a different combo on each variant (the bare run
reached no slag at all), and §6's first item is why — **every wall in a Tier-7
deep run is `broke`, and no counter system fixes an economy.** The single-bay
paired tables above are the measurement; the deep-run row is recorded so the
next person does not have to re-run it to find that out.

#### The pessimism ledger, for this system specifically

Every item runs the usual direction, and two are new:

- `dumpHands` dumps on the tick a dead shipment loads, on a coarse fixed aim
  grid, without weighing the dump against the board. **A human dumps better and
  dumps less often.**
- Nothing in the harness aims a shipment high on purpose, so the flue's *other*
  half — catching cargo in the air rather than in the machine's mouth — is
  entirely unmeasured. The 2.4% row in the first table is what this pilot
  reaches by accident.
- The bots still have no lookahead, no pile reading and a fixed landing target.

So every number above is a floor, and the ceiling is the play the tables cannot
make.

---

---

## 6. WHAT TO DO ABOUT IT, IN ORDER

1. **The economy, not the counters.** Every wall in §2 and §3 is `broke`, at
   every Tier. No counter system fixes an economy. The levers are `level.ts`'s
   `LAUNCH_BUDGET_SHOTS` / `scorePerLine` / the launch-cost ladder,
   `run.ts`'s `CARRY_CAP`, and `hazards.ts`'s `ladderStart` slide — and the
   sweep is now the instrument that can price a change to any of them, because
   it measures the *run*, which is the thing they compound over.
2. ~~**Re-price cryo, or ship the lance.**~~ **DONE — the lance shipped.** §5a
   was the sharpest comparison in this document (23/24 → 17/24 for one notch,
   where the same notch on rebar costs nothing), and §5a-bis is the same bay
   with the system on the shelf: 29/48 → 43/48 at the capstone against a 46/48
   clean control. `MATERIAL_BASE` was left alone; cryo is still the most
   expensive first notch in the game, and it now has an answer you can buy.
3. ~~**Re-price volatile.**~~ **DONE.** §5b: a notch that was an advantage
   violated the ratchet's founding rule. It was a bug in a number, not a missing
   system, and `level.ts`'s `VOLATILE_LOSS_SHARE` is the number: a detonation is
   now billed for the live cargo it destroys. At the belt cap the axis goes from
   16/16 to 10/16 against a 14/16 clean control, on both pilot profiles.
3a. ~~**Re-price rebar.**~~ **DONE — see §8.** The same violation as volatile's,
   found from the other end: an axis that was not merely cheap but *free*, at
   every notch count and every Tier flown, because rigidity had no surface to
   cost anything on. `compactor.ts`'s `RIGID_PRESS_DRAG` and `lineClear.ts`'s
   `RIGID_SETTLE_ASSIST` are the two surfaces. At the belt cap the axis goes
   from 30/32 to 22/32 against a 32/32 clean control, and every other material's
   row is byte-identical.
4. **Look at Tier 5's forced hand.** The ladder's cliff (§2) sits exactly at the
   rung where `MATERIAL_DRAFT_BAYS` stops being dodgeable, and the material it
   forces first is the one §5a says is mispriced. Those two findings are one
   finding: **the first material a run is ever FORCED to take is the most
   expensive one in the game.** `hazards.ts` already moved slag two rungs down
   the ladder for exactly this reason ("slag waits two rungs for the player's
   rack to be real"); the same argument now applies to cryo, and the fix is
   either the lance, or trading cryo and rebar's positions so the introduction
   is the material with a passive answer.
5. **Tier 10 is not a tuning problem.** 112 runs, no seed past bay 4, every
   death `broke`. It needs the §1 economy work before any notch-level question
   about it is meaningful.

---

## 7. What would strengthen this next

> **TWO OF THESE ARE NOW BUILT.** The cryo-striking bot and the pilot that lobs
> on purpose ship as `sim/aim-strategies.ts`, and what they measure is in
> **`aim-strategy-findings.md`** — including the three-arm re-run of §5b-ter's
> table and the answer to the question it left open. The remaining items below
> stand.

- **A pilot that reads the pile.** The largest open item in the ledger. Every
  number here is a floor because of it.
- ~~**A cryo-striking bot.**~~ **DONE** — `aim-strategies.ts`'s `lance`
  strategy sends the shipment at the frozen cube the lance is *not* going to
  take. §5a measured the lance against a pilot that could not strike cryo with a
  shipment at all; the separation this asked for — "cryo needs a system" versus
  "cryo needs the counter-play the game already has" — is the no-rig row of the
  arms table in `aim-strategy-findings.md`.
- **More seeds on §2.** 8 seeds cannot distinguish a 10%-per-run Tier from a 0%
  one; the wall statistic is what makes the table readable at that sample size,
  and it is a coarse instrument.
- **A positional cushion.** If §6's re-pricing of volatile makes it a real cost,
  the cushion becomes worth measuring for real — and then the field-wide model
  in `counters.ts` has to be replaced with the rear-bay rule it is standing in
  for.

---

## 8. REBAR — the axis that cost nothing, and the two surfaces that were giving it away

> Opened by an owner report: *"the rebar only ending is a bit too easy actually
> we need some additional challenge."* Everything below is the measurement that
> report asked for and the change it bought. The **before** columns are
> `origin/staging` at `7dab69e`, flown from a pristine export of that tree so no
> edit of the branch could reach them.

### 8a. The finding: it is not that rebar is CHEAP, it is that rebar is FREE

Three paired tables, one bay each, the same seeds under every stack, on the
`material` rig (`bay2 lau2 hyd2 rea2 bon2 dem2`) with the `demo`+bond pilot —
the `--mode counter` shape §5 uses, sweeping the RATCHET STACK instead of the
counter kit. `--mode counter` itself could not be pointed at this question: it
varies the COUNTER KIT against one fixed stack, and here the stack is the
variable, so the four probes below live beside `sim/_scratch-mat.ts` as scratch
instruments rather than as CLI modes.

```sh
npx tsx sim/_scratch-rebar.ts --seeds 32 --mark 10 --bay 10   # §8a, §8d
npx tsx sim/_scratch-why.ts   --seeds 24 --mark 10 --bay 5    # §8b, the mechanism
npx tsx sim/_scratch-drag.ts  --seeds 12 --mark 10 --bay 10   # §8c, the cap
npx tsx sim/_scratch-drill.ts --seeds 24 --ids mat-rebar,bondbreaker,mat-magnetic,mat-cryo
npx tsx sim/_scratch-grace.ts                                 # §8e-bis, the grace window
```

**Tier 8 bay 10, 48 paired seeds, on staging:**

| stack | win | lines | shots | end $ |
|---|---:|---:|---:|---:|
| clean control | 45/48 | 9.2 | 28.0 | $1978 |
| `rebar:1` | 44/48 | 10.0 | 30.6 | $1926 |
| `rebar:3` | 43/48 | 9.5 | 29.7 | $1852 |
| `rebar:6` (the belt cap) | **45/48** | 9.9 | 30.3 | $1898 |
| `cryo:1` | 28/48 | 8.9 | 35.1 | $1264 |
| `cryo:3` | 17/48 | 7.0 | 35.0 | $796 |
| `slag:3` | 4/48 | 3.7 | 37.4 | $200 |
| `tar:3` | 9/48 | 11.5 | 49.0 | $459 |

**Tier 10 bay 5, 48 paired seeds, on staging:**

| stack | win | shots | end $ |
|---|---:|---:|---:|
| clean control | 44/48 | 29.5 | $1321 |
| `rebar:1` | **47/48** | **27.4** | **$1387** |
| `rebar:3` | **46/48** | **25.4** | **$1390** |
| `rebar:6` | 43/48 | 26.5 | $1289 |
| `cryo:1` | 24/48 | 34.7 | $739 |
| `slag:3` | 0/48 | 36.3 | $27 |

**Tier 10 bay 10, 32 paired seeds, on staging:**

| stack | win | shots | end $ |
|---|---:|---:|---:|
| clean control | 32/32 | 26.7 | $2169 |
| `rebar:1` | **32/32** | 27.3 | $2151 |
| `rebar:3` | **32/32** | 29.8 | $2099 |
| `rebar:6` | 30/32 | 26.6 | $1942 |
| `cryo:1` | 13/32 | 35.3 | $910 |
| `slag:3` | 3/32 | 38.8 | $202 |
| `tar:3` | 7/32 | 36.7 | $475 |

**Read the rebar rows against the control, not against each other.** At three
Tiers, at every notch count from one to the belt cap, the axis lands within two
seeds of a CLEAN belt — and at Tier 10 bay 5 it lands on the *good* side of it
twice, at three shots fewer and $70 richer. This is not "rebar is the cheap
material". Cryo, slag and tar are on the same tables, measured the same way, and
they cost seventeen, forty-one and thirty-nine bay-wins in 48. **Rebar cost
nothing, at any depth, anywhere it was flown.** `hazards.ts` states the rule
that breaks in the plainest words in the file — *"It is mandatory and
unrewarded. […] **A notch is pure cost**"* — and rebar was the second axis after
volatile (§5b) to be quietly breaking it.

And it shows at the RUN level, which is where the owner met it. Tier 5, 8 seeds,
`material` rig, three draft policies:

| policy | clears | wall | best | verdict |
|---|---:|---:|---:|---|
| `max:cryo` | 0/8 | 3 | 3 | unwinnable |
| `dodge` (the most forgiving policy in the tool) | 0/8 | 4 | 3 | unwinnable |
| **`max:rebar`** | **3/8** | **9** | **10** | **winnable** |

Pouring every notch into rebar is not merely the best build at Tier 5. It is the
*only* one of the three that finishes a run at all, on a Tier §2 calls
unwinnable under the policy that refuses every material it can. That is what
"the rebar only ending is a bit too easy" looks like from inside the harness.

### 8b. WHY — the mechanism, and the two mechanisms it is NOT

The obvious explanations were both checked and both are wrong.

**Not the combo, and not congestion.** A probe that instruments the bay directly
(counting crushes as well as lines, and the share of steps spent above a
congestion tier) reads lines-per-crush at **1.05 on every stack** — clean,
`rebar:1`, `rebar:3`, `rebar:6`, `cryo:1` alike. Nothing is clearing two rows at
once, so no rebar row is being paid a bigger `payoutMult`. Lines-per-shot is
flat too (0.322 clean, 0.316 / 0.339 / 0.323 across the rebar ladder). The
congestion share and the mean pile track the win rate rather than leading it.

**It is that rigidity had no surface to cost anything ON.** `theme.ts` sells the
material on three verbs — a bad landing "cannot be **squeezed, shoved or
shattered** into a better one" — and exactly one of them was enforced:

| verb | the code that owes it | before |
|---|---|---|
| shattered | `pieces.ts` stamps the joints `Infinity`; `breakJointsInBand` exempts them from the press | **enforced** |
| squeezed | `lineClear.ts`'s `settleZoneCubes` grinds near-settled cubes onto the slot grid | **not enforced** — it reads cubes and never asked what held them together, so it squared a rigid shipment at full strength |
| shoved | `compactor.ts`'s bar, a kinematic body moved by `setPosition` | **not enforced** — it advanced through a welded steel cage at exactly the pace it advances through air |

The grind is the sharper of the two omissions, because it did not merely fail to
charge for rigidity — it **rewarded** it. A shipment whose joints never break is
a four-cube stamp at exact `CELL` spacing forever, so every cube in it carries
the same correction and the press grinds the whole piece onto the grid in one
coherent motion. An ordinary shipment shatters and each loose cube has to find
its own slot.

### 8c. WHAT SHIPPED — the press pays for what it is pushing

Two halves of one rule, both gated on the **material AND the joint together**,
so a Bond Breaker is the way out of both — which is the exit `theme.ts` already
promised and the job the Bond Emitter never had ("the material that finally
gives that system a job beyond tidying a messy pile").

- **`lineClear.ts`'s `RIGID_SETTLE_ASSIST`** — the grind reaches a still-bonded
  rigid shipment at a fraction of its strength.
- **`compactor.ts`'s `RIGID_PRESS_DRAG`** — the bar keeps `1/(1 + k·n)` of its
  pace with `n` rigid cubes in its path. A reciprocal rather than a subtraction,
  and that is the whole reason it is a difficulty knob rather than a lose
  button: it is strictly positive for every `n`, so no amount of bar stock can
  stop the press dead. `hazards.ts` makes the same argument for Shift Cut's
  floor. The retreat is never dragged — the cost comes out of the press's
  crushing pace, not out of the player's landing window — and a dragged stroke
  is a SLOW stroke, never a short one, so a Contract budgeted in strokes
  (`level.ts`'s `strokeBudget`) is neither refunded nor robbed.

**Gated on the material, not on `breakStretch === Infinity`.** That second test
is what `breakJointsInBand` uses, and it would also catch every joint on an
unbreakable-bonds bay — `finals.ts`'s Cold Weld clause — so re-pricing a
material would have silently re-priced a Final Inspection. There is a pin in
`sim/systems.ts` for exactly that case.

**The cap was measured, not picked.** The count of still-bonded rigid cubes in
front of the face, over pressing steps at Tier 10 bay 10:

| stack | mean | p50 | p90 | p99 | max | share of steps > 0 |
|---|---:|---:|---:|---:|---:|---:|
| `rebar:1` | 2.30 | 2 | 4 | 8 | 8 | 60% |
| `rebar:3` | 6.22 | 6 | 11 | 14 | 16 | 88% |
| `rebar:6` | 10.44 | 8 | 21 | 29 | 30 | 88% |

`RIGID_PRESS_DRAG_CAP` shipped at 8 first and the axis came back **flat in the
notch count** — 28 / 28 / 26 of 32 — because a cap of 8 truncates the top two
rungs into each other. At 24 it is monotone. A ratchet the player buys one notch
at a time has to cost more at the second notch than at the first.

### 8d. THE BEFORE/AFTER, and the controls that say it is the material and nothing else

**Tier 10 bay 10, 32 paired seeds, `material` rig, `demo`+bond pilot:**

| stack | win before → after | shots before → after | end $ before → after |
|---|---:|---:|---:|
| **clean control** | 32/32 → **32/32** | 26.7 → **26.7** | $2169 → **$2169** |
| `rebar:1` | 32/32 → **29/32** | 27.3 → 25.8 | $2151 → $1887 |
| `rebar:3` | 32/32 → **28/32** | 29.8 → **39.1** | $2099 → $1855 |
| `rebar:6` | 30/32 → **22/32** | 26.6 → **42.9** | $1942 → $1656 |
| `cryo:1` | 13/32 → **13/32** | 35.3 → **35.3** | $910 → **$910** |
| `slag:3` | 3/32 → **3/32** | 38.8 → **38.8** | $202 → **$202** |
| `tar:3` | 7/32 → **7/32** | 36.7 → **36.7** | $475 → **$475** |

**Every control row is byte-identical.** A clean bay, a cryo bay, a slag bay and
a tar bay come back to the last decimal on both trees, because none of them ever
reaches the gate: no rigid cube, no drag, no reduced grind. That is the whole
answer to "does this collaterally nerf the axes that were already hard" — cryo
and volatile are the counters' territory (the Thaw Lance and the Impact Cushion
exist for them) and neither moved by a single seed.

**And the axis is a cost now without being a wall.** `rebar:6` at 22/32 is a
31% bill on a belt one third rigid; `cryo:1` on the same table is 13/32, a 59%
bill on a belt 7% frozen. Rebar is still comfortably the mildest material in the
game, which is where `hazards.ts` puts it on purpose — second on the ladder,
"survivable bare-handed", the introduction. It is simply no longer free.

The cost is billed in the currency §2 says runs die in. At the belt cap the bay
now takes **42.9 shots against a clean bay's 26.7**, and ends $513 poorer. That
is the compounding a single-bay table cannot show: sixteen extra launches a bay,
across ten bays, is the purse.

**THE SAME TABLE AT TIER 8 MOVES THE SHOTS AND NOT THE WINS, and that is the
honest boundary of this change.** 48 paired seeds, bay 10:

| stack | win before → after | shots before → after | lost pieces before → after |
|---|---:|---:|---:|
| clean control | 45/48 → **45/48** | 28.0 → **28.0** | 0.0 → **0.0** |
| `rebar:1` | 44/48 → 43/48 | 30.6 → 28.6 | 0.5 → 1.6 |
| `rebar:3` | 43/48 → 47/48 | 29.7 → 28.8 | 1.1 → 3.3 |
| `rebar:6` | 45/48 → 43/48 | 30.3 → **35.3** | 1.5 → **7.6** |

Only the belt-cap row separates, and the middle rows wander in both directions —
47/48 at `rebar:3` is *above* the clean control and is noise, not a finding. A
Tier-8 bay 10 flown on the full Workshop rig with a capped carry is a bay with
slack in it: the clean control sits at 94% and the win column has nowhere to go.
Tier 10 bay 10 is the same bay with the ladder's own target and clock on it, and
there the same drag costs ten seeds of 32.

**That is the right shape for this knob and it should be said out loud rather
than buried**: a press that labours costs a bay that was already tight, and is
absorbed by one that was not. The owner's report was about the ENDGAME, and the
endgame is where it bites.

**THE AUTHORED BAYS DO NOT MOVE AT ALL, and the reason is structural.** The two
drills that ship a belt of 100% rebar are the bays this change could most easily
have broken — `mat-rebar` clears 2 rows on a 16-launch budget — and they come
back untouched, 24 seeds each:

| drill | win before → after | shots before → after |
|---|---:|---:|
| `mat-rebar` (100% rebar, 1 charge) | 24/24 → **24/24** | 9.4 → 9.1 |
| `bondbreaker` (100% rebar, 2 charges, wedged wall) | 24/24 → **24/24** | 4.3 → **4.3** |
| `mat-magnetic` / `mat-cryo` (controls) | 24/24, 21/24 → **byte-identical** | — |

A drill has no clock, and a Contract has neither a clock nor a launch cost
(`contracts.ts`) — so a press that takes longer to complete a stroke costs them
nothing they are budgeted in. The drag is billed in the two currencies only a
Deep Run bay holds: the shift clock and the launches spent against a target.
`sim/patterns.ts` re-runs clean for the same reason — pattern feasibility is a
tiling proof, not a physics one.

### 8e. THE RUN LEVEL, and why it is reported second

```sh
npm run sim:winnability -- --marks 5 --policies max:rebar,max:cryo,dodge \
  --seeds 16 --build material
```

| policy | clears before → after | wall before → after | best before → after |
|---|---:|---:|---:|
| `max:cryo` | 0/16 → 0/16 | 3 → 3 | 4 → 5 |
| `dodge` | **0/16 → 0/16** | **4 → 4** | **3 → 3** |
| `max:rebar` | **6/16 → 5/16** | 8 → 8 | 10 → 10 |

`dodge` is byte-identical across the change — same clears, same wall, same death
string (`broke@4x9 broke@3x3`), same combo — which is the control this table
needs: a policy that refuses materials wherever it can never meets the gate.

**`max:rebar` moves by one seed and stays winnable, and that is the number to be
careful with.** §5's opening paragraph says why a run sweep cannot price a
physics change: it changes where every later shipment lands, ten bays of
divergence follows, and the wall moves by more than the change is worth. The
`max:cryo` row shows it happening — its runs bank a rebar notch of their own, so
it is not a control, and its `best` wandered from 4 to 5 on runs that had banked
different stacks. Every number in §8d is one bay, one explicit stack, paired
seeds, for exactly this reason.

What the run table IS good for is the shape of the complaint, and it still
reads: at Tier 5, `max:rebar` remains the only one of the three policies that
finishes a run. **This change did not dethrone the rebar build; it made the
build pay.** Whether that is enough is a play question, and §8f says so.

### 8e-bis. THE GRACE WINDOW WAS A CONSUMER OF THE STROKE, and review caught it

Found by review on PR #151, and it is the kind of thing a balance change drags
behind it: a knob that slows a surface breaks whatever was sized off that
surface's old speed.

`game.ts`'s `brokeGraceSteps` exists so that *"a full line already sitting in
the zone must get its pressing stroke — which pays out and un-brokes the player
— before the game calls it"*. It spent that promise as a step count derived from
`Compactor.cycleSteps`, which is the round trip of a bar running **free**. A
dragged advance takes up to `1/rigidPressDrag(24)` = **3.88x** longer, so the
window ran out first:

| bay | undragged cycle | grace window | round trip at worst-case drag |
|---|---:|---:|---:|
| Tier 1 bay 1, stock | 266.7 | **386.7** | **650.7** |
| Tier 9 bay 10, stock | 193.9 | 313.9 | 473.2 |
| Tier 10 bay 10, `rebar:6` material rig | 167.2 | 287.2 | 407.9 |

Driven rather than derived — stepping a real bar from the worst phase (just
reversed, so it owes a full retreat and a full dragged advance) — the next
stroke lands at step 652 where the verdict fires at 387. **The bay was declared
broke before the press that was supposed to rescue it had happened.**

**The fix counts the press instead of predicting it.** Bumping the constant
would only move the arithmetic, and would need moving again the next time
`RIGID_PRESS_DRAG` does. `brokeGraceSteps` stays exactly as it was and becomes
the FLOOR — the earliest the verdict may land — and the verdict additionally
waits for `Compactor.strokes` to advance past what it was when the countdown
armed. A third term, the 30s `brokeGraceMaxSteps`, answers "and if a press never
completes": a bay must always reach a verdict.

**It is inert without drag, by construction and in measurement.** One undragged
round trip always contains a completed advance, so on a bay with nothing rigid
in front of the bar the stroke condition is already satisfied when the floor
elapses and the verdict lands on exactly the step it always did. And **not one
cell of §8d moved** — the Tier 10 bay 10 and Tier 8 bay 10 tables and the drill
table all re-ran byte-identical after the fix, on every stack including the
dragged ones. The guarantee was broken in principle and reachable by
construction (the pin builds the bay that reaches it); across 96 measured bays
no seed happened to arm the countdown at the phase that exposes it.

### 8f. What this does NOT claim

- **The pessimism ledger still runs one way.** The pilot has no lookahead, a
  fixed landing target, and does not read the pile. Rigidity is precisely the
  hazard a pilot who cannot re-plan a landing is least equipped to feel, so if
  anything this instrument *understates* what the change is worth to a human —
  and it understated the old behaviour the same way, which is why the finding
  survived being measured by it.
- **The first-notch number is the softest in the table.** 29/32 against 32/32 is
  three seeds on a sample whose standard error is about one and a half. The
  belt-cap row (22/32) and the shots columns are what carry the claim.
- **The Bond Breaker exit is built, not measured.** A charge empties the joint
  list, so the freed cubes stop dragging and stop resisting the grind on the
  very next step — there are pins for both — but no table here isolates what a
  charge is WORTH on a rebar belt, because the pilot's `bondHands` fires on a
  pile-depth rule (`counters.ts`'s `BOND_MIN_CUBES`) rather than because there
  is bar stock in front of the bar. A pilot that spends a charge for that reason
  is the smallest instrument change that would price the emitter's new job, and
  it belongs on the §7 list.
- **Whether this is ENOUGH is a play question.** §8e says the rebar build still
  finishes runs no other policy finishes at Tier 5. This branch set out to make
  the axis cost what a ratchet notch is supposed to cost, and it does; whether
  the endgame still reads as too easy on a device is a thing only a device can
  say, and the constant is one named number (`RIGID_PRESS_DRAG`) with a measured
  ladder beside it precisely so a play pass can move it.
