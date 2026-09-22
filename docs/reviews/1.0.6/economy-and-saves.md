# Lane 9 — Progression, economy, unlocks, save migration

Reviewed tree: `bde8746` (`origin/staging` @ #232 + `origin/release/1.0.6`).

**Lane verdict: hold the release.** The doc's headline save-migration claim is correct and was verified
exhaustively — no 1.0.5 save lights a spurious Unlock, swallows an earned unlock, or loses banked
progress. But three things the doc does **not** claim are true on this tree: a measured, unbounded
endgame **payout delta** vs v1.0.5 (which by the doc's own rule "reclassifies the release"), a
**save-wiping throw** in `loadMeta`, and **five lessons plus the Final Exam becoming permanently
unreachable** through the lesson card's own primary button.

**What was run:** `npm test` (green, exit 0); `npx tsx sim/sweep.ts --bays 1,2,3 --seeds 3 --bots
middle,lob` (clean, `Reproducibility check: PASS`); and five purpose-written probes against the real
`meta.ts`/`store.ts`/`contracts.ts` under a localStorage shim — a 1.0.5→1.0.6 upgrade matrix, an
adversarial-save matrix, a shortfall-boundary table, a Workshop shelf census, and an **A/B against
`git show main:app/src/game/meta.ts`** over an identical play log. Items marked **[measured]** came out
of a run. Probe scripts are in the session scratchpad (`ab.mts` is the one that matters for P1-A).

---

## P1-A — 1.0.6 silently closes the post-ladder salvage faucet. A real payout delta. [measured]

A/B over the **same** play log, v1.0.5 `meta.ts` vs this tree's:

| | ladder climb (10 tiers) | + 5 post-ladder cycles |
|---|---|---|
| **v1.0.5** | mark 10, **600** salvage | mark 10, **900** salvage |
| **1.0.6** | mark 10, **600** salvage | mark 10, **660** salvage, `tierRunDone=true tierContracts=3` (latched) |

A "cycle" is the ordinary finished-ladder day: three at-tier (Mark 10) Contract first-clears + one
Mark-10 run win. **The climb is byte-identical — the doc is right about that.** After the ladder,
v1.0.5 paid 60/cycle forever; **1.0.6 pays 60 once and then zero, permanently.** The delta grows
without bound.

### Mechanism — INDEPENDENTLY VERIFIED by this reviewer

- `meta.ts:1658` — `tierReady` returns null once `meta.mark >= MARK_COUNT`.
- **The recorders no longer call `advanceTier`.** On `main` (v1.0.5), `recordRunEnd:1631` called
  `advanceTier(next)` at `:1653` and `recordContractClear:1666` at `:1683`. On HEAD both return
  `completedTier: tierReady(next)` and `advanceTier` is reachable only from `claimTierUnlock`
  (`meta.ts:1676`).
- **`advanceTier` is byte-identical between the two trees** (diffed in full). It does
  `mark: Math.min(MARK_COUNT, meta.mark + 1)` — which **saturates** at the top — while still doing
  `tierRunDone: false, tierContracts: 0`.

So in v1.0.5 the recorders fired `advanceTier` at mark 10: the mark did not move, but **both halves
reset**, re-opening the four milestones the next day. On 1.0.6 they latch at true/3 and **nothing in
the codebase ever resets them.**

### Why it matters
The salvage shelf **[measured]** is **1785** — installs to `UPRATE_MAX_TIER` 2 (860), six rack slots at
50/70/100/140/180/240 (780), live unlocks `survey`+`scrap-cache` (145). **Lifetime income in 1.0.6 is
capped at 660.** The rack slots alone now exceed everything a player can ever earn. There is no other
salvage source (Skydeck banks nothing by design; `scrap-cache` pays run scrap).

v1.0.5's behaviour was arguably itself a bug — `finishRun`'s Skydeck guard comment
(`main.ts:6540-6550`) worries in so many words about "a daily that pays the ladder's once-per-tier
reward on repeat is a salvage faucet", and closed that door for the roof while leaving ordinary Mark-10
play wide open. **But whichever side is right, this is an undeclared change to banked income**, and
`docs/releases/1.0.6.md` states *"tiers and budgets untouched… Any payout delta in re-validation
reclassifies the release."*

**Needs an owner decision** (intentional close + a note, or a deliberate endgame faucet), not a silent ship.

---

## P1-B — `loadMeta` throws and wipes the whole save when `loadout` is null and the save has no filed run [measured]

```
runs0 loadout null   salvage=0 licence=0 unlocks=[] contracts=0  *** ALL PROGRESS WIPED ***
runs0 loadout ok     salvage=250 licence=10 unlocks=["survey"] contracts=2
```

`app/src/lib/store.ts:382`:
```ts
const walkedOn = meta.runs > 0 || meta.mark > 0 || ownedTracks(meta).length > 0;
```
`ownedTracks` (`meta.ts:1458-1460`) does `meta.loadout[u.id] ?? 0` on the **raw, unvalidated** loadout —
the validation that replaces a non-object with `newTiers()` is **56 lines later** at `store.ts:438`.
`null` → TypeError → the blanket `catch { return newMeta(); }` at `store.ts:500-502` discards 250
salvage, a purchased unlock and two claimed Contracts, **with no notice and no backup key**.

The `||` short-circuit hides it: any save with `runs > 0` or `mark > 0` never reaches `ownedTracks`.
So it bites exactly the save shape the licence rule exists to protect — **the returning player with a
rig and no filed run.**

This also falsifies the doc's *"corrupt values dropped key-by-key"*. That is true of `acked`
specifically; it is **not** true of the save as a whole — one bad key anywhere discards everything.

**PR #233's one-line narrowing incidentally removes this crash**, because it deletes the only
pre-validation read of `loadout`. The PR does not say so, and if anyone re-adds an `ownedTracks` term
later the crash returns. **The real fix is to move the loadout validation above line 382, or make
`ownedTracks` null-safe.**

---

## P1-C — The lesson card's own primary silently graduates the player; lessons 5–9 and the Final Exam become permanently unreachable

Chain, all code-read (no DOM harness was available to this lane):

1. `screens.ts:8979-8980` — after lesson 4 the ladder's next rung is the Contract gate, so the result
   card's primary is `<button class="btn btn--primary" data-action="tiers">…To the tower →</button>`
2. `main.ts:9358` — `case "tiers":` the state here is `lesson-end`, not `menu`, so it falls to `this.toHub()`
3. `main.ts:7486` — `toHub` calls `completeOnboarding` unconditionally when `!licenceDone`
4. `meta.ts:1279` — `licence = SCHOOL_FLIGHTS` (10)

**There is no door back:**
- `tierTowerHTML` draws the Flight School plinth only when `state.licensed === false`, and its own
  comment says *"the hub the tower lives on is always licensed by the time it renders"*
  (`screens.ts:1176-1180`).
- The tutorial offer is gated on `!settings.seenTutorial`, and `store.ts:407-408` **force-sets
  `seenTutorial` on every load** once `licence >= LICENCE_LESSON_COUNT` (4).
- The Workshop's "Continue Flight School →" only renders while `school && rigStarted`, i.e. while
  `!licenceDone`.
- `case "offer-tutorial"` (`main.ts:9426`) always calls `startLesson(0)` — lesson 1, not the owed flight.

Same effect from `lesson-exit` (`main.ts:9231` → `leaveSchool` `main.ts:5957` → `toHub`) and from
`examFailHTML`'s "Back to the tower" — i.e. **failing the Final Exam and pressing the card's second
button grants the licence you just failed to earn.** Afterwards `schoolProgress` reports 10/10, so the
game claims the player flew ten bays they never flew.

"Flight School is an offer, not a gate" is an acceptable intent. What is not defensible is that the card
hands you a **ladder hand-off** ("To the tower →", with the Contracts icon, having just told you
*"lessons 5 to 9 are open — carry on below"*) and the press **irreversibly deletes the rest of the
ladder**. **P1** on "progress lost, silently, with no confirmation and no recovery"; downgrade to P2
only if the team decides the school is disposable — in which case the lesson card must stop advertising
a ladder it is about to end.

---

## P2-A — The end card re-announces "Tier N complete! … Tier N+1 is open" with +0 salvage, forever [measured]

Three consecutive wins at a banked-but-unclaimed tier:
```
win #1 at Mark 3: end card prints  +0  "Tier 3 complete! ... Tier 4 is open"  (real mark still 2)
win #2 at Mark 3: end card prints  +0  "Tier 3 complete! ... Tier 4 is open"  (real mark still 2)
win #3 at Mark 3: end card prints  +0  "Tier 3 complete! ... Tier 4 is open"  (real mark still 2)
a 4th at-tier Contract: card prints +0 "Tier 3 complete!"
```
The recorders now return `completedTier: tierReady(next)` — a **standing predicate**, not the
false→true **edge** the old `advanceTier` returned. `main.ts:4371-4372` feeds it straight to the modal
and `screens.ts:7812-7823` prints the completion row on `tierCompleted !== null`.

Two problems, one regression each:
- **The repeat.** Impossible in 1.0.5 (the tier advanced on the spot) — a clean deferred-claim regression.
- **"Tier 4 is open" is false even the first time** — that is the entire point of the deferred claim.

*(This is the same defect the UX-flow lane found from the routing side; both lanes reached it
independently. See `ux-flow.md` finding 3.)*

**Fix direction:** gate the completion row on the event that actually banked something (`salvage > 0`,
or thread the edge through `TierResult`), and reword to "Tier 4 ready — press Unlock on the hub".

---

## P2-B — The paywall boundary: three Contract chips promising +15 that pay 0, under an Unlock button that can never light [measured]

```
mark=3 full=n  markUnlocked=4 contractsTier=3  cardTiers=[3,3,3]  hub quotes +15 each, ACTUAL paid=[0,0,0]
free player mark=3 cleared all 3 cards -> tierContracts=0, salvage=0, unlockReady=false, nextStep=contracts
```
`contractsTier` (`main.ts:2556-2561`) clamps the board to `FREE_TIER_LIMIT`=3 while `markUnlocked` is 4,
so `recordContractClear`'s `contract.tier === tier` is false for every card: **no salvage, no quota tick,
forever.** Meanwhile:
- `screens.ts:2298` — each chip advertises **+15** and the aria-label says "pays 15 salvage";
- `screens.ts:2185` — the hub's headline is a ceremony-ringed "**Unlock Tier 5**" with a 0/3 legend that
  can never fill;
- `nextStep` stays `"contracts"`, and the `contracts:${day}:${mark}` identity means the alert mino
  **re-lights every morning** pointing at cards that can never satisfy it;
- the new shortfall card (`main.ts:6894` `shortfallOffers`) **offers those same 0-pay Contracts** as the
  answer to "you can't afford this".

The underlying economics are **pre-existing** — `contractsTier` and `recordContractClear` are
byte-identical to v1.0.5, and v1.0.5's `menuContractsSub` quoted the milestone unconditionally too.
**What 1.0.6 adds is three per-card "+15" promises, the ceremony ring, the daily badge and the shortfall
card, all aimed at a dead end.** This is the closest thing to a softlock the hub redesign's gating
produces, and it is on the paywall boundary — a support/refund surface.

---

## The upgrade matrix — the doc's claim holds [measured]

Matrix over `mark` ∈ {0,1,5,9,10,11,99} × `tierRunDone` ∈ {n,Y} × `tierContracts` ∈ {0,2,3}, `acked`
absent, licence 10, with and without Skydeck seals:

- `mark` 0–9, run ✓ **and** contracts ≥3 → `unlockReady=LIT`, `nextStep=unlock`. **The only lit state.**
- `mark` 0–9, any other combination → not lit; `nextStep` = `contracts` or `run` as appropriate.
- `mark` ≥ 10 → never lit; `nextStep=seal`.
- `pendingLadderRide` false on every 1.0.5 shape — **no ceremony fires on upgrade.**

**No combination lights a spurious Unlock, swallows an unlock, or loses banked progress.** The reason is
structural: `advanceTier` is byte-identical and carries no `mark` guard, so it always fired the instant
both halves were true — **no 1.0.5 save can physically carry `tierRunDone && tierContracts >= 3`:**
```
post-advance 1.0.5 save at mark 1: unlockReady=false nextStep=contracts
post-advance 1.0.5 save at mark 5: unlockReady=false nextStep=contracts
post-advance 1.0.5 save at mark 9: unlockReady=false nextStep=contracts
post-advance 1.0.5 save at mark 10: unlockReady=false nextStep=seal
```
The doc's "worth one explicit test with a real save" — **done, and it holds.**

**By design but worth stating:** 1.0.6, player never presses Unlock → mark stays 0 and salvage stops at
60 [measured]. The whole ladder now waits on one button. The badge points at it, but there is no timeout
or nag.

**Downgrade / cross-device: moot, because there is no sync.** `grep` over `src/lib/api.ts` finds no
reference to `meta` at all; only scores go to D1. A 1.0.6 save reaches a 1.0.5 client only via a
same-device downgrade, where `{ ...newMeta(), ...raw }` keeps `acked` as an unknown own property and
`JSON.stringify(m)` writes it straight back — **`acked` round-trips through a 1.0.5 client untouched
[measured]**. No strict parse anywhere.

**Corrupt / adversarial saves [measured]:** `acked` handling is exactly as advertised — `null`,
`"junk"`, `7`, `["contracts"]`, `{contracts:5}` and `{"__proto__":{...}}` all load as `{}` or drop
key-by-key, no throw, **no prototype pollution**. `mark` as string/null/`"NaN"`/negative → 0;
`mark: 1e400` → 0. `salvage: -1e9` → 0. `licence: 1e9` → clamped to 10. `unlocks: null`,
`loadout: 0/[]/"x"` all degrade cleanly. **The two paths that throw and wipe:** P1-B, and a whole save
that parses to `null`/truncated JSON (P3 — `getItem(…) || "{}"` only catches the empty string).

**`claimTierUnlock` is idempotent and safe [measured].** Double tap: `mark 3 → 4` on the first call;
second returns `completedTier: null, salvage: 0`. Not reachable during a run. **One latent:**
`claimTierUnlock` has no `mark < MARK_COUNT` guard of its own — only `tierReady` does. Called at the
finished ladder with both halves latched it resets them and reports `completedTier: 10`. Pays 0 today,
and `main.ts` guards it, but the invariant lives in the caller. P3; pin it.

**#228 / Skydeck entitlement — correct, no mismatch.** `skydeckOpen` (`meta.ts:885`) requires
`mark >= MARK_COUNT` **and** every Mark sealed; `tierOpen(SKYDECK_TIER)` reads `state.skydeck`, which
`main.ts:2654` sets to `fullGame && skydeckOpen(meta)`. The roof is genuinely **earned** and **behind
the entitlement**; the copy change now matches `terms.html`/`support.html`/DESIGN.md. `purchases.ts`'s
+60 is pure hardening of the desktop boundary, and the desktop carve-out grants *more*, never less.
**No entitlement/refund exposure found.**

**`510f009` shortfall arithmetic — correct at every boundary [measured].** `short = Math.max(0, cost -
have)`; `have` read fresh each render. 15/15 → no refusal; 14/15 → short 1; 16/15 → no card; 0/0 → no
card. The press-site predicate is the *same expression* the button rendered, so the card can never name
a price the button did not print. **Clean.** The only complaint is P2-B: the *offers* can be worth 0.

**Economy: climb untouched.** `git diff main...HEAD` is **empty** for `level.ts`, `hazards.ts`,
`belt.ts`, `contracts.ts`, `finals.ts`, `upgrades.ts`. `run.ts` is +10 of comments; `game.ts` +6 stores
`readonly seed` for the music coin; `drills.ts` is two copy strings. **No D1 board clear needed** —
score computation is untouched. P1-A is a delta the diff cannot show because it lives in *timing*.

---

## PR #233 — land it, but its title claim does not hold and it is a v1.0.5 fix

**Diagnosis reproduced independently [measured]**, and worse than stated:
```
saved licence  4 (1 system owned) -> loaded 10  <-- CHANGED
saved licence  5..9 (1 system owned) -> loaded 10  <-- CHANGED
  -- no system owned: licence 4 -> 4, 5 -> 5, 9 -> 9
  -- salvage>0 but no system: licence 4 -> 4   (so it is ownedTracks, precisely)
```

Two corrections to the framing:

1. **It is not a migration.** The branch is taken on *every* load (`rawLicence` is a number, so the
   ternary never falls through), so it re-fires each time the app opens. And `store.ts`'s licence block
   is **byte-identical between `main` (v1.0.5) and this tree** — `git diff main...HEAD -- store.ts` is
   the `acked` hunk and nothing else. **So this is a shipped v1.0.5 bug, not a 1.0.6 regression.**
2. **The fix is correct but not sufficient for its own title.** With it applied the mid-school save
   survives `loadMeta` — and is then graduated by the first press of Play anyway, because
   `store.ts:407` force-sets `seenTutorial` once `licence >= 4` and `toHub` calls `completeOnboarding`
   unconditionally. Same end state, one save-write later. **"A mid-school save survives being closed" is
   not achieved until P1-C is answered.**

**The load-bearing assertion holds.** "The ladder does not let a player file a Deep Run before
graduating" — verified from the gating, not the comment: `runs`/`bestBay` are written only by
`recordRunEnd`; `finishRun` returns early without `this.run`; `startGraduation` sets `this.run = null`
so the Final Exam files nothing; `startGame` re-checks `tierOpen`, which asks `state.licensed`; the
sandbox run is excluded; the save-editing cheats are SANDBOX-only and Rollup-stripped. For `mark`: it
moves only through `claimTierUnlock`, only pressable on the hub, which graduates first. **On any save
this build can author, `runs > 0 || mark > 0 ⟹ licensed`.**

**The stated recovery path does not exist.** *"the new ladder puts it on the Contract rung… the ladder
carries it forward on its own"* is true of `schoolLadder` in isolation and **false in the app** (P1-C).
The comment should not promise it.

**The moved pin is sound in substance, misnamed in fact.** The fixture no longer contains a system, so
the pin's **name is now false** and it duplicates the pin above it. Rename or delete it.

### Siblings of the bug class

| Predicate | Location | Verdict |
|---|---|---|
| `walkedOn` | `store.ts:382` | **BROKEN** — #233. Plus it carries P1-B. |
| `seenTutorial` force-set | `store.ts:407-408` | **BROKEN, same class.** Infers "the coach is retired" from `licence >= LICENCE_LESSON_COUNT`, which on the new ladder is exactly the mid-school state. **Removes their only door back into school. #233 does not touch it** — this is the second half of P1-C. |
| `played` | `store.ts:363-366` | Safe *by accident* — consulted only when `licence` is absent entirely. But it is broader (`salvage > 0` alone grandfathers), so if `licence` were ever renamed every mid-school player graduates instantly. Worth a comment. |
| `slots` fallback | `store.ts:471-473` | Same family — infers slot count from `ownedTracks(meta).length`. Safe for a different reason (monotone and generous). "One-time" is an accident of write-back. Worth a pin. |
| `celebratedMark` | `store.ts:322-325` | **Clean.** Reads only its own axis, clamped to `[0, mark]`. |
| `acked` / `nextStepIdentity` | `meta.ts:2104-2143`, `store.ts:477-494` | **Clean — not in this family, contrary to the suspicion.** The identity is derived from the same state `nextStep` reads and asked, never written, so no mutator can forget it. `unlock:${mark+1}` re-lights correctly per tier [measured]. |
| `licence` upper clamp | `store.ts:385` | A save from a future build with a longer ladder loses its position. Inert today. P3. |

---

## Ranked

| # | Finding | Severity | Confirmed by |
|---|---|---|---|
| P1-A | Post-ladder salvage faucet closed; 900 → 660 over 5 cycles, unbounded; 1785 shelf vs 660 lifetime income | **P1** | A/B run + independent diff of `advanceTier` call sites |
| P1-B | `loadMeta` wipes the entire save on `loadout: null` + no filed run (`store.ts:382`) | **P1** | Run |
| P1-C | Lesson-4 card's "To the tower →" silently graduates; lessons 5–9 + Final Exam unreachable | **P1** | Code read |
| P2-A | End card repeats "Tier N complete! … Tier N+1 is open" with +0 while the claim is deferred | **P2** | Run |
| P2-B | Free player at mark 3: three "+15" chips paying 0, unsatisfiable Unlock, daily badge, shortfall card | **P2** (pre-existing economics, new surfaces) | Run |
| P3-a | `mark`/`salvage` unclamped above on load (`store.ts:302/304`) | P3 | Run |
| P3-b | Whole-save `null`/truncated JSON wipes with no backup key | P3 | Run |
| P3-c | `claimTierUnlock` has no `mark < MARK_COUNT` guard of its own | P3 | Run |
| P3-d | #233's moved pin name no longer matches its fixture | P3 | Diff read |
