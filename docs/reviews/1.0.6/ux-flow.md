# Lane 4 — UX flow integrity: first run, empty states, error states, dead ends, navigation

Reviewed tree: `bde8746` (`origin/staging` @ #232 + `origin/release/1.0.6`).
Read `docs/releases/1.0.6.md` first; findings are split between verifying its claims and finding what
it misses.

---

## The five most likely 1-star generators

### 1. P1 (PRE-EXISTING, worsened by 1.0.6) — Android Back exits the app from any screen, and an in-progress run is never persisted

Three facts, each verified:

- **No back handler exists.** `@capacitor/app` is not a dependency (`app/package.json:66-74`, no match
  in `package-lock.json`). Grep for `backButton|onBackPressed|popstate|OnBackInvoked` across `src/`,
  `native/`, `ios/`, `desktop/` returns **zero hits**. `app/native/android/MainActivity.java` (the
  source of truth, copied over the generated stub by `scripts/patch-android.mjs`) overrides `onCreate`
  and `onWindowFocusChanged` only.
- **There is no history to fall back on.** No `history.pushState` anywhere; the app is one
  `overlay.innerHTML` swap per screen. So `WebView.canGoBack()` is false, Capacitor's `BridgeActivity`
  does not override back (that is `@capacitor/app`'s job), and the default `Activity.onBackPressed()`
  runs — `finish()`.
- **Nothing saves a run.** Every `localStorage.setItem` in `src/` writes only settings, name, best,
  bays, meta, auth, the RevenueCat web id and telemetry (`app/src/lib/store.ts:130-133,255`). There is
  **no `RunState` persistence and no resume path.**

**Player experience:** the most reflexive gesture on the platform — back out of the Workshop, the
leaderboard, the hub — quits the game. Mid-run it destroys up to ten bays of progress, banked scrap and
every draft pick, with no prompt and no recovery.

**1.0.6 made this worse.** #223 added a screen to the stack: Play now goes front door → hub → run, so
there are strictly more screens on which "back" reads as *go up one level* and strictly more presses
that instead terminate the process.

### 2. P1 (PRE-EXISTING) — `pagehide` permanently destroys input, with no restore path

`app/src/main.ts:1324`:
```js
window.addEventListener("pagehide", () => this.destroy());
```
Unconditional — it never reads `event.persisted`. `destroy()` (`main.ts:1486-1500`) calls
`this.input.destroy()`, which removes every canvas `pointerdown/pointermove/pointerleave/wheel/
contextmenu` listener and every window `pointerup/pointercancel/keydown/keyup/blur` listener and
cancels its rAF (`app/src/game/input.ts:402-414`); plus `this.game?.destroy()`, `attract.stop()`,
`disarmWatchdog()`, and the auth/entitlement unsubscribes.

**There is no `pageshow` handler anywhere in `src/`** (grep: zero hits), and nothing re-arms any of it.
The App's own rAF loop is never cancelled (`main.ts:7797` re-schedules unconditionally), and the
overlay's own listeners are attached to `this.overlay` and never removed.

So on bfcache restore — the standard iOS Safari / Android Chrome back-forward gesture, and tab
suspension — the player gets back a page that **still renders and whose menu buttons still work**, but
where **aiming and firing are dead** and the physics world has been torn down. It looks alive and
cannot be played. Only a manual reload fixes it.

### 3. P1 (NEW IN 1.0.6) — Deferred claim makes both end cards assert a Tier is open when it is not, and points the primary backwards

**INDEPENDENTLY VERIFIED by this reviewer.** #223 stopped the recorders advancing the Mark
(`app/src/game/meta.ts:1722-1730`, `1756-1762`): they return `completedTier: tierReady(next)` and leave
`meta.mark` alone — the comment at `:1725` says so explicitly ("DEFERRED CLAIM: the tier no longer
advances… the Mark waits for the player to press Unlock on the hub").

`app/src/main.ts:6572-6587` assigns that unadvanced meta, then renders the end card with
`progress: tierProgressFor(this.meta)` (`main.ts:4373`). Under 1.0.5 `advanceTier` (`meta.ts:1631-1647`)
had already bumped `mark`, so `progress.tier` was the **new** tier. **It is now the tier just finished.**
Three consequences on the highest-stakes card in the game:

- `app/src/ui/screens.ts:7816-7822` — "**Tier N complete!** … Tier **N+1** is open", via
  `tierOpenedClause(opts.tierCompleted)`. Verified: `screens.ts:7417-7420` returns the literal
  `` `Tier ${opened} is open` `` and `meta.ts:950` returns `tier + 1`. **Tier N+1 is not open.** It is
  claimable, and stays locked until the player finds Unlock on the hub.
- `app/src/ui/screens.ts:7660` — `runFace` = `` `Run Tier ${opts.progress.tier} →` ``, i.e. the tier just
  beaten. This is the card's **primary** on a completed run (`screens.ts:7671-7694`), and `focusInitial`
  parks the pad on `.btn--primary` (`app/src/ui/padnav.ts:199-206`). **The loudest button, and the pad's
  default, re-flies finished content.**
- `app/src/ui/screens.ts:7848-7856` — the `end__next` line reads "Tier **N**: {hazard with
  `h.mark === N`} joins the draft, and the build budget rises to `budgetForMark(N)`", announcing as news
  the hazard and budget in force for the **whole run just played**.

And **nothing on the card points at Unlock**: the Tower ghost's badge is gated on
`opts.step === "contracts"` (`screens.ts:7650`) while `nextStep` now returns `"unlock"`
(`meta.ts:2014-2018`), so the single door to the hub is unbadged.

The contract-end card carries the identical false claim at `app/src/ui/screens.ts:9291-9297`, and either
half can be the one that lands second — **so both paths hit it.**

**This is the release's headline feature telling the player they own something they don't, on the screen
they were most looking forward to.** The fix is copy and routing, not mechanism.

### 4. P1/P2 (PRE-EXISTING) — Every network call is untimed; a hung request has no failure UI at all

`app/src/lib/api.ts` is **byte-identical to 1.0.5** (`git diff main..HEAD -- app/src/lib/api.ts` is
empty). `fetchLeaderboard` (`api.ts:317-337`) and `submitScore` (`api.ts:339-360`) use bare `fetch` —
no `AbortSignal`, no timeout, no race.

- **The board lies while it loads, and forever if the socket hangs.** `BoardCache.get` returns `[]` for
  a board never fetched (`api.ts:255-258`, stated in its own comment) and `leaderboardRowsHTML` draws
  `[]` as `emptyBoardText` (`screens.ts:3464-3467`) — *"No scores at this Tier yet — be the first!"*.
  `openBoard`/`refreshBoard` (`main.ts:7684-7712`) mount **no loading state**. On a slow connection the
  leaderboard reads empty and then pops; on a **hanging** connection (captive portal, Worker holding the
  socket) the promise never settles and it says "be the first!" **indefinitely**. The well-written
  `BOARD_UNAVAILABLE_TEXT` path (`api.ts:334`, `screens.ts:3444`) is only reachable on a throw or a
  non-ok response — i.e. **never on the failure mode phones actually produce.**
- **Submit can hang with the button dead and the score lost.** `onSubmitScore`
  (`main.ts:~10730-10760`) sets `submitting = true; btn.disabled = true`, then awaits with no timeout and
  **no "Submitting…" face** — just a greyed button, no spinner, no message. The only escape is to leave
  the run-end card, which **discards the score permanently**.

### 5. P2 (NEW IN 1.0.6, spend-adjacent) — the shortfall card does not seal the shop behind it; Tab reaches the BUY buttons under an unanswered question

`sealBehindScrim` (`app/src/ui/padnav.ts:322-329`) is the existing fix for exactly this failure, and
`renderOverlay` calls it on **two** arms only: `account-delete` (`main.ts:4175`) and `seal-break`
(`main.ts:4336`).

`case "ws-short"` (`main.ts:4033-4044`) concatenates `workshopScreen(...) + salvageShortModal(...)`, and
`salvageShortModal` emits `<div class="modal-scrim" id="scrim">` (`screens.ts:8831`) as a **plain sibling**
of the shop's `.screen`. `.modal-scrim` stops a mouse, not a keyboard. So Tab from *"Not enough
salvage"* walks into the live Workshop behind it, and Enter there fires `buy-unlock` / `buy-install` —
members of `SPEND_ACTIONS` (`main.ts:406`).

The pad is safe (`padNavRoot`, `main.ts:4739-4742`, scopes to the last scrim). **The keyboard is not.**
Same gap on `sys-drill-offer` (workshop + modal, no seal), and on `contractsIntroModal` /
`refitIntroModal` / `draftIntroModal`, all appended with `+=` over their screens. **`ws-short` is the new
one (`510f009`) and the one where the reachable controls spend currency.**

---

## Remaining findings

**6. P2 — No pause on backgrounding or focus loss.** `visibilitychange` (`main.ts:1298-1309`) does audio
suspend/resume, `onResize()` and `armWatchdog()` — there is **no `this.pause()`**, and no `window` `blur`
pause. Nothing is *lost*: the clock is step-driven (`game.ts:2279`) and the accumulator is clamped to two
steps (`main.ts:7736`), verified specifically. But the player is handed back a **live** bay with the
compactor running, and `onResize()` has just re-solved the layout underneath them — the same relayout
`MainActivity.java`'s own comment warns "would re-fit the world and move the aim origin under the
player's finger". **Every other viewport change in the app pauses**: leaving fullscreen does
(`main.ts:4827`), the portrait guard does. This one does not.

**7. P2 (NEW IN 1.0.6) — The pad's Controls shortcut is dead on the tier hub.** `ControlsDoor`
(`screens.ts:3060-3061`) was never extended with `"tiers"`, so `PAD_CONTROLS_DOORS` (`main.ts:543-551`)
has no `tiers` entry and `onPadUiButton`'s `PAD_CONTROLS` branch returns false there. **The hub is where
a pad player lands after every Play press and every quit-from-run.** Under 1.0.5 that screen was `menu`
and the shortcut worked. Lands squarely on the platform (Steam Deck) #218 was written for.
*(Cross-confirmed independently by the copy lane, which found the stale comment at `main.ts:519-534`.)*

**8. P2 — "Either answer marks the tutorial seen (so this never returns)" is false.** `screens.ts:~2528`
states it; `main.ts:9422-9426` `case "offer-tutorial"` calls `startLesson(0)` and its own comment says
*"seenTutorial is deliberately NOT pre-set here"*. A player who accepts the tutorial and quits before
graduation keeps `seenTutorial === false`, so `case "tiers"` (`main.ts:9368-9369`) **re-shows the offer on
every subsequent front-door Play press.** The comment at `main.ts:9346-9357` argues the door-gate prevents
a "toll gate" — it does, for back-to-hub routes, but not for the one door it actually gates.

**9. P2 — A failed (as opposed to cancelled) purchase is completely silent.** `presentPaywall` catches,
warns to console and returns the unchanged entitlement (`purchases.ts:311-314`); `onPaywall`
(`main.ts:~10516-10524`) does `if (await presentPaywall()) void successHaptic()` and nothing else.
A declined card, a network drop mid-transaction, or a **deferred/pending** purchase (Ask to Buy, SCA) is
indistinguishable from "I cancelled": the preview sheet stays as it was, same Buy button, no message.
Conspicuous because the neighbouring paths are handled well (`STORE_UNAVAILABLE_TEXT` at `main.ts:10505`,
`ACCOUNT_SIGN_IN_FAILED_TEXT`, and restore's correct three-state).

**10. P3 (latent hazard) — `renderOverlay` has no `default:` arm and never clears `overlay.innerHTML`.**
From `main.ts:3779`; 15 of its 29 arms are guarded (`if (g && this.run)`, `if (sf)`, `if (track && spec)`).
A failed guard leaves the previous screen's DOM mounted while `this.state` has moved, so the visible
buttons belong to a different screen than the one the app thinks it is on. `case "sandbox"` is the sharp
edge: `sandboxOpen()` false writes `innerHTML = ""`, and `padBackTarget` for `"sandbox"` returns
`[data-action="tiers"]`, which does not exist in an empty overlay — `clickBackTarget` returns false,
Escape and B do nothing, and the screen is a black box with no exit but a reload. **No live route was
found** (every entry re-checks `sandboxOpen()`), so this is a hazard rather than a bug — but it is one
`devMode` toggle away and the structure invites it.

**11. P3 — The Unlock ceremony is pad-skippable (claim verified) but not keyboard-skippable.**
`onPadUiButton`'s `this.celebrating && button === PAD_CONFIRM` branch (`main.ts:8868-8871`) is
gamepad-only; `onGlobalKey` has no equivalent. Escape during the ceremony reaches `clickBackTarget` →
`[data-action="menu"]` → `toMenu()`, which leaves the hub entirely and burns the ceremony. A keyboard
player focused on Play — which is `.btn--primary` again post-claim, since `unlockReady` is false by then
(`screens.ts:2359-2361`) — and pressing Enter **launches a run behind the banner**: precisely the defect
#218 fixed for the pad. *(This answers the open question in PR #224: the ceremony IS pad-skippable.)*

**12. P3 — `sys-drill-offer` has no pad/Escape back, and #232's own fix is partial.** `padBackTarget`
(`main.ts:8713-8748`) has a `ws-short` entry but **no** `sys-drill-offer` entry, so B and Escape do
nothing on the "Try it?" card. #232 correctly demoted the drill to secondary so `focusInitial` now lands
on "Back to the shop" — that fix holds — but the reflexive dismiss key still does nothing, and #232's own
commit message concedes the offered bay "still has no stated finish" and that its only exit (an ungated
pause Quit) is unadvertised on screen.

**13. P3 — The shortfall card's Contract detour loses the player's intent.** A Contract started from
`ws-short` (`screens.ts:8819`) settles through `contract-next` → `toHub()` (`main.ts:9331`). The player
who went to earn salvage for one specific plate lands on the hub, not back on that plate with the
purchase in reach.

---

## Verified sound — do not re-audit

- **Leaderboard empty vs unavailable** are genuinely distinct designed states (`screens.ts:3434-3467`).
  The defect is the *loading* state, not these.
- **`acked` migration** is correct and fails lit (`store.ts:477-494`, `meta.ts:797-820`). The risk list's
  reasoning is right.
- **Deferred claim vs a 1.0.5 save that had already advanced**: `advanceTier` resets
  `tierRunDone`/`tierContracts` (`meta.ts:1643-1644`), so `tierReady` is false and Unlock does **not**
  spuriously light. **The release doc's claim holds.** The bug is downstream, at the end card (#3).
- **Unlock ceremony is pad-skippable** — #218's claim is true in code (`main.ts:8868-8871`), and
  `focusInitial` correctly parks on Unlock while `unlockReady`.
- **Fullscreen never blocks entry to the game** (#221/#227): `autoEnterFullscreenForRun` is `void`-called
  before the state change (`main.ts:9359-9369`), `requestFullscreen` swallows rejection
  (`platform.ts:165-174`), iPhone Safari is filtered by `fullscreenSupported()` (`platform.ts:131-135`),
  and leaving fullscreen mid-bay pauses (`main.ts:4815-4828`). **It cannot strand.** The web path remains
  hardware-unverified, as PR #224 notes.
- **Restore Purchases' three-state** (`true`/`false`/`null`, `purchases.ts:337-368`) and the sign-in error
  line + silent user-cancel are correct.
- **Backgrounding does not burn a timed bay's clock** — step-driven, accumulator-clamped.
- **The stated routing contract holds in code**: quit-from-run and coach-fail Menu → hub
  (`main.ts:9343-9345`, `requestQuitRun` → `toHub` at `7526-7541`); Settings / How to Play / hub-back →
  front door (`padBackTarget` `main.ts:8733-8742`); `toHub` completes onboarding on every arrival
  (`main.ts:7477-7489`). Settings is not reachable mid-run (`data-action="settings"` appears only at
  `screens.ts:2511` and `3321`), so there is no silent run-abandonment through it. **The back stack is
  sound; the problems are elsewhere.**

---

## Recommendation

#1 and #2 are platform-wide and predate 1.0.6, but are the two most likely to produce a "it deleted my
run" review; #1 is a one-listener fix plus a dependency. **#3 is new in this release, is on the screen the
release is built around, and is a copy-and-routing fix rather than a mechanism change.** #4 is a timeout
plus a loading state.

**The lane's verdict: #3 should not ship as-is.**
