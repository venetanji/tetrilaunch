# Workshop Shop Layout — Tabbed Rows

**Status:** designed, not implemented. Branch `systems-layer` at `65c8415`.

**Goal:** The Workshop's shop scrolls 3.6 screens on a landscape phone. Make the
thing the player came to buy visible without scrolling, and give the ten option
unlocks the same glyph treatment the seven ship systems already have.

---

## The measurement

Everything below rests on this. Measured in Chromium at 792x360 — the OnePlus 12
viewport the layout specs measure against — driving the dev server at a fresh
save (7 installable systems, 10 unowned options, 17 cards):

| | |
|---|---|
| `.workshop__shop` height | 189px |
| content height | 689px |
| **overflow** | **500px — 3.6 screens** |
| card | 122px tall x 180px wide, 4 columns |
| chrome above/below the scroller | 136px (header 52, Start Run 37, meta 8, gaps/padding 39) |

The screen is 360px; `.workshop` gets 325px of it.

## Why not two columns

The obvious fix — reuse `.end`'s two-column split (app.css:927-975), which solves
the identical-sounding problem for the run-end modal — **measures worse at every
ratio.** Recorded here so nobody spends the afternoon rediscovering it:

| layout | shop width | shop height | columns | overflow |
|---|---|---|---|---|
| today, one column full width | 742px | 189px | 4 | 500px |
| `1.15fr 0.85fr` (`.end`'s own ratio) | 300px | 309px | 1 | **1677px** |
| `1fr 1fr` | 355px | 309px | 2 | 869px |
| `0.85fr 1.15fr` | 411px | 309px | 2 | 843px |
| `0.6fr 1.4fr` | 504px | 309px | 3 | 638px |
| `0.45fr 1.55fr` (shop favoured) | 559px | 309px | 3 | 623px |

The shop gains 120px of height (+63%) and loses columns 4 -> 1. Card rows
multiply faster than the extra height absorbs them.

`.end` works because **a leaderboard row is a single line** — narrowing it costs
nothing, so spending width to buy height is free. A shop card reflows and grows
taller as it narrows. For this content **width is the scarce axis, not height**,
which is the exact inverse of `.end`'s diagnosis. The two screens look alike and
are not.

Shrinking the card alone doesn't get there either — deleting the description
outright only takes 500px to 280px:

| variant | card height | overflow |
|---|---|---|
| today, desc clamped to 3 lines | 122px | 500px |
| desc 2 lines | 109px | 435px |
| desc 1 line | 96px | 370px |
| desc hidden entirely | 78px | 280px |
| desc 1 line + 120px columns (5 across) | 96px | 316px |

## The design

Two changes that only work together.

**1. The card becomes a row.** `.lb__row`'s shape — fixed leading track, flexible
middle, trailing value — maps onto a shop card as `auto 1fr auto`: glyph, name +
one-line desc, price. **This is the transferable part of the leaderboard**, not
its two-column grid. Card height 122px -> 40px.

**2. Systems and Options become tabs.** Only the active section renders.

| variant | overflow |
|---|---|
| rows, 2 columns of rows | 268px |
| rows, 3 columns of rows | 258px |
| **rows + tabs** | **0px** |

Rows without tabs still leaves 258px (~1.4 screens). Tabs without rows leaves
71px on Systems and 219px on Options. Together: nothing scrolls.

### Decisions and their reasons

**Tabs render at every viewport, not only short ones.** Short-only means the
markup differs by viewport height, which CSS cannot express once `workshopScreen`
emits only the active pane — it would take JS reading viewport height, i.e. two
structural code paths. Accepted cost: a tall screen has room for both sections
and now shows one.

**Systems opens by default,** following phase 1's stated intent that the shop
leads with permanent power (screens.ts:700-706). Tabs carry a buyable count
(`Systems 3 · Options 10`) so the hidden side advertises itself.

**Tab state lives on `App`, not in the DOM.** `main.ts:263` rewrites
`overlay.innerHTML` wholesale and both purchase handlers call `renderOverlay()`
(main.ts:808, 823), so a `:checked`-sibling or `:target` tab would reset on every
purchase. `:target` would also push history entries.

**The row's desc clamps to one line.** app.css:1468-1472 argues the desc is the
only thing telling you what you are buying, so it stays — truncated, with the
full text still readable on a taller screen.

## Glyphs for the ten unlocks

Options rows need a glyph or they will not share a left edge with Systems rows.
`UnlockDef` (meta.ts:30-72) has no icon field and `IconName` (icons.ts:23-35) has
no per-unlock entries, so this is: 10 new `IconName` members, 10 new `PATHS`
entries, and an `icon` field on `UnlockDef`.

The icon contract, read off `icons.ts` — a new glyph that breaks any of these is
unusable:

- **`viewBox="0 0 16 16"`, hardcoded in `icon()` at icons.ts:94.** Paths are
  authored in that space verbatim — no transform, group or scaling. Integer
  coordinates; observed extents x 1..14, y 1..14. Half-pixel values appear only
  where they land on whole pixels at 2x.
- **The wrapper supplies all shared paint** (icons.ts:94-96): `fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="square"
  stroke-linejoin="miter"`. Paths carry geometry plus overrides only.
- **Solid vs stroked is a legibility decision, not a style one** (icons.ts:37-38).
  A filled glyph sets `fill="currentColor" stroke="none"` on its own path;
  outline is the inherited default.
- **Straight segments only.** No path in the set uses `A/C/Q/S/T`. Stated on
  `demolition`: a curve is the one shape that would need anti-aliasing to read,
  which the pixel frame does not give.
- **Blocky, never rounded** — the surrounding design system is a pixel typeface;
  a rounded outline set would read as a different product.
- **Must survive the rendered size, not 16px.** Default render is 14px and
  app.css:1235 forces `.ico` to 13px at this very breakpoint. `workshop` is a nut
  rather than a cog precisely because six flats survive 14px and gear teeth do
  not.
- **Each new glyph must be distinguishable from the other 16 at 13px** — the 7
  ship tracks plus the 9 chrome/UI glyphs.

## Implementation notes

Traps found by reading the CSS and markup, listed because each one is a bug that
would otherwise ship.

### `app.css`

All row-layout rules go **inside** the existing `@media (max-height: 460px)`
block (1473-1502). The base `.shop-card` at 1418-1425 must not be touched.

- **1432 `.shop-card__foot { margin-top: auto }` is declared outside the media
  query.** Auto margins beat `align-items`, so the price bottom-aligns against
  the desc in a row card. Reset it to `margin-top: 0` *inside* the block — do not
  edit line 1432, or the tall card's buy buttons stop sharing a baseline. This is
  the single most visible tall-layout regression available here.
- **`min-width: 0` on the middle track.** Grid items default to
  `min-width: auto`, so a long unbroken name or desc blows past the column
  instead of shrinking. Called out by the research as the most likely overflow
  bug. `.shop-card__desc`'s `flex: 1` (1431) goes inert on a grid item.
- **1433 `.shop-card__foot .btn { width: 100% }`** — in an `auto` track this is
  circular; needs `width: auto` inside the block.
- **1436 `.shop-card__locked`** — the gated branch replaces the button with a long
  text run (`Needs Demolition Licence · Mark 2`) that will size the `auto` track
  and starve the desc. Needs a `max-width` or wrapping rule.
- **1494's `gap: 5px`** becomes the column gap between glyph/text/price. Tight.
- **1490-1493**: the short-viewport `minmax(148px, 1fr)` is the value to change,
  **not** 1417 — the base rule already reads `minmax(230px, 1fr)`.
- **110 `.ico { flex: none }`** goes inert as a grid item; centering comes from
  the row's `align-items: center`.
- **1455-1458 and 1486-1489 comments** argue "one wrapper rather than two loose
  grids / the scroller is the SHOP, not either grid". Tabs invalidate that
  reasoning. Rewrite them or they will document the opposite of the code.

### `screens.ts`

- **The tab bar is a sibling *above* `.workshop__shop`, never inside it** —
  app.css:1489 makes `.workshop__shop` the scroller, so a bar inside it scrolls
  away. It becomes fixed chrome: roughly 38px (a `.btn` at app.css:1233 is ~30px
  here, plus one `--sp-2` gap) off the shop pane.
- **The budget readout rides on the Systems section label** (screens.ts:729). Tabs
  remove that label. Re-home it — the tab bar is the natural place — or it
  silently disappears. The budget, not the price, is the usual reason a purchase
  is refused.
- **`installedStrip` and `ownedStrip` (751-754) are section-specific** and
  currently sit above the shop. Left there, the Options tab shows the "✓
  Installed" strip. They move into their matching panes.
- **Both empty states** (`installSection`'s "Every system your Mark allows is
  installed", `done`'s "Every option unlocked") must render inside their own pane,
  and the tab must remain so the player never lands on a blank screen.
- **The Systems glyph must come out of `.shop-card__name`** (717) into its own
  track-1 element. Wrap name+desc in a `.shop-card__body` so the pair occupies
  the `1fr` track as one item.
- **Markup changes are not media-scoped.** The tall card is `flex-direction:
  column` (1419), so a new first-child glyph on Options cards renders on its own
  line above the name — not today's appearance. `.shop-card__body` needs
  `display: flex; flex-direction: column; gap: 8px` at base and a tighter gap
  inside the 460px block to preserve the tall look.
- `workshopScreen(meta)` gains a `tab: "systems" | "options"` parameter.

### `main.ts`

- New field `private workshopTab: "systems" | "options" = "systems"`, reset on
  entering the screen (main.ts:1089), passed at main.ts:263.
- New `case` in the click switch beside `buy-install` (1121-1122), reading a
  `data-tab` attribute and calling `renderOverlay()`. **Do not name the action
  `"workshop"`** — that case already exists at 1089.
- Tab buttons must be real `<button>`s: the keyboard handler (1055-1064) only
  synthesizes activation for `role="switch"`, so a non-button needs new keyboard
  code, while native buttons get Enter/Space free. Add `role="tablist"`/`"tab"`,
  `aria-selected`, and `role="tabpanel"` on the pane. Delegation at 1067 and
  `tapHaptic()` at 1083 already cover it.

### `design/screens/workshop.html`

A hand-maintained mirror of `.workshop*`/`.shop-card*` that claims (line 10) to
mirror `screens.ts` + `app.css`. It drifts on every rule above and should be
regenerated with the change.

## Testing

`sim/systems.ts` is the only file importing `workshopScreen`/`refitScreen`/`icon`
for testing, so the new checks go there. It asserts on strings and **cannot
measure pixels**.

- both tabs render, with their buyable counts
- only the active pane's cards appear in the output; the inactive pane's do not
- the default tab is Systems
- the budget readout survives the label's removal and appears on the Systems tab
- every `UNLOCKS` entry has a glyph, and every glyph name resolves in `PATHS` —
  the structural check `tsc` cannot make, matching the existing every-track-has-a-
  glyph check
- each pane's empty state renders with its tab still present

Pixel overflow is verified by re-measuring in the preview at 792x360 and
reporting the number, as the table above was produced. The repo has no browser
test harness and adding one is not this change's job.

## Deliberately not in scope

- The hazard draft and `makeBaseLevel` auto-scaling (systems-layer phase 2).
- Re-pricing `UNLOCKS` or `INSTALLS`.
- The refit screen's four-column grid, which phase 1 already settled.
- A browser test harness.
