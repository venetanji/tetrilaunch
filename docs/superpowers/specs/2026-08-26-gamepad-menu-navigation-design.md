# Gamepad menu navigation: the pad reaches everything the keyboard reaches

**Date:** 2026-08-26
**Status:** approved, not yet implemented

## Why

"All functionality is accessible when using a controller" is one of the Steam
Deck Verified input criteria. For the desktop/Steam path this is a gate, not
polish.

Today the pad does exactly three things outside a bay: rebind capture on the
Controls screen, the pause binding, and the Detected chip. Every other press is
read, matched to an action, and dropped on the floor.

The mechanism is one line — `gamepad.ts:96`:

```ts
if (!this.hooks.playing()) continue;
```

`playing()` is `main.ts`'s `state === "playing"`. The menus are DOM buttons
relying on native browser focus, so a *keyboard* user can Tab and Enter through
them; nothing bridges the pad to that focus. There is no D-pad→focus movement,
no A→click, no B→back.

Verified against staging on 2026-08-26: no `padnav` module exists, and nothing
in `gamepad.ts` touches `focus()` or `activeElement`. The behaviour is identical
in Chrome, in the Electron shell, and on the phone with a pad attached — this is
not a shell bug.

## What already works — do not rebuild it

**The poller already runs in every state.** `loop()` re-schedules unconditionally
(`main.ts:3074`) and calls `this.pad.poll(now)` *before* the `state === "playing"`
branch, with a comment saying it polls in every state so the Controls chip and
pause work anywhere. No new loop, no lifecycle changes. Only the `playing()` gate
stands between the pad and the menus.

**Focus restoration already exists.** `main.ts:2634`, `main.ts:2828`, and
`renderSandboxInPlace` at `main.ts:3838` — the last of which restores focus by
the activated element's own `data-` attribute signature and whose comment
explicitly names gamepad users losing their place in a screen.

**Activation is already generic.** `onClick` (`main.ts:3433`) delegates on
`[data-action],[data-game],[data-toggle]`, and `onToggle` (`main.ts:4140`)
writes `settings[key]` and saves. A synthesized click on a focused element needs
no per-control wiring.

## Model: drive native DOM focus, do not invent a cursor

Move `document.activeElement` and synthesize a click. The menus already rely on
focus for the keyboard, so focus rings, screen-reader semantics and the
restoration logic above all keep working unchanged — and "the pad reaches
everything the keyboard reaches" becomes true *by construction* rather than by
enumerating screens.

New module `src/game/padnav.ts`, driven from the existing poll. `gamepad.ts`
stays about gameplay.

## Buttons — fixed, deliberately not rebindable

The same rule the left stick already follows ("a stick is not a button",
`gamepad.ts` header).

| Button | Action |
|---|---|
| D-pad 12/13/14/15, left stick | move focus |
| 0 | activate the focused element |
| 1 | back / close, routed into the existing Escape path |
| 8 (Create/Share; "..." on Deck) | open Controls from anywhere |

`12`–`15` are already `DEFAULT_PAD`'s `aimUp`/`aimDown`/`powerUp`/`powerDown`
(`bindings.ts:108-111`), but those only fire when `playing()`, so the contexts
are disjoint.

**Nav must ignore the rebind table.** That is the point of fixing these: a player
who rebinds the D-pad must not be able to strand themselves in a menu they cannot
exit.

Button `9` is the pause binding — leave it alone.

Button `17` is the DualSense touchpad click and is **not** part of standard
mapping. Do not bind anything real to it: it would work on a DualSense and
silently do nothing on a Deck. (Measured 2026-08-26: the DualSense enumerates as
18 buttons, `mapping: "standard"`, vendor `054c` product `0ce6`.)

## Ordering: DOM order for the first pass

Up/down walk the focusable list; left/right handle tabs and horizontal groups.

Geometric ("nearest focusable in the pressed direction") navigation is
deliberately **rejected for now**. It feels better on the 2-D screens — the
three-column sandbox, the two-column workshop — but it is materially more code
and it can *strand* elements, and reachability is precisely what Deck Verified
tests. DOM order guarantees reachability trivially. Upgrade only if a specific
screen proves bad in the hand.

## Details

- **Auto-repeat** on held directions: ~400ms before the first repeat, ~120ms
  between. The poller has no repeat machinery today.
- **`scrollIntoView({ block: "nearest" })`** on every focus move — several
  screens are scrolling columns.
- **Seed focus** on overlay render when the input profile is `"gamepad"` and
  nothing inside the overlay holds focus. Prefer the primary action where one
  exists.
- **Reuse `DEADZONE`** (0.22) from `gamepad.ts` for stick-as-D-pad.
- **`onCapture` keeps priority.** Rebind capture already runs before action
  dispatch; nav must not swallow the press it is waiting for.

## Copy

The gamepad hint strip must now name the navigation gestures. There is an
existing harness check — *"the gamepad strip does not name a gesture the pad
cannot make"* — and once nav exists the strip **should** name it, so that check
changes rather than merely passing.

`sim/systems.ts` checks are string-based. Prove every new or changed assertion
fails before trusting that it passes.

## Verification

- `npm run typecheck` — runs **both** tsconfigs. The sim config catches `Settings`
  literals in `sim/` that the main config misses; this has bitten before.
- `npm run test`
- `npm run test:uifit` — must report `new 0`. Baseline is 138 at time of writing.
- **On the Deck.** Three things that cannot be checked from Windows: that
  SteamOS reports the built-in controls as `mapping: "standard"`; that the Steam
  overlay does not swallow button 0 before the page sees it; and how name entry
  behaves against the on-screen keyboard.

## Out of scope

- Geometric navigation.
- Rebindable navigation buttons.
- Anything touching gameplay aiming — the pad stick became a pair of rate dials
  in #103.
