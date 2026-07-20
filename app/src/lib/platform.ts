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

/** Loosely-typed handles for the vendor-prefixed (WebKit/older Safari)
 *  Fullscreen API, since lib.dom's types only cover the unprefixed spec. */
interface FullscreenDoc {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface FullscreenEl {
  requestFullscreen?: (opts?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export function isFullscreen(): boolean {
  const d = document as unknown as FullscreenDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** True when neither the standard nor the WebKit-prefixed Fullscreen API is
 *  present on the root element — e.g. iPhone Safari in-browser, which never
 *  exposed `requestFullscreen` on non-video elements. The fullscreen toggle
 *  should hide itself entirely in that case rather than show a button that
 *  can never do anything. */
export function fullscreenSupported(): boolean {
  const el = document.documentElement as unknown as FullscreenEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

/** True for an installed/standalone context — PWA "Add to Home Screen"
 *  (display-mode: standalone), legacy iOS `navigator.standalone`, or the
 *  Capacitor native shell — where there's no browser chrome to hide, so
 *  auto-requesting fullscreen on Play would be a no-op at best. */
export function isStandalone(): boolean {
  const nav = navigator as unknown as { standalone?: boolean };
  const media = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return isNative || media || nav.standalone === true;
}

function isCoarsePointer(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export async function requestFullscreen(): Promise<void> {
  const el = document.documentElement as unknown as FullscreenEl;
  try {
    if (isFullscreen()) return;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {
    /* user gesture / unsupported */
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as unknown as FullscreenDoc;
  try {
    if (!isFullscreen()) return;
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {
    /* ignore */
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (isFullscreen()) await exitFullscreen();
  else await requestFullscreen();
}

/** Called from *inside* the Play/Start button's click handler (never on a
 *  timer or outside a gesture — browsers reject/ignore fullscreen requests
 *  that aren't a direct result of user activation). Only auto-requests on
 *  coarse-pointer (touch) devices, and only when there's real browser chrome
 *  to hide: skips already-fullscreen and standalone/Capacitor contexts. */
export async function autoEnterFullscreenForRun(): Promise<void> {
  if (!isCoarsePointer() || isStandalone() || isFullscreen()) return;
  await requestFullscreen();
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
