# Copy and terminology audit

Status: **implemented.** This document recorded the August 2026 audit; the
terminology contract below has since been applied to the player-facing copy in
the same change that carries this note. Each section states what shipped, what
was already true by the time the pass ran, and what is still open.

Because the codebase moved between the audit and the implementation, every
finding was re-verified against the current tree. Line numbers below are the
August ones and are hints, not addresses.

## Recommended terminology contract

- **Tier N** is the player-facing name for a numbered tower floor, difficulty,
  Deep Run, leaderboard, progression step, and seal.
- **Mark** / `mark` is implementation vocabulary for the persisted high-water
  state, run difficulty, and API/leaderboard key. Developer documentation may
  use it when naming a code symbol or wire field, but should map it to the Tier
  shown to the player.
- Lowercase **tier** remains valid for a system upgrade rung. Where a screen
  discusses ladder progression and system upgrades together, **rank** would be
  less ambiguous for the latter.
- **Skydeck** and **Tier S** are named exceptions, not numbered Tiers and not
  Marks. Use “Skydeck” in prose and accessibility text; reserve “SKY ★” for the
  compact plate.
- **Bay** is the player-facing unit currently stored in the legacy `level`
  field.

The strongest existing statement of this contract is in `game/meta.ts`, where
both gate formatters say that “Mark” is internal vocabulary and convert the
internal completed-Mark count to the next player-facing Tier. This is also an
important off-by-one boundary: `meta.mark` counts completed Tiers while
`markUnlocked(meta)` is the Tier the player may currently fly. A global text or
identifier replacement would therefore be unsafe.

## Player-facing Mark/Tier conflicts

### Home, tower, and Skydeck

*Implemented.* Every numbered floor now reads Tier N on the surfaces below; the
Skydeck half was already true and is explained at the end of this section.

- `ui/screens.ts:696` labels the control “Tier tower” but asks the player to
  “pick the Mark to fly.”
- `ui/screens.ts:979` advertises “Any Mark, bay or Contract” on Tier S.
- `ui/screens.ts:993` describes Skydeck as “a step above Mark 10,” although the
  same menu, tower, and plates call the numbered floors Tiers.
- `ui/screens.ts:545`, `1010-1013`, and `4629` count “Marks” in seal/progression
  copy while the stamps themselves are attached to Tier floors.
- `tierText()` and `boardText()` (`ui/screens.ts:85-105`) produce “Tier SKY” and
  “Tier SKY ★,” while the menu and Contract surfaces say “Skydeck.” Running text
  and accessibility labels should use “Skydeck”; the compact plate can keep
  “SKY ★.”

**Shipped:** the tower's picker label (“pick the Tier to fly”), the Tier S floor
and subtitle (“Any Tier, bay or Contract”), the Skydeck subtitle (“a step above
Tier 10”), the locked roof's accessible seal count (“N of 10 Tiers sealed”) and
the endgame primary's owed count (“N Tiers left to seal”, “N Tiers still owed”).

**Already resolved for Skydeck.** The running-prose and accessibility half of
this finding predates the audit and needed no change: the tower floor's
accessible name is `"Skydeck"` (`ui/screens.ts` `floorHTML`, since 62c1c25,
2026-08-26) and the bay banner's `aria-label` special-cases the roof to
`"Skydeck"` rather than `tierText()` (since 7a6ee0a, 2026-08-27). What is left on
`tierText()`/`boardText()` is exactly the compact plate the contract exempts —
the leaderboard tab, the board heading, the draft eyebrow and the end card's
“… board” line — and `sim/systems.ts` pins that plate spelling deliberately (“the
eyebrow names the floor, not the borrowed mark”), so it stays “Tier SKY ★”.

### Refit, sandbox, and run announcements

*Implemented.* The refit eyebrow now reads “Tier N · refit stop”, the sandbox
briefing “Tier N”, the sandbox setup's difficulty chip is labelled **Tier**, and
`main.ts`'s end-modal setup line announces “Tier N · from bay N”.

- `ui/screens.ts:3393` says “Mark N · refit stop,” while the same panel at
  `ui/screens.ts:3404` immediately says “Tier 1” and “Tier 2” for the run
  difficulty. This is the clearest adjacent conflict.
- `main.ts:2114` announces sandbox setup as “Mark N · from bay N.”
- `ui/sandbox-screen.ts:141` and `ui/sandbox-screen.ts:309` expose Mark in the
  Tier S configuration UI.
- `ui/screens.ts:791` says Tier S is “set on the level select”; the public
  destination is the Tier S or sandbox setup screen, not a level selector.
  *Now reads* “Tier S — set on the sandbox setup screen”.

### Seals and retry explanations

The seal flow switches wholesale back to the old noun:

- `ui/screens.ts:3825` and `4986`: “Mark N is already sealed.”
- `ui/screens.ts:5151-5156`: “A Mark is sealed,” “all Marks carry a stamp,” and
  “Mark N cannot be sealed.”
- `game/guide.ts:710-714`: the How to Play article teaches “Clear a Mark,” “A
  Mark is sealed,” and “a beaten Mark.”

These refer to the same numbered floor called Tier N everywhere around the
copy. They should use Tier consistently. “Restart Bay” in Pause versus “Retry
Bay” after Game Over is intentionally contextual and is not a finding.

*Implemented.* The whole seal flow now says Tier: the held line and its
`aria-label` on both the run-end card and the pause rail (“Tier N is already
sealed, so this costs nothing”), the seal-break panel in both its long and short
forms (“A Tier is **sealed** …”, “all 10 Tiers carry a stamp”, “**Tier N** cannot
be sealed”), and the guide's Seals and Skydeck articles. The conversion is
one-to-one at every one of these sites: `meta.sealedMarks` holds the floor
numbers 1…`MARK_COUNT`, and the tower draws floor *n* as “Tier *n*”, so no
off-by-one is crossed. The `meta.mark` / `markUnlocked` boundary the contract
warns about is not touched — nothing here interpolates the high-water count.

### Guide and documentation

- `game/guide.ts:687` says every Mark has a leaderboard, then says the player
  raises a tier in the same sentence.
- `README.md:20-32`, `109-124`, `204-216`, and `370-372` alternate Mark and Tier
  for the same ladder and leaderboard.
- `docs/DESIGN.md:117-128` and `371-394` retain the older “Mark ladder” model
  while also explaining Tier completion.
- `docs/PLAY.md:333-335` mixes the nouns and says only beating a Mark raises the
  rig ceiling. Advancement actually requires both halves: the Tier's Deep Run
  and its required first-clear Contracts (`game/meta.ts:1138-1232`).

Recommended public wording: “Completing a Tier—its Deep Run plus the required
Contracts—unlocks the next Tier and raises the build-budget ceiling.”

*Implemented.* `game/guide.ts` now says every **Tier** keeps its own leaderboard
and that the Deep Run is the only mode that can raise the Tier you fly.
`README.md` reads Tier for the ladder throughout and keeps `mark` only where it
names a wire field or a code symbol, mapped to Tier in the same sentence
(`GET /api/scores?mark=7` → “that **Tier's** top scores”; the save schema's `mark
(the Tier)`). `docs/DESIGN.md` was converted the same way and now opens with a
**Terminology** note stating the contract, the `mark` symbols it keeps, and the
`meta.mark` / `markUnlocked` off-by-one; lowercase “tier” on a *system track* is
called out there as a different thing. `docs/PLAY.md` carries the recommended
advancement wording verbatim.

## Other verified copy inconsistencies

### Tetrilaunch Unlimited is a store-integration stub — **stale, resolved by
later work**

*This section is kept for the record and is no longer actionable.* It described
an August 2026 tree in which the RevenueCat plumbing existed but the entitlement
gated nothing, and in which the product was documented as a renewing
subscription while the store was configured with a non-consumable. Both halves
have since been fixed by work outside this audit, and re-verifying against the
current tree finds none of the cited surfaces:

- **The entitlement gates real content.** `game/meta.ts` defines
  `FREE_TIER_LIMIT = 3` and `tierIncluded(tier, fullGame)`; `ui/screens.ts`
  derives a `paywalled` floor from it (the tower plate's accessible name gains
  “— Full Game required”), and `main.ts` clamps the pickable floor, the Contract
  tier and the Deep Run launch to that limit, plus a per-UTC-day Contract
  allowance for non-owners. The entitlement is no longer a badge.
- **The product renamed and re-typed.** `lib/purchases.ts` reads
  `UNLIMITED_ENTITLEMENT = "full_game"`; the player-facing name is **Full Game**,
  and “Unlimited”, “Unlock Unlimited” and “Manage Subscription” no longer appear
  in `ui/screens.ts` at all — the surfaces are “★ Unlock Full Game” and “★ Full
  Game owned”.
- **The subscription copy is gone.** `public/terms.html` now says “a one-time,
  non-consumable Full Game purchase … does not renew and is not consumed through
  use”; `public/support.html` explains the one-time purchase and restore rather
  than cancellation; `docs/PLAY.md` documents the one-time product and states
  what it opens (earned Tiers 4–10 and the Contract limit) instead of warning it
  must not be sold.

Nothing in this section was acted on by the terminology pass, and nothing in it
should be acted on now. The one durable recommendation it made — derive a small
capability object from the entitlement rather than importing purchase state into
game modules — is what `tierIncluded`/`FREE_TIER_LIMIT` in effect became.

### Privacy and data disclosures

*Still open, and out of scope for the terminology pass.* Re-verified against the
current tree: `public/privacy.html` still says a leaderboard record is “exactly
four things plus the time of submission” and still calls the highest bay the
“level reached”, and `store/play/data-safety.csv` is still the declaration the
policy has to be reconciled with. These want a store-review owner, not a copy
diff, so this pass left them alone rather than half-answering them.

- `public/privacy.html:98-109` says a leaderboard record contains exactly four
  things plus time. The client also sends the board key (`mark`) and a board day;
  the Worker persists the board key for all scores and the UTC day for Skydeck
  scores (`lib/api.ts:280-295`, `worker/index.ts:186-188`, `245-248`). The policy
  should disclose display name, score, board/Tier, highest bay reached, lines,
  Skydeck board day when applicable, and submission time.
- `public/privacy.html:105` calls the highest bay the “level reached.” “Highest
  bay reached” matches the game and the code's own schema commentary.
- `public/privacy.html:82-84`, `156-159`, and `164` say nothing leaves the device
  without a score and that RevenueCat is contacted only when the store opens or
  a purchase occurs. Native startup calls `initPurchases()`, which configures
  RevenueCat and fetches customer information (`main.ts:985-993`,
  `lib/purchases.ts:149-155`).
- `store/play/data-safety.csv:252-258` declares purchase history for app
  functionality and analytics, while `public/privacy.html:82` says there is no
  analytics of any kind. The store declaration and policy must be reconciled.
- The privacy policy describes RevenueCat's random anonymous identifier, while
  the data-safety form leaves “Device or other IDs” unchecked. Confirm Google's
  classification before changing either declaration.

### Platform and general UI wording

*Still open.* “Level Cleared!” and “tap to continue” both still exist
(`ui/screens.ts`, now around lines 4824 and 3261) and both remain worth fixing,
but neither is a Mark/Tier question and the audit's own implementation order
puts the system-upgrade “tier” → “rank” decision after this pass, so all three
were left for a separate change rather than folded into a terminology diff. The
desktop-platform omission is unchanged: `public/terms.html` still lists “the web,
Android, iPhone and iPad”, which is correct only while desktop is unreleased.

- If the Electron build is publicly distributed, `public/support.html:79-81`
  and `128`, plus `public/terms.html:84-86`, omit desktop platforms. If desktop
  is not released yet, this omission is intentional.
- `ui/screens.ts:4773` says “Level Cleared!” for a single-bay result while the
  surrounding game consistently calls that unit a Bay. Use “Bay Cleared!”
- `ui/screens.ts:3210` says “tap to continue” on a screen also used with mouse,
  keyboard, and gamepad. A neutral “Continue” avoids touch-only instruction.
- System upgrade copy at `ui/screens.ts:3563-3565` uses “tier” while the same
  screen also discusses the player's ladder Tier. Consider “rank” for system
  upgrades, but treat this as a deliberate terminology decision rather than a
  mechanical replacement.

## Implementation order, and where it stands

1. Correct the privacy policy and Play data-safety mismatch before store review.
   **Not done** — see *Privacy and data disclosures* above.
2. Replace literal Mark strings in UI and guide copy, with a check on each
   surface. **Done.** `ui/screens.ts`, `ui/sandbox-screen.ts`, `main.ts` and
   `game/guide.ts` carry no player-visible “Mark” any more, and every pin in
   `sim/systems.ts` that asserted one of those strings was updated with it and
   mutation-proved (the old wording was restored locally, the check was watched
   to fail, and the new wording restored). No pin was loosened. No shared
   formatter was added: the sites interpolate different numbers — the run's
   flown Tier, the count of Tiers sealed, the count still owed — and a single
   helper would have hidden exactly the distinction `meta.mark` versus
   `markUnlocked` makes dangerous.
3. Update README and design/play documentation, retaining `mark` only beside code
   symbols, database fields, and API examples. **Done.**
4. Decide whether system upgrade “tier” becomes “rank,” then update those
   surfaces separately. **Not done, deliberately** — it is a terminology
   decision, not a mechanical replacement, and nothing in this pass depends on
   it.

## What this pass did not touch

No code symbol, storage key, leaderboard/API field or CSS class was renamed.
`meta.mark`, `markUnlocked`, `sealedMarks`, `budgetForMark`, the `mark` query and
body field, the `sbx-tier` action and the save schema are all exactly as they
were: this is a copy diff, and a global replacement across the two vocabularies
would have crossed the off-by-one the top of this document warns about.
