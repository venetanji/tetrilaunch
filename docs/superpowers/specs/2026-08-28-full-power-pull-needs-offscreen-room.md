# A full-power pull does not fit on the screen, and on some panels it does not fit at all

Status: **fixed — PR #163** (option 1, `DRAG_MAX = CANNON.x - CELL`). Diagnosis
measured 2026-08-28 on a OnePlus 7T (HD1900) against staging `a677505`; the fix
and its acceptance numbers are in "The fix taken" at the bottom.

## The report

> "it prevents my touch drag to pull a 100 percent... it works at full speed if
> I drag from the center of the screen, but if I drag from the cannon to the
> left it just releases when I exit the boundary, although there's a bunch of
> black space to the left of the bay boundary."

Both halves of that are accurate, and the second half is the diagnosis: the
gesture works from the middle of the screen and fails from the cannon. That is
not a property of the phone. It is a property of where the pull has room to go.

## The mechanism, in world units

`Cannon.aimFromDrag` measures the pull from **the point the finger went down**,
not from the cannon:

```ts
this.dragRatio = g.cannon.aimFromDrag(p.x - this.dragStart.x, p.y - this.dragStart.y);
```

and the power ramp is a pure function of that vector's length:

```ts
// cannon.ts
const DRAG_MIN = 28;
const DRAG_MAX = 220;
export function powerRatioForDrag(len: number): number {
  return Math.max(0, Math.min(1, (len - DRAG_MIN) / (DRAG_MAX - DRAG_MIN)));
}
```

Against `WORLD = { width: 1280, height: 720 }` and `CANNON.x = 150`:

**`DRAG_MAX` (220) is larger than the cannon's entire distance from the left
wall (150).** A player who grabs at the cannon and pulls straight back — the
literal slingshot gesture the control is named for — asks the pull to end at
world x = **−70**. There is no such place. Pulling down-left at 45° needs 155 in
each axis and still lands at world x = −5.

**So a horizontal full-power pull from the cannon is geometrically impossible,
on every device, at every viewport.** 100% is reachable today only by pulling
steeply *downward* (the vertical axis has room: cannon.y is 288 of 720), or by
starting the drag somewhere other than the cannon — which is exactly the
workaround the report describes finding by accident.

## Why it usually works anyway, and why that is the fragile part

`screenToWorld` does not clamp, and the canvas is full-bleed, so a drag can
continue into the letterbox bars and off the world entirely:

```ts
// render.ts — a contain-fit with centred offsets
const scale = Math.min(cssW / WORLD.width, cssH / WORLD.height);
ox = (cssW - WORLD.width * scale) / 2;
```

On the 7T's 854x384 CSS viewport that is scale 0.533 and **ox = 85.5**, so
there are 85.5 CSS px of black bar each side and a touch at CSS x=0 maps to
world x = −160. The bar is not playfield, but it *is* canvas, and the pull
happily runs through it.

**That is the load-bearing accident.** Full power at the cannon depends on the
player being able to drag through the letterbox margin — a region the game draws
as inert black and gives no affordance to. Anything that makes that margin
untouchable takes 100% power with it, and the player is given no clue why.

## What made it visible: measured pull → power

Injected swipes from the cannon (CSS x=199), reading `#hud-power-val` at rest:

| drag ends at CSS x | power |
| --- | --- |
| 94 | 86% |
| 71 | **100%** |
| 35 | 100% |
| 14 | 100% |

**100% needs the finger to reach CSS x≈71**, which is 14px inside the 85.5px
letterbox bar — outside the playfield, on a part of the screen the game paints
black.

On the reporting device that region does not deliver touches. The raw kernel
stream (`getevent -lt /dev/input/event4`) never reports below `ABS_MT_POSITION_Y`
= **267** across 6,800 events in two captures, then emits `BTN_TOUCH UP`; in
landscape that axis is CSS x, and 267 / 2.8125 = **CSS x 95**. So the finger is
gone before the pull is done, and the app sees a genuine `pointerup` — no
`pointercancel`, nothing an application could have caused.

Whether that band is a failed digitizer segment or the OEM touch driver's
orientation-aware edge suppression is **not resolved and does not need to be**:
the driver takes that configuration from userspace and applies it below the
input pipeline, which is consistent with both the capture and with the same
region working on the reporter's other OnePlus. Either way it is a real class of
device, landscape edge suppression for grip rejection is common, and the game
should not be relying on the outermost 8% of the glass.

## The options as they were costed (1 was taken — see below)

1. **Shrink `DRAG_MAX` below `CANNON.x`.** Smallest change; makes a horizontal
   full pull fit inside the world by definition. Costs throw length per unit of
   power, which is a feel change, and `MIN_FIRE_RATIO`'s 0.3 is expressed
   against the same span so the misfire gate moves with it.
2. **Normalise the ramp against the room actually available** from the drag
   origin to the field edge. Most robust — full power always reachable whatever
   the viewport, cannon position or start point — but it makes the same gesture
   mean different power in different places, which is a real feel cost and needs
   re-tuning against `sim/bots.ts`.
3. **Extend the world to the screen edges** so the letterbox becomes playfield
   and the required pull region moves inboard in screen coordinates. This is
   what the reporter asked for, and it does fix the reporting device: widening
   to 1602x720 with the extra 322 world px added LEFT of the cannon puts a full
   horizontal pull's endpoint at CSS x≈134, clear of the dead band. It is also
   by far the largest change — a viewport-dependent world touches physics walls,
   every bay's composition, `sim/uifit`'s baselines and the balance sims — and it
   should not be done for this reason alone.

Options 1 and 3 are independent and could both be right: 1 fixes the geometry
bug, 3 answers "the black bars are wasted screen". **1 is the one this document
would do first**, because it is the only one that makes the control's own
arithmetic self-consistent, and it fixes every device rather than this one.

## The fix taken

**Option 1, with the constant DERIVED rather than chosen** (PR #163):

```ts
// cannon.ts
export const DRAG_MAX = CANNON.x - CELL;   // 110
```

That is a sentence, not a number: *a full pull that starts at the cannon ends on
the playfield, a cube's width clear of the wall.* The clearance is a `CELL`
because a cube is this game's unit of "not touching", and because it is measured
to be enough — on the 7T's letterbox the field scales by 0.533, so a cube of
clearance is 21 CSS px while that panel's dead band eats only the outer 17 world
px (9 CSS px) of the field.

### The measurement that chose it over option 2

Option 2 was costed above as "most robust". Measured, it is **worse at exactly
the case that motivates it**. Normalising against the room in front of the
finger puts full power at the LAST PIXEL the gesture can reach: CSS x = 85.7 on
the 7T — *inside* the 95 px dead band this whole document is about — and CSS
x = 0.0 on an exact 16:9 panel. It converts an impossible gesture into a merely
miserable one, and charges for it by making the same finger travel mean
different power in different places. Option 1 lands the full pull 37–107 CSS px
clear of every edge on every panel tested.

### Before → after, injected touch swipes reading `#hud-power-val`

Harness: `app/sim/_scratch-pullpower.ts`. The viewport transform and the span
are imported from the running page rather than re-modelled.

Pull from the cannon on the 854x384 (7T) viewport:

| pull ends at CSS x | before | after |
| --- | --- | --- |
| 130 | 20% | 47% |
| 120 | 30% | 70% |
| 110 | 40% | 93% |
| **100** | **50%** | **100%** |
| 70 | 79% | 100% |
| 40 | 100% | 100% |

### The feel delta — CSS px of gesture for 100% power

| viewport | scale | before | after | full pull's endpoint, before → after |
| --- | --- | --- | --- | --- |
| 854x384 (OnePlus 7T) | 0.533 | 117.3 | **58.7** | CSS x 48.4 → **107.0** (live glass starts at 95) |
| 1280x720 (exact 16:9) | 0.934 | 205.6 | **102.8** | CSS x −65.4 → **37.4** (off-screen → on the playfield) |
| 1269x663 (desktop) | 0.921 | 202.6 | **101.3** | CSS x −61.3 → **40.0** |

The honest cost: the ramp is half as fine — **2.3% of power per CSS px on the
7T, where it used to be 1.0%**. That is the price of the control being possible
at all, and it is written into the constant's own doc comment.

### What rode the span, and what did not

`MIN_FIRE_RATIO` needed no re-tuning, which is the whole reason it was written
as a fraction: the misfire floor moved from 85.6 to 52.6 world px on its own —
28 CSS px on the phone, down from 46, still an order of magnitude past the 1-2
px a resting thumb wanders. Measured: 8, 16 and 24 CSS px nudges all refuse to
fire on all three viewports.

`gamepad.ts`'s `STICK_DRAG` was the one other thing expressed against the span,
and it was expressed in a COMMENT — "past cannon.ts's DRAG_MAX" beside a hard
240. Exactly the coupling this change rots silently: 240 stays literally past a
span that just halved while the stick's power ramp collapses into its first half
deflection, with nothing going red.

**The first attempt at that repair was itself wrong, and the correction is the
more useful finding.** Deriving `STICK_DRAG = DRAG_MAX * 1.09` preserved the
pad's ENDPOINTS and nothing between them, because `powerRatioForDrag` subtracts
a FIXED `DRAG_MIN` of 28 world px that does not scale with the span. Rescaling
the stick's length rescales the ramp but not its foot, so every interior point
of the curve moved while both ends stayed exactly put — which is why the
endpoint pins stayed green. Measured across 10,001 deflections:

| deflection | before | first repair | now |
| --- | --- | --- | --- |
| 0.22 (the deadzone's edge) | 12.9% | **0.0%** | 12.9% |
| 0.30 | 22.9% | 9.7% | 22.9% |
| 0.50 | 47.9% | **39.0%** | 47.9% |
| 0.70 | 72.9% | 68.2% | 72.9% |
| 1.00 | 100% | 100% | 100% |

The worst gap sat at deflection 0.2335, 14.6 points down, and the bottom of the
throw was the real damage: a stick past its own deadzone asking for exactly zero
power is a stick with two deadzones stacked.

**The lesson generalises past this bug.** Because the mapping's foot does not
scale, ANY caller that reaches it by rescaling its own input gets a different
curve rather than a rescaled one. So the pad no longer multiplies a deflection
by a length at all: `gamepad.ts` owns its curve in DEFLECTION space
(`stickPowerRatio`, landmarks 28/240 and 220/240), and `cannon.ts` exports
`dragLenForRatio` — the exact inverse of `powerRatioForDrag` — so a caller that
knows what ratio it wants can ask for it without knowing the span. `DRAG_MIN`
and `DRAG_MAX` are both module-private again. Worst |before − now| across 10,001
deflections is 1.11e-16, one ULP, and the pin is now curve equality across the
whole throw rather than at its two ends.

**`sim/bots.ts` and `sim/aim-strategies.ts` do NOT go through the drag mapping.**
They set `g.cannon.angle`/`g.cannon.power` directly in world units; nothing in
`sim/` but `systems.ts`'s own pins touches `powerRatioForDrag` or `aimFromDrag`.
The re-tuning this document listed as an option-2 cost does not exist for either
option — the balance sims cannot see `DRAG_MAX` at all.

Option 3 remains untaken and independent, exactly as costed above.

## What is already fixed

The `cqw` fallback landed alongside this diagnosis is a separate bug found on
the same device — see the menu wordmark note in `app.css`.

## Related

- `app/src/game/cannon.ts` — `DRAG_MIN`/`DRAG_MAX`, `powerRatioForDrag`, `CANNON.x`
- `app/src/game/input.ts` — `onDown`/`onUp`, `dragStart`, the misfire gate
- `app/src/game/render.ts` — `fitViewport`, `screenToWorld`
- [[tetrilaunch-oneplus-7t-device]] — the device, and how its dead band was measured
