# Lane 5 — Accessibility and input-modality parity

Reviewed tree: `bde8746` (`origin/staging` @ #232 + `origin/release/1.0.6`).

**Method — nothing was eyeballed.** Three throwaway Playwright harnesses on top of
`app/sim/uifit/harness.ts` (the real screens, the real `app.css`, the real `padnav.ts`), run over all
**164 fixtures**:
- a WCAG contrast pass that resolves gradient grounds by compositing every colour stop and reports the
  worst and best ground per text node (4 device rows: 640x360, iPhone 13 mini, 1280x720, 1920x1080);
- a modality matrix over every `[data-action]/[data-game]/[data-toggle]/[data-bind]`, at
  `pointer: coarse` **and** `pointer: fine`;
- a BFS over the **real** `pickNext` focus graph from each screen's own `focusInitial` landing, on 5
  device geometries;
- a focus-containment probe (tabbables outside the topmost `.modal-scrim`) and a text-only-zoom probe.

All temporary tooling was deleted.

---

## P1-1 — Text cannot be made larger on any shipping build. WCAG 1.4.4 (AA) fails outright.

- `app/native/android/MainActivity.java:128` — `getWebView().getSettings().setTextZoom(100)` pins the
  WebView's text zoom, discarding the Android system font-size setting. The method's own comment says so
  ("no layout budget that can absorb a user-configurable text multiplier — lock it to 100% the same way
  a canvas-based game would").
- `app/src/styles/app.css:39-42` — `-webkit-text-size-adjust: 100%` opts out of WebKit autosizing on
  iOS (a real, load-bearing notch-era fix — **not** asking for a revert).
- `app/index.html:15` — `maximum-scale=1.0, user-scalable=no`, plus `zoomEnabled: false` on both
  platforms in `capacitor.config.ts`, removes pinch as the fallback.
- `app.css` has **295** `font-size: …px` declarations and **0** in `rem`/`em`, so nothing would respond
  even if a multiplier got through.

**Net: on Android native, iOS native and Android mobile web, a low-vision player has no route at all to
larger text.** Desktop is fine — browser zoom shrinks the CSS viewport and the solver reflows (200% of
1280x720 is 640x360, a row the fleet already passes). This is the one finding where an entire user
group is locked out, and both Apple's and Google's accessibility review guidance name font scaling.

**Why the lock exists — measured, so the fix is scoped honestly.** Injecting a text-only multiplier over
the real screens on a Pixel 7:
- **x1.3 (Android "Large"): 88 of 164 screens gain new clipping.** The new hub is hit on every variant —
  `.tierhub__card-sub` clips 62px in X, `.tierhub__pay` clips ~19-22px in Y.
- **x2.0 ("Largest"): 144 of 164.** The splash wordmark runs 177px off-screen.

So "just unpin textZoom" ships a broken UI. **The realistic 1.0.6 answer is to leave the lock and file
this** — ideally with an in-app text-size setting later. But the release should not go out believing it
supports text scaling.

## P1-2 — Modals are not modal for the keyboard: 11 of 13 scrim states never seal, and focus is never moved into a modal

`padnav.ts`'s `sealBehindScrim` exists precisely for this ("Tab walked straight underneath: three
presses from 'Delete this player account?' reached 'Sign Out' behind it"). It is called from exactly two
places — `main.ts:4175` (`account-delete`) and `:4336` (`seal-break`).

**Unsealed:** `paused` (`main.ts:4229-4241`), `won`/`lost`, `draft`, `refit`, `contracts`,
`contract-end`, `lesson-end`, `drill-end`, `sys-drill-offer`, `ws-short`, `tutorial-offer`.
Measured tabbable escapees behind the top scrim (1280x720):

| fixture | escapees | includes |
|---|---|---|
| `refit-intro` | 6 | 5x `stage-upgrade`, **`refit-done`** (spends the staged scrap and undocks) |
| `sys-drill-offer`, `workshop-short`, `workshop-short-run` | 15 | **`buy-slot`** (spends salvage), 8x `select-system`, `tiers` |
| `pause`, `pause-armed`, `pause-pad` | 9 | rail `fullscreen` (not state-gated — `main.ts:9435` runs unconditionally), `pause`, `rotl/rotr/bond/demo/auto`, 2 plant chips |
| `contracts-intro` | 4 | 3x **`contract`** (launches a Contract) |
| `draft-intro` | 2 | 2x `pick-hazard` |
| `coach-fail`, `exam-fail`, `lesson-end-*` | 4 | rail buttons |

`padNavRoot()` (`main.ts:4739`) already solves this for the pad by scoping to the last `.modal-scrim` —
and `main.ts:4727-4734` documents the exact harm on the pad ("entering the yard for the first time
focused `refit-done` behind the explanation and A undocked the ship"). **The keyboard has no
equivalent. Same bug, same place, other modality.**

**Second half: `syncPadFocus` (`main.ts:4704-4715`) returns early unless `profile === "gamepad"`.**
Every `renderOverlay` rewrites `innerHTML` wholesale, so on every screen transition a keyboard player's
focus falls to `<body>` and is never re-landed. (In-place patches *do* restore — `data-bind`/
`data-toggle` at `main.ts:4450-4452`, the draft at `:7136`, the refit at `:6762`, the sandbox at
`:9734` — but full transitions do not.) Concretely: a keyboard player presses P to pause, gets no focus
at all, and must Tab through **nine controls under the scrim** before reaching Resume.

**Fix:** one `sealBehindScrim(this.overlay)` per arm; and drop the `gamepad` guard (or add a
keyboard-profile arm).

## P1-3 — The Refit's Undock price is amber on cyan: 1.07:1

**INDEPENDENTLY VERIFIED by this reviewer.** `screens.ts:5844-5846` puts `scrapHTML(spend, 11)` inside
`class="btn btn--primary btn--block"`. `.currency--scrap { color: var(--warn) }` (`app.css:10108`) is
`#ffb020`; `.btn--primary` is `linear-gradient(100deg, var(--accent), #38d6ff)` (`app.css:171`).

Computed on the real rendered gradient:

| pair | ratio |
|---|---|
| `#ffb020` on `#00f0ff` (gradient start) | **1.30:1** |
| `#ffb020` on `#38d6ff` (gradient end) | **1.07:1** |
| `--accent-ink #04040a` on start (rest of the label) | 14.52:1 |
| `--accent-ink #04040a` on end | 11.91:1 |

WCAG AA needs 4.5:1. Reproduces on all four device rows; the scrap glyph inherits `currentColor`, so the
icon is invisible too. Confirmed in a 2x screenshot of `refit-staged`: "INSTALL 7 · ▰325 — UNDOCK →" —
**the `325` is the one token on the button you cannot read, and it is the number stating what an
irreversible purchase costs.** The worst contrast pair in the app and the only one below 2.8:1.

**Fix (~20 characters):** give `.refit__foot .btn--primary .currency--scrap` the button's ink.

## P2-1 — The tier hub's tower floors are 25-32px tall on every phone, against the project's own 44px floor

`app.css:2339-2350` — `.tower__floor { flex: 1 1 0; min-height: 0; }`. The shaft divides its height by
11. Measured `hub` across the full 23-row fleet:

| device | floor box | gap |
|---|---|---|
| iPhone 13 mini | 108 x **25.4** | 2px |
| OnePlus 12 | 108 x **25.7** | 2.1px |
| Galaxy S8+ | 108 x **26.0** | 1.9px |
| Android 640x360 | 82 x **26.3** | 2px |
| iPhone SE 3 / X | 82-108 x 27.6 / 26.7 | 2px |
| Pixel 5 / 7 / iPhone 15 | 108 x 28.3-30.0 | 2px |
| iPhone 16 Pro Max | 108 x 32.4 | 2px |
| 1269x663 / 800x600 windows | 108 x 43.3 / 42.8 | 2px |

**13 of 23 rows under 44px; all 11 phone rows under 33px.**

To be fair about the bar: 25.4 x 108 with a 2px gap *passes* WCAG 2.2 SC 2.5.8 (24x24, AA). It fails
SC 2.5.5 (AAA), Apple HIG 44pt, Android 48dp, and the repo's own `--tap-min: 44px`, which `tokens.css`
calls "absolute floor for any tappable control" and `.btn` (`app.css:163`) enforces as `min-height` with
the note "Padding may shrink; the target may not."

This is the primary navigation of the screen #223 was built to create, and **the one place in the app
where the house floor was dropped without an argument in a comment.** 11 x 44 = 484px on a 360px
viewport, so this needs a design decision, not a CSS edit — but it should be a decision someone took.

*(Cross-lane: the fit and spacing lanes reached the same geometry independently; see
`resolution-and-fit.md` finding 7 and `spacing-and-style-system.md` finding 1.)*

## P2-2 — The game itself has no accessible name, role, or state at all

`main.ts:1223` — `<canvas id="game"></canvas>`. No `role`, no `aria-label`, no fallback content, no
`tabindex`. A screen reader announces literally nothing for the entire playfield.

For an arcade physics game a playable non-visual mode is a different product, and the moment-to-moment
aiming is irreducibly visual — **that absence is not flagged.** Two things are cheap and currently absent:
1. **A name** — one `aria-label="Play field"` so a screen-reader user isn't handed an unlabelled void.
2. **Critical-state announcements** — funds crossing target, time low, congestion entering danger, bay
   cleared, run lost are all already computed and all visual-only. The HUD is patched per-frame with no
   live region (correct — per-frame would be unusable), but nothing announces the *crossings* either.
   `.bay-banner` carries `role="status"` (`screens.ts:4438`), which is the right shape; a sibling polite
   region fed only on threshold crossings is small work for the one thing a blind or low-vision player
   could actually use.

---

## Corrections to the review's own hypotheses

**Three things this lane was pointed at are NOT what was predicted.** Recorded so nobody re-spends time.

**The wind notch is not information conveyed by colour alone.** `screens.ts:3899` renders the fill as
`transform: scaleX(${now})` on a full-reach element anchored at a centre tick, so **magnitude is the
bar's length** and direction is which **side** of the tick it sits on. `windInk` (`screens.ts:3881`) is a
redundant second channel, and the comment at 3886-3892 shows the green leg was deliberately removed
*because* `--success` means STAB a few pixels away. Against the track `--surface-3 #24243b`, every fill
colour clears SC 1.4.11's 3:1: calm `--accent` 10.72:1, `--warn` 8.26:1, mid-ramp `#ff6e3a` 5.42:1,
`--danger` 4.14:1. A deuteranope reading the ramp by luminance alone gets only 1.99:1 amber-vs-red — but
length carries it. **Verdict: the encoding is sound.**

What *is* wrong with the notch is smaller and different:
- **P2** — `aria-hidden="true"` on the whole component (`screens.ts:3899`) plus the explicit "NO NUMBER"
  decision (comment at 3862) means wind strength has **no text or numeric representation anywhere in the
  game**. The canvas gauge this replaced had a percentage readout. On every phone row the notch is
  160 x **13px**, the track 73.2 x **4px**, the fill's full reach **22px**, and the "Wind"/"STAB"/"CALM"
  words are **7px** type (`--fpx` floors at `max(7px, …)`). **7px is the smallest text in the app by a
  wide margin**, and 4px x 22px is a very thin channel for a mechanic that changes where your shot lands.
  Contrast is fine (5.29:1 / 14.90:1); size is not.
- **P3** — one genuine colour-only edge case: the status slot shows `STAB` *or* `CALM`, never both
  (`screens.ts:3897`). With a stabiliser fitted, calm-vs-windy is carried by cyan-vs-amber (1.30:1
  luminance) plus a ~1px bar, with no word.

**The Unlock ceremony IS pad-skippable.** `main.ts:8868` — `if (this.celebrating && button ===
PAD_CONFIRM) this.pickTier(this.towerState().selected)`, reusing `pickTier`'s dismissal-only branch so
pointer and pad end it through one path. **The open question at `docs/releases/1.0.6.md:414` can be
closed YES.** The keyboard has no skip but does not need one: the ceremony blocks no input, and
`towerCelebrationMs` bounds it at 3.04s-4.75s. *(Nit: the comment at `main.ts:8866` still says
"`celebrating` is only ever true on the menu" — it is the hub now.)*

**`@media (pointer: fine)` does not hide the rail's game buttons in this tree.** The modality matrix
shows all 7 rail buttons visible, keyboard-focusable and pad-focusable at both pointer types; the only
`pointer: fine` blocks left in `app.css` are scrollbars (460), `.pause-keys` (3404) and `.drag-hint`
(3731), and the rail's keycap/pad legends switch on `:root[data-profile]` instead (`app.css:3722`).
**Any documentation still describing fine-pointer rail hiding is stale.** Across all 164 fixtures the
*only* visibility difference between pointer types is the two plant chips `#bond-chip`/`#demo-chip`
(coarse-hidden, duplicated by the rail buttons). **No control exists on one modality only** except the
two below.

---

## Remaining findings

**P2 — `PAD_CONTROLS_DOORS` was not updated for the hub.** `main.ts:543-551` maps `menu, howto,
settings, leaderboard, workshop, contracts, sandbox` — **no `tiers`**, and `S.ControlsDoor`
(`screens.ts:3060-3061`) has no `"tiers"` member. So on the tier hub — the screen 1.0.6 makes the game's
home, and where a pad player spends the most time — the Select/Back/View button does nothing.
`padnav.ts:47-59` argues at length that this button exists precisely because it "cannot be rebound away"
and is "the way out" from a bad rebind; **the hub is the one menu it doesn't work on.** The hub also
renders no on-screen Controls door, so a pad player must B out to the front door first.
*(Found independently by the UX-flow and copy lanes — three lanes converged on this.)*

**P2 — Tier S is reachable only by mouse/touch.** `screens.ts:993-994` renders the beacon as
`<button class="tower__head" … data-action="tower-beacon" aria-hidden="true" tabindex="-1">`. It is the
**only control in the app with no accessible name** (the semantics pass flagged exactly one, on 16 hub
fixtures) and it is excluded from `focusTargets` by both the `tabIndex < 0` and `aria-hidden` guards.
Nine taps within a window (`lib/devmode.ts`) sets `settings.devMode` (`main.ts:3022`), which is the
*only* way to turn it on — `screens.ts:3001-3002` renders the Settings toggle **only when `s.devMode` is
already true**. **A keyboard-only or gamepad-only player (Steam Deck, where the release plan claims
controller parity) can never unlock the sandbox tier or its separate leaderboard.** Secrets can still
have a second route.

**P2/P3 — 11 text/ground pairs below threshold, all minor apart from P1-3.** On each node's *most
favourable* gradient ground:

| ratio | px | selector | colour on ground | note |
|---|---|---|---|---|
| 1.07-1.30 | 11.3 | `.currency--scrap` in Undock | `#ffb020` on `#38d6ff` | **P1-3** |
| 2.31-2.84 | 10-15 | `.build-tag` "dev" | `--text-faint` | already `aria-hidden`, dev-only — fine |
| 2.75-3.91 | 8-12 | `.mod-card__kind` | `--accent-2 #7a5cff` on `rgb(40,36,75)` | worth a look |
| 3.20-4.44 | 9.1-15 | `.mod-card__pick` | `--accent-2` on `rgb(43,38,82)` | worth a look |
| 3.16-4.18 | 8-12 | `.guide__mark--locked` | `--text-faint-ink` on accent tint | |
| 3.95 | 9-14.6 | `.refit__order-spend--idle` | `--text-faint-ink` on `--surface-2` | |
| 4.03 | 7.5-14.6 | `.preview-stat__long/__short` | `--text-muted` on `--surface-3` | documented palette behaviour |
| 4.13-4.43 | 8.8-16.1 | `.preview-stat__from` | `--text-muted` on `rgb(14,40,42)` | |
| 4.16 | 8-14 | `.guide__drill-kind/-go` | `--text-faint-ink` on `--surface` | |
| 4.34 | 10-15.4 | `.sbx-brief__id` | `--text-faint-ink` on `--surface` | |

The `--accent-2` pairs are the ones worth attention: `#7a5cff` is 4.59:1 on `--bg` but **3.86:1 on
`--surface-2` and 3.45:1 on `--surface-3`, so it fails AA on any panel.** The `--text-muted`/
`--text-faint-ink` rows are the documented behaviour `tokens.css:28-38` already admits to, and are
4.0-4.4:1 — leave them.

**P3 — `.pop` is the one animation not gated by `prefers-reduced-motion`.** `app.css:9082` —
`.pop { animation: pop var(--dur) var(--ease) }`, where `pop` is `translateY(14px) scale(0.98)`. No
override exists in any of the 29 reduced-motion blocks. Every modal and `.splash .display`
(`app.css:9302`) runs it. All 92 animation sites were diffed against the reduced-motion blocks and every
heuristic hit chased by hand: `.tierhub__halo`, the congestion crest, `.lose-fx *`, the belt, the tower
windows and `.currency--earn` are all correctly neutralised. **This is the only gap**, and it is
transform+opacity over 220ms.

**P3 — one unlabelled SVG class.** `components.ts:144` — `<svg class="next__grid">` has neither
`aria-hidden` nor `role`, on 56 fixtures. Every other SVG is disciplined. This is the next-piece preview,
so it arguably deserves a real label rather than hiding.

**P3 — one div with a click handler.** `screens.ts:5595` — `<div class="bayclear" id="bayclear"
data-action="skip-bayclear">`, no `tabindex`, no `role`. Mitigated: `main.ts:8523` gives the pad a direct
route and the card self-advances after 1700ms. Noted only because it is the single exception to an
otherwise perfect "everything is a real `<button>`" record.

**P3 — no `<h1>` on 78 of 164 screens.** They start at `<h2>`; the splash has the only `<h1>`.
**No skips anywhere** (no h2→h4).

**P3 — grouped thousands are a hard-coded comma.** `components.ts:600` (`num()`) emits `98,760`
regardless of locale, for stated reproducibility reasons. Under a non-English TTS voice that reads as
"98 comma 760". Given the HUD is hard-coded English throughout, this is consistent rather than wrong.
**No `aria-live` region is written per frame** — verified: `#settle-note`, `#coach` and `.projection` are
`aria-live="polite"` but only change on events; the per-frame `syncHud` writes go to `.pl-*` readouts in
no live region, and the wind notch's per-frame writes sit inside `aria-hidden`. **That part is right.**

---

## Checked and found clean

- **The pad focus graph has no holes.** BFS over the real `pickNext` from each screen's own
  `focusInitial` landing: **0 unreachable targets and 0 sinks**, across all 164 fixtures on six device
  geometries. **The release doc's flagged risk ("pad focus landing on the wrong card",
  `1.0.6.md:212`) does not reproduce as a reachability problem.** `data-pad-initial` works; the hub lands
  on Play, and on `hub-unlock-ready` it lands on Unlock, which is right.
- **Modality parity is otherwise exact.** Every actionable element across all 164 fixtures is a real
  `<button>`, visible, ≥0 tabindex, and in `focusTargets`, at both pointer types — only the beacon and
  the bay-clear div excepted.
- **Focus ring discipline.** Exactly **one** `outline: none` in 13,668 lines of CSS (`app.css:8713`, the
  name input, which replaces it with a border + shadow at `:8715`). The D4 token block
  (`app.css:234-247`) puts one ring on everything via `:focus-visible` and correctly promotes it to plain
  `:focus` under `data-profile="gamepad"`.
- **Tap targets elsewhere hold.** Outside the tower floors, no focusable control measured under 40px.
- **Colour is never the sole carrier** where it would matter most, and deliberately so: `icons.ts` uses
  `lock`/`stow` badges rather than hues because "red/green is not a distinction this game may draw
  (DESIGN.md)"; the goal bar's heat sits behind a printed number; the chain ladder encodes streak as rung
  count; the Xbox face chips carry the letter as well as the colour.
- **Fullscreen does not lose focus.** `syncFullscreenControls` (`main.ts:4803-4813`) patches attributes
  in place with no re-render; #227's auto-fullscreen is coarse-pointer-only.
- **Reduced motion** honoured in 29 CSS blocks and 9 canvas call sites (`render.ts:2950-2955` caches the
  MediaQueryList; `attract.ts:344` declines the whole demo), with `.pop` the single exception.

---

## Triage

**Ship-blocking in this lane: none strictly** — but **P1-3 is a ~20-character fix and worth taking**, and
**P1-2's first half is one `sealBehindScrim` per arm** and low-risk; the `refit-intro` case in particular
lets a keyboard player spend banked scrap behind a card they have not dismissed.

**Post-RC:** P1-1 (text scaling) needs a real decision and probably an in-app setting. P2-1 (tower floor
height) needs a design call. P2-2 (canvas name + threshold announcements) is small and well-bounded. The
`PAD_CONTROLS_DOORS` `tiers` entry and the Tier S keyboard route are both ten-line fixes.
