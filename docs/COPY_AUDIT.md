# Copy and terminology audit

Status: findings only. This document records the August 2026 audit and does not
change player-facing copy.

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

### Refit, sandbox, and run announcements

- `ui/screens.ts:3393` says “Mark N · refit stop,” while the same panel at
  `ui/screens.ts:3404` immediately says “Tier 1” and “Tier 2” for the run
  difficulty. This is the clearest adjacent conflict.
- `main.ts:2114` announces sandbox setup as “Mark N · from bay N.”
- `ui/sandbox-screen.ts:141` and `ui/sandbox-screen.ts:309` expose Mark in the
  Tier S configuration UI.
- `ui/screens.ts:791` says Tier S is “set on the level select”; the public
  destination is the Tier S or sandbox setup screen, not a level selector.

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

## Other verified copy inconsistencies

### Tetrilaunch Unlimited is currently a store-integration stub

The purchase plumbing is implemented, but the entitlement currently unlocks no
gameplay, content, persistence, or cosmetic feature:

- `lib/purchases.ts` configures RevenueCat, reads the exact `Tetrilaunch
  Unlimited` entitlement, listens for changes, presents the paywall and Customer
  Center, and supports restore.
- The only application consumer of `isUnlimited()` is `main.ts:1788-1789`,
  which passes the boolean into `StoreState`.
- `ui/screens.ts:1173`, `1269-1280`, and `1671-1677` use that state only to swap
  “Unlock Unlimited” for an “Unlimited” badge and “Manage Subscription.” No
  game/progression module reads it.
- `docs/ios.md:98-116` explicitly says the entitlement unlocks a badge and
  nothing else. `docs/PLAY.md:41-45` correctly warns not to sell the product
  until benefits are implemented.

The configured store product is a **non-consumable**, not a subscription. The
RevenueCat entitlement reader itself is compatible with that product shape, but
most repository copy is not:

- `docs/PLAY.md:19-39` specifies a Play subscription, monthly base plan, and
  `$rc_monthly` package; the rest of that runbook tests renewal, expiry, and
  cancellation. It must be rewritten around a one-time Play product and the
  RevenueCat lifetime package used by the actual offering.
- `public/terms.html:78` and `131-183` describe Tetrilaunch Unlimited as an
  automatically renewing subscription, including recurring billing,
  cancellation, and access expiry. This is materially wrong for the product
  being sold.
- `public/support.html:103-108` tells purchasers how to cancel a subscription.
- `ui/screens.ts:1671-1677` shows “Manage Subscription” to every entitled user,
  and `lib/purchases.ts:180-193` opens Customer Center as subscription
  management. A lifetime owner instead needs a simple “Unlimited owned” state
  plus Restore Purchases; Customer Center should be shown only if it provides a
  useful non-consumable receipt/refund surface on the configured platforms.
- `docs/ios.md:98-116` and comments in `lib/purchases.ts`/`main.ts` describe
  renewal and expiry behavior that is irrelevant to the current SKU.

Until these surfaces are corrected, store configuration, paywall, in-app copy,
support, and legal terms describe different transactions.

The one consistent, approved benefit across the design history is **Contract
throughput**:

1. Free players may complete three daily Contracts. Failure and replay remain
   free and do not consume the allowance.
2. Unlimited removes that completion cap and provides on-demand/endless
   generated Contracts.
3. Deep Run remains uncapped for everybody.

The repository contains no historical coupling between Unlimited and Skydeck
access. Every implemented Skydeck gate goes through `game/meta.ts:690-691`'s
`skydeckOpen(meta)`, which requires the completed ladder and every seal;
`main.ts:1818-1831`, `1885-1892`, and `2850-2852` use that progression-only
result for the tower, ceremony, and leaderboard. Treat subscriber Skydeck
access as an unapproved idea unless the product decision is made explicitly.

The original design record (`docs/DESIGN.md:1139-1154`) also says cosmetics,
run history, and cloud save. Those are future-roadmap ideas rather than current
client capabilities: the same document's minimum shipping scope names only
“Unlimited with the daily cap,” and the later native/store guides describe only
Contract throughput. An earlier pre-design note proposed cosmetic skins, a
wider draft pool, and consumable continues; the subsequent design superseded
that list and explicitly rejected consumable power.

There is one indirect gameplay consequence that needs a product decision. Every
unique Contract first-clear is appended to `meta.claimedContracts`, including
clears beyond the three that can pay or advance the current Tier
(`game/meta.ts:1208-1235`). Five claimed Contracts unlock a third hazard-draft
choice used in later Deep Runs (`game/meta.ts:1368-1387`). Unlimited therefore
lets a subscriber reach that gameplay-affecting unlock sooner, even though the
extra Contracts award no salvage. This may fit the stated “progression speed,
never exclusive power” policy, but it conflicts with the strongest wording that
Unlimited buys nothing usable in Deep Run and must be acknowledged in paywall
copy and tests—or the draft-slot unlock must count only the free dailies.

None of the Contract-cap behavior is wired today. `game/contracts.ts:1384-1390`
always creates exactly `DAILY_COUNT` cards; no generator, board, or completion
path branches on `isUnlimited()`. Implementing the benefit also requires a
durable per-day completion allowance. `claimedContracts` can prove a specific
seeded card was cleared once, but there is currently no entitlement-aware cap or
on-demand-board state, and local-only persistence means reinstall/clear-data can
reset any client-only allowance.

Do not publish a paid paywall that advertises Unlimited Contracts against the
current client. When implementation begins, derive a small capability object
such as `{ unlimitedContracts }` from the entitlement instead of importing
purchase state into game modules directly. Keep allowance enforcement,
on-demand generation, payout eligibility, Tier progress, and the earned third
draft slot as separately tested decisions.

### Privacy and data disclosures

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

## Suggested implementation order

1. Correct the privacy policy and Play data-safety mismatch before store review.
2. Add a shared player-facing Tier/Skydeck formatter and replace literal Mark
   strings in UI and guide copy with focused tests for each surface.
3. Update README and design/play documentation, retaining `mark` only beside
   code symbols, database fields, and API examples.
4. Decide whether system upgrade “tier” becomes “rank,” then update those
   surfaces separately.
