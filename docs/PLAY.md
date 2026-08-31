# Google Play — listing, Data safety, and store assets

Everything the Play Console asks for that isn't the build itself. The build side
(signing, `.aab`, versionCode) is in [docs/NATIVE.md](NATIVE.md#release-signing).

| | |
|---|---|
| Package name | `com.tetrilaunch.app` (`applicationId`, from `capacitor.config.ts`) |
| Category | Games → Puzzle |
| Orientation | Landscape only |
| Min / target SDK | 24 / 36 |
| Permissions | `INTERNET`, and nothing else |
| Contact | gio@shicheng.com.hk |

---

## Google Play + RevenueCat purchase setup

This is the first-time setup runbook for the subscription used by this repo.
The code integration and release automation already exist; the remaining work
is store-side configuration. Console labels move occasionally, but the objects
and identifiers below are the important part.

### Identifiers that must agree

| Object | Value | Where it is consumed |
|---|---|---|
| Android package | `com.tetrilaunch.app` | Play app, RevenueCat app, release workflow |
| Play subscription product ID | `tetrilaunch_unlimited` | Play and RevenueCat only; permanent after creation |
| First base plan ID | `monthly` | Play and RevenueCat product/package mapping |
| RevenueCat entitlement ID | `Tetrilaunch Unlimited` | **Exact, case-sensitive** lookup in `src/lib/purchases.ts` |
| RevenueCat offering ID | `default` | RevenueCat's current offering; the app asks for the current paywall |
| RevenueCat package | `$rc_monthly` | Monthly product shown on the paywall |

The product and base-plan IDs above are conventions chosen for this app, not
strings compiled into it. The entitlement is different: changing its spelling
in RevenueCat would let a payment succeed without unlocking the app. If an
annual option is wanted, add base plan `yearly` to the same subscription and
map it to RevenueCat package `$rc_annual`; do not create a second entitlement.

Before choosing prices, also decide what Unlimited actually unlocks. The
current product design lists uncapped Contracts, cosmetics, run history and
cloud save, but the currently implemented client only exposes the entitlement
state/badge. Do not sell the subscription until the advertised benefits are
implemented and the paywall accurately describes what the shipped build does.

### 1. Create the Play app and establish the package

1. In Play Console, create the app as **Tetrilaunch**, game, paid/free as
   intended (the current plan is a free app with an in-app subscription), and
   accept the declarations.
2. Complete the payments profile/merchant setup. A subscription cannot be made
   available without it.
3. Create an **internal testing** release and upload a signed AAB for
   `com.tetrilaunch.app`. The easiest safe first upload is a manual dispatch of
   **Android debug APK**, which builds a signed AAB artifact but does not
   publish it; download `tetrilaunch-release-bundle` from that run and upload
   `app-release.aab` in Play Console.
4. Finish the minimum blocking dashboard tasks Play reports for that internal
   release, add tester email accounts (or a Google Group), publish the release,
   and save its opt-in URL. A tester must accept that link and install from Play
   for a real Billing test; a sideloaded APK is only useful for the RevenueCat
   Test Store.

Uploading a bundle before wiring RevenueCat is intentional: it proves the
package exists in Play, registers the billing-enabled app/version with Play,
and gives testers a store-installed build. The workflow assigns a monotonically
increasing `versionCode`, so do not repeatedly publish old downloaded artifacts.

### 2. Give RevenueCat Play API access

RevenueCat needs a Google service-account JSON **in its dashboard** to import
products and validate purchases. `PLAY_SERVICE_ACCOUNT_JSON` in GitHub does not
automatically configure RevenueCat; GitHub only passes it to the action that
uploads an AAB.

Recommended: make a separate service account for RevenueCat, then invite its
email under Play Console **Users and permissions** with access limited to
Tetrilaunch and the permissions RevenueCat's credential checker requests. At
the time of setup these normally include viewing app/financial data and
managing orders and subscriptions. Download one JSON key, upload it at
RevenueCat **Project settings → Apps → Tetrilaunch Android → Service
credentials**, verify it, then securely delete the downloaded copy. Follow
RevenueCat's current
[Play service credential guide](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials)
for the exact permission list rather than guessing from an old screenshot.

Using the existing upload service account is possible, but then it needs the
union of release and purchase-management permissions and one leaked credential
has a larger blast radius. Do not put a RevenueCat secret API key in GitHub or
the app: only the app-specific public `goog_…` SDK key belongs in the bundle.
Google permission changes can take time to propagate; if RevenueCat's check
fails immediately after a change, wait and retry before recreating everything.

### 3. Create and activate the Play subscription

In Play Console open **Monetize with Play → Products → Subscriptions**:

1. Create product ID `tetrilaunch_unlimited` and name it **Tetrilaunch
   Unlimited**. Product IDs cannot be reused or renamed, so check the spelling
   before saving.
2. Add base plan `monthly`, set it to **auto-renewing**, choose the billing
   period (one month), select the countries/regions, and set the price. Review
   Play's converted local prices rather than accepting them blindly.
3. Activate the base plan. A saved draft is not purchasable and commonly
   appears downstream as an empty offering.
4. Add any trial or introductory offer only after the plain monthly purchase
   works. Eligibility rules add another variable to first-time testing.

The repo does not hard-code price text or currency. Google supplies localized
pricing to RevenueCat and the RevenueCat paywall renders it; paywall copy must
not contain a manually typed price that can disagree by territory.

### 4. Connect the product in RevenueCat

1. In the existing RevenueCat project, confirm the Android app package is
   exactly `com.tetrilaunch.app` and its Play service credentials pass the
   dashboard check.
2. Under **Product catalog → Products**, import
   `tetrilaunch_unlimited` / `monthly` from Google Play. If import cannot find
   it, re-check that the base plan is active, the package matches, and the
   service account has propagated.
3. Under **Entitlements**, create `Tetrilaunch Unlimited` exactly as shown and
   attach the imported product. This is the case-sensitive contract with the
   app.
4. Under **Offerings**, create or select `default`, make it the **Current**
   offering, add package `$rc_monthly`, and attach the imported monthly product.
5. Build and publish a RevenueCat Paywall for that offering. Include a clear
   renewal period, price, auto-renewal/cancellation language, Terms and Privacy
   links, plus a restore path. The app calls RevenueCat's paywall UI rather than
   rendering product buttons itself.
6. In **Project settings → API keys**, copy the Android app-specific public key
   beginning `goog_`. Confirm it is the value already stored as the
   `VITE_REVENUECAT_ANDROID_KEY` secret in GitHub's `android-build`
   environment; replace the secret if the app/project changed. Never substitute
   a `test_` Test Store key in that environment—the bundle verifier rejects it.

### 5. Test the complete path before a production release

Use two distinct tests; passing one does not prove the other:

1. **RevenueCat wiring without Play:** put the Test Store public key in local
   `app/.env`, run `cd app && npm run android:apk:test`, install the debug APK,
   and exercise successful purchase, cancellation, failure, expiry and restore.
   This checks the entitlement spelling, offering and paywall without charging.
2. **Real Google Play sandbox:** publish a signed build to the internal track,
   add the purchasing account to both the internal-test tester list and Play
   Console **Settings → License testing**, accept the opt-in link, and install
   from Google Play. Confirm the paywall shows the expected local price, a test
   purchase activates Unlimited, relaunch preserves it, **Restore purchases**
   works after reinstall, cancellation/expiry removes it, and RevenueCat shows
   the event for the anonymous customer.

For the first automated internal upload after the manual bootstrap, publish a
`v*` GitHub release or dispatch the Android workflow on a `v*` tag with
**Publish the bundle…** enabled. A normal workflow dispatch only builds the AAB
artifact. The automation intentionally targets `internal`; promotion to closed,
open or production testing remains a deliberate Play Console action.

### Launch checklist

- [ ] Play subscription and `monthly` base plan are **active** in every launch
      country, with prices reviewed.
- [ ] RevenueCat service credentials validate, and its Android package is
      `com.tetrilaunch.app`.
- [ ] Product is attached to entitlement `Tetrilaunch Unlimited` and package
      `$rc_monthly` in the **Current** offering.
- [ ] The published paywall describes only benefits present in the release and
      includes required links/disclosures.
- [ ] `android-build` holds the matching public `goog_…` key; no `test_…` key is
      used by the release workflow.
- [ ] Purchase, restore, renewal/expiry and cancellation have been observed from
      a Play-installed internal-test build and in RevenueCat customer history.
- [ ] Play's Data safety, content rating, app access, privacy policy and
      subscription declarations are complete before production review.

---

## Store assets

```bash
cd app && npm run store:graphics    # -> store/play/
```

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512×512 PNG, no alpha | `store/play/icon-512.png` |
| Feature graphic | **exactly** 1024×500, no alpha | `store/play/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, **strict 16:9 or 9:16**, 320–3840px per side | `store/play/screenshots-16x9/` |
| Tablet screenshots | optional, but needed to be listed as tablet-optimised; 10-inch slot needs ≥1080px sides | same six files |

Both generated assets come from committed SVG in `app/resources/`, and
`store-graphics.mjs` asserts the exact dimensions and the absence of an alpha
channel rather than trusting the rasterizer — Play rejects both silently late in
the submission flow.

The feature graphic is **deliberately text-free**. The wordmark needs Orbitron
and the rasterizer has no access to it (the same constraint that stripped
"TETRI" out of `icon.svg`); a substituted system font would look worse than no
text, and Play draws the app name beside this graphic anyway.

### Capturing screenshots

The Console enforces **strict 16:9/9:16** on this form (2026-08). A full-screen
phone capture is 2376×1080 — that's 2.2:1 and does not qualify, so device
screencaps can't be uploaded as-is. The upload set in
`store/play/screenshots-16x9/` comes from headless Chrome against the live
site, at exact-16:9 viewports sized so both sides clear the 10-inch tablet
slot's ≥1080px floor:

- menu and boards: 960×540 CSS at deviceScaleFactor 2.5 → 2400×1350. The CSS
  width matters: at desktop widths the menu's two columns drift apart and the
  shot is mostly void; 960px triggers the phone-landscape layout it was
  designed around.
- gameplay: 1280×720 at 1.875 → 2400×1350, after dismissing the coach
  (`[data-action="coach-skip"]`) and hiding the desktop-only `.kbd-hint` strip.

One set of six serves the phone slot and both tablet slots, and satisfies
promotion eligibility (≥4 shots, ≥3 at 16:9 and ≥1080px).

Device screencaps (`adb exec-out screencap -p > shot.png`) are still useful as
marketing frames. Two gotchas, both of which produce a **completely black PNG**
rather than an error: the screen must be **on and unlocked** (a locked device
screencaps as black), and check the **screen timeout** first — at the
15-second default you lose the screen between navigating and capturing.

Worth including: the menu (it states the pitch in the game's own words), a mid-
flight shot with the aim arc live, a line clearing, the Workshop, and Contracts.

---

## Data safety

Play's Data safety form is a **declaration you are held to** — a mismatch
between it and observed network behaviour is an enforcement matter, not a
correction. So these answers are derived from the code, with the source noted.

What actually leaves the device, exhaustively:

| | Where it goes | Code |
|---|---|---|
| Display name, score, level, lines, timestamp | our Worker → D1 | `worker/index.ts`, `lib/api.ts` |
| Purchase / entitlement traffic | Google Play + RevenueCat | `lib/purchases.ts` |

And what does not: settings, chosen name, best score and all meta-progression
live in `localStorage` (`lib/store.ts`) and are never transmitted. The playtest
recorder (`lib/telemetry.ts`) is off by default, must be switched on from a
developer console, and **contains no network call at all** — it writes to
`localStorage` and is exported by hand.

There is no analytics SDK, no advertising SDK, no attribution SDK, and since the
fonts were self-hosted there is no third-party request during play either.

### Suggested answers

**Does your app collect or share any of the required user data types?** — Yes.

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Personal info → **Name** | Yes | No | App functionality | **Yes** |
| App activity → **Other actions** | Yes | No | App functionality | **Yes** |
| Financial info → **Purchase history** | Yes | No | App functionality | No |

- **Name** covers the leaderboard display name. Play defines Name as including a
  *nickname*, so a player-chosen handle belongs here even though the app never
  asks for a real one. It is sanitised to `[A-Z0-9 _-]` and 12 characters by
  `sanitizeName()`, and the privacy policy explicitly tells players not to use
  their real name.
- **Other actions** covers score, level and lines — gameplay stats, submitted
  with the name.
- Both are **optional**: they are transmitted only when the player chooses to
  submit a score. Play has a specific control for this ("Users can choose
  whether this data is collected") and it applies.
- **Shared: No.** Displaying a name on the in-app leaderboard is publication by
  the app, not a transfer to a third party, which is what Play means by shared.
- **Purchase history** is RevenueCat's. Data collected by Google Play billing
  itself is out of scope for the form, but RevenueCat is a third party that
  receives purchase state, so declare it. Cross-checked against RevenueCat's
  Data safety page (2026-08-11): declare it **required** (can't be turned off),
  not ephemeral, with purposes **App functionality + Analytics** — the
  Analytics purpose is theirs (dashboard charts), and omitting it would
  under-declare.
- Nothing goes under **Device or other IDs**. Confirmed by the same RevenueCat
  page: that category applies only when integrations forward advertising
  identifiers (`gpsAdId`, `androidId`), and the app has no integrations. The
  anonymous app-user ID is not an advertising identifier.

### Security section

- **Encrypted in transit** — Yes. `targetSdk 36` disables cleartext by default,
  the manifest sets no `usesCleartextTraffic` override and ships no
  `network_security_config.xml`, and `capacitor.config.ts` sets
  `androidScheme: "https"` with `allowMixedContent: false`.
- **Users can request deletion** — Yes. Both `/privacy.html` and `/support.html`
  commit to removing a leaderboard entry on request to the contact address.
  Honour it; the form is a commitment.
- **Committed to Play Families policy** — not applicable unless you target
  children; the app is not directed at them.

---

## Listing copy

**App name** (30 max): `Tetrilaunch`

**Short description** (80 max):

```
Fire tetrominoes from a cannon, stack the bay, and beat the compactor.
```

**Full description** (4000 max):

```
Tetrominoes, but you have to aim.

Tetrilaunch is a neon-arcade physics puzzle. You don't drop pieces — you load
them into a cannon and arc them across the bay. Where they land is up to you,
gravity, and whatever is already stacked down there.

Fill a row and the compactor takes it. Miss, and it sweeps anyway.

DEEP RUN
Ten bays, one run. Every stop makes you harden one difficulty axis for the rest
of the run — and the last one offers two clauses for the final bay and lets you
pick your poison.

CONTRACTS
Short, sharp challenges with fixed objectives. Retry as often as you like —
these are for learning a technique, not for grinding.

WORKSHOP
Salvage from clearing a tier's Contracts and beating its Deep Run buys permanent
unlocks. Rig strength is capped per Mark, and only beating a Mark raises the
ceiling, so the leaderboard stays honest.

WHAT MAKES IT DIFFERENT
• Real physics — pieces tumble, settle, and knock each other loose
• Aim is a skill, not a menu; the arc is yours to read
• A hazard ratchet every bay — you choose which axis hardens, never whether
• Built for landscape, on phone and tablet
• Plays offline. No account, no sign-up, no ads

The whole game is on the device. Submit a score to the online leaderboard if you
want to, with whatever name you like — that is the only thing that ever leaves
your phone, and only when you choose to send it.
```

Both descriptions are length-checked by `npm run store:copy` against Play's
limits, because the Console truncates rather than warns.

### Content rating

The questionnaire is per-territory and generated by the IARC, so the answers
aren't stable enough to record verbatim. The substance:

- No violence, sexuality, profanity, gambling, or user-to-user communication.
- **Digital purchases: yes** — there is an in-app purchase.
- **Shares user location: no. Shares personal info: no.** The leaderboard name
  is user-entered and not tied to an identity; the questionnaire is asking about
  transmitting personal data to third parties, which the app does not do.

Expect an "Everyone" / PEGI 3 style outcome, plus the "In-app purchases" badge
that Play attaches automatically once a product exists.
