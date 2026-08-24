# Contract plant panel — restore the footprint, and give it something to hold

The Contract HUD was cleared of Deep Run furniture in `c66c12c` and got shorter
as a result. This restores the panel's footprint and fills it with the three
facts a Contract actually has and currently throws away.

## What is wrong

Measured in the running app at 792x360 CSS px, compact density, with the coach
dismissed:

| state            | plant height | top edge | rows                                     |
| ---------------- | ------------ | -------- | ---------------------------------------- |
| Deep Run, bay 1  | 154.6px      | y=194.7  | read, reload, meta, notch, mods          |
| Pattern Contract | 86.1px       | y=263.2  | read, reload, queue                      |
| Lines Contract   | 69.1px       | y=280.2  | read, reload                             |

154.6px is `0.4296 * --field-h`, the mockup's footprint and the box the `plant`
harness assertion holds the panel to. A Contract renders 45-56% of it.

The panel is BOTTOM-anchored, so a shorter panel does not sit lower in the same
box — its top edge moves. Two Contracts on the same board therefore put the
panel's top edge 17px apart from each other, and 68-85px from where a Deep Run
puts it. The player's eye has to re-find the readout per mode, and per card
within a mode.

## Why it is like this

`app.css`:

```css
.hud--contract .plant { min-height: 0; }
```

The comment above it is right about the problem it solved. `.plant__body` used
`justify-content: space-between`, which is correct for a Deep Run's five rows
and wrong for a Contract's two or three — it pushed the manifest to the floor of
the panel and left a hand's width of nothing above it. Releasing the floor let
the panel hug its content, and the explicit gap
(`.hud.hud--contract .plant__body { gap: max(8px, calc(18 * var(--fpx))) }`)
replaced the air `space-between` had been distributing.

What that fix did not consider is that `space-between` was not the only way to
keep three rows from stranding. Top-aligning them does the same job and keeps
the footprint.

## The fix

### 1. Height

```css
/* delete */
.hud--contract .plant { min-height: 0; }

/* add */
.hud--contract .plant__body { justify-content: flex-start; }
```

The explicit gap rule stays — it is what puts even air between the rows now that
`space-between` is not distributing any. The rows hug the top of the panel with
a stated rhythm; whatever is left over is one band of air at the bottom rather
than three rows pinned to two extremes.

`min-height` returns to the shared `.plant` value, so there is one number, not a
Deep Run number and a Contract number to keep in sync.

`justify-content` reaches the Contract panel at every density. Deep Run's
`.plant__body` becomes a named-area grid at compact, where `justify-content`
would be inert — but a Contract already opts out of that grid
(`[data-density="compact"] .hud--contract .plant__body { display: flex }`,
because the template names `meta` and `mods` rows a Contract does not render;
`notch` was the second of that pair until the `Bay` row above took the class).
It is a flex column at every density, which is the whole reason one rule
suffices. Nothing should re-template it as a grid to accommodate the new rows.

The `plant` assertion in `sim/uifit/run.ts` WAS a one-sided upper bound:

```js
if (h > design + 1) out.plant.push(...)
```

A panel restored to exactly `0.4296 * --field-h` passes that unchanged — which
is also the reason it never caught the shrink. Nothing held the other side, so a
regression re-shrinking the Contract panel would have passed on all 13 devices,
and `sim/systems.ts` cannot see CSS at all. The assertion is two-sided now: the
lower bound reads the unconditional `0.4296` rather than the `design` variable,
which is `0.52 * fh` on a coached screen and would otherwise demand a panel 21%
taller than the stylesheet asks for. Proven to fire on all 13 devices when
`min-height: 0` is put back.

### 2. `Lost` — a third readout column, lines Contracts only

`.pl-read` is a three-column row: the funds/lines block takes the slack, and two
fixed `.pl-stat` columns sit beside it. A Deep Run fills the third with Time. A
Contract has no clock (`levelForContract` sets `timeLimitSec = 0`), so
`timeBlock` renders empty and the column is dead space.

Lines Contracts fill it with `Lost` — `Game.lostTotal`, cubes that bounced out
before the compactor. It is the quiet drain on a launch budget: `launchesFor`
prices the bay against `PLANNING_EFFICIENCY`, and every cube off the side is the
player spending that margin. Nothing on screen says so today.

Costs no rows — it is a column in a row that already renders. It is not free,
though, and the panel should not pretend it is: with no clock, `.pl-funds`
(`flex: 1 1 auto`) currently absorbs the clock's width and spends it on a longer
goal bar.

Two figures, because they are easy to confuse. The bar's real loss is about
**36px** at the tightest phone in the matrix — the column itself (~30px) plus
`.pl-read`'s own gap, which three items pay twice where two paid once. What is
left over is about **18px**: the margin by which the Contract's bar still beats
a Deep Run's, and the gap cancels out of that comparison because both sides are
three-item rows. `LOST` is narrower than `TIME` — same 4-glyph label, half the
value width.

No `.pl-stat--danger` treatment. That class means "you are about to run out of
the thing that lets you keep playing", and it fires on a threshold — three
launches, twenty seconds. Cubes lost has no such threshold: the budget already
priced some waste in, so there is no count at which the correct play changes.
It is a plain column.

#### Why not a margin readout, and why pattern Contracts get nothing here

`cubesAvailable - cubesRequired` is already computed, already monotone, and
looks like the obvious candidate. It is not, because `SPARE_SHIPMENTS = 0` is
the design: a pattern queue is exactly the cubes the goal needs. The margin is
therefore 0 on the first frame of every pattern bay, and one stranded cube takes
it negative, at which point `objectiveUnreachable` ends the bay. A readout that
shows 0 for the whole attempt and then the attempt is over is not a gauge.

`Lost` is no better there, and the timings say why it is worse than it looks: it
never even reaches 1. `cubesAvailable` stops counting a cube the moment it
starts BLINKING, not when it is removed, so `objectiveUnreachable` fires on the
mark. `lostTotal` increments `BLINK_MS` = 1400ms later, and the bay is called
after `UNREACHABLE_GRACE_STEPS` ≈ 1000ms — about 400ms before the count would
tick. So pattern Contracts keep two columns. They are the kind that renders
`.pl-queue`, so each kind carries one row the other does not, and both land in
the same box.

On a LINES Contract the same number is genuinely live: `pieceQueue` is null, so
`piecesLeft` is Infinity, `cubesAvailable` is Infinity and `objectiveUnreachable`
can never fire. The bay runs to its launch budget and accumulates losses the
whole way — a two-digit count is routine against a ~20-launch budget at the
modelled waste rate.

And it is the only acknowledgement a lost cube gets in Contract mode at all:
`levelForContract` sets `penaltyPerLostPiece = 0`, and the "−$" toast is skipped
when nothing was deducted, so today a cube goes off the deck in silence.

### 3. `Bay` — the Contract's conditions, one dense line

A Contract's complications are generated, priced against a difficulty budget,
and written to `contract.brief`: `crosswind · cryo shipments`,
`tight launch budget`, `micro dominoes`, or `clean bay` when the budget bought
nothing. The board card shows them. The moment the bay starts they are gone.

**Not `brief` verbatim.** A pattern Contract's brief is
`` `${queue.length} shipments · ${tail}` `` — and the shipment count is already
the `Shipments` column, with the exact set already on the manifest row. Putting
the brief in the panel would say it a third time.

So the conditions are extracted into their own `Contract.conditions` field and
`brief` is redefined in terms of it:

- lines: `conditions` is the notes join (or `clean bay`); `brief` is identical,
  so nothing on the card changes.
- pattern: `conditions` is the variant tail alone — `all I, no waste`,
  `rebar, nothing shatters, no waste`, `8-cell lines, no waste` — and
  `brief` becomes `` `${n} · ${conditions}` ``, byte-identical to what
  `patternBrief` returns today for every variant.

One source of truth, no string surgery at the call site, and the card is
unchanged by construction. `sim/systems.ts` pins the equivalence.

These are the exact analogue of a Deep Run's notches — the axes this bay is
running on, which the player did not choose and has to play around. `.pl-notch`
is already that row: label plus a dense mono tally, ~8px at compact, rendered on
every Deep Run bay including the first, where it reads "—" rather than appearing
mid-run and shifting every row above it.

Contract mode renders the same row shape with the label `Bay` and the
conditions as its value.

The row is never empty, so it is never a different height between one card and
the next — but not because of the `clean bay` fallback, which is unreachable.
`budgetForTier` never returns below 2, `wind` and `tightLaunches` cost 2 each
and are the two complications in the loop with no option-specific `continue`
gate (only `material` and `micro` have one), and `maxComplications` is always at
least 1, so `notes` always receives an entry. Measured at 0
occurrences in 72,000 generated lines Contracts. The fallback stays as a guard
against a future budget or gating change; the row's constant height rests on
the generator, not on it. The Bay row cannot render the word "clean" today.

**Not the Build row.** `.pl-mods` is the wrong home for this twice over: it is
`display: none` at compact density, and in a Contract it never renders at all —
`plates || bondChip || demoChip` is always false, because `levelForContract`
builds from `makeBaseLevel`, which zeroes `bondBreakerCharges`, `bombCharges`
and `autoLaunchMs`, and `hudOpts` hands a Contract `tiers: {}`. A conditions row
placed there would be invisible on every phone.

### 4. `Tier` — why this bay is worth playing

`tierProgressFor(meta)` already produces the shape the Contracts board header
uses: tier, contracts cleared out of needed, and the salvage one first clear
banks. The board states the deal and then the bay forgets it.

Rendered as `.pl-tier`, a new class styled off `.pl-notch` and sharing its
`--pixel-optical-drop` correction: `Tier 1 · 0/3 · ♻ 15`. Static for the length
of a bay, which is why it is a line and not a readout column.

## Resulting panel

Both kinds, top-aligned in the restored 154.6px box:

| row              | lines | pattern |
| ---------------- | ----- | ------- |
| `.pl-read`       | Lines/Goal · Launches · Lost | Lines/Goal · Shipments |
| `.pl-load`       | yes   | yes     |
| `.pl-queue`      | —     | yes     |
| `.pl-notch` Bay  | yes   | yes     |
| `.pl-tier`       | yes   | yes     |

Measured in the running app at 792x360 compact once all three rows had landed
and before the height rule was restored: a lines Contract stands at 108.1px and
a pattern one at 125.1px, against the Deep Run's 154.6px. The estimate above was
110px for the shorter kind, so the arithmetic held.

The remainder is deliberate air at the bottom of a panel whose top edge no
longer moves. Before the restoration the three states put that edge at y=241.2
(lines), y=224.2 (pattern) and y=194.7 (run) — 17px apart between two Contracts
on the SAME board, and 46px between a Contract and a run.

One row came in taller than estimated: `.pl-tier` measures 13px against the 8px
a `.pl-notch`-shaped row costs, because the salvage glyph is a hard 9px against
6px text. That is the largest single contributor to the two kinds' remaining
difference and the reason the row needed `align-items: center` rather than
`baseline` — see the note on `.pl-tier b`.

## Touchpoints

- `app/src/styles/app.css` — the two height rules; `.pl-tier` styled off
  `.pl-notch`, sharing its `--pixel-optical-drop` correction.
- `app/src/game/contracts.ts` — `Contract.conditions`, and `brief` redefined in
  terms of it.
- `app/src/ui/screens.ts` — `hudHTML`: the third `.pl-read` column on the lines
  branch, the `Bay` row, the `Tier` row. `hudHTML`'s `contract` option gains
  `lost`, `conditions` and `progress` fields.
- `app/src/main.ts` — `hudOpts` supplies the three new values; `syncHud` writes
  `#hud-lost` live. `Bay` and `Tier` are fixed for a bay and need no sync.
- `app/src/lib/telemetry.ts` — `BayRecord.lostPieces` gains the note that it
  counts CUBES, not pieces. That is where both `endBay` call sites, the
  persisted schema and `sim/playtest.ts`'s independent copy of the record shape
  all converge.
- `app/sim/uifit/fixtures.ts` — `hud-contract` and `hud-contract-lines` gain the
  new fields, so all 13 devices measure the rows. They also stop inheriting
  `HUD_BASE`'s ability flags, which had them rendering a Build row the app never
  shows and feeding the layout solver a 7-slot rail against the real 4.
- `app/sim/uifit/run.ts` — the `plant` lower bound, the two new `inkline`
  entries, and a `capMid` that measures flex-centred containers through a
  wrapper instead of silently returning the flex line's centre.
- `app/sim/systems.ts` — markup assertions for every row and column above.
- `app/src/styles/tokens.css` — untouched in the end. A
  `--pixel-optical-drop-centered` token was added mid-branch and removed again;
  see the amendment note in the plan.

## Verification

- `npm run typecheck` and `npm test` green.
- `sim/uifit` green on all 13 devices — in particular the `plant` assertion on
  `hud-contract` and `hud-contract-lines`, which now measure a full-height
  panel rather than a short one.
- Both Contract kinds and a Deep Run bay driven in the real app, confirming the
  panel's top edge lands at the same y in all three.
- A one-complication Contract confirmed to render the `Bay` row at the same
  height as one carrying three. (Not a `clean bay` Contract — the generator
  cannot produce one; see §3.)

## Out of scope

- Attempts-this-session and best-launches-used would close the remaining ~45px
  on a lines Contract, but both need new persistence in `meta.ts`. Considered
  and deferred; the air is preferable to inventing a number to fill it.
- Promoting the manifest out of the meta line was on the original list and is
  already done — `c66c12c` gave it `.pl-queue`. Nothing to do.
- The Deep Run panel is untouched. It already sits at the footprint, and every
  rule here is scoped to `.hud--contract`.
