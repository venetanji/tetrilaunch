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
    contentInset: "always",
  },
  plugins: {
    ScreenOrientation: {
      // Handled at runtime via @capacitor/screen-orientation (lock landscape).
    },
  },
};

export default config;
