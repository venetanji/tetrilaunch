# Gesture misfire prevention

Touch aiming fires shots the player never meant, and when it does the failure is
invisible. Three faults compound into one bad moment, and each needs its own fix.

## The faults

**A tap is a shot.** `InputController.onUp` fires unconditionally. A stray touch
never moves far enough to reach `aimFromDrag`'s 4px floor, so the cannon keeps
its previous aim and power and launches on that. Full launch cost, zero intent.

**The preview is hidden exactly where it matters.** The trajectory arc is drawn
on the canvas; the recycling-plant panel is DOM at `z-index: 6` over it. The
aim-through fade is scoped to `.hud--aiming[data-coach]`, so outside the
tutorial a low or downward aim's preview simply stops at the panel's top edge.

**The failure is silent and triply charged.** A short shot settles behind the
panel, is marked lost by `markLostPieces` (anything settling left of world
x≈780), blinks for 1.4s *behind the panel*, then decays — charging
`penaltyPerLostPiece` and spawning its `−$` toast **also behind the panel**.
Throughout, it inflates the congestion tier, because `pileTier` counts cubes
anywhere on the field. Three punishments, no feedback.

## Non-goals

Nothing here changes the aim model, the slingshot reversal, the power curve, or
the launch economy. `Game.shoot` is not gated — see "Where the floor lives".

---

## 1. Power floor

`MIN_FIRE_RATIO = 0.30`. A release producing less power ratio than this cancels
instead of firing: no shot, no cost, and the aim **restored to what it was
before the finger landed**.

Restoring rather than merely not-firing, because a graze that travels 20px still
moves the barrel. Leaving the cannon where the graze stopped makes the accident
free of ammo and expensive in setup, which is half a fix. The aim-state `✕` is
deliberately different: there the player pulled, watched the arc, and chose to
stand down — that aim is one they built, and snapping it back would undo work
they meant to do.

### Where the floor lives

In `InputController.onUp`, **not** `Game.shoot`. Keyboard and gamepad players
start at `speedMin` (ratio 0) and press Fire deliberately; gating the shared path
would break the desktop control scheme to solve a touch-specific problem.

**Not applied to a mouse** (`pointerType !== "mouse"`). The accident being
prevented is a thumb grazing glass; a click is a deliberate act at a chosen
pixel. Gating it would break click-to-fire for a desktop player aiming on the
keyboard. Same line app.css already draws by hiding the drag hint under
`pointer: fine`. Pen and unknown pointer types stay gated — both land on touch
hardware.

### Reading the drag, not the cannon

At release the controller must not read `cannon.powerRatio`. `aimFromDrag`
early-returns under 4px without touching `power`, so a tap reads whatever the
last real drag left behind — the exact stale value that makes a tap dangerous.

Instead `aimFromDrag` returns the ratio it applied (0 on both early-out paths),
and `InputController` stores it in `dragRatio`, zeroed in `onDown`. A tap never
calls `applyAim`, so it reads 0 and cancels. One source for the gate and the
launch, so they cannot disagree.

The ratio is read from the release position, not the furthest point reached:
pulling back and returning to the origin before lifting is a cancel, correctly.

### Scale

0.30 maps to `DRAG_MIN + 0.30 × (DRAG_MAX − DRAG_MIN)` = 85.6 world px, which
scales with the field: ≈43 CSS px on an 800×360 phone viewport.

### The floor and the warning are not redundant

A 30%-power flat shot still lands around world x≈454, inside the plant. The
floor proves *intent*; the warning in §2 predicts *outcome*. Both are needed.

---

## 2. Strand warning

Computed once inside `updateTrajectory()` and stored as `Game.trajectoryStrands`,
not as a per-frame getter — the trajectory only changes when the aim does.

True when the predicted arc enters the chute rect, **or** when it lands left of
`markLostPieces`' own cutoff, `compactor.leftX + width/2 − CELL/2` (world x 780
at stock). Deriving from that same expression means the warning and the
punishment can never drift apart.

Guarded so an arc still airborne at the 140-step prediction limit is not treated
as a landing.

Shown three ways, all on the canvas so the panel cannot hide them:

- trajectory dots go danger-red
- the muzzle ring tints red
- the chute mouth's hazard glow lights, rising **above** y=389 into open canvas

Angle alone was rejected: a shallow −10° at full power lands around x≈830, a
perfectly good flat shot, while a low-power level shot at 0° lands at x≈350 and
is a total loss. Angle would cry wolf on the first and stay silent on the second.

---

## 3. The chute

The plant panel becomes part of the room's physics. Cubes entering it are
destroyed immediately, with an explosion and a visible `−$`.

### Rect

```
CHUTE          = { x0: 0, x1: 624, y0: 389, y1: WORLD.height }   // the MOUTH
CHUTE_THROAT_Y = 620                                             // the GRINDER — DELETED, see below
```

Derived from `.plant`'s own CSS frame fractions (left 1.67%, width 47.08%,
bottom 2.97%, height 42.96% of the field). `render.ts`'s `PISTON_BARREL_X` now
*derives* from `CHUTE.x1 - 8` rather than restating 616, so the two cannot
drift. Extended to the left wall and the floor so nothing survives in the 21px
lips the panel leaves.

### A hopper, not a wall — REVERTED (2026-08-24)

> **The shipped model is the opposite of this section: a wall, not a hopper.**
> `CHUTE_THROAT_Y` is deleted and `CHUTE_SURFACE_Y = CHUTE.y0` stands in its
> place — the machine's surface IS its mouth, and anything that touches it is
> taken there. What reversed the call was not new physics but a frame-by-frame
> trace: cargo aimed into the maw entered at (223, 390) and then travelled DOWN
> AND ACROSS the whole body of the machine for a quarter of a second — (318,
> 417), (369, 500), (416, 599) — before two of its four cubes reached the
> grinder, with the survivors carrying on right and out the far side. Behind an
> opaque panel that is merely invisible; through the aim-through state, which is
> exactly when the player is watching, it is cargo tunnelling through solid
> machinery. Nothing about the machine says it can be flown through, so the
> fly-through went, and the skim corridor with it — scraping the roof would
> otherwise have been a cheap way to shear the bonds off a shipment. `chute.ts`'s
> header carries the full reasoning. What follows is the record of the design
> that was reversed, including the measurement that chose 620.

**Claiming the whole footprint from the mouth down was wrong, and the sim caught
it.** That takes the AIRSPACE over the machine as well as the floor of it, and
shots cross that airspace on their way somewhere else: a full-power delivery at
−10° passes (519, 398) and carries on out over the bay. Measured against real
physics, a full-depth maw destroyed **all four cubes of that shipment in
flight** — deleting every downward shot in the game to catch fumbles, which is a
far bigger change than the one being asked for.

So the grinder sits deep inside. Measured on the live arc across the full aim
cone at four power levels:

| | |
|---|---|
| deepest any **useful** shot reaches inside the footprint | 543 (−20°, max power) |
| shallowest cargo that **comes to rest** behind the panel | 698 (on the floor) |

620 sits between them with ~77px either way. The margin only widens with the
LAUNCHER track (flatter arcs); nothing narrows it, since bay gravity is a
constant 1 everywhere.

The invariant this buys: **the chute may only ever collect cargo that has come
to rest somewhere unreachable, never intercept something still in flight.**

The mouth is still drawn at `CHUTE.y0` and every cue still fires from there.
That is not a fudge — it is what the machine looks like. Cargo drops in at the
top, the grinder is deep inside, and the quarter second between the two is the
piece falling down the throat.

### Narrowed to the press's reach

Bay Extension T3 opens the compactor to 18 cells, walking its open stop to
x 547 — **left of the panel's edge**. A fixed maw would grind cargo the press
could still have reached, silently charging the player two cells of the upgrade
they just bought. `chuteRightEdge(strandCutoffX)` clamps to
`min(CHUTE.x1, strandCutoffX)`, which makes the chute mean exactly what
`markLostPieces` already means: *the floor the press can never reach*.
Level-derived, not device-derived, so seed determinism is untouched.

`strandCutoffX` now lives on `Compactor`. Its three readers — `markLostPieces`
decays across it, `Game` warns on it, `chute` sizes its maw to it — must agree
exactly; a warning drawn against one number with a penalty charged against
another is a game lying about its own rules.

### Authored constant, never measured from the DOM

Physics that varied with HUD size would break seed determinism — the sim bots,
shared seeds, and telemetry all assume one seed plays the same everywhere.
Contract mode's `.plant { min-height: 0 }` and the tutorial's taller panel would
otherwise each get different physics. So the chute is **drawn on the canvas** as
part of the room, with the DOM panel mounted inside it.

### Detection

Per-cube AABB containment, checked in `update()` immediately before
`markLostPieces`. No tunnelling risk: max power is 28 px/step against a 310px-tall
zone.

Cubes shred individually as they cross the plane rather than the whole piece
going at once — no constraint-graph walk, and it reads as the shipment being fed
into the shredder, which is what a recycling plant does. Pieces already shatter
into loose cubes everywhere else in this game.

### Cost

Unchanged from today: `combo = 0`, `lostTotal`, `penaltyPerLostPiece`,
`onPieceLost`. The existing lost-cube accounting is factored into a private
`chargeLostCubes(n, now)` that both the blink path and the chute call, so the two
cannot drift.

The `penalty` FX spawns at the chute's **top lip**, above the panel, instead of
at the cube's buried position.

The explosion reuses the existing `explosion` FxEvent at a smaller radius, plus
`throwChunks` for debris. `onExplosion` gains a `"chute"` kind — a rate and gain
variant of the existing `explosion` sample, so **no new audio asset** is needed.

Bombs entering the chute are consumed with the same FX and no penalty: they are
consumables, not cargo.

### Net balance effect: slightly kinder

Same launch cost, same decay penalty. The cube stops inflating the congestion
tier ~1.4s plus settle time earlier, and the rescue window it loses was already
unreachable — `markLostPieces` un-marks a cube that returns right of x=780, and
the chute ends at 624.

---

## 4. The misfire cue

No text. Three layers, cheapest first:

| layer | when | what |
|---|---|---|
| PWR meter red below its floor mark | live, during the drag | the rule is visible *before* release |
| `playFx("pieceLost")`, quiet and pitched up | every below-floor release | "that didn't fire" |
| the drag-hint guide at the thumb | rate-limited to once per 4s | "pull down-left, this far" |

### The guide is the existing `.drag-hint`

Its `hint-dot` keyframes already translate `(-35px, +56px)` — down and left, the
gesture being taught. Nothing new is authored; it is relocated.

**Dynamic anchor.** A `drag-hint--at` modifier switches `left`/`top` from the
fixed field-relative `calc()`s to `--hint-ax` / `--hint-ay`, which `main.ts`
writes from the release point. The onboarding path is untouched.

**Clamped, because down-left is where the panel is** — but *conditionally*, and
in JS (`fitGuideToField`). The gesture reaches `--hint-reach` below its anchor
and travels left, so the panel blocks it; `app.css` documents the bug where the
loop vanished mid-pull at exactly the moment it was demonstrating the pull.

A pure-CSS clamp was tried first and is wrong: CSS cannot ask where the anchor
is horizontally, so it hauled every right-hand fumble ~200px up the screen to
dodge a panel it was never over. JS measures the panel's **real** box, which
also means the tutorial's taller panel and a Contract's shorter one need no
special case — each is simply a different rect. Horizontal bounds still always
apply (the pull travels left, and must not leave the field).

`--hint-reach` and `--hint-pull-x` are read back out of the stylesheet, so the
clamp and the animation cannot disagree about how far the finger travels.

One specificity trap: `.hud[data-coach] .drag-hint` outranks a lone
`.drag-hint--at`, so during the tutorial the guide silently ignored the thumb.
That rule is now scoped `:not(.drag-hint--at)`.

**Plays once, faster.** `--hint-correct-dur: 1600ms`, one iteration. The
onboarding loop's 3400ms `infinite` is right for an invitation and wrong for a
correction. Suppressed entirely while the onboarding hint is on screen.

**Reduced motion gets a real fallback.** Today's rule is `animation: none;
opacity: 0`, which would show the misfire cue as nothing at all. Instead: the arc
static at `stroke-dashoffset: 0` with the dot parked at its pulled end, held
~1.2s then faded. Same diagram, zero motion.

### The PWR meter stops lying

`syncHud` reads `cannon.powerRatio`, which during a tap is the stale previous
value. While a drag is live the meter reads `InputController.liveDragRatio`
instead, so it shows what a release would actually do — and carries
`pl-pwr--weak` below the floor.

---

## 5. Hint travel rescaled to `--fpx`

The hint's travel is a fixed 66 CSS px (`√(35² + 56²)`). The floor is 85.6
**world** px, i.e. `85.6 × --fpx`. They scale differently:

| viewport | field scale | floor (CSS px) | hint travel | clears floor? |
|---|---|---|---|---|
| 800×360 phone | 0.50 | 43 | 66 | yes, 1.5× |
| 1024×768 tablet | 0.80 | 68 | 66 | **no — 0.97×** |

On a tablet the guide would demonstrate a pull that gets rejected as a misfire.
This is also a pre-existing inconsistency: the same animation teaches 132 world
px of pull on a phone and 82 on a tablet.

Fix: express the travel in `--fpx` at 150 world px (≈0.63 power ratio — a healthy
shot, not a marginal one), decomposed on the existing direction as
`translate(calc(-79 * var(--fpx)), calc(127 * var(--fpx)))`. On a phone that is
39/63 CSS px, visually near-identical to today's 35/56.

`--hint-reach` becomes a `calc()` instead of the literal `146px`; `--hint-clear`
follows automatically.

### The assertion guarding this was dead

`sim/uifit`'s `draghint` check reads the reach back with
`parseFloat(getComputedStyle(...).getPropertyValue("--hint-reach"))`. An
unregistered custom property hands back its literal text — fine while it was
`146px`, `NaN` the moment it became a `calc()`, and every comparison against
`NaN` is false. The check would have gone quietly green.

It was **already** partly dead on staging for an unrelated reason (the reach
cancels out of `dips = hb.top + reach − pb.top`, because the anchor derives from
the same value), which is why a deliberately absurd `900px` reach passes there
too. That is a pre-existing harness bug and is **not** fixed here.

What is fixed: `--hint-reach`, `--hint-pull-x` and `--hint-pull-y` are registered
with `@property { syntax: "<length>" }` so they compute to real lengths. The
assertion is live again — verified by pushing the hint down onto the panel and
watching it fire — and `main.ts` can read the same values back for the clamp.
`sim/uifit/harness.ts` also publishes `--fscale`, which it otherwise lacked, so
fixtures no longer measure one fixed scale on all 13 devices.

---

## Files

| file | change |
|---|---|
| `game/chute.ts` | new — mouth/throat, containment, shred, `pathStrands` |
| `game/cannon.ts` | `MIN_FIRE_RATIO`, `powerRatioForDrag`; `aimFromDrag` returns its ratio |
| `game/compactor.ts` | `strandCutoffX` getter — one home for the three readers |
| `game/input.ts` | `dragRatio` gate, aim restore, `onMisfire` callback |
| `game/game.ts` | shred in `update()`; `chargeLostCubes`; `trajectoryStrands` |
| `game/lineClear.ts` | `markLostPieces` reads the compactor's cutoff |
| `game/render.ts` | chute maw, hazard glow, red arc, strand ring; `Scene.strandWarning` |
| `lib/audio.ts` | `playExplosion` accepts `"chute"` |
| `main.ts` | misfire cue, `fitGuideToField`, PWR meter source, `--fscale` |
| `ui/screens.ts` | `#hud-pwr` handle |
| `styles/app.css` | `@property` registrations, `drag-hint--at`, correction variant, reduced-motion fallback, `--fscale` travel, `pl-pwr--weak` + floor notch |
| `sim/uifit/harness.ts` | publishes `--fscale` |
| `sim/systems.ts` | checks below |

## Verification

`sim/systems.ts` drives real `Game` instances headlessly, so these are
falsifiable rather than string matches. **Every one was confirmed to fail when
its subject was broken**, not merely to pass:

| check | proven by |
|---|---|
| cargo in the chute is gone within half a second, costs launch + penalty, breaks combo | disabling `shredChute` → 3 fail |
| the grinder clears the deepest useful arc; a flat delivery clears the footprint intact | throat back at the mouth → 5 fail (`0 of 4` survive) |
| a T3 bay's maw gives ground back to the press | removing the clamp → 1 fail |
| the floor sits inside a thumb's reach; a tap reports 0, not the previous pull | floor → 0.9, and reinstating the stale-power read → fail |
| a steep weak aim strands; the warning reads the compactor's own cutoff | stubbing `pathStrands`, detaching the cutoff → fail |
| the chute's mouth and lip match `.plant`'s CSS fractions | perturbing **either side** → fail |

The second row is superseded in part. Its proof method is unreproducible — "the
throat back at the mouth" is where the throat now IS, and `CHUTE_THROAT_Y` went
with the hopper when it was reverted on 2026-08-24 — so those five failures
cannot be re-provoked. Of the row's two claims, only the flat-delivery half
changed, and it was INVERTED rather than deleted: `sim/systems.ts:5944-5973` now
asserts that an aim which clips the machine IS warned against, that nothing comes
out the far side, and that the whole shipment is taken. The deepest-useful-arc
half still stands, as "a good shot never enters the chute" / "...and is still on
the field" (`sim/systems.ts:5940-5941`). The other five rows hold as written.

The last one parses `app.css` — necessarily a string check, since this harness
has no browser. It catches the two numbers drifting apart, which is the failure
that matters; the rendered fit is `sim/uifit`'s job.

Also run: `npm run typecheck`, `npm test`, `npm run build`, and `test:uifit` on
**both** engines (chromium 0 new, webkit 0 new against its 18 baselined —
identical to staging).

Behaviour confirmed live in the browser, not just in the harness: tap and 20px
graze fire nothing and restore the aim, a 120px drag fires, a **mouse** tap still
fires, the guide anchors exactly at the thumb in clear air and lifts only when
the panel is genuinely under it, and reduced motion renders the still diagram
(dot parked at the end of the pull, full trail, no animation).
