# Balance Pass 2: Contracts, Wind, Tiered Bonds, Seam Splitter

**Goal:** Four balance/feature changes requested from device playtesting
(2026-08-22, second session — the first session's findings landed as
`2026-08-22-balance-pass.md` and are already on `staging`): Contracts
tightened, global wind halved with gust jitter reduced, bond strength made a
per-tier ladder that culminates in an all-unbreakable tier 10 bay 10 ("the
ultimate format"), and a Bond-Emitter-hosted subsystem that weakens S and Z
bonds so those shapes stay playable when bonds are unbreakable.

**Base:** `staging` (NOT `main` — staging carries the responsive UI system,
the congestion tax, the tight purse, the per-run Bond Breaker magazine, the
sliding ratchet ladders and the flat salvage economy; every number below is
read from staging's code). **Integration branch:** `staging`. One feature
branch + PR per section; each PR must leave the suite green on its own.

**Tech stack:** TypeScript; no test framework — `sim/systems.ts` is a
hand-rolled `check(desc, cond, detail)` harness run with `npm --prefix app
test`. `npm --prefix app run typecheck` must stay clean. Both are green on
staging today.

---

## 1 — Contracts: harder, not lower-paying (`claude/gb-contracts`)

**The call between "harder or pay less": harder.** Contract pay is not a free
knob — staging's salvage economy was just re-derived to flat 60/tier
(`meta.ts`'s `TIER_SALVAGE_PER_TIER = 0` note: 600 of income against a 445
shelf — INSTALLS' seven systems at 300 plus the two live unlocks at 145 — and
the 15-salvage milestone IS the on-ramp install). Cutting pay
re-breaks the on-ramp the 2026-08-09 deadlock proved the economy cannot do
without. Difficulty has a dedicated, provable seam instead: the feasibility
model in `contracts.ts` prices every launch budget in closed form, so
tightening it is one constant with the guarantee intact.

Changes, all in `app/src/game/contracts.ts`:

- `SLACK` 1.25 → **1.15**. The headroom over the bare feasibility floor —
  ~8% fewer launches on every "lines" Contract. Still above 1.0, so the
  feasibility guarantee (`launchesFor`, asserted by `sim/systems.ts` against
  the same function) is untouched in kind, only in generosity.
- `SLACK_TIGHT` 1.05 → **1.02**. The "tight launch budget" complication gets
  meaningfully tight.
- Goal ramp: `3 + floor(rng*3) + min(3, floor(tier/2))` → cap raised to
  **`min(4, floor(tier/2))`**. Tiers 8+ ask up to one line deeper; low tiers
  unchanged.
- Update the stale doc-comments beside each constant (keep the rationale,
  correct the numbers).

Deliberately NOT touched: pattern Contracts (measured 23% clear rate —
already the hard half), `PLANNING_EFFICIENCY` (measured, not tuned), the
material waste model, tier milestone salvage (see above), and the music-bed
layer staging added to this file.

**Tests:** `sim/systems.ts` already asserts feasibility from the same model;
re-run and fix any check that encodes the old slack. Add a check that a
tier-1 lines Contract still grants ≥ 3 launches (the floor's
`Math.max(3, …)`), and one that `launchesFor` at the new slack yields fewer
launches than at 1.25 for a representative goal (guards the constant against
silent regression).

## 2 — Global wind −50%, gust jitter down (`claude/gb-wind`)

Playtest verdict: wind at current strength discourages aiming — the gust
noise especially, because it punishes a well-solved shot with a random miss.
Halve every wind source and cut the noise-to-signal ratio on top:

- `app/src/game/level.ts` `makeBaseLevel`: `windMax = i < 3 ? 0 : 0.06 +
  (i - 3) * 0.04` → **`0.03 + (i - 3) * 0.02`** (bay 4: 0.03, bay 10: 0.15).
  First three bays stay dead calm. Update the BALANCE KNOBS narration.
- `app/src/game/level.ts` `WIND_GUST_FRACTION` 0.025 → **0.015**. Stationary
  gust std drops from ~17.7% to ~10.6% of windMax — and since windMax itself
  halved, absolute jitter lands at ~30% of today's. Update the derivation
  comments (the std-formula notes here and in `game.ts`; `stepWind`'s clamp
  stays `windGust * 16`, still ≈2.26 stationary std by construction, but the
  "exactly windMax * 1.4" figure becomes windMax * 1.24).
- `app/src/game/hazards.ts` `WIND_NOTCH` 0.06 → **0.03**. The Crosswind
  ratchet is sized in its comment against the ladder's own weather — halving
  the ladder without halving the notch silently doubles the notch's relative
  price. Card copy interpolates the constant, so it stays honest on its own.
- `app/src/game/contracts.ts`: the tier wind cap `min(0.3, 0.05 +
  (tier-1) * 0.03)` → **`min(0.15, 0.025 + (tier-1) * 0.015)`**, and
  `levelForContract`'s hardcoded `c.windMax * 0.025` gust must become
  `c.windMax * WIND_GUST_FRACTION` (import it) so the fraction can never
  fork between Deep Run and Contracts again.

**Tests:** add `sim/systems.ts` checks pinning bay 4 / bay 10 windMax and
`windGust === windMax * WIND_GUST_FRACTION` at both, plus the Contract cap
at tier 1 and tier 10. The existing suite's wind checks are structural
(`windy.windMax > flat.windMax`, tier-1 `windMax <= 0.1`) and should pass
unchanged — verify rather than assume.

## 3 — Bonds strengthen every tier; tier 10 bay 10 unbreakable (`claude/gb-bond-tiers`)

**Audit answer:** bonds strengthen every *bay* — staging retuned the ramp to
`jointBreakStretch = BASE_BREAK_STRETCH * (1 + i/9)` (2.2 → 4.4, "bonds
hold") — but the tier (Mark) never touches them. `makeBaseLevel` already
takes `mark`, `run.ts`'s `levelForRun` already passes it, and `LevelConfig`
now even carries `mark`; the seam exists with no writer.

- `app/src/game/level.ts`: new named constants **`BOND_MARK_STEP = 0.1`**
  (per-Mark multiplier step) and **`UNBREAKABLE_MARK = 10`** (documented as
  the same rung as `hazards.ts`'s `CAPSTONE_MARK` — not imported, that would
  cycle `level ↔ hazards`; a `sim/systems.ts` check asserts the two stay
  equal instead).
- `makeBaseLevel`: `jointBreakStretch = BASE_BREAK_STRETCH * (1 + i / 9) *
  (1 + BOND_MARK_STEP * marksAbove)`, **except** `mark >= UNBREAKABLE_MARK
  && i === 9` → **`Infinity`**. Mark 1 is byte-identical to today (the
  existing "bay 10 = 2× bay 1" check at default mark keeps passing); Mark 10
  runs ×1.9 (bay 1: 4.18); and Mark 10 bay 10 is the ultimate format:
  nothing shatters on landing and the press cannot break a piece
  (`breakJointsInBand` already exempts `Infinity` — the rebar rule), so rows
  are built from whole shipments and the Bond Breaker is the only shatter.
  `jointStiffness` is left alone (already capped at 0.98).
- Infinity flows through existing plumbing untouched: `createTetrisPiece`'s
  `Math.max(1.05, breakStretch * breakMult)`, `updateBreakableJoints`'s
  `cur > rest * limit`, and render.ts's weld seams (`seamStrength` pins
  non-finite at 1, and above-4.4 finite values clamp to full width — the
  correct read: stronger than the scale's top). Verify, don't re-implement.
- Winnability of the ultimate format rests on the same fact rebar bays rest
  on: whole pieces landing flat still fill slot-aligned rows (`lineClear.ts`
  has no loose-cube requirement), and a Mark 10 player owns the Bond Emitter
  ladder — whose charges are now a per-run magazine, which makes the
  capstone bay exactly the "spend it where it counts most" moment that
  redesign describes. No free charges are granted — the format is the point.

**Tests:** `sim/systems.ts` checks — for a fixed bay, stretch rises with
mark; for a fixed mark < 10, rises with bay and stays finite;
`makeBaseLevel(9, 10).jointBreakStretch === Infinity`; `makeBaseLevel(8,
10)` and `makeBaseLevel(9, 9)` finite; mark-1 values identical to
`BASE_BREAK_STRETCH * (1 + i/9)` across all ten bays; `UNBREAKABLE_MARK ===
CAPSTONE_MARK`.

## 4 — Seam Splitter: per-piece bond weakening in the Bond Emitter (`claude/gb-seam-splitter`)

S and Z are the shapes that tip, wedge and strand cubes; with unbreakable
bonds they become the format's misery. Per the request, the bond breaker
system (the `bonds` / Bond Emitter track in `upgrades.ts`) hosts a subsystem
that weakens the bonds of *specific piece types* — shipped tuned to S and Z.

- `app/src/game/level.ts` `LevelConfig`: two new fields, defaulted inert in
  `makeBaseLevel` — **`weakBondTypes: PieceType[]`** (`[]`) and
  **`weakBondMult: number`** (`1`). A generic per-type seam, not an S/Z
  special case: which types are weak is data.
- `app/src/game/pieces.ts`: `createTetrisPiece` gains an optional trailing
  `weakBond?: { types: PieceType[]; mult: number }`. For a piece whose type
  is listed: `pieceBreakStretch = Math.max(1.05, (Number.isFinite(base) ?
  base : WEAK_BOND_UNBREAKABLE_BASE) * mult)` where `base = breakStretch *
  spec.breakMult` and **`WEAK_BOND_UNBREAKABLE_BASE = BASE_BREAK_STRETCH`**
  (import from level.ts — bay-1 fragility) — so in the ultimate format a
  weakened S/Z is *finite* again. Material rigidity still wins: rebar stays
  `Infinity` whatever the type (a material property outranks a piece-shape
  one), and tar welds are untouched.
- `app/src/game/game.ts`: pass the level's two fields through at the single
  `createTetrisPiece` call site (game.ts:925).
- `app/src/game/upgrades.ts` `bonds` track hosts it: `apply(cfg, tier)`
  keeps its per-run charge grant and adds — tier ≥ 2: `weakBondTypes =
  ["S", "Z"]`, `weakBondMult = 0.7`; tier 3: `weakBondMult = 0.5`. Tier
  strings and `current()` copy updated (e.g. tier 2 "+2 charges per run ·
  S/Z bonds 30% weaker"). Hosted at tiers 2–3 so it is a refit decision on
  the track whose whole identity is bond control — and with charges now a
  rare per-run magazine, the passive weakening is what the higher tiers
  newly pay for.
- `docs/DESIGN.md`: one short paragraph naming the subsystem (Seam Splitter)
  and its rule, matching the doc's voice.

**Tests:** `sim/systems.ts` — with `bonds` tier 2 applied, an S piece's
constraints carry a lower stamped `breakStretch` than a T piece's at the
same config; at an Infinity-stretch config the S piece's stretch is finite
and the T piece's is not; a rebar S piece stays Infinity; tier 1 leaves
`weakBondTypes` empty; tier 3's mult < tier 2's.

---

## Sequencing and merge notes

Order of merge into `staging`: **2 (wind) → 3 (bond tiers) → 4 (seam
splitter) → 1 (contracts)**. Overlaps: 2+3 both edit `makeBaseLevel`
(adjacent lines), 3+4 both edit `level.ts`, 1+2 both edit `contracts.ts`
(distinct regions). Conflicts are resolved at merge time by the reviewer;
later branches must not pre-emptively include earlier branches' changes.

Every PR: `npm --prefix app run typecheck` clean and `npm --prefix app test`
green before push; comment style and density matched to the surrounding
files; no drive-by refactors.
