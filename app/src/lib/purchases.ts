// RevenueCat integration. Everything here is a no-op off-native (the web/PWA
// build has no store to talk to), so callers never have to branch — they just
// check `purchasesReady()` before showing store UI.
//
// The SDK loads through the memoised `sdk()` below rather than a static import,
// so the ~25 kB of StoreKit/Billing wrapper sits in its own chunk that only the
// native shells ever fetch.
import type { CustomerInfo } from "@revenuecat/purchases-capacitor";
import { isNative } from "./platform";

/** Entitlement identifier as configured in the RevenueCat dashboard. Whatever
 *  products/offerings are attached to it, the app only ever asks "is it on?". */
export const PRO_ENTITLEMENT = "pro";

/** Publishable SDK keys (`appl_…` / `goog_…`). These are *public* by design —
 *  RevenueCat's secret keys are the ones that never leave a server — but they
 *  live in env so a fork builds without inheriting someone else's project. */
const KEYS = {
  ios: import.meta.env.VITE_REVENUECAT_IOS_KEY as string | undefined,
  android: import.meta.env.VITE_REVENUECAT_ANDROID_KEY as string | undefined,
};

type ProListener = (pro: boolean) => void;

let ready = false;
let pro = false;
const listeners = new Set<ProListener>();

/**
 * Load (once) every module the store needs.
 *
 * **Every exported function must await this before testing any other state.**
 * Vite inlines `import.meta.env` at build time, so in a build with no key
 * `KEYS` folds to undefined; Rollup then proves the key check always fails,
 * proves `ready` is therefore always false, and eliminates every import that
 * sits behind those checks — silently producing a native build with no
 * RevenueCat in it at all. Keeping the imports in one place, ahead of all
 * state, is what stops a missing env var from stripping the SDK.
 */
async function loadSdk() {
  const [core, purchases, ui] = await Promise.all([
    import("@capacitor/core"),
    import("@revenuecat/purchases-capacitor"),
    import("@revenuecat/purchases-capacitor-ui"),
  ]);
  return { ...core, ...purchases, ...ui };
}

let sdkPromise: ReturnType<typeof loadSdk> | null = null;

function sdk(): ReturnType<typeof loadSdk> {
  return (sdkPromise ??= loadSdk());
}

function setPro(next: boolean): void {
  if (next === pro) return;
  pro = next;
  for (const l of listeners) l(next);
}

function readPro(info: CustomerInfo): boolean {
  return info.entitlements.active[PRO_ENTITLEMENT] !== undefined;
}

/** True once configure() has succeeded — i.e. we're native and a key was
 *  supplied. Store buttons should stay hidden until this is true. */
export function purchasesReady(): boolean {
  return ready;
}

export function isPro(): boolean {
  return pro;
}

/** Subscribe to entitlement changes (purchase, restore, expiry, or a renewal
 *  RevenueCat pushes down). Returns an unsubscribe. */
export function onProChange(fn: ProListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Configure the SDK. Safe to call unconditionally and safe to call twice.
 * Deliberately swallows failures: a store outage must never block the game.
 */
export async function initPurchases(): Promise<void> {
  if (!isNative) return;
  try {
    const { Capacitor, Purchases, LOG_LEVEL } = await sdk();
    if (ready) return;
    const apiKey = Capacitor.getPlatform() === "android" ? KEYS.android : KEYS.ios;
    if (!apiKey) {
      console.warn("[purchases] no RevenueCat key configured — store disabled");
      return;
    }
    if (import.meta.env.DEV) await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    await Purchases.configure({ apiKey });
    ready = true;
    // Renewals, expiries and purchases made on another device arrive on this
    // listener, so nothing polls.
    await Purchases.addCustomerInfoUpdateListener((info) => setPro(readPro(info)));
    const { customerInfo } = await Purchases.getCustomerInfo();
    setPro(readPro(customerInfo));
  } catch (err) {
    console.warn("[purchases] configure failed", err);
  }
}

/**
 * Show the paywall built in the RevenueCat dashboard — offerings, pricing and
 * copy are all remote-configured, so changing the offer needs no app update.
 * Resolves to the entitlement state afterwards.
 */
export async function presentPaywall(): Promise<boolean> {
  try {
    const { RevenueCatUI, PAYWALL_RESULT } = await sdk();
    if (!ready) return pro;
    const { result } = await RevenueCatUI.presentPaywall();
    if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
      await refresh();
    }
  } catch (err) {
    console.warn("[purchases] paywall failed", err);
  }
  return pro;
}

/**
 * RevenueCat's Customer Center — self-serve subscription management, refunds
 * and cancellations. Apple requires a way to manage a subscription from inside
 * the app; this is it, without building the screens.
 */
export async function presentCustomerCenter(): Promise<void> {
  try {
    const { RevenueCatUI } = await sdk();
    if (!ready) return;
    await RevenueCatUI.presentCustomerCenter();
    await refresh();
  } catch (err) {
    console.warn("[purchases] customer center failed", err);
  }
}

/** Restore on a reinstall or a new device. Apple requires this to be reachable
 *  without a purchase, hence its own button in Settings. */
export async function restorePurchases(): Promise<boolean> {
  try {
    const { Purchases } = await sdk();
    if (!ready) return pro;
    const { customerInfo } = await Purchases.restorePurchases();
    setPro(readPro(customerInfo));
  } catch (err) {
    console.warn("[purchases] restore failed", err);
  }
  return pro;
}

async function refresh(): Promise<void> {
  const { Purchases } = await sdk();
  const { customerInfo } = await Purchases.getCustomerInfo();
  setPro(readPro(customerInfo));
}
