# Lane 3 — Player-facing language: simplicity, coherence, correctness

Reviewed tree: `bde8746` (`origin/staging` @ #232 + `origin/release/1.0.6`).
Method: comment-stripped literal extraction from all 52 `app/src/**/*.ts` files (5,102 literals)
plus in-place reads. Nothing edited or committed.

---

## The five that most hurt a new player

### 1. P1 — Lesson 1 defines a term using two undefined terms
`app/src/game/school.ts:436`
```
`<b>Fill</b> a row in the zone and the press sells it.`
  + ` The <b>zone</b> is the floor beyond the bar.`
```
This is the **second sentence a first-time player reads**. Five nouns in 16 words (row, zone, press,
floor, bar), and it **defines "zone" in terms of "floor" and "bar", neither of which is defined
anywhere before or after**. "The press *sells* it" invokes money, which Flight School does not
introduce until lesson 5 (`school.ts:578`, "Shots cost $N"). And "floor" here means the bottom of the
bay, while three screens away "floor" means a Tier (`screens.ts:2741`, "7 more floors").

**Suggested fix:** `Fill a row past the red bar and the press clears it.` Name the bar on the
picture; move "sells"/pay to lesson 5.

### 2. P1 — One button, one action, two names
`app/src/ui/screens.ts:9214` vs `:9379`
```
9214:  data-action="contract-retry"  ->  "Try Again"    (Contract loss card)
9379:  data-action="contract-retry"  ->  "Play again"   (Contract win card)
```
Identical action, the two faces of the same modal, spelled two ways. **#231's "one casing" ruling
shipped as a source pin that greps only the literal `Play Again`** (`app/sim/systems.ts:18703`), so
the sibling label sailed through. "Try Again" also appears Title Case at `screens.ts:3297`, `:8572`,
`:8996`. The ruling's own rationale (`systems.ts:18684`: *"sentence case wins because it is what the
rest of the game already does"*) makes all four violations.

**Suggested fix:** `Try again` at all four sites; widen the pin to `/\b(Try|Play|Run It) Again\b/`.

### 3. P1 — The same mode has four names, and the screen titles itself with the retired noun
`app/src/ui/sandbox-screen.ts:333` — `<h2 class="display sbx__ttl">Level select</h2>`

`docs/COPY_AUDIT.md` flagged *"Tier S is set on the level select"* and reports it fixed — but it fixed
only the **pointer** (`screens.ts:1396` now reads "set on the sandbox setup screen"). **The
destination's own heading still says "Level select"**, and "Level" is the exact legacy noun the
contract replaced with "Bay". Around it the same mode is called:

| Name | Sites |
|---|---|
| **Sandbox** | `screens.ts:2290`, `main.ts:3566` (run-card title) |
| **Open Sandbox** | `screens.ts:2291`, `main.ts:3579` (button) |
| **Tier S** | `screens.ts:91, 999, 9246`, Controls door `screens.ts:3068+` |
| **Reconfigure** | `screens.ts:7395` (end-card button) |
| **rung** | `sandbox-screen.ts:334` lede — *"Fly any rung, any bay, any Contract"* |

Five names, **no guide entry at all** (`guide.ts` has no Tier S/Sandbox topic), on a mode any player
can open with nine taps on the tower beacon.

**Suggested fix:** "Tier S" everywhere; heading `Tier S setup`; button `Open Tier S`; lede "Fly any
Tier, any bay…".

### 4. P1 — "Tier" is capitalised on screen and lowercase in the manual, across 19 sites
The tower, hub, end cards and plates all say **"Tier N"**. `game/guide.ts` — the one place a confused
player goes — says **"tier"**, and uses it for two different things in one paragraph.
`guide.ts:511-517` is the worst:
```
summary: "Paid at tier milestones, spent in the Workshop, kept forever.",
body: `Salvage … Paid at <b>tier milestones</b> — each first-clear Contract, and the
  tier's first run win — and spent in the Workshop on permanent installs, plus a
  permanent <b>tier 2</b> of an installed system (tier ${MAX_TIER} stays the yard's).
  It buys … never your Tier: a Tier is won, not bought.`
```
Four lowercase + two capital in one paragraph, and the lowercase ones mean **two different things**
("tier milestones" = ladder Tier; "tier 2 of an installed system" = upgrade rung) — exactly the
ambiguity the contract's own bullet warns about. Same collision at `guide.ts:674-676`.

Other ladder-sense lowercase: `guide.ts:84, 512, 513, 609, 616, 651, 664, 754, 797, 798, 800, 801(x2)`;
`hazards.ts:361, 370` (shown on every draft); `sandbox-screen.ts:316, 323`; `screens.ts:1525` (aria-label),
`7392`, `9243`.

The drift happens **inside one paragraph** at `screens.ts:8710-8711`:
```
A <b>first clear</b> pays … and ticks the tier.
Clear <b>3</b> of them and win the Tier's run, and the next Tier opens.
```

**Suggested fix:** capital **Tier** for the ladder everywhere; take the contract's own advice and use
**rank** for system rungs (`guide.ts:504, 514, 515, 674, 675, 692`, `components.ts:735`).

### 5. P1 — The Full Game purchase screen overstates what it sells
`app/src/ui/screens.ts:2710` — **VERIFIED in place**
```
text: `Unlimited Contracts a day, instead of ${FREE_DAILY_CONTRACTS}.`,
```
`FREE_DAILY_CONTRACTS = DAILY_COUNT = 3` (`contracts.ts:137, 1949`), and **the board deals exactly 3
Contracts a day to everyone, owner or not** — `dailyBoard` is per-Tier and entitlement-independent.
What the entitlement removes is a cap on *first-clear banks per UTC day across every Tier*
(`contracts.ts:1946-1963`, `main.ts:2596-2608`).

"Unlimited Contracts a day" reads as "you get more Contracts dealt", which is false. The in-game
readout 5,600 lines away gets it right — `screens.ts:8327`: *"N of 3 **Contract clears** left today"*.
**The product's own two surfaces disagree about what was bought.** The code comment above the bullet
even states the correct intent (*"about a LIMIT being removed rather than content being added"*).

Same screen, one line up, `screens.ts:2692`:
```
text: `Tiers ${FREE_TIER_LIMIT + 1}–${MARK_COUNT} and the Skydeck earned above them.`,
```
This is `ad20806`'s "Skydeck earned, not bought" landing as a **dangling participle on a purchase
screen**: does "earned" qualify only the Skydeck, or the Tiers too? The one clause separating bought
content from earned content is the ambiguous one. The heading above says "7 more floors" while the
bullet names eight things.

**Suggested fix:**
`Every Contract you clear banks salvage — no daily cap (free: 3 a day).`
`Tiers 4–10. The Skydeck sits above them, and is earned by flying, not bought.`

**Severity note: purchase-copy honesty, store-policy adjacent.**

---

## A. `docs/COPY_AUDIT.md` audited adversarially

| Claim | Verdict |
|---|---|
| Step 2: *"`screens.ts`, `sandbox-screen.ts`, `main.ts`, `guide.ts` carry no player-visible 'Mark' any more"* | **FALSE — two sites survive.** `screens.ts:6184` `title="Every tier you own costs points against the Mark's cap"` and `screens.ts:7392` *"No salvage, no tier progress, no mark on the ladder"* (which uses both violations in one sentence). **P1** |
| *"'Level Cleared!' and 'tap to continue' both still exist"* (listed Still open) | **FALSE — both were fixed and the doc did not notice.** `screens.ts:5599` reads `BAY CLEARED`; `Level Cleared` survives only as a code comment (`screens.ts:7596`); `tap to continue` only in comments. The doc ships a "still open" section whose two named items are done. **P2 (doc honesty)** |
| *"'Unlimited' no longer appears in `screens.ts` … surfaces are '★ Unlock Full Game' / '★ Full Game owned'"* | **FALSE on both halves.** `screens.ts:2710` still says "Unlimited Contracts a day". Surfaces are **"Buy Full Game"** (`2610, 2760, 8336`), **"★ Buy Full Game"** (`3258`), badge **"Full Game"** (`2600`) — never "Unlock Full Game". **P3** |
| *"Tier S is 'set on the level select' … Now reads 'sandbox setup screen'"* | **Half true** — pointer fixed, destination still titles itself "Level select". See finding #3. |
| *"the bay banner's aria-label special-cases the roof to 'Skydeck'"* | **True** — verified at `screens.ts:4438`. |
| *"What is left on `tierText()` is exactly the compact plate the contract exempts"* | **Exemption over-claimed.** `screens.ts:7092`/`:7307` render `<div class="eyebrow">Bay ${n} cleared · ${tierText(tier)}</div>` → on the Skydeck: **"Bay 3 cleared · Tier SKY"** — a sentence fragment, not a 4-char plate, contradicting the bay banner inches above it which says "Skydeck". **P2** |
| New bullet: *"**Deep Run** is implementation vocabulary … no player-facing string uses it"* | **True.** Swept all 5,102 literals: zero rendered "Deep Run". Survives only in comments, docs, and the guide topic **id** `"deeprun"` (whose `name` is `"Run"`). **Clean rename.** |
| Contract bullet 14-15: *"Tier N is the player-facing name for … **run** …"* | **Self-contradictory** with the new bullet six lines below, which makes **Run** the name of the ten-bay mode. One needs deleting. **P3** |
| Step 4: system-upgrade "tier" → "rank" *"Not done, deliberately"* | **Confirmed still open**, and finding #4 shows it is now actively harmful. |

---

## B. PR #231's three rulings — completeness

**Ruling 1 (sentence case).** The pin at `sim/systems.ts:18697-18708` greps three files for the
literal `Play Again` only. Surviving Title Case labels that are sentences, not proper nouns:

| Site | Label | Note |
|---|---|---|
| `screens.ts:9214` | `Try Again` | same action as `:9379`'s `Play again` — finding #2 |
| `screens.ts:8572`, `:8996`, `:3297` | `Try Again` | |
| `screens.ts:2922` | `Start Run` | **same `data-action="play"`** as `:8841`'s `Start new run` |
| `screens.ts:8573` | `Back to Guide` | siblings are `Back to the shop`, `Back to the tower` |
| `screens.ts:8567` | `Lesson Landed` / `Run It Again` | siblings sentence case: `Not enough salvage`, `Free to fail`, `Pick your poison`, `Take a breath` |
| `screens.ts:9341` | `Contract Complete` | ditto |
| `screens.ts:3260, 3282, 3283, 3385` | `Restore Purchases`, `Sign Out`, `Delete Account`, `Keep Account` | |

(`Retry Run`, `Tier S`, `How to Play`, `Final Inspection`, `Continue with Google/Apple`,
`Start Flight School` are correctly exempt.) **P2**, except the two same-action pairs which are **P1**.

**Ruling 2 (grouped thousands on cards, bare in the live HUD).** The stated boundary is *"the cards a
player reads standing still group everything on them that reaches four digits"*
(`systems.ts:18628-18633`). **`TARGET_BASE = 1080`** (`level.ts:639`), so **every bay's funding target
is four digits from Tier 1, bay 1.** Three blocking cards print it bare:

- `screens.ts:5601` — bay-clear card: `<b>$${opts.funds}</b><span>banked / ${opts.target}</span>` → `$1234 banked / 1080`
- `screens.ts:7105` — ratchet draft modal: `` `$${opts.carry} · ended $${opts.funds}` ``
- `screens.ts:7313` — Final Inspection modal: same string

All three are `modal-scrim` / `panel modal` cards the game is paused for. One screen later the
run-end card says `$1,820 left` (`screens.ts:7798`). **The pin only exercised the run-end card and the
leaderboard, so the three cards a player sees thirteen times per run were never checked. P1** for the
ruling's own "whole card or none of it" principle. The live HUD (`screens.ts:4689`) is correctly bare.

**Ruling 3 (end card's Contracts door removed).** **Verified clean.** `screens.ts:8012-8014` renders
one ghost `Tower` button as the only hub door; no stray `data-action="contracts"` remains outside the
Skydeck-only branch at `screens.ts:9216`/`9335`.

---

## C. Terminology coherence — the real glossary

**The same thing, many names.** The numbered tower floor is called:

| Word | Sites |
|---|---|
| **Tier N** (contract) | tower plates, hub, end cards, HUD |
| **tier** | 19 player-facing sites (finding #4) |
| **floor** | `screens.ts:2741` ("7 more floors" — the *purchase* screen); `guide.ts:768, 770, 783` |
| **rung** | `sandbox-screen.ts:334` |
| **mark** | `screens.ts:7392` |

**The same word, many things** — the ones that actually stop a reader:

- **"floor"** = a Tier · the bottom of the bay (`school.ts:436`, `guide.ts:530`) · a numeric minimum
  (`guide.ts:625` "The floor is 45s"; `mods.ts:153`) · a slag layer (`drills.ts:279`) · bare grid
  (`upgrades.ts:468`, `preview.ts:368`). **Five senses. P1.**
- **"rung"** = a Tier (`sandbox-screen.ts:334`) · an upgrade step (`guide.ts:504, 674`) · a congestion
  threshold (`guide.ts:494, 530`; `drills.ts:190, 191`) · a step on a price curve (`guide.ts:623`).
  **Four senses. P1.**
- **"ladder"** = the Tier ladder · a price curve (`guide.ts:492, 615, 623`) · the upgrade track
  (`screens.ts:6299`) · the HUD chain ladder (`screens.ts:4017`). **P2.**
- **"bar"** = the compactor's sweeper (`guide.ts:398-399`, `school.ts:548`, `guide.ts:473`) · a rebar
  cube cluster (`guide.ts:212` *"The press cannot crush a bar either: it labours while bar stock
  stands in its path"*). Two things, same guide. **P1.**

**The compactor has four player-facing names.** `guide.ts:388-392` uses **"the press"** and **"the
compactor"** in one paragraph; the next article (`guide.ts:396-399`) is titled **"The compactor"** and
opens *"The red bar ping-pongs…"*; the axis and its drill are **"Sweeper"** (`guide.ts:639-640`,
`drills.ts:262`). A player meets "the press" first (lesson 1) and "compactor" is never connected to it.
**Suggested fix:** "the press" for the machine, "the bar" only for its moving part, "Sweeper" only as
the axis's proper name, and delete "compactor" from copy (keep it in code). **P1.**

**Smaller drift:**
- `screens.ts:8699` "The Contract Board" / `9216, 9336` "Contract Board" vs `screens.ts:8944` "The
  Contract board is open" and `guide.ts:324` "the Contract board". The lowercase one at `8944` is the
  **graduation** line — the player meets the wrong casing first. **P3.**
- `screens.ts:999` "Any Tier, **any** bay, **any** Contract" vs `screens.ts:1721` "Any Tier, bay or
  Contract". **P3.**
- The destination holding the run, Contracts and the Workshop is named **"Tower"** (`screens.ts:8013`),
  **"To the tower →"** (`8980, 8994`), **"Back to the tower"** (`9077`) and **"Main Menu"**
  (`screens.ts:3068`) — while the release notes and code call it the "tier hub", a phrase no player
  ever sees. Naming a four-region screen after one of its regions is the coherence cost of #223. **P2.**
- `main.ts:519-534` documents the pad Controls shortcut as covering *"the tower, the guide, the boards,
  the shops, the Tier S bench"*, but `PAD_CONTROLS_DOORS` (`main.ts:543-551`) has **no `tiers` key**.
  Cross-lane with the a11y/UX finding; flagged here because the comment's vocabulary went stale. **P2.**

---

## D. Simplicity and onboarding order

**Terms used before anything teaches them.** Flight School teaches aim, fire, rotate, row, press,
reload, streak/combo, funds, shot cost, lost cargo, clutter. It teaches **nothing** about Tier, Bay,
Contract, Salvage, Scrap, Workshop, Refit, Seal, ratchet/axis, Skydeck, rig, or Tier S.
Since #223 the tutorial is skippable (`screens.ts:2543` "Skip — just play"), so a player can land on
the hub taught none of it and read:
- `screens.ts:2194` — **"Clear a run · Contracts 0/3"**
- `screens.ts:2290/2291` — **"New Run"** / **"Start new run"**
- `screens.ts:2378-2393` — **"Workshop"** / **"Buy upgrades"** with a salvage glyph
- `screens.ts:2203` — **"Win a Tier with no bay retried to seal it"**

and **the hub has no How-to-Play door** (it is on the front door only, `screens.ts:2506`), so the
glossary is two taps back through a screen the player just left. **P2.**

**Guide topics that don't exist** for nouns on the hub: **Bay** (the game's fundamental unit — no
article, despite "Retry Bay", "Bay 3/10", "Bay Extension"), **Workshop** (a whole screen with a hub
button), **Tier S**. `guide.ts` has 30 topics and none of these. **P2.**

**Genuinely hard to parse on first read:**
- `school.ts:436` — finding #1. **P1.**
- `guide.ts:622-627` — *"Its ladder runs one rung ahead of the fuel levy's: money has an in-run answer
  and the clock does not. The floor is 45s…"* — four metaphors (ladder, rung, levy, floor) in two
  sentences, three overloaded elsewhere, and "the floor" here is a *minimum* while the article above
  uses "floor" for a Tier. **P2.**
- `finals.ts:823` — 41 words on a two-card Final Inspection modal where you must pick one under a
  clock (82 words total to choose between): *"…Only a deep liner beds a belt like this."* — "liner"
  is never defined (the system is called *Impact Cushion*) and "beds" is used as a verb. **P2.**
- `hazards.ts:438` — *"…the press labours against every bar it cannot crush"* — overloaded "bar" plus
  a verb no other string uses. **P2.**
- `screens.ts:1761` — Flight School run-card subtitle **"A Contract to go on"**. Go on with *what*?
  Reads as "a Contract to go on [the board]". **P2.**

---

## E. Button / label honesty

- **`screens.ts:8827-8846` — the shortfall card's dead-end branch has no door. P1.**
  When the Tier's run has already paid and today's Contracts are gone, the lede reads
  (`screens.ts:8830`) *"This Tier has paid out — the next Tier's Contracts and run pay again."* and
  the actions row renders only **"Not now"**: the "Start new run" primary is gated on
  `opts.runPays !== null && !opts.cards.length` (`:8840`), which is precisely the *other* case.
  The card's own doc comment (`:8795-8797`) claims it *"offers the next Tier's run"*. It does not.
  **A refusal that names a remedy and provides no route to it.**
- **`screens.ts:8768-8781` — the practice-bay offer (#232) asks a question neither button answers. P2.**
  Heading `Try it?`; **primary** = `Back to the shop` (= *no*), **secondary** = `${opts.drill} →`
  (= *yes*). The affirmative is the de-emphasised button wearing a proper noun the player has never
  seen, and nothing on the card says the bay is free or that it "never touches your save" (that line
  appears only *after* you fly it, `screens.ts:8567`). #232's stated intent — "offered, not launched by
  the next press" — is met, but the offer is now unreadable as a yes/no.
  **Suggested fix:** primary `Not now`, secondary `Fly the practice bay →`, add "free — nothing is
  banked or spent" to the lede.
- **`screens.ts:2378-2393` — the hub's Workshop button says "Buy upgrades" while disabled**, and the
  reason (`Opens after lesson 4` / `Opens after one Contract`) lives **only in the `aria-label`**.
  Sighted players get a dead button with no explanation; screen-reader users get the better
  experience. **P2.**
- **`screens.ts:3298`** — `Account sign-in is not configured in this build.` — raw dev-speak
  ("this build") shown to a player, in a branch that renders **no button at all**. **P2.**
- **Verified good:** control naming is properly abstracted per pointer family (`bindings.ts:384-395,
  420-440, 465-478`; `platform.ts:202` returns `["⌃⌘F","F11"]` vs `["F11"]`). No copy hardcodes a key
  that isn't on the device.

---

## F. Mechanical correctness

**Verified clean — worth knowing:**
- **Apostrophes:** 0 curly anywhere in `.ts` strings or `app/public/*.html`; 62 straight. Consistent.
- **Ellipsis:** only 2 sites, both `…`. No `...`.
- **Doubled words:** none.
- **Pluralization:** all risky counts are guarded (`screens.ts:1826`, `7796-7797`, `upgrades.ts:345`,
  `main.ts:2991`, `screens.ts:7212`). **No live plural bug found.** One latent trap:
  `hazards.ts:399` `${OPEN_CELL_NOTCH} open cell` is safe only because `OPEN_CELL_NOTCH = 1`
  (`hazards.ts:250`); its twin `finals.ts:619` already says "cells". **P3 — add the helper anyway.**

**Real defects:**
- **`guide.ts:470, 473, 474, 475` — lowercase `x` for a multiplier**, the only four in the game.
  Every other surface uses `×`, **including `school.ts:578, 583` which teaches the identical grade
  multipliers**: Flight School says `GOOD pays ×1.5`, the guide says `GOOD, x1.5`. **P2.**
- **`screens.ts:8838` — mixed unit marking in one sentence:** renders "Bond Breaker costs ⬡55 —
  12 short." First figure carries the currency glyph, second doesn't. **P3.**
- **Trailing-period drift on one panel.** The Player Account screen can stack: `Sign-in couldn't
  start — check your connection and try again.` (`:3296`, period) and `Account sign-in is not
  configured in this build.` (`:3298`, period) above `Sign-in didn't complete — try again` (`:2596`,
  none), `Deletion didn't complete — try again` (`:2581`, none), `Sign-out didn't complete` (`:2597`,
  none). **P3.**
- **Mixed English register.** British: `licence` (`screens.ts:90, 1078, 1091`; `guide.ts:332`),
  `labours` (`guide.ts:212`, `hazards.ts:438`), `practised` (`guide.ts:562`). American:
  `vaporize/vaporized/vaporizes` x5 (`drills.ts:278`, `guide.ts:701, 703`, `meta.ts:120`,
  `mods.ts:106`). Sharpest pair: `practised` against the button label **`Practice`**
  (`screens.ts:1942`). **P3.**
- **Glyph drift:** `screens.ts:3257-3258` uses a literal `★` while `screens.ts:2600, 2610, 2760, 8336`
  use `icon("star", 13)`. Same button family, two stars. **P3.**

---

## G. Tone and dead copy

- **`app/src/game/mods.ts` is unreachable player copy. P2.** Only `mulberry32` is imported from it by
  the app (`cannon.ts:4`, `autopilot.ts:38`, `game.ts:57`); `MODS` / `applyMods` / `draftOffers` are
  imported **only by `app/sim/systems.ts`**. The draft renders `HAZARDS` (`screens.ts:7082`) and
  `FINALS` (`:7297`). So ~10 authored descriptions never ship — including three that name keyboard
  keys with no per-profile branch (`mods.ts:106` *"Arm one (💥 / X)"*, `:117` *"HOLD the ⚡F
  trigger"*, `:176` *"Press B (or ⚡)"*). Harmless today, a landmine if the module is re-wired.
  **Delete or mark dead.**
- **Dev cheat strings are correctly tree-shaken** (`lib/sandbox-cheats.ts`, single call site inside
  `if (SANDBOX)`, `SANDBOX_MARKER` grepped by `verify-store-bundle.mjs`). `Mark := tier (now N)`
  cannot ship. **Verified clean.**
- **No placeholder/Lorem/TODO copy** in any player string. No raw exception text reaches a player;
  all `[auth]`/`[purchases]` prefixed strings are `console.warn` only.
- **Voice is otherwise strong and consistent** — `Take a breath`, `Free to fail`, `Pick your poison`,
  `Spend it all`, `Skip — just play`, `Not enough salvage` all sit in one register. The drift is
  confined to the Title Case headings in §B and the two dev-speak lines in §E.

---

## Cheapest high-value fixes, in order

1. `school.ts:436` — rewrite lesson 1's definition.
2. `screens.ts:9214`, `3297`, `8572`, `8996` → `Try again`; `:2922` → `Start run`; widen the
   `systems.ts:18703` pin beyond the `Play Again` literal.
3. `screens.ts:2710` and `:2692` — the two purchase bullets.
4. `sandbox-screen.ts:333` `Level select` → `Tier S setup`; `screens.ts:2290/2291` +
   `main.ts:3566/3579` → `Tier S` / `Open Tier S`.
5. `screens.ts:6184` and `:7392` — the two surviving player-visible "Mark"s, then correct the
   `docs/COPY_AUDIT.md` claim that says there are none.
6. `screens.ts:5601, 7105, 7313` — wrap in `num()`; extend the grouping pin to the draft, inspection
   and bay-clear cards.
7. `screens.ts:8840` — give the "This Tier has paid out" branch a button.
8. `guide.ts` — capital **Tier** for the ladder, **rank** for system rungs, and `×` at `470-475`.
