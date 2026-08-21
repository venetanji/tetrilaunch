import { Capacitor } from "@capacitor/core";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { loadSettings } from "./store";
import { setSafeAreaInsets, type Insets } from "../game/layout";

export const isNative = Capacitor.isNativePlatform();

/** One reload per page session is all this is allowed. Without the guard a
 *  worker that survives the purge would send the shell into a boot loop, which
 *  is a far worse failure than the stale bundle it is trying to fix. */
const PURGE_RELOAD_FLAG = "tl.sw-purge-reloaded";

/** Evict any service worker inside the native shell.
 *
 *  Native builds no longer ship one (vite.config.ts disables the PWA plugin for
 *  `--mode native`), but a shell updated from an older build still has the OLD
 *  worker registered and keeps serving that build's precache — app data
 *  survives `install -r`. Dropping the plugin removes the thing that would
 *  otherwise have replaced it, so without this an already-updated device would
 *  be pinned to its stale bundle permanently.
 *
 *  WHY THE RELOAD. Unregistering alone does not work, and measuring on device
 *  is the only way that shows up. The worker precaches index.html, so on every
 *  launch the shell boots from the OLD HTML rather than the one inside the APK
 *  — and that old HTML still carries the `registerSW.js` tag the native build
 *  no longer emits. So each launch went: worker serves stale HTML -> stale HTML
 *  re-registers the worker -> this function unregisters it -> next launch
 *  repeats, forever. The page doing the unregistering was itself served by the
 *  thing it was trying to remove.
 *
 *  Reloading breaks that. Once the registration and caches are gone, nothing
 *  intercepts the next request, so the reload boots the APK's real index.html,
 *  which has no registration script — and there is nothing left to resurrect.
 *  Costs one flicker, once, on the single launch after an upgrade.
 *
 *  Safe to run every launch: with no worker registered and no client
 *  controlling the page, this finds nothing, reloads nothing and costs nothing.
 *  Web is untouched — there the worker is the point. Failures are swallowed
 *  because a WebView that denies the API has nothing cached to purge either.
 *
 *  What this CANNOT fix: Android Auto Backup restoring a previous install's
 *  worker into a FRESH install (reproduced on device 2026-08-09 — a clean
 *  `adb install` came up as a months-old build). The restored worker decides
 *  which bundle boots and picks its own precache, so this function only ever
 *  runs from the stale shell — a build old enough that it may predate this
 *  purge entirely. That vector is closed at the source instead: the backup
 *  rules scripts/patch-android.mjs installs exclude app_webview's Service
 *  Worker store from backup, while keeping Local Storage (the save) in. */
export async function purgeNativeServiceWorker(): Promise<void> {
  if (!isNative) return;
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    // The controller matters as much as the registration list: it is what says
    // THIS page was served by a worker, and therefore that its HTML may be the
    // stale copy that re-registers one.
    const wasWorkerBacked = regs.length > 0 || !!navigator.serviceWorker?.controller;

    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));

    if (!wasWorkerBacked) return;
    if (sessionStorage.getItem(PURGE_RELOAD_FLAG)) return;
    sessionStorage.setItem(PURGE_RELOAD_FLAG, "1");
    location.reload();
  } catch {
    /* no SW API, or a WebView that denies it — nothing cached, nothing to do */
  }
}

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

/** Whether haptics can DO anything here: the native shells always can
 *  (Capacitor Haptics), the web only where navigator.vibrate exists — which
 *  iOS Safari and the iOS PWA do not have. The Settings screen hides the
 *  toggle when this is false, because a switch that can never do anything is
 *  a broken promise, not an option. */
export function hapticsSupported(): boolean {
  return isNative || typeof navigator.vibrate === "function";
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

/**
 * Measure the device's real safe-area insets and hand them to the layout solver.
 *
 * These can't be read directly from JS — `env(safe-area-inset-*)` only exists in
 * CSS — so this mounts a throwaway probe whose padding IS those four env()
 * values and reads the computed padding back. Cheap (one layout, immediately
 * removed) and called once per resize/orientation change, which is exactly when
 * the values can actually change.
 *
 * Why the layout solver needs them at all: in LANDSCAPE (the only orientation
 * this game plays in) a notch/Dynamic Island and the home indicator eat the
 * LEFT and RIGHT edges, not the top — precisely the edges the field and the
 * button rail live at. Without this the field would sit partly under the notch
 * on an iPhone and the rail partly under the home-indicator swipe zone, both of
 * which are only visible on real hardware.
 *
 * Returns the insets as well as publishing them, for callers that want to log
 * or assert on them.
 */
export function applySafeAreaInsets(): Insets {
  // The probe's styles live in a STYLESHEET rule (app.css's .safe-probe), not
  // an inline style. iOS WKWebView resolves env(safe-area-inset-*) from
  // stylesheet rules (that's how .side-rail's `right: max(...env()...)`
  // works there) but returned 0 for the same functions written via
  // style.cssText — which fed zeros to the layout solver while the CSS rail
  // moved by the real inset, drawing the rail on top of the play field.
  const probe = document.createElement("div");
  probe.className = "safe-probe";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const insets: Insets = {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
  probe.remove();
  setSafeAreaInsets(insets);
  return insets;
}
