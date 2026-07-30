import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell config for the Android/iOS builds (see docs/NATIVE.md for the
 * full pipeline). The web app in dist/ is the SAME bundle the PWA serves — the
 * native projects are thin WebView wrappers, so anything fixed here also has to
 * hold for the browser build and vice versa.
 */
const config: CapacitorConfig = {
  appId: "com.tetrilaunch.app",
  appName: "Tetrilaunch",
  webDir: "dist",
  backgroundColor: "#07070f",
  server: {
    // Serve the bundle over https://localhost rather than the legacy file://
    // scheme. file:// is a null origin, which makes localStorage unreliable
    // across WebView upgrades — and localStorage is where the whole
    // meta-progression save lives (lib/store.ts's salvage + unlocks). An https
    // scheme gives it a stable origin. (Capacitor 6 already defaults to https
    // on Android; stated explicitly so a future default flip can't silently
    // reset every player's unlocks.)
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  android: {
    backgroundColor: "#07070f",
    // No pinch/double-tap zoom: it competes for the same touches as the
    // drag-to-aim gesture, and a zoomed WebView breaks the layout solver's
    // assumption that CSS px map 1:1 to the viewport it measured.
    zoomEnabled: false,
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: "#07070f",
    // "never", not "always": the app draws its own safe-area handling (the
    // layout solver reads env(safe-area-inset-*) via lib/platform's
    // applySafeAreaInsets and reserves the notch/home-indicator bands itself —
    // see game/layout.ts). Letting WKWebView also inset the content would
    // double-count those insets and letterbox the field twice.
    contentInset: "never",
    // No rubber-band scroll and no pinch zoom — both fight the aim drag.
    scrollEnabled: false,
    zoomEnabled: false,
    // Paired with WKAppBoundDomains in ios/App/App/Info.plist; the flag does
    // nothing unless that key is declared. Unverified on a device — if the
    // leaderboard or a paywall web view ever misbehaves on iOS, this is the
    // first thing to switch off.
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    ScreenOrientation: {
      // Handled at runtime via @capacitor/screen-orientation (lock landscape —
      // see lib/platform's lockLandscape).
    },
  },
};

export default config;
