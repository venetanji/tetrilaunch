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
instead of firing: no shot, no cost, aim preserved — the same path as the aim-state
`✕`.

### Where the floor lives

In `InputController.onUp`, **not** `Game.shoot`. Keyboard and gamepad players
start at `speedMin` (ratio 0) and press Fire deliberately; gating the shared path
would break the desktop control scheme to solve a touch-specific problem.

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
CHUTE = { x0: 0, x1: 624, y0: 389, y1: WORLD.height }
```

Derived from `.plant`'s own CSS frame fractions (left 1.67%, width 47.08%,
bottom 2.97%, height 42.96% of the field). `x1 = 624` corroborates
independently: `render.ts`'s `PISTON_BARREL_X` is 616, documented as 8px under
the panel's right edge. Extended to the left wall and the floor so nothing
survives in the 21px lips the panel leaves.

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

**Clamped, because down-left is where the panel is.** `--hint-clear` exists
because the gesture reaches 146px below its anchor and the plant is down there;
`app.css` documents the bug where the loop vanished mid-pull at exactly the
moment it was demonstrating the pull. The same bound applies to a moving origin,
expressed with `min()`/`max()` in CSS so `main.ts` publishes only a raw release
point and the arithmetic stays in one place. The guide is drawn next to the
thumb, sliding up and right only when the thumb sits where the gesture could not
be drawn.

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
follows automatically. **This is what the ui-fit harness asserts against**, so
`test:uifit` must be run across all 13 devices rather than assumed to propagate.

---

## Files

| file | change |
|---|---|
| `game/chute.ts` | new — rect, containment, shred |
| `game/cannon.ts` | `MIN_FIRE_RATIO`; `aimFromDrag` returns its ratio |
| `game/input.ts` | `dragRatio` gate; `onMisfire` callback |
| `game/game.ts` | shred in `update()`; `chargeLostCubes`; `trajectoryStrands` |
| `game/render.ts` | chute maw, hazard glow, red arc and muzzle; `Scene.strandWarning` |
| `lib/audio.ts` | `playExplosion` accepts `"chute"` |
| `main.ts` | misfire cue, guide placement, PWR meter source |
| `ui/screens.ts` | PWR floor mark |
| `styles/app.css` | `drag-hint--at`, correction variant, reduced-motion fallback, `--fpx` travel, `pl-pwr--weak` |
| `sim/systems.ts` | checks below |

## Verification

`sim/systems.ts` drives real `Game` instances headlessly, so these are
falsifiable rather than string matches:

- a cube spawned in the chute is gone the next step, `score` down exactly
  `penaltyPerLostPiece`
- a max-power 45° shot never enters the chute
- `powerRatioForDrag` is below the floor at 85 world px and above it at 86
- a tap (`aimFromDrag(0, 0)`) returns 0, not the previous ratio
- `trajectoryStrands` is true for a low flat aim, false for a good arc
- the chute's right edge equals `PISTON_BARREL_X + 8`

Plus `npm run typecheck`, `npm test`, and `npm run test:uifit` (§5 moves what
that harness measures).
