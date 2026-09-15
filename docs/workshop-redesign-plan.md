# Workshop redesign — session plan

The Workshop (`app/src/ui/screens.ts` `workshopScreen`) is the between-runs
shop for the ship's systems. This document is the plan for rebuilding it so a
player sees **every system's current tier at a glance** and **what each tier
gives**, without a scrolling shelf. Written 2026-09-15 from a local review
session; meant to be executed in its own (cloud) session.

Read [docs/STEAM.md](./STEAM.md) Part 2 of the
[store plan](./steam-store-and-achievements-plan.md) for why controller parity
matters here: the Workshop must be fully drivable by pad (Steam Deck Verified).

## The owner's brief (verbatim intent)

- "I'd like to be able to see the current tier for every system at a glance,
  and the stats that an upgrade gets me."
- "I'm not particularly fond of the current scrolling window, its height is not
  enough because of the stuff above and below it (titles and buttons)."
- "We could use the tab space on the left to switch between owned systems and
  get rid of the scrolling all together."
- "It's only 2 purchasable upgrades in the workshop, and the third one is run
  only, need to also clarify this."

## Where we are — measured facts (2026-09-15, staging `4abb27b`)

- **The shelf scrolls badly.** On a stocked save (`ownedMeta` in
  `app/sim/uifit/fixtures.ts`) the `.workshop__shop[data-scroll]` pane shows
  **444 of 1191 px** of content at Steam Deck size (1280×800) and **226 of 880**
  on a phone (915×412). The header (eyebrow, h2, blurb, meta line) and the footer
  (`.workshop__go`: Contracts + Start Run) take the rest.
- **The left column holds only the build-budget box** (`.workshop__aside`,
  screens.ts ~5749). `.workshop__body` is `grid-template-columns:
  minmax(0, max-content) minmax(0, 1fr)` (app.css ~9663); the aside is never
  hidden and the body never stacks at any breakpoint. The only compact rule is
  `@media (max-height: 460px)` (app.css ~9729), which hides the blurb and tightens
  the cards.
- **Cards say nothing about stats.** Each `.shop-card` prints `def.blurb` plus a
  boilerplate ownership sentence — *"Owned at tier 1. Tier 3 is scrap, at a
  refit stop."* or *"Installs at tier 1; the Workshop raises it to 2, refit stops
  to 3."* — repeated on all ten cards. The per-tier stat copy already exists and
  is unused here:
  - `UpgradeDef.tiers: [string, string, string]` — the delta each tier gives,
    e.g. reactor `["+$60 float · +$15 per line", "+$120 float · +$30 per line",
    "+$180 float · +$45 per line"]` (`app/src/game/upgrades.ts` ~224-507).
  - `UpgradeDef.current(tier)` — the absolute state ("stock reactor",
    "+$120 float · +$30/line").
  - The **refit** card (screens.ts ~5234-5357) already renders
    `current(owned) → current(next)` with three pips (`.refit-card__pips`,
    `on` / `queued` / dark) — the vocabulary to reuse.
- **The model:** 10 systems (`UPGRADES`: bay, launcher, hydraulics, magazine,
  reactor, bonds, demolition, thaw, cushion, incinerator), `MAX_TIER = 3`.
  **The Workshop sells tiers 1 and 2 for salvage** (`UPRATE_MAX_TIER = 2`,
  `uprateCost(def) = def.cost`, flat per system; `app/src/game/meta.ts` ~513-532).
  **Tier 3 is scrap at a refit stop, during a run, only.** Shelf order and Mark
  gates are `INSTALLS` (meta.ts ~381-499; `installGates` → "Needs Tier N" /
  "build budget a/b"). Two live options (`UNLOCKS`: Weather Survey 60, Scrap
  Cache 85; the rest retired) and the **+1 slot** purchase (`SLOT_PRICES`,
  `data-action="buy-slot"`).
- **The rack** (`rackHTML`, screens.ts ~5677-5702): slots row of `.rack-slot`
  buttons (icon + `.ship-plate__pips`, `data-action="mount"` toggles
  mount/stow), a `+1 slot` button, a note. Mounted systems' pips already show
  their tier — for mounted ones only, and small.
- **Why the shelf is one column:** sim/uifit reported **90 ellipsis
  truncations** at `auto-fit minmax(210px, 1fr)`, so it is one column at every
  viewport (app.css comment ~9472-9483). `.workshop__shop` is one of only three
  panes allowed to scroll (app.css ~394-397 allowlist; anything else fails the
  build).
- **Pad:** `app/src/ui/padnav.ts` moves focus spatially; PR #218 made a press
  scroll a pane before leaving it. A design with no scroller makes that path
  irrelevant on this screen (keep it — the refit yard and guide still use it).

## The design — three options were evaluated; build Option A

### Option A — master–detail (recommended, build this)

Left column = every system as a row with its tier pips; right = the selected
system's tier ladder. No scrolling at Deck/desktop.

```
 Workshop                        SALVAGE 240   [x]
 52 runs · Tier 4 · Contracts 0/3
 RACK 5/5 slots · 135/440 pts             [+1 SLOT · 70]
 ┌ SYSTEMS ──────────┐ ┌ LAUNCHER COILS ─────────────────── mounted ┐
 │▸ Launcher Coils ●○○│ │ More muzzle energy and a lateral stabilizer │
 │  Reactor Output ●●○│ │                                             │
 │  Loader Magazine●○○│ │ ✓ T1  +10% muzzle · stabilizer      owned   │
 │  Press Hydraul. ●○○│ │ ▸ T2  +20% muzzle · stabilizer  [BUY · 15]  │
 │  Bay Extension  ●○○│ │   T3  +30% muzzle · stabilizer  refit stop  │
 │  Demolition Rack○○○│ │                                             │
 │  Thaw Lance     ○○○│ │ Tiers 1–2 are bought here with salvage.     │
 │  Bond Emitter   🔒 │ │ Tier 3 is fitted at a refit stop, for scrap.│
 │  Incinerator    🔒 │ │                                             │
 │  Impact Cushion 🔒 │ │                        [STOW]  [BUY T2 · 15]│
 │─ OPTIONS ──────────│ └─────────────────────────────────────────────┘
 │  Weather Survey  ✓ │
 │  Scrap Cache    85 │
 └────────────────────┘
          [CONTRACTS]   [START RUN]
```

- **List rows:** icon, name, three pips (owned tiers lit — the same
  `.ship-plate__pips` glyph the rack uses), a lock for Mark-gated systems, a
  "mounted" mark for systems on the rack. Order = `installShelf()` rank.
- **Detail:** name, one-line `blurb`, the **tier ladder** from `def.tiers[]`:
  T1/T2/T3 rows marked ✓ owned / ▸ next (buy button `T2 · salvage N`) / T3
  tagged **refit stop**. One footnote, once: *"Tiers 1–2 are bought here with
  salvage. Tier 3 is fitted at a refit stop, for scrap."* Gated systems show
  "Needs Tier N" where the buy button would be. Options get the same panel with
  a single "Permanent" row.
- **Rack** collapses to a one-line strip (slot count, budget `a/b pts`, +1 slot).
  **Mount/stow becomes a button in the detail** so a row tap *selects* rather
  than mounts.
- **Phone (915×412):** 10 system rows + 3 option/slot rows in ~230 px means
  18–20 px rows in the pixel face, with the meta line hidden under the existing
  460 px rule the way the blurb already is. This is the option's one risk — the
  fit harness decides it (see Verification). If rows fall below the touch floor,
  fall back to Option B's strip **for the list only**; the detail panel is
  identical in A and B.

### Option B — the rack as the tab strip (fallback for phones)

One horizontal row of all 10 system tiles (mounted lit with pips, unowned dim,
locked) selects the same detail card below; options and the slot are extra
tiles. Fits a phone without squeezing rows, but names are hidden until
selected, so it is weaker "at a glance".

### Option C — dense single-line rows (rejected)

One line per system with the next tier's delta inline. Smallest change, but the
phone still scrolls and it is the layout the harness already rejected for
truncation (the stat strings are ~28 characters).

## Decisions the owner still has to make (ask at session start, or default)

1. **Mount/stow** moves from the rack tap into the detail panel's button.
   *Default if unanswered: yes.*
2. **Blurb vs stats:** keep the one-line blurb above the ladder, or let the
   ladder speak alone. *Default: keep the blurb, one line, ellipsized on
   compact.*
3. **Options + slot placement:** an "Options" group at the foot of the list (as
   drawn) or a second tab beside "Systems". *Default: foot of the list.*

## Implementation steps (one PR against `staging`)

1. **State.** `main.ts` gains `workshopSelected: string | null` (system or
   option id; default = `recommendedPurchase(meta)`'s target, else the first
   owned system). New actions: `data-action="select-system"` (row),
   `mount` (moved to the detail), `buy-install` / `buy-unlock` / `buy-slot`
   unchanged. Re-render via the existing `renderKeepingScroll` path only if a
   scroller survives; otherwise a plain in-place re-render of the detail panel
   (keep the list's focus — `document.activeElement` restore, like
   refreshRefit).
2. **Markup.** In `screens.ts`: split `workshopScreen` into `workshopList(meta,
   selected)` and `workshopDetail(meta, id)`; delete the boilerplate ownership
   sentences; build the ladder from `def.tiers` / `def.current`; reuse
   `.refit-card__pips` markup (or lift it to a shared `tierPipsHTML`). Rack →
   one-line `rack__strip`. Keep `haveStrips` out (the list *is* the owned view).
3. **CSS.** `.workshop__body` becomes `grid-template-columns: minmax(180px,
   max-content) minmax(0, 1fr)`; no `[data-scroll]` on either column unless the
   phone forces one — if it does, add the new pane to the allowlist at app.css
   ~394-397 and to the uifit `padfocus` fixtures. Compact rules under
   `@media (max-height: 460px)`: hide `.workshop__meta`, row height 20px.
4. **Pad.** Rows and the detail buttons are ordinary focusables; check
   `focusInitial` lands on the list's selected row (add `btn--primary`-equivalent
   hinting or an explicit first-focus). Right from a row → the detail's buy
   button; Left → back to the row. Verify with a real-Chromium drive (the uifit
   harness exposes `window.__uifit.padMove(dir)` and `padFocus(el)`).
5. **Copy.** One "T3 is run-only" sentence in the detail. Gated: "Needs Tier N".
   Options: "Permanent". Keep the school-mode variant (`workshop-school*`
   fixtures: no rack, one card) working — the list shows the one school install.
6. **Fixtures & pins.** Update `app/sim/uifit/fixtures.ts` (`workshop`,
   `workshop-owned`, `workshop-school`, `workshop-school-go`, `sys-drill-offer`)
   to the new markup, and add one fixture with the detail on a **gated** system
   and one on an **option**. Add `sim/systems.ts` pins: every system's ladder
   text equals `def.tiers[i]`; the T3 row carries the refit tag; the T3 sentence
   appears exactly once; the buy button's face is `T${next} · cost`; no
   `.workshop__shop[data-scroll]` remains (or the allowlist was updated).

## Verification ritual (all must be green before the PR)

- `npm run typecheck` (both tsconfigs).
- `npx tsx sim/systems.ts` — **0 new** failures. Five checks are already red on
  staging (render / main.ts / css string pins unrelated to this screen); diff
  against a clean staging run before blaming the change.
- `npm run test:uifit` — read the **`new`** count, which must be **0**; the
  baseline holds accepted entries. Then look at the shots for the five workshop
  fixtures on `pixel7`, `13mini`, `deck` and `desk1920` rows — the phone row
  height is the go/no-go for Option A vs the Option B strip.
- Real-app drive in Chromium: seed `tetrilaunch.meta` in localStorage with
  `{licence: 10, mark: 3, salvage: 240, unlocks: ["survey"], loadout: {reactor:
  2, launcher: 1, magazine: 1, bay: 1, hydraulics: 1}}`, open the Workshop from
  the menu, select each system, buy one tier, mount/stow one, and walk the whole
  screen with `padMove` only. (`window.__tl` is the App instance in dev.)
- Retest on the Steam Deck after merge: the pad must reach every row, both
  detail buttons, Contracts and Start Run, with nothing needing the touchscreen.

## Gotchas (from this repo's memory)

- PRs target **`staging`**, never main. Rebase onto `origin/staging` first.
- In a worktree, `app/.env` is absent and `node_modules` must be junctioned or
  `npm ci`'d; `npm run x -- --flag` drops flags in PowerShell (call the binary).
- Never bare `git stash` (shared stash stack across worktrees).
- The uifit harness renders DOM only; it cannot draw the canvas and
  `document.fonts.ready` is a no-op headlessly (force faces before measuring).
- `sim/systems.ts` cannot measure pixels — prove a new string pin fails before
  trusting it.
- Red/green is not a distinction here (owner is red-green colour-vision
  impaired): carry owned/next/locked on **shape** (✓ / ▸ / 🔒 and filled vs
  hollow pips), never on hue alone.
