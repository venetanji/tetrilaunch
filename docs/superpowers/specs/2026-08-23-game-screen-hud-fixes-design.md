# Game-screen HUD fixes — optical line, Contract readout, material telegraph

Three defects in the in-game HUD, unrelated in cause and grouped only because
they are all things a player sees while a bay is running.

## 1. The notch line's value still sits low

### What is wrong

`.pl-notch` puts a Press Start 2P label ("NOTCHES") beside a JetBrains Mono
tally ("$L×2 · CL · WD×2 …"). tokens.css already carries a correction for the
mismatch — `--pixel-cap-drop: 0.13em`, applied as a `position: relative` lift on
`.pl-notch b` — and the row is still visibly low by roughly half a pixel.

### Why

The existing correction aligns the two runs' **cap bottoms**. That is the wrong
line to align them on, because the two faces do not draw caps of the same
height. Measured unquantized (canvas `actualBoundingBox` at 1000px, where the
integer glyph-box rounding is below the noise floor):

| face                | cap top    | cap bottom | cap height |
| ------------------- | ---------- | ---------- | ---------- |
| Press Start 2P      | −1.000em   | −0.125em   | 0.875em    |
| JetBrains Mono 700  | −0.734em   |  0.000em   | 0.734em    |

(Offsets are from the alphabetic baseline, negative = above it.)

Sit those two on a shared foot and the shorter run's **mass** lands
`(0.875 − 0.734) / 2 = 0.0703em` low. At the row's type sizes that is 0.43px on
a phone (6.12px type) and 0.80px on a tablet (11.42px) — the half pixel the
report names.

Two faces sharing a foot is the right rule when their caps are the same height.
These differ by 19%, and at that gap the eye reads the two blocks' centres, not
their feet.

### The fix

Correct to the **cap centre** instead: `0.125 + 0.0703 = 0.1953em`, shipped as
`0.195em`. The token is renamed `--pixel-optical-drop`, because "cap drop" now
names something the value is no longer measuring.

Applies unchanged to `.pl-queue`, which shares the rule and has the same
label/value pairing.

### CI

`sim/uifit`'s `inkline` assertion asserts cap bottoms agree within 0.5px, so it
fails on the corrected row (−0.74px at roomy density). It changes to compare cap
**centres**, and to derive each face's cap geometry from a **1000px probe scaled
to the element's size** rather than measuring at the element's own 6px. Chrome
quantizes `actualBoundingBoxAscent`/`Descent` to whole device pixels; at 6px
that is ±0.5px of noise, which is the same magnitude as the defect the
assertion exists to catch. The current assertion was reporting 0.22px on a row
that is actually 0.43px out, and would have kept reporting a number under
tolerance whatever the row did.

## 2. The Contract HUD carries three numbers Contracts do not have

### What is wrong

A Contract has no bankroll, no scrap payout and no combo economy, and the plant
readout shows all three anyway. The removal is currently half-done: a *pattern*
Contract drops the "Launch $N" span, a *lines* Contract does not, and both keep
"Combo ×0" and "Scrap 0" for the whole bay.

### The fix

`.pl-meta` does not render at all when `contract` is set. What stays is the
reload bar and the modifiers.

**Modifiers, in Contract mode, means the ability chips** — Bond Breaker,
Demolition, Autoloader — which come off the Contract's own level config and can
genuinely be present. The seven-slot ship rack does **not** stay: `hudOpts`
passes `tiers: {}` for every Contract, so those seven plates can never light up
there. Fixed slots earn their place in a Deep Run, where a refit lights a plate
where the player is already looking; in a Contract they are seven boxes that are
empty by construction.

### Layout consequence

`.hud--contract .plant__body`'s two-column grid exists solely so `.pl-meta` and
`.pl-queue` can share a row. With meta gone the override goes too, and the
contract panel falls back to `.plant__body`'s plain stacked flex. That also
retires a trap the current template carries: it names a `queue` area
unconditionally, and a *lines* Contract renders no `.pl-queue`, so it pays that
row's share of the gap for nothing — the same defect the retired title row left
behind, called out in the stylesheet's own comment.

The compact-density contract override goes with it, along with the comment
justifying its 0.8/1.2 split — a split whose whole premise was fitting a meta
line that no longer exists.

## 3. Previews do not telegraph material

### What is wrong

Two separate failures.

**The belt tiles** render the material's colour (`shipmentColor`) and nothing
else. That is enough to identify a material once you are looking at it and not
enough to make you look: slag is deliberately the only unsaturated thing on the
field and cryo is a pale wash, so both read as "a piece" at a glance.

**The muzzle ghost** is worse — it ignores material outright.
`render.ts`'s `drawLoadedPiece` colours from `PIECE_COLORS[cannon.currentType]`,
so a cryo L is drawn plain orange at the muzzle while the belt tile two inches
away shows it pale blue. `theme.ts`'s `shipmentColor` doc names the muzzle ghost
as one of the three surfaces that must agree; it does not.

### The fix

Ghost colour comes from `shipmentColor(currentType, currentMaterial)`, same as
every other preview.

Both belt tiles and the ghost gain a **pulsing aura** in the material's colour
whenever the shipment is not `standard`. Every non-standard material qualifies,
Magnetic included: the aura's claim is "this shipment is not ordinary", which is
as true of the one material that helps as of the five that hurt, and a player
who has learned to read the pulse as *danger* would misread the one shipment
worth firing early.

Standard shipments get nothing. An aura on everything telegraphs nothing.

DOM side: `pieceCellsHTML` marks the grid `data-material` and publishes the
colour as a custom property; the aura is a `filter: drop-shadow` keyframe on the
grid, so it follows the piece's actual silhouette rather than framing its 4×4
box. Deliberately **not** a pseudo-element — a new box inside `.belt-piece`
would be measured by the harness's `clipped` and `offscreen` assertions, and a
filter is not.

Canvas side: the ghost's baked sprite already keys on colour, so the pulse rides
`GHOST_ALPHA` and the sprite's glow radius; the cache key gains the material.

Both honour `prefers-reduced-motion`, which already silences the belt's other
animations.

## Not in scope

Anything outside the HUD. The bay-clear, refit and draft screens are untouched;
so is every canvas surface except the muzzle ghost's colour and glow.
