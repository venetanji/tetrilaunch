# Run end modal: fit the landscape phone

**Date:** 2026-07-31
**Status:** approved, not yet implemented

## Why

On the device the game actually targets, the run end modal does not fit. Measured
on the OnePlus 12 at 792x360 CSS px, on a real losing run:

- The panel wants **367px** of content in **321px** of space.
- **Play Again / Menu sit at y=376** in a 360px window — below the fold. The
  primary action of the whole screen is off-screen, reachable only by scrolling
  a modal that does not look scrollable.
- The leaderboard holds **10 rows, 531px of content, in a 64px box** — about
  1.5 rows visible.
- The panel is **560px wide in a 792px viewport**, leaving 29% of the width
  unused while starving for height.

That last line is the actual diagnosis. A single narrow column is the wrong
shape for a landscape phone, where width is abundant and height is scarce.

The crush has a specific mechanism: `#lb-body` is `flex: 1 1 auto; min-height:
64px; overflow-y: auto`, deliberately built to shrink and scroll so fixed chrome
never crowds it out. At 360px it collapses to exactly its floor. The rule works;
it is being asked to absorb an overflow that should not exist.

## Content rule

The end modal shows **the top 5, plus the player's own row appended only when
they placed outside it** — five or six rows, never more. The full board stays on
the Leaderboard screen, one tap away.

This is what removes the scroll rather than shrinking it. Six rows is a number
the layout can guarantee; ten is not, at any column width that also leaves room
for the outcome.

Applied at the **call sites**, not inside `leaderboardRowsHTML`, because the
same builder feeds the full Leaderboard screen. A selection helper is used at
`main.ts:363` (initial render) and `main.ts:828` (post-submit refresh) so the
two agree; `main.ts:287` keeps the full list.

The helper must never emit the player's row twice — the append happens only when
they are absent from the top 5.

## Layout

Two columns, applied at `@media (max-height: 460px)` — the same short-viewport
trigger the menu fix uses. The panel widens from 560px to `min(920px, 94vw)`,
which is 744px on this device.

| Left — the outcome | Right — your standing |
|---|---|
| eyebrow, title, "Made it to Bay N" | name input + Submit |
| score / lines / best | leaderboard (5–6 rows) |
| breakdown line | |
| salvage block + Workshop | |
| **Play Again · Menu** | |

**The primary actions live at the bottom of the left column, not spanning the
full panel width.** A full-width action row would cost 39px out of *both*
columns' budget and push the leaderboard back into scrolling. Bottom-left also
uses slack the left column has and the right column does not, and it lands at
the end of the natural reading order.

### Columns are asymmetric: `1.15fr / 0.85fr`

Not a cosmetic choice. The two columns have opposite sensitivities to width,
measured:

| Column width | Salvage block height |
|---|---|
| 560px | 56px |
| 420px | 85px |
| 380px | 94px |
| 355px | 109px |
| 300px | 168px |

The salvage block nearly doubles as it narrows, because its label, breakdown
line and Workshop button reflow. A leaderboard row does not — it is a single
line of rank/name/lines/score and is comfortable at 330px.

Equal columns would hand 355px to the block that punishes narrowness and 355px
to the one indifferent to it. At 1.15fr/0.85fr (≈400px / 328px) the salvage
block settles near 88px.

## Height budget

Panel client height at 792x360 is **321px**. Section heights are measured, not
estimated; gaps are the panel's existing 8px.

**Left:** 9 (eyebrow) + 17 (title) + 21 (bay line) + 36 (stat row) + 15
(breakdown) + 88 (salvage at ~400px) + 39 (actions) = 225, plus six gaps = **273**.

**Right:** 40 (submit row) + 8 (gap) + six rows at ~41.7 = **298**.

Both clear 321, so nothing scrolls. Rows are trimmed from 47.7px to ~41.7px by
cutting vertical padding from 10px to 7px **under the short-viewport query
only**; font size is unchanged, so this is whitespace, not legibility.

`#lb-body` keeps `overflow-y: auto` as a backstop but takes `min-height: 0` in
this layout, so it can never again be forced into the 64px crush — with six
rows the scroll simply never engages.

## Above 460px tall

Layout is unchanged: single column, which already fits. Only the content rule
applies there, which makes the modal shorter on desktop too. Deliberately not
redesigning a layout that has no problem.

## Testing

`sim/systems.ts` already fit-checks viewports (`phone 800x360 fits $1259/1700`).
Extend that harness to the end modal across the same set:

- Panel `scrollHeight <= clientHeight` — no overflow at any listed viewport.
- Action row bottom `<=` viewport height — the regression that started this.
- Leaderboard `scrollHeight <= clientHeight` — no inner scroll either.

And the selection helper, which is pure and testable without a DOM:

- Player inside the top 5 → exactly 5 rows, no duplicate.
- Player outside → exactly 6 rows, their row last.
- Fewer than 5 entries on the board → all of them, no padding, no crash.
- Board empty → no rows, and the modal still lays out.

## Risks

The height budget has ~48px of slack on the left and ~23px on the right. That is
enough for the measured content but not generous, and two things could consume
it: a longer bay name wrapping the "Made it to Bay N" line, and the `runComplete`
variant, whose salvage breakdown gains a `+N full run` term. Both need measuring
against the real strings rather than the sample used here.

The submit row at ~328px puts a name input and a Submit button side by side; it
may want to stack. To be measured, not assumed — the salvage block above is
exactly the case where assuming would have been wrong.

## Out of scope

- `contractEndModal`, which was rebuilt recently and is a different shape.
- The Leaderboard screen itself, which keeps the full board.
- Desktop and tablet layout.
