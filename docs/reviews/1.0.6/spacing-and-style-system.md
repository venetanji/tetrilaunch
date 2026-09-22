# Lane 2 — Spacing, visual rhythm, style-system integrity

Reviewed tree: `bde8746` (`origin/staging` @ #232 + `origin/release/1.0.6`).
Method: read-only audit of `app/src/styles/app.css` (13,668 lines), `tokens.css` (264),
`cursors.css`, `ui/screens.ts` (9,388), `ui/components.ts`, `ui/icons.ts`, `game/theme.ts`.

## The structural fact behind everything here

`git diff main..HEAD -- app/src/styles/tokens.css` is **empty**.
`app.css` grew **+1,961 lines**; `screens.ts` **+2,287**.
The release added ~2,000 lines of CSS and **zero tokens**. Every number below follows from that.

| system | token uses | raw literals | distinct raw values |
|---|---|---|---|
| spacing (`padding`/`margin`/`gap`) | 129 `var(--sp-*)` | 525 raw px (371 off the 4px scale) | 31 |
| type scale (`font-size`) | 53 `var(--fs-*)` | 234 bare px | 23 |
| tracking (`letter-spacing`) | 7 `var(--tracking-wide)` | 68 raw | 11 |
| colour | — | 296 `rgb/rgba()` + 123 hex | 31 triples / 71 hex |

80% of spacing declarations and 82% of type declarations bypass the scale they should consume.

---

## P1 findings

### 1. Hub tower tap targets fell to 21px, and the baseline grew 45% to absorb it
`app.css:2339-2350` (`.tower__floor`), `app.css:2899-2950`, `app/sim/uifit/baseline.json`

**VERIFIED by decomposing both baseline files** (not just read):

| | `main` (1.0.5) | HEAD (1.0.6) |
|---|---|---|
| total baseline entries | 162 | 235 (+45%) |
| total violation entries | 214 | 237 |
| `.tower__floor` | 56 rows @ **37-42px** | **225 rows @ 21-43px** |
| `.tower__head` | 24 rows @ 22px | 12 rows @ 22px |
| `.lic-pip` | 96 rows | gone |
| `.tower__base` | 38 rows | gone |

235 baseline entries decompose as 225 `tap` + 10 `scrollers`. Commit `7b91304` divided a fixed
shaft by eleven rather than scroll. Floors are now **below half** the WCAG 2.5.5 / iOS HIG 44px
minimum at the bottom of the range, separated by `--tower-gap: 2px` (`app.css:2039`), and
`app.css:2424` records that `.tower__rail` paints over another 2px of each floor.

Eleven adjacent ~24px targets with 2px separation is the worst tap geometry in the app, on the
screen this release promoted to primary navigation.

**The trade is argued and owner-signed in the block header — this is not calling it a mistake.**
The finding is that `docs/releases/1.0.6.md`'s Risk list does not mention it at all (it covers
save format, scores, routing, native builds, install size, sprite bake). A reviewer reading
"235 baselined, 0 new" will never learn the main navigation halved its touch target.
**Suggested fix: one sentence in the risk list.** No code change implied.

Compounding: `.tower__floor:hover` exists (`app.css:2604`) with **no `:active`** — on a phone the
24px target has a latching hover tint and zero press feedback.

### 2. `.btn--primary:active` does not exist, so the loudest buttons never press in
`app.css:165` vs `app.css:205-209` — **VERIFIED by grep (0 matches for `btn--primary:active`)**

```css
app.css:165  .btn:active         { transform: translate(2px, 2px); box-shadow: none; }   /* (0,2,0) */
app.css:205  .btn--primary:hover { box-shadow: var(--shadow-hard), var(--glow-accent); } /* (0,2,0), LATER */
```

Equal specificity, later rule wins on `box-shadow`. A mouse press is **both** `:hover` and
`:active`, so pressing RESUME / LOCK IT IN / INSTALL / RUN TIER N / SUBMIT translates the button
2px down-right with its full 3px hard shadow and glow still attached. The button slides; nothing
presses in. `app.css:133-137` states the intended idiom: *"the button 'presses in' on `:active` by
translating into its own shadow."* The primary is the one variant that doesn't.

```css
/* Suggested fix */
.btn--primary:active { box-shadow: none; }
```

Repo-wide, **VERIFIED**: 29 `:hover` occurrences vs 10 `:active`. 22 interactive surfaces have a
hover state and no pressed state: `.mod-card`, `.tierhub__card`, `.sbx-chip`, `.tower__floor`,
`.bond-btn`, `.demo-btn`, `.thaw-btn`, `.rotate-btn`, `.setting`, `.guide__row`. On touch `:active`
is the only feedback that fires and hover is the one that misfires, so the affordance budget is
spent on the wrong pointer.

Motion vocabularies also disagree: `.btn:active` moves **+2,+2** (into the shadow);
`.mod-card:hover` (`app.css:8513`) moves **-2,-2** (away from it). Same modal, opposite directions.

### 3. One `.stat` component, two number formats, one screen transition apart
`screens.ts:7791-7793` vs `8921-8925`; `1528` vs `1531-1532`; `main.ts:8154`

#231 grouped thousands. It landed on *some* callers of the same component:

```
screens.ts:7791  <div class="stat"><b>${num(opts.score)}</b><span>Score</span></div>      <- GROUPED
screens.ts:8924  <div class="stat"><b>$${opts.funds.score}/${opts.funds.target}</b>...    <- NOT grouped
```

Same class, same treatment, and the bay-clear card is the screen shown *immediately before* the
run-end card. Also ungrouped beside grouped figures:

- `screens.ts:1528` `Best ${num(opts.best)}` four lines above `screens.ts:1531-1532`
  `$${bay.targetFrom}->${bay.targetTo}` / `$${bay.launchCost} · $${bay.startingFunds}` —
  **in the same `.base-bay` panel**.
- `screens.ts:7105`, `7313` — `statCellHTML("reactor","Carry","$${opts.carry} · ended $${opts.funds}")`,
  ungrouped, on the run-end card itself.
- `screens.ts:5601`, `3991`, `3997-3998` — more `.stat` / chain money, ungrouped.
- `main.ts:8154` `set("#hud-score", "$" + g.score)` — the live in-bay readout (deliberately bare).

`docs/releases/1.0.6.md` ("After a run") states the rationale: *"a grouped score above a bare
five-figure total reads as a typo in one of the two."* That exact defect ships in three places,
including inside one panel.

**Secondary, and load-bearing:** `app.css:5904-5925` ("R4: DIGIT-STABLE FIGURES") reserves widths
in `ch` from stated worst cases — *"funds 6 (`$18420`), target 8 (`/ 21000`)"* — and claims
*"VERIFIED … the clock's right edge and the rail's width do not move by a pixel."*
`$18,420` is 7 chars against `min-width: 6ch` (`app.css:5919`); `/ 21,000` is exactly 8 against 8
(`app.css:5920`). **The HUD is currently saved only by `main.ts:8154` not grouping.** If the live
HUD is ever grouped, the R4 contract breaks. Either way the comment's "VERIFIED" claim needs
updating in the same commit.

### 4. The type scale is 7 steps; the app renders 23, six inside a 2.5px band
`tokens.css:118-124` defines display/h1/h2/h3/18/16/14/12. `app.css` ships 234 bare-px font sizes
across 23 distinct values: 6, 6.5, 7, 7.5, 8, 9, 9.5, 10, 10.5, 11, 11.5, 12, 13, 14, 15, 16, 17,
18, 20, 22, 24, 28, 30.

- The most common size in the app — **11px, 40 occurrences** — has no token.
- Tokenised sizes are bypassed anyway: `12px` raw **26x** where `--fs-xs` exists; `14px` raw 8x
  (`--fs-sm`); `18px` raw 5x (`--fs-h3`); `16px` raw 2x (`--fs-body`).
- **9 / 9.5 / 10 / 10.5 / 11 / 11.5** — six steps inside 2.5px. No eye resolves those as six
  intentional ranks.

Worst single pane: `app.css:11207-11290` (`@media (max-height: 520px)`, the refit stop) — **nine
font sizes (8, 9, 9.5x3, 10, 12, 14, 17) and six gap values (1, 2, 4, 5, 6, 8) in one media block.**
The densest screen in the game reproportions every element by a different amount.

Tracking has the same disease: 75 `letter-spacing` declarations, 11 distinct values, of which 7 use
`var(--tracking-wide)`; **`--tracking-wider` (0.18em) has zero consumers**, and 10 raw `0.08em`
declarations are the token's exact value written by hand.

---

## P2 findings

### 5. 190 colour literals are exact token channel values; the theme cannot be retinted
296 `rgb/rgba()` literals, 31 distinct triples. **190 are a token's exact RGB:**

| literal | token | count |
|---|---|---|
| `rgba(0,240,255,…)` | `--accent` | 64 |
| `rgba(255,176,32,…)` | `--warn` | 40 |
| `rgba(255,45,85,…)` | `--danger` | 38 |
| `rgba(0,255,156,…)` | `--success` | 17 |
| `rgba(122,92,255,…)` | `--accent-2` | 13 |
| surfaces (18,18,31 / 27,27,46 / 4,4,10) | surfaces | 18 |

Plus 14 raw hex duplicating a token exactly. Change `--accent` and 64 glows stay cyan.
`color-mix()` is already used 27x in this file, so the alpha excuse does not hold, and no
`--accent-rgb` channel token exists to make the shorthand available.

`theme.ts:446-457` (`COLORS`) is a **third** hand-maintained copy of six of the same values,
labelled "Mirrors src/styles/tokens.css". Three sources of truth for one palette.

Specimens that document their own drift:
- `app.css:4704-4710` — `--cell-0..--cell-4` hardcode `#12121f/#1b1b2e/#24243b/#2e2e4a/#3d3d63`
  with `/* --surface */`, `/* --line */` comments beside each. The comment names the token the
  author chose not to use.
- `app.css:5212-5213` — the same hexes inside `color-mix(in oklab, #2e2e4a, …)` where `var(--line)`
  would work verbatim.
- `screens.ts:3890` (**new in 1.0.6**) — `windInk` returns
  `color-mix(in srgb, #ffb020, var(--danger) N%)`. One end of one ramp tokenised, the other end the
  raw hex of `--warn`, in the same expression.

**Note: severity is P2 as debt, not P1 as a bug.** There is no second theme — no `data-theme`, no
`prefers-color-scheme` anywhere in `app/src/` — so nothing is visibly broken today.

### 6. The hub rail re-proportions unevenly at its container breakpoint
`app.css:866-1418` — the release's flagship screen uses **11 distinct spacing values**
(2,3,4,5,6,8,10,12,14,16,42), of which **exactly one** (`var(--sp-2)` on `.tierhub__obj`, line 951)
is a token. The `@container rail (min-height: 470px)` block (`app.css:1387-1418`) re-specifies every
number independently: rail gap 10->14, card padding 6/12->10/16, card gap 12->14, inner text gap
4->4 (unchanged), contract padding ->12/12/12, preview gap 6px 5px.

Nothing moves in proportion, so the screen re-proportions unevenly the moment the rail crosses
470px — which on a desktop window is exactly the resize a reviewer performs.
**This is the single most likely source of the "feels off" impression.**

### 7. 27 components mix pixel+mono faces; the optical-drop token is paid in 1 rule
`tokens.css:69-113` derives `--pixel-optical-drop: 0.195em` from canvas cap-metrics across ~40 lines
and states the rule: *"Any row that puts a pixel label beside a mono value has to pay it."*
It is paid **once** — `app.css:6666`.

Enumerating every BEM block setting both `var(--font-pixel)` and `var(--font-mono)`: **27 components.**
Confirmed unpaid, centre-aligned rows:
- `app.css:9335-9361` `.lb__row` — `align-items: center` centres line boxes, not cap-centres; per the
  token's own derivation mono cap-mass sits ~0.07em low -> **~1.3px** on the tallest item. The
  leaderboard stacks twenty of these, so it reads as a wobble down the column.
- `app.css:10533-10558` `.ladder__row` — three faces/sizes on one 26px row, none corrected.
- Also unpaid: `.chip__label`/`__value` (3321/3322), `.bay-stat__lbl`/`__val` (1835/1849),
  `.workshop__tab`/`__tab b` (10679/10690), `.rack__label`/`__count` (10336/10343),
  `.refit__order-label`/`__order-spend` (9795/9800), `.salvage-row__body b` beside
  `.salvage-row__amt` (11117/11119).

A derivation this careful, pinned in `sim/systems.ts:8097-8118`, applied to 3 of 27 sites is worse
than not having it: the rows that pay it are now *differently* aligned from the rows that don't.

### 8. The card family has no spacing rank rule
Ten visually-parallel bordered surfaces (title/body left, control/state right):

| selector | line | padding | gap | radius |
|---|---|---|---|---|
| `.tierhub__card` | 1195 | 6px 12px | 12px | `--r-md` |
| `.mod-card` | 8488 | 14px 16px | 6px | `--r-lg` |
| `.shop-card` | 10198 | 10px 14px | 4px 16px | `--r-lg` |
| `.contract-card` | 10949 | 12px 14px | 6px | `--r-lg` |
| `.lb__row` | 9335 | 10px 14px | `--sp-3` | `--r-md` |
| `.salvage-row` | 11110 | 8px `--sp-3` | `--sp-3` | `--r-md` |
| `.guide__row` | 9165 | 6px 10px | `--sp-2` | `--r-md` |
| `.bind-row` | 10803 | 2px 10px | 8px | `--r-md` |
| `.ws-short__card` | 10647 | 0 10px 0 12px | 8px | — |
| `.sbx-chip` | 13273 | 4px 9px | 4px | `--r-sm` |

Six horizontal paddings, seven vertical, three radii, no stated rank rule. Two of ten use a token.

**The button primitive is nine components wearing one class.** `.btn` (`app.css:146`) is
`padding: 14px 26px`. Base-layer instance overrides: `6px 14px`, `0 14px`, `0 8px`, `8px 10px`,
`8px 14px`, `18px 36px`. Under media queries another nine. **15 distinct button paddings** plus nine
button font sizes (8,9,10,11,13,18,20,22,30). `.btn` and `.icon-btn` also disagree on transition
scope (`transform, box-shadow, background` vs blunt `all`).

### 9. Five disabled recipes for one state
| recipe | rules | lines |
|---|---|---|
| `filter: grayscale(.7) brightness(.6)` | 7 | 1357, 7281, 7299, 7326, 10034, 10226, 10462 |
| `filter: grayscale(.7) brightness(.55)` | 3 | 3780, 3893, 3935 (the three rail buttons) |
| `opacity: 0.45` | 1 | 8875 |
| `opacity: 0.32` | 1 | 13293 |
| `filter` + `opacity: 0.5` | 1 | 1415 |

The .55-vs-.6 split has no stated reason and the two opacity values disagree by 40%. `cursor` also
splits: `default` x9, `not-allowed` x1. "Disabled" must look identical everywhere or players stop
trusting it.

### 10. Eight geometry transitions unguarded under reduced motion
The reduced-motion audit covered `animation` and never `transition`. 14 transitions have no
reduced-motion counterpart; **8 animate geometry**:

| line | selector | transition |
|---|---|---|
| 138 | `.btn` | `transform, box-shadow, background` |
| 215 | `.icon-btn` | **`all`** |
| 3844 | `.bond-trigger::after`, pause `::after` | `transform, opacity` |
| 5673 | `.pl-goal i` | `transform, background` |
| 8488 | `.mod-card` | `transform, box-shadow` |
| 9103 | `.toggle` | **`all`** |
| 9104 | `.toggle::after` | **`all`** |
| 9629 | `.settle-note` | `opacity, transform` |

A reduced-motion user still gets a sliding Settings thumb, a translating rail button, and a gliding
mod-card. The three `transition: all` are worse — they will animate any property added later.
`app.css:12098` proves the team knows the idiom; it just was not extended.

### 11. `windInk` half-tokenised; the wind notch background is an untested derived constant
- `screens.ts:3890` (new) — see finding 5.
- `app.css:11843` `.bay-banner__wind { background: #090912; }` documented as *"the banner's own rgba
  composited over the field (#04040a)"*. Correct only while `.bay-banner`'s `rgba(10,10,20,0.78)`
  (`app.css:11786`) and `--bg-deep` both stay put. Change either and the notch becomes a visibly
  mismatched tab under the banner, with no test holding the relationship. Should be a `color-mix()`.

**On the wind ramp itself** (a stated risk in the release doc): the "no green leg" reasoning is
sound and **no adjacent-colour collision was found**. `--success` is confined to
`.bay-banner__wind--stab .bay-banner__wind-stat` (`app.css:11906`) and the fill never enters green.
**No finding.**

### 12. `.salvage-row` mixes a token and a raw literal in one declaration
`app.css:11110-11112`:
```css
.salvage-row {
  gap: var(--sp-3);
  padding: 8px var(--sp-3);   /* --sp-2 IS 8px, and the token is already on the line */
```
The purest specimen of the lane: the author had the token in hand on the same declaration.

---

## P3 findings

13. **8 tokens have zero consumers**: `--sp-7`, `--sp-8`, `--tracking-wider`, `--glow-soft`,
    `--shadow-panel`, `--shadow-card`, `--tap-md`, `--ctrl-gap`. Near-dead: `--sp-5` (1),
    `--fs-display` (1), `--fs-body` (1), `--bw-thick` (1), `--fw-black` (1).
    Two are actively misleading: `tokens.css:236` documents `--ctrl-gap` as *"gap between the two
    rotate buttons"* and `tokens.css:233` documents `--tap-md` as *"side-rail buttons' size cap"* —
    the rail was rebuilt around `--rail-gap`/`--rail-btn` and neither token was removed.
14. **"ONE focus token" is stated four times** — declared at `app.css:230-237` ("stated once"), then
    restated verbatim at `9086`, `9177`, `9238`. All three already match the D4 selector.
    `app.css:9376` `.name-input { outline: none }` is inert (loses to D4 at (0,2,1)) and misleading.
15. **5 dead selectors**: `.mod-card__mark` (8667), `.chip--accent` (3328), `.chip--cta` (3335/3340),
    `.is-cleared` (1338/9572), and `.cancel-aim-btn:hover` (3603) which is **unreachable** — the
    element is `display: none` outside `@media (pointer: coarse)`.
    Plus **10 inert `cursor: default`** declarations that lose to `cursors.css`'s (1,2,1) rule.
16. **Badge corner overhangs have no rule**: `-6px` (3782/3895/3937), `-7px` (`.pl-notch`, 6941),
    `-8px` (`.tierhub__halo > .alert-mino`, 1131). Also three copy-pasted count-badge rules
    (`.bond-btn__count`, `.demo-btn__count`, `.thaw-btn__count`) with eight identical declarations
    each, differing only in two colours which themselves disagree about tokenisation.
17. `app.css:10647` `.ws-short__card { padding: 0 10px 0 12px }` — asymmetric, uncommented, in a card
    whose comment two lines above says it should *"read as the hub's own Contract cards"* (which are
    symmetric). And `app.css:11679` vs `11761`: the front door's icon edge:gap ratio flips from
    2.3:1 to 1.75:1 between densities, so icons visibly reseat relative to their text.
18. `app.css:9493` `[max-height:460px] .base-bay__extras .btn { min-height: 0 }` is the only explicit
    kill of the 44px floor; its comment claims *"Nothing shippable renders it either way"* — worth a
    one-line confirmation before release since it is the one place the floor is written off.

---

## What was checked and found sound

Worth recording, because the brief expected problems here and there are none:

- **Dead menu-era CSS after the hub redesign: zero.** All 13 `.menu__*` families are still emitted
  (`screens.ts:2474-2610`). The 169 retired baseline keys were fixture/device keys, not orphan CSS.
- **Duplicate shadowing selectors: one, deliberate and commented** (`.tower__head`, 2190 vs 2200).
- **Duplicate property inside a rule: 5, all legitimate `vh->dvh` / `vw->cqw` fallbacks.**
- **`!important`: 2 occurrences, one inside a comment.** The single real use (`app.css:8394`,
  `.lose-fx * { animation: none !important }`) is inside a reduced-motion block. Exemplary.
- **`prefers-reduced-motion` animation coverage is essentially complete** — 35 blocks, all 49
  `infinite` animations matched against guards. The F9 block (13628-13668) is exemplary.
- `.pad-chip--a/--b/--y` and the `mod-card--*` / `draft__slot--*` / `preview-stat--*` families are
  **live** via template construction, despite failing a naive grep.

## Conclusion

The stylesheet's **structure** is disciplined and its comments are load-bearing. What has rotted is
the **quantitative layer** — the scales in `tokens.css` — because ~2,000 new lines of CSS were
written against a token file that gained nothing. Findings 1, 3, 4, 6, 8 and 12 are all symptoms of
that single omission.
