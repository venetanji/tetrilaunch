# Responsive UI System — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with a green harness run and a commit.

**Goal:** Every screen fits its viewport on every phone and tablet the app ships to, in landscape, with **no vertical page scrolling anywhere**. The only scrolling permitted is *inside* a designated region on the Leaderboard (score rows) and the Workshop (the shop pane, laid out in two columns). The in-game HUD stops growing over the play field. All of it is asserted by a headless harness that runs in CI against an Android + iOS device matrix.

**Non-goals:** Portrait support (the app locks landscape and has a rotate guard), visual restyling, and any change to game systems, economy or physics.

---

## 1. Evidence

Measured on 2026-08-15 with a throwaway Playwright probe that renders each screen's real HTML string (`src/ui/screens.ts`) against the real stylesheet (`src/styles/app.css`) and the real layout solver (`src/game/layout.ts`), at real device CSS viewports, device pixel ratios and landscape safe-area insets. This is the same mechanism the permanent harness in Task 6 formalises.

### 1a. Page overflow, in CSS px, by viewport

Rows are viewport height, columns are viewport width. `·` = fits.

```
=== menu ===
        640   667   700   720   740   780   800   852   915  1024
  320  +286  +292  +293  +294   +20    +4    +5    +7   +10   +15
  360  +250  +252  +253  +254     ·     ·     ·     ·     ·     ·
  393  +217  +219  +220  +221     ·     ·     ·     ·     ·     ·
  430  +180  +182  +183  +184     ·     ·     ·     ·     ·     ·

=== howto ===
        640   667   700   720   740   780   800   852   915  1024
  320 +1269 +1216 +1217 +1218  +757  +741  +706  +672  +657  +625
  360 +1229 +1176 +1177 +1178  +717  +701  +666  +632  +617  +585
  393 +1196 +1143 +1144 +1145  +684  +668  +633  +599  +584  +552
  430 +1159 +1106 +1107 +1108  +647  +631  +596  +562  +547  +515

=== settings ===          === workshop ===
  320  +12 … +29 (all w)     every width × height:  ·
  340+   · (except ≥915)
```

Three distinct failures fall out of that:

- **Menu has a cliff at width ≤ 720.** `@media (max-width: 720px)` (app.css:1436) collapses `.menu` to a single column. On a *desktop* window that is correct; on a landscape phone that is 667×375 (iPhone SE 3) or 640×360 it stacks the brand column on top of the actions column and overflows by 150–294px at **every** height. The rule keys off the wrong axis.
- **How to Play never fits, on any device.** 485–1269px of overflow everywhere. It is a vertically stacked document in a viewport that is 360px tall.
- **Workshop already fits everywhere.** It is the one screen using `.screen--fit` (app.css:1742) — `overflow: hidden` on the screen, one internal flex region that scrolls. **That pattern is the answer; it is simply not applied anywhere else.**

### 1b. The in-game HUD grows over the field

`.plant` is authored as 47.08% × 42.96% of the field rect and is `bottom`-anchored with `height: auto` + `min-height`, so when its content does not fit it grows *upward* over the play area — which is the panel/trajectory overlap in the reported screenshot.

| Device | CSS viewport | Field height | Plant design box | Plant actual | Actual as % of field |
|---|---|---|---|---|---|
| iPhone 13 mini | 780×360 (insets L/R 50, B 21) | 270px | 116px | **183px** | **68%** (design: 43%) |
| iPhone SE 3 | 667×375 | 328px | 141px | 162px | 50% |
| Galaxy S8+ | 740×360 | 360px | 155px | 168px | 47% |
| Pixel 5 | 851×393 | 393px | 169px | 174px | 44% |
| Pixel Tablet | 1600×1000 | 852px | 366px | 366px | 43% ✓ |

The cause is a mixed unit system. In-panel type and spacing are written as `max(Npx, calc(M * var(--fpx)))` — proportional to the field, but with an absolute pixel floor for legibility. Each floor is individually defensible; **nothing checks their sum against the box they have to fit in.** Below roughly `--fpx` = 0.55 every floor engages at once and the panel needs more height than it is given. The iPhone 13 mini is worst because its 50px landscape safe-area insets shrink the field while the floors stay fixed.

### 1c. Tap targets below the 44px floor

The codebase states the WCAG 2.5.5 / iOS HIG floor in two places (`layout.ts`'s `RAIL_MIN`, tokens.css's `--tap-min`) and enforces it only for the side rail. Measured violations at 792×360: menu 4 elements (`.chip`, `.btn`), settings 6 (`.toggle`, `.btn`), workshop 11 (`.workshop__tab`, `.btn`), HUD 2 (`.mod`). The `@media (max-height: 460px)` block shrinks `.btn` to `padding: 7px 14px; font-size: 10px` — about 30px tall — precisely to buy back the height that the stacked layout was wasting.

### 1d. The structural problem

`app.css` carries **15 `@media (max-height: …)` blocks** at 400/460/480/520/620px, each added to rescue one screen on one device by shaving padding and type. They are unowned, they interact, and they go stale as content changes: the menu's block was tuned before the tier chip gained a second line and before the Unlimited upsell chip moved into the brand column. This is breakpoint whack-a-mole, and adding a sixteenth block is not a fix.

---

## 2. Architecture

Four changes. The first two are the system; the last two are the screens that need reflowing on top of it.

### A. One solved scale, instead of a breakpoint stack

`game/layout.ts` already solves the hard version of this problem for the field and the rail. Extend it to solve the chrome too, and let CSS consume the answer.

Add to `computeLayout`'s result:

```ts
/** Chrome scale: 1 on a comfortable viewport, floored so type stays legible. */
uiScale: number;      // ~0.72 … 1.0, continuous
/** Coarse tier for rules that must switch rather than scale. */
density: "compact" | "regular" | "roomy";
```

`uiScale` is derived from the usable box after safe areas (`min(uh / REF_H, 1)` clamped to a floor, with a width term for the very narrow cases), and `density` is a threshold on it. `main.ts`'s `onResize` publishes `--ui-scale` and sets `document.documentElement.dataset.density`.

Then, in `tokens.css`, the type and spacing scales become functions of it:

```css
--sp-3: calc(12px * var(--ui-scale));
--fs-body: max(11px, calc(16px * var(--ui-scale)));
```

and the 15 `max-height` blocks collapse into at most three `[data-density="compact"]` rules for things that genuinely need to *switch* (a two-column grid becoming three, a subtitle disappearing) rather than shrink. `@media (pointer: …)` and `@media (prefers-reduced-motion: …)` stay — they are orthogonal to size and are correct as media queries.

**Why JS rather than `clamp()` on `vh`:** the constraint is the box *after* safe-area insets, and `env(safe-area-inset-*)` is not usable in a media query. The solver already reads the real insets (`lib/platform`'s `applySafeAreaInsets`, whose comment records that iOS WKWebView only resolves `env()` from a stylesheet rule). One code path for the viewport, the one that already works.

### B. Fit-first screen scaffolding

Invert the default. `.screen` becomes `overflow: hidden` with a `min-height: 0` flex chain, i.e. what `.screen--fit` does today, and the ability to scroll becomes opt-in on a single designated child:

```css
.screen        { overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.screen > *    { min-height: 0; }
[data-scroll]  { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
```

Exactly **two** elements in the app get `data-scroll`: `#lb-body` (leaderboard rows) and `.workshop__shop` (shop pane). The harness in Task 6 asserts that set — a third one cannot be added without the test failing, which is what makes "no vertical scrolling" a property of the codebase rather than a note in a doc.

### C. Reflow the two screens that do not fit

- **Menu:** delete the width-keyed single-column collapse. `.split` already collapses correctly on `@media (max-aspect-ratio: 1/1)` (portrait / narrow desktop window), which is the condition that actually means "there is no width for two columns". A 667×375 landscape phone has width to spare and no height to spare — it must stay two columns. Drop `@media (max-width: 720px)`'s `.menu` rules; keep the `.howto__grid` part until Task 5 replaces it.
- **How to Play:** becomes a two-column fit layout at every landscape size (`.howto__grid` at `repeat(2, 1fr)`, steps as compact rows), with the step body trimmed under `[data-density="compact"]`. Target: 0px overflow at 640×320, the smallest viewport in the matrix.

### D. Give the HUD plant panel a budget it cannot exceed

The panel must never exceed its design box. Two coordinated changes:

1. **Solve the floors instead of hard-coding them.** Move the per-element minimum sizes out of 30-odd `max(Npx, calc(M * var(--fpx)))` expressions and into one solved value: `--plant-px`, the effective world-pixel unit for panel content, computed in `layout.ts` as the largest unit at which the panel's *content budget* still fits `0.4296 * fh`. Content sizes become plain `calc(N * var(--plant-px))`.
2. **A compact arrangement, not an overflowing one.** When the solved unit would drop below the legibility floor (measured: `--fpx` ≈ 0.55, i.e. field width under ~700 CSS px), the panel switches under `[data-density="compact"]` to a two-row arrangement — funds/target and the two stat columns on one row, reload + meta + mods on the second — and the mods row moves to icon-only chips at `--tap-min`. Panel height stays inside the box; the trajectory apex stays visible.

`min-height` on `.plant` stays, but `max-height: calc(0.4296 * var(--field-h))` joins it, so a future regression clips visibly in the harness instead of silently eating the field.

### E. One tap-target floor, enforced

`--tap-min: 44px` already exists. Apply it as a floor on every interactive class (`.btn`, `.icon-btn`, `.chip--cta`, `.toggle`, `.workshop__tab`, `.mod`, `.contract-card`) via `min-height: var(--tap-min)`, and delete the `[data-density]` overrides that currently shrink buttons below it. The height this costs is exactly the height that (A)–(D) free up; the harness asserts both at once, so neither can be traded away for the other silently.

---

## 3. Test strategy

Three tiers, cheapest first. Only the first two run on every PR.

### Tier 1 — pure math, no browser (`sim/systems.ts`)

The existing hand-rolled `check(desc, cond, detail)` harness (390+ checks, `npx tsx sim/systems.ts`) already covers `computeLayout` and, in "HUD readout widths (the $1000+ wrap regression)", already models the plant's font-size arithmetic in TypeScript. Extend it for the new solver: `uiScale` monotonic in viewport height and clamped to its floor; `density` thresholds; and the plant content budget fitting `0.4296 * fh` at every viewport in the matrix. Runs in ~2s with no browser.

### Tier 2 — real DOM fit harness (`sim/uifit/`), Chromium, in CI

```
sim/uifit/
  harness.html      # loads app.css + harness.ts, nothing else
  harness.ts        # window.__uifit.render(screenName, insets) -> renders the
                    # real screens.ts HTML into the real stylesheet, and
                    # publishes --field-* from the real computeLayout
  fixtures.ts       # one deterministic fixture per screen (meta, run, hud opts…)
  devices.ts        # the device matrix (below)
  run.mjs           # Playwright driver: matrix x screens -> assertions + PNGs
  vite.config.ts    # root: sim/uifit, alias to ../../src — never in the app build
```

Rendering the pure HTML strings rather than driving the live app is deliberate: no game state, no network, no RevenueCat, no animation timing, and every screen reachable in one call. The production stylesheet and the production layout solver are both exercised.

**Assertions, per device × screen:**

| # | Assertion | Catches |
|---|---|---|
| 1 | `scrollHeight <= clientHeight + 1` on `.screen` and `.modal` | the menu/howto overflow |
| 2 | Elements with `[data-scroll]` are exactly `#lb-body`, `.workshop__shop` | scroll creeping back in |
| 3 | No element's rect falls outside the viewport unless it has a scrollable ancestor | content clipped off-screen |
| 4 | Every `button`/`.btn`/`.toggle`/`.mod`/`.chip--cta` is ≥ 44×44 | 1c |
| 5 | No single-line text node has `scrollWidth > clientWidth + 1` | the truncated "Bay 1/…" in the report |
| 6 | `.plant` height ≤ its design box, and its rect does not cross the cannon/trajectory band | 1b |
| 7 | `.side-rail` does not intersect the field rect (the invariant `sim/systems.ts` already asserts in math, re-checked in the DOM) | rail over play area |
| 8 | Workshop shop pane is 2 columns at every matrix width ≥ 640 | the explicit request |

**Device matrix** (landscape CSS px, dpr, safe-area insets):

| Platform | Device | CSS viewport | dpr | Insets (L/R/T/B) |
|---|---|---|---|---|
| Android | Galaxy S8+ / 360dp | 740×360 | 4 | 0 |
| Android | OnePlus 12 (measured in repo) | 792×360 | 3 | 0 |
| Android | Pixel 5 | 851×393 | 2.75 | 0 |
| Android | Pixel 7 | 915×412 | 2.625 | 0 |
| Android | small budget device | 640×360 | 2 | 0 |
| Android | Pixel Tablet | 1600×1000 | 2 | 0 |
| iOS | iPhone SE 3 | 667×375 | 2 | 0 |
| iOS | iPhone 13 mini | 780×360 | 3 | 50/50/0/21 |
| iOS | iPhone 15 | 852×393 | 3 | 59/59/0/21 |
| iOS | iPhone 16 Pro Max | 956×440 | 3 | 62/62/0/21 |
| iOS | iPad mini | 1024×768 | 2 | 0/0/0/20 |
| iOS | iPad Pro 12.9 | 1366×1024 | 2 | 0/0/0/20 |

Safe-area insets are injected by overriding the four `env(safe-area-inset-*)` values in a test-only stylesheet rule that the `.safe-probe` element reads — the same path the app uses on device, so the harness exercises the real inset plumbing rather than stubbing `setSafeAreaInsets` directly.

**Output:** a pass/fail table on stdout in the same style as `sim/systems.ts`, plus one PNG per device × screen under `sim/results/uifit/` (gitignored, like the rest of `sim/results/`) for eyeball review of anything the assertions cannot express.

### Tier 3 — real WebViews (staged, not gating)

Chromium is not WKWebView, and the differences that bite are exactly the ones in play here: `env(safe-area-inset-*)` resolution, `dvh` support, and `contentInset` behaviour. Two additions, in order of cost:

- **WebKit via Playwright** (`npx playwright install webkit`) — the same `run.mjs`, same assertions, `--engine=webkit`. Closest cheap proxy for iOS Safari/WKWebView. Runs on Linux CI. **Note:** the current container has only Chromium under `/opt/pw-browsers`, so this needs a browser download; make it opt-in via a flag and skip cleanly when the binary is absent.
- **On-device / simulator smoke:** Android via the existing `android.yml` APK job plus `adb shell wm size` to force matrix viewports against a `?uifit` route in the native bundle; iOS via `xcodebuild test` on a simulator matrix, which needs a macOS runner. Both are stage 2 — propose after Tiers 1–2 are green and stable.

### CI wiring

Add a `ui-fit` job to `.github/workflows/android.yml` (or a sibling workflow) that runs before the Gradle build, mirroring the existing "cheap gates first" ordering:

```yaml
- run: npx playwright install --with-deps chromium
- run: npm run test:uifit
```

with `"test:uifit": "node sim/uifit/run.mjs"` in `app/package.json`, and `playwright` added as a devDependency.

---

## 4. Tasks

Each task is independently shippable and ends with `npx tsc --noEmit`, `npx tsx sim/systems.ts`, `node sim/uifit/run.mjs`, and a commit. Task 6 lands the harness *before* the layout changes so every later task has a regression net and a before/after number.

> **Status (implemented on `claude/responsive-ui-mobile-575y05`).** Tasks 1-7 and
> 9 are done; the harness baseline went from **283 violations to 6**. Task 8 —
> deleting the fifteen `max-height` blocks — was NOT done: two of them were the
> actual bugs and are gone (the menu's `max-width: 720px`, the run-end modal's
> `max-height: 480px`, both replaced with aspect-ratio rules), but the remaining
> thirteen are doing real tuning work and the harness now guards them, so
> retiring them is safe to do incrementally rather than in one sweep.
>
> Corrections to this plan that the work turned up:
>
> - **§3 Tier 1 is wrong about typechecking.** `sim/` IS typechecked, via
>   `tsconfig.sim.json` (`include: ["sim"]`, wired into `npm run typecheck`).
>   The claim came from an older plan doc that predated it. No config change was
>   needed for `sim/uifit/`.
> - **§2D's `--plant-px` was not built.** Solving one unit for the panel turned
>   out to be the wrong shape: the panel's overrun was not spread across its
>   type at all, it was concentrated in ONE row (`.pl-mods`, fixed at 57px
>   because its chips are floored at the tap size). Restructuring that row plus
>   two label fixes did the whole job; a solved unit would have shrunk
>   everything to fix one thing.
> - **A `max-height` guard on `.plant` is actively harmful**, contra §2D. The
>   panel is `overflow: visible`, so a cap bounds the box while the content
>   spills anyway — the assertion would go green over a bug still on screen.
> - **Two bugs the plan did not predict**, both found by the harness: the rail
>   rendered eight buttons into a column the solver sized for seven and the CSS
>   silently shrank them to 46px (under the tap floor), and a five-figure
>   bankroll wrapped the plant's readout.
> - **The refit yard became a third allowed scroller.** Seven buy buttons at
>   44px is 308px in a 198px region; no layout fits it.

- [x] **Task 1 — Solve the chrome scale.** `uiScale` + `density` in `game/layout.ts`; publish `--ui-scale` and `data-density` from `main.ts`'s `onResize`; Tier-1 checks for both. No CSS consumes them yet — pure addition, nothing changes on screen.
- [x] **Task 2 — Fit-first scaffolding.** `.screen` inverts to fit-by-default; `[data-scroll]` on `#lb-body` and `.workshop__shop`; `.screen--fit` folded away. Expect the menu and howto to *clip* rather than scroll at this point — that is the intended intermediate state, and Task 6's harness names it.
- [x] **Task 3 — Menu reflow.** Delete the `max-width: 720px` menu collapse; verify two columns hold to 640×320. Target: the whole `menu` row of the table in §1a goes to `·`.
- [x] **Task 4 — Plant panel budget.** `--plant-px` solved in `layout.ts`; panel content converted off the `max(Npx, …)` floors; `[data-density="compact"]` two-row arrangement; `max-height` guard. Target: plant ≤ 43% of field height on every matrix device, iPhone 13 mini included.
- [x] **Task 5 — How to Play reflow.** Two-column fit layout, compact step rows. Target: 0px overflow at 640×320.
- [x] **Task 6 — The harness.** `sim/uifit/` as specified in §3 Tier 2, Playwright devDependency, `test:uifit` script, CI job. *(Land this first in practice — it is listed here because its content is defined by Tasks 1–5.)*
- [x] **Task 7 — Tap-target floor.** `--tap-min` applied across interactive classes; remove the density overrides that undercut it; assertion 4 goes green.
- [ ] **Task 8 — Retire the breakpoint stack.** *(not done — see status note above)* Delete the 15 `max-height` blocks one screen at a time, re-running the harness after each; keep only `[data-density]` switches that earn their place. This is the task that pays back the maintenance cost, and it is safe to do last because the harness now covers what those blocks were hand-tuning.
- [x] **Task 9 — Workshop two columns.** The shop pane at `repeat(2, 1fr)` on every matrix width ≥ 640, scrolling internally as it already does; assertion 8 goes green.

---

## 5. Risks and open questions

- **Chromium ≠ WKWebView.** Tier 2 will not catch an iOS-only `env()` or `dvh` regression. Mitigated by Tier 3's WebKit run; until that lands, iOS coverage is "the same CSS, verified in Blink", which is honest but not complete. Flagging rather than hiding it.
- **Fit-first can clip instead of scroll.** Inverting the default converts an overflow into a *silent* clip on any screen not yet reflowed. This is why Task 6's harness has to be in place before Task 2 ships — assertion 3 (offscreen rects) is what turns a silent clip into a red build.
- **`uiScale` shrinks type.** There is a floor below which shrinking is worse than reflowing. The floor proposed is ~0.72 with per-token `max()` guards; the exact number should be set from the Task 6 PNGs at 640×320, not from arithmetic.
- **Fixtures drift.** `sim/uifit/fixtures.ts` duplicates knowledge of screen-function signatures. Kept in TypeScript and typechecked so a signature change breaks the build rather than silently rendering the wrong screen — note that `sim/` is *not* in `tsconfig.json`'s `include` today (see the working agreements in the workshop plan), so the uifit config must add it.
- **Both open decisions resolved by measurement.** The compact plant does *not*
  hide the drafted-mods row — it drops only the two ABILITY chips, which
  duplicate the rail's buttons, and keeps the informational chips icon-only. The
  Leaderboard keeps its single scrolling list: it is the one genuinely unbounded
  list in the app, and a second column would halve the rows visible per screen
  without removing the scroll.
