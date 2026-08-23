# Contract plant panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the Contract plant panel to the same 154.6px footprint a Deep Run bay uses, and fill it with the three facts a Contract has and currently discards — cubes lost, the bay's own conditions, and the tier the clear counts toward.

**Architecture:** Four layers, in dependency order. `contracts.ts` grows a `conditions` field (the complications, separated from the card's `brief`). `screens.ts`'s `hudHTML` renders three new bits of markup behind the existing `contract` branch. `main.ts` supplies the values and live-syncs the one that changes. `app.css` swaps `min-height: 0` for `justify-content: flex-start`. Tests come from two existing harnesses: `sim/systems.ts` for markup strings, `sim/uifit` for real pixels on 13 devices.

**Tech Stack:** TypeScript, no framework — the HUD is a template string in `screens.ts` re-rendered on state change and patched per-frame by `main.ts`'s `syncHud`. Vanilla CSS with `--fpx`-scaled sizes. Tests are `tsx` scripts, not a test runner: `sim/systems.ts` asserts on markup strings, `sim/uifit/run.ts` drives Playwright against a baseline.

---

## Read first

The spec: `docs/superpowers/specs/2026-08-24-contract-plant-panel-design.md`.

Two things about this codebase that will not be obvious:

**`sim/systems.ts` cannot measure pixels.** It imports `hudHTML` and asserts on
the returned string. Every check in it is `check(name, cond, detail)` where
`cond` is a boolean — usually `html.includes(...)` or a regex. Do not write a
check that claims to measure layout; it cannot. Pixel assertions belong in
`sim/uifit`.

**`sim/uifit` runs against a baseline.** `baseline.json` records violations that
exist today, keyed `device|screen|assertion`. The run fails on anything NOT in
it, and ALSO fails when a baselined violation stops reproducing without being
removed. The `plant` assertion is one-sided (`h > design + 1`), so growing the
Contract panel back to exactly `0.4296 * --field-h` passes.

Run everything from `app/`:

```bash
cd app
```

---

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `app/src/game/contracts.ts` | Modify | Add `Contract.conditions`; redefine `brief` in terms of it |
| `app/src/ui/screens.ts` | Modify | `hudHTML` — `Lost` column, `Bay` row, `Tier` row; widen the `contract` option type |
| `app/src/main.ts` | Modify | `hudOpts` supplies the three values; `syncHud` writes `#hud-lost` |
| `app/src/styles/app.css` | Modify | Swap the height rules; add `.pl-tier` |
| `app/sim/systems.ts` | Modify | Markup assertions for all of the above |
| `app/sim/uifit/fixtures.ts` | Modify | Feed the two Contract screens the new fields |

---

## Task 1: `Contract.conditions`

The complications, split out from the card's one-line `brief`. A lines
Contract's brief already IS its complications; a pattern Contract's brief leads
with a shipment count the plant panel shows twice over already.

**Files:**
- Modify: `app/src/game/contracts.ts`
- Test: `app/sim/systems.ts`

- [ ] **Step 1: Write the failing test**

Find the Contracts section in `sim/systems.ts`:

```bash
grep -n 'section("Contract' sim/systems.ts
```

Add this block at the end of that section (immediately before the next
`section(` call), inside a fresh `{ }` scope so its locals do not leak:

```ts
// `conditions` is what the PLANT panel shows and `brief` is what the CARD
// shows. They are the same string on a lines Contract and differ by the
// shipment-count prefix on a pattern one, which the panel already states as
// its Shipments column and its manifest row. Pinned in both directions: the
// card must not change, and the panel must not repeat itself.
{
  const lines = generateContract(20260824, 6, 0);
  check("a lines Contract's conditions are its brief",
    lines.kind === "lines" && lines.conditions === lines.brief,
    `${lines.kind}: ${lines.conditions} / ${lines.brief}`);
  check("a lines Contract states conditions, never empty",
    lines.conditions.length > 0, lines.conditions);

  const pattern = generateContract(20260824, 6, PATTERN_SLOT);
  check("a pattern Contract's brief is its shipment count plus its conditions",
    pattern.brief === `${pattern.queue.length} shipments · ${pattern.conditions}`,
    `${pattern.brief} !== ${pattern.queue.length} shipments · ${pattern.conditions}`);
  check("a pattern Contract's conditions do not repeat the shipment count",
    !pattern.conditions.includes("shipments"), pattern.conditions);

  // Every variant, not just the one today's seed rolled: the tail is a switch
  // and a case that forgot to drop the prefix would pass on one draw.
  for (const v of VARIANTS) {
    const c = generateContract(20260824, 9, PATTERN_SLOT, v.id);
    check(`variant ${v.id} splits brief into count + conditions`,
      c.brief === `${c.queue.length} shipments · ${c.conditions}`,
      `${c.brief} / ${c.conditions}`);
  }
}
```

No import changes needed: `generateContract`, `PATTERN_SLOT` and `VARIANTS` are
already in `sim/systems.ts`'s import from `../src/game/contracts` (verified).

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: TypeScript errors on `.conditions` (property does not exist on
`Contract`), or if you added the field first, `FAIL` lines for the pattern
checks. Either is the failure this step wants. If it passes, the test is not
testing anything — stop and fix the test.

- [ ] **Step 3: Add the field to the interface**

In `contracts.ts`, next to `brief` in the `Contract` interface:

```ts
  /** One-line brief shown on the card. */
  brief: string;
  /** The complications alone — what the bay imposes, with nothing the plant
   *  panel already states beside it. `brief` is this plus whatever the CARD
   *  needs and the panel does not: on a pattern Contract, the shipment count
   *  (the panel has it as a readout column and as a manifest row). Split so the
   *  HUD does not have to do string surgery on a generated sentence, and so the
   *  card cannot change when the panel does. */
  conditions: string;
```

- [ ] **Step 4: Populate it on a lines Contract**

Find `brief: notes.length ? notes.join(" · ") : "clean bay",` near the end of
the lines generator and replace that single line with:

```ts
    brief: linesConditions(notes),
    conditions: linesConditions(notes),
```

Add the helper above `generateContract`:

```ts
/** A lines Contract's complications. "clean bay" rather than an empty string
 *  because the plant panel renders this row on every Contract — a row that
 *  appears only when the generator happened to spend its budget would shift
 *  every row above it between one card and the next. */
function linesConditions(notes: readonly string[]): string {
  return notes.length ? notes.join(" · ") : "clean bay";
}
```

- [ ] **Step 5: Populate it on a pattern Contract**

Rename `patternBrief` to `patternConditions` and drop the `${n} · ` prefix from
every `return`, deleting the now-unused `n` local:

```ts
function patternConditions(
  spec: VariantSpec, queue: readonly PieceType[], shapes: number,
  size: PieceSize, standing: readonly number[],
): string {
  // Std calls out the SHAPE count, because that (not the shipment count) is what
  // makes one tetromino pattern harder than another. Tiny has exactly one shape
  // by construction, so "1 shape" there would read as a bug rather than a
  // difficulty — it names the payload instead.
  const cargo = size === "tiny"
    ? "dominoes"
    : `${shapes} shape${shapes === 1 ? "" : "s"}`;
  switch (spec.id) {
    case "single":
      // Never names the TYPE on a domino belt: every domino is the same tile,
      // so "all L" would describe a distinction that does not exist on the
      // field. patternSize keeps this variant on tetrominoes, and this is the
      // second lock on the same door.
      return size === "tiny"
        ? `${cargo}, no waste`
        : `all ${queue[0] ?? "I"}, no waste`;
    case "short":
      return `${spec.lineCells}-cell lines, no waste`;
    case "rebar":
      return `rebar, nothing shatters, no waste`;
    case "salvage":
      return `${standing.reduce((a, h) => a + h, 0)} cubes already down, no waste`;
    case "blind":
      return `${cargo}, no preview, no waste`;
    case "guided":
      return `magnetic, self-squaring, no waste`;
    default:
      return `${cargo}, no waste`;
  }
}
```

In `generatePatternContract`, replace the `brief:` line with:

```ts
    brief: `${queue.length} shipments · ${patternConditions(spec, queue, shapes, size, standing)}`,
    conditions: patternConditions(spec, queue, shapes, size, standing),
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, and `ok` for every check added in Step 1. Any other
`FAIL` in the Contracts section means a fixture elsewhere constructs a
`Contract` literal and now misses `conditions` — fix those literals, do not make
the field optional.

- [ ] **Step 7: Commit**

```bash
git add app/src/game/contracts.ts app/sim/systems.ts
git commit -m "Contracts: split the complications out of the card's brief"
```

---

## Task 2: The `Lost` readout column

`.pl-read` is a three-column row. A Deep Run fills the third with Time; a
Contract has no clock, so it renders empty. Lines Contracts fill it with cubes
lost — the quiet drain on a launch budget, invisible today.

**Files:**
- Modify: `app/src/ui/screens.ts`
- Test: `app/sim/systems.ts`

- [ ] **Step 1: Write the failing test**

Add to the same `{ }` block style, at the end of the HUD section in
`sim/systems.ts`. Find it with:

```bash
grep -n 'const rail = hud.slice' sim/systems.ts
```

Add after that block's closing `}`:

```ts
// The Contract plant panel's three additions. A Contract has no clock, so the
// third readout column renders empty — on a LINES Contract it carries cubes
// lost instead. Not on a pattern one: SPARE_SHIPMENTS is 0, so the margin is 0
// on frame one and one stranded cube ends the attempt — and the count never
// even reaches 1, because cubesAvailable stops counting a cube when it starts
// blinking, so objectiveUnreachable fires 1.4s before lostTotal increments.
{
  const base = {
    beltPreview: { bomb: false, type: "T" as const, quarterTurns: 0, empty: false, hidden: false, material: "standard" as const },
    loaded: { bomb: false, type: "L" as const, quarterTurns: 1, empty: false, hidden: false, material: "standard" as const },
    tier: null, target: 800, score: 200, launchCost: 0, bayNum: 1,
    timeLimitSec: 0, timeLeftMs: 0, pieceSize: "std" as const,
    bondBreakerOwned: false, bondCharges: 0, demoOwned: false, bombCharges: 0,
    autoloaderOwned: false, ratchets: {}, tiers: newTiers(),
  };
  const progress = { tier: 1, runDone: false, contracts: 0, needed: 3, award: 45, milestone: 15 };
  const linesHud = hudHTML({
    ...base,
    contract: {
      name: "Foundry Overrun", kind: "lines", goal: 5, lines: 2, launchesLeft: 9,
      remaining: [], lost: 7, conditions: "crosswind · cryo shipments", progress,
    },
  });
  const patternHud = hudHTML({
    ...base,
    contract: {
      name: "Cold Storage Backlog", kind: "pattern", goal: 4, lines: 1, launchesLeft: 6,
      remaining: ["I", "O", "T"], lost: 0, conditions: "3 shapes, no waste", progress,
    },
  });

  check("a lines Contract fills the empty clock column with cubes lost",
    linesHud.includes('id="hud-lost"') && linesHud.includes(">7<"));
  check("a pattern Contract does not — its margin is 0 by construction",
    !patternHud.includes('id="hud-lost"'));
  check("neither Contract renders a clock",
    !linesHud.includes('id="hud-time"') && !patternHud.includes('id="hud-time"'));
  check("cubes lost takes no danger treatment — there is no threshold",
    !/pl-lost[^>]*pl-stat--danger/.test(linesHud));
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: typecheck/runtime errors on the unknown `lost`, `conditions` and
`progress` properties, or `FAIL a lines Contract fills the empty clock column`.

- [ ] **Step 3: Widen the `contract` option type**

In `screens.ts`, extend the `contract` option (currently ending
`remaining: PieceType[];`):

```ts
    remaining: PieceType[];
    /** Cubes that bounced out before the compactor (Game.lostTotal). Rendered
     *  as the third readout column on a LINES Contract, where it is the real
     *  drain on a launch budget and the only acknowledgement a lost cube gets
     *  at all (levelForContract zeroes penaltyPerLostPiece, so the "-$" toast
     *  is skipped). The column a Deep Run gives its clock currently falls to
     *  the Lines/Goal block, which spends it on a longer goal bar; this buys
     *  back ~29px of that, leaving the bar still longer than a Deep Run's.
     *  Not rendered on a pattern Contract: SPARE_SHIPMENTS is 0, so the margin
     *  is 0 on frame one and one stranded cube ends the attempt — and the count
     *  never reaches 1, because cubesAvailable stops counting a cube when it
     *  starts blinking, so objectiveUnreachable fires 1.4s before lostTotal
     *  increments and the bay is called 0.4s before that. */
    lost: number;
    /** The bay's complications, one line (Contract.conditions). The board card
     *  states these and the bay used to forget them. */
    conditions: string;
    /** Tier standing, for the row that says why this clear is worth having. */
    progress: TierProgress;
```

No import needed: `screens.ts` already imports `type TierProgress` from
`../game/meta` (verified).

- [ ] **Step 4: Render the column**

In `hudHTML`, the Contract branch of `.pl-read` ends with the launches block.
Add a sibling after it, inside the same template literal:

```ts
          <div class="pl-stat pl-launches" id="hud-launches-chip">
            <div class="lbl">${contract.kind === "pattern" ? "Shipments" : "Launches"}</div>
            <div class="v" id="hud-launches">${contract.launchesLeft}</div>
          </div>
          ${
            contract.kind === "lines"
              ? `<div class="pl-stat pl-lost"><div class="lbl">Lost</div><div class="v" id="hud-lost">${contract.lost}</div></div>`
              : ""
          }`
```

No `.pl-stat--danger`: that class means "you are about to run out of the thing
that lets you keep playing" and fires on a threshold. Cubes lost has none — the
launch budget already prices some waste in.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

Expected: typecheck fails only in `main.ts` and `sim/uifit/fixtures.ts`, which
construct the `contract` object and do not yet pass the three new fields. Tasks
4 and 6 fix those. The four checks from Step 1 must print `ok`.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/screens.ts app/sim/systems.ts
git commit -m "Contract HUD: cubes lost takes the empty clock column"
```

---

## Task 3: The `Bay` and `Tier` rows

Two dense lines built on `.pl-notch` — the row shape already proven to carry a
label plus a mono value at ~8px on a phone.

**Files:**
- Modify: `app/src/ui/screens.ts`
- Modify: `app/src/styles/app.css`
- Test: `app/sim/systems.ts`

- [ ] **Step 1: Write the failing test**

Append to the block added in Task 2, Step 1 (inside the same `{ }`, after the
last `check`):

```ts
  check("a Contract states the bay's conditions in the panel",
    linesHud.includes('id="hud-conditions"') && linesHud.includes("crosswind · cryo shipments"));
  check("a pattern Contract states its variant's conditions",
    patternHud.includes("3 shapes, no waste"));
  check("a Contract states the tier the clear counts toward",
    linesHud.includes('class="pl-tier"') && linesHud.includes("Tier 1") && linesHud.includes("0/3"));
  check("a Deep Run bay renders neither row — it has notches instead",
    (() => {
      const run = hudHTML({ ...base, contract: null, timeLimitSec: 150, timeLeftMs: 90_000 });
      return !run.includes('id="hud-conditions"') && !run.includes('class="pl-tier"')
        && run.includes('id="hud-notches"');
    })());
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: `FAIL a Contract states the bay's conditions in the panel` and
`FAIL a Contract states the tier the clear counts toward`.

- [ ] **Step 3: Render both rows**

In `hudHTML`, the `.pl-notch` block is guarded `contract ? "" : ...`. Add these
two blocks immediately after it, before the Build row:

```ts
        ${
          // The bay's own complications — the Contract analogue of the notch
          // line above, and the same row shape for the same reason: a list
          // whose length the panel does not control belongs on a row that can
          // scroll its tail. The board card states these and the bay used to
          // forget them the moment it started.
          //
          // Rendered on EVERY Contract, so the row is at the same height on
          // every card. It cannot be empty: budgetForTier never returns below
          // 2, wind costs 2 and is the one complication with no gate, so the
          // notes list always gets an entry (0 empties in 72,000 generated
          // Contracts). contracts.ts's "clean bay" fallback is a guard against
          // a future budget change, not a state this row renders.
          // NOT `.pl-mods`: that row is
          // display:none at compact density and never renders in a Contract at
          // all (levelForContract zeroes the ability charges and hudOpts hands
          // `tiers: {}`), so conditions placed there would be invisible on
          // every phone.
          contract
            ? `<div class="pl-notch"><span class="lbl">Bay</span><b id="hud-conditions">${contract.conditions}</b></div>`
            : ""
        }
        ${
          // Why this bay is worth playing. The board states the deal — tier,
          // clears needed, salvage a first clear banks — and the bay dropped
          // it. Static for the length of an attempt, which is why it is a line
          // and not a readout column.
          contract
            ? `<div class="pl-tier"><span class="lbl">Tier ${contract.progress.tier}</span><b>${contract.progress.contracts}/${contract.progress.needed} ${icon("salvage", 9)} ${contract.progress.milestone}</b></div>`
            : ""
        }
```

`icon("salvage", …)` is a real inline-SVG name (verified in `src/ui/icons.ts`,
which gave scrap and salvage a glyph each rather than sharing the `♻`
character). Use it rather than the character — that is the panel's convention,
and the two currencies were deliberately given a glyph each.

Note B5 in `sim/systems.ts` does NOT guard this row, contrary to what an earlier
draft of this plan said. B5 builds its HUD with `contract: null`, so neither new
row is in the string it scans, and its slice runs `side-rail` → `bay-banner`,
stopping before `.plant` entirely. Nothing enforces the no-dingbat rule here —
which is a reason to follow the convention deliberately, not a licence to skip
it.

- [ ] **Step 4: Style `.pl-tier`**

In `app.css`, immediately after the `.pl-notch__none` rule, add:

```css
/* The tier line — the same label-plus-mono-value row as .pl-notch and .pl-queue,
   so it inherits their optical correction below rather than restating it. Its
   own class only because its value is a fixed fact for the length of a bay: no
   scrolling tail to manage, and nothing to colour by axis kind. */
.pl-tier {
  margin-top: 2px;
  display: flex; align-items: baseline; gap: max(4px, calc(8 * var(--fpx)));
  font-family: var(--font-pixel); font-size: max(6px, calc(10.7 * var(--fpx)));
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted);
  min-width: 0;
}
.pl-tier b {
  display: flex; align-items: baseline; gap: max(3px, calc(5 * var(--fpx)));
  font-family: var(--font-mono); font-weight: 700; color: var(--warn);
  white-space: nowrap; min-width: 0;
}
```

Then add `.pl-tier b` to the optical-correction rule so it lifts with the other
two mono-beside-pixel rows:

```bash
grep -n "pl-notch b, .pl-queue b" src/styles/app.css
```

Change that selector to:

```css
.pl-notch b, .pl-queue b, .pl-tier b { position: relative; top: calc(-1 * var(--pixel-optical-drop)); }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test
```

Expected: all four checks from Step 1 print `ok`. Typecheck still fails in
`main.ts` and `fixtures.ts` until Tasks 4 and 6.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/screens.ts app/src/styles/app.css app/sim/systems.ts
git commit -m "Contract HUD: the bay's conditions and the tier it counts toward"
```

---

## Task 4: Wire the values through `main.ts`

**Files:**
- Modify: `app/src/main.ts`

- [ ] **Step 1: Confirm the build is red for the right reason**

```bash
npm run typecheck
```

Expected: errors in `src/main.ts` — the object literal passed as `contract` is
missing `lost`, `conditions` and `progress`. This is the failing state Task 2
predicted; it is what this task fixes.

- [ ] **Step 2: Supply the three fields in `hudOpts`**

In `hudOpts`, the `contract` object currently ends `remaining: g.piecesRemaining,`.
Add after it:

```ts
            remaining: g.piecesRemaining,
            // Cubes off the deck. On a lines Contract this is the launch
            // budget quietly draining — launchesFor priced the bay against
            // PLANNING_EFFICIENCY, and every cube lost is that margin being
            // spent. The panel renders it on lines Contracts only; see
            // screens.ts's hudHTML for why a pattern bay cannot use it.
            lost: g.lostTotal,
            conditions: this.contract.conditions,
            progress: tierProgressFor(this.meta),
```

Task 2's review flagged one thing in this file to fold in here: telemetry calls
this same number `lostPieces` (`main.ts:1257, 1292`) while it counts CUBES. That
naming is pre-existing and a persisted field is not worth renaming, but Task 2
makes the number player-visible for the first time, so anyone reconciling
telemetry against the HUD will be comparing `lostPieces` to a cube count. Add a
one-line comment at the telemetry call site saying so. Verify the field really
is persisted before deciding not to rename it.

`tierProgressFor` is already imported in `main.ts` — confirm:

```bash
grep -n "tierProgressFor" src/main.ts | head -3
```

- [ ] **Step 3: Live-sync the one value that changes**

In `syncHud`, inside the existing `if (this.contract) { ... }` branch, after the
`set("#hud-launches", ...)` call:

```ts
      // Only on a lines Contract — the element does not exist on a pattern one
      // (screens.ts's hudHTML), and `set` no-ops on a missing node anyway. The
      // other two Contract rows are fixed for the length of a bay and are
      // rendered once.
      set("#hud-lost", String(g.lostTotal));
```

- [ ] **Step 4: Verify the build is green**

```bash
npm run typecheck
```

Expected: clean, apart from `sim/uifit/fixtures.ts` (Task 6).

- [ ] **Step 5: Commit**

```bash
git add app/src/main.ts
git commit -m "Contract HUD: feed the panel its three new facts"
```

---

## Task 5: Restore the footprint

The one-line change the whole plan exists to make safe.

**Files:**
- Modify: `app/src/styles/app.css:1292`

- [ ] **Step 1: Swap the rules**

Find it:

```bash
grep -n "hud--contract .plant { min-height: 0; }" src/styles/app.css
```

Replace that single line with:

```css
.hud--contract .plant__body { justify-content: flex-start; }
```

- [ ] **Step 2: Rewrite the comment above it**

The block comment immediately above currently argues for releasing the floor.
Replace its last two paragraphs (from "What IS here is the other half of that"
through the end of the comment) with:

```
   What IS here is the other half of that: a Contract's rows hug the TOP of the
   panel instead of being spread down it. `.plant__body` uses
   `justify-content: space-between`, which is right for a Deep Run's five rows
   and wrong for a Contract's four or five — it pushed the last row to the floor
   of the panel and left a hand's width of nothing above it. Top-aligning them
   fixes that WITHOUT giving up the footprint, which is what releasing
   `min-height` did and should not have: the panel is BOTTOM-anchored, so a
   shorter panel does not sit lower in the same box — its top edge moves. Two
   Contracts on one board put it 17px apart and a Deep Run 85px away, so the
   readout had to be re-found per mode and per card. The leftover height is one
   band of air at the bottom now, and the panel starts in the same place in
   every mode.

   The gap is stated rather than distributed for the same reason it was before:
   `space-between` was what put air between the rows, and flex-start distributes
   none. 18 --fpx is chosen against what the Deep Run panel actually spreads to,
   which is not one number and cannot be matched by one: it is leftover space,
   so it lands anywhere from 4.3px (iPhone 13 mini, where the readout nearly
   fills the box) to 16.8px (iPhone 16 Pro Max) at the SAME density. 18 --fpx
   gives 9px on the budget phone, 10px on a Pixel 7 and 19px on an iPad Pro —
   inside that range on every device in the matrix, and even, which the
   distributed gap is not. The per-row margins go with it: they were nudges on
   top of a distributed gap, and on an explicit one they only make the rhythm
   uneven again.

   `justify-content` reaches this panel at every density. Deep Run's
   `.plant__body` becomes a named-area grid at compact, where it would be inert
   — but a Contract already opts out of that grid further down, because the
   template names `notch` and `meta` rows a Contract does not render. It is a
   flex column at every density, which is why one rule suffices. Do not
   re-template it as a grid to fit the rows above.
```

- [ ] **Step 3: Verify nothing else claims the old behaviour**

```bash
grep -n "min-height: 0" src/styles/app.css | grep -i contract
```

Expected: no output.

- [ ] **Step 3b: Two `.pl-stat` corrections Task 2's review deferred here**

Task 2 added a THIRD `.pl-stat` column (`Lost`, lines Contracts only). Two
things in this file were written for two and are now wrong or newly relevant.
Both were deliberately left for this task, which already opens the stylesheet.

The comment at `app.css:1118-1122` says "Tier-2 stat columns (launches, time)"
and "The **two** tier-2 columns need to read as SEPARATE numbers". Correct it to
name the third and say when it appears.

`Lost` is also the first stat column on this panel whose width is set by its
VALUE rather than its label. The rule the layout depends on (see the note near
`app.css:3941`) is that each stat column is as wide as its 8-glyph label, not
its 2-digit value. "LOST" is 4 glyphs — roughly 14.4px at the compact floor,
against ~18px for two mono digits — so the column flips to value-dominated at
10, and crossing 9 → 10 shifts the Launches number left and shortens the goal
bar by ~4-5px. Phones only; non-compact stays label-pinned, and three digits is
unreachable in practice. Decide deliberately rather than by default: either
accept the one small jump per bay, or pin it with a `min-width` on `.pl-lost`
sized for two digits. If you pin it, say the measured numbers in the comment.

Re-derive those figures from the stylesheet before acting on them.

- [ ] **Step 4: Commit**

```bash
git add app/src/styles/app.css
git commit -m "Contract HUD: top-align the rows, keep the footprint"
```

---

## Task 6: Cover it on 13 devices

**Files:**
- Modify: `app/sim/uifit/fixtures.ts`

- [ ] **Step 1: Confirm the harness is red for the right reason**

```bash
npm run typecheck
```

Expected: errors in `sim/uifit/fixtures.ts` — both Contract fixtures are missing
`lost`, `conditions` and `progress`.

- [ ] **Step 2: Feed the pattern fixture**

In `fixtures.ts`, the `"hud-contract"` fixture's `contract` object gains:

```ts
        remaining: ["I", "O", "T", "L", "J", "S"] as PieceType[],
        lost: 0,
        // The variant tail alone (contracts.ts's patternConditions) — the
        // shipment count is the Shipments column and the manifest row.
        conditions: "6 shapes, no waste",
        progress: PROGRESS,
```

`PROGRESS` is already defined at the top of the file from `tierProgressFor(midMeta())`.

- [ ] **Step 3: Feed the lines fixture at its WIDEST honest state**

The `"hud-contract-lines"` fixture is the panel's shortest state and therefore
the one this change is aimed at. Give its new rows the widest content the
generator can produce, so the row that scrolls is measured scrolling:

```ts
        remaining: [],
        // Two-digit, because a lines Contract can lose a lot of cubes and the
        // column is sized off its label at phone scale.
        lost: 14,
        // Three complications is the cap (contracts.ts's maxComplications at
        // tier 9+), and this is the longest set of notes the generator emits —
        // 52 chars, measured across 400 seeds x tiers 1-12.
        conditions: "volatile shipments · tight launch budget · crosswind",
        progress: PROGRESS,
```

- [ ] **Step 4: Update the fixture's comment**

The comment above `"hud-contract-lines"` says the panel is "two rows on a
phone". It is four now. Replace the first sentence with:

```
  // The OTHER Contract kind, and the SHORTEST state the plant panel has: a
  // lines Contract renders no manifest row, so the panel is readout, reload,
  // conditions and tier — four rows, in the restored footprint, with the
  // remainder as air at the bottom. Worth its own screen because it is the case
  // every height change here is aimed at.
```

- [ ] **Step 5: Run typecheck and the string tests**

```bash
npm run typecheck && npm test
```

Expected: both clean.

- [ ] **Step 6: Run the pixel harness**

This step is not optional and cannot be satisfied by a green typecheck. From
Task 3 onward `npm run test:uifit` does not merely mistype — it THROWS
(`TypeError: Cannot read properties of undefined (reading 'tier')` at
`screens.ts`, because the fixtures carry no `progress`). So until Step 5 lands,
NEITHER new row has been measured on any device, and the crash is what is hiding
that. Two things this is the only gate on:

- `.pl-tier b` has `white-space: nowrap` and, unlike `.pl-notch b`, no
  `overflow-x: auto`. That is deliberate — the tier value is short and
  fixed-format — but it means a wide value overflows visibly instead of
  scrolling, and only real pixels can say whether it ever does.
- The Bay row's conditions string is the widest thing either new row carries.

```bash
npm run test:uifit
```

Expected: green.

Task 2's review did the arithmetic on where a failure would come from, which is
worth knowing before you start bisecting: at the compact floor a Deep Run's
`timeCol` is `max(4·0.45·8, 4·0.6·15) + 6 + 5` = 47px, and a lines Contract's
`lostCol` is `max(14.4, 18) + 6 + 5` = 29px, same gap count. So a lines
Contract's `.pl-read` is ~18px ROOMIER than the Deep Run row the width budget
already proves fits `$24680 / 2150`. A `plant` or `twocol` violation on
`hud-contract-lines` therefore almost certainly comes from the Task 3 rows, not
from the Lost column. Re-derive before relying on it.

If `plant` fails on a device, the panel has grown PAST
`0.4296 * --field-h` — that means the new rows do not fit on that device, which
is a real finding: report the device and the measured height rather than
baselining it. If `oneline` or `twocol` fails on the conditions row, the string
is wrapping — that is what the row's horizontal scroll is for, so check
`.pl-notch b`'s `overflow-x: auto` is inherited by the new markup.

- [ ] **Step 7: Commit**

```bash
git add app/sim/uifit/fixtures.ts
git commit -m "uifit: measure the Contract panel's restored rows"
```

---

## Task 7: Verify in the real app

The harnesses prove the panel fits. This proves it is the same panel.

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server**

Use the preview tooling, not a bare shell — `.claude/launch.json` defines
`tetrilaunch-web` on port 5173.

- [ ] **Step 2: Measure all three states**

Drive the app to a Deep Run bay, a pattern Contract and a lines Contract, and in
each read the panel's geometry:

```js
(() => {
  const p = document.querySelector('.plant');
  const b = p.getBoundingClientRect();
  return JSON.stringify({
    h: Math.round(b.height * 10) / 10,
    top: Math.round(b.y * 10) / 10,
    rows: [...p.querySelector('.plant__body').children]
      .map(e => e.className.split(' ')[0] + ':' + Math.round(e.getBoundingClientRect().height * 10) / 10),
  });
})()
```

Dismiss the coach first (`[data-action="coach-skip"]`) — `.hud[data-coach]`
hides most of the panel's rows and has its own larger height cap.

- [ ] **Step 2b: Record the before-numbers for comparison**

Measured on staging at 792x360 compact, coach dismissed, before this plan:

| state | height | top |
| --- | --- | --- |
| Deep Run bay 1 | 154.6 | 194.7 |
| Pattern Contract | 86.1 | 263.2 |
| Lines Contract | 69.1 | 280.2 |

- [ ] **Step 3: Confirm the fix**

All three states must report the same `h` (154.6 at 792x360) and the same `top`
(194.7). A difference of more than 1px between any two is a failure — say which
states differ and by how much rather than accepting it.

- [ ] **Step 4: Confirm the Bay row is height-stable across complication counts**

Play a Contract carrying ONE complication and one carrying THREE, and confirm
the `Bay` row is the same height in both — the row's job is to not move between
cards. Today's board has three Contracts at the player's tier; if all three
carry the same count, raise the tier via the dev sandbox to get a spread.

Do NOT look for a `clean bay` Contract. The generator cannot produce one:
`budgetForTier` never returns below 2, `wind` costs 2 and is the only
complication in the loop with no `continue` gate, and `maxComplications` is
always at least 1 — measured at 0 empties in 72,000 generated lines Contracts.
The `clean bay` string in `contracts.ts` is a guard against a future budget
change, not a state to test through the UI.

- [ ] **Step 5: Commit nothing, report the numbers**

This task produces evidence, not a diff. Report the measured table against the
before-numbers above.

---

## Self-review notes

Spec coverage, section by section:

| Spec section | Task |
| --- | --- |
| 1. Height — swap the two rules | 5 |
| 1. Height — harness bound unchanged | 6 step 6 |
| 2. `Lost` column, lines only | 2 |
| 2. No danger treatment | 2 step 1 (assertion), step 4 (rationale) |
| 2. Why pattern gets nothing here | 2 step 1 (assertion) |
| 3. `Bay` row, `.pl-notch` shape | 3 |
| 3. `Contract.conditions` split | 1 |
| 3. Not the Build row | 3 step 3 (comment) |
| 4. `Tier` row, `.pl-tier` | 3 |
| Touchpoints — contracts.ts | 1 |
| Touchpoints — screens.ts | 2, 3 |
| Touchpoints — main.ts | 4 |
| Touchpoints — app.css | 3, 5 |
| Touchpoints — fixtures.ts | 6 |
| Verification | 6, 7 |

Names used consistently across tasks: `Contract.conditions`, `linesConditions`,
`patternConditions`, `hud-lost`, `hud-conditions`, `.pl-lost`, `.pl-tier`,
`contract.progress`.

## Amendments during execution

Corrections made after a task's review, recorded so the plan matches what was
actually built:

- **After Task 1's code review.** Three plan defects, all fixed above rather
  than left for the implementer to trip on again: Task 6's "longest notes"
  fixture string was 48 chars and the real longest is 52
  (`volatile shipments · tight launch budget · crosswind`); Task 7 Step 4 asked
  for a `clean bay` Contract the generator cannot produce; and Task 3's comment
  claimed the Bay row renders `clean bay`, which it never can. The spec's §3 and
  its verification list carry the same correction.
- **Plan process note.** Task 1's Step 5 code block pasted a function body
  without its doc comment, so following the plan literally deleted four lines of
  design rationale. A plan that pastes a function must paste its doc comment
  too, or say explicitly that it is being replaced.
- **After Task 2's code review.** Two comments in the plan's Task 2 blocks
  asserted mechanisms the code does not have, and both came from the spec, so
  they would have propagated through the remaining tasks. Corrected in both
  documents: `Lost` never reads 1 on a pattern Contract (`cubesAvailable` stops
  counting a cube when it starts blinking, so `objectiveUnreachable` fires 1.4s
  before `lostTotal` increments and the bay is called 0.4s before that); and the
  clock's column is not "dead space" — `.pl-funds` already absorbs it and spends
  it on a longer goal bar, which the Lost column buys ~29px back from. The spec
  also gained the better argument for the column that the review turned up: a
  Contract zeroes `penaltyPerLostPiece`, so today a lost cube is acknowledged
  nowhere at all.
- **Three findings deferred into the tasks that own the files**, rather than
  widening Task 2's scope: the `.pl-stat` "two columns" comment and the
  value-dominated width of `.pl-lost` went to Task 5 Step 3b; the telemetry
  `lostPieces`-counts-cubes note went to Task 4; and Task 6 gained the
  arithmetic saying a `plant` failure there would come from the Task 3 rows, not
  from the Lost column.
- **After Task 3's spec review.** Two plan claims were wrong and are corrected
  above. B5 in `sim/systems.ts` does not guard the Tier row — it builds its HUD
  with `contract: null` and its slice stops before `.plant` — so the `icon()`
  requirement rests on convention, not on a check. And the plan's given comment
  said `levelForContract` "zeroes the ability charges"; it does not call
  `applyUpgrades` at all, the charges simply stay at `makeBaseLevel`'s baked-in
  zero. The implementer caught that one and a scope overclaim unprompted.
- **Branch state, recorded once.** Requiring the three new `contract` fields
  leaves `typecheck` red from Task 2 until Task 4 (`main.ts`) and Task 6
  (`fixtures.ts`) supply them. That is the plan's design and CI only gates on
  `pull_request`, but bisect is broken across those commits. The reason for
  landing all three fields in Task 2 is that `screens.ts` is touched once
  instead of twice — not, as an earlier dispatch claimed, that it keeps every
  intermediate commit green. It does not.
