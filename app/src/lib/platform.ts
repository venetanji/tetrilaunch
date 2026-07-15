import { Capacitor } from "@capacitor/core";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { loadSettings } from "./store";

export const isNative = Capacitor.isNativePlatform();

/** Lock to landscape on native; best-effort on web. */
export async function lockLandscape(): Promise<void> {
  try {
    await ScreenOrientation.lock({ orientation: "landscape" });
  } catch {
    try {
      // Web Screen Orientation API (requires fullscreen on most browsers).
      await (screen.orientation as unknown as { lock(o: string): Promise<void> })?.lock?.(
        "landscape",
      );
    } catch {
      /* not supported — the rotate-guard handles portrait */
    }
  }
}

export function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

export async function enterFullscreen(): Promise<void> {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    /* user gesture / unsupported */
  }
}

export async function tapHaptic(): Promise<void> {
  if (!loadSettings().haptics) return;
  try {
    if (isNative) await Haptics.impact({ style: ImpactStyle.Light });
    else navigator.vibrate?.(10);
  } catch {
    /* ignore */
  }
}

export async function successHaptic(): Promise<void> {
  if (!loadSettings().haptics) return;
  try {
    if (isNative) await Haptics.notification({ type: NotificationType.Success });
    else navigator.vibrate?.([20, 40, 20]);
  } catch {
    /* ignore */
  }
}

export async function impactHaptic(): Promise<void> {
  if (!loadSettings().haptics) return;
  try {
    if (isNative) await Haptics.impact({ style: ImpactStyle.Medium });
    else navigator.vibrate?.(24);
  } catch {
    /* ignore */
  }
}
