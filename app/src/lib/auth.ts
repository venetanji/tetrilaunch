// Player identity via native/web social login (@capgo/capacitor-social-login).
//
// There is no server session and no account database anywhere: "signed in"
// means this device remembers WHO the player is — `${provider}:${sub}` — so
// RevenueCat can key purchases to a durable identity instead of a per-install
// anonymous id. The only server that ever sees a credential is the Worker's
// DELETE /api/account, which verifies a raw provider ID token and deletes the
// RevenueCat customer (docs/AUTH.md).
import { Capacitor } from "@capacitor/core";
import { apiBase } from "./api";

export type AuthProvider = "google" | "apple";

/** The whole identity: which provider vouched for the player, the provider's
 *  stable subject id, and a display label. Nothing else is kept — no tokens
 *  (they expire in ~an hour and are re-earned by logging in again), no email
 *  beyond what the label happens to be. */
export interface AuthUser {
  provider: AuthProvider;
  sub: string;
  label: string;
}

export interface AuthState {
  /** At least one provider can actually complete a login on this platform. */
  available: boolean;
  ready: boolean;
  /** Per-provider offerability, so the account screen renders only buttons
   *  that can work here rather than one that fails on tap. */
  providers: Record<AuthProvider, boolean>;
  user: AuthUser | null;
}

const GOOGLE_WEB_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined;
const GOOGLE_IOS_ID = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined;
const APPLE_WEB_ID = import.meta.env.VITE_APPLE_WEB_CLIENT_ID as string | undefined;

/** Versioned so a future shape change can migrate rather than misread. */
const STORAGE_KEY = "tetrilaunch.auth";
const STORAGE_VERSION = 1;

/**
 * Which providers can complete a login HERE. Google needs its WEB client id on
 * web and Android (the Android Credential Manager flow verifies against the
 * web client), and its IOS client id on iOS. Apple needs the Services ID on
 * web; native iOS Sign in with Apple runs against the app's own bundle id and
 * needs no client id at all. Android has no Apple path — the plugin's Android
 * Apple flow needs a redirect backend this app deliberately does not run.
 */
function offerable(): Record<AuthProvider, boolean> {
  const platform = Capacitor.getPlatform();
  return {
    google: Boolean(platform === "ios" ? GOOGLE_IOS_ID : GOOGLE_WEB_ID),
    apple: platform === "ios" ? true : platform === "web" && Boolean(APPLE_WEB_ID),
  };
}

let state: AuthState = {
  available: false,
  ready: false,
  providers: { google: false, apple: false },
  user: null,
};
const listeners = new Set<(state: AuthState) => void>();
let initPromise: Promise<void> | null = null;

function publish(next: Partial<AuthState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function authState(): AuthState { return state; }

export function onAuthChange(listener: (state: AuthState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The RevenueCat App User ID for a signed-in player. The template is the
 *  identity contract with the Worker: it namespaces Google's numeric subs
 *  apart from Apple's opaque ones, so the two can never collide. */
export function appUserIdFor(user: AuthUser): string {
  return `${user.provider}:${user.sub}`;
}

export function appUserId(): string | null {
  return state.user ? appUserIdFor(state.user) : null;
}

function persist(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, ...user }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage denied — the sign-in still holds for this session */
  }
}

function restore(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; provider?: string; sub?: string; label?: string };
    if (parsed.v !== STORAGE_VERSION) return null;
    if (parsed.provider !== "google" && parsed.provider !== "apple") return null;
    if (typeof parsed.sub !== "string" || !parsed.sub) return null;
    return { provider: parsed.provider, sub: parsed.sub, label: parsed.label || "Player account" };
  } catch {
    return null;
  }
}

async function plugin() {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  return SocialLogin;
}

/**
 * DECODED, NOT VERIFIED — and that is correct here, not a shortcut. The
 * payload only picks which RevenueCat customer this device talks about;
 * anyone able to tamper with it already owns the device and could call
 * RevenueCat with any id directly. Verification is theater without a secret
 * to protect, so it lives where the secret does: the Worker verifies
 * signature, issuer and audience before the one privileged action (deletion).
 */
function idTokenPayload(idToken: string): Record<string, unknown> {
  const part = idToken.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64)) as Record<string, unknown>;
}

function claimString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Run the provider's login and reduce the result to (sub, label, raw token).
 * The label prefers a human name, then the email, then a generic — screens.ts
 * escapes it before it enters HTML, so it may contain anything the provider
 * sent.
 */
async function providerLogin(
  provider: AuthProvider,
): Promise<{ sub: string; label: string; idToken: string }> {
  const social = await plugin();
  let idToken: string | null = null;
  let name: string | null = null;
  let email: string | null = null;
  if (provider === "google") {
    const { result } = await social.login({ provider: "google", options: { scopes: ["profile", "email"] } });
    if (result.responseType === "online") {
      idToken = result.idToken;
      name = result.profile.name;
      email = result.profile.email;
    }
  } else {
    const { result } = await social.login({ provider: "apple", options: { scopes: ["name", "email"] } });
    idToken = result.idToken;
    // Apple sends the name ONCE, on the first authorization, and never again —
    // so it feeds the label now and is persisted, never re-derivable.
    const parts = [result.profile.givenName, result.profile.familyName].filter(Boolean);
    name = parts.length ? parts.join(" ") : null;
    email = result.profile.email;
  }
  if (!idToken) throw new Error("Sign-in returned no identity token");
  const payload = idTokenPayload(idToken);
  const sub = claimString(payload, "sub");
  if (!sub) throw new Error("Identity token carries no subject");
  const label = name ?? claimString(payload, "name")
    ?? email ?? claimString(payload, "email") ?? "Player account";
  return { sub, label, idToken };
}

/**
 * Restore the persisted identity and initialize the plugin with whichever
 * provider configs exist. Never throws: a missing config or a failed plugin
 * initialize degrades to "sign-in unavailable", and a previously signed-in
 * player keeps their identity (it is a local fact, not a session).
 */
export async function initAuth(): Promise<AuthState> {
  if (initPromise) {
    try { await initPromise; } catch { /* already surfaced by the first call */ }
    return state;
  }
  const providers = offerable();
  const platform = Capacitor.getPlatform();
  initPromise = (async () => {
    if (!providers.google && !providers.apple) return;
    const social = await plugin();
    await social.initialize({
      ...(providers.google && {
        google: platform === "ios"
          ? { iOSClientId: GOOGLE_IOS_ID }
          : { webClientId: GOOGLE_WEB_ID },
      }),
      // Web needs the Services ID; native iOS Sign in with Apple is keyed to
      // the app's own bundle id, so an empty object is the whole config.
      ...(providers.apple && {
        apple: platform === "ios" ? {} : { clientId: APPLE_WEB_ID },
      }),
    });
  })();
  let available = providers.google || providers.apple;
  try { await initPromise; }
  catch (err) {
    console.warn("[auth] initialize failed", err);
    available = false;
    providers.google = providers.apple = false;
  }
  publish({ available, providers, ready: true, user: restore() });
  return state;
}

export async function signIn(provider: AuthProvider): Promise<void> {
  if (!state.providers[provider]) throw new Error("Sign-in is not configured");
  await initPromise;
  const { sub, label } = await providerLogin(provider);
  const user: AuthUser = { provider, sub, label };
  persist(user);
  publish({ user });
}

export async function signOut(): Promise<void> {
  const provider = state.user?.provider;
  if (provider) {
    // Best-effort: web Apple has no logout at all, and a failed provider
    // logout must not leave the local identity stuck.
    try { await (await plugin()).logout({ provider }); }
    catch { /* provider session state is theirs to keep */ }
  }
  persist(null);
  publish({ user: null });
}

export async function deleteAccount(): Promise<void> {
  const user = state.user;
  if (!user) throw new Error("No signed-in account");
  // A FRESH token, by re-running the provider login now: ID tokens live about
  // an hour, and the Worker rejects an expired one — a token captured at
  // sign-in would make deletion fail for everyone but the just-signed-in.
  const { idToken } = await providerLogin(user.provider);
  // Same apiBase the leaderboard client uses: a relative /api/account would
  // resolve against capacitor://localhost inside the native shells, where no
  // Worker answers — and in-app deletion is exactly the path Apple reviews.
  const response = await fetch(`${apiBase()}/api/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) throw new Error("Account deletion failed");
  await signOut();
}

export function accountLabel(user: AuthUser): string {
  return user.label || "Player account";
}
