# Tetrilaunch simulation harness

Headless tools that drive the real `Game` class (from `../src/game`) outside
the browser, to answer three questions:

1. Which drafted modifiers (`mods.ts`) make a bay easier or harder?
2. Does a naive "aim at the middle and keep firing" bot clear the early
   bays — and with what margin?
3. How does per-frame physics cost scale with the number of cubes on the
   field?

This directory lives **outside** `app/src/`, so it is invisible to
`tsc`/`vite` (`app/tsconfig.json` only includes `src`, `capacitor.config.ts`,
`vite.config.ts`) — `npm run build` never sees it. It's run directly with
[`tsx`](https://github.com/privatenumber/tsx) (transpile + run, no build
step, no type-checking gate — a typo here can't break the shipped build).

## Running

From `app/`:

```sh
npm run sim:balance -- --bays 1,2,3 --seeds 5 --bots middle,lob,flat,lob-rot --mods all
npm run sim:perf -- --counts 50,100,150,200,300,400 --steps 600
```

(the `--` forwards flags through the npm script to the underlying `tsx`
call; you can also invoke directly with `npx tsx sim/sweep.ts ...` /
`npx tsx sim/perf.ts ...` from `app/`.)

Both scripts print markdown tables to stdout and write full per-run JSON to
`sim/results/` (gitignored — see below).

## `sweep.ts` — balance sweep

### Bots (`bots.ts`)

Each bot is a `fixedAimBot(name, angleDeg, power, opts)`: a fixed base
angle/power with bounded, seeded jitter (models a human re-aiming
imprecisely between shots) and an optional random 0-3 quarter-turn spin.
Presets: `middle`, `lob`, `flat`, `lob-rot`. No lookahead, no trajectory
awareness — these approximate "hold roughly the same aim and keep firing,"
not a strong player.

### Baseline table

For each `(bay, bot)` pair, across `--seeds` reproducible seeds:

| Column | Meaning |
|---|---|
| Bay | 1-based bay number (`makeBaseLevel(bay-1)`) |
| Bot | bot preset name |
| N | number of seeds run |
| WinRate | fraction of seeds that reached `targetScore` |
| MedianSecs(win) | median in-game clock time of **winning** runs only (n/a if no wins) |
| MeanShots | mean pieces/bombs fired, all runs |
| MeanLines | mean lines cleared, all runs |
| Losses | breakdown of non-win outcomes: `topout` (stacked to the ceiling), `broke` (out of funds and nothing left to rescue it), `time` (clock ran out), `cap` (hit the sweep's own step cap while still "playing" — a safety net, should be rare) |

Bays 2+ start with `startingFunds` set to the previous bay's `targetScore`,
emulating a bankroll carried over from clearing the prior bay in a real run
(mirrors `run.ts`'s `advanceRun`/`levelForRun`).

### Mods table

Only produced when `--mods` isn't `none`. Each mod is drafted **alone**
(`applyMods(base, [modId])`) on bay 1 and bay 2, run the same way as
baseline, then compared against that same `(bay, bot)`'s baseline:

- `ΔWin` = mod winRate − baseline winRate
- `ΔSecs-saved` = baseline median winning-secs − mod median winning-secs
  (positive = the mod's winning runs finish faster)

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

`--bays 1,2,3`, `--seeds 5`, `--bots` = all four presets. `--mods` has no
single obvious literal default (it's a three-way switch: `all|none|list`),
so it defaults to `all` — modifier balance is this tool's headline purpose.
Pass `--mods none` for a baseline-only run.

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

**Judgment call:** a sufficiently large, densely packed `N` can legitimately
trip the real game's topout/broke/time loss conditions (e.g. 400 cubes
packed into the right half physically has to stack above the topout line at
y=96) — but `Game.update()` no-ops once `status !== "playing"`, which would
silently zero out every remaining timed sample and corrupt the benchmark.
Since this harness measures steady-state per-step physics cost, not win/loss
rules, `status`/`lossReason` are forced back to `"playing"`/`null`
immediately **after** each timed call (never inside the timed window, so it
never affects the measurement itself).

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
