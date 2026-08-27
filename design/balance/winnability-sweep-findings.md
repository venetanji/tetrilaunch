# WINNABILITY SWEEP — which notch combos a Deep Run cannot survive

What `app/sim/winnability.ts` measured on `origin/staging`, and what it is and
is not entitled to say.

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
| `rebar:1` | nothing (8/8 vs 8/8 control) |
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
hand at `MATERIAL_DRAFT_BAYS`'s bay 2. 24 paired seeds:

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

**Where it stops working, stated plainly.** The lance is sized for the FIRST
notch and it does not scale. At three notches (17% of the belt) on a late bay,
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

## 6. WHAT TO DO ABOUT IT, IN ORDER

1. **The economy, not the counters.** Every wall in §2 and §3 is `broke`, at
   every Tier. No counter system fixes an economy. The levers are `level.ts`'s
   `LAUNCH_BUDGET_SHOTS` / `scorePerLine` / the launch-cost ladder,
   `run.ts`'s `CARRY_CAP`, and `hazards.ts`'s `ladderStart` slide — and the
   sweep is now the instrument that can price a change to any of them, because
   it measures the *run*, which is the thing they compound over.
2. **Re-price cryo, or ship the lance.** §5a is the sharpest comparison in this
   document: 23/24 → 17/24 for one notch, where the same notch on rebar costs
   nothing and three notches of Shift Cut cost literally nothing. Either
   `MATERIAL_BASE` is wrong for cryo specifically, or cryo is a material whose
   counter has not been built. The proposal argues the second.
3. ~~**Re-price volatile.**~~ **DONE.** §5b: a notch that was an advantage
   violated the ratchet's founding rule. It was a bug in a number, not a missing
   system, and `level.ts`'s `VOLATILE_LOSS_SHARE` is the number: a detonation is
   now billed for the live cargo it destroys. At the belt cap the axis goes from
   16/16 to 10/16 against a 14/16 clean control, on both pilot profiles.
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

- **A pilot that reads the pile.** The largest open item in the ledger. Every
  number here is a floor because of it.
- **A cryo-striking bot.** §5a measures the lance against a pilot that cannot
  strike cryo with a shipment *at all*. A bot that aims its next shot at a
  settled frozen cube would separate "cryo needs a system" from "cryo needs the
  counter-play the game already has" — the same distinction `bots.ts`'s `demo`
  drew for slag, and the reason that bot exists.
- **More seeds on §2.** 8 seeds cannot distinguish a 10%-per-run Tier from a 0%
  one; the wall statistic is what makes the table readable at that sample size,
  and it is a coarse instrument.
- **A positional cushion.** If §6's re-pricing of volatile makes it a real cost,
  the cushion becomes worth measuring for real — and then the field-wide model
  in `counters.ts` has to be replaced with the rear-bay rule it is standing in
  for.
