# Adversarial review — Tetrilaunch 1.0.6 release candidate

**Tree reviewed:** `bde8746` = `origin/staging` (through #232, `37b0f66`) merged with
`origin/release/1.0.6` (`774a9c7`). Version reads **1.0.6** in both `package.json` files.
**Date:** 2026-09-21. **Method:** eleven independent lanes, each briefed to find defects in one
discipline and stay out of the others. Every finding below carries a file:line and a suggested fix.
**Nothing in this review modifies product code.**

---

## Verdict

> **Do not tag yet.** One defect is a silent save-data loss on the exact flow 1.0.6 is about to
> playtest, reachable in one press from the tutorial's own forward button, with no reload required and
> no pin guarding it. A second is an unbounded payout change that, by the release document's own rule,
> reclassifies the release.

Everything else is shippable with a decision, a note, or a follow-up.

### The three that should stop the tag

| # | Finding | New in 1.0.6? | Lane |
|---|---|---|---|
| **1** | **The tutorial's forward primary deletes lessons 5–9 and the Final Exam** | **Yes** | [merge-seams](merge-seams.md) §1, [economy](economy-and-saves.md) P1-C |
| **2** | **Unbounded post-ladder salvage delta vs v1.0.5** | **Yes** | [economy](economy-and-saves.md) P1-A |
| **3** | **A macOS packaging failure silently cancels the entire Android release** | No (structure), but never exercised on 1.0.6 | [release](release-engineering.md) §1 |

#### 1. The tutorial's forward primary deletes lessons 5–9

```
v1.0.5   screens.ts:8258   data-action="contracts"   "Contract board →"
1.0.6    screens.ts:8980   data-action="tiers"       "To the tower →"
```
`"tiers"` → `main.ts:9369` → `toHub()` → `main.ts:7485` `completeOnboarding` + `saveMeta` →
`meta.ts:1279` `licence = 10`. Measured: **licence 4 → 10, six lessons gone, no reload needed.**

Two commits **inside #223** collided: `89c0495` made `toHub()` force-graduate; `510f009` re-pointed this
button at it. Three things make it worse than an ordinary bug:
- **The guard exists and is bypassed.** `main.ts:9301` routes `!licenceDone` to the real school board,
  under the comment *"a door nobody has thought of yet must still not open the old room."*
- **The sibling rung is safe** (`data-action="workshop"`). Only the Contract rung's door is destructive —
  the tell that this was an accident.
- **No sim pin covers `next: "contract"`**, which is why the suite is green.

**Fix:** send it back to `data-action="contracts"`; decide separately whether `toHub()` should
force-graduate at all while `schoolNextStep(meta) !== null`.
**PR #233 does not fix this** — different mechanism.

#### 2. Unbounded post-ladder salvage delta

A/B over the same play log, v1.0.5 `meta.ts` vs this tree's:

| | ladder climb | + 5 post-ladder cycles |
|---|---|---|
| v1.0.5 | mark 10, 600 salvage | mark 10, **900** |
| 1.0.6 | mark 10, 600 salvage | mark 10, **660** (latched) |

`advanceTier` is byte-identical, but v1.0.5's recorders called it unconditionally — at mark 10 the mark
saturated while both halves still reset, re-opening milestones daily. 1.0.6's recorders return
`tierReady()`, which requires `mark < MARK_COUNT`, so they latch forever. **Lifetime income is now capped
at 660 against a 1785 salvage shelf** — the rack slots alone exceed everything a player can earn.

The release doc says *"tiers and budgets untouched… any payout delta in re-validation reclassifies the
release."* **This is a delta the diff cannot show, because it lives in call-site timing.**
**Needs an owner decision**, not a silent ship.

#### 3. macOS failure cancels the Android release

`android.yml:32-44` has **no tag trigger**. Its only tag path is a `gh workflow run` step *inside*
`desktop.yml`'s `release` job, which is `needs: package` with **no `always()`**. A macOS leg failure →
no Release, no desktop artifacts, **no Play upload at all** — while `ios.yml` ships to TestFlight from
the same tag, and nothing reports Android was skipped. desktop.yml has **4 failures in 18 runs** and
**has not run since 2026-09-14**.

**Recovery is narrow:** you must **re-run the failed job on the tag run**. A fresh dispatch can never
rescue it (`desktop.yml:340` excludes dispatches).

---

## Where lanes converged

Independent lanes reaching the same defect from different directions — the strongest signals here.

| Defect | Found by |
|---|---|
| Tutorial force-graduation | economy (from save state) + merge-seams (from colliding commits) |
| End card claims "Tier N+1 is open" when it isn't | ux-flow (routing) + economy (measured repeat, +0 salvage) |
| `PAD_CONTROLS_DOORS` missing `tiers` | ux-flow + a11y + copy (stale comment) |
| Tower floor tap targets 21–32px | fit (baseline decomposition) + spacing (CSS) + a11y (measured fleet) |
| `sealBehindScrim` missing on `ws-short` | ux-flow + a11y + merge-seams |

---

## Full findings, by severity

### P1

| Finding | New? | Lane |
|---|---|---|
| Tutorial's forward primary deletes lessons 5–9 | **1.0.6** | [merge-seams](merge-seams.md) §1 |
| Post-ladder salvage faucet closed, unbounded delta | **1.0.6** | [economy](economy-and-saves.md) P1-A |
| macOS failure cancels the Android release | structure | [release](release-engineering.md) §1 |
| `loadMeta` wipes the whole save on `loadout: null` + no filed run | pre-1.0.6 | [economy](economy-and-saves.md) P1-B |
| End cards assert a Tier is open when it is only claimable; primary points backwards | **1.0.6** | [ux-flow](ux-flow.md) §3 |
| Account-delete dialog scrolls its own buttons off the fold | pre-1.0.6 | [fit](resolution-and-fit.md) §1 |
| Desktop shell's minimum window (960×540) is a size the UI does not fit | pre-1.0.6 | [fit](resolution-and-fit.md) §2 |
| #230's replacement breakpoint misses the Pixel 7 pair by 0.25px | in-flight PR | [fit](resolution-and-fit.md) §3 |
| Tier hub draws a full bay behind an opaque backdrop, every frame | **1.0.6** | [render](render-and-dpr.md) §1 |
| No text scaling on any mobile build (WCAG 1.4.4 fails) | pre-1.0.6 | [a11y](accessibility.md) P1-1 |
| Modals are not modal for the keyboard (11 of 13 states unsealed) | pre-1.0.6 | [a11y](accessibility.md) P1-2 |
| Refit's Undock price is **1.07:1** — amber on cyan | pre-1.0.6 | [a11y](accessibility.md) P1-3 |
| Viewport change mid-drag turns a full pull into a misfire | pre-1.0.6 | [physics](input-and-physics.md) §1 |
| Android Back exits the app; no run is ever persisted | pre-1.0.6, worsened | [ux-flow](ux-flow.md) §1 |
| `pagehide` destroys input with no `pageshow` restore | pre-1.0.6 | [ux-flow](ux-flow.md) §2 |
| Tag/version guard protects desktop only; iOS and Android disagree by construction | pre-1.0.6 | [release](release-engineering.md) §2 |
| Data-safety CSV omits the User ID sent to RevenueCat | pre-1.0.6 | [release](release-engineering.md) §3 |
| No iOS privacy manifest anywhere in the repo | pre-1.0.6 | [release](release-engineering.md) §4 |
| Lesson 1 defines a term using two undefined terms | pre-1.0.6 | [copy](copy-and-language.md) §1 |
| Full Game bullet overstates what the entitlement buys | pre-1.0.6 | [copy](copy-and-language.md) §5 |
| Hub tower tap targets fell 37–42px → 21–43px | **1.0.6** | [spacing](spacing-and-style-system.md) §1 |
| `.btn--primary` has no `:active` — the primary CTA never presses in | pre-1.0.6 | [spacing](spacing-and-style-system.md) §2 |
| Three shipped beds loop through real digital silence (bay-3: 1.33 s) | pre-1.0.6 | [audio](audio.md) |

### P2 — selected

`takeOf`'s coin is a parity bit (bays 1 and 2 perfectly anti-correlated) · every network call untimed,
no loading state · the shortfall card does not seal the shop from the keyboard · `AIM_LOFT_DEFAULT = 1`
aims at the edge of tolerance · the wind notch's average tick is raw while its fill is post-stabiliser
(2.5× apart) · release notes are **10× over Play's 500-char cap** · `ios.yml` calls a dispatch a
rehearsal but uploads to TestFlight regardless · the Steam upload job can go green having uploaded
nothing · the hub rail re-proportions unevenly at its 470px container breakpoint · #232 inverted the two
UI voices on the practice-bay offer · free player at mark 3 sees three "+15" chips that pay 0 · 190 rgba
literals are exact token values.

Full detail in each lane document.

---

## Corrections to `docs/releases/1.0.6.md`

The release doc is unusually good, and `774a9c7` already exists to strike claims it could not back up.
These are the next ones.

| Claim | Status |
|---|---|
| `trimToInk` "records `baked` from the crop", so stamps land a fraction off | **Misdiagnosed.** `baked` comes from the **uncropped** canvas (`render.ts:1088`); `inset` cancels identically. Measured exactly `-20.000000` / `40.000000` across 24 scale×blur combinations. `trimToInk` touches only cubes; the reported drift is on the cannon and plant frame, which never pass through it. **As written it sends a fixer to the wrong function.** Likelier cause: hysteretic `syncSpriteScale`. |
| Release notes are "paste-ready for the store 'what's new' fields" | **5,028 chars** — 10× over Play's 500 cap, 1,028 over Apple's 4,000. Nothing checks it. |
| "about 3.7 MB of marketing" stripped | Actual saving **1.59 MB**. |
| `wrangler.jsonc:82-85` "all 46 runs died at its token guard" | staging.yml now has **222 runs, last six all `success`**. |
| `vite.config.ts:138-140` "~30.3 MB of a ~30.7 MB total" | Measured precache **41.97 MiB**. |
| Merge-train table | Stops at **#228**; the tree carries nine merges. **#232 — the only input-behaviour change in the release — appears nowhere.** |
| Risk list | Says nothing about the **tap-target drop**, though 1.0.6 is the release that removed the scroller keeping those at 44px. |
| Open question: "should the Unlock ceremony be pad-skippable?" | **Already implemented — close it.** `main.ts:8862-8871`. Confirmed by two lanes. |
| Open question: install size "+6–8 MB" | Resolves at the **top** of the band: **+7.80 MiB**, precache +23.0%. **95% of the precache is now audio.** |
| "Is there a 1.0.5 save on the test phone?" | **Release-blocking.** #223's own re-validation column lists a real-save load test; the Still-open list shows no such save exists, so **that step was never performed.** It is the single test that would have caught both #233 and finding 1. |

---

## Corrections made to this review itself

Stated because the reports should not be taken on faith.

- **A finding was withdrawn.** The render lane reported **443 new uifit violations**. The cause was 12
  probe device rows the *fit* lane injected into `devices.ts` during the audit. Re-running the full fleet
  on a verified-clean tree gives **235 baselined, 0 new**. **The tree is green.** This is a real hazard of
  running eleven reviewers against one working tree, and it is the review lead's to own.
- **A proposed fix was wrong.** The audio lane's remedy for `takeOf` — `(h >>> 27) % 2` — measures **75%
  same-take**, worse than the bug. Six candidates were tested; only an `fmix32` finalizer reaches 25% per
  pairing. Reordering the hash input does not help: the parity argument is order-independent.
- **A brief hypothesis was disproved.** The a11y lane was briefed that the wind notch was likely
  colour-only information. It measured magnitude as bar **length** with colour redundant, and every fill
  colour clearing 3:1. **The encoding is sound.**
- **Product code was edited and reverted.** The physics lane swapped the practice-bay offer's
  primary/secondary classes as a deliberate "prove the pin goes red" step and did not revert in time.
  Reverted by the lead. **That swap is not a recommendation** — it would have reintroduced the misfire
  #232 exists to fix.

---

## Checked and found sound

Recorded so nobody re-spends the effort:

- **The `acked` migration is correct**, and the deferred-claim risk the doc flags **does not fire**:
  `advanceTier` resets both halves, so no 1.0.5 save can carry `tierRunDone && tierContracts >= 3`.
  Verified across `mark` ∈ {0,1,5,9,10,11,99}.
- **The documented routing contract holds in code.** The back stack is sound; the problems are elsewhere.
- **The pad focus graph has no holes** — 0 unreachable targets, 0 sinks, across 164 fixtures on six
  geometries. The doc's flagged "pad focus" risk does not reproduce.
- **Fullscreen cannot strand a player**, and #227 does not lose the user gesture.
- **#228 is clean** — the flagged "green against the old base" PR contains exactly its author's intent.
- **The climb's economy is untouched** — empty diff across `level/hazards/belt/contracts/finals/upgrades`.
- **No board clear needed**; no D1 migration; CORS is `*` so no native-origin risk.
- **Dev/cheat/sandbox code is genuinely compile-time stripped** — 0 hits in the emitted native bundle.
- **Secrets hygiene is right**; `store/play/certificates.zip` contains only **public** X.509 certs.
- **Build-number monotonicity holds** — the workflow rename did not reset `run_number`.
- **Nothing is silently dropped from the Workbox precache** — 92 entries, 0 dropped, 1.04 MiB headroom.
- **No dead menu-era CSS**, 2 `!important` (one in a comment), near-total reduced-motion coverage.
- **Zero TODO/FIXME/HACK/`@ts-ignore`** added across the 14.6k-line diff.
- **`npm run typecheck`, `npm test` (5239 checks) and the uifit fleet are all green** on this tree.

---

## Suggested order

**Before tagging**
1. Fix finding 1 (one `data-action`, plus the `toHub()` decision). Add a pin for `next: "contract"`.
2. Decide finding 2 — intentional faucet close + a release note, or restore the endgame income.
3. Land #233 (correct, and it incidentally removes the `loadMeta` save wipe) — but **label it a v1.0.5
   fix**, and do not call the save-data question closed until 1 is done.
4. **Seed a 1.0.5 save and run the real-save load test #223's own re-validation column asked for.**
5. Confirm the macOS signing secrets and **re-run `desktop.yml` by dispatch against this tree** — it has
   never run on 1.0.6.
6. Two-line fix: `check:version` with `RELEASE_TAG` in `android.yml` and `ios.yml`.
7. Add `PSL_USER_ACCOUNT` to the data-safety CSV; settle `PSL_ACM_NONE` vs OAuth.
8. Trim the release notes to 500 chars for Play.
9. Cheap and worth taking: the `.btn--primary:active` one-liner, the Undock contrast fix,
   `sealBehindScrim` on `ws-short`, `"tiers"` in `PAD_CONTROLS_DOORS` and `COVERS_CANVAS`.
10. Add one QA step: **on an Android phone browser, mid-bay, pull to full power with one finger, tap the
    rail's fullscreen icon with another, release.**

**Correct merge order now** (the documented plan is superseded):
#233 → #230 → re-merge `staging` into `release/1.0.6` (it is one merge behind) → #224 last.

**After tagging** — text scaling, tower floor geometry, canvas accessible name, the `takeOf` coin (with
the verified `fmix32` fix), the loop seams, the token-scale debt.

---

## Lane documents

| Lane | Document |
|---|---|
| 1 · Resolution and fit | [resolution-and-fit.md](resolution-and-fit.md) |
| 2 · Spacing and style system | [spacing-and-style-system.md](spacing-and-style-system.md) |
| 3 · Copy and language | [copy-and-language.md](copy-and-language.md) |
| 4 · UX flow integrity | [ux-flow.md](ux-flow.md) |
| 5 · Accessibility | [accessibility.md](accessibility.md) |
| 6 · Release engineering | [release-engineering.md](release-engineering.md) |
| 7 · Render and DPR | [render-and-dpr.md](render-and-dpr.md) |
| 8 · Input and physics | [input-and-physics.md](input-and-physics.md) |
| 9 · Economy and saves | [economy-and-saves.md](economy-and-saves.md) |
| 10 · Audio | [audio.md](audio.md) |
| 11 · Merge seams | [merge-seams.md](merge-seams.md) |
