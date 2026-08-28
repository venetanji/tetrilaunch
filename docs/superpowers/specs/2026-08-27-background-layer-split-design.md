# The background is cached and still costs a full canvas of fill every frame

> **RESULT — 2026-08-27: THE PREMISE IS NOT SUPPORTED. DO NOT BUILD THE SPLIT
> ON CURRENT EVIDENCE.**
>
> The validation step this document demanded was run on hardware. The
> background blit's own share of the frame measured **zero within noise** —
> but both probes carry a confound, found in review, that keeps this a strong
> indication rather than a proof (see
> **[Two confounds in these probes](#two-confounds-in-these-probes)**). The
> decisive measurement, if anyone needs the verdict beyond doubt, is the one
> this spec's step (2) always specified: the two-stacked-canvas page itself,
> on the device. Until someone runs it and it disagrees, the split stays
> unbuilt — per this spec's own instruction, *"If (1) is small, stop."*
>
> The document is kept because the ~20fps it chased is real and still
> unclaimed; the evidence points away from the background and at the sprite
> pass. See
> **[What the measurements actually said](#what-the-measurements-actually-said)**
> for the numbers, and **[Where the frame really goes](#where-the-frame-really-goes)**
> for the target that survives either way -- which a later 120Hz probe now
> supports directly, not only by elimination (see
> **[Confound 2, confirmed](#confound-2-confirmed-at-120hz-the-same-load-does-bind)**).

`render.ts`'s `getBackgroundLayer` already does the expensive half of this
right. The letterbox backdrop, field gradient, grid, wall glow and congestion
floor are baked once into an opaque device-resolution canvas and re-baked only
when the cache key changes. What still happens on every single frame is this
line:

```ts
ctx.drawImage(getBackgroundLayer(cssW, cssH, dpr, vp, congestionRows(scene)), 0, 0);
```

A 1584x720 opaque blit, 120 times a second, into the same canvas that then
receives every moving thing on top of it. The bake is cached. The *fill* is not.

That was the argument. It did not survive contact with the device.

## The measurement that motivated this

Taken on the OnePlus CPH2573 over CDP into the shipping WebView, after
`MainActivity.requestHighestRefreshRate()` made a sustained 120Hz vsync
possible (before that fix the device parked the app at 60Hz and none of these
numbers were observable).

Halving the canvas in each dimension — a quarter of the fill area, everything
else identical:

| canvas backing | fps | median rAF gap |
| --- | --- | --- |
| 1584x720 (full) | 88.4 | 8.3ms |
| 792x360 (quarter area) | **108.4** | 8.3ms |
| 1584x720 (restored) | 90.1 | 8.3ms |

**~20fps sits in fill — but this measurement cannot say WHOSE fill.** Halving
both backing dimensions quarters the pixels rasterized for *every* draw in
`render()` — cubes, seams, effects and chrome alike, not just the background
blit this spec proposes to split out. So 20fps is the raster bill for the
whole frame at full resolution, and the background's share of it is unknown
from this table alone. Found in review.

The measurement that does isolate it is the validation step below run first:
same backing resolution, background blit alone removed (draw the frame over
garbage instead of the cached layer — wrong pixels, right cost). Whatever
that buys is the prize; if it is small, the split is not worth building and
this document ends at the validation step.

## What the measurements actually said

That validation was run. Two independent methods, both on the CPH2573, both
through the shipping WebView.

### 1. Remove the real blit, at 120Hz

`CanvasRenderingContext2D.prototype.drawImage` was wrapped to identify the
background blit exactly — three-argument form, destination `0,0`, source a
canvas whose dimensions equal the destination canvas — and to skip it on
demand. Conditions were **interleaved every 400ms** rather than run as blocks,
so drift in a live scene lands on both equally. ~1,300 frames per condition:

| condition | mean frame | median | on-time |
| --- | --- | --- | --- |
| blit drawn | 12.978ms | 8.3ms | 55.8% |
| blit skipped | 13.273ms | 8.4ms | 54.0% |

**Saving from removing the background blit: −0.295ms per frame.** Removing the
work made frames marginally *slower*, which is what zero effect looks like
through noise.

### 2. Fill headroom, on a frozen scene

With the game paused (`paused` is not in `COVERS_CANVAS`, so the canvas keeps
drawing an unchanging scene) extra full-canvas blits were injected per frame
and the frame time watched for the first sign of strain:

| extra fill per frame | mean frame |
| --- | --- |
| 0 MP | 16.69ms |
| 4.6 MP | 16.69ms |
| 9.1 MP | 16.69ms |
| **18.2 MP** | **16.69ms** |
| 36.5 MP | 17.27ms ← first slip |

**Eighteen megapixels per frame of extra fill cost nothing.** The real
background blit is **1.14 MP** — under 7% of an amount that demonstrably does
not register. Halving that headroom for the 8.33ms budget at 120Hz leaves the
conclusion intact with room to spare.

### Two confounds in these probes

Found in review, and both keep this section an indication rather than a proof:

**Probe 1's skip arm changes more than the blit.** With the blit skipped,
`render()` performs no full-canvas overwrite at all, so the surface must
*preserve* the previous frame's contents where the control arm begins with an
opaque overwrite that lets the raster discard them. Destination preservation,
surface load and overdraw all differ between the arms along with the blit —
which can add cost to the skip arm and mask a real saving. A cleaner arm
replaces the blit with an equivalent full-canvas reset (`clearRect` or a flat
`fillRect`) so both arms overwrite the destination and only the *source* of
the overwrite differs. Cleanest of all is measuring the proposed two-canvas
arrangement directly — which is exactly this spec's step (2), and is the
probe that settles the question if anyone still needs it settled.

**Probe 2 measures a 60Hz deadline, not GPU cost.** The flat 16.69ms rows say
those workloads finish before the next 60Hz vsync — rAF cadence cannot see
how much of the budget the extra fill consumed inside that deadline. A live
120Hz scene already missing ~44% of its 8.33ms deadlines does not necessarily
hold half the paused scene's headroom, so "halve the threshold for 120Hz" is
not a valid extrapolation. The honest version runs the injection under the
representative 120Hz workload, or reads GPU completion timing rather than
frame cadence.

Neither confound resurrects the split on its own — probe 1's bias, if any,
runs in the *masking* direction and the interleaved medians still sit within
0.1ms — but they are why the header says "not supported" rather than
"refuted", and why the two-canvas page is named as the decisive measurement.

### Confound 2, confirmed: at 120Hz the same load DOES bind

The review above predicted that a 60Hz cadence probe "says nothing about how
much of an 8.33ms budget the same fill would consume". That prediction was
then tested directly, by running the injection under the live 120Hz workload
instead of the paused 60Hz one. It is correct, and the gap is not subtle.

Sprite draws were multiplied in place (each real sprite redrawn N times at
jittered offsets and rotations, so none can be culled), on a live bay of ~30
sprites:

| sprites/frame | 60Hz paused scene | 120Hz live scene |
| --- | --- | --- |
| 30 (real) | 16.66ms, 0 dropped | 101.3fps, 81.8% on-time |
| ~630 (x21) | — | **77.3fps, 47.0% on-time** |
| 2430 (x81) | **16.66ms, 0 dropped** | — |

At 60Hz, **eighty-one times** the real sprite load did not cost a single
frame. At 120Hz, **twenty-one times** it cost a quarter of the frame rate and
half the on-time frames. Same code, same device, same injection — only the
deadline changed. So the earlier "the GPU shrugs off any draw load" reading
was an artifact of a 16.67ms budget, exactly as the review said, and no
number taken at 60Hz can be halved into a 120Hz claim.

**This is the positive evidence the sprite pass needed.** "Where the frame
really goes" below was an inference from the background's share being ~0;
it is now also a direct measurement — draw work has a real, large price
against an 8.33ms deadline. Taking the two usable rows at face value, ~600
extra sprite draws cost ~3.1ms of frame time, on the order of 5us per sprite
draw, which would put a 200-cube bay's cubes alone near 1ms of an 8.33ms
budget.

**Held to the same standard as everything else here, this is one
unreplicated run.** Only the first two rows of that sweep are usable: the
120Hz boost lapsed partway through and the remaining rows silently fell back
to a 60Hz cadence, which is the same failure this document warns about. It
wants repeating before anything is sized off the 5us figure.

**The baseline is the bigger question it raises.** At the *real* 30-sprite
load the device still missed ~18% of its 8.33ms deadlines, with JS at p50
0.7ms and p99 6.4ms. Whatever costs that is a fixed per-frame overhead rather
than scene content, and it is unexplained — a bay with almost nothing in it
should not be missing one frame in five. That, not the cubes, is the first
thing to chase for 120fps.

### Holding 120Hz for a measurement needs a human finger

Every probe here has to hold the device at 120Hz for its whole window, and
that is harder than it looks:

- **The OEM parks an idle app at 60Hz** whatever `preferredRefreshRate` the
  window asks for. `MainActivity.requestHighestRefreshRate()` raises the
  ceiling; it does not stop the floor falling out while nothing is touching
  the glass.
- **Injected input does not hold it.** `adb shell input tap` and `input
  swipe` were tried in loops, in a live bay, over minutes. They do not
  restore the boost and they do not reach the game's own input handling
  either. The 120Hz windows in this document coincided with a person
  physically holding the phone.
- **So every probe must carry a vsync discriminator and reject its own
  run.** The cheap one is the minimum rAF gap over the window: a sub-10ms
  gap can only happen at 120Hz, and its absence means the window is void
  whatever else it measured. Two runs recorded here were discarded that way,
  after an earlier version of the same probe had silently reported 60Hz
  numbers as though they answered a 120Hz question.
- **A bay times out in about 2:22 with nobody playing**, taking the scene
  and the refresh rate with it, so a measurement window has to fit inside
  that or restart the run first.

### Two traps this cost, so nobody repeats them

**Long A/B/A blocks are useless here.** Three 4-second blocks during live play
returned a background blit "prize" of **−11.7fps** — removing work apparently
costing 12fps. The scene had simply been busier during the baseline blocks:
`otherDraws` swung 16k → 21k between them. Only fast interleaving cancels it.

**Opaque overdraw is culled, so it measures nothing.** Injecting 129 opaque
full-canvas blits — 147 MP/frame — produced a dead-flat 16.67ms at every step.
That is not a fast GPU; each blit is a fully opaque full-canvas cover, so every
one but the last is provably invisible and Skia discards it. Small destination
offsets do not defeat it, because each still covers essentially everything.
Only forcing `globalAlpha` below 1 makes the injected fill real work. **Any
future fill-rate probe on this codebase has to blend or it is measuring
nothing.**

## Where the frame really goes

The quarter-area result stands: ~20fps *is* in raster. Since the background's
share of it is ~0, the cost is in the rest of the frame — the roughly 100+
sprite draw calls per frame for cubes, seams, effects and chrome, counted
directly as `otherDraws` in the probes above. That is where a render-perf
effort should point next, and it is a different shape of problem from this
proposal: many small draws, not one big one.

Not yet measured, and the obvious first questions: how much of that is overdraw
between stacked cubes, how much is per-draw state change (`save`/`restore`,
transforms, `globalAlpha`), and whether the baked sprite cache is being hit or
silently re-baking mid-run.

## What "the GPU is idle" did and did not mean

`dumpsys gfxinfo` reports a *50th gpu percentile* of 3ms while putting *Slow
issue draw commands* on essentially every janky frame. That number is the
**Android view hierarchy's** GPU time — HWUI compositing the WebView's surface
into the window. It is not the WebView's internal canvas raster, which happens
in a different context and does not appear in that counter at all.

So the GPU is not sitting unused waiting to be given work. It is already doing
the canvas raster. The useful lever was never "start using the GPU" — it is
"give it less to do per frame", and per the results above the background blit
is not the part worth taking away.

## Where the cost is NOT

Ruled out and measured, so nobody repeats them:

**It is not CPU-side command issuing.** Timed in-page over 120 iterations at
the live canvas size:

| operation | per call |
| --- | --- |
| full-canvas opaque `drawImage` | **0.002ms** |
| full-canvas `clearRect` | 0.001ms |
| full-canvas `fillRect` | 0.000ms |

Canvas 2D records the command and returns; the raster is deferred. So the blit
is nearly free on the thread that issues it. Any fix framed as "stop calling
drawImage so often" is aimed at the 0.002ms and will do nothing.

**It is not a per-frame readback.** `getImageData` appears exactly once in
`render.ts`, inside `trimToInk`, which is per-bake and documented as such — a
few dozen sprites over a run. There is no GPU-to-CPU stall in the frame path.

## The change that is no longer proposed

Kept for the record, since the reasoning is what the measurements answered.

Split the single `<canvas>` into two stacked, identically-sized canvases:

- **`#game-bg`** — opaque, painted only when the existing cache key changes.
- **`#game-fg`** — transparent, cleared and repainted every frame.

The trade was a per-frame opaque full-canvas fill for a per-frame `clearRect`
plus one extra compositor layer. Since the fill it removes measures as zero,
the trade is all cost and no benefit: a DOM element, a resize path, and a
second surface for `layout.ts` and `sim/uifit` to agree about.

## A note on measuring anything else on this device

Two conditions have to hold or the numbers are worthless, and both bit this
investigation:

1. **Confirm the refresh rate you are actually getting**, per window, not once
   at the start. The OEM parks an idle app at 60Hz regardless of the window's
   `preferredRefreshRate`, so a probe must either keep a finger moving or gate
   itself on a measured median gap — a 16.67ms budget hides costs an 8.33ms one
   exposes.
2. **Hold the scene still, or interleave fast enough that it cannot drift.**
   Live play varies draw counts by 30%+ between adjacent seconds, which is far
   larger than anything being measured.

## 120fps IS reachable, and the canvas was never the wall

Everything above hunts the frame inside `render()`. On the device, that hunt was
looking in the wrong place. Measured in a live bay with the panel confirmed
capable of 120Hz (minimum rAF gap 8.1ms — see the caveat below on what that does
and does not prove), conditions interleaved every 400ms so scene drift lands on
both:

...and those are **two separate runs**, so they are reported as two pairs rather
than one three-row table. Their painted baselines differ by 10.6fps (69.0 against
79.6) — larger than the drift this document records two sections down, and larger
than the gap between the two hidden arms a fused table invites you to compare.
Compare within a pair; never across one.

Run A — does the HUD's *paint* cost anything?

| HUD | median gap | fps | on-time | frames |
| --- | --- | --- | --- | --- |
| painted | 8.3ms | 79.6 | 61.2% | 647 |
| **`visibility: hidden`** — laid out, NOT painted | **8.3ms** | **112.2** | **93.7%** | 884 |

Run B — does removing its *layout* as well add anything?

| HUD | median gap | fps | on-time | frames |
| --- | --- | --- | --- | --- |
| painted | 16.5ms | 69.0 | 48.8% | 568 |
| `display: none` — no layout, no paint | 8.3ms | 115.4 | 96.1% | 898 |

Run A's hidden arm skips **paint only** and already reaches 112fps at an 8.3ms
median — +32.6fps over its own baseline. Run B additionally skips layout and wins
+46.4fps over its own, lower baseline. Neither pair shows a second jump the size
of the first when layout is removed on top of paint. So layout is cheap,
**painting the DOM HUD is the cost**, and on this device it is worth something in
the region of 33fps — a region rather than a figure, because the two runs do not
share a baseline.

**So the canvas was never the dominant term.** Two measurements say so, and they
are different kinds. Issuing the entire scene — background, every cube, chrome,
effects, trajectory, cannon — measured **0.414ms/frame** of synchronous JS in an
instrumented build; but Canvas 2D raster is deferred (this document says so
itself, further up), so that number is command *recording*, not drawing, and
cannot by itself cap the canvas's share of the frame. Found in review. The
measurement that can is the interleaved three-way arm below (*The ceiling is not
made of pixels*): hiding the canvas entirely, in the same window as the HUD arm,
moved the frame rate by **~3fps** — that cadence delta, not the 0.414ms, is the
honest size of the canvas's paint-side bill.

### What the rest of the frame costs

Instrumented build, live bay, confirmed 120Hz, per frame:

| phase | ms |
| --- | --- |
| reading `window.innerWidth` / `innerHeight` | **3.05** |
| `render()` — the whole scene | 0.414 |
| `syncHud` | 0.204 |
| `update` — physics and game logic | 0.188 |
| `updateTrajectory` | 0.006 |

The first line is a forced synchronous layout. The loop calls `syncHud()` — which
writes the HUD's DOM — and then reads the viewport in `render()`'s argument list,
so the browser must flush style and layout before it can answer. A forced flush on
this page costs **9.8ms**.

**Caching the viewport does not fix it.** That was tried: fields set in
`onResize`, read in the loop, verified live (`innerWidth` reads per frame went to
zero). Total JS stayed at ~4.7ms, because the layout and the paint happen anyway —
the read only decides *when*. Reverted. Do not re-attempt it as a performance fix
before the paint is dealt with; it is at best a tidiness change.

### Not a specific CSS effect

Interleaved, killing `box-shadow` and `text-shadow` across the HUD bought
**+2.3fps** (68.5 → 70.8). `filter`/`backdrop-filter`: nothing. `background-image`:
nothing. `contain: layout paint style` on `#overlay > *` bought +3fps.

A **block-design** version of that same test said shadows were worth +15fps. They
are not. The baseline fell 75.3 → 65.2 fps across that one run as the phone warmed,
and the block that happened to sit in the middle looked fast. This document's own
trap note says long blocks are useless here; it is worth repeating because the
trap caught the person who wrote the note.

### The next thing to try, untested

Most HUD readouts do not need 120Hz updates. Throttling `syncHud` to ~15Hz would
leave most frames with no DOM mutation and therefore nothing to repaint, which is
where the 33fps lives. A throttle experiment was built (`__hudEvery` on the loop)
but never caught a 120Hz window to measure in — the panel kept dropping to 60Hz as
the phone warmed. **It is unmeasured. It is a hypothesis with a mechanism, not a
result.**

The honest risk: the reload ring and the clock genuinely move every frame, so a
throttle may be visible. The measurement to take first is which HUD nodes actually
change per frame, and whether the ones that do can be isolated — a small
independently-composited element repainting is not the same bill as the whole
overlay.

### ...and the throttle is measured now: +21.3fps

The hypothesis above was tested. `syncHud` was gated behind a frame counter and
the two conditions interleaved every 400ms, in a live bay with the panel
120Hz-capable by the minimum-gap test (8.1ms in both arms, 764 and 943 frames):

| `syncHud` runs | fps | on-time |
| --- | --- | --- |
| every frame (today) | 74.9 | 53.4% |
| **every 8th frame (~15Hz)** | **96.2** | **77.6%** |

**+21.3fps and on-time from 53% to 78%, from throttling one call.** The
mechanism is confirmed: the HUD's per-frame repaint is the bill, and not
repainting it most frames is most of the fix.

The `visibility:hidden` ceiling from the earlier table is deliberately **not**
a row here — that number came from a different session whose painted baseline
read 79.6 where this one reads 74.9, and the thermal drift this document records
is larger than that difference. Found in review, and it is the same rule the
ceiling section below states: arms are ratios inside one window, never constants
across sessions. So no share-of-headroom is derived from combining them, and the
gap between the throttled arm and a same-window ceiling — along with how much of
it belongs to the residual 15Hz repaint — is unmeasured until both arms run in
one interleave. The shape of the finer fix stands on the mechanism alone:
repainting less each time, not just less often — isolating the handful of nodes
that actually change so a repaint is a small region rather than the whole
overlay.

**This is a measurement, not a shipped design.** A flat 8-frame gate is the crude
version, and it throttles everything including the two readouts that genuinely
move every frame — the reload ring and the clock. The shape a real fix wants is a
split: the smooth things updated per frame (ideally through transform/opacity,
which composite without repainting), everything else — funds, combo, scrap,
notches, target — on a slow tick. What the crude gate proves is that the budget
is there to be won.

### The ceiling is not made of pixels, and it is not a constant

The obvious next question is whether the 112fps ceiling can be raised. It was
tested by hiding the canvas as well, three conditions rotating every 400ms in a
live bay:

| painted | fps | on-time |
| --- | --- | --- |
| everything (normal) | 59.7 | 17.9% |
| HUD not painted | 80.2 | 50.5% |
| **HUD and canvas not painted** | **83.2** | **55.9%** |

**Hiding the entire canvas on top of the HUD buys +3fps.** So the ceiling is not
drawing. With literally nothing painted the frame still does not reach 120, and
what remains is everything that keeps running: physics, `render()` assembling its
command list, and `syncHud` writing the DOM — invisible elements still invalidate
style and layout, they only skip paint. Any further headroom is JS work and DOM
invalidation, not pixels.

**And the ceiling moves.** This run's "normal" arm measured 59.7fps where an
earlier run of the same probe measured 74.9, and the HUD-hidden ceiling came out
80.2 against the earlier 112.2 — same code, same device, same probe, a colder
phone earlier. Treat these as ratios between arms measured in one window, never
as constants to compare across sessions. Every table in this document is
internally interleaved for exactly this reason.

That gives the order of work, and it is worth stating because it is the reverse
of where the effort naturally wants to go:

1. **The HUD repaint.** Measured at +21.3fps from a crude throttle, and the
   largest single item by a wide margin.
2. **Re-measure the ceiling on a cold phone**, once that dominant term is gone.
   Chasing a residual whose absolute value swings 30% with temperature is
   guesswork while something four times its size is still in the frame.
3. **The canvas last.** It is worth ~3fps. The sprite-pass work is real and its
   counts are sound, but this is the size of the purse it is being paid out of.

### The phone's own FPS counter reads the PANEL, not the game

Worth knowing before anyone validates this work with it. With OxygenOS's FPS
overlay showing a steady **120**, an rAF sample taken at the same instant read a
median gap of **16.7ms** — about 60 real frames a second — with a *minimum* gap
of 8.2ms proving the panel really was refreshing at 120Hz.

Both numbers are true and they measure different things: the panel refreshes 120
times a second while the app hands it a new frame every second refresh. A counter
reading 120 is not evidence the game is at 120. The in-page rAF gap is.

### ...and the minimum gap proves capability, not persistence

Found in review, and it qualifies every "confirmed 120Hz" above: a minimum rAF
gap of 8.1ms proves the panel ran at 120Hz **at some instant in the window** —
nothing more. One 8.1ms interval followed by an OEM fallback to 60Hz for the
rest of the window leaves the minimum untouched, and this document itself
records that the OEM falls back silently mid-probe as the phone warms. So a
per-arm minimum cannot certify that an arm *stayed* at 120Hz, and an arm that
silently fell back under-reports whatever it was measuring.

The interleaved deltas above survive this in direction — a fallback lands on
both arms of a 400ms rotation near-equally, which is the same argument that
handles scene drift — but their absolute fps values carry the caveat. The sound
validation, for any future run: check the **distribution** of gaps per arm
(e.g. the share of gaps at ~8.3ms vs ~16.7ms) and discard windows after a
fallback, rather than reading one minimum for the whole window.

### What this means for the sprite pass

The sprite-pass work (draw-call census, redundant property writes, `save`/`restore`
pairs) is measuring real waste and its counts are sound. But its ceiling on this
device is bounded by the canvas's whole bill — 0.414ms of JS command recording
plus a paint-side share the interleaved canvas-hidden arm prices at ~3fps —
against ~4ms of HUD paint. Worth having, and worth sizing honestly against the
HUD before anyone spends a week on it.

### `performance.now()` is 0.1ms-granular on this device

99.6% of consecutive `performance.now()` calls return **zero** delta; the smallest
non-zero delta is 0.1ms. Any single sub-0.1ms timing is noise. This invalidated a
whole round of per-draw-call instrumentation whose parts summed to 0.463ms against
an outer measurement of 3.463ms on the same call — the parts were each rounding to
zero. Only sums accumulated over many frames, or spans above ~1ms, carry meaning.
The 3.05ms, 0.414ms and the fps tables above are all accumulations or spans well
above that floor.

## The idle keyframe recalc, censused (2026-08-28)

`sim/hudperf/run.ts`'s third arm had already named the category: on an idle bay —
a loaded cannon, nothing in flight, nobody touching the glass — RecalcStyle over
600 frames is **289.9ms with the animations running and 0.6ms with them stilled**,
so **99.8% of an idle bay's style recalculation is running keyframes rather than
DOM writes**. That is ~0.48–0.52ms/frame, and it is charged on a frame where by
construction nothing has changed.

`sim/hudperf/keyframes.ts` (`npm run sim:keyframes`) splits that number by
animation. The roll call on an idle bay, post-#149:

| animation | elements | properties | thread |
| --- | --- | --- | --- |
| `pixel-sparkle` | 13 | `opacity` | compositor |
| `belt-arrow-pulse` | 8 | `opacity` | compositor |
| `belt-roll` | 2 | `transform` | compositor |
| `belt-arrows` | 1 | `transform` | compositor |
| `belt-tread` | 1 | `background-position-x` | main |
| `pulse-danger` | 1 | `opacity` | compositor |

**Six animations across 26 elements, and five of the six are pure
transform/opacity.** Leave-one-out, paired, five rounds with the arm order
rotated between rounds (the third rebuild — see below), against a paired prize
of 300.3ms:

| animation | thread | elements | saved | share |
| --- | --- | --- | --- | --- |
| `pixel-sparkle` | compositor | 13 | 79.2ms | **26%** |
| `belt-tread` | **main** | 1 | 41.7ms | **14%** |
| `belt-arrow-pulse` | compositor | 8 | 34.9ms | **12%** |

Everything else sits under the harness's measured noise floor (21.5ms; the
control's five zeros came out 21.5, −21.1, 13.5, −14.2, 5.9ms). The three real
rows sum to 52% of the prize — the shortfall is elements whose recalculation
only stops when several animations still together, which is what the
all-stilled floor measures.

### What that actually says, which is not what the property column suggests

**"Composited" describes the PAINT, not the recalculation.** Blink still ticks a
running animation and recalculates its element's style on the main thread every
frame, whatever property the keyframes land on. Every top row here is
`opacity` or `transform`.

The sharp case is `pixel-sparkle`: `14s steps(2, jump-none)`, so its computed
opacity takes a handful of distinct values across fourteen seconds and is
*identical* on the overwhelming majority of frames. It costs 37% of the idle
recalc anyway. **`steps()` saves paint; it does not save recalculation.**

So there are TWO levers, and the rotation-corrected numbers size them. The
**count of continuously-animated elements** sets the bill's body — thirteen
sparkle pixels are the top row, and moving a keyframe onto `transform` buys
nothing this counter can see; removing it, running it on fewer elements, or
stopping it when its readout is not escalating is what would. And the one
animation that is genuinely main-thread — `belt-tread`'s
`background-position-x` on a *single* element — costs more than the eight belt
arrows put together: per element it is the most expensive thing on an idle bay,
and it is also the one row where a property change alone (a `transform` scroll)
could plausibly move the number.

This also re-answers the crest question #149 opened. Removing the music-driven
beat was worth 23.6fps and was the right call, but it did not take the crest out
of the idle frame: `pixel-sparkle` on thirteen crest pixels is still the largest
single animation on an idle bay.

### The harness had to be rebuilt three times, and all three mistakes are this document's

Recorded because all three are the trap this document keeps re-learning, and
each is subtler than the one before it.

**One pass over the arms is a block design.** The first version measured each
arm once and printed six confidently-ranked rows. Re-running it moved
`belt-arrow-pulse` from 25% to 14% and sent `pulse-danger` from +18.0ms to
**−14.5ms** — the fourth-biggest "win" in the table came back negative. Only the
top row survived.

**Interleaving only pays if the arithmetic uses the pairs.** The second version
interleaved the arms correctly and then compared `median(baseline)` against
`median(arm)`, which throws the pairing away and leaves the drift in the answer.
Measured that way the baseline arm's own spread was **106.7ms on a 289ms
window** and *nothing at all* cleared it. The fix is the paired difference —
`baseline[r] − arm[r]`, per round, then the median of those.

The harness now carries a `(control)` arm that stills nothing, so its paired
difference from the baseline is the method measuring a known zero, printed as
the noise floor with every row inside it marked as resolution rather than
result. **A harness that cannot report a zero cannot be trusted to report a
saving.**

**A fixed order inside the round is still a block design at the slot level.**
The third rebuild came out of review rather than a re-run: every round executed
baseline, control, all-stilled and the six arms in the same order, so drift
that is monotonic WITHIN a round landed on the same arms every time — pairing
against a baseline that always ran first cannot cancel it, and a control that
always ran second cannot measure it at the ninth slot. Rotating the plan one
slot per round moved `belt-arrow-pulse` from 38% to 12%, lifted `belt-tread`
above the floor, and brought the measured noise floor from 57.9ms to 21.5ms.
The fixed-order table this section carried before the rotation is superseded by
the one above — which is itself the strongest evidence the review was right.

### Confirmed on device: those 21 elements are worth ~15fps of 90

Taken on a **OnePlus 7T (HD1900)** — deliberately not the phone the hypothesis
was formed on. Android 11, Snapdragon 855+, a **90Hz** panel rather than 120Hz,
and **WebView 87.0.4280.141**, a Chrome from late 2020. If the finding were an
artifact of the CPH2573 or of a modern Blink, this device is where it would fail.

`pixel-sparkle` and `belt-arrow-pulse` stilled together (21 elements — the
fixed-order table's two leaders; see the post-script below), interleaved every
400ms with the frame straddling each switch discarded, in a live Tier 1 bay,
~950 frames per arm per run:

| run | animations running | stilled | Δfps | Δon-time |
| --- | --- | --- | --- | --- |
| 1 | 79.5fps, 58.4% | 88.7fps, 66.4% | **+9.2** | +8.0pp |
| 2 | 73.9fps, 29.5% | 89.0fps, 72.7% | **+15.1** | +43.2pp |
| 3 | 73.6fps, 28.7% | 89.2fps, 71.6% | **+15.6** | +42.9pp |

Every window carries its vsync discriminator: minimum rAF gaps of 4.7–7.7ms,
which can only happen above 60Hz, so none of these is a 60Hz window answering a
90Hz question.

**The stilled arm is pinned: 88.7, 89.0, 89.2fps on a 90Hz panel, three times
running.** With the animations on, the same bay gives 73.6–79.5 and misses most
of its 11.11ms deadlines. The p90 gap moves 17.4ms → 12.7ms. Two decorative
animations are the difference between this device making its frame and not.

**The A/A control says the probe can report a zero.** The identical probe with a
stylesheet that stills *nothing* — same toggle, same cadence, same discarded
transition frames — returned **−0.8 and +1.7fps** (−2.5 and +2.6pp). The noise
floor is about ±2fps, and the effect clears it by an order of magnitude.

**Two post-scripts from review.** The desktop share of that stilled pair is 38%
after the rotation, not the ~75% the fixed-order table claimed — the Δfps above
is the device's own measurement and inherits no correction, but
"three-quarters of the bill" does not survive as a description of what was
stilled. And the probe now guards its own attribution: it stills only the
surface each target actually runs on (the element, its `::before`, or its
`::after`), aborts up front if a stilled surface carries a non-target animation
— in a congested bay the crest pixels pick up spark and jiggle animations that
the old whole-element stilling would have billed to the targets — and voids the
verdict if one arrives mid-run. The recorded runs predate that guard and lean
on the bay having been calm, which a fresh Tier 1 bay is; the next phone
session should re-take them behind it. `belt-tread`, which the rotation
surfaced, was in nobody's stilled set — on the desktop counter it is another
14% that has never been priced on glass.

### What this still does not establish

The harness's **milliseconds** remain headless Chromium's on a desktop CPU — the
caveat `sim/renderperf` and `sim/hudperf` both carry. What the device confirms is
the *mechanism and the ranking*, not the 0.5ms/frame figure.

**The 120Hz number is not taken.** Every device measurement above is the 7T at
90Hz; the CPH2573 was unplugged when these ran. A shorter deadline should make
this worse rather than better, but that is a prediction, not a measurement, and
the earlier "never halve a 60Hz number into a 120Hz claim" warning cuts in both
directions.

**And no fix is proposed here.** Stilling an animation to price it is not the
same as deciding what the resting HUD should look like — the sparkle and the
belt arrows are deliberate, and the plant crest is a readout that escalates with
congestion. What this section establishes is the size of the purse.

## Related

- `app/native/android/MainActivity.java` — `requestHighestRefreshRate()`, the
  fix that made 120Hz vsync reachable and these numbers measurable.
- `app/sim/renderperf` — the existing render cost harness.
- `app/sim/hudperf/run.ts` — the DOM-write census, whose stilled arm names the
  keyframe category; `app/sim/hudperf/keyframes.ts` splits it by animation.
