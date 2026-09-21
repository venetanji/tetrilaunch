# Lane 11 — What fell between the pull requests

Tree audited: `bde8746` (`origin/staging` `37b0f66` ∪ `origin/release/1.0.6` `774a9c7`).
This lane owns the **seams** — semantic conflicts that arise when several PRs that each passed review
land on the same branch. Git merged them cleanly; that is exactly the problem.

---

## 0. Verified by running — the release's own claims hold

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** (`tsc --noEmit` x2) |
| `npm run test` (`tsx sim/systems.ts`) | **exit 0**, "All systems checks passed" |
| `npm run build` | **exit 0**; PWA precache 92 entries / **42,711 KiB** |
| `npx tsx sim/uifit/run.ts` | 23-device fleet, 164 screens: **235 baselined, 0 new** |
| `node desktop/scripts/check-version.mjs` | "version 1.0.6 (app and desktop agree)" |
| `RELEASE_TAG=v1.0.6 …check-version.mjs` | "matches tag v1.0.6" |
| `node scripts/verify-store-copy.mjs` | 11/30, 70/80, 1442/4000 — green |
| lockfiles | app + desktop, both `version` and `packages[""].version` = 1.0.6 |

### Methodological caveat, stated honestly
**Other reviewers in this same audit were mutating the tree during these runs.** The first fleet run
reported 3 new violations (`.tierhub__pay` textclip); its log shows **4 `[vite] hmr update app.css`**
events mid-run, and `git diff` at that moment showed another reviewer had changed
`@container rail (min-height: 470px)` → `360px` (`app.css:1389`) while testing #230's proposed fix —
since reverted. A re-run on a checksum-verified-clean `app.css` reported 443 new violations, **all 443
from 12 "ZZ ·" probe devices another reviewer had injected** into the uifit harness (also since
reverted). Filtering those leaves **0 new on the real 23-device fleet**.

**The tree is green. But any number produced by any agent during this review window needs the same
control applied.** This is a limitation of running eleven reviewers against one working tree.

---

## 1. P1 — THE SHIPPED BUG. The tutorial's own "continue" button deletes lessons 5–9.

**Two changes collided, both inside #223 (`c47f986`), two commits apart:**

| | commit | what it did |
|---|---|---|
| A | `89c0495` "Optional onboarding…" | added `completeOnboarding()` and made `toHub()` call it — `main.ts:7485-7488` |
| B | `510f009` "…the shop loses its foot" | re-pointed the lesson-end card's forward primary from `data-action="contracts"` to `data-action="tiers"` |

**VERIFIED by diffing both trees:**

| | v1.0.5 (`screens.ts:8258`) | 1.0.6 RC (`screens.ts:8980`) |
|---|---|---|
| Contract rung's forward primary | `data-action="contracts"` → **"Contract board →"** | `data-action="tiers"` → **"To the tower →"** |

**The chain:** `screens.ts:8980` → `main.ts:9369` (`case "tiers"` … `else this.toHub()`) →
`main.ts:7486` `completeOnboarding` + `saveMeta` → `meta.ts:1279` `licence = SCHOOL_FLIGHTS` (10).

**Proven by running it** (`meta.ts` imported directly):
```
BEFORE (just cleared lesson 4):
  licence = 4 of 10 | next rung = {"kind":"contract"} | ladder = xxxx........
AFTER one press:
  licence = 10 of 10 | next rung = null              | ladder = xxxxxxxxxxxx
  LESSONS SKIPPED = 6 (lessons 5-9 + the Final Exam)
```

### Why this is the worst possible button to have re-pointed

- **It is the primary**, under the card's own copy (`screens.ts:8944`): *"That is the four basics. **The
  Contract board is open** — clear one card and it pays for your first system."* The comment above it
  (`screens.ts:8966`) states the intent: *"ONE primary, and it is the way FORWARD wherever there is
  one."* **Forward and abandon are now the same press.**
- **A guard exists and is bypassed.** `main.ts:9301` — `case "contracts"` routes `!licenceDone(meta)`
  to the real school board. That branch was written for exactly this rung, under the comment: *"The
  guard is here rather than at each door because a door nobody has thought of yet must still not open
  the old room."* **The re-pointed button never reaches it.**
- **Asymmetry is the tell:** the *next* rung's forward button is `data-action="workshop"`
  (`screens.ts:8982`) → `setState("workshop")`, which is **safe**. Only the Contract rung's door is
  destructive. `510f009`'s "the board screen is retired for tiers" reasoning was applied to the
  school's card, which its own commit message explicitly exempts ("the board screen is the Skydeck's and
  the school's alone").
- **No reload required** (unlike #233).
- **No pin catches it:** `sim/systems.ts:28115-28165` pins the exam rung, the middle rungs and the last
  rung, but never `next: "contract"` — which is why `npm test` is green.
- Every other exit is destructive too: the Workshop's ✕ (`screens.ts:6462`), the Contracts ✕
  (`screens.ts:8433`) and Escape/pad-B (`main.ts:8742-8743`) all land on `toHub()`. The Workshop has the
  one safe door — `schoolGo` → `data-action="play"` "Continue Flight School →" (`screens.ts:6494`).

**#233 does NOT fix this.** #233 changes only `loadMeta`'s `walkedOn` predicate (`store.ts:382`),
2 files / 63 lines. **A different mechanism entirely.**

*(The economy lane reached the same defect independently from the save-state side — see
`economy-and-saves.md` P1-C. Two lanes converging from opposite ends.)*

**Fix shape:** send the Contract rung's primary back to `data-action="contracts"` as v1.0.5 did
(`main.ts:9301` already has the school branch waiting for it), and decide separately whether `toHub()`
should force-graduate at all while `schoolNextStep(meta) !== null`.

---

## 2. The #233 dating question — answered, and it cuts both ways

**#233's own mechanism is genuinely pre-1.0.6. Confirmed:**
- `walkedOn` (`store.ts:382`) and the Workshop rung between lessons 4 and 5 (`meta.ts:1127-1137`
  `SCHOOL_LADDER`) were introduced by **the same commit**, `d2350b7` "Flight School becomes a
  twelve-step ladder, and the two shops are steps on it", **2026-09-08**.
- `git merge-base --is-ancestor d2350b7 main` → **YES**. `main` = v1.0.5 (`d7419f4`, 2026-09-14).
- `git show main:app/src/lib/store.ts | grep walkedOn` → present on v1.0.5.

So the author's "pre-existing, not introduced by the 1.0.6 train" is **correct** — but the framing can be
sharpened: the rule and the rung shipped *together*, so it never "stopped being sound"; it was **born
unsound and shipped in v1.0.5**.

**However, the reclassification runs the other way too.** 1.0.6 adds a *second*, worse force-graduation
path — §1 — which needs **no reload** (so the QA restart #233 adds to the pass will not catch it), fires
from the ladder's own **primary button** rather than a migration heuristic, and is **not covered by
#233's fix**. **Landing #233 and calling the save-data question closed would be a mistake.**

---

## 3. #228 — the flagged one. CLEAN. Negative result.

The brief flagged #228 as highest-probability because its green checks were attached to the old base.
Verified line by line:
- `ad20806`'s parent is `d7419f43` — **exactly the merge-base with `main`**, confirming it was cut from
  v1.0.5 and never rebased. **The premise of the flag is true.**
- Its merged result (`git diff 3c46d52^1 3c46d52`) is **exactly** the author's intent: one string +
  comments in `previewLines()`. #223 *moved* that function (2331 → 2683) but changed nothing inside it,
  so **there is no semantic merge damage**.
- The sim pin it edited holds against the current `FREE_TIER_LIMIT`/`MARK_COUNT` — `npm test` green.
- The 7-char-longer string **was** measured: `sim/uifit/fixtures.ts:918-920` gives the sheet three
  fixtures; the fleet run reports 0 new.
- Its check runs (API): `fit` **success**, `fit-webkit` **success**, `apk` **success**, all started
  2026-09-21T05:33 — i.e. *after* the retarget. (`bundle` "skipped" is its normal tag-only gate.)
- Copy consistency holds: `app/public/terms.html:147` and `docs/PLAY.md:38-39` already say what #228
  made the sheet say.

**No bug found in #228.** The highest-probability location turned out to be **#223's own interior**.

---

## 4. Ordering hazards — traced

**Play through #223 → #227 → #232: fine.** The front door's Play is `data-action="tiers"`
(`screens.ts:2496`). #227 hooked `autoEnterFullscreenForRun()` onto it at `main.ts:9368`, guarded by
`this.state === "menu"` — correct: the six *other* `data-action="tiers"` surfaces don't fire it. #232
never touched this button. **The damage is on the other consumer of the same action — the lesson-end
card (§1).**

**P2 — #221 vs #227 fullscreen: no double-toggle, but one guard bypassed.**
The two entry points do *not* fight: #221's Settings row is a live mirror that writes no setting and
reconciles from `isFullscreen()` (`main.ts:9697-9707`), `requestFullscreen` early-returns when already
fullscreen (`platform.ts:168`), and `onFullscreenChange` re-syncs both. **Clean.**

**The seam:** `autoEnterFullscreenForRun` (`platform.ts:210-213`) gates on
`isCoarsePointer() && !isStandalone() && !isFullscreen()` — **it never checks `isDesktop`**. #221
deliberately removed *every* in-game fullscreen control from the Electron shell
(`fullscreenButtonShown = fullscreenSupported() && !isDesktop`, `platform.ts:147-149`) on the rationale
that desktop uses F11/⌃⌘F and the Settings switch. **On a touchscreen Windows/Linux laptop running the
desktop build, `pointer: coarse` is true** — so #227 puts the app into DOM fullscreen on the first Play
press, an entry #221 ruled out, with no in-game control to leave by. Narrow, but it is literally a guard
added by one PR bypassed by a path added by another.

---

## 5. P2 — `pickTier`'s silent no-op (the #226 x #223 seam)

`main.ts:3127-3129`: `const shaft = this.overlay.querySelector(".tower__shaft"); if (!shaft) return;`
`.tower__shaft` is emitted **only** by `tierTowerHTML` (`screens.ts:1155`), called **only** from
`tierHubScreen` (`screens.ts:2332`). The front door has none.

**On a real player's path this is safe** — all three callers checked:
- `case "pick-tier"` (`main.ts:9054`) — the floor only exists on the hub.
- `case "play"` with `data-tier` (`main.ts:9017-9030`) — sets `pickedTier` directly, no DOM.
- pad-confirm while celebrating (`main.ts:8868`) — safe because `setState` clears `celebrating` on the
  way out of `"tiers"` and it is armed only on `"tiers"`.

**In the shipped harness it is not:**
- `sim/promo/run.ts:1071-1073` calls `pickTier` with **no `setState` at all** → the app is on `"menu"` →
  silent no-op → the `tier-hub` store scene photographs the **front door**. `beats.ts:726` even carries
  the warning *"RE-SHOOT after #223"*. **This is what #230 reports.**
- The `leaderboard` scene fails **loudly** instead.
- **`sim/promo/run.ts:757-760` is a third instance #230 may not cover.** The `"ride" in show` DOM phase
  does `setState("menu")` then `pickTier(show.from)` — silently broken the same way, and it is the
  **beats/video** path (`beats.ts:503`), not the scene list. **Worth flagging to #230's author:
  `from: "tiers"` on the two scenes does not fix the ride branch.**
- `sim/systems.ts` pins only that `tier-hub` is *shot at every size* — never that it shows the hub.
  **The pin passes while the shot is wrong.**

---

## 6. P2 — other seams

**`windInkLast` is never reset (#229 interior).** `main.ts:956` declares it, `main.ts:8438-8440` is the
only write, **nothing resets it** — not per bay, not per HUD remount, not per state change. Its immediate
neighbour `strokeCueHalf` (`main.ts:950`) is the identical pattern and **is** reset at `main.ts:5217`
and `5913`. After a remount, `windNotchHTML`'s inline `--wind-ink` (`screens.ts:3902`) and the stale
cache can agree-by-accident and suppress the first needed write, leaving the fill painting the previous
bay's colour. **Transient today only because `windInk` is continuous; it becomes a whole-bay wrong
colour the day `windInk` returns discrete steps.**

**#231's `num()` groups by quantity, not by surface — contradicting its own stated rule.** `num()` is
applied to the lifetime salvage total on the end cards (`screens.ts:7823, 7832, 9298, 9309`) but **not**
to the same number on the two screens the player lands on next:
- tier hub bank — `screens.ts:2378` `salvageHTML(salvage, 16)`
- Workshop chip — `screens.ts:6460` `salvageHTML(meta.salvage, 16)`
- shortfall card — `screens.ts:8834` `salvageHTML(opts.have, 12)`

Salvage reaches four digits well before the end of the ladder (the promo's own `sealed` fixture uses
`salvage: 4_100`). **So the run-end card reads "4,100 salvage banked" and the hub one press later reads
"4100"** — precisely the *"'98,760' and '$10240' one line apart read as a typo"* failure `components.ts`'s
own `num()` doc argues against. Both surfaces were built by #223; #231 landed after and missed them.

**No `sealBehindScrim` on `sys-drill-offer` / `ws-short`.** `main.ts:4016-4028` and `4033-4044`
concatenate `workshopScreen(...)` + a `.modal-scrim` modal but never call `sealBehindScrim`. **The pad is
protected** by `padNavRoot()` (last scrim wins) — checked specifically, so **#232's premise does hold for
a controller**. But Tab/keyboard still walks into the live Workshop under the question. Both screens are
#223's. *(Overlaps the a11y and UX lanes; flagged here as the seam that caused it.)*

---

## 7. P3 — doc rot created by the merges

- **`screens.ts:3860-3874` contradicts `screens.ts:3881` and `app.css:11845-11880`.** The
  `windNotchHTML` header (written by `d70986c`) still says the fill is *"one gradient, so the colour IS
  the length — no per-frame colour maths"* and that a negative scale mirrors it *"arrowhead and all"*.
  `8be7c3b` **reversed both** — `windInk` now chooses the colour per frame, and the CSS three screens
  away says *"ONE FLAT COLOUR … NOT a gradient the length reveals"* and *"There is no arrowhead"*.
  **Two commits of the same PR, opposite claims.**
- **`main.ts:8865-8866`**: *"`celebrating` is only ever true on the menu"* — it is armed on `"tiers"`
  (`main.ts:1595`). `syncMusic`'s equivalent comment (`main.ts:1755`) **was** updated to say "the tier
  hub"; this one was missed. Harmless today; it is the comment that justifies the missing state guard.
- **`app/sim/_scratch-*.ts` — 20 tracked files.** **None added in 1.0.6**
  (`git diff --diff-filter=A main...HEAD | grep -c _scratch` → 0), so not a release leftover, but worth
  surfacing once.

## 8. Leftovers scan — clean

- **Zero** TODO / FIXME / XXX / HACK / `@ts-ignore` added across the 14.6k-line diff.
- `console.log` additions are all in `sim/promo/*` CLI tooling (legitimate), plus two `console.warn`s
  behind desktop store gates.
- `/about` (773 lines + 1.6 MB gallery) is correctly excluded from native builds.
- `secrets/` ships only its README. **The README does publish the Apple team ID and App Store Connect
  key ID `2LJZZAQXWR`** — identifiers, not secrets, but a disclosure if the repo is public.
- New files in the diff are all intentional.

---

## 9. Release plumbing — what CI actually ran, and the current merge order

**No `ui-fit.yml` push run on `staging` exists after `43db473` (#221, 2026-09-21T03:37).** The 15 most
recent staging runs stop there. **Every merge from #223 onward — #223, #225, #226, #227, #229, #228,
#231, #232 — has no staging-push validation**; only `pull_request` merge-ref runs. Since each PR's base
happened to be the immediately preceding merge, coverage is near-complete in practice, but **the branch
as it now stands has never been measured by CI as a branch.** That is the same failure shape as the
doc's own "A base change does not re-run CI" lesson. The local run closes the gap: **green**.

**`origin/release/1.0.6` does not contain `37b0f66`.** `git log origin/release/1.0.6..origin/staging` =
`37b0f66` + `200add2`. **PR #224's head is one merge behind staging**; it must re-merge staging before it
can be the tagged tree.

**Release-doc accuracy on the audited tree — stale by two merges, and upstream has already moved.**
On the audited tree, `1.0.6.md:20-21` says the open PRs are "#230 and #231" (#231 landed as `bd308a8`),
the "order staging actually carries" table stops at **#228**, and line 288 says *"What is left is step 5
… after #231 lands"*. **However** — a newer release-branch commit `85f1c9c1` *"1.0.6: the release page
records #231, #232 and #233"* (2026-09-21T16:53) is **not on the audited tree and already fixes this.**
Recorded as a property of the RC reviewed, not as outstanding work.

**Correct order now:** #233 (save-data) → #230 (owner decision, also carries a genuine `app.css`
Contract-preview breakpoint fix) → re-merge staging into `release/1.0.6` → #224 last.
**The documented plan ("merge #231 then #224") is superseded.**

## 10. #224's open items — which actually block

| Item | Verdict |
|---|---|
| **"Is there a 1.0.5 save on the test phone to load against deferred claim, or seed one?"** | **RELEASE-BLOCKING, and the one the team has under-weighted.** The merge-train table's own re-validation column for #223 lists *"a real-save load test (see the risk list)"* — and the Still-open list shows no such save exists, so **that listed step for the headline PR was never performed.** It is the single test that would have caught both #233 and §1. |
| "Play internal and TestFlight go out on the tag — is the closed beta expecting this build?" | **Blocking as a gate**, given §1: the tag auto-publishes to Play internal and TestFlight. |
| **"Should the Unlock ceremony be skippable on a pad (A)?"** | **Already implemented and shipped — close it.** `main.ts:8862-8871` routes `PAD_CONFIRM` while `celebrating` through `pickTier`'s dismissal-only branch, with an explicit Steam Deck / #218 rationale. *(Independently confirmed by the a11y lane.)* |
| "Steam: playtest depot upload after the tag?" | Process, not blocking. |
| Three unchecked version-bump boxes | Assertions, not work. `check:version` verified green both ways. |
| #230 App Store scene decision | Owner decision; out of scope per brief. |

---

## Recommendation

**Do not tag.** §1 is a silent save-data loss on the exact flow 1.0.6 is about to playtest, reachable in
one press from the ladder's own forward button, with no reload required and no pin guarding it.

The one-line shape of the fix is to send the Contract rung's primary back to `data-action="contracts"`
as v1.0.5 did (`main.ts:9301` already has the school branch waiting for it), and to decide separately
whether `toHub()` should force-graduate at all while `schoolNextStep(meta) !== null`.

Land that with #233, then **seed the 1.0.5 save and do the real-save load test that #223's own
re-validation column asked for.**
