import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import { isNative } from "./platform";

export type AuthProvider = "google" | "apple";
export interface AuthState {
  available: boolean;
  ready: boolean;
  user: User | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const NATIVE_CALLBACK = "com.tetrilaunch.app://auth/callback";

let client: SupabaseClient | null = null;
let state: AuthState = { available: Boolean(SUPABASE_URL && SUPABASE_KEY), ready: false, user: null };
const listeners = new Set<(state: AuthState) => void>();

function publish(session: Session | null): void {
  state = { ...state, ready: true, user: session?.user ?? null };
  for (const listener of listeners) listener(state);
}

export function authState(): AuthState { return state; }

export function onAuthChange(listener: (state: AuthState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function initAuth(): Promise<AuthState> {
  if (!state.available) {
    state = { ...state, ready: true };
    return state;
  }
  if (client) return state;

  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isNative },
  });
  client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => publish(session));

  if (isNative) {
    const [{ App }, { Browser }] = await Promise.all([
      import("@capacitor/app"), import("@capacitor/browser"),
    ]);
    await App.addListener("appUrlOpen", async ({ url }) => {
      if (!url.startsWith(NATIVE_CALLBACK) || !client) return;
      const code = new URL(url).searchParams.get("code");
      if (code) await client.auth.exchangeCodeForSession(code);
      await Browser.close();
    });
  }

  const { data } = await client.auth.getSession();
  publish(data.session);
  return state;
}

export async function signIn(provider: AuthProvider): Promise<void> {
  if (!client) throw new Error("Authentication is not configured");
  const redirectTo = isNative ? NATIVE_CALLBACK : `${location.origin}${location.pathname}`;
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: isNative },
  });
  if (error) throw error;
  if (isNative && data.url) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: data.url });
  }
}

export async function signOut(): Promise<void> {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function deleteAccount(): Promise<void> {
  if (!client) throw new Error("Authentication is not configured");
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("No signed-in account");
  const response = await fetch("/api/account", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  if (!response.ok) throw new Error("Account deletion failed");
  await client.auth.signOut({ scope: "local" });
}

export function accountLabel(user: User): string {
  const metadata = user.user_metadata as Record<string, unknown>;
  const name = metadata.full_name ?? metadata.name;
  return typeof name === "string" && name.trim() ? name : user.email ?? "Player account";
}
