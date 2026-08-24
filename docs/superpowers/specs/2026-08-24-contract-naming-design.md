# Contract naming — sell the waste allowance

**Status:** proposal. Nothing here is implemented.

The ask: Contracts should have obvious names. The three challenge types should
all be the same shape — an inventory, a hazard, and a *margin* — and the margin
should be the thing the card sells, because the margin is the thing we control.
10% waste, 5% waste, 0 waste. The first two carry material and wind so they land
at the same difficulty as the third, and all three pay the same salvage.

That is a good structure and the economy already supports it. The naming does
not, and — more importantly — **the numbers are not currently true**, so this
document is half copy review and half what has to move underneath it.

---

## 1. What the copy says today

Every player-facing string a Contract owns, and where it comes from:

| Slot | Today | Source |
| --- | --- | --- |
| Board card badge | `Pattern` / `Lines` | `ui/screens.ts:2303` |
| Board card headline | `Backlog Clearance`, `Overflow Dock`, `Quota Run`, `Scrap Line`, `Holding Bay`, `Transfer Yard`, `Freight Ramp`, `Sorting Floor` | `contracts.ts` `NAMES` |
| Board card supply label | `Supply` / `Budget` | `ui/screens.ts:2312` |
| Board card brief | `12 shipments · 3 shapes, no waste` / `crosswind · cryo shipments` | `Contract.brief` |
| Variant name | `Standard`, `Single Stock`, `Narrow Gauge`, `Full Rebar`, `Part Load`, `Blackout`, `Guided` | `contracts.ts` `VARIANTS` |
| HUD supply | `Shipments` / `Launches` | `ui/screens.ts:925` |
| HUD conditions row | `Bay` + `Contract.conditions` | `ui/screens.ts:1028` |
| Loss heading | `Manifest Short` / `Out of Launches` | `ui/screens.ts:2463` |
| Loss reason | *"…that's the whole margin"* | `ui/screens.ts:2466` |

### Findings

**F1 — the badge names the implementation, not the offer.** `Pattern` and
`Lines` are the two `ObjectiveKind` values verbatim. Neither tells the player
what is different about accepting one. The actual difference — one gives you a
counted inventory and no slack, the other gives you roughly double what you need
— is nowhere on the card.

**F2 — the card leads with the one line that means nothing.** `NAMES` is
deliberately inert; the comment above it is explicit that a bay name must never
read as a rule, and that reasoning is sound and worth keeping. But the card puts
that inert line in the headline slot and pushes the tolerance into a comma-run
at the bottom. The most-scanned position on the card carries the least
information on it.

**F3 — the variant name never reaches the board.** `VariantSpec.name` is
documented as *"Shown on the card, above the brief"*. It is not: `ContractCard`
(`ui/screens.ts:2372`) has no `variant` field, and `contractsScreen` never
renders one. The name appears only in the in-bay banner (`main.ts:655`) and the
dev sandbox — i.e. after you have already accepted. The docstring is stale.

**F4 — two labels for one concept.** `Supply` vs `Budget` on the card,
`Shipments` vs `Launches` in the HUD, `Manifest Short` vs `Out of Launches` on
the loss screen. Six words for "the thing that runs out". If all three types are
graded by margin, they all run out of the same thing and can share one word.

**F5 — `no waste` is already the best string on the board, and it is buried.**
It is the tail of a comma-run in the brief. It is also the only place the game
names its own core tolerance, and the loss screen already reaches for the same
vocabulary — *"with an exact manifest, that's the whole margin"*, plus a
`cubesWasted` stat. The word to build the naming on is already in the game.

**F6 — some variant names describe the wrong noun.** `Part Load` names the load;
what is actually part-built is the **bay** (the wall it opens with). `Narrow
Gauge` is rail voice for a narrow track, not a narrow row. `Guided` does not say
what guides.

---

## 2. The rename

### The three grades

Reuse `manifest` — the game's own word for the shipment set, already on the loss
heading and the end-screen stat. It is ordinal, it is obvious, and it costs the
player no new vocabulary.

| Grade | Waste allowed | Bay |
| --- | --- | --- |
| **Loose Manifest** | 10% | material + wind |
| **Tight Manifest** | 5% | material + wind |
| **Exact Manifest** | none | clean, calm |

The card then reads top to bottom as: what grade → how much slack → what the bay
does to you → which bay.

```
┌─────────────────────────────┐
│ LOOSE MANIFEST        ✦+15  │   grade replaces "Pattern"/"Lines"
│ 10% waste allowed           │   the sell, in the slot "Budget" had
│ 6 lines · I×4 O×3 L×3 J×2   │   goal + manifest
│ crosswind · cryo shipments  │   conditions (unchanged)
│ Overflow Dock               │   flavour name, demoted to subtitle
└─────────────────────────────┘
```

`NAMES` stays exactly as it is — the rationale for keeping it inert is right.
It just stops being the headline (**F2**).

### Everything else

| Slot | Today | Proposed | Fixes |
| --- | --- | --- | --- |
| Badge | `Pattern` / `Lines` | `Exact Manifest` / `Tight Manifest` / `Loose Manifest` | F1 |
| Supply label | `Supply` / `Budget` | `Waste allowed` → `10%` / `5%` / `none` | F1, F4 |
| HUD supply | `Shipments` / `Launches` | `Shipments` everywhere | F4 |
| Loss heading | `Manifest Short` / `Out of Launches` | `Manifest Short` everywhere | F4 |
| Variant on card | *(absent)* | render it above the brief, as documented | F3 |
| `Part Load` | | `Part-Built` — the bay is what is part-built | F6 |
| `Narrow Gauge` | | `Narrow Bay` | F6 |
| `Guided` | | `Self-Squaring` — the conditions string already says this | F6 |
| `Single Stock` | | keep | |
| `Full Rebar` | | keep | |
| `Blackout` | | keep | |
| `Standard` | | keep | |

---

## 3. What has to move for those numbers to be true

The names are only worth shipping if they are honest. Four measurements say what
that costs. All are reproducible from the generator itself.

### M1 — today's board is 46% waste or 0% waste. There is no middle.

Real allowance per contract, measured as `1 − (cubes the goal needs ÷ cubes the
budget delivers)`, over 400 seeds per tier:

| Tier | Lines contract | Pattern contract |
| --- | --- | --- |
| 1 | 46.7% | 0% |
| 4 | 47.3% | 0% |
| 7 | 49.4% | 0% |
| 10 | 45.7% | 0% |

The `tightLaunches` complication moves that to ~41%, which is why
`SLACK_TIGHT`'s own comment records it as barely distinguishable at 1.05.

A lines contract is generous **because its belt is random**. `launchesFor` has to
buy insurance against a queue nobody planned, priced through
`PLANNING_EFFICIENCY = 0.6` — a fudge factor the file openly documents as
guessed low on purpose. Measured play is 0.62 in browser, 0.69 on device: real
players squander 31–38% of their cubes. Labelling that bay "10% waste" would
mean roughly halving its budget, to well under what anyone has yet played.

**So the sell only becomes true if all three grades get an exact manifest.**
A proven tiling is the only inventory where perfect play consumes exactly 100%,
which is the only condition under which "10% spare" is a statement about the
player rather than about the physics. That also retires `PLANNING_EFFICIENCY`
and `SLACK` — a guessed constant replaced by a number that is provable, which
is the same trade `tilingQueue` already made once.

The cost is real and worth naming: the improvisational bay — fire at a random
belt and see what resolves — leaves Contracts entirely. Deep Run is already that
bay, and `DESIGN.md` already draws the line as *"Contracts test placement, Deep
Run tests placement under pressure"*, so this arguably sharpens the split rather
than flattening it. But it is a mode deletion, not a copy change.

### M2 — 10% and 5% only separate at 6-line goals and above.

Margin resolved into whole spare shipments, 8-cell lines, std tetrominoes:

| Goal | Exact | +10% | +5% | Distinct? |
| --- | --- | --- | --- | --- |
| 2 | 4 | 1 spare | 1 spare | no |
| 4 | 8 | 1 spare | 1 spare | no |
| 5 | 10 | 1 spare | 1 spare | no |
| **6** | 12 | **2 spare** | **1 spare** | yes |
| 8 | 16 | 2 spare | 1 spare | yes |
| 12 | 24 | 3 spare | 2 spare | yes |

Below 12 shipments the two grades round to the same board. The structure that
falls out is the one already on the board: **Loose and Tight are the long hauls**
(6–8 lines, 12–16 shipments — today's lines-contract goals), **Exact stays short**
(2–4 lines — today's pattern goals). The grades are then honestly different and
the daily board still offers one of each.

### M3 — at today's material rates, the material eats more than the margin.

Expected extra waste from the belt (`rate × MATERIAL_WASTE × cubes`), against a
10% margin on the same contract:

| Tier | Margin | cryo | rebar | volatile | tar |
| --- | --- | --- | --- | --- | --- |
| 6 | 2 spare | 2.1 sh | 1.3 sh | — | — |
| 7 | 2 spare | 2.4 sh | 1.5 sh | 3.0 sh | — |
| 9 | 2 spare | 3.3 sh | 2.1 sh | 4.6 sh | 2.4 sh |

Hand a "10% waste" card a tier-7 volatile belt at today's rates and the real
allowance is *negative* — unwinnable in expectation, with a card promising slack.

Fix: price the margin **on top of** the belt's expected waste rather than
instead of it —

```
queue = ceil( exact × (1 + margin) ÷ (1 − rate × MATERIAL_WASTE[m]) )
```

so "10% waste" means *ten percent of what you are given may be squandered by
you, after the belt has taken its cut*. That is the honest reading of the card,
it keeps Loose and Tight at the same real difficulty across every material, and
it reuses `MATERIAL_WASTE` as-is — the table is already the right shape for this,
it is just currently applied to a launch budget instead of a manifest.

Wind is the other half of the top-up and is currently forbidden outright on an
exact manifest (`windMax: 0`, on the grounds that zero waste plus a lateral force
is a dice roll). That objection is exactly what a margin removes: **spare
shipments are what make wind affordable**, which is the mechanical reason Loose
and Tight can carry weather and Exact cannot.

### M4 — same salvage is already true; no economy change needed.

`meta.ts` pays a flat `tierMilestoneSalvage` — `floor(60/4)` = **15** — for any
of a tier's first three first-clears, regardless of kind, and
`TIER_SALVAGE_PER_TIER` is 0. Grades already pay identically. Only the
*difficulty* has to match, which is what the material/wind top-up is for.

---

## 4. Cost and risk

**Deal-proof time at bay start.** `buildOrder` is the expensive step, and it
scales with queue length. Measured, 60 samples per goal:

| Goal | Shipments | Tiling (p50/max) | Order proof (p50/max) |
| --- | --- | --- | --- |
| 2 | 4 | 0.3 / 4.6 ms | 0.2 / 2.9 ms |
| 4 | 8 | 0.1 / 0.6 ms | 5.1 / 104 ms |
| 6 | 12 | 0.1 / 2.6 ms | 6.1 / 429 ms |
| 8 | 16 | 0.1 / 1.9 ms | 14.2 / 551 ms |
| 10 | 20 | 0.1 / 3.0 ms | 11.2 / 682 ms |

Tiling stays cheap at every goal. The order proof does not: a 16-shipment Loose
Manifest has a worst case around half a second, on the main thread, at bay start.

Mitigation is available and comes from the margin itself: with spares in hand the
order no longer has to consume the *whole* queue, only a prefix that finishes the
goal, so the search can stop early instead of proving the tail. `buildOrder`
currently requires the exact multiple (`buildable.ts:328`) and would need that
constraint relaxed — which is required work for this design anyway, not extra.

**Other required work:** `dealPatternQueue` and `objectiveUnreachable` both
assume "queue exhausted = attempt over", which stops being true once a manifest
carries spares; `sim/systems.ts`'s feasibility assertion moves from
`launchesFor` to the tiling proof; `sim/patterns.ts` re-baselines at the longer
goals.

---

## 5. Recommendation

Split it in two, because the halves have very different risk:

**Now — copy only, no mechanical change.** F3 (show the variant name), F4 (one
word for the thing that runs out), F6 (three variant renames), and F2 (demote
`NAMES` to a subtitle, promote what the card actually offers). These are strict
improvements against the board as it stands and carry no balance risk.

**Then — the grades, as a balance change.** `Loose / Tight / Exact` and the
percentages need M1 (exact manifests everywhere), M2 (long-haul goals for the
two graded types), M3 (margin priced over the material) and the `buildOrder`
relaxation from §4. Shipping the names before those numbers exist would put a
figure on the card that the bay does not honour — which is the one thing this
board must never do.
