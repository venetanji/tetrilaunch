# Bay End Convergence, Held Reset, and the Deep Run Seal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the game cutting a bay off while the compactor could still close
the goal; give the player a one-gesture reset; and mark a Deep Run cleared
without one.

**Architecture:** `Game.update()`'s three overtime branches and `resolveWin`
today all end a bay on "one compactor full-advance has happened AND every cube
is at rest". That is a settle gate, not a finish gate — `strokeDone` is sticky,
so once one advance has happened the bay ends the *instant* the field rests,
with no press in between to grind a near-miss row square. Replace the shared
condition with a convergence test sampled at each full advance, add a
hold-to-reset on the pause button so a longer bay is never a trap, and record
restart-free Deep Runs as a per-Mark seal on the tower.

**Tech Stack:** TypeScript, matter-js, Vite, Capacitor. Tests are
`npm test` (`tsx sim/systems.ts`, the headless real-`Game` harness) and
`npm run test:uifit` (real-pixel, 13 devices, CI-gated).

**Spec:** `docs/superpowers/specs/2026-08-26-bay-end-and-reset-design.md`

## Global Constraints

- **Run from `app/`.** All npm scripts live in `app/package.json`.
- **PowerShell eats `--` flags.** `npm run test:uifit -- --shots` silently drops
  the flag and runs the default. Call the binary directly:
  `npx tsx sim/uifit/run.ts --shots`.
- **`sim/systems.ts` is string-and-number only** — it cannot measure rendered
  pixels. Anything about height or fit belongs in `sim/uifit`.
- **Prove every new check fails before the fix that makes it pass.** A check
  that was green before the change tests nothing.
- **`npm run test:uifit` baseline holds 139 accepted entries.** Read the `new`
  count in the output, not the total.
- **The palette is full** — 13 swatches, and `sim/systems.ts` fails the build
  below ΔE00 10. Any new visual distinction (the seal) must be carried by
  **shape**, not by a new colour. Red/green pairs are not distinguishable to
  this project's owner; never let a distinction rest on hue alone.
- **Comment in the house style.** This codebase explains *why*, names the
  measurement behind a constant, and records what was tried and rejected.
  Match it — a bare constant with no reasoning will not pass review.
- **Never `git stash`** — the stash stack is shared across this repo's
  worktrees and a concurrent session can pop your work.
- **PRs target `staging`**, never `main`.

---

### Task 1: Reproduce the early cut-off as a failing check

**Files:**
- Modify: `app/sim/systems.ts` — the existing
  `section("Demolition charges + settle window (game.ts)")` block (~line 2559)

**Interfaces:**
- Consumes: `Game`, `makeBaseLevel`, `Matter`, `CELL` — all already imported by
  `sim/systems.ts`.
- Produces: nothing consumed by later tasks; this is the regression gate the
  rest of the work is measured against.

The scenario is the reported bug in miniature. A bay with a full row already
standing, its manifest spent, and the row disturbed *after* the compactor's
first full advance — exactly what a bond breaking does. Today the bay ends the
moment those cubes come to rest, because `strokeDone` was already true. It
should instead keep running and let the next press stroke clear the row.

- [ ] **Step 1: Write the failing check**

Add a new section at the end of `sim/systems.ts`, before the failure summary:

```ts
// ---------------------------------------------------------------------------
section("Bay end: convergence, not one stroke (game.ts)");
// ---------------------------------------------------------------------------
{
  const DT = 1000 / 60;

  /** A one-line bay whose manifest is already spent and whose goal is already
   *  standing on the floor. `pieceQueue: []` makes piecesLeft 0 on frame one,
   *  which is the exact-inventory branch under test; the other limits are
   *  zeroed so `pieces` and `topout` are the only reachable loss reasons —
   *  the same shape levelForContract gives a pattern Contract. */
  function spentBay() {
    const cfg = makeBaseLevel(0);
    cfg.objectiveLines = 1;
    cfg.compactorMinLineCells = 6;
    cfg.compactorOpenCells = 12;
    cfg.pieceQueue = [];
    cfg.standingWall = [1, 1, 1, 1, 1, 1];
    cfg.launchBudget = 0;
    cfg.launchCost = 0;
    cfg.startingFunds = 0;
    cfg.timeLimitSec = 0;
    cfg.targetScore = Number.MAX_SAFE_INTEGER;
    return cfg;
  }

  // Run the bay, and at the first moment AFTER the compactor has completed a
  // full advance, lift the standing row a cube's height and drop it — the
  // bond-break case: the cubes that make the line are all still there, they
  // are simply in the air when the stroke that would have counted them ends.
  const g = new Game(spentBay(), {}, 7);
  let now = 0;
  let advanced = false;
  let disturbed = false;
  let steps = 0;
  while (g.status === "playing" && steps < 4000) {
    if (!advanced && g.compactor.x >= g.compactor.rightX) advanced = true;
    if (advanced && !disturbed) {
      for (const cu of g.cubes) {
        Matter.Body.setPosition(cu.body, {
          x: cu.body.position.x,
          y: cu.body.position.y - CELL * 1.2,
        });
        Matter.Sleeping.set(cu.body, false);
      }
      disturbed = true;
    }
    now += DT;
    g.update(now);
    steps += 1;
  }

  check(
    "a disturbed row gets another press before the bay is judged",
    g.status === "won",
    `${g.status}${g.lossReason ? ` (${g.lossReason})` : ""} after ${steps} steps, ${g.linesTotal} lines`,
  );
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test`
Expected: `FAIL  a disturbed row gets another press before the bay is judged — lost (pieces) after ... steps, 0 lines`

If it reports `won` already, the disturbance is landing before the first full
advance rather than after it. Raise the lift (`CELL * 1.2` → `CELL * 2`) or
confirm `advanced` is being set, and re-run until the pre-fix state is a
genuine `lost (pieces)`. **Do not proceed until this check fails** — a check
that passes before the fix is testing nothing.

- [ ] **Step 3: Commit the failing check**

```bash
git add app/sim/systems.ts
git commit -m "test: a disturbed row is judged before it gets its press"
```

---

### Task 2: Measure the convergence thresholds

**Files:**
- Create: `app/sim/settle-probe.ts` (throwaway instrument — deleted in Step 4)

**Interfaces:**
- Consumes: `Game`, `makeBaseLevel`, `generateContract`, `levelForContract`,
  `PATTERN_SLOT` from `../src/game/contracts`.
- Produces: two measured numbers, written into `CONVERGED_EPS_PX` and
  `CONVERGED_EPS_RAD` in Task 3. **Do not guess these.**

The convergence test has to separate two populations: a cube under active
vibro-compaction (`ANGLE_RATE` 0.02 rad/step, `X_RATE` 0.5 px/step, scaled by
`level.settleAssist`) and a settled pile's contact jitter. Guessing the gap
either ends bays early again or never ends them.

- [ ] **Step 1: Write the probe**

```ts
// THROWAWAY instrument (sim/settle-probe.ts): measures how far cubes move
// between consecutive compactor full-advances, split by whether the stroke
// changed anything. Its output picks CONVERGED_EPS_* in game.ts; delete it
// once those constants carry the numbers.
import Matter from "matter-js";
import { Game } from "../src/game/game";
import { generateContract, levelForContract, PATTERN_SLOT } from "../src/game/contracts";

const DT = 1000 / 60;
const gaps: number[] = [];
const angles: number[] = [];

for (let tier = 1; tier <= 9; tier++) {
  for (let day = 0; day < 12; day++) {
    const ct = generateContract(20260101 + day, tier, PATTERN_SLOT);
    if (ct.kind !== "pattern") continue;
    const g = new Game(levelForContract(ct, Math.random), {}, ct.seed);
    let prev: Map<number, { x: number; y: number; a: number }> | null = null;
    let now = 0;
    for (let s = 0; s < 6000 && g.status === "playing"; s++) {
      now += DT;
      // Fire straight ahead at a fixed cadence so the bay actually fills.
      if (s % 90 === 0) g.shoot(now);
      g.update(now);
      if (g.compactor.x < g.compactor.rightX) continue;
      const cur = new Map(g.cubes.map((c) => [
        c.body.id, { x: c.body.position.x, y: c.body.position.y, a: c.body.angle },
      ]));
      if (prev && prev.size === cur.size) {
        let maxD = 0;
        let maxA = 0;
        for (const [id, p] of prev) {
          const c = cur.get(id);
          if (!c) { maxD = Infinity; break; }
          maxD = Math.max(maxD, Math.hypot(c.x - p.x, c.y - p.y));
          maxA = Math.max(maxA, Math.abs(c.a - p.a));
        }
        if (Number.isFinite(maxD)) { gaps.push(maxD); angles.push(maxA); }
      }
      prev = cur;
    }
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
console.log(`samples ${gaps.length}`);
for (const p of [0.05, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
  console.log(`p${(p * 100).toFixed(0)}  px ${pct(gaps, p).toFixed(3)}  rad ${pct(angles, p).toFixed(4)}`);
}
```

- [ ] **Step 2: Run it and read the two populations**

Run: `cd app && npx tsx sim/settle-probe.ts`

Expected: a bimodal spread — a dense low band (contact jitter on a settled
pile) and a long tail (cubes actively being ground or still falling). Pick each
epsilon **above the low band and well below the tail**; the p50 of the low band
and the p90 overall bracket the choice. Write both numbers down along with the
sample count — they go into the constant's comment in Task 3.

- [ ] **Step 3: Sanity-check the numbers against the rates**

`CONVERGED_EPS_PX` must be below `X_RATE` (0.5 px/step) times the steps in a
press stroke, or an actively-grinding cube would read as quiet. Likewise
`CONVERGED_EPS_RAD` below `ANGLE_RATE` (0.02 rad/step) times the same. If the
measured value violates either, the probe is sampling the wrong thing — fix it
rather than overriding the check.

- [ ] **Step 4: Delete the probe and commit the numbers as notes**

```bash
cd app && rm sim/settle-probe.ts
```

Nothing to commit yet — the numbers land in Task 3. This step exists so the
instrument does not ship.

---

### Task 3: Convergence helper, wired into the exact-inventory branch

**Files:**
- Modify: `app/src/game/game.ts` — constants near `WIN_SETTLE_MAX_STEPS`
  (~line 264), new private state beside `piecesUpStep` (~line 454), new private
  method beside `resolveWin` (~line 1726), and the `piecesLeft <= 0` branch
  (~line 1567)

**Interfaces:**
- Consumes: `Matter`, `isAtRest`, `this.compactor`, `this.cubes`,
  `this.lastFullAdvanceStep`, `this.stepCount` — all already present.
- Produces:
  - `private sampleField(): void` — samples the field at a full advance and
    sets `settleQuiet`.
  - `private settleQuiet: boolean` — true when the last two full advances left
    the field unchanged within the epsilons.
  - `private noteClearForSettle(): void` — resets the convergence window.
  - `private settleDone(sinceStep: number): boolean` — the shared overtime exit.
  - `private readonly settleCapSteps: number` — the absolute backstop, in steps.

- [ ] **Step 1: Add the constants**

Beside `WIN_SETTLE_MAX_STEPS` in `game.ts`, with the Task 2 numbers substituted
for `<measured>`:

```ts
/** Convergence thresholds for the overtime windows (see fieldQuiet).
 *
 *  A bay used to be called once ONE compactor full-advance had happened and
 *  the field was at rest. `strokeDone` is sticky, so in practice that ended
 *  the bay the instant the last cube stopped moving — with no press in
 *  between. A row one grind short of square (settleZoneCubes runs only on
 *  pressing steps, at ANGLE_RATE 0.02 rad/step and X_RATE 0.5 px/step) never
 *  got the stroke that would have closed it, which lost an exact-inventory
 *  Contract with the winning six cubes sitting on the floor.
 *
 *  These separate "still being ground into place" from "the press has stopped
 *  achieving anything". Measured over pattern bays across tiers 1-9
 *  (<n> samples, sim/settle-probe.ts): settled contact jitter sits at
 *  <low band>, while a stroke that moved something runs <tail>. Re-measure
 *  with the same method if the compactor rates, gravity or the solver change
 *  — these numbers are only meaningful relative to them. */
const CONVERGED_EPS_PX = <measured>;
const CONVERGED_EPS_RAD = <measured>;
```

- [ ] **Step 2: Add the state and the helper**

Beside `piecesUpStep`:

```ts
/** The field as it stood at the previous compactor full-advance — body id to
 *  position and angle — or null before the first one. Keyed by BODY ID, not by
 *  array index: a cube removed by a clear would otherwise shift every cube
 *  after it and read as the whole pile having moved. */
private settleSample: Map<number, { x: number; y: number; a: number }> | null = null;
/** Whether the last full advance found the field unchanged since the one
 *  before it. Read by the overtime branches; written only in update(). */
private settleQuiet = false;
```

And the helper, beside `resolveWin`:

```ts
/**
 * The convergence test every overtime window shares: has the compactor stopped
 * changing anything?
 *
 * Sampled once per full advance, which is the only moment worth comparing —
 * the bar is at the same place, so any difference is the PILE having moved,
 * not the stroke being at a different phase. Two consecutive identical samples
 * mean the press has run a whole cycle over this field and achieved nothing,
 * which is the honest end of a bay: more strokes cannot help.
 *
 * A changed cube COUNT is never quiet. A clear removes cubes (and is progress
 * that earns more strokes — see noteClearForSettle); a shatter adds them. In
 * both cases the field is a different field and the comparison is meaningless.
 */
private sampleField(): void {
  const cur = new Map<number, { x: number; y: number; a: number }>();
  for (const c of this.cubes) {
    cur.set(c.body.id, { x: c.body.position.x, y: c.body.position.y, a: c.body.angle });
  }
  const prev = this.settleSample;
  let quiet = prev !== null && prev.size === cur.size;
  if (quiet && prev) {
    for (const [id, p] of prev) {
      const c = cur.get(id);
      if (!c) { quiet = false; break; }
      if (Math.hypot(c.x - p.x, c.y - p.y) > CONVERGED_EPS_PX) { quiet = false; break; }
      if (Math.abs(c.a - p.a) > CONVERGED_EPS_RAD) { quiet = false; break; }
    }
  }
  this.settleQuiet = quiet;
  this.settleSample = cur;
}

/** A line cleared: the bay has earned more strokes. Drops the sample so the
 *  next full advance cannot compare across the clear and call a field that
 *  just changed shape "quiet". */
private noteClearForSettle(): void {
  this.settleSample = null;
  this.settleQuiet = false;
}

/** The shared exit for every overtime window: the press has converged AND the
 *  field is at rest, or the absolute backstop has run out. */
private settleDone(sinceStep: number): boolean {
  const waited = this.stepCount - sinceStep;
  const strokeDone = this.lastFullAdvanceStep > sinceStep;
  if (strokeDone && this.settleQuiet && this.cubes.every((c) => isAtRest(c.body))) return true;
  return waited > this.settleCapSteps;
}
```

- [ ] **Step 3: Sample at the full advance, and reset on a clear**

In `update()`, at the existing full-advance record (~line 1394):

```ts
if (this.compactor.x >= this.compactor.rightX) {
  this.lastFullAdvanceStep = this.stepCount;
  this.sampleField();
}
```

And where `clear.lines > 0` is handled (~line 1455), inside that block:

```ts
this.noteClearForSettle();
```

- [ ] **Step 4: Add the backstop and use it in the pieces branch**

Declare the field beside `brokeGraceSteps` (~line 439):

```ts
/** Ceiling on an overtime window, in physics steps — see settleDone. */
private readonly settleCapSteps: number;
```

And assign it in the constructor, immediately after `brokeGraceSteps`:

```ts
// The overtime backstop. A pile in permanent contact-jitter never converges,
// so the window still needs a ceiling — but one stroke's worth was the bug,
// so this is six round trips. The 30s absolute cap is the one brokeGraceSteps
// already uses, for the same reason: a degenerate compactorSpeed mutator must
// not make the window effectively infinite.
this.settleCapSteps = Math.min(this.compactor.cycleSteps * 6, 30_000 / DT);
```

Then replace the `piecesLeft <= 0` branch's `done` (~line 1585):

```ts
const done = this.objectiveUnreachable
  ? this.stepCount - this.piecesUpStep > UNREACHABLE_GRACE_STEPS
  : this.settleDone(this.piecesUpStep);
```

Update that branch's comment: the `queue empty` arm no longer says "wait for a
completed press and a field at rest" — it waits for the press to stop changing
anything. Keep the `unreachable` arm's reasoning as it stands; it is unchanged
and still correct.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test`
Expected: `ok    a disturbed row gets another press before the bay is judged`,
and every pre-existing check still `ok`.

- [ ] **Step 6: Add a termination check so this cannot become a hang**

In the same section as Task 1's check:

```ts
  // The other half of the contract: a bay that CANNOT be finished must still
  // end, and quickly. Cubes parked one slot short of a line converge on the
  // first quiet stroke — nothing the press does changes them — so this must
  // come in well under the backstop.
  const dead = new Game((() => {
    const cfg = spentBay();
    cfg.standingWall = [1, 1, 1, 0, 1, 1];
    return cfg;
  })(), {}, 7);
  let deadNow = 0;
  let deadSteps = 0;
  while (dead.status === "playing" && deadSteps < 4000) {
    deadNow += DT;
    dead.update(deadNow);
    deadSteps += 1;
  }
  check(
    "a bay that cannot be finished still ends, and not at the cap",
    dead.status === "lost" && deadSteps < dead.compactor.cycleSteps * 4,
    `${dead.status} after ${deadSteps} steps (cap ${(dead.compactor.cycleSteps * 6).toFixed(0)})`,
  );
```

- [ ] **Step 7: Run the tests**

Run: `cd app && npm test`
Expected: both new checks `ok`.

- [ ] **Step 8: Commit**

```bash
git add app/src/game/game.ts app/sim/systems.ts
git commit -m "The bay ends when the press stops changing anything, not after one stroke"
```

---

### Task 4: Share the helper with the launch, clock and win windows

**Files:**
- Modify: `app/src/game/game.ts` — the `launchesLeft <= 0` branch (~line 1593),
  the `timeLeftMs <= 0` branch (~line 1609), and `resolveWin` (~line 1726)

**Interfaces:**
- Consumes: `settleDone(sinceStep)` from Task 3.
- Produces: nothing new.

All three carry the identical one-stroke shape and therefore the identical bug.
A Deep Run bay whose last shot completes a row that has not been ground square
loses that row's payout — and there it costs a run, not a free retry.

- [ ] **Step 1: Replace the launch-budget branch's condition**

```ts
if (this.launchesUpStep === null) this.launchesUpStep = this.stepCount;
if (this.settleDone(this.launchesUpStep)) {
  this.lossReason = "launches";
  this.setStatus("lost");
}
```

- [ ] **Step 2: Replace the clock branch's condition**

```ts
if (this.timeUpStep === null) this.timeUpStep = this.stepCount;
if (this.settleDone(this.timeUpStep)) {
  this.lossReason = "time";
  this.setStatus("lost");
}
```

- [ ] **Step 3: Replace `resolveWin`'s condition**

`resolveWin` keeps its own cap — a won bay's money is already banked and the
celebration must not be held up by a jittering pile, so `WIN_SETTLE_MAX_STEPS`
(4s) stays the ceiling rather than `settleCapSteps`:

```ts
private resolveWin(now: number): void {
  if (this.winPendingStep === null) return;
  const elapsed = this.stepCount - this.winPendingStep;
  const strokeDone = this.lastFullAdvanceStep > this.winPendingStep;
  const atRest = this.cubes.every((c) => isAtRest(c.body));
  if ((strokeDone && this.settleQuiet && atRest) || elapsed > WIN_SETTLE_MAX_STEPS) {
    this.effects.push({ kind: "bayclear", x: WORLD.width / 2, y: WORLD.height * 0.42, t0: now });
    this.setStatus("won");
  }
}
```

Update the three comment blocks: each says "wait for a completed pressing
stroke AND a field at rest". They now wait for the press to stop changing
anything. Say why in one sentence and point at `sampleField` / `settleDone`
rather than repeating the reasoning three times.

- [ ] **Step 4: Run the tests**

Run: `cd app && npm test`
Expected: all checks `ok` — in particular the pre-existing settle-window checks
in `section("Demolition charges + settle window (game.ts)")`.

- [ ] **Step 5: Check the balance sweep still terminates**

Run: `cd app && npx tsx sim/sweep.ts`
Expected: it completes. Bays may run slightly longer; no bay should hit the
step cap that did not before. If run lengths moved materially, say so in the
PR — this is a real balance surface, not just a bug fix.

- [ ] **Step 6: Commit**

```bash
git add app/src/game/game.ts
git commit -m "The launch, clock and win windows converge the same way the manifest does"
```

---

### Task 5: `resetBay()` and the held pause button

**Files:**
- Modify: `app/src/main.ts` — the hold fields (~line 447), `startBondHold` /
  `onBondHoldMove` / `clearBondHold` (~line 3873-3925), `onGamePointerDown`
  (~line 3813), `onClick` (~line 3319), `restartBay` (~line 2836)

**Interfaces:**
- Consumes: `BOND_HOLD_MS`, `BOND_HOLD_SLOP`, `tapHaptic`, `successHaptic`.
- Produces:
  - `private startHold(el, pointerId, ms, onComplete): void`
  - `private clearHold(): void`
  - `private resetBay(): void` — restarts the current bay from `playing` or
    `paused`.

Generalise rather than copy. Two hold implementations would drift, and the
drift would show up as a gesture that behaves differently on two buttons.

- [ ] **Step 1: Generalise the hold primitive**

Rename the field and widen it:

```ts
/** The hold-to-confirm press currently down, or null. Bond Breaker's triggers
 *  and the pause button both use it (BOND_HOLD_MS / startHold). `el` is the
 *  button being held, so only the one under the finger animates; `rect` is its
 *  box captured at press time, which is what the drift check measures against
 *  (nothing in the HUD moves mid-press, so measuring once is enough and keeps
 *  the move handler off getBoundingClientRect). `onComplete` is what the fill
 *  reaching the top does — the whole reason this is shared. */
private hold:
  | { pointerId: number; el: HTMLElement; rect: DOMRect; timer: number; onComplete: () => void }
  | null = null;
```

`startHold` is `startBondHold`'s body with the action lifted out:

```ts
private startHold(el: HTMLElement, pointerId: number, ms: number, onComplete: () => void): void {
  this.clearHold();
  // One number for the meter and the timer (see BOND_HOLD_MS).
  el.style.setProperty("--bond-hold", `${ms}ms`);
  el.classList.add("bond-trigger--holding");
  this.hold = {
    pointerId, el, rect: el.getBoundingClientRect(), onComplete,
    timer: window.setTimeout(() => {
      const done = this.hold?.onComplete;
      this.clearHold();
      done?.();
    }, ms),
  };
  window.addEventListener("pointermove", this.onHoldMove);
  // The press is worth confirming on its own, before anything has happened
  // yet: it is what tells a thumb the hold has STARTED and is being counted.
  void tapHaptic();
}
```

`onBondHoldMove` becomes `onHoldMove` and `clearBondHold` becomes `clearHold`,
reading `this.hold`. Keep every existing comment — the drift-slop and
unwind-animation reasoning is unchanged and still correct. Update
`onGlobalPointerUp` and every `clearBondHold()` call site (including the one in
`setState`).

The CSS class stays `.bond-trigger--holding` and the custom property stays
`--bond-hold`. Renaming them would touch `app.css`'s charge-meter block for no
behavioural gain and put a cosmetic rename in a bug-fix diff; the class is the
*treatment*, and both buttons now wear it. Note it in the CSS block's comment
so the name does not read as a copy-paste mistake later.

- [ ] **Step 2: Point Bond Breaker at the primitive**

In `onGamePointerDown`:

```ts
if (act === "bond") {
  this.startHold(el, e.pointerId, BOND_HOLD_MS, () => this.onGameAction("bond"));
  return;
}
```

- [ ] **Step 3: Add `resetBay` and route `restartBay` through it**

```ts
/** Restart the bay in play. Shared by the pause modal's "Restart Bay" and the
 *  held pause button, which differ only in the screen they fire from — the
 *  bay itself is rebuilt identically either way (a Contract and a drill both
 *  re-deal from their own fixed seed, so a retry is the SAME puzzle, which is
 *  the whole point of retrying one). */
private resetBay(): void {
  if (this.state !== "playing" && this.state !== "paused") return;
  // A hold that restarted the bay must not leave its own meter counting on a
  // button the rebuild is about to replace, and the Autoloader must not stay
  // held down through a bay that no longer exists.
  this.clearHold();
  this.releaseAutoTrigger();
  // Deep Run only. A Contract re-deal costs nothing and is the mode working as
  // designed; Tier S climbs no ladder (see RunState.restarts).
  if (this.run && !this.run.sandbox) this.run.restarts += 1;
  // A drill restarts from its own fixed seed (drillSeed), so pausing and
  // restarting hands back the identical lesson — same reasoning as the
  // Contract below.
  if (this.drill) {
    this.startDrill(this.drill);
    this.last = performance.now();
    this.acc = 0;
    return;
  }
  // Restarting a Contract re-generates the same bay from its seed, which is
  // the whole point of the mode — retry the identical puzzle, not a reroll.
  if (this.contract) {
    this.startContract(this.contract);
    this.last = performance.now();
    this.acc = 0;
    return;
  }
  if (!this.run) return;
  this.startLevel();
  this.last = performance.now();
  this.acc = 0;
}
```

That body is `restartBay`'s, moved rather than re-derived — the seed reasoning
in those comments is load-bearing and must not be paraphrased. `restartBay`
then becomes:

```ts
private restartBay(): void {
  if (this.state !== "paused") return;
  this.resetBay();
}
```

`this.run.restarts` does not exist yet — Task 6 adds it. Until then this line
will not typecheck; **do Task 6 before running `npm run typecheck`**, or add
the field first. (Task 6 is listed after this one only because the gesture is
the deliverable a reviewer gates on.)

- [ ] **Step 4: Start the hold on the pause button**

`data-action` buttons act on **click**, not pointerdown, so the tap path is
untouched — a completed hold only has to stop the click that follows. In
`onGamePointerDown`, before the `[data-game]` lookup:

```ts
// The pause button does double duty: TAP pauses (the click below), HOLD
// restarts the bay. Only while playing — on any other screen the button is
// either absent or the modal's own, and a hold there would restart a bay the
// player is not in. The click that follows a completed hold is suppressed by
// holdFired; a hold released early never sets it, so the tap still pauses.
const pauseBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="pause"]');
if (pauseBtn && this.state === "playing") {
  this.holdFired = false;
  this.startHold(pauseBtn, e.pointerId, BOND_HOLD_MS, () => {
    this.holdFired = true;
    void successHaptic();
    this.resetBay();
  });
  return;
}
```

Add the flag beside `hold`:

```ts
/** Set when a hold COMPLETED, so the click the browser sends after the
 *  release is swallowed rather than doing the tap's job as well. Cleared at
 *  the start of every hold — a released-early hold must still tap. */
private holdFired = false;
```

And at the top of `onClick`'s `action` switch, before the `switch`:

```ts
if (action === "pause" && this.holdFired) { this.holdFired = false; return; }
```

- [ ] **Step 5: Verify on the device**

Build and install, then drive it over adb + CDP **by selector, not coordinates**
— a blind tap derived from a screenshot lands on the wrong control often enough
to cost more than it saves:

```
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof com.tetrilaunch.app)
```

Then over CDP, in a live bay: dispatch `pointerdown` on
`[data-action="pause"]`, wait past `BOND_HOLD_MS`, dispatch `pointerup`, and
read back that the bay restarted (shipments back to full) and that the pause
modal did **not** open. Then repeat with a 300ms hold and assert the opposite.
Numbers, not screenshots.

- [ ] **Step 6: Commit**

```bash
git add app/src/main.ts
git commit -m "Hold the pause button to restart the bay; the tap still pauses"
```

---

### Task 6: The run counts its restarts

**Files:**
- Modify: `app/src/game/run.ts` — `RunState` (~line 23), `newRun` (~line 118)
- Modify: `app/sim/systems.ts` — the `recordRunEnd` section (~line 2550)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RunState.restarts: number` — read by Task 7's `recordRunEnd`.

- [ ] **Step 1: Add the field**

In `RunState`:

```ts
/** Bay restarts taken this run. Written by main.ts's resetBay, read once at
 *  the end (meta.ts's recordRunEnd) to decide the seal.
 *
 *  It lives on the run rather than being derived, because a restart leaves no
 *  other trace: restartBay rebuilds the bay from the same un-advanced
 *  levelIndex and the carry, scrap and ratchets survive untouched — which is
 *  exactly what makes "cleared it without one" worth marking. Tier S never
 *  increments it; the sandbox files to its own board and climbs no ladder. */
restarts: number;
```

In `newRun`'s returned object, beside `linesTotal`:

```ts
restarts: 0,
```

- [ ] **Step 2: Write the failing check**

In `sim/systems.ts`, in the `recordRunEnd` section:

```ts
check("a fresh run has taken no restarts", newRun(1).restarts === 0);
```

- [ ] **Step 3: Run it**

Run: `cd app && npm test`
Expected: `ok` (this one is a guard on the default, not a bug reproduction).

- [ ] **Step 4: Typecheck**

Run: `cd app && npm run typecheck`
Expected: clean — this is what makes Task 5's `this.run.restarts += 1` legal.

- [ ] **Step 5: Commit**

```bash
git add app/src/game/run.ts app/sim/systems.ts
git commit -m "A run counts the bays it restarted"
```

---

### Task 7: The seal in meta state

**Files:**
- Modify: `app/src/game/meta.ts` — `MetaState` (~line 354), `newMeta`
  (~line 391), `recordRunEnd` (~line 529)
- Modify: `app/src/lib/store.ts` — `loadMeta` (~line 137)
- Modify: `app/src/main.ts` — the `recordRunEnd(...)` call (line 2426)
- Modify: `app/sim/systems.ts` — the `recordRunEnd` section

**Interfaces:**
- Consumes: `RunState.restarts` from Task 6.
- Produces:
  - `MetaState.sealedMarks: number[]`
  - `recordRunEnd(meta, runMark, won, bayReached, restarts)` — the fifth
    parameter is new.

- [ ] **Step 1: Write the failing checks**

```ts
{
  const clean = recordRunEnd(newMeta(), 1, true, 5, 0);
  check("a run won without a restart is sealed", clean.meta.sealedMarks.includes(1));
  const messy = recordRunEnd(newMeta(), 1, true, 5, 3);
  check("a run won after a restart is not sealed", !messy.meta.sealedMarks.includes(1));
  const lost = recordRunEnd(newMeta(), 1, false, 5, 0);
  check("a run LOST without a restart is not sealed", !lost.meta.sealedMarks.includes(1));
  // The seal is cosmetic by construction (docs/DESIGN.md: nothing purchasable
  // may move the ladder). A second axis that paid out would be exactly that.
  check(
    "sealing pays nothing and moves no Mark",
    clean.meta.mark === recordRunEnd(newMeta(), 1, true, 5, 9).meta.mark
      && clean.salvage === recordRunEnd(newMeta(), 1, true, 5, 9).salvage,
  );
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npm test`
Expected: FAIL — `recordRunEnd` takes four arguments and `sealedMarks` does not
exist. A typecheck error is a legitimate failure here.

- [ ] **Step 3: Add the field**

In `MetaState`:

```ts
/** Marks beaten in a single run with ZERO bay restarts — the seal, drawn on
 *  that floor of the tower.
 *
 *  A list rather than a flag because `mark` is a high-water number and the
 *  tower draws every floor: each one needs its own answer, and a player who
 *  sealed Mark 3 keeps that after Mark 4 falls messily.
 *
 *  Cosmetic by construction. It must never feed salvage, a loadout budget or
 *  `mark` — docs/DESIGN.md's rule is that nothing purchasable moves the
 *  ladder, and a seal that paid out would be a second progression axis wearing
 *  a badge. */
sealedMarks: number[];
```

`newMeta()` gains `sealedMarks: []`.

- [ ] **Step 4: Seal in `recordRunEnd`**

```ts
export function recordRunEnd(
  meta: MetaState, runMark: number, won: boolean, bayReached: number, restarts = 0,
): TierResult {
  const tier = markUnlocked(meta);
  const newlyDone = !meta.tierRunDone && won && runMark === tier;
  const share = newlyDone ? tierMilestoneSalvage(tier) : 0;
  // The seal is not gated on runMark === tier the way the tier bookkeeping is:
  // flying an already-beaten Mark clean is still flying it clean, and the badge
  // is on THAT floor. It pays nothing either way, so nothing can be farmed.
  const sealed = won && restarts === 0 && !meta.sealedMarks.includes(runMark)
    ? [...meta.sealedMarks, runMark]
    : meta.sealedMarks;
  const next: MetaState = {
    ...meta,
    runs: meta.runs + 1,
    bestBay: Math.max(meta.bestBay, bayReached),
    salvage: meta.salvage + share,
    tierRunDone: meta.tierRunDone || newlyDone,
    sealedMarks: sealed,
  };
  const result = advanceTier(next);
  return { ...result, salvage: result.salvage + share };
}
```

`restarts` defaults to 0 so existing callers keep compiling; update the real
call in `main.ts:2426`:

```ts
const result = recordRunEnd(this.meta, this.run.mark, won, this.run.levelIndex + 1, this.run.restarts);
```

- [ ] **Step 5: Defensive read in `loadMeta`**

Beside the `claimedContracts` read, matching its fail-closed style:

```ts
// Same fail-closed reading as the lists above: a corrupt value loads as "no
// seals" rather than as free ones. Entries are clamped to whole non-negative
// Marks so a hand-edited save cannot put a badge on a floor that isn't there.
if (!Array.isArray(meta.sealedMarks)) meta.sealedMarks = [];
meta.sealedMarks = meta.sealedMarks
  .filter((m): m is number => Number.isFinite(m))
  .map((m) => Math.max(0, Math.floor(m)));
```

- [ ] **Step 6: Run the tests**

Run: `cd app && npm test && npm run typecheck`
Expected: all four new checks `ok`, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/game/meta.ts app/src/lib/store.ts app/src/main.ts app/sim/systems.ts
git commit -m "A Deep Run cleared without a restart seals that Mark"
```

---

### Task 8: The seal on the tower floor

**Files:**
- Modify: `app/src/ui/screens.ts` — `TowerState` (~line 180), `floorHTML`
  (~line 241)
- Modify: `app/src/main.ts` — `towerState()` (~line 997)
- Modify: `app/src/styles/app.css` — beside the `.tower__floor` rules
- Modify: `app/sim/systems.ts`

**Interfaces:**
- Consumes: `MetaState.sealedMarks` from Task 7.
- Produces: `TowerState.sealed: number[]`.

- [ ] **Step 1: Write the failing check**

`sim/systems.ts` is string-only, so check the markup, not the pixels:

```ts
{
  const base: S.TowerState = { unlocked: 3, selected: 3, god: false, sealed: [2] };
  const html = S.tierTowerHTML(base);
  check("a sealed floor is marked", html.includes("tower__seal"));
  check(
    "an unsealed floor is not",
    (html.match(/tower__seal/g) ?? []).length === 1,
    `${(html.match(/tower__seal/g) ?? []).length} seals for one sealed Mark`,
  );
  // The distinction must survive a viewer who cannot separate the hues: the
  // seal is a SHAPE on the floor, and its accessible name says so in words.
  check("the seal is named, not merely coloured", html.includes("sealed"));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `sealed` is not on `TowerState` (a typecheck error counts).

- [ ] **Step 3: Add `sealed` to `TowerState` and render it**

```ts
/** Marks cleared in one run with no bay restart (meta.ts's sealedMarks).
 *  Absent reads as none, so every caller that predates the seal renders the
 *  tower it always did. */
sealed?: number[];
```

In `floorHTML`, after `windows`:

```ts
// The seal: a Mark cleared in a single unbroken run. A SHAPE stamped on the
// floor plate, never a tint — this project's palette is full at 13 swatches,
// and a distinction carried by hue alone is invisible to a red-green viewer.
// It also joins the floor's accessible name, so it is not a decoration a
// screen reader has no way to reach.
const isSealed = !god && (state.sealed ?? []).includes(tier);
const seal = isSealed ? `<span class="tower__seal" aria-hidden="true"></span>` : "";
```

Append `seal` to the returned markup and extend the `aria-label`:

```ts
` aria-label="${label}${open ? "" : " — locked"}${isSealed ? " — sealed" : ""}">`
```

- [ ] **Step 4: Feed it from meta**

In `main.ts`'s `towerState()`, in the state object:

```ts
sealed: this.meta.sealedMarks,
```

- [ ] **Step 5: Style it without changing the floor's height**

In `app.css`, beside the `.tower__floor` rules:

```css
/* THE SEAL — a Mark that fell in one unbroken run.
   Positioned, never flowed: the tower's height arithmetic is a 44px-per-floor
   budget the shaft depends on (layout.ts), and a badge taking part in the flex
   flow would push every floor and cost the shaft a rung on short viewports.

   It is a SHAPE, not a tint. The palette is full at 13 swatches and a
   distinction carried by hue alone is invisible to a red-green viewer, so the
   seal has to be recognisable in a greyscale screenshot: an octagonal stamp
   pressed into the plate, notched on the diagonal. currentColor rather than a
   swatch, so it inherits the floor's own state (locked floors dim with the
   windows instead of keeping a bright badge on a dark building). */
.tower__floor { position: relative; }
.tower__seal {
  position: absolute;
  right: 0.45em;
  top: 50%;
  translate: 0 -50%;
  width: 0.62em;
  height: 0.62em;
  background: currentColor;
  opacity: 0.85;
  clip-path: polygon(
    30% 0%, 70% 0%, 100% 30%, 100% 70%,
    70% 100%, 30% 100%, 0% 70%, 0% 30%
  );
}
```

Sized in `em` so it tracks the floor's own type scale rather than pinning a
pixel size the 44px budget would then have to absorb. Before calling it done,
view the tower through a deutan simulation and confirm the sealed floor is
still the one that reads differently.

- [ ] **Step 6: Run both harnesses**

Run: `cd app && npm test`
Expected: the three new checks `ok`.

Run: `cd app && npx tsx sim/uifit/run.ts`
Expected: **`new` count 0**. The baseline holds 139 accepted entries — read the
`new` count, not the total. A new entry means the seal changed a layout and
must be accounted for, not accepted blindly.

- [ ] **Step 7: Commit**

```bash
git add app/src/ui/screens.ts app/src/main.ts app/src/styles/app.css app/sim/systems.ts
git commit -m "The tower marks a Mark that fell in one unbroken run"
```

---

### Task 9: Say the gesture exists

**Files:**
- Modify: `app/src/ui/screens.ts` — `hintStripHTML` (~line 1790)
- Modify: `app/sim/systems.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

A gesture nobody is told about is a gesture nobody uses. The strip renders from
live bindings, so this is data, not a hardcoded string.

- [ ] **Step 1: Note the branch shape before editing**

`hintStripHTML` currently splits **gamepad vs everything else**; the `else` arm
serves both keyboard and touch and ends with `part("drag to aim")`. The hold is
a touch gesture — on a fine pointer the rail is hidden entirely
(`@media (pointer: fine)`). So the hint belongs on the touch path only, which
means the `else` arm needs to distinguish `profile === "touch"`.

- [ ] **Step 2: Write the failing check**

```ts
{
  const owned = { bond: false, demo: false, auto: false };
  const touch = S.hintStripHTML("touch", owned);
  check("touch is told the pause button restarts", /hold.*restart/i.test(touch));
  const keys = S.hintStripHTML("keyboard", owned);
  check(
    "the keyboard strip does not name a gesture it cannot make",
    !/hold.*restart/i.test(keys),
  );
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd app && npm test`
Expected: FAIL on the first check.

- [ ] **Step 4: Add the hint**

In the non-gamepad arm, guarded on the touch profile, after `"drag to aim"`:

```ts
if (profile === "touch") part(`${kbd("Hold")} pause to restart`);
```

The word, not a `⏸` glyph. The strip renders in the game's display face and an
unsupported codepoint would come back as tofu on exactly the Android devices
this hint is for — and the surrounding hints are all words already.

- [ ] **Step 5: Run both harnesses**

Run: `cd app && npm test`
Expected: both new checks `ok`.

Run: `cd app && npx tsx sim/uifit/run.ts`
Expected: `new` count 0. The strip is width-budgeted — `screens.ts:1797-1802`
records that loose text nodes once padded a full loadout's strip to 951px,
wider than a 900px window. If the extra hint overflows on a narrow device, drop
it when the loadout is full rather than shrinking the type.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/screens.ts app/sim/systems.ts
git commit -m "The hint strip names the hold-to-restart gesture"
```

---

### Task 10: Verify on the device and open the PR

**Files:** none — this is the verification gate.

- [ ] **Step 1: Full local verification**

Run, from `app/`:

```bash
npm run typecheck
npm test
npx tsx sim/uifit/run.ts
```

Expected: typecheck clean, every check `ok`, uifit `new` count 0. **Quote the
actual output in the PR — do not assert success from memory.**

- [ ] **Step 2: Build and install the debug APK**

Run: `cd app && npm run android:apk`, then install to the USB device. Wireless
adb does not work on this network — USB only. If the install is refused for a
signature mismatch, the device is on a Play build; uninstall first.

- [ ] **Step 3: Play the reported case**

Take a pattern Contract to an empty manifest with the last line's cubes on the
floor and confirm the compactor is allowed to finish it. Then confirm a bay
with cubes stranded still ends promptly rather than sitting at the backstop.

- [ ] **Step 4: Confirm the gesture on-device by selector**

Over adb + CDP as in Task 5, Step 5: a completed hold restarts and does not
open the pause modal; a short hold pauses and does not restart.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin claude/bay-end-convergence-and-reset
gh pr create --base staging --title "The bay ends when the press stops, not after one stroke" --body "..."
```

`--base staging` is not optional — `gh` defaults to `main`, and `main` lags
`staging` by a long way and lacks whole harnesses.

The PR body should carry: the device readout that started this (3/4 lines, 6/6
shipments, `cubesWasted === 0`), the measured epsilons from Task 2 with their
sample count, the sweep result from Task 4 Step 5, and the uifit `new` count.
