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
 *  products/offerings are attached to it, the app only ever asks "is it on?".
 *
 *  Must match the dashboard **byte for byte** — spaces and capitals included.
 *  A mismatch fails silently in the worst possible way: the purchase succeeds,
 *  the receipt validates, and `entitlements.active[…]` is simply undefined, so
 *  the player is charged and nothing unlocks. */
export const UNLIMITED_ENTITLEMENT = "Tetrilaunch Unlimited";

/** Publishable SDK keys (`appl_…` / `goog_…`). These are *public* by design —
 *  RevenueCat's secret keys are the ones that never leave a server — but they
 *  live in env so a fork builds without inheriting someone else's project. */
const KEYS = {
  ios: import.meta.env.VITE_REVENUECAT_IOS_KEY as string | undefined,
  android: import.meta.env.VITE_REVENUECAT_ANDROID_KEY as string | undefined,
};

/**
 * RevenueCat's Test Store — a simulated store that needs no Play/App Store
 * product setup. It replaces the platform key at configure() time, and its
 * purchase sheet offers "succeed / fail / cancel" buttons instead of charging
 * anything.
 *
 * Gated on a dedicated Vite mode rather than on DEV, because the debug and
 * release APKs are built from the SAME `--mode native` bundle — there is no
 * debug/release distinction inside the web build to key off. Only
 * `npm run build:teststore` sets this, and no release path invokes it.
 *
 * RevenueCat's own warning is unambiguous: "Never submit an app to the App
 * Store or Google Play that is configured with a Test Store API key." Wiring
 * alone isn't enough of a guarantee, so scripts/verify-store-bundle.mjs also
 * fails the build if a test_ key reaches a bundle that isn't explicitly a
 * Test Store build.
 */
const USE_TEST_STORE = import.meta.env.MODE === "teststore";

/**
 * The test key is read HERE, inside a branch on a build-time constant, and not
 * as a property of KEYS above. That placement is load-bearing.
 *
 * Vite inlines every referenced import.meta.env var as a string literal before
 * Rollup runs. As a property of an object literal that is always constructed,
 * the key survives into every bundle — unused in a release build, but present
 * in the shipped JS, and `unzip`-able out of the APK. Behind `MODE ===
 * "teststore"` the condition folds to a literal false in any other mode and the
 * branch, string and all, is eliminated.
 *
 * verify-store-bundle.mjs asserts this holds in the emitted output. It caught
 * exactly this leak when the key lived in KEYS, which is why it is written as
 * an output check rather than a code review rule.
 */
function testStoreKey(): string | undefined {
  if (!USE_TEST_STORE) return undefined;
  return import.meta.env.VITE_REVENUECAT_TEST_KEY as string | undefined;
}

type UnlimitedListener = (unlimited: boolean) => void;

let ready = false;
let unlimited = false;
const listeners = new Set<UnlimitedListener>();

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

function setUnlimited(next: boolean): void {
  if (next === unlimited) return;
  unlimited = next;
  for (const l of listeners) l(next);
}

function readUnlimited(info: CustomerInfo): boolean {
  return info.entitlements.active[UNLIMITED_ENTITLEMENT] !== undefined;
}

/** True once configure() has succeeded — i.e. we're native and a key was
 *  supplied. Store buttons should stay hidden until this is true. */
export function purchasesReady(): boolean {
  return ready;
}

export function isUnlimited(): boolean {
  return unlimited;
}

/** Subscribe to entitlement changes (purchase, restore, expiry, or a renewal
 *  RevenueCat pushes down). Returns an unsubscribe. */
export function onUnlimitedChange(fn: UnlimitedListener): () => void {
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
    const platformKey = Capacitor.getPlatform() === "android" ? KEYS.android : KEYS.ios;
    const apiKey = USE_TEST_STORE ? testStoreKey() : platformKey;
    if (!apiKey) {
      console.warn(
        USE_TEST_STORE
          ? "[purchases] teststore build but VITE_REVENUECAT_TEST_KEY is unset — store disabled"
          : "[purchases] no RevenueCat key configured — store disabled",
      );
      return;
    }
    // Loud on purpose: a tester who doesn't realise they are on the Test Store
    // will report "the purchase went through but nothing was charged" as a bug.
    if (USE_TEST_STORE) console.warn("[purchases] TEST STORE build — purchases are simulated");
    if (import.meta.env.DEV) await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    await Purchases.configure({ apiKey });
    ready = true;
    // Renewals, expiries and purchases made on another device arrive on this
    // listener, so nothing polls.
    await Purchases.addCustomerInfoUpdateListener((info) => setUnlimited(readUnlimited(info)));
    const { customerInfo } = await Purchases.getCustomerInfo();
    setUnlimited(readUnlimited(customerInfo));
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
    if (!ready) return unlimited;
    const { result } = await RevenueCatUI.presentPaywall();
    if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
      await refresh();
    }
  } catch (err) {
    console.warn("[purchases] paywall failed", err);
  }
  return unlimited;
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
    if (!ready) return unlimited;
    const { customerInfo } = await Purchases.restorePurchases();
    setUnlimited(readUnlimited(customerInfo));
  } catch (err) {
    console.warn("[purchases] restore failed", err);
  }
  return unlimited;
}

async function refresh(): Promise<void> {
  const { Purchases } = await sdk();
  const { customerInfo } = await Purchases.getCustomerInfo();
  setUnlimited(readUnlimited(customerInfo));
}
