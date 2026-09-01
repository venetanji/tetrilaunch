// RevenueCat integration for both Capacitor and the web/PWA. Callers never
// branch by platform; this module selects the matching SDK and exposes one
// entitlement-shaped interface.
//
// The SDK loads through the memoised `sdk()` below rather than a static import,
// so the ~25 kB of StoreKit/Billing wrapper sits in its own chunk that only the
// native shells ever fetch.
import type { CustomerInfo as NativeCustomerInfo } from "@revenuecat/purchases-capacitor";
import type { CustomerInfo as WebCustomerInfo, Purchases as WebPurchases } from "@revenuecat/purchases-js";
import { isNative } from "./platform";

/** Entitlement identifier as configured in the RevenueCat dashboard. Whatever
 *  products/offerings are attached to it, the app only ever asks "is it on?".
 *
 *  Must match the dashboard **byte for byte** — spaces and capitals included.
 *  A mismatch fails silently in the worst possible way: the purchase succeeds,
 *  the receipt validates, and `entitlements.active[…]` is simply undefined, so
 *  the player is charged and nothing unlocks. */
export const UNLIMITED_ENTITLEMENT = "full_game";

/** Publishable SDK keys (`appl_…` / `goog_…`). These are *public* by design —
 *  RevenueCat's secret keys are the ones that never leave a server — but they
 *  live in env so a fork builds without inheriting someone else's project. */
const KEYS = {
  ios: import.meta.env.VITE_REVENUECAT_IOS_KEY as string | undefined,
  android: import.meta.env.VITE_REVENUECAT_ANDROID_KEY as string | undefined,
  web: import.meta.env.VITE_REVENUECAT_WEB_KEY as string | undefined,
};

const WEB_USER_KEY = "tetrilaunch.rc.web-user";

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
let webPurchases: WebPurchases | null = null;

function sdk(): ReturnType<typeof loadSdk> {
  return (sdkPromise ??= loadSdk());
}

function setUnlimited(next: boolean): void {
  if (next === unlimited) return;
  unlimited = next;
  for (const l of listeners) l(next);
}

function readUnlimited(info: NativeCustomerInfo | WebCustomerInfo): boolean {
  return info.entitlements.active[UNLIMITED_ENTITLEMENT] !== undefined;
}

/**
 * RevenueCatUI 5.x compiled by Xcode 26 is not back-deployable when it is
 * statically linked by Capacitor's SPM package. Weak-linking SwiftUICore lets
 * iOS 15-17 launch, but entering a V2 paywall still dereferences unavailable
 * SwiftUI type metadata (RevenueCat purchases-ios#7567).
 *
 * Fail closed when the OS cannot be read: calling the core Purchases API is
 * safe on these releases, while guessing wrong here terminates the process.
 */
async function canPresentNativeRevenueCatPaywall(): Promise<boolean> {
  const { Capacitor } = await sdk();
  if (Capacitor.getPlatform() !== "ios") return true;

  try {
    const { Device } = await import("@capacitor/device");
    const { osVersion } = await Device.getInfo();
    const major = Number.parseInt(osVersion, 10);
    return Number.isFinite(major) && major >= 18;
  } catch (err) {
    console.warn("[purchases] could not determine iOS version; using safe purchase fallback", err);
    return false;
  }
}

/**
 * Purchase the configured lifetime package without loading RevenueCatUI.
 *
 * NO CONFIRMATION OF OUR OWN, and that is a decision, not an omission:
 * purchasePackage immediately presents Apple's payment sheet, which shows the
 * localized price and demands Face ID/passcode — the real, binding
 * confirmation. A browser-drawn confirm in front of it would be a second ask
 * from outside the game (the exact dialog account deletion just got rid of),
 * showing a price string one step removed from the one Apple will actually
 * charge. The sim pins that absence.
 */
async function purchaseLifetimeFallback(): Promise<void> {
  const { Purchases } = await sdk();
  const offering = (await Purchases.getOfferings()).current;
  const lifetime = offering?.lifetime;
  if (!lifetime) throw new Error("current RevenueCat offering has no lifetime package");

  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: lifetime });
    setUnlimited(readUnlimited(customerInfo));
  } catch (err) {
    // Walking away from the sheet is the sheet working — same rule the web
    // paywall applies to UserCancelledError.
    if ((err as { userCancelled?: boolean } | null)?.userCancelled) return;
    throw err;
  }
}

/** True once the SDK for this platform has configured successfully. */
export function purchasesReady(): boolean {
  return ready;
}

export function isUnlimited(): boolean {
  return unlimited;
}

/** Subscribe to entitlement changes (purchase, restore, refund/revocation, or
 *  a purchase made on another device). Returns an unsubscribe. */
export function onUnlimitedChange(fn: UnlimitedListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Configure the SDK. Safe to call unconditionally and safe to call twice.
 * Deliberately swallows failures: a store outage must never block the game.
 */
export async function initPurchases(appUserId?: string): Promise<void> {
  if (!isNative) {
    try {
      if (ready) return;
      if (!KEYS.web) {
        console.warn("[purchases] no RevenueCat web key configured — store disabled");
        return;
      }
      const { Purchases, LogLevel } = await import("@revenuecat/purchases-js");
      // Prefer a pre-login anonymous id long enough to alias its purchases to
      // the signed-in identity (auth.ts's provider:sub). Configuring directly
      // as that identity first would strand anything bought before sign-in on
      // the old customer.
      const anonymousUserId = localStorage.getItem(WEB_USER_KEY);
      let revenueCatUserId = anonymousUserId ?? appUserId;
      if (!revenueCatUserId) {
        revenueCatUserId = Purchases.generateRevenueCatAnonymousAppUserId();
        localStorage.setItem(WEB_USER_KEY, revenueCatUserId);
      }
      if (import.meta.env.DEV) Purchases.setLogLevel(LogLevel.Debug);
      webPurchases = Purchases.configure({ apiKey: KEYS.web, appUserId: revenueCatUserId });
      const info = await webPurchases.getCustomerInfo();
      ready = true;
      setUnlimited(readUnlimited(info));
      if (appUserId && revenueCatUserId !== appUserId) await identifyPurchasesUser(appUserId);
    } catch (err) {
      console.warn("[purchases] web configure failed", err);
    }
    return;
  }
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
    // Purchases, restores, refunds/revocations and changes made on another
    // device arrive on this listener, so nothing polls.
    await Purchases.addCustomerInfoUpdateListener((info) => setUnlimited(readUnlimited(info)));
    const { customerInfo } = await Purchases.getCustomerInfo();
    setUnlimited(readUnlimited(customerInfo));
    if (appUserId) await identifyPurchasesUser(appUserId);
    // Warm the offerings cache now, in the quiet after configure, instead of
    // paying the network round-trip at the moment of the buy tap. The first
    // device purchase (TestFlight 1.0.2 (11)) sat long enough between tap and
    // payment sheet that the tester pressed "a million times" — that wait was
    // getOfferings going to the network inside purchaseLifetimeFallback. The
    // SDK caches the result, so the tap-time call becomes a cache read.
    // Fire-and-forget: a prefetch that fails has cost nothing, the tap-time
    // call still fetches for itself.
    void Purchases.getOfferings().catch(() => {});
  } catch (err) {
    console.warn("[purchases] configure failed", err);
  }
}

/** Attach the current anonymous purchase history to a durable account ID. */
export async function identifyPurchasesUser(appUserId: string): Promise<boolean> {
  if (!ready) return unlimited;
  try {
    if (isNative) {
      const { Purchases } = await sdk();
      const { customerInfo } = await Purchases.logIn({ appUserID: appUserId });
      setUnlimited(readUnlimited(customerInfo));
    } else if (webPurchases) {
      const info = webPurchases.isAnonymous()
        ? (await webPurchases.identifyUser(appUserId)).customerInfo
        : await webPurchases.changeUser(appUserId);
      localStorage.removeItem(WEB_USER_KEY);
      setUnlimited(readUnlimited(info));
    }
  } catch (err) {
    console.warn("[purchases] identify failed", err);
  }
  return unlimited;
}

/** Leave an identified customer without carrying their entitlement to a guest. */
export async function resetPurchasesUser(): Promise<void> {
  if (!ready) return;
  try {
    if (isNative) {
      const { Purchases } = await sdk();
      const { customerInfo } = await Purchases.logOut();
      setUnlimited(readUnlimited(customerInfo));
    } else if (webPurchases) {
      const { Purchases } = await import("@revenuecat/purchases-js");
      const anonymous = Purchases.generateRevenueCatAnonymousAppUserId();
      localStorage.setItem(WEB_USER_KEY, anonymous);
      setUnlimited(readUnlimited(await webPurchases.changeUser(anonymous)));
    }
  } catch (err) {
    console.warn("[purchases] sign-out failed", err);
  }
}

/**
 * True from a buy tap until its flow fully resolves. One flag guards every
 * purchase entry point because they all funnel through presentPaywall.
 *
 * The device wrote this requirement: on a slow connection the gap between the
 * first tap and Apple's payment sheet ran long enough that the tester kept
 * tapping, and every tap queued another purchasePackage — the sheets then
 * arrived one after another, each a real purchase request. The sheet's own
 * modality only protects the window AFTER it is up; this flag owns the window
 * before it.
 */
let paywallInFlight = false;

/**
 * Show the paywall built in the RevenueCat dashboard — offerings, pricing and
 * copy are all remote-configured, so changing the offer needs no app update.
 * Resolves to the entitlement state afterwards.
 *
 * Re-entry resolves immediately with the current state: a second tap while a
 * flow is pending is the same tap, not a second intent.
 */
export async function presentPaywall(): Promise<boolean> {
  if (paywallInFlight) return unlimited;
  paywallInFlight = true;
  try {
    return await presentPaywallOnce();
  } finally {
    paywallInFlight = false;
  }
}

async function presentPaywallOnce(): Promise<boolean> {
  if (!isNative) {
    try {
      if (!ready || !webPurchases) return unlimited;
      // Without onBack the overlay is a one-way door: the SDK only wires a
      // back/close affordance when the callback exists, so a player who
      // opened the paywall by mistake was stuck on it (observed on staging).
      const result = await webPurchases.presentPaywall({
        onBack: (closePaywall) => closePaywall(),
      });
      setUnlimited(readUnlimited(result.customerInfo));
    } catch (err) {
      // Walking away is the paywall working, not the paywall failing.
      const { PurchasesError, ErrorCode } = await import("@revenuecat/purchases-js");
      if (err instanceof PurchasesError && err.errorCode === ErrorCode.UserCancelledError) {
        return unlimited;
      }
      console.warn("[purchases] web paywall failed", err);
    }
    return unlimited;
  }
  try {
    const { RevenueCatUI, PAYWALL_RESULT } = await sdk();
    if (!ready) return unlimited;
    if (!(await canPresentNativeRevenueCatPaywall())) {
      await purchaseLifetimeFallback();
      return unlimited;
    }
    // Ignored by V2 dashboard paywalls (their close button is an editor
    // component); kept so an original-template fallback still gets one.
    const { result } = await RevenueCatUI.presentPaywall({ displayCloseButton: true });
    if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
      await refresh();
    }
  } catch (err) {
    console.warn("[purchases] paywall failed", err);
  }
  return unlimited;
}

/** Restore on a reinstall or a new device. Apple requires this to be reachable
 *  without a purchase, hence its own button in Settings. */
export async function restorePurchases(): Promise<boolean> {
  // Shares the purchase flow's guard: a restore launched while a payment
  // sheet is pending (or vice versa) hands StoreKit two overlapping
  // transactions, and repeated taps on a slow connection queue restores the
  // same way they queued purchases.
  if (paywallInFlight) return unlimited;
  paywallInFlight = true;
  try {
    if (!isNative) {
      // Web purchases are tied to the persisted RevenueCat app-user id. There
      // is no browser store receipt to restore; re-fetching is the web
      // equivalent.
      await refresh();
      return unlimited;
    }
    const { Purchases } = await sdk();
    if (!ready) return unlimited;
    const { customerInfo } = await Purchases.restorePurchases();
    setUnlimited(readUnlimited(customerInfo));
  } catch (err) {
    console.warn("[purchases] restore failed", err);
  } finally {
    paywallInFlight = false;
  }
  return unlimited;
}

async function refresh(): Promise<void> {
  if (!isNative) {
    if (!webPurchases) return;
    setUnlimited(readUnlimited(await webPurchases.getCustomerInfo()));
    return;
  }
  const { Purchases } = await sdk();
  const { customerInfo } = await Purchases.getCustomerInfo();
  setUnlimited(readUnlimited(customerInfo));
}

/**
 * DIAGNOSTICS ONLY — present RevenueCatUI directly, bypassing the iOS<18 gate.
 *
 * Exists to answer one question from a phone with no debugger attached: did
 * renaming the Xcode target (the purchases-ios#7567 mis-link fix) also cure
 * the V2 paywall's null-metadata crash on iOS 16/17? The production path
 * cannot ask it — the gate routes those systems to the fallback before
 * RevenueCatUI loads — and flipping the gate to find out would put a
 * may-crash tap on the buy button of every old-iOS player. So the question
 * gets its own door, reachable only from the knock-to-open diagnostics panel,
 * where crashing IS the experiment's answer and only the tester can trigger
 * it. If this renders on an iPhone X, the gate can be retired for real.
 *
 * Returns a sentence for the panel rather than throwing: the interesting
 * failure mode (a native crash) never returns at all, so anything that DOES
 * come back deserves to be legible.
 */
export async function probeNativeRevenueCatPaywall(): Promise<string> {
  if (!isNative) return "web platform — the iOS gate does not apply here";
  if (paywallInFlight) return "a purchase flow is already in flight";
  paywallInFlight = true;
  try {
    const { RevenueCatUI } = await sdk();
    if (!ready) return "purchases SDK not configured";
    const { result } = await RevenueCatUI.presentPaywall({ displayCloseButton: true });
    await refresh();
    return `RevenueCatUI rendered and returned "${result}" — the gate can come down`;
  } catch (err) {
    return `RevenueCatUI threw without crashing: ${String(err)}`;
  } finally {
    paywallInFlight = false;
  }
}
