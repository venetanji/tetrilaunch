# Telling materials apart

Design doc — 2026-08-24

## The report

A playtester could not tell tar from slag, or rebar from volatile, and asked
whether the colours were the same or whether they were colour blind.

Both, as it turns out, and the more interesting half is the first one.

## What the measurement found

Every swatch a player has to separate — seven shipment colours and six material
colours — scored pairwise in CIEDE2000, and again under simulated protanopia and
deuteranopia (Machado et al. 2009 matrices at full severity).

| Pair | ΔE00 | Vision |
| --- | --- | --- |
| rebar `#ff8a1f` / standard L `#ff8a00` | **2.0** | normal |
| slag aura `#a19db8` / magnetic `#8f9bd6` | **10.5** | normal |
| tar aura `#907cb8` / magnetic `#8f9bd6` | **11.8** | normal |
| slag aura / tar aura | **13.0** | normal |
| volatile `#d4ff3a` / standard O `#ffe500` | **3.3** | deuteranopia |
| rebar / volatile | **17.0** | deuteranopia |

Two things follow.

**Rebar was broken for everyone.** ΔE00 of 2.0 is at the just-noticeable
difference. A rigid shipment — the one whose whole point is that a bad landing
cannot be fixed — was drawn in the same colour as an ordinary L piece. No colour
vision deficiency was needed to hit this.

**The material telegraph was making things worse.** `shipmentAura` lifts every
channel until the brightest reaches 0.72, so that tar's near-black and slag's
dim grey become visible against the backdrop. Both are desaturated violets, so
lifting them lands them on top of each other *and* on top of magnetic. Three
materials, one pale lilac glow, on both surfaces that use it — the belt tile and
the muzzle ghost. The mechanism designed to make a material noticeable was
deleting the distinction between three of them.

And the reported rebar/volatile pair is exactly what a red-green deficiency
predicts: 46.3 apart at normal vision, 17.0 under deuteranopia.

## Why this cannot be fixed with colour

A search over HSV space for a replacement rebar hex — scoring each candidate by
its **worst-case** distance from all twelve other swatches, under normal,
protanopia and deuteranopia simultaneously — returned a best achievable worst
case of **21.0**, and that candidate (`#801100`) is a dark maroon that would
half-vanish against the `#07070f` backdrop and start impersonating tar. Every
candidate that stays bright and saturated lands at 17–18.

For calibration, 17.0 is the rebar/volatile distance the playtester described as
"super hard to distinguish". The ceiling for a thirteenth colour is roughly "as
distinguishable as the pair being complained about".

Thirteen swatches on one near-black field is past what hue can carry. The
palette is full. Shape is the channel that is left.

## The design

### Colour

Rebar moves `#ff8a1f` → `#e54c00`. Nothing else moves.

| Pair | before | after |
| --- | --- | --- |
| rebar / standard L (normal) | 2.0 | 17.9 |
| rebar / volatile (deuteranopia) | 17.0 | 33.3 |
| rebar / volatile (protanopia) | 24.0 | 45.3 |

Colour is demoted from identity to first-glance hint. Nothing depends on it
alone any more, which is what turns the remaining collisions from bugs into
redundancy.

### Symbols

Six glyphs, authored once in `theme.ts` as SVG path data in a 24×24 box, eaten
directly by both consumers: the canvas renderer builds a `Path2D` from the same
string the DOM drops into a `<path>`. A glyph drawn twice is a glyph that
drifts.

| Material | Glyph | Reads as |
| --- | --- | --- |
| slag | ring struck through | cannot fill a slot |
| cryo | six-spoke needles | frozen |
| rebar | orthogonal lattice | reinforced |
| volatile | solid burst | detonates |
| tar | two interlocked links | the joint that will not break |
| magnetic | closed arch | horseshoe magnet |

They differ by **silhouette class**, not merely by drawing — ringed, radial,
orthogonal, solid, looped, arched. Two glyphs that differ only in detail collapse
at belt-tile size and in peripheral vision, which is exactly where they are read.
Volatile is the only filled one: mass reads as danger faster than outline does,
and volatile is the material whose cost lands on cubes that were already down.

### Not a colour-blind option

The glyphs are always on. Rebar sat 2.0 from a standard L and the three auras
clustered within 13 for *ordinary* vision, so a build without the glyphs is
broken for everyone. Gating them behind a setting would ship the broken build as
the default and hope affected players go looking in a menu, and it would make the
glyph-less version the one that gets tested.

The legitimate worry underneath the request is bay noise — sixty cubes each
wearing an icon. That is answered with a dial (`BAY_GLYPH_ALPHA`) and by scoping
which materials mark the cube at all, not by making the mark optional.

### Two-tone cubes

A non-standard cube is drawn as its **shape colour framing its material
colour**, with the glyph etched on the interior.

The polarity is not arbitrary. Shape already has a second channel — the
silhouette tells you an L is an L with no colour at all — while material has
none. So the channel carrying more information gets the larger region (~55% of
the cube's area) and the mark, and the redundant one lives in the frame. The
inverse was mocked up and rejected: it demotes material colour to a ~3px rim, and
thin rims of slag/tar/magnetic lilac are harder to separate than solid fills.

This produces a free signal that turns out to be the most valuable part:
**solid means ordinary, framed means think.** A standard shipment's material
colour *is* its shape colour, so it renders solid out of the same code path.
That distinction is silhouette-level, so it survives at any size and any vision
type — and it is what actually rescues volatile-against-a-standard-O, the one
collision no hue could fix.

Standing-wall cubes opt out via `Cube.framed = false`: `createStandingWall`
assigns type `"O"` for looks, so a frame drawn from that type would assert a
shipment identity the cube never had.

### Which materials mark the cube in the bay

`BAY_GLYPH_MATERIALS` = slag, rebar, volatile, tar.

The test is not "does this material need a glyph" — every one does in the
preview, because every one changes how you aim. It is narrower: **after it has
landed, do you still make decisions about this cube?**

- **slag** — yes, you have to find it again to aim a charge at it
- **volatile** — yes, you have to know which landed cubes will chain
- **rebar** — yes, that row cannot be squeezed and needs a Bond Breaker
- **tar** — yes, so a Bond Breaker is not wasted on a weld that will not break
- **magnetic** — no. Its whole effect happens as it settles; afterwards it is an
  ordinary cube, and a permanent mark would be noise on a pile already carrying
  four others.
- **cryo** — no, and for the opposite reason. `drawFrost` already vanishes the
  instant the cube is struck, so the frost encodes the struck/unstruck *state*
  rather than the material — which is the only thing worth knowing about a
  landed cryo cube. A static glyph would say less.

### Surfaces

| Surface | Treatment |
| --- | --- |
| Bay cube | two-tone + etched glyph at `BAY_GLYPH_ALPHA`, baked into the sprite cache |
| Belt tile / next preview | two-tone cells + corner badge |
| Muzzle ghost | two-tone cells + badge beside the tip, at full opacity |
| Menus, shop, hazard cards | `materialIconHTML` — the same glyph, standalone |

At tile size the two-tone inner square is under 2 units across, so the badge is
what actually identifies the material there. That division of labour is the
design, not a shortfall: two-tone plus face glyph carries the bay, the badge
carries the flat surfaces.

The muzzle badge is deliberately **not** faded by `GHOST_ALPHA`. The ghost is a
preview and reads correctly as a translucent promise; what it is made of is not a
promise, it is the fact being aimed around.

### The belt tile becomes one SVG

`pieceCellsHTML` emitted a 4×4 grid of 16 divs; it now emits one `<svg>`.

The forcing constraint is documented in `app.css` already: a `::before`/`::after`
badge would be a new box inside the belt tile, which `sim/uifit`'s `clipped` and
`offscreen` assertions measure and correctly object to. An SVG child is painted,
not laid out, so the tile keeps its exact one-box footprint. Two-tone cells are
also a rect-in-a-rect rather than 32 nested divs, and the result is sharp at both
the 28px how-to size and the belt's 58px.

The viewBox is 28 units wide — the tile's own CSS px size — so the `gap`
parameter keeps meaning what it always meant and no caller is re-tuned.

## Harness

`sim/systems.ts` asserted material colours were "visually distinct" by comparing
hex **strings**. That check passed for months while rebar sat 2.0 from an L
piece: two different literals, one colour. Set-of-strings is a typo test, not a
distinctness test.

It is replaced with a CIEDE2000 floor of 10, measured across materials **and**
piece colours, since a material is worn by every shape. The threshold is
deliberately modest — "clearly not the same swatch", not "comfortably
distinguishable" — because the search above proved the palette cannot deliver the
latter, and a threshold nothing can pass is a threshold that gets deleted.

Verified to fail before it was trusted: reverting rebar to `#ff8a1f` produces
`FAIL — closest pair rebar/piece-L at dE00 2.0`.

`deltaE00` lives in the harness rather than in `src/` because it is a test
instrument. A palette check that imported its yardstick from the thing it checks
could pass by changing the yardstick.

## Sandbox

Materials arrive through hazard content axes at 7–32% a shipment, from Mark 4 up,
and only if the draft dealt that card. Comparing how six materials read against
each other that way means drafting the right hand and then waiting on a die roll.

The sandbox gains a **Material** row: `Ladder mix` (untouched), one entry per
material (ships nothing else), and **ALL** — an even parade of all six with a
sliver of standard left in, because the question a material's look has to answer
is never "what is this" in isolation but "which of these two is this", and that
needs both on the belt within a few shipments of each other.

`applySandboxMaterials` writes `materialMix` directly rather than going through
the ratchets: the caps there exist to keep a real run honest, and honouring them
would mean the one screen built to look at every material could never fill more
than a third of a queue. It is called only behind the `SANDBOX` gate, so it folds
away in every shippable build.

## What is deliberately not done

- **No new colours.** The search says there are none worth having.
- **No per-cube material mixing.** Unchanged from the original material design.
- **The aura keeps its job and loses its pretence.** It still says "not
  ordinary"; it no longer pretends to say *which*. The slag/tar/magnetic lilac
  convergence stops being a bug once identity lives in shape, so the function is
  untouched.

## Open, for playtest

- Whether `BAY_GLYPH_ALPHA` at 0.62 is right on a packed pile, on a phone.
- Whether rebar's new `#e54c00` still reads as "structural" rather than as
  another danger colour next to volatile.
- Whether the muzzle badge's offset survives the cannon at extreme angles.
