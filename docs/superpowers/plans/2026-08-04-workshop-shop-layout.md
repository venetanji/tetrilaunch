# Workshop Shop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Workshop shop stops scrolling — 500px of overflow at 792x360 goes to 0 — and the ten option unlocks get glyphs so they read as the same kind of thing as the seven ship systems.

**Architecture:** Two changes that only work together. The shop card becomes a row (`1fr auto`: body, price) inside the existing `@media (max-height: 460px)` block, taking it from 122px to ~40px. Systems and Options become tabs, so only one section renders. Tab state lives on `App` because `renderOverlay()` rewrites `overlay.innerHTML` wholesale on every purchase.

**Tech Stack:** TypeScript, no test framework — `sim/systems.ts` is a hand-rolled `check(desc, cond, detail)` harness run with `npx tsx sim/systems.ts`. 390 checks pass today.

**Spec:** `docs/superpowers/specs/2026-08-04-workshop-shop-layout-design.md`

**Superseded in part (2026-08-24): the tab bar this plan builds has been
REVERTED.** Task 2 below, the `shop-tab` action, the `workshopTab` field and the
one-pane-at-a-time shop are all gone; the Workshop is one shelf carrying systems
and options together, with the budget readout in the fixed `.workshop__aside`
column rather than on the deleted tab bar. `sim/systems.ts` now asserts the
opposite of what Task 2's checks asserted — "the Workshop has no tab bar" — so a
worker following this plan task-by-task would be re-implementing a reverted
design. Task 1's ten unlock glyphs and Task 3's row card did ship and still
stand; Task 3's tab-bar rules went with Task 2.

---

## One departure from the spec

**The glyph stays inside `.shop-card__name`; it does not get its own grid track.**

The spec calls for hoisting the Systems glyph out of `.shop-card__name` into a
track-1 element and adding a matching one to Options cards. Don't. Markup changes
are not media-scoped, and the tall card is `flex-direction: column`
(app.css:1419) — so a glyph as a new first child renders on its own line above
the name at tall, which is not today's appearance for Systems cards and would need
a compensating tall-viewport rule to undo.

Leaving `icon()` where it already is (screens.ts:717) and adding the same call to
the Options card gets the shared left edge for free, because the glyph is the
first thing in the first line of every card's body either way. The row layout is
then `1fr auto` rather than `auto 1fr auto`, which also removes the spec's
`.shop-card__ico` / `.ico { flex: none }` concerns entirely.

Everything else in the spec stands, including every trap in its Implementation
Notes.

## Working agreements

- All paths are relative to `C:\Users\giova\dev\tetrilaunch\app`.
- Run the suite with `npx tsx sim/systems.ts` from that directory. It prints `All systems checks passed.` on success and `N check(s) FAILED.` otherwise.
- Typecheck with `npx tsc --noEmit`. **Note `sim/` is NOT in tsconfig's `include`** — the harness is never typechecked, so a type error there only shows up at runtime.
- Commit after every task.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/ui/icons.ts` | `IconName` union + `PATHS` | 10 unlock glyphs |
| `src/ui/screens.ts` | Workshop rendering | `tab` param, tab bar, panes, glyph on Options cards, `__body` wrapper |
| `src/main.ts` | Screen wiring | `workshopTab` field + `shop-tab` action |
| `src/styles/app.css` | Layout | Row card + tab bar, inside the 460px block |
| `sim/systems.ts` | The check harness | Glyph + tab + pane checks |
| `design/screens/workshop.html` | Static mirror | Regenerate to match |

**Not touched:** `src/game/meta.ts`, `UNLOCKS`, `INSTALLS`, pricing, the draft.

---

### Task 1: Ten unlock glyphs

`UNLOCKS` ids become `IconName` members, exactly as upgrade track ids already do —
`refitScreen` and the install card both cast the id at the call site
(`icon(u.id as IconName, 13)`), so no new field on `UnlockDef` and no `meta.ts`
import from `ui/`.

Three ids are hyphenated (`short-lines`, `bond-breaker`, `scrap-cache`), so their
`PATHS` keys are quoted. That is legal beside the existing unquoted keys.

**Files:**
- Modify: `src/ui/icons.ts` (`IconName` at line 23-35, `PATHS` at 39)
- Test: `sim/systems.ts` (beside the existing "every upgrade track has an icon" check, ~line 349)

- [x] **Step 1: Write the failing test**

Add to `sim/systems.ts` immediately after the existing `every upgrade track has an icon` check:

```ts
  // Same check, same reason, for the option unlocks. The Workshop row puts a
  // glyph at the head of every card so Systems and Options share a left edge;
  // an unlock with no icon renders a blank square and still typechecks, because
  // a string-literal union assertion only requires the unions to SHARE a member.
  check("every unlock has an icon",
    UNLOCKS.every((u) => !icon(u.id as IconName).includes("undefined")),
    UNLOCKS.filter((u) => icon(u.id as IconName).includes("undefined")).map((u) => u.id).join(","));
```

`UNLOCKS`, `icon` and `IconName` are all already imported in this file (lines 32 and 52).

- [x] **Step 2: Run to verify it fails**

Run: `npx tsx sim/systems.ts`
Expected: FAIL — `every unlock has an icon`, with all ten ids in the detail.

- [x] **Step 3: Extend the `IconName` union**

In `src/ui/icons.ts`, add a third group to the union, after the upgrade-track line (line 29) and before the `up`/`down` comment:

```ts
  // One per option unlock (meta.ts's UNLOCKS). Same id-is-the-icon-name
  // convention as the tracks above: the shop card casts the id at the call
  // site, so there is no glyph field on UnlockDef and meta.ts never imports
  // from ui/. A row card leads with the glyph, so an unlock without one leaves
  // a hole where every other row has its mark.
  | "demo" | "bulk" | "survey" | "scrap-cache" | "micro"
  | "sturdy" | "overclock" | "short-lines" | "bond-breaker" | "auto"
```

- [x] **Step 4: Add the ten paths**

Append to the `PATHS` object in `src/ui/icons.ts`, after the `demolition` entry
and before the `up`/`down` pair. Every path is straight-segment only, on the
16x16 integer grid, per the file's own header:

```ts
  // ---- Option unlocks (meta.ts's UNLOCKS) ---------------------------------
  // Demolition Licence: a detonation, not a charge — `demolition` above is the
  // rack you install, this is the permit that puts the card in the draft. Four
  // DIAGONAL spikes off a 4x4 core, where `bonds` throws four axis-aligned
  // ones off a 2x2: at 13px the diagonal/orthogonal split is what separates
  // them, so neither may drift toward the other's angles.
  demo:
    `<path d="M6 6h4v4H6z" fill="currentColor" stroke="none"/><path d="M4 4L2 2"/><path d="M12 4l2-2"/><path d="M4 12l-2 2"/><path d="M12 12l2 2"/>`,
  // Bulk Freight: a five-cube pentomino as one solid mass. Filled because the
  // mod's whole character is density (1.35x) — an outline would read light,
  // which is what `micro` is.
  bulk:
    `<path d="M3 3h6v4H3z" fill="currentColor" stroke="none"/><path d="M3 7h10v4H3z" fill="currentColor" stroke="none"/>`,
  // Weather Survey: three wind streaks of unequal length with a direction
  // chevron. Deliberately unequal and short of the box — `settings` is three
  // FULL-width rails with handles, and equal-length streaks would collide.
  survey:
    `<path d="M2 5h7"/><path d="M2 8h10"/><path d="M2 11h5"/><path d="M9 3l3 2-3 2"/>`,
  // Scrap Cache: a crate with an X brace. The brace is the whole idea — a plain
  // rect with a lid is `contracts`' clipboard at 13px, and nothing else in the
  // set uses a diagonal cross.
  "scrap-cache":
    `<path d="M2 5h12v9H2z"/><path d="M2 5l12 9"/><path d="M14 5L2 14"/>`,
  // Micro Freight: a two-cube domino, small and separated. The gap is load
  // bearing — closed up it is one 6x3 bar, and the point is that this piece is
  // two light cubes rather than one mass.
  micro:
    `<path d="M4 7h3v3H4z" fill="currentColor" stroke="none"/><path d="M9 7h3v3H9z" fill="currentColor" stroke="none"/>`,
  // Reinforced Bonds: two blocks and the link that HOLDS, with two cross-ties.
  // Reads as the opposite of `bond-breaker` below on purpose — same two blocks,
  // intact link versus snapped one.
  sturdy:
    `<path d="M2 6h3v4H2z" fill="currentColor" stroke="none"/><path d="M11 6h3v4h-3z" fill="currentColor" stroke="none"/><path d="M5 8h6"/><path d="M7 6v4"/><path d="M9 6v4"/>`,
  // Press Overclock: the press wall, and two chevrons for the sweep it now
  // makes 50% faster. Stroked throughout so it cannot be mistaken for `auto`
  // below, which is a filled block throwing filled shots.
  overclock:
    `<path d="M2 3v10"/><path d="M5 3l4 5-4 5"/><path d="M10 3l4 5-4 5"/>`,
  // Line Recalibration: a full line for reference, and above it the same span
  // closing inward — the row needs one fewer cube. Inward arrows rather than a
  // shortened bar, because a bar that is merely shorter has nothing to be
  // shorter THAN at 13px.
  "short-lines":
    `<path d="M2 6h5"/><path d="M9 6h5"/><path d="M5 4l2 2-2 2"/><path d="M11 4l-2 2 2 2"/><path d="M2 12h12"/>`,
  // Bond Breaker: two blocks driven apart by a bolt. The bolt matches the ⚡
  // the in-game button already uses for this mod, so the shop and the field
  // agree on what it looks like.
  "bond-breaker":
    `<path d="M2 6h3v4H2z" fill="currentColor" stroke="none"/><path d="M11 6h3v4h-3z" fill="currentColor" stroke="none"/><path d="M8 3l-2 5h4l-2 5"/>`,
  // Autoloader: the launcher block and two shots already away. Filled block +
  // filled shots against `overclock`'s all-stroke wall + chevrons — the paint
  // mode is the tell, since both are "a thing on the left throwing right".
  auto:
    `<path d="M2 4h3v8H2z" fill="currentColor" stroke="none"/><path d="M7 7h2v2H7z" fill="currentColor" stroke="none"/><path d="M11 7h2v2h-2z" fill="currentColor" stroke="none"/>`,
```

- [x] **Step 5: Run to verify it passes**

Run: `npx tsx sim/systems.ts`
Expected: `All systems checks passed.`

- [x] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output. `PATHS` is `Record<IconName, string>`, so a missing or misspelled key fails here.

- [x] **Step 7: Commit**

```bash
git add src/ui/icons.ts sim/systems.ts
git commit -m "icons: a glyph per option unlock, so a shop row can lead with its mark"
```

---

### Task 2: The shop becomes tabbed

Tabs halve what renders. This task moves the budget readout, both owned strips and
both empty states into their panes at the same time, because each one is wrong the
moment tabs exist — an Options tab showing the "✓ Installed" strip is not a state
worth committing on the way past.

**Files:**
- Modify: `src/ui/screens.ts` (`workshopScreen`, line 666 signature and the `return` block at 734-762)
- Modify: `src/main.ts` (line 263, and the click switch at ~1119-1122)
- Test: `sim/systems.ts` (the workshop markup checks, ~line 353)

- [x] **Step 1: Write the failing test**

Replace the existing `const shop = workshopScreen(freshMeta({ salvage: 50 }));` line and add below it:

```ts
  const shop = workshopScreen(freshMeta({ salvage: 50 }), "systems");
  const shopOpts = workshopScreen(freshMeta({ salvage: 50 }), "options");
  check("the Workshop offers an install to buy", shop.includes(`data-action="buy-install"`));
  check("the Workshop shows the build budget", shop.includes("build budget"));
  // Tabs, and only the active pane. The whole 500px-of-overflow fix rests on
  // the inactive section NOT being in the output — if both render, the shop is
  // the same length it always was and the CSS is decoration.
  check("both tabs render on either pane",
    shop.includes(`data-tab="systems"`) && shop.includes(`data-tab="options"`) &&
      shopOpts.includes(`data-tab="systems"`) && shopOpts.includes(`data-tab="options"`));
  check("the systems pane omits the option cards",
    shop.includes(`data-action="buy-install"`) && !shop.includes(`data-action="buy-unlock"`));
  check("the options pane omits the install cards",
    shopOpts.includes(`data-action="buy-unlock"`) && !shopOpts.includes(`data-action="buy-install"`));
  check("the build budget survives on the systems tab", shop.includes("build budget"));
  check("the active tab is marked for assistive tech",
    shop.includes(`data-tab="systems" aria-selected="true"`) &&
      shopOpts.includes(`data-tab="options" aria-selected="true"`));
  // An empty pane must still show its tabs, or a player who has installed
  // everything lands on a screen with no way back to the other half.
  const richMeta = freshMeta({ salvage: 99999, mark: MARK_COUNT });
  let allIn = richMeta;
  for (const i of INSTALLS) { const n = buyInstall(allIn, i.id); if (n) allIn = n; }
  const shopFull = workshopScreen(allIn, "systems");
  check("an exhausted systems pane keeps its tabs", shopFull.includes(`data-tab="options"`));
```

- [x] **Step 2: Run to verify it fails**

Run: `npx tsx sim/systems.ts`
Expected: FAIL — `both tabs render on either pane` and the two pane-isolation checks. `workshopScreen` takes one argument today, so the second is ignored and both panes render identically.

- [x] **Step 3: Add the `tab` parameter and the tab bar**

In `src/ui/screens.ts`, change the signature at line 666:

```ts
export function workshopScreen(meta: MetaState, tab: ShopTab = "systems"): string {
```

and export the type just above the function:

```ts
/** Which half of the shop is showing. Systems and Options are two lists of the
 *  same kind of decision, and at 792x360 both at once is 689px of cards in a
 *  189px window — see the spec's measurement table. */
export type ShopTab = "systems" | "options";
```

- [x] **Step 4: Build the tab bar and the panes**

Still in `workshopScreen`, replace the `installSection` const (lines 728-732) with the following, and leave `installCards`, `installedStrip`, `cards`, `ownedStrip` and `done` exactly as they are:

```ts
  // The counts are what let the hidden half advertise itself. A tab that just
  // says "Options" gives a player no reason to look, and the cheapest unlock
  // they can afford is behind it.
  const systemsBuyable = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) === 0 &&
    installAvailable(meta, i) && meta.salvage >= i.cost).length;
  const optionsBuyable = forSale.filter((u) => unlockAvailable(u, meta.unlocks, mark) &&
    meta.salvage >= u.cost).length;

  const tabBtn = (id: ShopTab, label: string, n: number) =>
    `<button class="workshop__tab${tab === id ? " workshop__tab--on" : ""}" role="tab" data-action="shop-tab" data-tab="${id}" aria-selected="${tab === id}">${label}${n ? ` <b>${n}</b>` : ""}</button>`;

  // The bar is a SIBLING of .workshop__shop, never a child: app.css makes
  // .workshop__shop the scroller on short viewports, so a bar inside it
  // scrolls away exactly when the player needs it.
  const tabBar = `<div class="workshop__tabs" role="tablist">
        ${tabBtn("systems", "Systems", systemsBuyable)}
        ${tabBtn("options", "Options", optionsBuyable)}
        ${tab === "systems"
          ? `<span class="workshop__budget">build budget ${tiersCost(meta.loadout)}/${markBudget(meta)}</span>`
          : ""}
      </div>`;

  // Each strip belongs to its own pane. Left above the shop they would show the
  // Installed list while the player is shopping for Options, and both would eat
  // fixed chrome off the only scroller.
  const pane = tab === "systems"
    ? `${installedStrip
          ? `<div class="workshop__owned"><span class="workshop__owned-label">✓ Installed</span>${installedStrip}</div>`
          : ""}
       ${installCards
          ? `<div class="workshop__grid">${installCards}</div>`
          : `<p class="muted" style="margin:0">Every system your Mark allows is installed. Beat this Mark to open the next one.</p>`}`
    : `${ownedStrip}
       ${done
          ? `<p class="muted" style="margin:0">Every option unlocked. Salvage now rides along for the next thing built.</p>`
          : `<div class="workshop__grid">${cards}</div>`}`;
```

- [x] **Step 5: Rewrite the returned markup**

Replace the `return` block (lines 734-762) with:

```ts
  return `<div class="screen screen--fit neon-backdrop">
    <div class="workshop">
      <div class="workshop__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Launch Bay</div>
          <h2 class="display">Workshop</h2>
          <p class="muted workshop__blurb" style="margin:0">Salvage buys the ship you start every run with. Systems are permanent; options ride the draft.</p>
        </div>
        <div class="chip">
          <div class="chip__label">Salvage</div>
          <div class="chip__value">♻ ${meta.salvage}</div>
        </div>
      </div>
      <div class="workshop__meta muted">${meta.runs} run${meta.runs === 1 ? "" : "s"} logged · deepest bay ${meta.bestBay || "—"}</div>
      ${tabBar}
      <div class="workshop__shop" role="tabpanel">${pane}</div>
      <button class="btn btn--primary btn--lg" data-action="play" style="align-self:center">${icon("play")}Start Run</button>
    </div>
  </div>`;
```

Keep whatever the current header markup actually is — copy the `workshop__hdr`
and `chip` blocks verbatim from the file rather than from this plan, which
reproduces them only to show where `${tabBar}` and the pane sit.

- [x] **Step 6: Wire the state in `main.ts`**

Add the field beside the other App state:

```ts
  /** Which half of the Workshop shop is showing. Lives here, not in the DOM:
   *  renderOverlay() rewrites overlay.innerHTML wholesale and both purchase
   *  handlers call it, so a :checked-sibling or :target tab would snap back to
   *  Systems on every buy (and :target would push history entries besides). */
  private workshopTab: S.ShopTab = "systems";
```

Change line 263 to pass it:

```ts
      case "workshop": this.overlay.innerHTML = S.workshopScreen(this.meta, this.workshopTab); break;
```

Add the handler next to `onBuyInstall`:

```ts
  /** Workshop: switch shop halves. Anything other than the two known ids is
   *  ignored rather than defaulted, so a stale attribute cannot silently park
   *  the player on Systems forever. */
  private onShopTab(tab: string): void {
    if (tab !== "systems" && tab !== "options") return;
    if (tab === this.workshopTab) return;
    this.workshopTab = tab;
    this.renderOverlay();
  }
```

Add the case beside `buy-install` in the click switch (~line 1122). **Do not name
the action `"workshop"`** — that case already exists at line 1089 and is what
opens the screen:

```ts
      case "shop-tab": this.onShopTab(el.getAttribute("data-tab") ?? ""); break;
```

- [x] **Step 7: Reset the tab when the screen opens**

Find `case "workshop": this.setState("workshop")` (~line 1089) and set the tab
first, so re-entering the Workshop always lands on Systems:

```ts
      case "workshop": this.workshopTab = "systems"; this.setState("workshop"); break;
```

- [x] **Step 8: Run to verify it passes**

Run: `npx tsx sim/systems.ts`
Expected: `All systems checks passed.`

- [x] **Step 9: Typecheck and build**

Run: `npx tsc --noEmit && npx vite build`
Expected: exit 0, clean build. If `ShopTab` is not found in `main.ts`, confirm it is exported from `screens.ts` and that `main.ts` imports the module as `S`.

- [x] **Step 10: Commit**

```bash
git add src/ui/screens.ts src/main.ts sim/systems.ts
git commit -m "workshop: Systems and Options become tabs, and the strips follow their panes"
```

---

### Task 3: The card becomes a row

The tab split alone leaves 219px of overflow on Options. This is the half that
closes it.

**Files:**
- Modify: `src/ui/screens.ts` (both card builders — the unlock card at 683-687, the install card at 713-719)
- Modify: `src/styles/app.css` (base additions near 1418-1436; the row rules inside `@media (max-height: 460px)` at 1473-1502; new tab-bar rules)
- Test: `sim/systems.ts`

- [x] **Step 1: Write the failing test**

```ts
  // Both card kinds carry a glyph and a body wrapper, or the row layout has
  // nothing to put in its tracks and Options rows sit at a different left edge
  // from Systems rows.
  check("an option card carries its glyph",
    shopOpts.includes(`class="shop-card__name"><svg`),
    shopOpts.slice(shopOpts.indexOf("shop-card__name"), shopOpts.indexOf("shop-card__name") + 80));
  check("both card kinds wrap name and desc in a body",
    shop.includes(`class="shop-card__body"`) && shopOpts.includes(`class="shop-card__body"`));
```

- [x] **Step 2: Run to verify it fails**

Run: `npx tsx sim/systems.ts`
Expected: FAIL — both checks. Option cards have no glyph and neither card has a body wrapper.

- [x] **Step 3: Add the glyph and body wrapper to the option card**

In `src/ui/screens.ts`, replace the unlock card template (lines 683-687):

```ts
      return `<div class="shop-card${available ? "" : " shop-card--gated"}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(u.id as IconName, 13)}${u.name}</div>
        <p class="shop-card__desc">${u.desc}</p>
      </div>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
```

- [x] **Step 4: Add the body wrapper to the install card**

Replace the install card template (lines 716-720). The glyph is already inside
`__name` — it stays there:

```ts
      return `<div class="shop-card${available ? "" : " shop-card--gated"}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(i.id as IconName, 13)}${def.name}</div>
        <p class="shop-card__desc">${def.blurb} Installs at tier 1; refit stops raise it.</p>
      </div>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
```

- [x] **Step 5: Add the base wrapper rule**

In `src/styles/app.css`, after `.shop-card__desc` (line 1431), add:

```css
/* name + desc as one unit, so the row layout below has a single middle track
   and the tall card keeps today's spacing (this carries the 8px the two used to
   get from .shop-card's own column gap). */
.shop-card__body { display: flex; flex-direction: column; gap: var(--sp-2); flex: 1; min-width: 0; }
```

- [x] **Step 6: Add the tab-bar rules**

After `.workshop__budget` (line 1466), add:

```css
/* The tab bar is fixed chrome above the scroller, not part of it. */
.workshop__tabs { display: flex; align-items: center; gap: var(--sp-2); }
.workshop__tab {
  font-family: var(--font-pixel); font-size: 9px; letter-spacing: 0.08em;
  color: var(--text-dim); background: none; border: none; cursor: pointer;
  padding: 6px 2px; border-bottom: 2px solid transparent;
}
.workshop__tab--on { color: var(--text); border-bottom-color: var(--accent); }
.workshop__tab b { font-family: var(--font-mono); color: var(--accent); font-weight: 700; }
.workshop__tabs .workshop__budget { margin-left: auto; }
```

- [x] **Step 7: Add the row rules inside the media query**

Inside `@media (max-height: 460px)` (1473-1502), replace the `.shop-card`,
`.shop-card__name`, `.shop-card__desc` and `.shop-card__foot .btn` rules
(1494-1501) with:

```css
  /* The card becomes a ROW. 122px of card in a 189px scroller meant 1.5 cards
     visible; the leaderboard's row shape (a fixed trailing value against a
     flexible body) takes it to ~40px. Two columns was measured and is WORSE —
     see the spec: this content is width-scarce, not height-scarce. */
  .shop-card {
    display: grid; grid-template-columns: 1fr auto; align-items: center;
    gap: 8px; padding: 5px 10px; border-radius: var(--r-md);
  }
  .shop-card__body { gap: 2px; min-width: 0; }
  .shop-card__name { font-size: 11px; display: flex; align-items: center; gap: 5px; }
  .shop-card__desc {
    font-size: 10px; line-height: 1.3;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1;
    overflow: hidden; min-width: 0;
  }
  /* margin-top:auto is declared OUTSIDE this query (see .shop-card__foot), and
     an auto margin beats align-items — without this reset the price sinks to
     the bottom of the row instead of centring against it. */
  .shop-card__foot { margin-top: 0; }
  .shop-card__foot .btn { width: auto; padding: 4px 8px; font-size: 9px; }
  /* The gated branch replaces the button with a long text run. In an `auto`
     track that run sizes the column and starves the body, so it is capped. */
  .shop-card__locked { display: block; max-width: 96px; text-align: right; }
  .workshop__tab { padding: 4px 2px; font-size: 8px; }
```

- [x] **Step 8: Widen the grid columns**

Still inside the media query, change `.workshop__grid` (1490-1493) from
`minmax(148px, 1fr)` to:

```css
  .workshop__grid {
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 4px;
    align-content: start;
  }
```

A row needs its full name, a readable desc fragment and a price on one line;
148px columns would wrap the name.

- [x] **Step 9: Run, typecheck, build**

Run: `npx tsx sim/systems.ts && npx tsc --noEmit && npx vite build`
Expected: `All systems checks passed.`, exit 0, clean build.

- [x] **Step 10: Commit**

```bash
git add src/ui/screens.ts src/styles/app.css sim/systems.ts
git commit -m "workshop: the shop card becomes a row, and the shop stops scrolling"
```

---

### Task 4: Retire the comments the change falsified

Two comment blocks now argue for the opposite of the code. Left alone they are
worse than no comment, because they read as reasons not to do what was just done.

**Files:**
- Modify: `src/styles/app.css` (1455-1458 and 1486-1489)
- Modify: `design/screens/workshop.html`

- [x] **Step 1: Rewrite the `.workshop__shop` comment**

Replace the block at 1455-1458 ("The shop proper: systems first, then options. One wrapper rather than two loose grids…") with:

```css
/* The shop proper: one pane at a time, chosen by the tab bar above it. This was
   a single scroller holding BOTH sections stacked, which is 689px of cards in a
   189px window at 792x360. The tab bar is a sibling, not a child, so it stays
   put while this scrolls. */
```

- [x] **Step 2: Rewrite the short-viewport scroller comment**

Replace the block at 1486-1489 ("The scroller is the SHOP, not either grid. Systems and options are two sections of one list…") with:

```css
  /* The scroller is the pane. Only the active section is in the DOM at all
     (see screens.ts's workshopScreen), so there is one grid here, not two. */
```

- [x] **Step 3: Regenerate the design mirror**

`design/screens/workshop.html` is a hand-maintained mirror that claims at line 10
to reflect `screens.ts` + `app.css`. It carries its OWN copy of the styles
(lines 64-79) and its own sample markup (from line 83) — nothing is imported, so
both halves need updating.

Note it is **already stale from phase 1**: it has no Systems section, no install
cards and no build-budget readout, and its header still reads "Between runs" with
a ✕ button that `screens.ts` does not render. Bringing it level is part of this
step, not a separate concern.

Add to its `<style>` block, mirroring Task 3's rules:

```css
.shop-card__body{display:flex;flex-direction:column;gap:var(--sp-2);flex:1;min-width:0}
.workshop__tabs{display:flex;align-items:center;gap:var(--sp-2)}
.workshop__tab{font-family:var(--font-pixel);font-size:9px;letter-spacing:0.08em;
  color:var(--text-dim);background:none;border:none;cursor:pointer;padding:6px 2px;
  border-bottom:2px solid transparent}
.workshop__tab--on{color:var(--text);border-bottom-color:var(--accent)}
.workshop__tab b{font-family:var(--font-mono);color:var(--accent);font-weight:700}
.workshop__tabs .workshop__budget{margin-left:auto}
.workshop__budget{font-family:var(--font-mono);font-size:10px;color:var(--warn)}
```

Delete `.shop-card--owned` (line 72) and `.shop-card__owned` (line 78) along with
the sample card that uses them (lines 98-102): `screens.ts` renders neither, and
they exist only in this file.

Then wrap every sample card's name and desc in `<div class="shop-card__body">`,
put a glyph at the head of each `.shop-card__name`, and add a tab bar above
`.workshop__grid`:

```html
    <div class="workshop__tabs" role="tablist">
      <button class="workshop__tab workshop__tab--on" role="tab" aria-selected="true">Systems <b>2</b></button>
      <button class="workshop__tab" role="tab" aria-selected="false">Options <b>3</b></button>
      <span class="workshop__budget">build budget 60/77</span>
    </div>
```

- [x] **Step 4: Commit**

```bash
git add src/styles/app.css design/screens/workshop.html
git commit -m "workshop: the layout comments argued for the layout that just changed"
```

---

### Task 5: Verify against the measurement

The harness asserts on strings and cannot measure pixels. The 500px figure this
plan exists to remove has to be re-measured the same way it was taken.

**Files:** none — this task changes nothing.

- [x] **Step 1: Full verification**

Run: `npx tsc --noEmit && npx tsx sim/systems.ts && npx vite build`
Expected: exit 0, `All systems checks passed.`, clean build.

- [x] **Step 2: Measure the overflow at the device viewport**

Start the dev server, open the page at **792x360**, go to Workshop, and evaluate:

```js
const shop = document.querySelector('.workshop__shop');
({ h: shop.clientHeight, content: shop.scrollHeight,
   overflow: shop.scrollHeight - shop.clientHeight,
   card: document.querySelector('.shop-card').getBoundingClientRect().height,
   cols: getComputedStyle(document.querySelector('.workshop__grid')).gridTemplateColumns.split(' ').length })
```

Expected: `overflow` **0** on the Systems tab at a fresh save, `card` ~40px, `cols` 3.
Then click the Options tab and re-run: `overflow` should be at or near 0 with ten
unowned unlocks. Anything above ~40px means the desc clamp or the column width
needs one more turn — reconcile against the spec's tables rather than loosening.

- [x] **Step 3: Check the states the tables did not cover**

At the same viewport, confirm by eye:
- A gated card ("Needs Mark 2") does not push its row's price off the edge.
- The price button centres against the row rather than sinking — if it sinks, Step 7 of Task 3's `margin-top: 0` reset did not land.
- A tall viewport (e.g. 1280x900) still shows the old vertical card: glyph inline in the name, full untruncated desc, price at the bottom.
- The Options tab shows the "✓ Owned" strip and not "✓ Installed".

- [x] **Step 4: Commit anything the measurement forced**

```bash
git add -A
git commit -m "workshop: reconcile the row layout against the measured viewport"
```

If nothing changed, skip the commit.

---

## Done when

- The Workshop shop shows no scrollbar at 792x360 on the Systems tab at a fresh save, measured rather than assumed.
- Every option unlock renders a glyph, and Systems and Options rows share a left edge.
- Both tabs are reachable from either pane, including when a pane is empty.
- The tall viewport looks exactly as it does today.

## Deliberately not in this plan

- The hazard draft and `makeBaseLevel` auto-scaling (systems-layer phase 2).
- Re-pricing `UNLOCKS` or `INSTALLS`.
- The refit screen's four-column grid, which phase 1 already settled.
- A browser test harness. The repo has none, and the measurement step above is the same one phase 1 used.

---

## Outcome — measured, not assumed

Implemented on `claude/system-design-review-58ay1b`, off `systems-layer` at
`99c18d5`. Re-measured in Chromium at 792x360 driving the dev server, the same
way the spec's tables were produced:

| | Systems | Options |
|---|---|---|
| `.workshop__shop` height | 160px | 160px |
| content height | 160px | 180px |
| **overflow** | **0px** (was 500px) | **20px** |
| card | 42px | 42px |
| columns | 3 | 3 |
| page scroll | 0 | 0 |

The scroller is 160px rather than the spec's 189px because the tab bar is new
fixed chrome — the spec budgeted ~38px for it and it cost 29px.

**One fix the measurement forced.** Task 3's `max-width: 96px` on
`.shop-card__locked` stopped the gate text sizing the price track, but not
growing the row: `Needs Mark 3 · Demolition Licence` wrapped to four lines
inside that cap and took the Autoloader row to 50px against every other row's
42px. The run is now clamped to two lines, same trade the desc above it already
makes. Every row is 42px, and Options' overflow fell 28px -> 20px.

**Options keeps 20px.** Ten cards over three columns is four rows: 4x42 + 3x4 =
180 against a 160px pane. Closing it needs a fourth column, i.e. `minmax` below
~182px, which is the width Task 3 widened *away* from so a row's name, desc
fragment and price fit on one line. Inside the plan's own ~40px tolerance, and
left rather than loosened, per Step 2's instruction.

**One claim in "One departure from the spec" does not hold against the code.**
It argues a hoisted glyph "lands on its own line above the name at tall — not
today's appearance for Systems cards". It *is* today's appearance:
`.ico` is `display: block` (app.css:110) and `.shop-card__name` is a plain block
at tall, so the glyph already sat on its own line there before this change. The
departure's conclusion still stands — `icon()` stays where it is — but for a
weaker reason than the one recorded. Options cards now match Systems cards at
tall, both with the glyph above the name. Making the pair inline at every
viewport is a one-line base rule, deliberately NOT taken here because it would
change the tall Systems card the "Done when" list pins as unchanged.
