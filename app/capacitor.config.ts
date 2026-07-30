import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tetrilaunch.app",
  appName: "Tetrilaunch",
  webDir: "dist",
  backgroundColor: "#07070f",
  android: {
    backgroundColor: "#07070f",
  },
  ios: {
    backgroundColor: "#07070f",
    // The canvas is full-bleed and the layout already pads itself with
    // env(safe-area-inset-*) (index.html sets viewport-fit=cover), so let the
    // web view own every pixel instead of insetting it for the status bar.
    contentInset: "never",
    // Suppress the WKWebView "rubber band" — the game field must not scroll.
    scrollEnabled: false,
  },
  plugins: {
    ScreenOrientation: {
      // Handled at runtime via @capacitor/screen-orientation (lock landscape).
    },
  },
};

export default config;
