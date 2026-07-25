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
| `@capacitor/android`, `@capacitor/ios` platform packages | installed (devDeps) |
| `capacitor.config.ts` — `androidScheme: https`, `contentInset: never`, scroll/zoom off | done |
| Safe-area handling (notch / home indicator) | done — `lib/platform.ts` `applySafeAreaInsets()` → `game/layout.ts` |
| Aspect-ratio layout solver (phone / tablet / ultrawide) | done — `game/layout.ts`, see below |
| npm scripts (`android:open`, `android:apk`, `ios:open`, …) | done |
| CI debug-APK build | done — `.github/workflows/android.yml` |
| Landscape lock, haptics | already shipped (`@capacitor/screen-orientation`, `@capacitor/haptics`) |
| **Signed release builds / store listings** | **not done — needs secrets, see below** |

The generated `app/android/` and `app/ios/` directories are **gitignored on
purpose**. They're derived artifacts: `npx cap add` regenerates them from
`capacitor.config.ts` plus the installed plugins, so committing them means
hand-maintaining native scaffolding that the CLI would otherwise own. The
tradeoff is that any *manual* native edit (a custom `AndroidManifest.xml` entry,
a Gradle tweak) would be lost — if that ever becomes necessary, commit the
platform directory at that point and stop regenerating it.

---

## First-time setup

```bash
cd app
npm install
npm run build            # produces dist/ — cap sync copies this

npm run cap:add:android  # generates app/android/  (needs Android SDK)
npm run cap:add:ios      # generates app/ios/      (needs macOS + Xcode)
```

## Day-to-day

```bash
npm run android:open     # build + sync + open in Android Studio
npm run android:run      # build + sync + run on a connected device/emulator
npm run android:apk      # build + sync + assembleDebug -> an installable APK

npm run ios:open         # build + sync + open in Xcode
npm run ios:run          # build + sync + run on a simulator/device
```

`npm run cap:sync` is `build && cap sync` — it rebuilds the web bundle *first*,
which is the step that's easy to forget and produces the classic "my change
isn't in the app" confusion.

The debug APK lands at:

```
app/android/app/build/outputs/apk/debug/app-debug.apk
```

### Requirements

- **Android**: JDK 17, Android SDK (platform 34+, build-tools 34+). Android
  Studio installs all of it; CI installs it via `android-actions/setup-android`.
- **iOS**: macOS, Xcode 15+, CocoaPods. There is no way around the macOS
  requirement — an iOS build cannot be produced on Linux, which is why CI only
  covers Android.

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
2. **iOS signing** — an Apple Developer account, an App Store Connect API key,
   and a macOS runner. `fastlane match` or Xcode Cloud is the usual answer.
3. **Icons and splash screens** — `app/public/icons/icon.svg` is currently the
   only icon asset and it's an SVG; both stores want a raster set.
   `@capacitor/assets` generates every size from one 1024×1024 PNG.
4. **Store metadata** — screenshots at each required device size, descriptions,
   content rating, privacy declaration. The app collects a player-entered name
   for the leaderboard, which is a disclosable data collection on both stores.

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
