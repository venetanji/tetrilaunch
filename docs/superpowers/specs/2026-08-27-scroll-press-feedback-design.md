# Scrolling a shelf plays the confirmation blip

Dragging the refit shelf to read the cards below plays `uiConfirm` — the sound a
committed purchase makes — because the finger happened to land on a card's buy
button on its way past. Nothing is bought. The blip is the only thing that
happens, and it says the opposite of the truth.

Reported from a phone playtest: *"sometimes i hear the blip sound of
confirmation when i'm just scrolling through the refit shop because the first
touch is on a button but my intention is to scroll."*

## The fault

`AppShell.pressFeedback` (`app/src/main.ts`) runs on **pointerdown** and asks
only whether the press landed on an enabled `[data-action]`:

```ts
private pressFeedback(e: PointerEvent): void {
  if (e.button !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  this.actionFeedback(el);   // tapHaptic() + playUiConfirm() on .btn--primary
}
```

That is deliberate, and its comment argues the case well: feedback played on
click "trails the finger by the whole duration of the press, which is exactly
what read as *the sound lags the button*". It then accepts a known cost — "a
press that slides off a button costs a tick and nothing else."

**A scroll is not a press that slid off.** The first millimetre of a scroll is
byte-for-byte a press, so a shelf you must drag to read hands out feedback for
gestures that were never aimed at a button at all. And the shelf is the worst
place for it: `refitScreen`'s `#refit-grid` is `[data-scroll]`, and its cards
carry

```html
<button class="btn btn--primary refit-card__buy" data-action="stage-upgrade" …>
```

`actionFeedback` picks the sound off the variant class — `.btn--primary` blips,
everything else ticks — so the shelf you scroll most is the one surface where
the accident makes the *committing* sound rather than a stray tick.

## What was measured

Reproduced on the Electron shell against `staging` @ `b04d00d`, driving real
trusted touch through CDP `Input.dispatchTouchEvent` at a landscape phone
viewport (844×390, dpr 3, `Emulation.setTouchEmulationEnabled`). Sounds were
identified by patching `AudioBufferSourceNode.prototype.start` to record
`buffer.duration` and matching against decoded fx durations — `uiClick` 0.05s,
`uiConfirm` 0.21s — since the fx names are not observable at the graph.

| Gesture | Sound | Action fired | Side effect |
| --- | --- | --- | --- |
| Touch drag starting on a `[data-action]` inside `[data-scroll]` | `uiClick` | none | list scrolled 0 → 135 |
| Touch press on a `.btn--primary`, dragged off, released | `uiConfirm` | none | `navigator.vibrate([10])` |

The haptic fires on the same path, so a scrolled shelf also buzzes. Both come
out of `actionFeedback`, so both are fixed by the same change.

## Blast radius

Not refit-only. Every `[data-scroll]` container that holds `[data-action]`
children has it — the refit shelf (`#refit-grid`), the workshop shop
(`.workshop__shop`), the guide list (`#guide-list`), the controls pane
(`#controls-grid`), and both leaderboard bodies (`#lb-body`). Refit is simply
where it is loudest, because those are the primary buttons.

## Non-goals

Press-time feedback stays exactly as tuned for **mouse, keyboard and gamepad**,
and for every button that is not inside a scroller. The lag this was built to
avoid is real; the fix must not pay it back anywhere the ambiguity does not
exist. Nothing here changes what the buttons *do*, only when they sound. The
`[data-toggle]` path is already out of scope — `onToggle` deliberately orders
its sound after the settings sync so switching Sound off clicks into silence.

---

## The fix

Suppress press-time feedback only in the ambiguous case, and let the click path
pay it instead. It needs no state, because a touch tap's click carries
`pointerType === "touch"` — already established in this file's `data-game`
branch, which notes the tap "produces `pointerdown pointerType=touch` then
`click pointerType=touch, detail 0`".

In `pressFeedback`, after the disabled check:

```ts
// A touch that starts inside a scroller may be the first millimetre of a
// SCROLL, not a press. Its feedback waits for the click, which only a real
// tap produces — a drag is taken over by the browser and clicks nothing.
if (e.pointerType === "touch" && inScroller(el)) return;
```

In `onClick`'s `[data-action]` branch, mirror it so the deferred press still
sounds on a genuine tap:

```ts
const deferred = (e as PointerEvent).pointerType === "touch" && inScroller(el);
if ((e.detail === 0 && !(e as PointerEvent).pointerType) || deferred) {
  this.actionFeedback(el);
}
```

The two predicates must stay identical, or a tap inside a scroller either goes
silent or blips twice. Worth a comment on each pointing at the other.

### One open call: what counts as a scroller

`[data-scroll]` is the documented opt-in and `sim/uifit`'s `scrollers`
assertion enforces its allowlist, so `el.closest("[data-scroll]")` is the cheap
answer and covers every screen listed above. But `app/src/styles/app.css` also
names fallback scrollers that take a drag — `.modal-scrim`, `.modal`,
`.draft__body` — and the horizontal ones (`.pl-mods`, `.guide__tabs`) scroll on
a gesture that starts on a button just as readily.

Preference: walk ancestors and test **real** scrollability rather than hardcode
a class list, so a new scroller cannot reintroduce this by forgetting to be on
it:

```ts
function inScroller(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    const yes = (o: string) => o === "auto" || o === "scroll";
    if (yes(s.overflowY) && n.scrollHeight > n.clientHeight) return true;
    if (yes(s.overflowX) && n.scrollWidth > n.clientWidth) return true;
  }
  return false;
}
```

This runs once per touch press, on an ancestor chain a handful of nodes deep, so
the `getComputedStyle` cost is not worth caching. If the reviewer prefers the
attribute test, `closest("[data-scroll]")` is an acceptable narrower fix — it
solves the reported bug and leaves the fallback scrollers.

## Verification

The harness cannot see this: `sim/systems.ts` is string-only and `sim/uifit`
measures pixels, and neither dispatches pointer events. Verify by driving real
touch, the way it was diagnosed:

1. Load the build, unlock audio with one click, then patch
   `AudioBufferSourceNode.prototype.start` to record `buffer.duration`.
2. At a landscape phone viewport with touch emulation on, `touchStart` on a
   `[data-action]` inside a scroller, `touchMove` ~150px, `touchEnd`.
3. Expect: **no sound**, no action, and the container scrolled.
4. Then `touchStart`/`touchEnd` on the same button without moving. Expect
   exactly one `actionFeedback` — 0.21s on a primary, 0.05s otherwise.

Case 4 is the one that catches a mismatched predicate pair, so do not skip it.

### Traps

- Run **`npm run typecheck`**, not `npx tsc --noEmit`. The latter misses
  `tsconfig.sim.json`, and a `Settings`-shaped or shared-type change that
  compiles for the app will still fail the build in `sim/systems.ts` and
  `sim/uifit/fixtures.ts`.
- PRs target **`staging`** (`gh pr create --base staging`); `gh` defaults to
  `main`, which is wrong for this repo.
- Never `git stash` here — the stash ref is shared across worktrees.
