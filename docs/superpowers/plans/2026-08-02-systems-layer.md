# Systems Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Salvage buys a permanent *install* — a ship system that starts every run at tier 1 — instead of buying a lottery ticket for the modifier draft.

**Architecture:** An install is `meta.loadout[id] = 1`, routed through the existing `buyLoadoutTier`, which already refuses any purchase whose `tiersCost` exceeds `budgetForMark`. The permanent-loadout plumbing (`safeLoadout` → `newRun` → `RunState.tiers` → `applyUpgrades`) already exists end to end and is currently **dead code with no writer** — this makes the Workshop its only writer. Demolition becomes a seventh upgrade track so that installing actually grants charges. The modifier draft and the unlock tree are **not touched**; that is phase 2.

**Tech Stack:** TypeScript, no test framework — `sim/systems.ts` is a hand-rolled `check(desc, cond, detail)` harness run with `npx tsx sim/systems.ts`. 367 checks pass today.

**Spec:** `docs/superpowers/specs/2026-08-02-systems-and-hazards-design.md`

---

## Progress — phase 1 complete

Branch `systems-layer`, based on `materials`. Suite green, `tsc` clean and
`vite build` clean at every commit.

| Task | Status | Commit |
|---|---|---|
| 1 — demolition track | **done**, spec + quality reviewed | `a0a6c6e` |
| 2 — refit cannot install | **done**, spec + quality reviewed | `1a80530` |
| 3 — `INSTALLS` table | **done** | `c908101` |
| 4 — `buyInstall` + budget cap | **done** | `38a8421` |
| 5 — retire the pricing check | **done** | `9c3c3a3` |
| 6 — Workshop sells installs | **done** | `53461cb` |
| 7 — wire the purchase | **done** | `53461cb` |

Check count is **390**, up from 370 at Task 2. Note this branch does NOT carry
PR #20's seven contract-modal checks, so it reads lower than a branch that does.

Tasks 6 and 7 landed as one commit: both touch `screens.ts` and `app.css`, and
the refit card's tier-0 state (nominally Task 7) is what makes Task 6's shop the
only place a system can be installed. Splitting them would have meant two
commits neither of which rendered correctly.

### Three departures from the plan as written

**Entry installs are 15 salvage, not 20.** Task 5's replacement check — "a day
of Contracts funds about one install" — failed on first run: three tier-1
dailies pay 18 and the cheapest install was 20, so a player's first full day of
Contracts bought nothing at all. Repriced Reactor and Launcher to 15 rather than
widening the bound, per the plan's own instruction to treat that failure as
signal about pricing.

**`installGates` reports the budget with its numbers** (`build budget 60/77`
rather than `Mark 1 build budget`). Both reasons still show when both apply: at a
low Mark they are usually the same wall seen from two sides, and the numbers are
what explain a refusal to a player holding 400 salvage.

**The refit grid went to four columns, and its header sentence is dropped on
short viewports.** The seventh card started a third row reachable only by
scrolling, so a half-cut card sat against the Undock button. Measured, not
guessed: 4 columns at `minmax(168px, 1fr)` plus the freed header line puts seven
cards back into two rows with 0px of overflow at 792x360.

### Verified in a browser, not only headless

Chromium at 792x360 (the OnePlus 12 viewport the layout specs measure against),
driving the built page: 17 checks — buy an install, salvage drops by its price,
the card moves to the Installed strip, the budget readout advances, a rich save
at Mark 1 still stops at exactly three installs with 9944 salvage in hand, and
nothing overflows the viewport. Plus 11 checks over `refitScreen` rendered from
source at both a stock and a mixed loadout.

The scripts are not committed — the repo has no browser-test harness and adding
one is not this plan's job. What survives in `sim/systems.ts` is the part that
belongs there: markup assertions on `workshopScreen` and `refitScreen`, and the
every-track-has-a-glyph check that `tsc` structurally cannot make.

---

## Working agreements

- All paths are relative to `C:\Users\giova\dev\tetrilaunch\app`.
- Run the suite with `npx tsx sim/systems.ts` from that directory. It prints `All systems checks passed.` on success and `N check(s) FAILED.` otherwise.
- Typecheck with `npx tsc --noEmit`. **Note `sim/` is NOT in tsconfig's `include`** — the harness is never typechecked, so a type error there will only show up at runtime.
- Commit after every task.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/game/upgrades.ts` | The six (soon seven) ship tracks, tier costs, build budget | Add `demolition` track; add `INSTALL_TIER` |
| `src/game/meta.ts` | Salvage, unlocks, `MetaState`, Mark gates | Add `INSTALLS` table + `installAvailable` / `installGates` / `buyInstall` |
| `src/game/run.ts` | `RunState`, refit purchases | `buyUpgrade` refuses an uninstalled track |
| `src/ui/screens.ts` | Workshop + refit rendering | Workshop gains an Installs section; refit card gains a "Not installed" state |
| `src/main.ts` | Screen wiring, persistence | Handle `data-action="buy-install"` |
| `sim/systems.ts` | The check harness | New checks; retire one obsolete one |

**Not touched:** `src/game/mods.ts`, `draftOffers`, `MetaState.unlocks`, `UNLOCKS`. Demolition-as-mod and Demolition-as-track coexist, exactly as Bond Breaker does today.

---

### Task 1: The `demolition` upgrade track

Installing the six existing tracks would not grant a single demolition charge — Demolition exists only as a drafted mod. This is the asymmetry that caused the bug.

**Files:**
- Modify: `src/game/upgrades.ts` (`UpgradeId` at ~line 27, `UPGRADES` array end at ~line 179, `newTiers` at ~line 183)
- Test: `sim/systems.ts` (the "Ship upgrades (upgrades.ts)" section, ~lines 110–137)

- [ ] **Step 1: Write the failing test**

Add to `sim/systems.ts` inside the ship-upgrades section, after the existing `bonds` checks:

```ts
  // Demolition is a TRACK, not only a drafted card. Installing a system has to
  // actually grant the thing the system is named for, or a Workshop purchase
  // buys nothing — which is the bug this whole layer exists to fix.
  const demoCfg = makeBaseLevel(0);
  applyUpgrades(demoCfg, { ...newTiers(), demolition: 2 });
  check("the demolition track grants charges", demoCfg.bombCharges === 2, String(demoCfg.bombCharges));
  const demoStock = makeBaseLevel(0);
  applyUpgrades(demoStock, newTiers());
  check("an uninstalled demolition track grants none", demoStock.bombCharges === 0, String(demoStock.bombCharges));
  check("a full rig now costs 770", FULL_BUILD_COST === 770, String(FULL_BUILD_COST));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx sim/systems.ts`
Expected: FAIL — `the demolition track grants charges` (bombCharges is 0), and `a full rig now costs 770` (still 660). There is also an existing check asserting 660 which will now be contradictory; Step 5 fixes it.

- [ ] **Step 3: Add the track**

In `src/game/upgrades.ts`, extend the id union:

```ts
export type UpgradeId =
  | "bay" | "launcher" | "hydraulics" | "magazine" | "reactor" | "bonds" | "demolition";
```

Append to the `UPGRADES` array, after the `bonds` entry:

```ts
  {
    id: "demolition",
    name: "Demolition Rack",
    glyph: "DEM",
    blurb: "Demolition charges every bay — sell a dead pile back for cash.",
    tiers: ["+1 charge per bay", "+2 charges per bay", "+3 charges per bay"],
    current: (t) => (t === 0 ? "no charges" : `+${t} charge${t === 1 ? "" : "s"}/bay`),
    step: () => ({ dir: "up", text: "+1 charge" }),
    apply(cfg, tier) {
      // The exact shape of the `bonds` track, and for the same reason: a
      // charge you can PLAN for beats a charge you might be dealt. Demolition
      // is slag's only clean answer (a slag cube is worth $0 as line material
      // and salvagePerCube as scrap, so bombing it is strictly positive
      // value), and leaving that answer to a draft shuffle meant a player who
      // had paid for it went whole runs without one.
      cfg.bombCharges += tier;
    },
  },
```

Update `newTiers`:

```ts
export function newTiers(): UpgradeTiers {
  return { bay: 0, launcher: 0, hydraulics: 0, magazine: 0, reactor: 0, bonds: 0, demolition: 0 };
}
```

- [ ] **Step 4: Fix the now-stale budget check**

`FULL_BUILD_COST` is derived from `UPGRADES.length`, so it moves 660 → 770 and every `budgetForMark` moves with it. Find the existing check asserting 660 in `sim/systems.ts` (search `660`) and update its expected value and description to 770. Do **not** hardcode a new constant in `upgrades.ts` — the derivation is deliberate.

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsx sim/systems.ts`
Expected: `All systems checks passed.`

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output. If `IconName` or any exhaustive `Record<UpgradeId, …>` complains, add the `demolition` key there too.

- [ ] **Step 7: Commit**

```bash
git add src/game/upgrades.ts sim/systems.ts
git commit -m "upgrades: demolition becomes a ship track, not only a drafted card"
```

---

### Task 2: Refit cannot install

`nextTierCost(0)` returns 20, so without this a 20-scrap refit would buy tier 1 of any track and undercut every install price — salvage would buy nothing anyone needed.

**Files:**
- Modify: `src/game/run.ts` (`buyUpgrade`, ~line 157)
- Test: `sim/systems.ts`

- [ ] **Step 1: Write the failing test**

```ts
  // Refit TIERS an installed system; it does not install one. Without this the
  // cheapest tier (20 scrap) would undercut every Workshop install price.
  const stockRun = newRun(1, 100, newTiers(), 1);
  check("refit cannot install an uninstalled system",
    buyUpgrade(stockRun, "demolition", 20, MAX_TIER) === null);
  const installedRun = newRun(1, 100, { ...newTiers(), demolition: 1 }, 1);
  check("refit can tier a system that IS installed",
    buyUpgrade(installedRun, "demolition", 35, MAX_TIER)?.tiers.demolition === 2);
```

Check `newRun`'s exact current signature before writing the call — read `src/game/run.ts` around line 58. Adjust the argument list to match; do not change the signature in this task.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx sim/systems.ts`
Expected: FAIL — `refit cannot install an uninstalled system` (it returns a state, not null).

- [ ] **Step 3: Implement**

In `src/game/run.ts`'s `buyUpgrade`, immediately after `const tier = run.tiers[id] ?? 0;`:

```ts
  // Tier 0 means the system is not installed. Refit raises 1 -> 3; installing
  // is a Workshop purchase paid in salvage against the Mark's build budget
  // (see meta.ts's buyInstall). Allowing scrap to install would make the
  // budget cap — and therefore the monetization invariant — unenforceable.
  if (tier <= 0) return null;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx sim/systems.ts`
Expected: `All systems checks passed.`

Existing refit checks that buy from tier 0 will now fail. Fix each by seeding the run's `tiers` with tier 1 for the track under test and adjusting the scrap cost to `TIER_COSTS[1]` (35). Pay attention to `buyUpgrade refuses when broke` — after this change it would pass for the wrong reason (tier 0, not poverty), so it **must** be seeded to tier 1 and starved of scrap instead.

- [ ] **Step 5: Commit**

```bash
git add src/game/run.ts sim/systems.ts
git commit -m "run: refit tiers an installed system, it does not install one"
```

---

### Task 3: The `INSTALLS` table

**Files:**
- Modify: `src/game/meta.ts` (after the `UNLOCKS` array, ~line 146)
- Test: `sim/systems.ts`

Mark gates come from the spec's ladder, **minus one** — `requiresMark` is compared against Marks *beaten* while the ladder is indexed by the Mark being *flown*.

- [ ] **Step 1: Write the failing test**

```ts
  // Every system must be installable, or a track exists that salvage can never
  // reach and the refit menu shows a card nobody can ever use.
  check("every upgrade track has exactly one install",
    UPGRADES.every((u) => INSTALLS.filter((i) => i.id === u.id).length === 1) &&
      INSTALLS.length === UPGRADES.length,
    `${INSTALLS.length} installs vs ${UPGRADES.length} tracks`);
  check("no install is priced at zero", INSTALLS.every((i) => i.cost > 0));
  check("every Mark gate is inside the ladder",
    INSTALLS.every((i) => i.requiresMark === undefined || (i.requiresMark >= 1 && i.requiresMark < MARK_COUNT)));
  // Mark 1 must open enough systems to make a first shop trip a real choice.
  check("at least two systems need no Mark at all",
    INSTALLS.filter((i) => i.requiresMark === undefined).length >= 2);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx sim/systems.ts`
Expected: crash — `INSTALLS is not defined`.

- [ ] **Step 3: Implement**

Add to `src/game/meta.ts`. Import `type UpgradeId` and `upgradeById` from `./upgrades`.

```ts
/**
 * INSTALLS — what salvage actually buys.
 *
 * An install grants tier 1 of a ship system, permanently, in every run. It does
 * NOT grant unbounded power: the purchase is charged against the Mark's build
 * budget (see buyInstall), so salvage buys WHICH systems exist to spend budget
 * on while the Mark caps HOW MUCH can be spent at all. That is DESIGN.md's
 * load-bearing rule — "Contracts unlock what you may spend it on. Only beating
 * Mark N raises the budget" — and it is what keeps uncapped Contract income
 * from buying a permanently stronger rig.
 *
 * Name and description are read from the track itself (upgradeById), so a
 * system's copy lives in exactly one place.
 *
 * requiresMark is Marks BEATEN, i.e. the spec ladder's Mark minus one.
 */
export interface InstallDef {
  id: UpgradeId;
  /** Salvage price. One-time; an install never stacks — tiers 2-3 cost scrap. */
  cost: number;
  /** Marks that must already have been BEATEN. Same invariant as UnlockDef's
   *  field: a Mark is the one thing no amount of salvage can buy. */
  requiresMark?: number;
}

export const INSTALLS: InstallDef[] = [
  { id: "reactor", cost: 20 },
  { id: "launcher", cost: 20 },
  { id: "magazine", cost: 25 },
  { id: "bay", cost: 30, requiresMark: 1 },
  { id: "hydraulics", cost: 30, requiresMark: 1 },
  { id: "bonds", cost: 40, requiresMark: 2 },
  // The spec's ladder puts Demolition at Mark 4 — but that pairing only works
  // once materials MOVE to the hazard draft in phase 3. Phase 1 leaves
  // MATERIAL_SCHEDULE alone, where slag already appears from Mark 2 (i.e. one
  // Mark beaten). Gating its only clean answer at 3 would ship a counter two
  // Marks behind its hazard, which is strictly worse than today. Raise this to
  // 3 in the same change that moves materials off the schedule.
  { id: "demolition", cost: 40, requiresMark: 1 },
];

export function installById(id: string): InstallDef | undefined {
  return INSTALLS.find((i) => i.id === id);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx sim/systems.ts`
Expected: `All systems checks passed.`

- [ ] **Step 5: Commit**

```bash
git add src/game/meta.ts sim/systems.ts
git commit -m "meta: an INSTALLS table — what salvage buys, and at which Mark"
```

---

### Task 4: `installAvailable`, `installGates`, `buyInstall`

**Files:**
- Modify: `src/game/meta.ts`
- Test: `sim/systems.ts`

- [ ] **Step 1: Write the failing test**

```ts
  const freshMeta = (over: Partial<MetaState> = {}): MetaState => ({ ...newMeta(), ...over });

  // The monetization invariant, executable. No salvage total buys a system
  // whose Mark has not been beaten.
  const rich = freshMeta({ salvage: 99999 });
  check("no amount of salvage buys a Mark-gated install below its Mark",
    INSTALLS.filter((i) => i.requiresMark !== undefined)
      .every((i) => !installAvailable(rich, i)));
  const maxed = freshMeta({ salvage: 99999, mark: MARK_COUNT });
  check("a Mark-gated install opens once its Mark is beaten",
    INSTALLS.every((i) => installAvailable(maxed, i) || tooExpensiveForBudget(maxed, i)));

  // The budget cap, executable. This is what stops installs being raw power.
  let greedy = freshMeta({ salvage: 99999, mark: 0 });
  for (const i of INSTALLS) {
    const next = buyInstall(greedy, i.id);
    if (next) greedy = next;
  }
  check("greedy installing never exceeds the Mark's build budget",
    tiersCost(greedy.loadout) <= markBudget(greedy),
    `${tiersCost(greedy.loadout)} vs ${markBudget(greedy)}`);
  check("Mark 1 affords exactly three installs",
    Object.values(greedy.loadout).filter((t) => t > 0).length === 3,
    JSON.stringify(greedy.loadout));

  // An install grants tier 1 and charges salvage.
  const bought = buyInstall(freshMeta({ salvage: 100 }), "reactor");
  check("an install grants exactly tier 1", bought?.loadout.reactor === 1);
  check("an install charges its salvage price", bought?.salvage === 80, String(bought?.salvage));
  check("an install the player cannot afford is refused",
    buyInstall(freshMeta({ salvage: 5 }), "reactor") === null);
  check("installing twice is refused", buyInstall(bought!, "reactor") === null);
```

Add this helper next to the checks:

```ts
  function tooExpensiveForBudget(m: MetaState, i: InstallDef): boolean {
    return tiersCost({ ...m.loadout, [i.id]: 1 }) > markBudget(m);
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx sim/systems.ts`
Expected: crash — `installAvailable is not defined`.

- [ ] **Step 3: Implement**

Add to `src/game/meta.ts`. Import `tiersCost` and `buyLoadoutTier` from `./upgrades`.

```ts
/** True when `def` can be bought right now: its Mark is beaten, and tier 1 of
 *  it still fits the Mark's build budget. Deliberately does NOT check salvage —
 *  the Workshop renders an affordable-but-unaffordable card as a disabled
 *  price button, which reads differently from a gated one. */
export function installAvailable(meta: MetaState, def: InstallDef): boolean {
  if (def.requiresMark !== undefined && meta.mark < def.requiresMark) return false;
  if ((meta.loadout[def.id] ?? 0) > 0) return false;
  return buyLoadoutTier(meta.loadout, def.id, markUnlocked(meta)) !== null;
}

/** Why `def` is unavailable, as display strings. Derived from the same
 *  conditions installAvailable enforces, so the Workshop's locked copy can
 *  never describe a gate the purchase path does not actually apply. */
export function installGates(meta: MetaState, def: InstallDef): string[] {
  const out: string[] = [];
  if (def.requiresMark !== undefined && meta.mark < def.requiresMark) {
    out.push(`Mark ${def.requiresMark}`);
  }
  if (buyLoadoutTier(meta.loadout, def.id, markUnlocked(meta)) === null &&
      (meta.loadout[def.id] ?? 0) === 0) {
    out.push(`Mark ${markUnlocked(meta)} build budget`);
  }
  return out;
}

/** Buy an install: charge salvage and set the track to tier 1. Returns null
 *  when gated, already owned, unaffordable, or over budget. Never mutates. */
export function buyInstall(meta: MetaState, id: UpgradeId): MetaState | null {
  const def = installById(id);
  if (!def) return null;
  if (!installAvailable(meta, def)) return null;
  if (meta.salvage < def.cost) return null;
  const loadout = buyLoadoutTier(meta.loadout, id, markUnlocked(meta));
  if (!loadout) return null;
  return { ...meta, salvage: meta.salvage - def.cost, loadout };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx sim/systems.ts`
Expected: `All systems checks passed.`

If `Mark 1 affords exactly three installs` fails, read the actual number off the failure detail and reconcile against `budgetForMark(1)` = `round(770/10)` = 77 and `TIER_COSTS[0]` = 20 (three fit at 60, a fourth is 80). If the arithmetic disagrees, the bug is in `INSTALLS` pricing or `FULL_BUILD_COST`, not the check.

- [ ] **Step 5: Commit**

```bash
git add src/game/meta.ts sim/systems.ts
git commit -m "meta: buyInstall — salvage buys a system, the Mark budget caps how many"
```

---

### Task 5: Retire the obsolete pricing check

`sim/systems.ts` asserts that a week of dailies is under 60% of the unlock tree — encoding the old rule that Contracts must never be the fast route. Install pricing deliberately inverts that. Abandon it explicitly rather than let it rot.

**Files:**
- Modify: `sim/systems.ts` (search for `weekOfDailies`)

- [ ] **Step 1: Replace the check**

Delete the `weekOfDailies` check and put the spec's pacing target in its place:

```ts
  // The old check here asserted a week of dailies stayed under 60% of the
  // unlock tree — the rule that Contracts must never be the fast route to a
  // full tree. Installs deliberately invert it: a day of Contracts should fund
  // about one install, because Contract salvage is now what buys the system
  // the next Mark needs. The cap that replaced it is the BUILD BUDGET, which
  // no amount of income moves (see meta.ts's buyInstall).
  const dayOfDailies = DAILY_COUNT * salvageForContract(1);
  const cheapestInstall = Math.min(...INSTALLS.map((i) => i.cost));
  check(
    `a day of Contracts funds about one install (${dayOfDailies} vs ${cheapestInstall})`,
    dayOfDailies >= cheapestInstall && dayOfDailies < cheapestInstall * 3,
    `${dayOfDailies} salvage/day against a ${cheapestInstall} install`,
  );
```

Confirm `DAILY_COUNT` and `salvageForContract` are exported from `src/game/meta.ts` and imported in the harness; if `DAILY_COUNT` lives in `contracts.ts`, import it from there.

- [ ] **Step 2: Run**

Run: `npx tsx sim/systems.ts`
Expected: `All systems checks passed.` If the new check fails, that is real signal about install pricing — reconcile `INSTALLS` costs against the actual daily payout rather than loosening the bound.

- [ ] **Step 3: Commit**

```bash
git add sim/systems.ts
git commit -m "test: Contracts now fund installs, so the old pricing bound retires"
```

---

### Task 6: The Workshop sells installs

**Files:**
- Modify: `src/ui/screens.ts` (`workshopScreen`, ~line 659)

- [ ] **Step 1: Add the installs section**

Import `INSTALLS`, `installAvailable`, `installGates` from `../game/meta` and `upgradeById` from `../game/upgrades`.

Inside `workshopScreen`, before the `return`:

```ts
  // Installs sit ABOVE the unlock cards: a system is permanent power the player
  // keeps, an unlock is an option that may or may not be dealt, and the shop
  // should lead with the one that is guaranteed to matter.
  const installCards = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) === 0)
    .map((i) => {
      const def = upgradeById(i.id)!;
      const available = installAvailable(meta, i);
      const affordable = meta.salvage >= i.cost;
      const gates = installGates(meta, i);
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-install" data-install="${i.id}"${affordable ? "" : " disabled"}>♻ ${i.cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
      return `<div class="shop-card${available ? "" : " shop-card--gated"}">
      <div class="shop-card__name">${def.name}</div>
      <p class="shop-card__desc">${def.blurb} Installs at tier 1; refit stops raise it.</p>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
    })
    .join("");

  const installedStrip = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) > 0)
    .map((i) => `<span class="workshop__owned-item">${upgradeById(i.id)!.name} ${"I".repeat(meta.loadout[i.id] ?? 0)}</span>`)
    .join("");

  const installSection = installCards
    ? `<div class="workshop__section-label">Systems · budget ${tiersCost(meta.loadout)}/${markBudget(meta)}</div>
       <div class="workshop__grid">${installCards}</div>`
    : `<p class="muted" style="margin:0">Every system your Mark allows is installed. Beat this Mark to open the next one.</p>`;
```

Insert `${installedStrip ? `<div class="workshop__owned"><span class="workshop__owned-label">✓ Installed</span>${installedStrip}</div>` : ""}` and `${installSection}` into the returned markup, immediately after the `workshop__meta` div and before `${ownedStrip}`.

Import `tiersCost` and `markBudget` alongside the others.

- [ ] **Step 2: Verify it renders**

Start the preview and check the Workshop at the device viewport:

```bash
npx vite --port 5173
```

Open `http://localhost:5173`, go to Workshop, and confirm: a Systems section listing installable tracks with prices, a budget readout, gated cards showing their Mark, and the screen not overflowing at 792×360. Reuse the measuring approach from the contract-modal fix — `modal.scrollHeight - modal.clientHeight` should be 0, or the section needs the same wrapping-row treatment.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens.ts
git commit -m "workshop: sell system installs above the option unlocks"
```

---

### Task 7: Wire the purchase

**Files:**
- Modify: `src/main.ts` (the `data-action` handler; find `buy-unlock`, ~line 799)

- [ ] **Step 1: Implement**

Find the existing `buy-unlock` handler and add a sibling. Match its exact style for reading the dataset, mutating `this.meta`, persisting, and re-rendering:

```ts
      case "buy-install": {
        const id = el.dataset.install as UpgradeId | undefined;
        if (!id) break;
        const next = buyInstall(this.meta, id);
        // buyInstall refuses gated, owned, unaffordable and over-budget alike,
        // so a refused click is a no-op rather than a special case here.
        if (!next) break;
        this.meta = next;
        saveMeta(this.meta);
        this.render();
        break;
      }
```

Import `buyInstall` from `./game/meta` and `type UpgradeId` from `./game/upgrades`. Confirm the surrounding handler's actual variable names (`el`, `this.meta`, `saveMeta`, `this.render()`) by reading the `buy-unlock` case first — mirror them exactly rather than assuming.

- [ ] **Step 2: Verify end to end**

In the preview: buy an install, confirm salvage drops by the price, the card moves to the Installed strip, the budget readout advances, and a fourth Mark-1 install is refused. Then start a run and confirm the refit screen shows that track at tier 1 with a tier-2 buy button, and every uninstalled track showing "Not installed".

If the refit card does not yet render a tier-0 state, add it in `refitScreen`: ahead of the existing button/MAX branches, `tier === 0` renders `<span class="refit-card__locked">Not installed</span>` with no `data-action`.

- [ ] **Step 3: Full verification**

```bash
npx tsc --noEmit && npx tsx sim/systems.ts && npx vite build
```

Expected: no type errors, `All systems checks passed.`, clean build.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/ui/screens.ts
git commit -m "main: wire the install purchase, and show uninstalled tracks at refit"
```

---

## Done when

- Buying Demolition Rack in the Workshop means every bay of every run starts with a charge, without drafting anything.
- Salvage has a sink that grows with the Mark instead of ending at 1400.
- `tiersCost(meta.loadout) <= markBudget(meta)` holds for any sequence of purchases — asserted, not assumed.
- The modifier draft behaves exactly as it does today.

## Deliberately not in this plan

- The hazard draft, and `makeBaseLevel`'s auto-scaling (phase 2).
- Retiring `MetaState.unlocks`, `ModDef.unlock`, or `draftOffers`' unlocks parameter (phase 2).
- Splitting Stabilizer out of Launcher — the spec's ladder wants it, nothing in phase 1 needs it.
- Re-pricing `UNLOCKS`. The two trees coexist; phase 2 decides what happens to the older one.
