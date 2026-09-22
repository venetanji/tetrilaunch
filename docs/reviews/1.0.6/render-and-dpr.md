# Lane 7 — Canvas rendering, DPR/resolution correctness, frame cost

Tree reviewed: `bde8746`. `render.ts` moved in only two commits this release: `d70986c` (wind gauge
deleted) and `d64a864` (muzzle badge disc → square). The delta is **-175/+12: almost entirely deletion.**

**Ran and green:** `npm run typecheck` (both tsconfigs), `npm test`, `npm run sim:renderperf`.
**Ran and red:** `npm run sim:hudperf` (1 pin — pre-existing, see §5).

---

## P1 — The tier hub draws a full bay behind an opaque backdrop, every frame

`main.ts:336-343` (`COVERS_CANVAS`), gate at `main.ts:7756-7790`.

`COVERS_CANVAS` is **byte-identical between `main` and HEAD**. #223 added the `"tiers"` and
`"tutorial-offer"` states and **did not add them to the set**. Both render
`<div class="screen neon-backdrop">` (`screens.ts:2326`, `:2533`), and `.neon-backdrop` bottoms out at
opaque `var(--bg)` (`tokens.css:243-249`), so nothing behind them reaches a pixel. `this.game` is never
nulled (`grep 'this.game = null'` → no hits), and `toHub()` is the quit-from-bay and end-card door — so
**the hub is normally entered with a full pile in memory.**

The set's own docstring says membership "is a fact about the MARKUP, not a preference". **There is no
sim pin enforcing it** (`grep COVERS_CANVAS app/sim/systems.ts` → no hits), so the fact went stale
silently.

**CONFIRMED by running.** A/B in the real app (vite dev server + Chromium, 1280x720 @ dpr 2,
`drawImage` counted on `CanvasRenderingContext2D.prototype`, 150 rAF frames per state):

| state | drawImage/frame | rAF p50 | rAF p95 |
|---|---|---|---|
| **`tiers`** | **37.2** | 16.7 | 50.0 |
| **`tutorial-offer`** | **37.2** | 16.7 | 50.0 |
| `account` | 37.2 | 16.7 | 33.4 |
| `workshop` | 0 | 16.7 | 16.8 |
| `contracts` / `leaderboard` / `sandbox` / `splash` / `howto` / `settings` / `controls` | 0 | 16.7 | 16.7 |
| `preview` | 53.2 | 16.7 | 50.0 | ← its own attract demo, correctly gated game canvas |

37.2 is the **empty-bay floor** (the scripted shots landed no cubes). Add one `drawCube` stamp per cube
for a real pile. `sim:renderperf` on this machine puts that frame at:
```
mixed  busy N=300   avg 34.9  p50 28.9  p95 63.8 ms   (100% of frames over 16.67)
mixed  busy N=200   avg 17.0  p50 13.8  p95 42.2 ms
loose  busy N=300   avg 22.0  p50 20.2  p95 37.1 ms
```
All of it spent on pixels an opaque `.screen` covers, **on the screen a player sits on between every
run**. `account`/`account-delete` are pre-existing leaks; **`tiers`/`tutorial-offer` are new in 1.0.6.**

**Fix:** add `"tiers"` and `"tutorial-offer"` to `COVERS_CANVAS`, and add the sim pin the docstring
implies.

---

## The release doc's `trimToInk` risk is MISDIAGNOSED — negative result, with a correction

`docs/releases/1.0.6.md:448` and `:474`, plus `sim/promo/run.ts:1272-1282` and `RUNBOOK.md:138-145`, say:

> `trimToInk` crops a fresh bake to its inked pixels and **records `baked = w / worldW` from the crop**,
> so a blur whose outermost alpha rounds differently crops one pixel differently and **every stamp of
> that sprite lands a fraction of a pixel off**.

**Both halves are wrong, and the item is unactionable as written.**

**(a) `baked` is not derived from the crop.** `render.ts:1088`: `const baked = w / worldW;` where `w` is
`src.width` — the **uncropped** bake canvas, `ceil(worldW * spritePxScale)` from `makeSpriteCanvas`
(`render.ts:1174`). `inset` is computed *after* (`:1106-1119`) and feeds only `size` and `half`.
**`baked` is a pure function of `worldW` and `spritePxScale`; the alpha scan cannot move it.**

**(b) The crop is algebraically neutral.** The face's left edge lands at
`(-w/2 + inset + SPRITE_PAD·baked - inset)/baked = SPRITE_PAD - worldW/2` — **`inset` cancels identically.**

**CONFIRMED by running** — real Chromium rasteriser, exact replica of `makeSpriteCanvas` +
`bakeCubeSprite`'s draw ops + `trimToInk`, across bake scales 1 / 1.2 / 1.5 / 1.95 / 2 / 2.625 / 2.75 / 3
and blur 0 / 16 / 22 (**24 combinations**):

```
scale blur   w   baked      inset size  half     faceLeftWorld faceWWorld  glowWorldReach
1     22    92   1.000000      0     92   46.000     -20.000000  40.000000      26.0
1     16    92   1.000000      5     82   41.000     -20.000000  40.000000      21.0
1.5   16   138   1.500000     18    102   34.000     -20.000000  40.000000      14.0
2.625 16   242   2.630435     47    148   28.132     -20.000000  40.000000       8.1
3     22   276   3.000000     49    178   29.667     -20.000000  40.000000       9.7
```

`faceLeftWorld` is **exactly -20.000000** and `faceWWorld` **exactly 40.000000 in all 24 rows.**
Sprites are **not** inconsistently sized or misaligned across DPRs, nor between a fresh bake and a
re-bake after resize. **The doc's dismissal ("harmless") is correct; the review's own P1 hypothesis is
not supported.**

**(c) The reported symptom cannot be `trimToInk` at all.** `trimToInk` has **exactly one caller** —
`bakeCubeSprite`, `render.ts:1367` — and populates only `cubeSprites`. The promo diff is explicitly
"confined to the CANNON and the plant panel's frame". The cannon base, barrel, piston parts, compactor
bar and chute maw-heat plume all go through `getSprite` and are stored **raw, never cropped**. **None of
them is a cube.**

**Leading hypothesis for the real cause (read only, NOT confirmed):** `syncSpriteScale`
(`render.ts:1160-1168`) is **hysteretic** — it keeps the cached scale while the new target is within
10%. That makes `spritePxScale` **path-dependent**: two runs reaching the same shot through slightly
different intermediate viewport sizes can arrive holding bake scales up to 10% apart. Every
`getSprite`-cached element is then baked at a different scale and stamped through a different resample —
which matches "the cannon and the plant frame move a sub-pixel, the HUD numbers are identical,
reproducible in shape but not to the byte". **Cheap to confirm: log `spritePxScale` at shutter time in
both runs.**

**Severity: P2, on the doc rather than the code.** As written it will send whoever "fixes the bake in
render.ts" to a function that is provably exact and not in the affected path, while the actual source of
shot non-determinism stays unidentified.

---

## P2 findings

### #229's "paints over the seam" replaces a light line with a dark box
`app.css:11831-11840`. The comment says the colour is "the banner's own rgba composited over the field
**(#04040a)**". `#04040a` is `--bg-deep` — the **page** backdrop. But the banner is pinned to the
**top-centre of the FIELD** (`app.css:11772-11774`), where the canvas paints `drawBackground`'s radial
gradient whose bright core (`#161636`) is centred at world (640, -80) — **directly behind it**.

**CONFIRMED by running.** Real app, real canvas, real bay with wind, screenshot of the junction:
```
rows  0-1   rgb(21,21,52)   bare canvas above the banner (the gradient core)
rows  2-3   rgb(61,61,99)   banner top border
rows  4-10  rgb(12,12,27)   BANNER interior (rgba 0.78 over the live field)
rows 32-44  rgb( 9, 9,18)   NOTCH interior (#090912, opaque)
```
The banner's bottom border *is* covered — that half worked. What remains is a tonal step of **(3,3,9)**:
the notch is **33% darker in blue** than the box it hangs from. The commit's goal was "the two boxes read
as one piece of chrome rather than a lighter tab stuck under a darker one"; **what ships is a darker tab
under a lighter banner.** The seam was widened from a 2px line into a 13px box.

Two structural consequences:
- **An opaque colour cannot match a translucent box over a live canvas.** The banner picks up the
  gradient, the grid line at world x=640, congestion rows, wall glow and passing cargo/FX; the notch
  never moves. The step is largest at the brightest part of the scene, which is where the banner lives.
- **The uifit harness renders the HUD over a flat `#04040a` with no canvas at all.** Measured on real
  `hud-wind` shots: banner `rgb(8,8,18)`, notch `rgb(9,9,18)` — indistinguishable. **That is why the
  wrong constant looked right: the number was matched to what the harness shows, not what the game
  shows.** Any future "check the notch" in uifit will keep passing.

Width is fine: `notch/banner` across 14 real shots (640x360 → 4K) = **61.5%-63.5%** everywhere, so
`min-width: 120px` never binds. DPR does not change the junction (`top:100%` resolves against the
banner's padding box at every ratio tested: 1, 2.625, 2.75, 3).

### `sizeCanvas` floors the backing store, so fractional-DPR desktops resample an otherwise exact frame
`main.ts:5017-5024` — `this.canvas.width = Math.floor(w * this.dpr)` while `#game` is
`width:100%; height:100%`, so the element's CSS box is the layout viewport, whose **device** size is
fractional at fractional DPR. **CONFIRMED by running:**

| case | dpr | backing | CSS box in device px | upscale |
|---|---|---|---|---|
| **Win 150%, 1366x768** | 1.5 | 1366 | 1366.50 | **1.00037** |
| **Win 133%, 1366x768** | 1.333 | 1366 | 1366.67 | **1.00049** |
| Win 125%, 1920x1080 | 1.25 | 1920 | 1920.00 | 1.00000 |
| desktop 1x | 1 | 1280 | 1280.00 | 1.00000 |

The two Windows-scaling rows matter: `renderScale` returns *exactly* the raw ratio there, i.e. **the
renderer's own intent is a 1:1 frame — and it does not get one.** One extra device pixel over 1366 means
every vertical edge picks up a bilinear blend, and `crispFontPx` (`render.ts:366-372`), which snaps
canvas type to whole **device** px on the assumption that the backing store *is* the display grid, is
defeated. **`attract.ts:421` already does the right thing** — it sizes from `canvas.clientWidth`, and its
comment calls that "authoritative either way". The main canvas doesn't.

### The CRT comb's duty cycle drifts ±25% with DPR
`render.ts:311-322`. The docstring says "On 1x, 2x and 3x panels the arithmetic is the identity" — true —
and stops there. It snaps the period and the line **independently**, so the ratio moves.
**CONFIRMED by running the shipped function:**

| dpr | device period | device line | duty | vs authored 1/3 |
|---|---|---|---|---|
| 1.00 | 3 | 1 | 33.3% | +0% |
| **1.25 / 1.333** | 4 | 1 | **25.0%** | **-25%** |
| **1.50 / 1.75** | 5 | 2 | **40.0%** | **+20%** |
| 2.00 | 6 | 2 | 33.3% | +0% |
| 2.25 | 7 | 2 | 28.6% | -14% |
| **2.50 / 2.625 / 2.75** | 8 | 3 | **37.5%** | **+13%** |
| 3.00 | 9 | 3 | 33.3% | +0% |

Pixel 7 (2.625) and Pixel 5 (2.75) both land at 37.5%; a Windows 125%/133% desktop lands at 25%. The
overlay is `mix-blend-mode` over the whole app, so this is **a global tonal shift of up to 20% darker /
25% lighter between devices**, in a layer whose point is being identical everywhere.

### `sim:hudperf` fails a pin on the RC (PRE-EXISTING, not a 1.0.6 regression)
`sim/hudperf/run.ts:269`, probe at `probe.ts:308-319`. **CONFIRMED by running:**
`FAIL the reload fill still moves on essentially every reloading frame — moved on 0 of 555 (0%)` →
`process.exit(1)`.

**A harness defect, not a rendering one:** the probe watches `#hud-load`, and its own comment at
`probe.ts:313-317` says that element is "ABSENT ON A DEEP RUN — point the probe at a Contract bay". The
harness boots a Deep Run, so `loadFill` is `null` forever. **The pin does not skip when the element is
absent.** `git diff --stat main..HEAD -- app/sim/hudperf/` is empty, so this is red on `main` too — but
it is red on the RC, and **half the perf harness is therefore unusable as a gate.**

---

## CORRECTED — the "443 new uifit violations" was contamination from this review itself

This lane's run reported `total 678 (baselined 235, new 443)` and hypothesised cross-fixture
contamination. **That hypothesis is wrong, and the finding is withdrawn.**

The cause was **12 "ZZ ·" probe device rows injected into `sim/uifit/devices.ts` by another reviewer in
this same audit** (ultrawide/4K/foldable/short-window probes), since reverted. The merge-seam lane
independently diagnosed the same contamination.

**Settled by re-running the full fleet on a verified-clean tree:**
```
total 235 (baselined 235, new 0)
no new violations.
```
**The tree is green.** This is recorded because it is a genuine methodological hazard of running eleven
reviewers against one working tree — and because the render lane's single-screen runs (`--screen=settings`,
`hud`, `workshop`, `menu-seals` all clean) were the correct signal all along.

One observation from that lane does survive and is worth a look: `--screen=hud-wind --shots` reported 8
new where the same fixture without `--shots` reported 0. **Screenshotting perturbs the measurement**, which
is a real harness property independent of the contamination.

---

## P3 findings

### The disc → square badge did not re-check the pad it is baked into
`render.ts:3105-3131`. `pad = 6` world px, `shadowBlur = 8`. The file's own `SPRITE_PAD` rule
(`render.ts:1007-1024`) is that blur reaches ~1.5x its value, and that "widening a blur means re-checking
the pad". **Widening the shape means the same thing, and `d64a864` did not.**

**CONFIRMED by running** (alpha left on the sprite's outermost ring — anything non-zero is clipped glow):

| bakeScale | shape | edgeMaxAlpha | edgeMeanAlpha | corner |
|---|---|---|---|---|
| 1 | arc | 20 | 6.7 | 0 |
| **1** | **rect** | **23** | **17.2** | **2** |
| 1.5 | arc | 3 | 0.7 | 0 |
| 1.5 | rect | 4 | 3.0 | 0 |
| 2 | rect | 1 | 0.7 | 0 |

The disc clipped at four tangent points (mean 6.7/255). **The square clips along the whole perimeter
plus the corners — mean 17.2/255, 2.6x** — so the halo terminates in a hard rectangular cut rather than
tapering. **Bake scale 1 is every phone in the matrix** (see below). Gone by bake 2, so desktop is fine.

Second: the docstring says the badge is "Offset up and out from the tip so it never covers the silhouette
it is describing." The disc's nearest point to the tip was 0.79 cell; **the square's inner corner is at
0.57 cell — inside the ghost's own centre cell** (which spans ±0.5). Covered area grew **27% (4/π)**, at
full opacity over a `GHOST_ALPHA` silhouette.

### Cross-DPR: the cube halo is ~2x wider on a phone than on a desktop, and on every phone cold cryo is clipped
Inherent to `shadowBlur` being CTM-exempt (documented at `render.ts:1044-1053`), but **not in the release
doc**. **CONFIRMED by running** the shipped `renderScale` + `computeLayout` over the full matrix. Every
phone has a bake **target** of 0.44-0.92 and clamps to **1.000**; every desktop/tablet lands **1.43-2.04**:

| device | renderScale | bakeTarget | bakeClamped | glowWorldReach (blur 22) |
|---|---|---|---|---|
| Android 640x360 budget | 1.5000 | 0.608 | **1.000** | **33.0** |
| Pixel 7 (2.625) | 1.5000 | 0.858 | **1.000** | **33.0** |
| Fold outer | 1.5000 | 0.442 | **1.000** | **33.0** |
| Web 1920x1080 desktop | 1.0000 | 1.434 | 1.434 | 23.0 |
| MacBook 1512x945 | 1.6732 | 1.867 | 1.867 | 17.7 |
| 4K 3840x2160 | 0.6944 | 2.038 | 2.038 | **16.2** |

- **The halo is art that changes size with the device** — 33 world px on every phone vs 16.2 on 4K, a
  **2x difference in how glowy the cargo looks.**
- **On every phone, cold cryo is clipped.** At bake 1 / blur 22 the probe measures `rawInset = 0` — the
  glow fills `SPRITE_PAD` completely and `trimToInk` returns the sprite untrimmed. `SPRITE_PAD`'s own
  comment admits "26 does not cover that worst case and never did"; **that means every handset, and only
  handsets.**
- **The trim optimisation helps least where it is needed most.** At bake 1 a blur-16 cube trims to 79% of
  area; a blur-22 cube does not trim at all. At bake 2 the same face trims to 44%.

### Three measurement blocks in `render.ts` document deleted code and a stale solver
`render.ts:113-118`, `:324-337`, `:362-364`. `d70986c` deleted the wind gauge's five `fillText` sites and
`HUD_FONT_MONO`, leaving five in the file — all `HUD_FONT_UI`. The comments were not updated:
- `:113-118` — "grep fillText in this file and **eight** sites answer — the wind gauge's WIND/CALM…".
  Five, and two of the six named examples no longer exist.
- `:324` — "**THE EIGHT** CANVAS TEXT SITES".
- `:334-335` — the worked ladder cites `11px / 12px / 13px`, which **were `WIND_STAB_PX`,
  `WIND_READOUT_PX` and `WIND_LABEL_PX` — all deleted.** The live ladder is 14 / 18 / 26 / 30.
- `:362-364` — the collapse caveat is entirely about deleted constants. **Among the four live sizes
  nothing collapses.**

And the example is stale for a second, independent reason. **CONFIRMED by running** the shipped solver:
```
iPhone X css 812x375: solver field fw=545.8px  scale=0.4264  mode=tall
renderScale=1.5  ->  world->device factor = 0.6396
docstring claims:    field 666.7px,             factor 0.781
```
**Not one number in the block survives.** The snapping machinery itself is correct — this is
documentation rot, in the file whose house style is that comments carry derivations.

### Latent: `trimToInk` assumes a square canvas
`render.ts:1120-1123` scans with `limit = min(w,h)>>1` but crops `size = w - inset*2` onto **both** axes
and derives `baked` from the width alone. Correct today because its one caller passes a square `worldW`.
**It would silently squash any non-square sprite — the exact class of bug #106 was.** `makeSpriteCanvas`
and the piston rod crop both derive factors **per axis** and say why; `trimToInk` does not, and does not
say it is relying on squareness.

---

## Checked and clean

- **`computeViewport` / `screenToWorld`** — unchanged, still one transform through `computeLayout`. No
  second fit introduced.
- **`attract.ts`, `layout.ts`, `fx.ts`, `theme.ts`** — `git diff --stat main..HEAD` is **empty** for all
  four. Attract is still correct after the menu→front-door+hub split: `syncAttract` mounts only on
  `"menu"` and `"preview"`, `tierHubScreen` renders no `.menu__demo`, and both mount states are in
  `COVERS_CANVAS`, so the sprite-cache thrash `main.ts:7757-7763` warns about **does not happen on the
  new hub.**
- **The piston rod crop (#106)** — `render.ts:2411-2422` still derives `sx` and `sy` separately. Intact.
- **`getBackgroundLayer`** — same `Math.floor(css*dpr)` sizing as the live canvas, 1:1; correct.
- **`Scene.windNow` / `windAverage`** made optional rather than deleted — correct call, sim literals keep
  compiling.
- **The chute / plant-panel seam** — `sim/systems.ts:16404-16470` still string-reads `app.css`'s `.plant`
  fractions and pins `CHUTE.x1`, `CHUTE.y0` against them. `npm test` green, so **the +1961 lines of CSS
  churn did not move the panel out from under the chute.**
- **`dprQueries`** — bracketed form plus plain-equality fallback, 0.5% tolerance against a smallest real
  step of 25%. Sound at 2.625 and 2.75.
- **`renderScale`'s 4 MP budget** — binds on every desktop/tablet ≥1 MP css and never moves a phone.
  Matches the docstring.

## Harness notes

- **`sim/results/` is gitignored, so neither perf harness has a committed baseline.** `renderperf` and
  `hudperf` can only compare a before against an after on one machine in one session; **no run on this RC
  can be checked against what the harness "expects".** By design for `renderperf`, but it means the hub
  cost above has no recorded before/after in the tree.
- The container is noisy: `renderperf` worst-frame numbers reach 150-415 ms on rows whose p50 is 3-9 ms.
  **p50/p95 are usable for ranking; the worst column is not.**
