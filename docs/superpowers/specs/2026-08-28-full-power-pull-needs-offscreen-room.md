# A full-power pull does not fit on the screen, and on some panels it does not fit at all

Status: **diagnosis complete, fix not chosen.** Measured 2026-08-28 on a OnePlus
7T (HD1900) against staging `a677505`. Written for whoever picks up the fix.

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

## The options, none chosen

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

## What is already fixed

Nothing here. The `cqw` fallback landed alongside this diagnosis is a separate
bug found on the same device — see the menu wordmark note in `app.css`.

## Related

- `app/src/game/cannon.ts` — `DRAG_MIN`/`DRAG_MAX`, `powerRatioForDrag`, `CANNON.x`
- `app/src/game/input.ts` — `onDown`/`onUp`, `dragStart`, the misfire gate
- `app/src/game/render.ts` — `fitViewport`, `screenToWorld`
- [[tetrilaunch-oneplus-7t-device]] — the device, and how its dead band was measured
