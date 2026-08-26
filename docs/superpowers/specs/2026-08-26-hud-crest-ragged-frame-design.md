# The plant panel's crest renders as a ragged, misaligned red frame

**Date:** 2026-08-26
**Status:** investigated, not diagnosed to root cause — needs a fix session
**Reported against:** `c44317e`, seen first in the Electron desktop shell at 4K

## Symptom

The plant panel (FUNDS / TARGET, LAUNCHES, TIME, RELOAD, COMBO, BUILD rack) is
wrapped in a crimson frame that reads as broken: irregular chunks of varying
width rather than even banding, and visibly out of register with the panel it
surrounds — the top band starts partway across instead of at the panel's left
edge, and the left band runs above the panel's top edge.

## What it is NOT — ruled out, do not re-investigate

**It is not a 4K or DPI bug.** This was the original report ("experiencing this
in fullscreen") and it is wrong. The same panel was captured in the same build
at `--force-device-scale-factor=3` and `=1`. The ragged frame is **identical at
both**. It is more noticeable at 4K only because everything is larger.

**It is not a sibling of #106's sprite source-crop bug.** That class was checked
directly: the only other source-cropped (9-argument) `drawImage` in `render.ts`
is at `render.ts:510`, and it takes its rectangle from the source canvas's own
`getImageData` dimensions, so it is already in backing-store pixels and correct.
Every other `drawImage` in that file is 5-argument — destination-only, no source
crop.

**It is not canvas at all.** The frame is DOM.

## What was measured

Build `c44317e`, Electron shell, Tier 1 Deep Run, bay 1, tutorial skipped.

At `--force-device-scale-factor=3`:

- `.plant` — class `plant plant--maw`, rect `{x:15, y:283, w:410, h:210}`
  - `background-image`: `linear-gradient(rgba(22,22,37,.95), rgba(9,9,18,.96))`
  - `border-image-source`: `none`
  - `box-shadow`: `rgba(255,255,255,0.05) 0 1px 0 0 inset`
  - So **the red is not painted by `.plant` itself.**
- `.plant__crest--brow` / `--cap` — rect `{x:139, y:266, w:286, h:6}`
  - `background-image`:
    `repeating-linear-gradient(90deg, oklab(…) 0%, oklab(…) 5%, oklab(…) 5%, oklab(…) 10%, oklab(…) 10%, …)`
- `.plant__crest--step` — `{x:133, y:272, w:6, h:13}`
- `.plant__crest--shoulder` — `{x:425, y:272, w:6, h:13}`
- `.plant__crest--rivet` — `{x:137, y:270, w:4, h:4}`

Custom properties resolved on the panel:

```
--crest-heat  0.45
--crest-beat  0
--crest-mat   #5f93a6
--h0 … --h6   color-mix(in oklab, #2c0a14, #5c1225 … #ffbdae calc(58% + 0.45 * 42%))
```

The `--h0…--h6` ramp is the crimson series `#2c0a14 → #ff2d55`, which is where
the red comes from. That ramp is #98's work (*"The intake's border says what is
loaded, and only moves when you fire"*).

Note `--crest-mat` is set to `#5f93a6` but the panel's class list is
`plant plant--maw`, **not** `plant--mat`, so the material tint is not applied
here — the base heat ramp is what renders.

### The register mismatch, as a number

`.plant` spans x 15 → 425. The crest cap/brow spans x 139 → 425. **The crest is
124px narrower than the panel, entirely on the left.** Whether that is the bug
or the design is the open question below.

## Not yet established

**Which element paints each edge of the frame.** The crest sub-elements measured
above are small (286×6, 6×13, 4×4) and cannot account for a frame wrapping a
410×210 panel. `getComputedStyle` was called without a pseudo-element argument,
so `::before` / `::after` were never sampled — that is the most likely home for
the remaining edges and is the first thing to check.

**Whether the raggedness is intended.** The crest is described in #98 as a
crenellated industrial fixture, so *some* irregularity is by design. The
misalignment is harder to defend. Settle this before changing pixels: if the
crest is meant to be inset from the panel's left edge, the bug is only the band
rendering; if it is meant to wrap, the bug is geometric.

## Repro

```
cd app/desktop
./node_modules/.bin/electron . --remote-debugging-port=9222 --force-device-scale-factor=3
```

Then over CDP (Playwright `chromium.connectOverCDP("http://localhost:9222")`,
the page whose URL starts `app://`):

1. Click the element under `[data-action]` whose text matches `/deep run/i`.
2. Wait ~3.5s, then click the one matching `/skip tutorial/i`.
3. Read `document.querySelector(".plant").getBoundingClientRect()` and screenshot
   that rect with ~30px of margin.

Repeat with `--force-device-scale-factor=1` to confirm the frame is unchanged.

Note the desktop shell keeps its own `localStorage`, separate from the phone, so
it starts at Tier 1 with `BEST 0` — no save manipulation needed to reach bay 1.

## Verification required for the fix

- `npm run typecheck` — runs **both** tsconfigs; the sim config catches
  `Settings` literals the main one misses.
- `npm run test`
- `npm run test:uifit` — must report `new 0`. Baseline is 142 at time of writing.
  Note the harness has a `plant` check ("the HUD plant panel stays inside its
  design box") that currently passes, so it is not catching this — if the fix is
  geometric, consider whether that check should have caught it.
- Confirm at device scale 1 **and** 3, since the fault is present at both.
