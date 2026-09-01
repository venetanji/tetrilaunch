import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell config for the Android/iOS builds (see docs/NATIVE.md for the
 * full pipeline). The web app in dist/ is the SAME bundle the PWA serves — the
 * native projects are thin WebView wrappers, so anything fixed here also has to
 * hold for the browser build and vice versa.
 */
const config: CapacitorConfig = {
  // Android's published package name. The committed iOS target deliberately
  // uses com.tetrilaunch.game because com.tetrilaunch.app belongs to a
  // different Apple Developer team; `cap sync` preserves that Xcode setting.
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
    // OFF, and deliberately so. This was true "paired with WKAppBoundDomains
    // in Info.plist" — but that key was never actually declared there, so the
    // first device install (TestFlight 1.0.2 (7), iPhone X) ran a WebView
    // restricted to an app-bound domain list that did not exist. The old
    // comment called itself "unverified on a device" and "the first thing to
    // switch off"; the device agreed. Re-enabling requires BOTH halves: the
    // plist key listing every domain the app touches, and a real-device pass.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    // hidden:true is two statements in one, both wanted: the status bar stays
    // hidden (restating Info.plist's UIStatusBarHidden through the plugin that
    // owns it at runtime) and — the reason this entry exists — iOS's home
    // indicator auto-hides. Capacitor's SystemBars plugin overrides
    // prefersHomeIndicatorAutoHidden on the bridge view controller and feeds
    // it from THIS config; a subclass cannot override the property (it is
    // public, not open — the first CI build tried). On Android the same flag
    // hides the system bars for the same fullscreen reasons.
    SystemBars: {
      hidden: true,
    },
    ScreenOrientation: {
      // Handled at runtime via @capacitor/screen-orientation (lock landscape —
      // see lib/platform's lockLandscape).
    },
    SocialLogin: {
      // Providers default to TRUE, and true means their native SDKs are
      // compiled into the binary: without these two `false`s the plugin's
      // post-sync hook links the whole Facebook SDK into an app that never
      // calls it — size, and a privacy-scanner finding, for nothing.
      providers: { google: true, apple: true, facebook: false, twitter: false },
    },
  },
};

export default config;
