# iOS (Capacitor) — build, sign, ship

The native iOS project lives in **`app/ios/`** and is committed to the repo, so a Mac
only has to install pods and open Xcode. Everything below assumes you have a paid
**Apple Developer Program** membership ($99/yr — required for TestFlight and the App
Store; a free Apple ID can only side-load to your own device for 7 days).

| | |
|---|---|
| Bundle ID | `com.tetrilaunch.app` (`PRODUCT_BUNDLE_IDENTIFIER`, set from `capacitor.config.ts`) |
| Display name | Tetrilaunch |
| Devices | iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`), **landscape only** |
| Min iOS | 13.0 (`IPHONEOS_DEPLOYMENT_TARGET`) |
| Signing | Automatic (`CODE_SIGN_STYLE = Automatic`) — pick your team in Xcode |
| Capacitor | 6.x, plugins: `@capacitor/haptics`, `@capacitor/screen-orientation` |

## 1. One-time setup on the Mac

Requires macOS with **Xcode 16+** (App Store), its command-line tools, **CocoaPods**,
and Node 20+.

```bash
xcode-select --install
sudo gem install cocoapods          # or: brew install cocoapods

git clone https://github.com/venetanji/tetrilaunch.git
cd tetrilaunch/app
npm install
npm run ios:sync                    # vite build → copies dist/ into ios/ → pod install
npm run ios:open                    # opens ios/App/App.xcworkspace in Xcode
```

`ios:sync` is the command to re-run after **any** web change — Capacitor copies
`app/dist/` into `ios/App/App/public/`, which is gitignored precisely because it is a
build artifact.

> Always open `App.xcworkspace`, never `App.xcodeproj` — the pods only exist in the
> workspace.

## 2. Point the project at your developer account

1. **Xcode → Settings → Accounts → +** → Apple ID → sign in with the account that holds
   the membership. Your team shows up here.
2. In the project navigator select **App** → target **App** → **Signing & Capabilities**:
   - **Automatically manage signing** ✓
   - **Team** → your team
   - **Bundle Identifier** stays `com.tetrilaunch.app`

   Xcode registers the App ID, issues a development certificate and creates the
   provisioning profile. If you'd rather do it by hand:
   [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list)
   → *Identifiers* → **+** → *App IDs* → *App* → explicit Bundle ID
   `com.tetrilaunch.app`. No extra capabilities are needed — the game uses no push,
   no sign-in, no in-app purchase.

3. **Run on a device:** plug in an iPhone, pick it in the run-destination menu, ⌘R. The
   first launch needs the certificate trusted on the phone: *Settings → General → VPN &
   Device Management → your developer profile → Trust*.

   The Simulator works too (⌘R with a simulated device) — physics and touch input are
   fine there, but haptics are not.

## 3. App Store Connect

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Business** →
   accept the *Paid/Free Apps* agreement if you haven't (uploads are rejected until
   the agreements are current).
2. **Apps → + → New App**
   - Platform **iOS**, Name (must be unique across the whole store — "Tetrilaunch"
     should be free), Primary language, **Bundle ID** = `com.tetrilaunch.app`,
     SKU = anything internal, e.g. `tetrilaunch-ios`.
3. **Version numbers** before each upload, in the target's *General* tab:
   - *Version* (`MARKETING_VERSION`) — the user-visible `1.0.0`.
   - *Build* (`CURRENT_PROJECT_VERSION`) — must strictly increase on **every** upload,
     even for the same version.
4. **Archive & upload:** run destination → **Any iOS Device (arm64)** → *Product →
   Archive* → in the Organizer, **Distribute App → App Store Connect → Upload**.
5. The build lands in **TestFlight** after processing (a few minutes). Internal testers
   (up to 100 of your own team members) can install it right away; external testers go
   through a light review.
6. **Submit for review** from the App Store tab once the listing is filled in.

### What the listing needs

- **Screenshots** — one iPhone set (6.9″ display) and, because the target is universal,
  one iPad set (13″). Apple scales them down for smaller devices. Landscape shots, since
  the app is landscape-only. Simulator + ⌘S gives correctly-sized captures.
- Description, keywords, support URL, marketing URL (optional), and a **privacy policy
  URL** — required for every app, even one that collects almost nothing.
- **Age rating** questionnaire.
- **App Privacy** — see below.
- Export compliance is already answered: `ITSAppUsesNonExemptEncryption = false` in
  `Info.plist` (HTTPS-only usage is exempt), so App Store Connect stops asking on
  every upload.

### App Privacy answers for this app

The only thing that leaves the device is a leaderboard submission to
`https://tetrilaunch.venetanji.workers.dev/api/scores` — the player's chosen display
name plus score/level/lines. So:

- **Data collected: User Content → Other User Content** — purpose *App Functionality*,
  **not** linked to identity, **not** used for tracking.
- No analytics, no ads, no third-party SDKs, no IDFA — nothing to declare under Tracking.

One thing to fix before you ship: `app/index.html` pulls the fonts from
`fonts.googleapis.com` at runtime. That sends the device's IP to Google and makes the
UI fall back to system fonts when the device is offline — which a native app shouldn't
do. Self-hosting the four families in `app/public/fonts/` removes both problems.

## 4. Icons and launch screen

The asset catalogs are generated, not hand-drawn:

```
app/resources/icon.svg          1024² source, wordmark removed (too small to read)
app/resources/splash.svg        2732² launch screen source
app/scripts/rasterize-assets.mjs  svg → png
```

```bash
cd app && npm run assets:generate    # rasterises, then fills ios/App/App/Assets.xcassets
```

Edit the SVGs and re-run to change the artwork. iOS icons must be opaque and get their
corners rounded by the system, so the source is flattened onto `#07070f` and keeps its
content inside the middle ~80%.

## 5. Everyday workflow

```bash
cd app
npm run ios:sync     # after web changes: build + copy + pod install
npm run ios:open     # Xcode
# or straight to a connected device / simulator:
npm run ios:run
```

Re-run `npx cap sync ios` (which `ios:sync` does) whenever you add or update a
Capacitor plugin — that's what rewrites the `Podfile` and re-runs `pod install`.

## 6. Notes

- `app/ios/Podfile.lock` isn't committed yet because pods can only be resolved on macOS.
  Commit it after your first `pod install` so builds are reproducible.
- **Native-only config** lives in two places: `app/capacitor.config.ts` (web-view
  behaviour — background colour, `contentInset: "never"`, `scrollEnabled: false`) and
  `app/ios/App/App/Info.plist` (orientation, hidden status bar, `UIRequiresFullScreen`,
  export compliance). Both are committed.
- **Android** is not generated in the repo — `npx cap add android` when you want it.
- **No Mac?** Xcode Cloud, a GitHub Actions `macos-latest` runner, or Ionic Appflow can
  archive and upload instead; all of them need the signing certificate and an App Store
  Connect API key stored as secrets. Nothing in this repo depends on that yet.
- Capacitor 7 raises the minimum to iOS 14 and drops some legacy config. The current
  6.x setup builds fine with Xcode 16, so the upgrade can wait for its own change.
