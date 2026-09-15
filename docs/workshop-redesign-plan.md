# Workshop redesign — implementation plan (Option A3)

The Workshop (`app/src/ui/screens.ts` `workshopScreen`) is the between-runs
shop for the ship's systems. This is the plan for rebuilding it so a player
sees **every system's state and tier at a glance** and **what each tier
gives**, with **no scrolling shelf** and **both panels the same height**.
Written 2026-09-15 from the design canvas review; it supersedes the plan in
PR #220 (which chose Option A, a master–detail list). The owner picked
**Option A3** on the canvas — B's 44px plates in A2's two-column arrangement,
grouped by state — with two constraints added in review: the two panels share
one height, and no combination of ownership should need scrolling.

Read [docs/STEAM.md](./STEAM.md) for why controller parity matters here: the
Workshop must be fully drivable by pad.

## The owner's brief (verbatim intent)

- "I'd like to be able to see the current tier for every system at a glance,
  and the stats that an upgrade gets me."
- "I'm not particularly fond of the current scrolling window, its height is not
  enough because of the stuff above and below it (titles and buttons)."
- "We could use the tab space on the left to switch between owned systems and
  get rid of the scrolling all together."
- "It's only 2 purchasable upgrades in the workshop, and the third one is run
  only, need to also clarify this."
- On A2 (named tiles): "not clear what's mounted/stowed at a glance"; "keep
  options open for the future if we have more systems"; "use the smaller cards
  like in option B but in A2 arrangement".
- On A3: "make sure that both panels are the same height; we shouldn't need
  scrolling with any combination."

## Where we are — measured facts (staging `4abb27b`)

- **The shelf scrolls badly.** On the stocked save (`ownedMeta` in
  `app/sim/uifit/fixtures.ts`) the `.workshop__shop[data-scroll]` pane shows
  444 of 1191 px at Steam Deck size and 226 of 880 on a phone (915×412). The
  header (eyebrow, h2, blurb, meta line) and the footer (`.workshop__go`:
  Contracts + Start Run) take the rest.
- **Cards say nothing about stats.** Each `.shop-card` prints `def.blurb` plus a
  boilerplate ownership sentence repeated on every card. The per-tier copy
  already exists and is unused here: `UpgradeDef.tiers: [string, string,
  string]` (the delta each tier gives) and `UpgradeDef.current(tier)`
  (`app/src/game/upgrades.ts`). The refit card already renders
  `current(owned) → current(next)` with pips (`.refit-card__pips`).
- **The model:** 10 systems (`UPGRADES`), `MAX_TIER = 3`. The Workshop sells
  tiers 1 and 2 for salvage (`UPRATE_MAX_TIER = 2`, `uprateCost(def) =
  def.cost`; `app/src/game/meta.ts`). Tier 3 is scrap at a refit stop, during
  a run, only. Shelf order and Mark gates are `INSTALLS` / `installShelf()` /
  `installGates()` ("Needs Tier N" / "build budget a/b"). Two live options
  (`UNLOCKS`: Weather Survey 60, Scrap Cache 85; the rest retired). The rack
  has `slotsFor(meta)` slots (4 to `SLOT_CAP` 10), the next one priced by
  `slotPrice()` (`SLOT_PRICES` 50, 70, 100, 140, 180, 240); `mountedIds()` /
  `stowedIds()` / `toggleMount()` say what is aboard and in the shed.
- **The rack today** (`rackHTML` inside `workshopScreen`): a panel with a
  header (count, +1 slot button), a row of `.rack-slot` plates (44×44, icon +
  `.ship-plate__pips`, `data-action="mount"` toggles mount/stow), open slots
  as `.rack-slot--open` spans, a dashed-off shed row, and a note.
- **Fit chain:** `.screen` → `.workshop` → `.workshop__body` (grid, aside +
  scroller) → `.workshop__shop[data-scroll]`. `.workshop__shop` is on
  `ALLOWED_SCROLLERS` in `app/sim/uifit/run.ts`; nothing else on the screen
  may scroll. The baseline has no workshop entries today.
- **The logical box.** Desktop and Deck sizes render a 720px-tall logical box
  (`layout.ts` `UI_REF_H`; chrome zoom magnifies it), so 1280×800 and
  1920×1080 both give the screen ~720 logical px of height. From app.css
  values: screen padding 25 + workshop padding 24 + header ~74 + meta 10 +
  three 12px gaps + footer 58 ≈ 252 → **~468px of body at Deck/desktop**. On
  the Pixel 7 (915×412, compact): ~170 of chrome with the blurb and meta line
  hidden → **~242px of body**. The 360-tall rows of the device matrix
  (640×360, 740×360, 780×360) have **~190–204px**.
- **Pad:** `app/src/ui/padnav.ts` moves focus spatially; `focusInitial` lands
  on the first `.btn--primary`; `renderKeepingScroll` in `main.ts` re-renders
  the screen wholesale, restores scrollers by `[data-scroll]` and reseats the
  pad by the held control's data-attribute signature.

## The design — Option A3

Two panels side by side under the existing header and meta line, the same
height, neither scrolling: the **rack panel** on the left (every system as a
44px plate, grouped by state) and the **detail** on the right (the selected
plate's ladder). The footer is unchanged. Canvas of record:
https://claude.ai/artifact/SdFiZAVJvD3EByYKZAWdsV (page "A3 · grouped plates").

```
 Workshop                                          SALVAGE ♻240   [x]
 52 runs logged · deepest bay 10 · Tier 4 — Deep Run ○ · Contracts 0/3
 ┌ SYSTEMS  4/4 slots · 80 pts aboard      135/440 ┐ ┌ ⌁ Launcher Coils            ABOARD ┐
 │ RACK    [bay][lch▸][hyd][mag][+1 ♻50]           │ │ More muzzle energy and a lateral … │
 │ ─────────────────────────────────────────────── │ │ ✓ T1  +6% muzzle speed · 20% …  OWNED│
 │ SHED    [rct⇩]                                  │ │ ▸ T2  +12% muzzle speed · 40% …      │
 │ ─────────────────────────────────────────────── │ │   T3  +18% muzzle speed · 60% …  REFIT│
 │ SHELF   [dem][bnd][thw][csh🔒][inc🔒]           │ │ Tiers 1–2 are bought here with       │
 │ ─────────────────────────────────────────────── │ │ salvage. Tier 3 is fitted at a refit │
 │ OPTIONS [svy✓][cache ♻85]                       │ │ stop, for scrap.                     │
 │                                                 │ │                  [STOW]  [T2 · ♻15]  │
 └─────────────────────────────────────────────────┘ └──────────────────────────────────────┘
                     [CONTRACTS]   [▶ START RUN]
```

### The rack panel (`.workshop__rack`)

The existing `.rack` frame (gradient, `--line-strong` border, hard shadow),
with:

- **A header line**: the `systems` label (`.workshop__aside-label` style), the
  rack count in the existing copy (`4/4 slots · 80 pts aboard`, `.rack__count`)
  and the build budget (`135/440`, `.workshop__budget`). The aside
  (`.workshop__aside`, the budget box) is removed: the budget lives here,
  always visible, because the cap is the usual reason a purchase is refused.
  (As built: it reads `build budget 135/440` in visible words — a bare figure
  with the label in a `title`/`aria-label` reached no reader.)
- **Four group rows**, each a `.rack__group`: a fixed-width label at the left
  (`rack`, `shed`, `shelf`, `options`; the `.rack__shed-label` style, 58px at
  roomy/regular) and a wrapping flex row of plates (`.rack__plates`, 6px gap).
  Rows are separated by the shed's existing 1px dashed rule.
  - **rack** — `mountedIds(meta)` in that order, then the open slots
    (`.rack-slot--open`, `slots − aboard`), then the **+1 slot plate**
    (`data-action="buy-slot"`, face `+1` over the price, `disabled` when the
    salvage is short; at `SLOT_CAP` the plate is replaced by the existing
    `every slot bought` text).
  - **shed** — `stowedIds(meta)`. Not rendered when empty.
  - **shelf** — systems with `loadout[id] === 0`, in `installShelf()` order.
    Not rendered when every system is owned.
  - **options** — the live `UNLOCKS` (`!retired`), owned first.
- **Plates** are the existing `.rack-slot` (44×44, icon 15px, tier pips), one
  per system, and every system is in exactly one row. **A press on a plate
  SELECTS it** (`data-action="select-system"`, `data-select="<id>"`); it no
  longer mounts. Mount/stow is a button in the detail (decision 1 of the old
  plan, default kept). States are carried by shape and position, never by
  hue alone (the owner is red-green colour-blind):

  | state | carrier |
  |---|---|
  | aboard | in the rack row; the cyan plate as today |
  | in the shed | in the shed row; `.rack-slot--shed` plus a **stow badge** (new `stow` glyph, a corner badge like the lock's) |
  | for sale, unowned | in the shelf row; dim plate (`.rack-slot--unowned`), hollow pips |
  | gated by Mark | dim plate plus a **lock badge** (new `lock` glyph); selecting it shows `Needs Tier N` in the detail |
  | recommended (`recommendedPurchase(meta)`) | a **play-glyph badge** on the plate and the `Next step` chip beside the name in the detail; when the recommendation is a slot, the +1 plate wears the badge |
  | selected | `aria-pressed="true"` and `.rack-slot--sel` (2px accent outline + glow) |
  | option, owned | cyan plate plus a **check badge** |
  | option, for sale | dim plate; the price (`♻ 85`, 8px mono) under the glyph in place of pips |

  Every plate carries a `title` naming the system, its tier and its state,
  ending in the device's own verb from `bindings.ts`'s `hintPress(profile)`
  ("… tap to select" / "… press to select"): never a hardcoded hint (D2).
- **School mode** (`!licenceDone(meta)`): one shelf row with the one
  `SCHOOL_INSTALL` plate, selected; no rack, shed or options rows and no
  header line. The three-state blurb and the Start Run label logic are
  unchanged (`workshop-school*` fixtures).

### The detail (`.workshop__detail`)

The `.shop-card` frame, a flex column, foot pinned to its bottom
(`margin-top: auto`):

- **Header**: `icon(id, 13)` + name (`.shop-card__name` size) + the `Next step`
  chip when recommended; at the right a tag for owned systems — `aboard` or
  `in the shed` (`.shop-card__tag` shape, accent for aboard, `--line-strong`
  for the shed) — and `Permanent` for options.
- **Blurb**: `def.blurb` (or the unlock's `desc`), one paragraph. Decision 2
  of the old plan, default kept: the blurb stays; on compact it is one line,
  ellipsised.
- **The ladder**: three rows from `def.tiers[i]`, each `marker · T{n} · stat ·
  end`: a `check` marker and `owned` end tag for tiers ≤ owned; a `play`
  marker on the next tier when `installAvailable(meta, def)`; the T3 row
  always ends in `refit stop · <scrap glyph> scrap` (amber, the scrap
  currency's own colour, plus the words). Stats are `--font-mono` 12px
  (10px compact), ellipsised, the full string in the row's `title`.
- **One footnote**, once per detail: *"Tiers 1–2 are bought here with salvage.
  Tier 3 is fitted at a refit stop, for scrap."* This replaces the deleted
  boilerplate ownership sentences.
- **Foot**: `[Stow]` / `[Mount]` (`btn--secondary`, `data-action="mount"`,
  owned systems only; `toggleMount` refuses a mount when the rack is full — the
  button is `disabled` then, with a `title` saying to stow something first)
  and the buy control: `btn--primary` `data-action="buy-install"` with the
  existing price grammar `T{next} · <salvage> {cost}` and `priceAria`,
  `disabled` when the salvage is short; `.shop-card__locked` `Needs {gates}`
  from `installGates` when gated; `.shop-card__tag` `Workshop max` when
  `loadout[id] ≥ UPRATE_MAX_TIER`. Options: `data-action="buy-unlock"` with
  `<salvage> {cost}`, or the `✓ Owned` text.
- Nothing in the detail is dimmed for a gated system: it is the one place the
  gate is explained.

### Selection state

- `main.ts` gains `workshopSelected: string | null` (a system id or an unlock
  id). On entering the screen (`setState("workshop")`, and returning from
  `sys-drill-offer`) it defaults to `recommendedPurchase(meta)`'s id when the
  recommendation is a system or option, else the first plate in the panel
  (rack row first). It persists across in-screen re-renders; a purchase or a
  mount keeps the selection (the plate may move rows; the detail updates).
- `workshopScreen(meta, profile = "touch", selected: string | null = null)`
  renders with `selected` resolved the same way when null, so fixtures and
  pins can address any system directly.
- Actions: `select-system` (new), `mount` (moved into the detail),
  `buy-install`, `buy-unlock`, `buy-slot` (unchanged). All re-render through
  `renderKeepingScroll` (harmless with no scroller). When the control the pad
  held is gone after a render (a bought-out buy button becomes `Workshop
  max`), focus goes to the selected plate, never to an unrelated primary.

### Layout

- `.workshop__body`: `grid-template-columns: minmax(0, 372px) minmax(0, 1fr)`
  at roomy/regular (five plates per rack-panel row); on compact the rack
  panel takes the width that fits **eight** plates per row (label 42px, 6px
  pixel labels, 4px gaps) and the detail keeps ≥ 390px. `align-items:
  stretch` (both panels the body's height — the owner's ask), `flex: 1 1
  auto; min-height: 0`.
- **No `[data-scroll]` on the detail.** The rack panel packs its rows from the
  top and is designed never to scroll at roomy/regular or on 412-tall phones
  (arithmetic below); it still carries `[data-scroll]` and replaces
  `.workshop__shop` on `ALLOWED_SCROLLERS`, with the arithmetic in the
  comment, because the 360-tall rows of the matrix cannot hold four rows of
  44px plates. `.workshop__shop` and its allowlist entry go. (As built: the
  allowlisted region is the panel's inner `.rack__rows`, not the panel — the
  header line is pinned above it.)
- Compact (`@media (max-height: 460px)`, existing block): hide
  `.workshop__meta` the way the blurb is already hidden; rows stay 44px (the
  tap floor); the detail's compact sizes as the refit modal's; if the harness
  says the 360-tall rows clip the detail, the footnote is the first thing to
  hide there, never a button.

### Fit arithmetic (why "no scrolling" holds where it holds)

Rewritten against the built screen (pre-PR review); the estimates this replaces
were a row short at compact and counted the header inside the scroller.

A plate row costs 44px + its group padding: 50px at compact, 54px at roomy. What
it must fit inside is the **rows region** (`.rack__rows`), i.e. the panel minus
its **pinned header**, padding and border — measured at 31px compact, 65px roomy.
The header sits outside the scroller on purpose: the slot count and the build
budget are the two numbers that explain a refused purchase, so they may never
scroll away from the plates.

- **Roomy/regular (372px column, 5 plates per row):** the worst reachable state
  — ten slots bought against one system owned: 1 plate + 9 open + the *every
  slot bought* tag over three rows, nine shelf plates over two, one options row
  — is 6 rows = 319px. Measured on a 1280×720 laptop: **378px of rows region in
  a 443px body**; on 1920×1080, 379 in 667. Never scrolls here.
- **Pixel-7 class (448px column, 8 plates per row):** four rows = 203px, against
  a measured **213px of rows region in a 244px body**. Four fit, five (253px+)
  do not, and no fixture reaches five. The column is 448 and not 444 because the
  panel's 2px borders are part of its width: 448 − 4 border − 16 padding − 42
  label − 6 gap = 380 = 8×44 + 7×4 exactly.
- **360-tall rows (640×360, 740×360, 780×360):** measured on an iPhone 13 mini,
  **163px of rows region in a 194px body** against 203px of content on the
  stocked save — three rows fit, four do not, so a save with a shed *and* an
  unbought shelf scrolls by ~40px there. This is the one place the owner's "no
  scrolling with any combination" cannot hold at the 44px tap floor without
  unpinning the header or cutting the footer; the plan keeps the floor, the
  header and the chrome and lets the allowlisted rows region scroll on those
  devices only.

## Implementation steps (one PR against `staging`)

1. **Icons** (`app/src/ui/icons.ts`): add `lock` (`M5 7V4h6v3` shackle,
   `M3 7h10v7H3z` body, `M7.5 9.5h1v2h-1z` filled keyhole) and `stow`
   (`M8 2v7`, `M5 6l3 3 3-3`, `M3 11h10v3H3z` filled tray) on the 16px
   straight-segment grid; both drawn against the glyph they could be confused
   with at 9px (`bonds`, `demolition`).
2. **Markup** (`screens.ts`): split `workshopScreen` into `workshopRack(meta,
   selected, profile)` and `workshopDetail(meta, selected)`; delete the
   boilerplate ownership sentences, the `✓ Installed` / `✓ Owned` strips
   (the rack and options rows ARE the owned view), the aside and
   `.workshop__shop`; build the ladder from `def.tiers`; reuse `.rack-slot`
   and `.ship-plate__pips` for plates. Keep `nextBadgeHTML`, `priceAria`,
   `salvageHTML`, `hintPress`.
3. **State** (`main.ts`): `workshopSelected`, the `select-system` action,
   the default-selection rule, focus fallback to the selected plate.
4. **CSS** (`app.css`, the WORKSHOP section): `.workshop__body` columns and
   stretch; `.rack__group` / `.rack__plates` / labels; plate badges
   (`.rack-slot__badge`, `--shed`, `--next`, `--owned`, `--sel`, `--unowned`,
   `--plus`); the detail's ladder rows; compact rules. Move the
   `.rack__hdr .btn:disabled` costume the pins check to the +1 plate.
5. **Pad** (`padnav.ts`): `focusInitial` prefers an element marked
   `data-pad-initial` (the selected plate) over `.btn--primary`; pin it.
   Right from a plate reaches the detail's buttons, Left returns, Down
   reaches Contracts / Start Run. Verify with a real-Chromium drive
   (`window.__uifit.padMove(dir)` / `padFocus(el)`).
6. **Fixtures** (`app/sim/uifit/fixtures.ts`): update `workshop`,
   `workshop-owned`, `workshop-school`, `workshop-school-go`,
   `sys-drill-offer`; add `workshop-early` (one system owned, three open
   slots, nine on the shelf — the tallest shelf), `workshop-full` (ten slots,
   ten systems aboard at tier 2 — the widest rack row and no shelf),
   `workshop-shed` (detail on a stowed system: the Mount button),
   `workshop-gated` (detail on a Mark-gated system), `workshop-option`
   (detail on Scrap Cache). These are the "any combination" guards; the
   harness measures them on all 19 devices.
7. **Pins** (`app/sim/systems.ts`): retarget the Workshop block (the aside,
   the strips, `shop-card__body`, the tab-bar check, the glowing card) to the
   new markup, and add: every system's ladder text equals `def.tiers[i]`; the
   T3 row carries the refit tag; the footnote appears exactly once per
   detail; the buy button's face is `T{next} · cost`; every system appears in
   exactly one group row; the selected plate is `aria-pressed`; the plate
   `title` uses `hintPress`; the recommended plate wears the badge exactly
   when `recommendedPurchase` names it; no `[data-scroll]` other than
   `.workshop__rack` on the screen. Prove each new string pin fails first.
8. **Docs**: this file is the record; the PR body carries the measurements.

## Verification ritual (all green before the PR)

From `app/`:

- `npm run typecheck` (both tsconfigs).
- `npm test` (`tsx sim/systems.ts`) — **0 new** failures against a clean
  staging run (diff before blaming the change).
- `npm run test:uifit` — the summary line must read `0 new, 0 stale, 0 grown`.
  Then `npm run test:uifit:shots` and LOOK at the workshop fixtures on
  `Android · Pixel 7`, `iOS · iPhone 13 mini`, `Web · 1280x720 laptop` and
  `Web · 1920x1080 desktop`: both panels the same height, no plate row cut,
  the selected plate's outline whole.
- `npm run build`.
- Real-app drive in Chromium: seed `tetrilaunch.meta` in localStorage with
  `{licence: 10, mark: 3, salvage: 240, unlocks: ["survey"], loadout:
  {reactor: 2, launcher: 1, magazine: 1, bay: 1, hydraulics: 1}}`, open the
  Workshop from the menu, select every plate, buy one tier, stow and mount
  one, buy a slot, and walk the whole screen with `padMove` only.
- Retest on the Steam Deck after merge: the pad must reach every plate, both
  detail buttons, Contracts and Start Run, with nothing needing the
  touchscreen.

## Gotchas (from this repo's memory)

- PRs target **`staging`**, never main. Branch from `origin/staging`.
- Never bare `git stash` (shared stash stack across worktrees).
- Never run `playwright install` — Chromium is preinstalled.
- The uifit harness renders DOM only; `document.fonts.ready` is a no-op
  headlessly (force faces before measuring).
- `sim/systems.ts` cannot measure pixels — prove a new string pin fails before
  trusting it.
- Red/green is not a distinction here (the owner is red-green colour-vision
  impaired): carry every state on shape, position or a word, never on hue
  alone.
- No AI model name anywhere: code, commits, PR text, comments.
