# The background is cached and still costs a full canvas of fill every frame

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

## The measurement that motivates this

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

**~20fps sits in fill.** That is the prize, and it is the whole reason this
document exists.

## Where the cost is NOT

Two things were measured and ruled out, so nobody repeats them:

**It is not CPU-side command issuing.** Timed in-page over 120 iterations at
the live canvas size:

| operation | per call |
| --- | --- |
| full-canvas opaque `drawImage` | **0.002ms** |
| full-canvas `clearRect` | 0.001ms |
| full-canvas `fillRect` | 0.000ms |

Canvas 2D records the command and returns; the raster is deferred. So the blit
is nearly free on the thread that issues it and expensive on the one that
executes it. Any fix framed as "stop calling drawImage so often" is aimed at
the 0.002ms and will do nothing.

**It is not a per-frame readback.** `getImageData` appears exactly once in
`render.ts`, inside `trimToInk`, which is per-bake and documented as such — a
few dozen sprites over a run. There is no GPU-to-CPU stall in the frame path.

## What "the GPU is idle" did and did not mean

`dumpsys gfxinfo` reports a *50th gpu percentile* of 3ms while putting *Slow
issue draw commands* on essentially every janky frame. That number is the
**Android view hierarchy's** GPU time — HWUI compositing the WebView's surface
into the window. It is not the WebView's internal canvas raster, which happens
in a different context and does not appear in that counter at all.

So the GPU is not sitting unused waiting to be given work. It is already doing
the canvas raster, and the fill measurement above is what that costs. The
useful lever is not "start using the GPU" — it is "give the GPU less area to
fill per frame."

## The change

Split the single `<canvas>` into two stacked, identically-sized canvases:

- **`#game-bg`** — opaque. Receives exactly what `getBackgroundLayer` bakes
  today, painted only when the existing cache key changes. Between those
  changes it is never touched, so the compositor holds its texture and re-uses
  it.
- **`#game-fg`** — transparent. Cleared and repainted every frame with
  everything from the world clip onward: chute, wind indicator, compactor,
  pistons, cubes, seams, bombs, trajectory, cannon, effects.

`getBackgroundLayer` mostly survives as-is; its cache key becomes the trigger
for painting `#game-bg` rather than for returning a canvas to blit. The offscreen
bake canvas can then go away entirely — the bg canvas *is* the cache.

### What this trades

The per-frame opaque full-canvas fill is replaced by a per-frame full-canvas
`clearRect` on the foreground plus one extra compositor layer to blend. Clearing
to transparent is cheaper than filling from a texture, and HWUI has headroom
(3ms), so the expected direction is a win — but **this is a prediction, not a
measurement**, and it is the main thing the implementation has to prove.

## The risk that would kill it

If the WebView promotes the two canvases into one composited layer anyway, or
re-rasters the foreground's transparent pixels at the same cost as opaque ones,
this buys nothing and adds a DOM element plus a resize path. That is a real
possibility and it is cheap to find out.

**Validate before building the whole thing.** A throwaway page with two stacked
canvases at 1584x720, one static and one cleared-and-drawn per frame, measured
with the same rAF sampler used above, settles it in minutes. Do that first.

## Open questions for a human

1. **Is ~20fps worth a structural change to the render path?** After the
   refresh-rate fix the game presents 85-98fps on this device. This work plausibly
   closes part of the gap to 120 but is very unlikely to close all of it — quarter
   fill only reached 108. A locked, evenly-paced 90 may be the better product
   decision than a jittery reach for 120.

2. **`congestionRows` is in the bake key**, so the background currently re-bakes
   mid-run as the pile crosses a row boundary. Under the split that becomes a
   full repaint of the background canvas during play. Should the congestion floor
   move to the foreground layer instead, trading a small per-frame cost for no
   mid-run bake spike? Not measured either way.

3. **`layout.ts`'s solver and `sim/uifit`** both assume one canvas. The uifit
   harness measures real pixels across 13 devices and is CI-gated; a second
   canvas element needs its fixtures checked, not assumed.

## What must not change

The viewport transform, the world clip opened upward to `skyTop`, and the draw
order within the foreground. The clip note in `render()` records a real bug —
a lofted shot apexing ~250 world px above `y=0` vanished into a black band —
and the split must keep the foreground's clip identical to today's.

## Related

- `app/native/android/MainActivity.java` — `requestHighestRefreshRate()`, the
  fix that made 120Hz vsync reachable and these numbers measurable.
- `app/sim/renderperf` — the existing render cost harness.
