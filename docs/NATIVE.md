# Shipping Tetrilaunch on Android & iOS

The app has always been a Capacitor project on paper, but there was no working
native path: no platform packages installed, no generated projects, no build
recipe, and a `capacitor.config.ts` that would have double-inset the field on a
notched iPhone. This is the concrete pipeline.

**The web bundle is the app.** Both native shells load the exact same
`app/dist/` that the PWA serves. There is no native-only code, so a fix here
must also hold in the browser — and a browser fix ships to native on the next
`cap sync`.

---

## What's in place now

| Piece | Status |
|---|---|
| Capacitor **8.x** — `@capacitor/android`, `@capacitor/ios` platform packages | installed (devDeps) |
| `capacitor.config.ts` — `androidScheme: https`, `contentInset: never`, scroll/zoom off | done |
| Safe-area handling (notch / home indicator) | done — `lib/platform.ts` `applySafeAreaInsets()` → `game/layout.ts` |
| Android fullscreen (sticky immersive + display cutout) | done — `native/android/MainActivity.java` via `scripts/patch-android.mjs` |
| Aspect-ratio layout solver (phone / tablet / ultrawide) | done — `game/layout.ts`, see below |
| npm scripts (`android:open`, `android:apk`, `ios:open`, …) | done |
| CI debug-APK build | done — `.github/workflows/android.yml` |
| Auto Backup: save restored, stale WebView SW excluded | done — `native/android/{backup_rules,data_extraction_rules}.xml` via `patch-android.mjs` |
| Landscape lock, haptics | already shipped (`@capacitor/screen-orientation`, `@capacitor/haptics`) |
| In-app purchases | done — RevenueCat, native only (`src/lib/purchases.ts`, [docs/ios.md](ios.md)) |
| iOS Xcode project, icons, `Info.plist` | **committed** at `app/ios/` — see [docs/ios.md](ios.md) |
| Self-hosted fonts (no runtime Google Fonts fetch) | done — `app/public/fonts/`, refreshed by `scripts/fetch-fonts.mjs` |
| Terms, privacy policy + support pages | done — `app/public/{terms,privacy,support}.html`, served by the Worker |
| **Android** release signing + `.aab` | done — `native/android/signing.gradle`, CI `bundle` job. **Needs a keystore + secrets** |
| **iOS** signed release / store listings | **not done — needs a Mac and secrets, see below** |

**`app/android/` is gitignored; `app/ios/` is committed.** They're treated
differently on purpose. Android stays a derived artifact — `npx cap add
android` regenerates it from `capacitor.config.ts` plus the installed plugins,
so CI rebuilding it from scratch on every run that goes as far as an APK is a
feature (it proves `cap add` still works from a clean checkout).

Android *does* now need several edits the CLI doesn't own (see
[Fullscreen](#fullscreen-the-system-bars-are-not-capacitors-problem) below), but
rather than committing the directory and losing that property, they're
re-applied by **`npm run patch:android`** (`scripts/patch-android.mjs`) from
sources that *are* committed under `app/native/android/`:

- `MainActivity.java` — copied over the generated stub
- two theme items injected into the generated `res/values/styles.xml`
- `signing.gradle` — release signing, plus the `apply from:` line into `app/build.gradle`
- `res/` — launcher icons and splash screens, over Capacitor's defaults
- `backup_rules.xml` + `data_extraction_rules.xml` into `res/xml/`, plus the
  two `<application>` attributes pointing at them — Auto Backup exclusions for
  the WebView's service-worker store (see
  [Progress survives reinstall](#progress-survives-reinstall-on-android-already))

The patch is idempotent and runs automatically as the last step of
`cap:add:android` and every `android:*` script, plus as its own CI step. If a
future Capacitor release restructures `styles.xml`, the patch **fails loudly**
rather than quietly producing an APK with the bars back over the play field.

iOS crossed the line the moment it acquired manual edits the CLI doesn't own: a
landscape-only, status-bar-hidden `Info.plist` with export-compliance declared,
and a generated app-icon/launch-screen catalog. Regenerating that directory
would throw all of it away, so it's committed and `cap sync` maintains only the
parts it owns (`Package.swift`, the copied web assets — both gitignored inside
`app/ios/.gitignore`).

### Capacitor 8: SPM, not CocoaPods

Capacitor 8 resolves iOS native dependencies through **Swift Package Manager**
(`app/ios/App/CapApp-SPM/Package.swift`, rewritten by `cap sync`). Practical
consequences, all of which invalidate older Capacitor instructions:

- There is **no Podfile and no `pod install`**. CocoaPods is not required at all.
- Open **`App.xcodeproj`** — the `.xcworkspace` that pods used to require no
  longer exists.
- The SPM packages point at `node_modules/` by relative path, so **`npm install`
  must have run** before Xcode can resolve them.
- The minimum deployment target is **iOS 15** (was 13 under Capacitor 6).

---

## First-time setup

```bash
cd app
npm install
cp .env.example .env     # RevenueCat public SDK keys (optional — without them
                         # the app runs fine and the store UI hides itself)

npm run cap:add:android  # generates app/android/  (needs the Android SDK)
                         # iOS needs no equivalent — app/ios/ is committed
```

## Day-to-day

```bash
npm run android:sync     # build + verify + sync
npm run android:open     # …then open in Android Studio
npm run android:run      # …then run on a connected device/emulator
npm run android:apk      # …then assembleDebug -> an installable APK

npm run android:apk:sandbox  # ...with the developer sandbox in it (see below)

npm run ios:sync         # build + verify + copy into app/ios/
npm run ios:open         # open App.xcodeproj (no build — sync first)
npm run ios:run          # build + verify + sync + run on a simulator/device
```

The `*:sync` scripts rebuild the web bundle *first*, which is the step that's
easy to forget and produces the classic "my change isn't in the app" confusion.
They also run `npm run verify:store`, which asserts the RevenueCat SDK actually
survived into `dist/` — see [docs/ios.md](ios.md) for why a build can silently
drop it.

Adding or updating a Capacitor plugin means re-running `*:sync`: that's what
rewrites `Package.swift` on iOS and the Gradle deps on Android.

The debug APK lands at:

```
app/android/app/build/outputs/apk/debug/app-debug.apk
```

### Requirements

- **Node**: **22+** — the Capacitor 8 CLI refuses to run on older.
- **Android**: **JDK 21** and the Android SDK (Capacitor 8 builds with AGP 8.13,
  `compileSdk 36`, `minSdk 24`, and sets source/target compatibility to Java 21 —
  JDK 17 will not build it). Android Studio installs all of it; CI installs it
  via `android-actions/setup-android`.
- **iOS**: macOS and **Xcode 16+**. No CocoaPods — see the SPM note above. There
  is no way around the macOS requirement — an iOS build cannot be produced on
  Linux, which is why CI only covers Android.

---

## CI

`.github/workflows/android.yml` runs the cheap gates — `npm run build:native`
(typecheck plus the web bundle), `npm run test` (the systems smoke test) and
`npm run verify:store` — on every push to `main` or `staging` and on every pull
request touching `app/`, so a broken build never gets as far as Gradle. It goes
on through `cap add` to a debug APK, and uploads it as a workflow artifact, only
on `main`, a published release, or a manual dispatch (`BUILD_APK` in the
workflow gates every Gradle-side step on that one condition). The Gradle half is
rationed because every run re-resolves the whole AGP tree from Maven Central,
which answers a busy repo with 429s — a red check nobody can act on teaches
people to ignore red checks — and because the cheap gates catch nearly
everything the APK step would. If you want an APK for a branch, dispatch it by
hand. Nothing is signed and nothing is published — that's deliberate, see below.

## What's still needed for the stores

These need credentials that don't belong in a repo, so they're documented rather
than half-implemented:

1. **Android signing** — *wired up; supply the key.* The Gradle side lives in
   `app/native/android/signing.gradle` (applied by `patch-android.mjs`, since
   `app/android/` is regenerated). It reads `android/keystore.properties`, and
   if that file is absent it simply doesn't define a signing config — so
   `assembleDebug` still works on a machine with no key, which is what lets CI
   build the debug APK without touching a secret. See
   [Release signing](#release-signing) below for the keystore and the secrets.
2. **iOS signing** — done manually in Xcode today (automatic signing, pick your
   team; the full walkthrough is in [docs/ios.md](ios.md)). Automating it needs
   an App Store Connect API key and a macOS runner — `xcodebuild
   -allowProvisioningUpdates`, Xcode Cloud, or `fastlane match`.
3. **Icons and splash screens** — **done, both platforms.**
   `app/resources/{icon,splash}.svg` rasterise into the Xcode asset catalogs and
   the Android `res/` tree via `npm run assets:generate` (`@capacitor/assets`).

   Android needs one extra hop, for the usual reason: `capacitor-assets` writes
   into `android/app/src/main/res/`, which is regenerated. So
   `scripts/stage-android-assets.mjs` copies the icons and splashes back out to
   **`app/native/android/res/`** (committed), and `patch-android.mjs` restores
   them into a freshly generated project. Both run automatically —
   `assets:generate` stages, every `android:*` script restores.

   Until this existed, `cap add android` left **Capacitor's default
   blue-X-on-white launcher icon** in place, and the debug APKs CI published had
   it. `patch-android.mjs` now fails loudly if `native/android/res/` is missing
   rather than quietly shipping the default again.

   It costs ~2.9 MB in the repo and ~2.7 MB in the APK. Most of that is splash
   screens at every density × orientation × night. The night variants are
   byte-identical to their day counterparts (the design is dark either way) and
   the portrait ones only ever flash before the runtime landscape lock engages —
   but the `.aab` splits by density, so a real install downloads a fraction of
   it, and correctness beat byte-shaving here.
4. **Store metadata** — screenshots at each required device size, descriptions,
   content rating, privacy declaration. The app collects a player-entered name
   for the leaderboard *and* now sells in-app purchases, both of which are
   disclosable on either store; the worked-out App Privacy answers are in
   [docs/ios.md](ios.md). The two mandatory URLs are served by the Worker from
   `app/public/`: `/privacy.html` and `/support.html`. Both carry a real contact
   address (`gio@shicheng.com.hk`) — keep it that way, since a store listing
   pointing at a dead contact is a review rejection, and both pages promise a
   removal route for leaderboard entries.
5. **Release-build env** — `VITE_REVENUECAT_*` keys must be present in the
   environment for any build you intend to ship, or the store quietly disables
   itself. `verify:store` catches the SDK being dropped entirely, but it cannot
   tell a missing key from a deliberate keyless build.

---

## Progress survives reinstall on Android already

**Measured, not assumed.** `android:allowBackup="true"` is Capacitor's default
and stays in place, so Android Auto Backup is live. WebView localStorage lives
under `app_webview/` inside the app's data directory, which the default backup
set includes. (The backup set is no longer *quite* the default — see
[the exclusions below](#the-backup-that-restores-the-save-must-not-restore-the-app),
which carve out the WebView's service-worker store while keeping
`Local Storage`, where the save lives.)

Tested end to end on a OnePlus 12 (Android 14) with the local transport:

```bash
adb shell bmgr transport com.android.localtransport/.LocalTransport
adb shell bmgr backupnow com.tetrilaunch.app
adb uninstall com.tetrilaunch.app
adb install app-debug.apk
adb shell bmgr transport com.google.android.gms/.backup.BackupTransportService  # put it back
```

The full save came back — salvage, unlocks, mark, run count, best score and
every claimed contract. **So the common "I reinstalled and lost everything" case
is already handled, for free.**

### The backup that restores the save must not restore the app

The same restore pass used to bring back `app_webview/Default/Service Worker` —
the WebView's service-worker store, precache included. Reproduced on device
(2026-08-09): a **fresh `adb install`** of a current APK booted as a months-old
build, because the restored worker serves its precached bundle before the APK's
own `dist/` ever executes. No runtime defense can win that race:
`purgeNativeServiceWorker()` ([lib/platform.ts](../app/src/lib/platform.ts))
ships inside the new bundle, but the restored worker decides which bundle boots
— and the shell it boots is old enough that it may predate the purge entirely.
The only reliable fix is to keep the worker out of the backup set, so the
restore never plants it.

That is what `native/android/backup_rules.xml` (read by API ≤ 30) and
`data_extraction_rules.xml` (API 31+, covering both cloud restore and
device-to-device transfer) do, installed into `res/xml/` and wired onto
`<application>` by `patch-android.mjs`. Excluded, exclude-*only* so everything
else keeps riding along:

- `app_webview/Default/Service Worker` — the stale-code vector itself
- `app_webview/Default/Code Cache` — compiled-JS cache; worthless restored, and
  dead weight against the 25 MB Auto Backup quota the save shares
- the same two without `Default/`, for pre-profile WebView layouts

`allowBackup` stays `"true"` and `Local Storage` stays backed up — the
exclusions are what make keeping it on safe. Flipping `allowBackup` off would
have fixed the stale worker by throwing away the save restore above, which is
the wrong trade while the whole meta-progression lives in localStorage.

Two consequences worth keeping straight:

- It backs up to the **player's own Google Drive**, not to us. That is why there
  is no Data safety declaration and no privacy-policy clause for it: we neither
  collect nor receive any of it. A server-side cloud save would change that.
- Purchases were never the exposure anyway. `restorePurchases()`
  ([lib/purchases.ts](../app/src/lib/purchases.ts)) ties the entitlement to the
  Play/Apple account, so a reinstall recovers the unlock regardless.

What it does **not** cover, and what a server-side save would buy:

| Gap | Effect |
|---|---|
| Two devices in active use | Auto Backup restores at install; it never syncs |
| Web / PWA | No platform backup at all |
| Freshness | Runs roughly daily on charge + idle + wifi, so same-day reinstall can lose that day |
| Backup switched off | A minority of players, but not zero |
| iOS | iCloud device backup is the analogue — **unverified**, needs a Mac |

Given that, server-side sync is a *parity and multi-device* feature, not a
data-loss fix. It also costs a Data safety declaration and a privacy-policy
change, because progress stored against a stable ID is pseudonymous personal
data under GDPR even though the contents are just salvage counts.

**iOS is expected to differ, and it is an open check.** Android Auto Backup
restores per app at install time; iCloud Backup restores only during a full
device restore, so deleting and reinstalling on iOS probably does *not* bring
progress back. That has not been measured — it needs a Mac and a device. The
test procedure, the decision table and the options if it fails are in
[docs/superpowers/specs/2026-08-09-progress-persistence-design.md](superpowers/specs/2026-08-09-progress-persistence-design.md).

---

## Testing an arbitrary tier, variant or bay on a device

Reaching a tier-7 Contract variant or a Mark 9 bay the honest way is ten bays a
run, three Contracts a tier, nine tiers — hours of correct play to get at one
bay worth ninety seconds of looking at, on a phone. The **developer sandbox** is
one screen that skips it: pick a tier, pick a Contract variant or a Deep Run
bay, pick a rig, launch.

```bash
cd app
npm run android:apk:sandbox   # builds --mode sandbox, then assembleDebug
npm run android:run:sandbox   # ...and installs it on a connected device
```

The entry is a **Sandbox** button on the main menu — visible, because the build
gate is what protects this and a hidden gesture would be guarding a door that is
not in the wall. RESEED re-rolls the Contract at the current tier and variant,
which is the dial a device session is actually for: a generated Contract is a
function of `(seed, tier, slot, variant)`, so that button walks the whole space
one variant can produce.

**The sandbox can rewrite the save** — set the Mark, grant salvage, max the rig,
unlock everything, wipe it. Install a sandbox APK over a build you care about
and the same localStorage is underneath it.

### Why this is gated on a build mode rather than on DEV

Same argument as the Test Store gate below, one step further. `import.meta.env.DEV`
is true only under the vite dev server, and a browser on a laptop is exactly what
this does not need to test — touch aim, device physics timing and the real screen
are the whole point. So the gate has to survive a real `vite build`, which means
it has to be a build mode.

`--mode sandbox` is inlined at build time, so in any other mode `SANDBOX` folds
to `false`, every `if (SANDBOX)` is dead code and the screen tree-shakes out
(measured: the native bundle is 4kB smaller and carries none of it).

That is the mechanism, and a mechanism is not a promise. A refactor that read the
flag through a function would silently ship a menu that rewrites the player's
save. So `src/lib/sandbox.ts` also exports a marker string that only exists on
the sandbox's own code path, and `verify-store-bundle.mjs` **fails any bundle
carrying it** unless `--allow-sandbox` is passed. The tree-shake is the
optimisation; the grep is the promise. Both directions are checked — a
`--mode sandbox` build with no marker in it fails too, because that is a normal
build wearing the wrong name and the button would do nothing on the device.

## Testing purchases without Play products

RevenueCat's **Test Store** simulates the whole purchase flow with no Play
Console product setup — useful long before a developer account clears.

```bash
cd app
npm run android:apk:test    # builds --mode teststore, then assembleDebug
```

`VITE_REVENUECAT_TEST_KEY` in `app/.env` supplies the key. The purchase sheet
offers *Cancel / Test failed purchase / Test valid purchase*, and subscriptions
renew every few minutes so expiry is observable in one sitting.

### Why this is gated on a build mode rather than on DEV

The SDK's own warning, printed at configure time, is stronger than the docs page:

> Never use a Test Store API key in production. **Our SDK will crash if using it
> in production.** … Apps submitted with a Test Store API key will be rejected
> during App Review.

And the usual safety net does not exist here: **the debug and release APKs
contain the byte-identical web bundle**, both built from `--mode native`. There
is nothing in the output that distinguishes them, so a test key that reaches
`dist/` ships.

So there are two independent guards:

1. The key is read inside a branch on `import.meta.env.MODE === "teststore"`, a
   build-time constant, so Rollup eliminates it from every other bundle.
2. `verify:store` **fails** if a `test_` key is found in `dist/`, unless run with
   `--allow-test-key` (which only the teststore scripts pass — and which itself
   fails if no test key is present, catching a teststore build that silently
   fell back to the platform key).

Guard 2 is not theoretical. It caught a real leak during implementation: with
the key declared as a property of the always-constructed `KEYS` object, Vite
inlined it into the **native** bundle, where it was unused but fully present and
`unzip`-able out of the APK. That is why it is written as an assertion over the
emitted output rather than a rule in a code review.

---

## Release signing

Play needs a **signed `.aab`**, not the debug APK above.

### Generate the upload keystore — once, and never lose it

`keytool` ships with the JDK, so any shell that can run `java` can run it. **Run
it somewhere outside this repo** — a keystore is a long-lived secret and
`app/android/` is a disposable build directory that `cap add android`
regenerates. Somewhere like `~/keys/` (Windows: `C:\Users\<you>\keys\`):

```bash
keytool -genkeypair -v -keystore upload-keystore.jks \
  -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

It prompts for a password and a name/organisation; the name only shows up in the
certificate, and Play never displays it.

**Back this file and its passwords up somewhere durable.** With Play App
Signing, Google holds the *app* signing key and this is only the *upload* key,
so losing it is recoverable — but recovery means filing a request with Google
and waiting, not a five-minute fix. `.gitignore` blocks `*.jks`, `*.keystore`
and `keystore.properties` repo-wide as a second line of defence.

### The two passwords are the same password

`keytool` writes **PKCS12** by default, and PKCS12 cannot store a per-entry key
password. Passing `-keypass` alongside a different `-storepass` prints:

```
Warning: Different store and key passwords not supported for PKCS12 KeyStores.
Ignoring user-specified -keypass value.
```

…and protects the key with the *store* password. If you then configure a
different key password, the build fails at `signReleaseBundle` with the
famously unhelpful `Get Key failed: Given final block not properly padded`. So:
**set the store password and leave the key password alone** — `signing.gradle`
defaults it to the store password. The two are only distinct on a legacy JKS.

### Where the credentials come from

Three sources, first one that supplies each value wins. They exist because the
signing secret is plaintext *somewhere* by necessity — the build has to decrypt
the private key — so the only real question is how far that plaintext spreads.

**1. Gradle properties — best for local dev.** `~/.gradle/gradle.properties`
lives in your home directory, outside the repo entirely, so no `.gitignore`
mistake can ever expose it, and it applies to every project without repeating
itself:

```properties
androidKeystoreFile=C:/Users/you/keys/upload-keystore.jks
androidKeystorePassword=…
androidKeyAlias=upload
```

**2. Environment variables — best for CI.** Nothing on disk at all:

```bash
ANDROID_KEYSTORE_FILE=…  ANDROID_KEYSTORE_PASSWORD=…  ANDROID_KEY_ALIAS=upload
```

**3. `app/android/keystore.properties`** — the conventional Android layout, and
gitignored, but it is plaintext inside the project tree, which is exactly where
an over-broad `git add -f`, a backup tool or an editor sync is most likely to
pick it up:

```properties
storeFile=C:/Users/you/keys/upload-keystore.jks
storePassword=…
keyAlias=upload
```

**On Windows, use forward slashes in options 1 and 3.** `.properties` is a Java
format in which backslash is the escape character, so
`C:\Users\you\keys\upload-keystore.jks` silently becomes
`C:Usersyoukeysupload-keystore.jks` — then read as a *relative* path and
resolved against `app/android/`. `signing.gradle` fails with the resolved path
and a note about this, so it's a readable error rather than a mystery.

Supplying *some* of the three values but not all is a hard error rather than a
quietly-unsigned build.

### Local release build

```bash
cd app
npm run android:bundle        # -> app/android/app/build/outputs/bundle/release/app-release.aab
npm run android:apk:release   # a signed APK instead, for sideload testing
```

Every release build prints which mode it resolved to, so an unsigned artifact is
visible in the log rather than discovered at upload time:

```
signing.gradle: Signed: release keystore loaded
signing.gradle: versionCode=7 versionName=1.2.3
```

Without `keystore.properties` it builds an **unsigned** bundle and says so.
That's deliberate: referencing a null `storeFile` would fail at Gradle
*configuration* time and break `assembleDebug` on every machine without a key.

### versionCode

Play rejects any `versionCode` it has already seen — they only ever go up, even
for a re-upload of the same user-facing version. The generated `build.gradle`
hardcodes `1`, so `signing.gradle` takes an override instead of the patch script
having to rewrite generated code:

```bash
ANDROID_VERSION_CODE=7 ANDROID_VERSION_NAME=1.2.3 npm run android:bundle
```

### CI

The `bundle` job in `.github/workflows/android.yml` produces the signed `.aab`.
It runs **only** on manual dispatch or a `v*` tag — building one per push would
burn versionCodes and touch the signing secrets constantly. It needs five repo
secrets:

| Secret | |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload-keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | |
| `ANDROID_KEY_ALIAS` | |
| `ANDROID_KEY_PASSWORD` | *optional* — omit for a PKCS12 keystore (see above) |
| `VITE_REVENUECAT_ANDROID_KEY` | public SDK key — the job **fails without it** |

Only the `.jks` is written to the runner's disk (and shredded in an
`if: always()` step); the passwords reach Gradle as environment variables and
never land in a file.

That last one matters more than it looks. Vite inlines `import.meta.env` at
build time, so a release built with no key ships with the store silently
disabled, and `verify:store` cannot catch it — it proves the SDK survived
tree-shaking, not that a key was set. The job checks explicitly instead.

`versionCode` comes from `github.run_number`; a tag build takes its
`versionName` from the tag (`v1.2.3` → `1.2.3`). The keystore is shredded in an
`if: always()` step.

---

## Fullscreen: the system bars are not Capacitor's problem

A landscape-locked, letterboxed game wants the whole panel. Nothing in the
default stack gives it that:

- `lib/platform.ts`'s `requestFullscreen` / `autoEnterFullscreenForRun` is a
  **browser** path. It early-returns on standalone and Capacitor contexts by
  design, because the Fullscreen API does nothing inside a WebView. For the
  same reason `fullscreenSupported()` reports false on native, and the app
  renders **no fullscreen control at all** in the shells — neither the HUD
  rail button nor the pause modal's row (Android's WebView exposes
  `requestFullscreen`, so API presence alone would have kept a dead button on
  screen). The rail's layout budget drops the slot with it
  (`layout.ts`'s `RailLoadout.fullscreen`).
- Capacitor's generated `MainActivity` is a bare `BridgeActivity`, and
  `AppTheme.NoActionBar` sets no fullscreen attributes. `windowNoTitle` removes
  the *action* bar, not the *system* bars.

So the status and navigation bars sit on top of the field. Measured on a
OnePlus 12: the activity got **2256×1080 of a 2376×1080 panel** — 120px, about
5% of the field, spent on chrome the game never uses.

`native/android/MainActivity.java` fixes it with
`WindowInsetsControllerCompat.hide(systemBars())`, re-applied on every
`onWindowFocusChanged(true)` because Android silently restores the bars after an
unlock or a task switch and never notifies the app.

Two details that are load-bearing rather than cosmetic:

- **`setDecorFitsSystemWindows(false)`** is what makes `env(safe-area-inset-*)`
  report the cutout to the WebView. Left at its default, the decor consumes the
  insets and the layout solver reads zeros — so it would reserve nothing and put
  the button rail under the notch.
- **`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`**, not the default. A transient bar
  overlays; a non-transient one *resizes* the WebView. A resize mid-run re-fits
  the world and moves the aim origin out from under the player's finger.

iOS needs none of this: `Info.plist` declares the app status-bar-hidden and
landscape-only, which is exactly the kind of manual edit that got `app/ios/`
committed in the first place.

---

## Display: what the layout solver does, and why native needed it

The field is authored at a fixed 1280×720 and letterboxed. The old HUD assumed
letterboxing always leaves a **side gutter** to put the button rail in. That's
only true on ultrawide. Measured:

| Device class | Aspect | Natural side gutter | Old behavior |
|---|---|---|---|
| 21:9 phone | 2.33 | ~150px | fine |
| iPhone 15 Pro | 2.17 | ~120px | fine |
| Pixel-ish 18:9 | 2.00 | ~120px | fine |
| 16:9 tablet/laptop | 1.78 | **0px** | rail drawn **on top of the play field** |
| 16:10 laptop | 1.60 | 0px (50px vertical) | same overlap |
| iPad 4:3 | 1.33 | 0px (~96px vertical) | same overlap, plus a big unused band |

`app/src/game/layout.ts` replaces that assumption with a solver that picks a
mode and — critically — **reserves the band it needs before fitting the world**,
so the field scales down a few percent instead of the controls being drawn over
it:

- **`wide`** — a natural side gutter fits the rail. Vertical column, right
  gutter, nothing reserved.
- **`snug`** — no usable natural gutter (near-16:9). Reserve a right band, refit
  the world into what's left. Costs ~6% of field scale at 16:9 and buys back the
  entire play area.
- **`tall`** — the top/bottom band is the roomy one (4:3, 16:10). The rail
  becomes a horizontal strip in the bottom band, which is also a better thumb
  reach on a tablet than a far-right column.

Safe-area insets are subtracted from the usable box in **every** mode. In
landscape — the only orientation this game plays in — a notch/Dynamic Island and
the home indicator eat the **left and right** edges, exactly where the field edge
and the button rail live. `env(safe-area-inset-*)` can't be read from JS, so
`applySafeAreaInsets()` mounts a throwaway probe whose padding is those four
env() values and reads the computed padding back.

The mode is published as `data-layout` on `<html>`; `app.css` keys the rail's
placement off it. `computeViewport` (render.ts) delegates to the same solver, so
`screenToWorld` can never disagree with what was drawn — a separate fit there
would silently offset every aim on any non-16:9 viewport.

`npm run test` asserts, for eight device aspect ratios, that the rail always has
≥44px (WCAG 2.5.5) outside the drawn field, that the field stays on screen, and
that a cube never shrinks below 12px.

### Things to verify on real hardware

The solver and safe-area probe are covered by tests headlessly, but these can
only be confirmed on device:

- iPhone landscape: field clear of the Dynamic Island, rail clear of the home
  indicator, both left- and right-hand rotations.
- Android gesture navigation: the bottom-edge swipe zone vs. the `tall`-mode
  rail strip.
- Android WebView cutout: `patch-android.mjs` sets `shortEdges` explicitly.
  Capacitor sets **no** cutout mode of its own — the generated manifest and
  themes leave it at the platform default, which letterboxes and blacks out the
  whole notch column in landscape. (An earlier revision of this document claimed
  Capacitor defaulted to `shortEdges`. It does not.)
- Auto Backup with the service-worker exclusions: re-run the `bmgr` cycle above
  against an APK built with the rules and confirm both halves — the save still
  comes back, **and** the reinstall boots the APK's own bundle (no restored
  `app_webview/Default/Service Worker`, checkable via `run-as`). The rules are
  verified to land in the merged manifest/resources at build time; the restore
  behavior itself only shows on device.
- Sustained framerate with 200+ cubes on a mid-range phone (`npm run sim:perf`
  measures the step cost on desktop; a phone GPU is the untested half).
