# Rendering profile, 2026-10-03

Baseline: staging `84c713f`. Same cloud machine, system Chromium, unchanged browser settings. These are relative measurements, not phone FPS guarantees. Canvas microbenchmarks force a one-pixel readback each frame to include raster work; live-loop measurements use normal requestAnimationFrame pacing. Physics measurements run separately in Node and must not be added to browser numbers as though they measured one frame.

## Changes retained

| Measurement | Before | After |
| --- | ---: | ---: |
| HUD geometry reads, 420 idle/live frames (~7s), 844×390 | 749 | 0 |
| Deep diagnostic samples in that window | 7 (~0.8–0.9ms median each) | 0 during ordinary play |
| 50,000 unchanged trajectory refreshes, median of five rounds | 43.80ms | 17.38ms |
| 50,000 changing-aim refreshes | 38.47ms | 39.34ms |
| Live frame interval p95, quiet/firing/held-key cases | ~16.7–16.8ms | ~16.7–16.8ms |

The final live comparison used identical run seed `3423147008` in every arm, asserted by the profiler. Before/after runs were sequential to avoid test-suite contention.

The held-arrow case eventually reaches the angle clamp; it measures sustained held input, not continuously changing aim. The separate changing-aim benchmark covers that path.

There is no measured large FPS increase. The geometry change removes periodic synchronous DOM work. Enable the existing diagnostic ruler before playing to retain the diagnostic sample; turning it off stops sampling without erasing the last sample. The trajectory change avoids repeated full-path allocation when all nine numeric inputs match exactly. Wind, aim, power, origin, gravity, integrator parameters, and the warning cutoff remain synchronous invalidation inputs.

## What remains expensive

Mixed-cargo renderer, 150 timed frames after 60 warmup draws:

| CSS viewport / render DPR | Requested pile | Quiet p50 | Busy p50 / p95 |
| --- | ---: | ---: | ---: |
| 844×390 / 1.5 | 100 | 1.0ms | 1.9 / 2.3ms |
| 844×390 / 1.5 | 300 | 6.6ms | 7.7 / 10.5ms |
| 1280×720 / 2 | 100 | 3.6ms | 6.4 / 8.1ms |
| 1280×720 / 2 | 300 | 20.5ms | 22.0 / 24.7ms |

These are requested synthetic piles: settling/removal can reduce the actual drawn cargo (the 300 fixture's census drew 150). At desktop size the cumulative chrome-only median was 2.6ms, adding cubes brought it to 18.5ms, and effects/aim/seams brought it to ~22ms. Software raster cost is dominated by the crowded pile, not the tiny trajectory calculation. Node physics p95 was 0.10–0.13ms at 100 requested cubes and 1.45–1.53ms at 300 (loose/jointed variants, 180 steps).

The app already caps compact render DPR at 1.5, larger-view DPR at 2, and backing area at 4MP. It already bakes static glows/backgrounds, crops sprites, caps debris, skips covered canvases, and limits ordinary HUD mutations. None of those protections were removed. No graphics-quality reduction or physics change is included.

## Rejected experiment

The new `--bombs N` fixture covers active rotated charges and a loaded muzzle charge, which the older fixture omitted. Three active charges plus the loaded preview added ~0.2–0.5ms at 844×390 / 1.5. Baking them into sprites changed translucent overlap and the device-space blur at DPR 1, 1.5 and 2. That renderer change was discarded; only the profiling coverage remains.

## Reproduction and validation

From `app/`, with an installed browser (do not install over the repository browser pin):

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node scripts/profile-live.mjs --json /tmp/live-profile.json
npx tsx sim/trajectory-cache.ts --bench
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run sim:renderperf -- --counts 0,100,300 --frames 150 --dpr 1.5 --css 844x390
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run sim:renderperf -- --bombs 3 --counts 0,150 --frames 60 --dpr 1.5 --css 844x390
npm run sim:perf -- --counts 100,300 --steps 180
```

`PROFILE_ROOT` can point the live profiler at another checkout for comparison. Its API routes are intercepted; it never submits scores. The `geometry-off` arms are attribution controls, not separate product modes. The normal render benchmark excludes physics and DOM cost; the live profiler includes those but does not force synchronous raster readback.

Regression coverage proves diagnostic opt-in/off/throttling/sample retention, exact trajectory equality with the original integrator, and independent invalidation of each input. Removing any one of the nine comparisons was verified to fail its test. Real-device GPU/compositor behavior and sustained thermal performance remain follow-up measurements; do not infer them from headless cloud timings.
