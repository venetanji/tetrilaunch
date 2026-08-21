# Balance pass: the congestion build, every tier

**For:** a long-running, goal-oriented session (cloud, overnight).
**Branch:** `claude/bay-cleared-screen-ux-klz9n3` — PR #40, base `staging`.
**Baseline commit:** `59dcca1`.

The goal is one sentence: **decide whether the numbers changed on 2026-08-21/22
are right, using the sim, at every tier — and fix the ones that are not.**

---

## 1. What changed, and therefore what is unmeasured

Nine commits landed in one local session. Every number below was reasoned
about and none of it was swept. That is the whole job.

| area | before | now | commit |
|---|---|---|---|
| Salvage income, 10 tiers | 1500 (60 +20/tier) | **600** (flat 60) | `c6af310` |
| Salvage shelf (live sink) | 325 | **445** | `c6af310` |
| Install prices | 15/15/25/30/30/40/40 | **15/15/30/50/50/70/70** | `c6af310` |
| Congestion tax | off in every bay | **on** (32 → 1.5×, 48 → 2×) | `0af6c14` |
| Congestion clock burn | — | 2s / 5s per launch | `aa33143` |
| Congestion reload | — | **×1.5 / ×2** | `59dcca1` |
| Congestion combo | — | **crossing up ends the streak** | `HEAD` |
| Base reload | 900ms | **1350ms** | `59dcca1` |
| Joint break stretch | 1.7 → 2.78 | **2.2 → 4.4** | `59dcca1` |
| Ratchet ladders | start at rung 0 always | **start at `mark - 1`** | `59dcca1` |
| Bay Extension | +cells | **+cells, +4 congestion allowance/tier** | `ca47f21` |

Five of these interact in the same direction — congestion now costs money AND
clock AND reload AND the combo streak, while the reload baseline also went up.
Nobody has checked that the stack is survivable. The combo break is the one to
watch hardest: it is multiplicative on income where the others are additive on
cost, so it may be doing far more damage than its one line suggests.

---

## 2. THE BLIND SPOT — read this before trusting any number

Both `sim/marks.ts` and `sim/pile.ts` say it in their own headers, and it
invalidates the most obvious way to test this build:

> **Every bot fires the instant cooldown and funds allow.**

Consequences, all load-bearing:

- **The reload penalty is invisible to the bots as a deterrent.** A human
  facing ×2 reload waits, reconsiders, maybe stops firing. A bot just fires
  later. So a sweep will show the reload tax costing *throughput* and will show
  **zero behavioural response** — it cannot tell you whether the deterrent
  works, only what it costs someone who ignores it.
- **Congestion counter-play cannot be measured by bots at all.** The whole
  design rests on "stop firing, let the compactor work, pay nothing". No bot
  in this repo will ever do that.
- **`MAGAZINE` reads as pure throughput** to bots and a full rig can lose to a
  stock one, because the bot bankrupts itself firing.
- The **combo break is the exception** — bots do clear lines, so they do build
  and lose streaks. This one the sim CAN measure, and it is the change most
  likely to move the economy, being multiplicative rather than additive.
  Sweep income per bay with and without it.

**Therefore:** use the sim to establish *floors and ceilings* — is a bay
winnable at all, does the tax ever trigger, does a Mark stay just-short — and
do **not** use it to conclude that a deterrent works. Where a question needs
human behaviour, say so in the report and leave it for a device playtest
(`sim/playtest.ts` reads an exported telemetry session).

---

## 3. Run order

Cheap gates first — they fail in seconds and everything downstream assumes them.

```bash
cd app
npm run typecheck && npm run test && npx tsx sim/uifit/run.ts
```

### 3.1 First question, unfinished from the last session

Does the 1350ms cooldown bind before funds do? I started this and did not
finish it. For bays 1, 5, 10 compare `startingFunds / launchCost` (shots the
bankroll allows) against `timeLimitSec * 1000 / cooldownMs` (shots the clock
allows). If the clock number is the smaller one, the reload change silently
became a *clock* nerf and the congestion reload multiplier stacks on top of
that. Report both numbers per bay before doing anything else.

### 3.2 Census before bite

```bash
npx tsx sim/pile.ts --census --bays 1,3,5,8,10 --seeds 6
```

The thresholds are 32 and 48 cubes. `pile.ts` states the test exactly: if a
clean bot sits above 32 for most of its shots, **the tax is not an anti-spam
rule, it is a flat rate rise with extra steps.** That would mean raising the
thresholds, not tuning the multipliers.

Known counter-evidence to weigh against the census: a stock bay 1 has
$200 at $25 a launch = 8 shots × 4 cubes = **exactly 32** — one cube short of
ever triggering tier 1 without line-clear income. Tier 1 may currently be
unreachable in bay 1 and trivially reachable in bay 10. Both ends are wrong;
find where it actually bites.

### 3.3 Bite and survivability

```bash
npx tsx sim/pile.ts --bays 1,3,5,8,10 --seeds 6
npx tsx sim/sweep.ts --bays 1,3,5,8,10 --seeds 8
```

Watch for: bays that stop resolving at all, and losses that shift from
`broke`/`time` to something the tax authored. A bay the tax kills is a bay the
tax mis-priced.

### 3.4 Every tier — the headline

```bash
npx tsx sim/marks.ts --marks 1,2,3,4,5,6,7,8,9,10 --bays 1,4,7,10 --seeds 3
```

The pass condition is `marks.ts`'s own, and it is **not** "the bot wins":

- clears comfortably → the Mark is free
- cannot clear at all → the Mark is impossible
- **falls just short → correct**; the gap is what player skill fills

Quote the implied **run** clear rate, not the per-bay rate. 90% per bay is
~35% of runs across ten bays, and the per-bay figure reads far more forgiving
than the ladder is.

The ratchet ladder now starts at `mark - 1`, so **higher Marks are hit twice**:
harder base bays *and* a more expensive first notch. `marks.ts` is the only
harness that will show whether that double-count is fatal.

### 3.5 Joints

`2.2 → 4.4` was chosen by feel on a phone, not measured. Pieces now mostly
survive landings. Check via `sweep.ts` whether shots-per-line moved: stiffer
cargo that no longer shatters should *help* line-building, which may have
quietly made bays easier and offset the congestion tax. If shots-per-line
dropped materially, the economy moved and §3.4's verdict is about a different
game than the one that was tuned.

### 3.6 Performance

```bash
npm run sim:perf
```

Non-negotiable regression gate, not a balance question. Weld seams add a
stroke per adjacent cube-pair (~220 on a full field) and congestion rows add
up to 18 gradient fills a frame. Both are flat, unblurred draws — see the
`cubeSprites` note in `render.ts` for why `shadowBlur` was profiled out and
must not come back. Memory: a full bay was already 7.6ms/step in
matter narrowphase+solver, so there is little headroom.

---

## 4. Guardrails — invariants to preserve

These are asserted in `sim/systems.ts`. If a balance change breaks one, the
change is wrong, not the assertion — or the assertion needs a documented
argument for why it no longer holds.

- **One contract buys the entry system.** `tierSalvage(1) / 4 == 15 ==` the
  cheapest install. A 2026-08-09 device session found the deadlock this
  prevents (stuck on 8 salvage against a 15-salvage Reactor). Do not cut
  `TIER_SALVAGE_BASE`.
- **The ladder covers the shelf without flooding it**: income between 1.0× and
  1.6× live sink. Currently 600 / 445 = 1.35×.
- **The cheapest rank-1 option fits inside one tier's award** (60).
- **Every bay stays winnable at bot competence**, and no Mark is free.
- **Congestion is escapable**: stopping fire must cost nothing. The tax is
  charged on the shot, never held against the pile — do not "improve" this
  into a drain-per-second.
- **The reload scale stays live and reversible** (`cannon.cooldownScale`,
  separate from `cooldownMs`). Folding it into the level's cooldown makes the
  tax permanent from first trigger.
- **uifit stays at 0 violations** across the device matrix.

---

## 5. Where the numbers live

| what | where |
|---|---|
| Congestion thresholds/multipliers | `src/game/level.ts` → `PILE_TIERS` |
| Congestion allowance (the counter) | `src/game/upgrades.ts` → `bay.apply` |
| Base reload | `src/game/level.ts` → `cooldownMs` |
| Joint ramp | `src/game/level.ts` → `BASE_BREAK_STRETCH`, `jointBreakStretch` |
| Ratchet ladders | `src/game/hazards.ts` → `TIME_LADDER`, `COST_LADDER`, `notchTotal` |
| Salvage income | `src/game/meta.ts` → `TIER_SALVAGE_BASE`, `TIER_SALVAGE_PER_TIER` |
| Install prices | `src/game/meta.ts` → `INSTALLS` |

**`BASE_BREAK_STRETCH` is shared with `render.ts`'s weld seams on purpose.**
It was briefly duplicated and every bay's seams pinned at full width — the
visualisation kept looking correct while saying nothing. If the joint ramp
moves, the seam scale must move with it, and the shared constant is how.

---

## 6. Working agreement for the session

- Land on `claude/bay-cleared-screen-ux-klz9n3` (PR #40, base `staging`).
  **Never push `main`** — `wrangler.jsonc` binds `tetrilaunch.com` as a custom
  domain and Play releases are cut from it, so merging there publishes.
- Every commit: `npm run typecheck && npm run test && npx tsx sim/uifit/run.ts`
  clean before pushing. CI runs `apk`, `fit` and `fit-webkit` per push.
- **Record the measurement in the commit message**, not just the change. A
  balance number without the sweep that justified it is the thing this whole
  document exists to stop happening again.
- When the sim cannot answer a question (see §2), say so explicitly rather
  than reporting the bot's number as if it settled it.

## 7. Deliverable

A summary naming, per tier: the implied run clear rate, whether the Mark is
free / impossible / just-short, how often the congestion tax fired and what it
cost, and every number changed with the sweep that justified it.

Plus an explicit list of questions the sim **could not** answer, for a device
playtest — the reload deterrent and congestion counter-play are already known
to be on it.
