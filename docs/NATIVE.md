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
| Aspect-ratio layout solver (phone / tablet / ultrawide) | done — `game/layout.ts`, see below |
| npm scripts (`android:open`, `android:apk`, `ios:open`, …) | done |
| CI debug-APK build | done — `.github/workflows/android.yml` |
| Landscape lock, haptics | already shipped (`@capacitor/screen-orientation`, `@capacitor/haptics`) |
| In-app purchases | done — RevenueCat, native only (`src/lib/purchases.ts`, [docs/ios.md](ios.md)) |
| iOS Xcode project, icons, `Info.plist` | **committed** at `app/ios/` — see [docs/ios.md](ios.md) |
| **Signed release builds / store listings** | **not done — needs secrets, see below** |

**`app/android/` is gitignored; `app/ios/` is committed.** They're treated
differently on purpose. Android is still a pure derived artifact — `npx cap add
android` regenerates it from `capacitor.config.ts` plus the installed plugins,
and nothing in it is hand-edited, so CI rebuilding it from scratch every run is
a feature (it proves `cap add` still works from a clean checkout).

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

- **Android**: **JDK 21** and the Android SDK (Capacitor 8 builds with AGP 8.13,
  `compileSdk 36`, `minSdk 24`, and sets source/target compatibility to Java 21 —
  JDK 17 will not build it). Android Studio installs all of it; CI installs it
  via `android-actions/setup-android`.
- **iOS**: macOS and **Xcode 16+**. No CocoaPods — see the SPM note above. There
  is no way around the macOS requirement — an iOS build cannot be produced on
  Linux, which is why CI only covers Android.

---

## CI

`.github/workflows/android.yml` builds a debug APK on pushes touching `app/`
and on manual dispatch, and uploads it as a workflow artifact. It runs
`npm run test` (the systems smoke test) and `tsc` first, so a broken build never
gets as far as Gradle. Nothing is signed and nothing is published — that's
deliberate, see below.

## What's still needed for the stores

These need credentials that don't belong in a repo, so they're documented rather
than half-implemented:

1. **Android signing** — generate an upload keystore, add
   `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` /
   `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` as repo secrets, then extend the
   workflow with a `assembleRelease` job that writes `android/keystore.properties`
   from them. Play requires an `.aab` (`bundleRelease`), not an APK.
2. **iOS signing** — done manually in Xcode today (automatic signing, pick your
   team; the full walkthrough is in [docs/ios.md](ios.md)). Automating it needs
   an App Store Connect API key and a macOS runner — `xcodebuild
   -allowProvisioningUpdates`, Xcode Cloud, or `fastlane match`.
3. **Icons and splash screens** — **done for iOS**: `app/resources/{icon,splash}.svg`
   rasterise into the Xcode asset catalogs via `npm run assets:generate`
   (`@capacitor/assets`). The same sources can feed Android by adding `--android`
   to that script once `app/android/` exists.
4. **Store metadata** — screenshots at each required device size, descriptions,
   content rating, privacy declaration. The app collects a player-entered name
   for the leaderboard *and* now sells in-app purchases, both of which are
   disclosable on either store; the worked-out App Privacy answers are in
   [docs/ios.md](ios.md).
5. **Release-build env** — `VITE_REVENUECAT_*` keys must be present in the
   environment for any build you intend to ship, or the store quietly disables
   itself. `verify:store` catches the SDK being dropped entirely, but it cannot
   tell a missing key from a deliberate keyless build.

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
- Android WebView cutout: Capacitor's default is `shortEdges`; if a device
  letterboxes instead, `env(safe-area-inset-*)` reports 0 and there's nothing to
  do — but worth confirming.
- Sustained framerate with 200+ cubes on a mid-range phone (`npm run sim:perf`
  measures the step cost on desktop; a phone GPU is the untested half).
