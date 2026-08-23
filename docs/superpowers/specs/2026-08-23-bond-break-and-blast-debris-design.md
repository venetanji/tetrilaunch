# Bond breaks, blast debris, and the chevron whose top third was painted black

**Date:** 2026-08-23
**Status:** Designed and approved. Implementation in this branch.

## Why

Three things on the field happen without the player being told they happened.

**A joint snapping is silent.** `updateBreakableJoints`
([game/pieces.ts](../../../app/src/game/pieces.ts)) deletes an over-stretched
constraint and draws nothing. The whole point of breakable joints is that a hard
landing costs you a piece's rigidity — the player is supposed to *learn* that a
flat drop keeps a tetromino whole and a corner strike does not. Today the only
evidence is that the pile behaves differently a second later, which is the worst
possible place to learn a rule. The same is true of `breakJointsInBand`: the
compactor crushes pieces apart as it sweeps and reports it with nothing.

**A blast deletes cargo with no wreckage.** `detonate` and `resolveVolatile`
([game/game.ts](../../../app/src/game/game.ts)) remove the cubes inside the
radius and spawn a single orange ring. The cubes do not come apart; they cease.
A demolition charge and a volatile pop both read as "some of the pile stopped
existing", and neither shows you *what* you just destroyed — which matters most
for the volatile hazard, where the answer is "cargo you had already landed".

**The belt's chevrons only draw their bottom half.** Reported as a drop-shadow
problem. It is partly that, and mostly not — see below.

## The FX side: one primitive, three presets

`drawShatterFx` ([game/render.ts](../../../app/src/game/render.ts)) already
does the thing both new effects want: fling N baked, glowing, spinning shards
out of a point and fade them. It is extracted into `drawShardBurst` and driven
by a preset table.

| preset | count | size | fling | TTL | extras |
| --- | --- | --- | --- | --- | --- |
| `shatter` — line clear, unchanged | 7 | 5px | 34px | 700ms | white core flash, r10 |
| `snap` — a bond breaking | 4 | 4.2px | 22px | 500ms | pinpoint core, r4.5 |
| `chunk` — blast debris | 3 | 10px | 46px | 800ms | tumble + gravity sag |

`snap` was first tuned the obvious way — 2.2px shards, 12px reach, 320ms, no
core — and on a real pile it was **invisible**. A seam sits BETWEEN two cubes,
so the burst always draws over the brightest thing in the frame: 40px cubes
carrying their own glow. The shard had to come most of the way back up to the
shatter's, and the "tinier" is carried instead by count (4 vs 7), reach and
life. The core came back too, as a pinpoint rather than the shatter's wide
flash, so a Bond Breaker tearing two dozen seams crackles instead of strobing.

**The sprites stay baked.** Each preset stamps one pre-rendered
`shadowBlur`-glowed square per colour, scaled and rotated at draw time. This is
not an optimisation to revisit later; it is the reason the existing shatter is
affordable at all. See render.ts's note above `getSprite("shard|…")`: a
multi-row clear spawns dozens of bursts in the exact frame the payout logic is
busiest, and doing the glow live was hundreds of Gaussian passes in the frame
most likely to tip a full bay into catch-up stepping.

`chunk` is the one preset that sags. Three big pieces flung on pure radial lines
read as a starburst — a *diagram* of an explosion. A quadratic downward drift
over the burst's life is what makes them read as debris that was thrown and is
now falling, and it costs one multiply per chunk.

### Bond breaks (`snap`)

A constraint does not know its colour, so `createTetrisPiece` stamps `color` on
each one next to the `restLength` and `breakStretch` it already stamps. Stamped
at creation rather than looked up at break time on purpose: the alternative is a
linear scan of `cubes` per broken joint, and the compactor sweep breaks many
joints in one step.

All three break paths return what they tore — `{x, y, color}` at the joint's
midpoint — where they used to return `void`. Returning rather than taking a
callback keeps pieces.ts render-agnostic, and every existing caller
(`sim/systems.ts` among them) ignores a return value, so nothing needs touching.

- `updateBreakableJoints` — the stress snap.
- `breakJointsInBand` — the compactor crushing a piece apart.
- `useBondBreaker` — the ability.

The Bond Breaker changes shape here. It currently spawns a **full-size
`shatter` per cube**, which says "every cube exploded" when what happened is
"every seam let go" — and at field scale it is a wall of shards. It now spawns a
`snap` per joint torn, at the joint's midpoint, and keeps its central
`explosion` ring. The ring is what makes the field-wide discharge read as one
deliberate action rather than scattered noise, and it stays.

### Blast debris (`chunk`)

One `chunk` per cube the blast destroyed, at that cube's position, in that
cube's colour. Per-cube rather than one event per blast carrying a colour list,
because debris that starts where its cube stood is the entire read: you see the
shape of what you destroyed come apart.

Both destroy paths spawn them — `detonate` for the demolition charge,
`resolveVolatile` for the hazard pop. The existing ring, white flash and orange
sparks are untouched; the chunks fly out through them.

## The chevron: the shadow is a quarter of the problem

The report was that `drop-shadow(0 -1px 0 rgba(0,0,0,0.5))` on `.belt__arrows i`
hides the top of the arrow. Magnifying the live element and A/B-ing the variants
in place says that shadow is real but minor.

The chevron's own fill is two stacked gradients
([styles/app.css](../../../app/src/styles/app.css)):

```css
linear-gradient(180deg, rgba(0,0,0,0.66) 6%, rgba(0,0,0,0.08) 72%),
linear-gradient(180deg, transparent 30%, var(--belt-c) 96%)
```

The lower layer carries **no cargo colour at all above 30% of the height**, and
the upper layer washes that same region with black at `0.66`. The chevron is
roughly 9px tall, so its top ~2.8px is painted dark-on-dark before the shadow is
applied — and then a 1px black shadow is stacked above that. Halving the shadow
recovers about 1px of a ~3.8px dark zone; the arrow still reads as a bright
lower-left wedge with no point.

The fix is both:

- Shadow offsets `1px` → `0.5px`, as reported.
- `transparent 30%` → `transparent 8%`, so the cargo colour reaches the top edge.
- Black wash `0.66 → 0.08 @ 72%` becomes `0.5 → 0.06 @ 60%`, so the upper wall
  still turns away from the light without swallowing the shape.

`opacity: 0.6` on the `::after` is deliberately left alone. It is what keeps the
chevron reading as a cut into the plate rather than a lamp sitting on it, and
raising it was the one variant that lost that.

The two gradients still fade to `transparent` rather than using `color-mix`, for
the reason already recorded in that rule's comment: `--belt-c` arrives as an
opaque hex, and on a WebView without `color-mix` the whole `background`
declaration would drop and the chevron would vanish instead of degrading.

## Out of scope

No audio. `onBondBreak` already fires for the ability and the new snaps are far
too frequent to each carry a sound; a per-snap cue is a separate design with a
voice-stealing budget attached.
