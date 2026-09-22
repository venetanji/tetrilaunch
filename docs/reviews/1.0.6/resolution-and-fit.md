# Lane 1 — Does it fit, at every resolution

Reviewed tree: `bde8746` (`origin/staging` @ #232 + `origin/release/1.0.6`).

**What was run (CONFIRMED vs read):**
- **`npx tsx sim/uifit/run.ts` — full 19-device matrix, GREEN:** `total 235 (baselined 235, new 0)`.
- **`--engine=webkit` — COULD NOT RUN.** `Executable doesn't exist at /opt/pw-browsers/webkit-2215/`.
  Not installed, and not installed by the reviewer. **WebKit findings below are read-only.**
- The real assertion set run at **12 resolutions outside the matrix**, by temporarily appending device
  rows (since reverted).
- The layout solver probed directly at **26 extreme viewports**.
- The hub rail measured across the whole matrix, then **#230's proposed 360px threshold applied and
  re-measured**.

---

## P1

### 1. The destructive account-deletion dialog scrolls its own buttons off the fold
`app/src/ui/screens.ts:3353` (`accountDeleteModal`); panel rule in `app/src/styles/app.css`.

The modal is eyebrow → h2 → two long paragraphs → `.row` with **Keep Account** / **Delete Account** as
the *last* children. `.panel` is not on `ALLOWED_SCROLLERS`, so when it overflows it scrolls silently
with no affordance — and the content that goes under the fold is **the escape from an irreversible
action**.

CONFIRMED by running the `account-delete` fixture across a width/height sweep:

| viewport | `.panel` | verdict |
|---|---|---|
| **800x600** | — | **clean** (this is the matrix row) |
| 840x600 | 559 → 570 | 11px over |
| 960x600 | 554 → 585 | 31px over |
| 1280x600 | 540 → 588 | 48px over |
| 960x540 | 494 → 585 | 91px over |
| 1280x540 | 480 → 588 | **108px over** |

At 108px the entire button row is below the fold. **The matrix's only web row at or under 600px tall is
`Web · 800x600` — the one width where this does not reproduce.** Everything from ~820px wide upward at
that height is broken. This is exactly the failure mode `devices.ts` documents for its `1269x663` row
("the matrix measured the two steps either side of the bug and never the bug"); the same gap has
reopened one axis over.

### 2. The desktop shell's own minimum window size is a size the UI does not fit
`app/desktop/main.js:119-123` — **VERIFIED in place:**
```js
useContentSize: true,
width: 1280, height: 720,
minWidth: 960, minHeight: 540,
```
The comment immediately above asserts *"960x540 is now the smallest PAGE, which is the number the
layout solver was given to hold."* **The shortest web row in `devices.ts` is 600px tall, so the whole
540-600 band ships unmeasured** — the claim is made in a comment and tested nowhere. The default content
box is 1280x720 and the user can drag straight to 960x540 in one gesture.

CONFIRMED — adding `960x540` as a device row produces **36 violations, none baselined**:
- `account-delete` `.panel` overflows **91px**; `settings-dev` **59px**; `seal-break` **50px** (all three
  also trip `scrollers`)
- `.draft__body` scrolls **101-122px** across six draft fixtures + two inspection fixtures (baselined at
  75px for 800x600 — it grows, and `.draft__body` is deliberately *not* allowlisted)
- `#refit-preview` scrolls **91px** (`refit-staged`), 52px (`refit-capstone`) — `run.ts`'s own comment
  says needing that valve *is* the defect
- `padfocus`: focusing `.mod-card` leaves 37px of a 204px selection outside the pane
- `clipped`: `"×1.25"` cut 7px by `.lart__strip` on `lesson-card-last`

Exact breakpoints from a 10px height sweep at 960 wide: `settings-dev` and `seal-break` start
overflowing below **~590px**; `account-delete` is already 31px over at 600.

**Fix:** either a device row at the shell minimum, or raise `minHeight` to 600+. The shell minimum and
the matrix floor disagreeing is the root cause.

### 3. #230's replacement breakpoint misses the Pixel 7 pair by 0.25px
`app/src/styles/app.css:1389` — `@container rail (min-height: 470px)`, the only `@container` query in
the stylesheet. Container declared at `app.css:931`.

**The Contract-card hole itself is known and owned by #230 — not a new finding. What is new is that the
replacement number is wrong.** `.tierhub__actions` height measured on the `hub` fixture across the
whole matrix:

| device | rail height | hole today |
|---|---|---|
| iPhone 13 mini | 309.84 | 7px |
| OnePlus 12 | 313.16 | 11px |
| Galaxy S8+ | 315.47 | 13px |
| 640x360 budget | 319.84 | 17px |
| iPhone X | 324.14 | 22px |
| iPhone SE 3 | 333.66 | 31px |
| iPhone 15 | 341.27 | 39px |
| Pixel 5 | 343.56 | 41px |
| **Pixel 7 / Pixel 7 cutout** | **359.75** | **57px** |
| iPhone 16 Pro Max | 385.94 | 74px |

`min-height: 360px` is inclusive, and the Pixel 7 rail is **359.75px**. CONFIRMED by editing the
threshold to 360 and re-running the probe: the Pixel 7 pair still reports `preview NO, hole 57px`.

**#230's fix rescues exactly one phone row (iPhone 16 Pro Max) out of nine, and leaves the largest
remaining hole in the fleet — 57px, on the most mainstream Android class in the matrix — untouched, by
a quarter of a pixel.**

Also tested 355, 340 and 305. **355 catches the Pixel 7 pair cleanly** (56px preview, card shrinks
173→160, nothing overflows, no other row changes). 340 additionally catches Pixel 5 (40px) and
iPhone 15 (37px) with no breakage. Even 305 is structurally safe. So the "the preview would not fit
lower down" concern is **empirically false**; 360 is simply mis-set. A breakpoint that ties with a
device row to within 0.25px will also flip under WebKit's different text metrics.

---

## P2

### 4. The rotate guard is a window-shape test, and it is a dead end
`app/src/lib/platform.ts:96-98` and `app/src/main.ts:5106-5108`:
```js
export function isPortrait(): boolean { return window.innerHeight > window.innerWidth; }
const mobile  = "ontouchstart" in window || w < 900;
const covered = isPortrait() && mobile;
```
`isPortrait()` asks about the **window**, not the **device**. `rotateGuardHTML` (`screens.ts:283`) is
"Rotate your device / Tetrilaunch plays in landscape" **with no dismiss**, and `covered && this.state
=== "playing"` also pauses a live run. On shipping configurations:

- **Any desktop browser window under 900px wide and taller than wide** → unrecoverable "Rotate your
  device" on hardware that does not rotate. Reachable by dragging.
- **Any touchscreen Windows/Linux laptop or all-in-one** → `"ontouchstart" in window` is true, so
  `mobile` is true at *every* width; any portrait-shaped window of any size gets the guard. Includes
  the Electron build at e.g. 960x1000.
- **iPad Safari in Split View** (507x768, 320x1024) → guard on a device already in landscape.
  The **native** iOS build is safe: `ios/App/App/Info.plist:55` sets `UIRequiresFullScreen=true`, which
  disables Split View (verified). **The web build has no such protection.**

Read-only — the harness renders fixtures directly rather than the guard gate — but the predicate is
three lines and unambiguous.

### 5. Portrait-shaped desktop windows ≥900px wide weld the field to the bottom edge
`app/src/game/layout.ts:598` — `oy: by + budget - fh`, bottom-anchored unconditionally.

Above 900px wide with no touch, finding 4's guard does *not* fire, so you get the game. CONFIRMED via
the solver: `400x1000` → `oy=822`, field occupies the bottom 178px of 1000. `300x1200` → `oy=1079`.
A portrait external monitor at 1080x1920 (common for dev/productivity) puts a small field glued to the
bottom under a vast empty band.

The "FIELD ANCHOR" argument (`layout.ts:489-520`) is sound for a *letterbox* leftover — "the whole
leftover goes overhead, where render.ts paints sky". It was not written for a leftover several times
the field's own height, and sky does not read as sky at 1079px. **Between findings 4 and 5, every
portrait-shaped desktop window is wrong one way or the other.**

### 6. The baseline's anti-rot guard is blind to 96% of its own entries
`app/sim/uifit/run.ts:1808-1817` — **VERIFIED by running the real function over the real file:**
```js
const magnitude = (lines) => Math.max(0, ...lines.map((l) => {
  const m = l.match(/(\d+(?:\.\d+)?)px/); return m ? parseFloat(m[1]) : 0; }));
const grown = remaining.filter((k) => {
  const before = magnitude(baseline[k]); const now = magnitude(found[k]);
  return before > 0 && now > before * 1.25 + 8;   // <-- before > 0
});
```
`tap` findings are formatted `${label} ${w}x${h}` (`run.ts:623`) — **no `px` substring** — so
`magnitude` returns 0 and the `before > 0` gate skips them entirely.

| assertion | invisible to `grown` | policed |
|---|---|---|
| `tap` | **225** | 0 |
| `scrollers` | 0 | 10 |
| **total** | **225 (95.7%)** | 10 |

Same in webkit: 245 of 577. **A baselined `.tower__floor 108x26` can degrade to `108x4` and the run
stays green.**

**It matters specifically now:** the 1.0.6 re-key (`a47416d`) moved 245 tap rows wholesale from `menu|`
keys to `hub|` keys. Under `--update-baseline` a renamed key is a pure addition with no magnitude
comparison against anything, and the one assertion category the re-key touched is the one category
`grown` cannot police. **No evidence of an actual laundered violation was found** — the full run is
green and the chromium baseline is a strict subset of the webkit one — but the mechanism that is
supposed to make that checkable is not running on these rows.

---

## P3

### 7. The tower's 21-43px rungs — accepted, but absent from the release risk list
225 of 235 baselined entries are `.tower__floor` under the 44px tap floor: `82x22` … `108x43`, worst
**`.tower__floor 108x21` on iPhone 13 mini** — under half of WCAG 2.5.5, on eleven controls on the home
screen. This is deliberate and extensively argued (`app.css:2899-2916`: "the accepted cost of a building
read at a glance"). **Judged accepted, not a crack.**

Two notes anyway: (a) `docs/releases/1.0.6.md`'s Risk list covers save format, scores, routing and
native build inputs — it says nothing about tap-target size, and **1.0.6 is the release that removed the
scroller that used to keep these at 44px**; (b) the `::after` hit-zone expansion (`app.css:2449`) buys
82x26 → 88x28, which `getBoundingClientRect` cannot see, so every recorded number understates the real
target by 2px. The stylesheet says so; the baseline does not.

### 8. The iOS-proxy gate fails open locally, and its CI comment is stale
`run.ts:1610-1618` exits 0 when the engine binary is missing. CI does install WebKit
(`.github/workflows/ui-fit.yml:162`), so the gate is genuine there — but
`npm run test:uifit -- --engine=webkit` on any machine without it prints a warning and **passes**, so a
developer running the house validation ritual before a push gets a green they did not earn. *That is
what happened to this reviewer.*

Read-only observations on `baseline.webkit.json` (577 entries vs chromium's 235; chromium is a strict
subset, 342 webkit-only): **322 of the 342 are `inkline` at 0.55-1.02px** against the assertion's own
0.5px tolerance — that reads as rasteriser noise against a tolerance set too tight for a second engine,
not 322 defects. The remaining ~20 are `tap`/`scrollers` rows on tablet and desktop that Chromium does
not reproduce. Also `ui-fit.yml:113-120` still describes the webkit baseline as holding "208 entries"
and "190 Chromium keys" — it holds **577 and 235**.

### 9. Ultrawide, 4K and high-DPR are CLEAN
`3440x1440` (21:9), `3840x1080` (32:9), `3840x2160` at dpr 1 **and** dpr 2, `2560x1440`, and `1104x884`
(Fold inner) all run the full assertion set with **zero violations**. A real negative result; no finding
was manufactured.

The one uncovered thing: the `rail` assertion only asks whether the rail overlaps the field.
`app.css:3491-3494` centres it in the gutter. At 3840x1080 the solver returns `mode=wide` with a 960px
gutter, so the controls sit **450px from the field and 450px from the screen edge**; at 5120x1440,
610px. Minority config, and the buttons are keycap/pad-mirrored anyway — but it is invisible to CI by
construction.

### 10. Solver clamps saturate safely
CONFIRMED by direct solver probe. `computeLayout` floors `uw`/`uh` at 1 (`layout.ts:615-616`) and
`fitField` floors scale at 0.0001 (`layout.ts:581`). In `tall` mode the 68px band is subtracted
unconditionally (`layout.ts:722-734`), so at `uh < 68` the budget goes negative and `oy = by + budget -
fh` places the field *above* the viewport top: `1x1` → field 0.13x0.07 at `oy=-67`; `0x0` →
`--gutter-r` computes to -1. **No crash** — `skyTop` guards with `if (!(oy > 0)) return 0`
(`layout.ts:353`) and `main.ts` clamps every published `--gutter-*` with `Math.max(0, …)`. Not reachable
through the Electron shell (min 960x540) or any real browser. **Nit, no action.**

### 11. Safe-area handling: CLEAN
CONFIRMED. All four edges are defined exactly once in `app/src/styles/tokens.css:218-221`; the only
other raw `env()` in `app.css` is the four-sided `.safe-probe` at 3305-3308. **No one-sided usage
anywhere.** The `safearea` assertion is green on every notched row in both the full matrix run and the
12-row extreme run.

One harness fidelity note: `run.ts` renders the `guard` fixture with the axes swapped to portrait but
applies the device's **landscape** insets, so the iPhone rows check the guard against a 44px left/right
inset that in portrait would be a top inset — a configuration no device produces. The guard is a centred
card so it almost certainly clears; the row just is not testing what it looks like it tests.

---

## Summary

Three things would embarrass the team at release: **a destructive-action dialog whose "Keep Account"
button scrolls out of sight on ordinary desktop windows (1)**, **the desktop shell shipping a minimum
window size the UI does not fit in (2)**, and **the in-flight hub fix missing its most important target
device by a quarter of a pixel (3)**. 1 and 2 are the same blind spot seen twice: **the matrix's web rows
bottom out at 600px tall and 800px wide, and the product ships to windows smaller and wider than that.**

Findings **1, 2, 3, 6, 9, 10, 11 are CONFIRMED by running code.** Findings **4, 5, 7, 8** are from
reading the source (5's numbers from a solver probe). Only the Contract-card hole is already covered by
#230 — the threshold audit of its replacement is new.

### Device rows worth adding permanently
The twelve probe rows used here were reverted, but several found real defects and are worth adopting:
`960x540` (the Electron shell minimum — found 36 violations), `1280x540` and `1280x600` (found the
account-delete overflow), plus the ultrawide/4K rows as regression insurance now that they are green.
