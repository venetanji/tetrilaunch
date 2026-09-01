// RevenueCat integration for both Capacitor and the web/PWA. Callers never
// branch by platform; this module selects the matching SDK and exposes one
// entitlement-shaped interface.
//
// The SDK loads through the memoised `sdk()` below rather than a static import,
// so the ~25 kB of StoreKit/Billing wrapper sits in its own chunk that only the
// native shells ever fetch.
import type { CustomerInfo as NativeCustomerInfo } from "@revenuecat/purchases-capacitor";
import type { CustomerInfo as WebCustomerInfo, Purchases as WebPurchases } from "@revenuecat/purchases-js";
import { isDesktop, isNative } from "./platform";

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

/**
 * THE DESKTOP SHELL HAS NO STORE, AND MUST NOT GROW ONE BY ACCIDENT.
 *
 * Electron is neither Capacitor platform: `Capacitor.getPlatform()` answers
 * `"web"` inside the shell, so without a gate every `!isNative` branch below is
 * the branch the desktop build takes — which is RevenueCat's **web billing**
 * path, a checkout of our own, served inside a desktop app. On a Steam release
 * that is the shape of thing Valve's distribution agreement exists to prevent;
 * on the direct-download build it contradicts the carve-out that grants the
 * full game on desktop in the first place (`main.ts`'s `fullGame()`).
 *
 * It has never fired, but only because `VITE_REVENUECAT_WEB_KEY` happens to be
 * unset in the `--mode native` bundle the shell loads and the module then
 * disables itself with a warning. That is an accident of configuration, not a
 * guarantee: one env var added to `.github/workflows/desktop.yml` — or one
 * local `.env` — arms it, silently, with nothing failing.
 *
 * So the boundary is drawn here, in code, at the two doors:
 *
 *   - `initPurchases` returns before configuring anything. Nothing else needs
 *     its own gate as a consequence: `ready` stays false and `webPurchases`
 *     stays null, so `identifyPurchasesUser`, `resetPurchasesUser`,
 *     `restorePurchases` and `refresh` all take their existing
 *     nothing-configured exits. That is the module's normal degrade path, not
 *     a new one.
 *   - `presentPaywall` refuses, because it is the only door a caller can open
 *     without going through `ready` at all.
 *
 * These two strings are the gate's fingerprint in the EMITTED bundle, and
 * `scripts/verify-store-bundle.mjs --desktop` asserts both survive into
 * `dist/`. `isDesktop` is a runtime test (`location.protocol === "app:"`), not
 * an inlined build constant, so nothing folds these branches away — which is
 * exactly why the check can look for them and why a marker is the honest thing
 * to look for. An absence check could not work: `presentPaywall` is also a
 * string the RevenueCat Capacitor bridge emits, and that bridge legitimately
 * ships in the same bundle for the iOS and Android shells.
 */
const DESKTOP_NO_STORE = "[purchases] desktop shell — no store, purchases disabled";
const DESKTOP_NO_PAYWALL = "[purchases] desktop shell — paywall refused";

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
  // Ahead of both platform branches, because the desktop shell would take the
  // web one. See the DESKTOP_NO_STORE comment: this is the whole gate, and
  // everything downstream degrades through `ready === false` on its own.
  if (isDesktop) {
    console.warn(DESKTOP_NO_STORE);
    return;
  }
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
 * Show the paywall built in the RevenueCat dashboard — offerings, pricing and
 * copy are all remote-configured, so changing the offer needs no app update.
 * Resolves to the entitlement state afterwards.
 */
export async function presentPaywall(): Promise<boolean> {
  // The second door. Nothing routes here on desktop today — `fullGame()` is
  // already true there, so no tier gate ever asks — which is precisely why the
  // refusal is loud: if this warning is ever seen, the monetization boundary
  // has been crossed by a caller that thought it was on the web.
  if (isDesktop) {
    console.warn(DESKTOP_NO_PAYWALL);
    return unlimited;
  }
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
  if (!isNative) {
    // Web purchases are tied to the persisted RevenueCat app-user id. There is
    // no browser store receipt to restore; re-fetching is the web equivalent.
    await refresh();
    return unlimited;
  }
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
  if (!isNative) {
    if (!webPurchases) return;
    setUnlimited(readUnlimited(await webPurchases.getCustomerInfo()));
    return;
  }
  const { Purchases } = await sdk();
  const { customerInfo } = await Purchases.getCustomerInfo();
  setUnlimited(readUnlimited(customerInfo));
}
