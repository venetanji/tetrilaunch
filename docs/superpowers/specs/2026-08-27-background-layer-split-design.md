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

## Related

- `app/native/android/MainActivity.java` — `requestHighestRefreshRate()`, the
  fix that made 120Hz vsync reachable and these numbers measurable.
- `app/sim/renderperf` — the existing render cost harness.
