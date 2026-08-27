# Tetrilaunch simulation harness

Headless tools that drive the real `Game` class (from `../src/game`) outside
the browser. The three questions the first tools here were built to answer:

1. Which hazard ratchets and ship systems make a bay easier or harder?
   (`sweep.ts` still sweeps `mods.ts` variants as a difficulty vocabulary, but
   the game no longer drafts them.)
2. Does a naive "aim at the middle and keep firing" bot clear the early
   bays — and with what margin?
3. How does per-frame physics cost scale with the number of cubes on the
   field?

Everything after those three arrived as one specific number a design argument
needed and could not remember, and each has its own section below: the Mark
ladder (`marks.ts`), the Skydeck's standing-clause stack (`skydeck.ts`), the
congestion tax (`pile.ts` and `pile-metrics.ts`),
whether the non-physics systems are wired up at all (`systems.ts`), whether a
pattern Contract can actually be built (`patterns.ts`), what a human's session
looks like next to a bot's (`playtest.ts`), and whether every screen fits every
device (`uifit/`). `bots.ts`, `runner.ts` and `ratchet-model.ts` are shared
parts rather than CLIs.

This directory lives **outside** `app/src/`, so the app's own build never
bundles it (`app/tsconfig.json` only includes `src`, `capacitor.config.ts`,
`vite.config.ts`), and it's run directly with
[`tsx`](https://github.com/privatenumber/tsx) — transpile + run, no build step.
It is not unchecked, though: `npm run typecheck` makes a second pass over
`sim/` through `tsconfig.sim.json`, which is a separate project rather than
another `include` entry because the harness needs Node's globals and folding
those into the base config would hand them to `src/` too, where a stray
`process.env` would typecheck happily and die in the browser. `npm run build`
gates on that pass, so a type error here does fail the shipped build.

## Running

From `app/`:

```sh
npm run sim:balance -- --bays 1,2,3 --seeds 5 --bots middle,lob,flat,lob-rot --mods all --carry 100
npm run sim:perf -- --counts 50,100,150,200,300,400 --steps 600
npm run sim:renderperf -- --counts 0,100,200,300 --frames 240
```

(the `--` forwards flags through the npm script to the underlying `tsx`
call; you can also invoke directly with `npx tsx sim/sweep.ts ...` /
`npx tsx sim/perf.ts ...` from `app/`.)

`perf.ts` and `renderperf/` are the two halves of one frame — physics and
drawing — and neither is a frame on its own. A budget claim needs both.

Both scripts print markdown tables to stdout and write full per-run JSON to
`sim/results/` (gitignored — see below).

## `sweep.ts` — balance sweep

### Bots (`bots.ts`)

Each bot is a `fixedAimBot(name, angleDeg, power, opts)`: a fixed base
angle/power with bounded, seeded jitter (models a human re-aiming
imprecisely between shots) and an optional random 0-3 quarter-turn spin (or,
for the `lob-flat`/`lob-tall` variants, a *deterministic* rotation to the
piece's min/max-height orientation instead of a random one — see
`MIN_HEIGHT_TURNS`/`MAX_HEIGHT_TURNS` in `bots.ts`). `random`/`random-up`
skip the fixed-base model entirely and sample angle/power uniformly every
shot. Presets:

- `middle` — aim toward the field middle.
- `lob` — high, soft arc toward the back of the bay; never rotates.
- `flat` — low, flat, fast shot.
- `lob-rot` — same arc as `lob`, plus a random 0-3 quarter-turn spin per shot.
- `lob-flat` — same arc as `lob`, but always rotates the loaded piece to its
  minimal-height (flattest) orientation before firing — the deliberately
  GOOD rotation strategy.
- `lob-tall` — same arc as `lob`, but always rotates to the maximal-height
  (standing on end) orientation — the deliberately BAD rotation strategy, for
  measuring the flat/tall spread.
- `random` — uniformly random angle across the full cannon cone
  [-60°, +60°], random power, random rotation. A button-masher robustness
  floor.
- `random-up` — same as `random`, but angle restricted to the upward half of
  the cone [0°, +60°] — a harder "random should never win" case.
- `aim` — adaptive: re-solves its angle every shot against the live wind
  reading (searches 15°-55° via `g.updateTrajectory()`/`g.trajectory`,
  targeting the compaction zone's floor middle), plus the min-height
  rotation strategy — the existence proof that re-aiming beats the wind
  where every fixed-aim preset above must not (see `level.ts`'s
  `windMax`/`windPeriodSec` and `game.ts`'s `windNow`).
- `patient` — `aim` plus the one rule the congestion tax exists to teach: do
  not fire into a bay that is already over the threshold (`AimOpts`'s
  `congestionAware`). It is only interesting *against* `aim` on the same
  seeds — the gap between the two is the tax's whole design claim, which is
  why `pile.ts` runs the pair.
- `impatient` — `aim` minus its restraint: fires on every cooldown, funds
  permitting. The harness's model of "spam pieces and let gravity do the
  rest", and the other end of that same paired comparison.
- `demo` — `aim` plus a pair of hands for the **Demolition Rack**: it scores
  every dead cube on the field as a blast site, aims a charge with the same
  search it aims cargo with, and fires when the blast nets `DEMO_MIN_NET`
  dead cubes. The only bot here that can answer a MATERIAL, and the one that
  closes this harness's longest-standing caveat — see below. Identical to
  `aim` on a rig carrying no charges, so it is only meaningful *against*
  `aim` on the same seeds and the same rig: the gap between them is what a
  charge is worth.

No lookahead, no trajectory awareness — these approximate "hold roughly the
same aim and keep firing," not a strong player.

#### Valuing a blast (`demo`)

`demo` scores a candidate site as **dead cubes caught, minus live cubes caught
in rows nothing is blocking** — no invented weights. The row clause is the
whole trick and the first version lacked it: counting every live cube as a loss
reads a packed pile as a terrible place to bomb (the blast spans ~2.4 cells, so
four slag against fourteen live scores −10 however jammed the bay is), and the
bot fired **one** charge across six bays holding six apiece. That would have
measured "a rack is worth nothing" when what it measured was a valuation that
ignores what slag does. A row containing slag can never clear, so the cargo
sharing it is already spent and destroying it costs nothing; only a live cube
in a *clean* row is the "row you were two cubes from closing" the design warns
about. With the clause in, the same rig fires 5 charges a bay and takes a
2-notch slag bay from 1.8 lines to 7.0.

It deliberately does **not** dig for buried cargo, and does **not** model tar —
which joints are welds is private to `Game`, and a proxy here would measure the
proxy. It is a competent pair of hands, not an optimizer.

### Baseline table

For each `(bay, bot)` pair, across `--seeds` reproducible seeds:

| Column | Meaning |
|---|---|
| Bay | 1-based bay number (`makeBaseLevel(bay-1, mark)` — see `--mark`) |
| Bot | bot preset name |
| N | number of seeds run |
| WinRate | fraction of seeds that reached `targetScore` |
| MedianSecs(win) | median in-game clock time of **winning** runs only (n/a if no wins) |
| MeanShots | mean pieces/bombs fired, all runs |
| MeanLines | mean lines cleared, all runs |
| Losses | breakdown of non-win outcomes: `topout` (stacked to the ceiling), `broke` (out of funds and nothing left to rescue it), `time` (clock ran out), `cap` (hit the sweep's own step cap while still "playing" — a safety net, should be rare) |

Every sweep runs at ONE tier (`--mark`, default 1). The tier ladder
(`level.ts`) sets `targetScore`, `timeLimitSec` and `launchCost` per Mark —
$600/180s/$20 at Tier 1 through $780/144s/$30 at Tier 10 — so two sweeps only
compare at the same Mark, and the header banner prints it.

Each bay is its own economy (`targetScore`, `launchCost`, and `scorePerLine`
are all per-bay, not cumulative — see `level.ts`'s economy balance note; only
the target also steps per bay, by an amount the tier sets), and only the
SURPLUS a real run banked above the just-cleared bay's target carries forward (`run.ts`'s `advanceRun`/`levelForRun`,
`RunState.carry`), not the whole ending score. The sweep doesn't play a full
run end-to-end, so it can't compute a real per-seed surplus; instead, bays 2+
start with `startingFunds` bumped by a flat `--carry` amount (default `100`,
a typical one-line overshoot) on top of the base level's own float. `--carry
0` models a bay entered with no cushion at all (e.g. a bay cleared right at
target); a larger value models a run that's been overshooting comfortably.

### Mods table

Only produced when `--mods` isn't `none`. `--mods` is a two-level grammar:
comma separates independent **variants**, and within one variant, a
`+`-joined group (e.g. `half+overclock`) stacks those mods together into a
single variant, applied via `applyMods(base, [id1, id2, ...])` — exactly the
way the retired modifier draft stacked two picks. `--mods
half+overclock,premium` is two variants: `[half, overclock]` stacked, and
`[premium]` alone. `--mods all` still expands to one variant per mod (no
stacking) — every `ModDef` in `mods.ts`, unstacked. Every id in every group
is validated up front; an unknown id anywhere aborts with an error listing
the available ids.

Each variant is run on bay 1 and bay 2, the same way as baseline, then
compared against that same `(bay, bot)`'s baseline. The Mod column shows the
variant's joined name (its mod ids joined with `+`; a single-mod variant just
shows its bare id):

- `ΔWin` = variant winRate − baseline winRate
- `ΔSecs-saved` = baseline median winning-secs − variant median winning-secs
  (positive = the variant's winning runs finish faster)

**Ease score (CRUDE, read the caveat):** per bot,
`ΔwinRate*100 + clamp(ΔSecs-saved, -60, 60) / 2`, then averaged over bots to
get `Ease(bay1)` / `Ease(bay2)`, and those two averaged again for
`Ease(avg)` — the column the table is sorted by, easiest mod first. This is
a single scalar squashing two very different signals (survival odds and
clear speed) with an arbitrary weight and clamp; it's meant to give a rough
ranking to eyeball, not a rigorous difficulty metric. Always look at the raw
`ΔWin`/`ΔSecs-saved` columns (or the JSON) before trusting it. If a bot never
wins in either the baseline or the mod at a given bay, the secs term is
treated as `0` (no signal) rather than `n/a` propagating through the mean.

### Reproducibility

The sweep runs one `(bay, bot, seed)` combination **twice** at the very
start and diffs the two `BayOutcome`s byte-for-byte, printing a PASS/FAIL
line. The whole harness assumes `Game` is deterministic given the same
inputs (no `Math.random` anywhere in `src/game` — confirmed by grep — only
the seeded `mulberry32` from `mods.ts`, reused here for bot jitter); this
check is a standing tripwire on that assumption, not a one-off.

### Defaults

`--bays 1,2,3`, `--seeds 5`, `--bots` = all eleven presets (every key of
`BOTS`, not a shortlist). `--mods` has no single obvious literal default (it's
a three-way switch: `all|none|list`), so it defaults to `all` — which dates
from when modifier balance was this tool's headline purpose. The game no longer
drafts modifiers (`hazards.ts`'s axis ratchet replaced them, and nothing in
`app/src` imports `mods.ts` except `mulberry32`), so what the mods table is now
is a difficulty VOCABULARY: it still says how much a given change to a bay is
worth, which is what makes it useful for pricing a hazard notch, but no
`ModDef` in it reaches a player. Pass `--mods none` for a baseline-only run.
`--carry` defaults to `100`.

## `marks.ts` — Mark calibration

The sweep the Mark ladder cannot be tuned without. It builds a rig with the
FULL Mark-N upgrade budget (`budgetForMark`, spent several different ways by
`ARCHETYPES`), flies it at the sim bot's competence on that Mark's own bays,
and asks the one question `docs/DESIGN.md` states the ladder in terms of: does
the best build at a Mark fall JUST SHORT?

```sh
npx tsx sim/marks.ts --marks 1,3,6,8,10 --seeds 5 --ratchets spread
```

- clears comfortably → the Mark is free, and every board above it is easier
  than the one below
- can't clear at all → the Mark is impossible, however well played
- falls just short → correct: the gap is what player skill fills

The headline column is the implied RUN clear rate, not the per-bay win rate. A
run must take all ten bays, so 90% a bay is only ~35% of runs, and the per-bay
figure reads far more forgiving than the ladder actually is.

`--ratchets` (`--notches`, the spelling the flag first shipped under, is
accepted as a legacy alias, and `--ratchets` wins if both are passed; every
other spelling is on its own, because `argv.indexOf` is an exact match, so a
misspelt flag is matched by nothing and silently leaves the default in place)
picks what the rig is flown against. `none` is stock bays, which measures the
SHIP. `spread` models what a Deep Run actually forces: one ratchet pick per
cleared bay, two at the capstone Mark, spread round-robin over the number axes
the Mark deals — see `ratchet-model.ts` below. Only `spread` prices the ladder
a player meets.

`aim` is the default bot because it is the strongest one here; calibrating
against a weak bot would read every Mark as impossible and drag the whole
ladder down to trivial. Two caveats bias every number here PESSIMISTIC, and
both are inherited from the bots: they never fire Bond Breaker or Demolition,
so those tracks measure as worthless and bomb-carrying builds are undersold,
and they hold an arc rather than reading the pile. A human clears bays these
bots lose.

## `skydeck.ts` — the daily run's clause stack

The sweep the Skydeck (`src/game/skydeck.ts`) cannot be shipped without. That
mode changes three things about a Mark-10 Deep Run — no refit stops, one notch
a bay instead of two, and three *standing* Final clauses instead of one — and
the first two make it easier while the third makes it harder. Nothing about
that trade can be asserted.

```sh
npx tsx sim/skydeck.ts --mark 6 --bays 1,4,7,10 --seeds 3 --stops all --rigs economy
npx tsx sim/skydeck.ts --mark 10 --days 14
```

Every row is the best of the rigs flown, exactly as `marks.ts` judges a Mark by
its best build. Two controls print above the rest: the shipped **ladder** run at
the same Mark (refits, two notches, one clause on bay 10), and the Skydeck
**bare** — the mode with the clauses taken out, which is what isolates the
clause stack from the two rules that make the mode easier.

`--stops all` flies every combination the bands can deal (80 at the shipped
bands) and reports the worst, median and best day plus a per-clause report card.
The worst day is the number that decides whether a band is sized right; an
average hides exactly that. `--days N` is the cheaper sample — the next N real
days, i.e. what a player will actually meet.

**`--mark` defaults to 10 and 10 is where this instrument has no resolution
left.** `docs/DESIGN.md` publishes Mark 10 at 0% run-clear with the `aim` bot
and a spread ratchet, and says why. A control already on the floor cannot say
whether a change pushed it further down, so price the STACK at `--mark 6`
(16% in that same table) and read the Mark-10 rows for the sign rather than the
size. Both are worth printing; the commit that added the mode quotes both.

The usual pessimism applies and bites hardest here: no bot fires a Bond Breaker,
only `demo` fires a charge, and fixed arcs never read the pile — so every row
carrying a standing MATERIAL clause is a floor. That bias is also what found the
mode's one hard rule: a slag clause took bays 7 and 10 to 0% and stayed there,
which is `theme.ts`'s `countsForLines` showing up as a measurement, and
`skydeck.ts` now refuses to deal dead cargo as a standing rule at all.

## `pile.ts` — congestion-tax sweep

The three questions `level.ts`'s `PILE_TIERS` cannot be tuned without.

```sh
npm run sim:pile -- --census --seeds 16
npm run sim:pile -- --bays 1,3,5,8,10 --marks 1,3,5 --bots aim,patient
```

1. **Census** (`--census`, and printed first in every run). How many cubes does
   a bay actually hold, moment to moment, with no tax applied at all? Whether
   the proposed 32 and 48 thresholds mean "a bay you let get away from you" or
   "every bay after the first minute" is a measurement, not a judgement call:
   if a clean bot sits over 32 for most of its shots, the tax is not an
   anti-spam rule, it is a flat rate rise with extra steps. This is the run
   `docs/ECONOMY.md` quotes its field sizes from.
2. **Bite.** With the tax on, what fraction of shots pay it, how much money and
   clock it actually takes, and whether the bay still resolves.
3. **Counter-play** — the one every other sweep in this directory structurally
   cannot answer, because each bot fires the moment cooldown and funds allow,
   so any cost on firing reads to it as pure loss. `patient` is `aim` plus a
   single rule (do not fire while the bay is over the threshold), and the gap
   between the two IS the design's claim: if `patient` beats `aim` under the
   tax, the tax teaches something; if both just lose, it is a difficulty knob
   wearing a lesson's clothes.

Every variant runs against an `off` baseline on the same seeds, so each row is
a paired comparison rather than an absolute number.

## `pile-metrics.ts` — which congestion METRIC?

The census came back with an uncomfortable answer, and an uncomfortable answer
about a threshold may mean the METRIC is wrong rather than the number. The
suspicion this script tests: total cube count is dominated by the SETTLED PILE,
and the settled pile is not spam — it is the game. Rows only sell when the
press closes on a full one, so a player doing everything right still sits on a
deep pile, and a tax on that is a rate rise.

```sh
npx tsx sim/pile-metrics.ts --bays 1,5,10 --seeds 6
```

So it measures five candidate readings at every shot — `total` (what
`PILE_TIERS` reads today), `settled` (cubes at rest, the pile proper), `moving`
(the direct signature of firing again before the bay has resolved), `outside`
(cargo on the launcher side of the compactor face, the signature of firing
wildly) and `inflight` — for a clean bot and a spam bot on the same seeds, and
asks of each how far apart the two distributions are. Separation is reported as
the fraction of SPAM shots a threshold would tax when that threshold is set to
tax only 10% of CLEAN shots. The 10% is arbitrary but fixed across metrics,
which is what makes the column comparable: it asks every metric to be equally
gentle on good play and then scores it on how much bad play it still catches.

## `systems.ts` — systems smoke test

Both `npm test` and `npm run sim:systems` are this file. It drives the
NON-physics systems headlessly — piece sizes, ship upgrades, refit stops, the
scrap/salvage economy, the hazard ratchet and its Fibonacci ladders, demolition
charges, the layout solver — and asserts the invariants that would otherwise
only be checked by playing. Deliberately not a balance sweep (that's `sweep.ts`)
and not a perf test (`perf.ts`): it answers "are these systems wired up
correctly and do their numbers compose the way the design says", which is the
class of bug a balance sweep passes straight over. It is also the cheapest
guard the numbers in `docs/` have: it imports the real constants
(`TARGET_BASE`, `LAUNCH_COST_BASE`, `COST_LADDER`, `TIME_LADDER` and the rest)
and asserts on what they compose to, so a re-shaped ladder fails here in
seconds rather than in a doc nobody re-derived.

## `patterns.ts` — pattern Contract audit

`systems.ts` asserts the invariants that must hold on every build; this is the
other half — a sweep that MEASURES how the pattern generator behaves across the
whole space it can emit, so the numbers behind those invariants can be
re-derived rather than remembered.

```sh
npm run sim:patterns
npm run sim:patterns -- --seeds 3000 --tiers 5,6,7 --orders 200
```

It exists because "provably feasible" turned out to have two meanings and the
generator only guaranteed the weaker one. `tiling.ts` proves the inventory
PACKS the goal rectangle; it says nothing about whether those pieces, arriving
one at a time in a shuffled order into a bay with gravity, can be assembled
into that packing — and that is the question the player is actually asked. The
columns are `packs` (tiling's guarantee), `drop%` (the share of arrival orders
finishable landing each shipment straight down: the strict reading, and how a
player reasons about the bay) and `tuck%` (the share finishable if a shipment
may come to rest in any pocket it fits: the generous reading, an upper bound on
what the arc, the tumbling and the press's sideways shove can buy).

## `playtest.ts` — a human's session, not a bot's

```sh
npx tsx sim/playtest.ts path/to/tetrilaunch-playtest-*.json
```

Reads a session exported by `lib/telemetry.ts` (`__playtest.download()` in the
browser console) and prints the numbers no sweep here can produce, because they
all depend on how a human actually plays. The first one is the reason the file
exists: **is a human ever cooldown-bound?** The bots fire the instant the
cooldown clears, so MAGAZINE reads to them as pure throughput and a full rig
LOSES to a stock one by bankrupting itself firing — but if a human's aim time
routinely exceeds the cooldown, the cooldown never binds and the track is worth
nothing to them either, which would be a real finding about something we sell.
Then: a human's shots-per-line, which sets the whole economy and which every
balance number derived from the bots inherits the bots' badness at; whether the
clock binds at all; how close to broke a bay really came, which an
end-of-bay total hides; the abilities the bots never use; and the compactor
window, which a shot count cannot see because "aim time" is two behaviours —
aiming, and waiting for the bar — wearing one number.

## `ratchet-model.ts` — the difficulty model the sweeps share

Not a CLI, and deliberately not in `src/game`. `marks.ts` and `pile.ts` both
need "the ratchets a Mark-M run is carrying by the time it reaches bay B", and
in the real game there is no such thing: ratchets are DRAFTED, so this is a
model of an average run, and a model is exactly the kind of thing that must not
leak into the game's own rules. It lives in its own file because two sims need
it and a difficulty model copied into two places is how a sweep ends up
describing a game that no longer exists.

It is what makes `--marks` mean more than the tier ladder alone. `makeBaseLevel`
already moves the bay's target, clock, launch cost and bond strength with the
Mark, but a run at bay 5 is also carrying four bays' worth of notches, and
without a model the sweep would fly a Mark-10 bay that nobody had ever
ratcheted. Content axes are excluded: the bots own no answer to a material —
none of them ever fires a demolition charge, which is slag's only exit — so
including them would measure "bots cannot play slag" rather than the ladder.

**Read every `--ratchets spread` number as an upper bound.** The exclusion is a
real blind spot and it sits exactly where a high-Mark run gets hard: three bays
a run (`MATERIAL_DRAFT_BAYS`) deal a hand the player cannot answer with a
number, so the modelled run is one nobody flies. Measured on the same rig and
bay, that gap is the whole result — Tier 10 bay 5 takes **83%** of bays with the
number axes alone and **8-17%** once the materials a run would really be
carrying are on the belt, with every single loss to bankruptcy rather than
topping out.

The half of that caveat which said *nothing here measures whether a
bomb-carrying player clears those bays* is now false: `demo` does. What is still
true is that **this model** excludes content axes, so a `spread` number prices
the ladder's arithmetic and not its cargo. To price a material, ratchet it
explicitly and fly `aim` against `demo` on a rig that carries charges.

## `perf.ts` — physics step-cost sweep

For each cube count `N` in `--counts`, builds a fresh bay-1 `Game`
(`timeLimitSec` forced to `0`) and hand-places `N` cubes (mirroring
`pieces.ts`'s body options exactly: `CELL` size, `friction .5`,
`frictionAir .012`, `restitution .05`, `density .001`, `chamfer 3`,
`label "cube"`) in two shapes:

- **loose**: `N` independent cubes, no joints — a packed grid filling the
  field's right half, ±2px jittered so it isn't a perfect stack.
- **cliques**: the same `N` cubes, grouped into 4-cube cliques (2×2 blocks),
  every pair within a clique joined by a distance constraint (6 joints per
  full clique — the same fully-connected topology `createTetrisPiece` uses
  for a real tetromino), stiffness taken from the level's `jointStiffness`.

After a 60-frame warmup (not timed), the next `--steps` calls to
`g.update()` — the same per-frame call the real game drives — are timed
individually with `process.hrtime.bigint()`. Reported per `(variant, N)`:
avg ms, p95 ms, worst ms, and % of steps over the 16.67ms (60fps) frame
budget. Ends with a one-line verdict per variant: the largest `N` whose p95
stays under 8ms (half the frame budget, leaving headroom for render/input on
top of physics).

### Sleep occupancy

The `% asleep` column is the share of cube-steps spent sleeping across the
timed window, and it exists to answer a question the timings cannot:
`engine.ts` turns `enableSleeping` on against a measured on-device profile
(narrowphase + solver over the resting pile was ~73% of the frame loop), but
nothing showed whether the bodies in a real pile ever reach the state Matter
skips.

They do not. matter-js 0.20's `Constraint.postSolveAll` calls
`Sleeping.set(body, false)` for every body whose `constraintImpulse` is
non-zero that step, and a shipment is a K4 clique of six stiff distance
joints carrying a residual impulse indefinitely. So the **loose** rows sleep
much of their cube-steps and the **cliques** rows — the ones shaped like real
cargo — sit at zero. The run prints a `NOTE` when they do.

No fix is proposed, deliberately: every candidate (a lighter joint topology,
retiring joints under a settled piece, zeroing small impulses) changes how
the pile behaves under load, which is a gameplay decision rather than a perf
one.

**Judgment call:** a sufficiently large, densely packed `N` can legitimately
trip the real game's topout/broke/time loss conditions (e.g. 400 cubes
packed into the right half physically has to stack above the topout line at
y=96) — but `Game.update()` no-ops once `status !== "playing"`, which would
silently zero out every remaining timed sample and corrupt the benchmark.
Since this harness measures steady-state per-step physics cost, not win/loss
rules, `status`/`lossReason` are forced back to `"playing"`/`null`
immediately **after** each timed call (never inside the timed window, so it
never affects the measurement itself).

## `renderperf/` — render-cost sweep

The other half of a frame. `perf.ts` times `Game.update()` in node, with no
canvas at all; this drives the real `render()` into a real Chromium 2D
context, on the same scene shapes (`placeLoose`/`placeCliques` mirror
`perf.ts` exactly, so an `N` here and an `N` there mean one pile).

A browser is the point rather than an inconvenience. Everything expensive
`render.ts` does — `shadowBlur`, gradients, glyph rasterisation, `drawImage`
of a cached sprite — is work a rasteriser does, and node has none. A pure-JS
canvas shim would measure the JavaScript around the draw calls and nothing
about the draw calls themselves.

Three modes:

- **default** — a sweep over `--counts` × `{loose, cliques}` × `{idle, busy}`
  (busy adds the aim arc and one of every FX kind). Reports avg / p50 / p95 /
  worst and % of frames over the 16.67ms budget.
- **`--breakdown`** — a ladder that adds one scene layer at a time and reports
  the delta, so a frame's cost is attributed without instrumenting `render.ts`
  (instrumentation would have to ship in the module under test).
- **`--snapshot`** — an FNV-1a digest of the frame plus `cargoPx`, the count of
  device pixels that differ from the same scene with an empty cube list.
  `--shots` writes PNGs under `sim/results/renderperf/<tag>/` so two branches
  can be diffed pixel by pixel.

**The digest mode is not a nicety.** A render optimisation that draws FEWER
pixels is indistinguishable, to a timer, from one that draws the WRONG pixels,
and the wrong ones are always faster — an early attempt at hand-rolling
`drawCube`'s transform got the inverse wrong, launched every cube off-screen,
and reported a 74% speedup. `cargoPx` catches that specific shape of mistake:
a digest change with `cargoPx` near zero is a vanished pile.

**Caveat, stated in the file too:** headless Chromium rasterises in software.
These are before/after numbers on one machine and a ranking of draw paths, not
a device budget. They are also worthless on a loaded machine — check the run
is alone before trusting a delta.

## `uifit/` — does every screen fit every device?

The only harness here that runs a browser besides `renderperf/`. `systems.ts` checks the layout
solver's *arithmetic*; `uifit` checks what that arithmetic plus
`src/styles/app.css` actually **lay out** in a real engine, at real device
viewports with real landscape safe-area insets.

```
npm run test:uifit                      # Chromium, assert against the baseline
npm run test:uifit:shots                # ...and write a PNG per device x screen
npx tsx sim/uifit/run.ts --engine=webkit           # closest cheap proxy for iOS
npx tsx sim/uifit/run.ts --screen=menu --device=SE # narrow a single failure
npx tsx sim/uifit/run.ts --update-baseline
```

It renders the **real** screen functions from `src/ui/screens.ts` into the
**real** stylesheet — no mock markup — and drives the same `computeLayout` +
`applySafeAreaInsets` path `main.ts`'s `onResize` does. Insets are faked by
overriding `env(safe-area-inset-*)` in a stylesheet rule that the app's own
`.safe-probe` then measures back, so the iOS inset plumbing is exercised
rather than stubbed.

**The matrix has two halves.** Thirteen handset/tablet rows with a coarse
pointer and real landscape insets, and six `platform: "web"` rows with
`pointer: "fine"` and none. The pointer is not a detail: `@media (pointer:
fine)` is a structural switch in `app.css` — it hides the rail's game buttons,
changes what the rail asks the layout solver to budget, and is the only
condition under which the keyboard hint strip is drawn at all. While every row
was coarse, a whole control surface existed in no test, which is how a hint
strip centred on the window instead of on the field shipped. The web rows are
picked to cover all three layout modes, and deliberately include the everyday
16:9/16:10 laptop sizes, where the solver goes `snug` and reserves an 84px
right band: the field's centre and the window's centre are 42px apart there,
so anything anchored to the wrong one is off by exactly that much on the most
common window there is — and dead centre on the ultrawide row, which is what
makes the class of bug so easy to miss by eye.

One assertion per row of `run.ts`'s `ASSERTIONS`, run on every device x screen.
The load-bearing one is `scrollers`: `ALLOWED_SCROLLERS` is the single place
the product rule *"no vertical scrolling except the leaderboard rows and the
workshop pane"* is written down, and a third entry cannot appear without
someone editing that list on purpose.

Five of them are about content that is **present, unclipped, inside the
viewport and still not on screen** — the class of defect the fit/overflow
assertions are structurally blind to, because nothing about it overflows
anything:

| assertion  | catches |
|------------|---------|
| `clipped`  | a box that fits itself but is sliced by an ancestor's overflow edge — the mods row's ×N badge, cut 2px by the row's own scroll clipping |
| `overlap`  | two boxes laid out to sit *beside* each other covering each other — the tutorial card spilling over the plant readout |
| `draghint` | the onboarding gesture animating underneath the plant panel, which is `z-index: 6` while the hint is not |
| `reveal`   | the tutorial's step-0 progressive reveal, whose `display: none` rules are weak enough that any later rule of equal weight silently un-hides a block |
| `kbdhint`  | the desktop key-hint strip anchored to the viewport rather than to the solved field — 42px off centre and up to 69px adrift below it on an ordinary laptop window, while looking perfect on ultrawide |

When adding one, reintroduce the defect it guards and confirm the assertion
**fails** before trusting it — every one of the five above was proven that way,
and the numbers quoted in their comments are what the failing run reported.

**What the baseline currently holds.** 139 entries, measured across 19 devices
x 60 screens (re-run at this commit). 110 of them are one defect wearing ten
device names: #86's tier tower stacks eleven floors — ten Marks plus the Skydeck — down
a landscape phone, and every `.tower__floor` button comes out between 23px and
32px tall against the 44px tap floor, on every handset row x every menu
fixture. (`.tower__sub`, Tier S's plate under the slab, fails with it at 26px
on the fixtures that show it.) It is baselined rather than fixed because
eleven 44px floors need 484px of column and no handset row here is that tall,
so what closes it is a decision about the tower rather than a padding value.

The remaining 29 are the one `Web · 800x600 window` row — a browser window
dragged genuinely small. They are real (a `.draft__body` that needs up to 230px
more height than it has, `#refit-preview` scrolling behind the fold, the
bond/demo chips 1px under the tap floor at 47x43, badges 0.01em under their air
floor, and the tower again at 38-42px), and they are the honest cost of adding
the row: it is also the only row narrow enough to prove the hint strip's width
bound, and a bound nothing tests is not a bound. Eight rows are clean — the
three tablet rows and the five larger web rows.

**The baseline.** `uifit/baseline.json` records the violations that exist
today, keyed `device|screen|assertion`. A run fails on violations NOT in it,
and *also* fails when a baselined violation stops reproducing without being
removed — so the file shrinks as the responsive work lands and cannot rot
into a blanket suppression. Re-record with `--update-baseline` and commit the
diff; that diff is the progress report.

**Playwright is pinned exactly** (not `^`) in `package.json`. Every number
this harness reports is a text-measurement result, so a browser upgrade
shifts the baseline for reasons that have nothing to do with the app.

**Chromium is not WKWebView.** The `--engine=webkit` run is the closest cheap
proxy for iOS and skips cleanly (exit 0, with a message) when the browser
binary is absent, because claiming iOS coverage we do not have would be worse
than not running it. It asserts against its own `baseline.webkit.json`: every
number in a baseline entry is a text-measurement result of one engine's
rasteriser, so a WebKit run judged against the Chromium-recorded file could
never be green even with nothing wrong. The engine has to be part of the key,
and a file per engine is that key.

`uifit/crest-shots.ts` (`npm run sim:crest`) borrows this harness — real
`app.css`, real `hudHTML`, real layout vars — to shoot the plant panel at a few
values of `--crest-heat` and the `--h0..--h6` rotation, so the audio colour path
can be eyeballed without a soundtrack or a gesture. It asserts nothing and is
not part of `npm test`; it just makes pictures.

## Extending

- **New bot preset**: add an entry to the `BOTS` record in `bots.ts` — a
  `(seed) => fixedAimBot(name, angleDeg, power, opts)` factory (rebuilt per
  run so jitter is reproducible per seed). Then pass its name via `--bots`.
- **New mod in the sweep**: nothing to do — `sweep.ts --mods all` (or an
  explicit `--mods your-id,...`) picks up any `ModDef` added to `MODS` in
  `../src/game/mods.ts` automatically, as long as its `id` is unique.

## Results directory

`sim/results/*.json` is gitignored (`sim/results/.gitignore` keeps the
directory itself tracked while ignoring its contents) — sweep/perf output is
regenerated on demand, not committed.
