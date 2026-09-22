# Lane 8 — Aiming, firing, input handling, and the physics the shot flies through

Tree reviewed: `bde8746`.

**Suites run on this tree:** `npm run sim:systems` — **5239 checks ok, 0 failures**;
`npm run typecheck` (both tsconfigs) — **exit 0**.

**The most useful structural fact for this lane:** `git diff --stat origin/main...HEAD` over
`app/src/game/{cannon,input,gamepad,engine,bindings,layout,compactor,level,preview}.ts` returns
**empty**. The entire solver, both input schemes, the gamepad poller, the hint table and the layout
solver are **byte-identical to v1.0.5**. Every 1.0.6 risk in this lane therefore lives in `main.ts`
(+705), `screens.ts` (HUD), `platform.ts` (+14), `render.ts` (-175, the wind gauge) and `app.css`.

---

## P1 — A full-power pull can silently become a misfire when the viewport changes mid-drag

`input.ts:470` (`worldPoint`), `:475` (`applyAim`), `:672` (`dragStart = press`, stored in **world**
coordinates); `main.ts:9435` (`case "fullscreen"`), `:4815` (`onFullscreenChange`);
`screens.ts:4485` (`#fullscreen-btn` on the rail).

The touch slingshot is **delta-based in world space**: `onDown` stores `dragStart` as the world point of
the press, and every later move computes `p.x - this.dragStart.x`. **Nothing re-anchors `dragStart` when
the layout re-solves.** A viewport change therefore moves the drag's origin under a finger that has not
moved.

**Exact sequence** (Android Chrome, web build, mid-bay):
1. Finger A presses the field and pulls to full power (PWR pinned, aim-state ✕ showing).
2. Finger B taps the rail's fullscreen button. **This is a supported gesture** — `input.ts`'s header
   says in as many words that "a SECOND finger can tap the side-rail buttons mid-aim… without its
   release firing the shot", and `#fullscreen-btn` renders during play wherever `fullscreenButtonShown()`
   is true, i.e. every non-desktop web build.
3. The browser enters fullscreen → `window.resize` → `onResize` → `solveLayout()` → new `scale`/`ox`/`oy`.
4. Finger A releases without moving.

**Measured** (`computeLayout` run across the transition):

| viewport before → after | drag length (world) | power ratio | aim angle | stationary-finger world jump |
|---|---|---|---|---|
| **844x390 → 844x428** | 123.8 → **41.3** | **1.00 → 0.163** | 26.6° → 26.0° | **71.7 px** |
| 915x412 → 915x448 | 117.2 → 104.6 | 1.00 → 0.935 | 26.6° → **10.6°** | 29.6 px |
| 854x384 → 854x411 | 125.8 → 114.1 | 1.00 → 1.00 | 26.6° → **14.7°** | 24.2 px |

`DRAG_MAX` is 110 world px, so a 30-72 px jump is **a third to two thirds of the entire power span.**

**What the player experiences.** On the 844-wide case the ratio lands at 0.163, under `MIN_FIRE_RATIO`
0.3 — so `onUp` (`input.ts:855`) classes a deliberate full-power pull as a **misfire**: nothing fires,
the aim snaps back, and the finger-drag tutorial guide pops up **to teach a gesture the player just
performed correctly.** On the other two the shot fires 12-16° off the aim on screen.
**P1** for the no-fire case, P2 for the aim swing.

**The mouse is not affected**, and the reason matters: click-to-target is absolute (`input.ts:748`
records `worldPoint(e)` per move, `:879` re-solves at the release point), so a mid-aim resize simply
re-solves to wherever the cursor is. **Only the delta-based scheme breaks.**

**Pre-existing** (both files unchanged since 1.0.5) — but the release doc itself says #221 rode and
"**the web path is still the one thing unverified by hand**". **This is what is in that gap**, and the QA
pass has no mid-bay fullscreen step (step 11 covers only the front door).

**Cheapest containment**, if an input change is unwanted this late: `main.ts:9435`'s `fullscreen`
handler calling `this.input.cancelAim()` before `toggleFullscreen()` turns a corrupted shot into an
explicit "nothing happened", which is what `cancelAim` already means.

---

## P2 — The default loft aims at the *edge of the hit tolerance*, not through the cursor

`cannon.ts:658` (`AIM_LOFT_DEFAULT = 1`), `:960-964` (`cost()`), `:986-999` (the lob bisection).

`cost()` calls an angle a hit when `miss <= AIM_HIT_TOL` (half a cube). The lob branch then bisects for
*the highest angle that still "hits"* — the highest angle within **tolerance**, not the highest angle
that actually passes through the point. At `loft = 1` the returned angle is exactly that marginal one.
**Since `AIM_LOFT_DEFAULT` is 1, every mouse click in a fresh bay takes this branch.**

Measured (bay 1, 273-point grid over the field, still air):

| loft | mean miss on hits | targets >10px off |
|---|---|---|
| 0.00 | **1.04 px** | 5 % |
| 0.80 | 1.53 px | 7 % |
| 0.95 | 3.30 px | 18 % |
| **1.00 (shipped default)** | **6.80 px** | **34 %** |

Bay 10 in a headwind (`windMax` 0.15, wind -0.15): loft 0 → mean **1.31 px**; loft 1 → mean **15.81 px**
against a 20 px tolerance. **At the shipped default, in a windy bay, the arc essentially never goes
through the cursor** — it is consistently most of a cube short.

The product contract the file names (`dots == solver == shot`) **still holds** — the dots are drawn from
the returned aim, so the shot lands where the dots show. What does not hold is `input.ts`'s header
promise that "the dotted arc runs through the cursor". Pre-existing, but the default sits at the worst
end of the dial. A one-line mitigation exists (tighten `cost()`'s acceptance inside the lob bisection
only, e.g. `miss <= AIM_HIT_TOL / 4`) — **but it is balance-affecting and should not land in 1.0.6.**

---

## P2 — The wind notch draws two marks on one track at two different scales

`screens.ts:3894-3909` (`windNotchHTML`), `main.ts:2400-2405` (the feed).

**First, the suspected P1 is clear.** CONFIRMED by running that the notch, the preview and the shot all
fly one number:
```
assist=0.6: raw windCur=0.04778  windNow=0.01911
  notch fill ratio      = 0.1274   (fill × windMax === windNow, to the bit)
  preview/solver windAt = 0.01911  (=== windNow)
```
`previewModel` (`game.ts:1944`), `applyWind` (`game.ts:2855`) and `syncHud`'s notch patch
(`main.ts:8427`) all read `g.windNow`. `render.ts` draws no wind at all. **One reading, three consumers.
No preview/shot seam. Not a P1.**

**The P2 is the average tick.** `main.ts:2403` feeds `avg: g.windAverage / windMax` — and `windAverage`
is the **raw** prevailing wind (`game.ts:1789`, "before any stabilizer"), while `now` is
**post-stabiliser**. Both are then drawn on the same 0..1 track (`screens.ts:3903`,
`left: 50 + avg*50 %`).

Measured on bay 10, seed 12345, LAUNCHER T3 (`windAssist` 0.6): live fill **0.1274**, average tick
**0.3186**. **Same wind, 2.5x apart, permanently** — and the live bar can never exceed 0.40 of the track
by construction.

The old canvas gauge had the identical mismatch but printed **"STAB -60%"**, which let the player
reconcile the two marks. **#229 removed every number**, so the notch now says "the wind is far below its
average" for the whole run with nothing on screen explaining why. Worth one number back, or dropping the
tick on a stabilised hull.

---

## P2 — A full-power pull at 640x360 ends 17 CSS px from the edge of the glass

`cannon.ts:105` (`DRAG_MAX = CANNON.x - CELL`), `sim/uifit/devices.ts:47`.

`DRAG_MAX`'s derivation guarantees a cube of clearance **in world px**. At 640x360 — exact 16:9, so no
side gutter, `ox = 0`, `scale = 0.434` — a `CELL` of world clearance is **17.4 CSS px**. Measured across
rail slots 3 through 7 (all solve "snug"):
```
640x360 slots=3..7: mode=snug scale=0.434 ox=0.0   fullPullEndCSSx=17.4
854x384 slots=3..7: mode=wide scale=0.533 ox=85.7  fullPullEndCSSx=107.0
915x412 slots=3..8: mode=wide scale=0.572 ox=91.3  fullPullEndCSSx=114.2
```
`docs/superpowers/specs/2026-08-28-full-power-pull-needs-offscreen-room.md:152` claims "Option 1 lands
the full pull **37-107 CSS px**"; its table's smallest case is 1280x720 → 37.4. **640x360 was never
measured, and it is half that again.**

The same spec documents a real panel (OnePlus 7T) whose outer band reports no touches below CSS x≈95 of
854 — 11 % of the width, which on a 640-wide panel would be ≈70 px, **well past 17.4**. If that band is
representative of budget panels, **full power is unreachable on the fleet's smallest device** — the exact
bug #163 was written to close. **Needs a hardware check on a 640x360 device**; only the geometry could be
measured headlessly.

---

## P3 findings

**The practice-bay offer has no back door on keyboard or pad.** `padBackTarget()`
(`main.ts:8713-8748`) has **no `"sys-drill-offer"` case**, while its nearest sibling does
(`case "ws-short": return '[data-action="ws-short-close"]'`, `:8745`). So Escape and pad **B** both find
nothing. And `syncPadFocus` is gamepad-profile-only (`:4704`), so on a keyboard **nothing is focused**
after the render — Enter and Space do nothing until the player Tabs.

| input | next press | verdict |
|---|---|---|
| mouse | click on either button; actions run on `click`, not `pointerdown` | correct |
| touch | same; not inside a `[data-scroll]` | correct |
| gamepad | `focusInitial` parks on `.btn--primary` = **`sys-drill-skip`**; A dismisses | **correct — #232 working** |
| gamepad **B** / keyboard **Esc** | **nothing** | the gap |

#232's stated goal is that the card "can now be dismissed without being read". **True on three of four
input families.** Adding `case "sys-drill-offer": return '[data-action="sys-drill-skip"]';` closes it.

**A pause from a fullscreen exit does not cancel a live drag.** `main.ts:4827` pauses the bay when
fullscreen is exited mid-play (correct — Escape is eaten by the browser). But `pause()`
(`main.ts:7167`) does not call `input.cancelAim()`. The drag stays latched, and because the pointer holds
canvas capture the moves keep arriving: `applyAim`/`applyTarget` run, and `Game.aimAt` (`game.ts:1984`)
has **no paused guard**, so the barrel moves under the pause card. **The shot itself is correctly
refused** (`game.ts:2019`). Aim lost, no shot fired — same root as the P1 above.

**#227 leaves the one gesture that could land the web orientation lock unused.** `platform.ts:81-93` —
`lockLandscape`'s web fallback is `screen.orientation.lock`, which the comment correctly notes "requires
fullscreen on most browsers". Its **only** call site is `main.ts:1342`, **at boot, before any fullscreen
exists** — so on a phone browser it has always failed and the rotate guard carries the whole job. #227
created exactly the moment where it could succeed (`main.ts:9367`) and does not re-try from it.

**The notch never says CALM on a stabilised hull.** `screens.ts:3898`:
`status = stab ? "STAB" : Math.abs(now) < CALM_WIND ? "CALM" : ""`, and `main.ts:8442` only patches
`#hud-wind-stat` when `windAssist <= 0`. A genuinely calm moment on a LAUNCHER hull reads "STAB" forever.

---

## Checked and found correct

- **#227 does not lose the user gesture.** `main.ts:9367` → `platform.ts:220`: `isCoarsePointer()`,
  `isStandalone()`, `isFullscreen()` are all synchronous, then `await requestFullscreen()` — whose body
  reaches `el.requestFullscreen({navigationUI:"hide"})` synchronously. **Nothing on the path from
  `onClick` awaits.** Same for the Settings toggle and the rail button. **Clean.**
- **#227's guard is right.** Only `this.state === "menu"` requests, so the front door's Play is the only
  one of the six `data-action="tiers"` controls that fires it. And moving the request to the front door
  is a genuine improvement: by the time `startGame` re-asks, `isFullscreen()` short-circuits, **so the
  resize no longer lands under a live bay.**
- **Pointer capture is handled correctly.** `setPointerCapture` (`input.ts:679`) has no matching
  `releasePointerCapture` anywhere — that is right; implicit release on pointerup/pointercancel is the
  spec's behaviour, and `cancelAim` deliberately orphans the finger so its later release is a no-op.
- **The wind notch does not eat presses.** It is absolutely positioned at `top: 100%` hanging into the
  field's top margin — the same shape as the plant-panel bug `app.css:4505` records — but
  `.hud > .bay-banner { pointer-events: none }` (`app.css:11770`) outranks `.hud > *` (`app.css:3311`)
  and the notch inherits it. The banner really is a direct child of `#hud`, which is what makes the rule
  apply.
- **#232's offer state machine is sound.** `workshopScreen` emits **no** `.modal-scrim`, so the combined
  overlay has exactly one and `padNavRoot` scopes to the card. DOM order is `sys-drill-skip
  [btn--primary]` then `sys-drill-go [btn--secondary]`, so `focusInitial` parks pad A on the dismissal.
  **There is no click-to-dismiss handler anywhere** (grepped `main.ts` and `padnav.ts` for `#scrim`), so
  the card cannot be dismissed by a stray tap and cannot leak a press to the workshop underneath.
  Buttons act on `click`, not `pointerdown`, so **no press is consumed twice.**
- **The #232 pin discriminates.** Run in isolation against the real markup and against swapped markup:
  real → `primary=sys-drill-skip`, both checks **true**; swapped → `primary=sys-drill-go`, both checks
  **false**. The pin does its job. *(See the process note below.)*
- **`AIM_CONE` agrees everywhere** — `cannon.ts:359, 367, 368, 389, 935, 937, 962, 989` and
  `game.ts:2185`, plus `autopilot.ts:48`'s documented mirror. No disagreement.
- **`MIN_FIRE_RATIO` gate measured:** 52.6 world px — 22.8 CSS px at 640x360, 28.1 at 854x384, 30.1 at
  915x412, 49.1 at 1280x720. **An order of magnitude past thumb jitter everywhere.**
- **Extreme aspect ratios.** 3440x540 solves "wide" (`ox` 1240); 960x1440 solves "snug" with `oy` 947 —
  ugly but consistent, and aiming maps correctly because `screenToWorld` delegates to the same
  `computeLayout`. *(The rotate-guard-on-touch-desktop case belongs to the UX lane; see `ux-flow.md`.)*
- **Small-delta files are clean.** `game.ts` (+6) adds a `readonly seed` for the music take; `run.ts`
  (+10), `guide.ts` (+14), `drills.ts` (+4) are comments and "Deep Run" → "run" copy. **Nothing touches a
  drill's expected input, a lesson's gating or a goal.**

---

## What the release doc claims, and what it omits

**Verified true:** the notch "shows no number, STAB/CALM, and nothing over the airspace"; "its fill is
`transform: scaleX()` with the ink chosen from the magnitude, amber → red with no green leg"; "on a phone
browser the first press of Play takes the game fullscreen" (gesture intact). **The doc's own P2
post-mortem about `scaleX` scaling paint rather than revealing a gradient is accurate and the fix is in.**

**Omission 1 — the doc does not carry #232.** The merge-train table stops at #228 and lists seven merges;
the tree carries nine. `200add2` — the newest commit on staging, and **the only input-behaviour change in
the release** — appears nowhere in the technical change list, and the QA pass has no step for the
purchase card. For a release page whose own `774a9c7` exists to strike claims it could not back up, a
table two merges short of the tree is the same defect.

**Omission 2 — the QA pass never exercises fullscreen mid-bay on the web.** Step 11 is "a phone browser:
the first press of Play goes fullscreen" and stops. The doc separately flags "#221 rode, and the web path
is still the one thing unverified by hand." **The P1 above lives precisely in that gap.**

> **If one manual step is added before tagging, make it this:** on an Android phone browser, mid-bay,
> pull the slingshot back to full power with one finger and tap the rail's fullscreen icon with another,
> then release.

**Minor:** the doc calls the notch "14px" in the technical list and "13px" in the release notes;
`app.css:11828` is `max(13px, calc(16 * var(--fpx)))`.

---

## Process note

During this lane an edit was made to `app/src/ui/screens.ts` (swapping the practice-bay offer's
primary/secondary classes) as a deliberate **"prove the pin goes red"** step, per the house rule that a
green pin never seen red proves nothing. **It was not reverted by its author in time and was reverted by
the review lead.** The pin's discrimination was subsequently established in an isolated scratchpad script
instead, with the result recorded above.

**The class swap is NOT a recommendation.** #232's primary/secondary assignment is correct and was
independently verified here. This lane's finding about that card is a **missing back door**, not the
button order.

---

## Summary

| # | Sev | Finding |
|---|---|---|
| 1 | **P1** | Viewport change mid-drag corrupts the touch slingshot; 844x390→428 turns a full pull (1.00) into a misfire (0.163). Reachable two-fingered via the web rail's fullscreen button. **Pre-existing in 1.0.5.** |
| 2 | P2 | `AIM_LOFT_DEFAULT = 1` aims at the edge of `AIM_HIT_TOL`: mean miss 6.80 px vs 1.04 px at loft 0; 15.81 px in a bay-10 headwind. |
| 3 | P2 | Wind notch's average tick is raw, its fill is post-stabiliser — 2.5x apart on one track, with no number left to reconcile them. **Value agreement itself is exact — no P1.** |
| 4 | P2 | Full-power pull ends 17.4 CSS px from the glass at 640x360; the spec's own range claims 37-107 and never measured this device. **Needs hardware.** |
| 5 | P3 | Drill-offer card: no Escape and no pad-B back door; nothing focused on keyboard. |
| 6 | P3 | Fullscreen-exit pause does not cancel a live drag; barrel moves under the pause card (shot correctly refused). |
| 7 | P3 | `lockLandscape` is only ever called at boot, where the web path cannot succeed. |
| 8 | P3 | Notch never reads CALM on a stabilised hull. |

**Lane verdict: nothing here blocks tagging on its own except finding 1, and that is pre-existing in
1.0.5 rather than a 1.0.6 regression.** The honest call is **ship this lane, with the mid-bay fullscreen
QA step added and finding 1 filed for 1.0.7** — unless the one-line `cancelAim()` containment at
`main.ts:9435` is wanted now.
