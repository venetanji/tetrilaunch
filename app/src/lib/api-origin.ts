const PRODUCTION_API = "https://tetrilaunch.com";

/** Only installed shells have no same-origin Worker. Their production default
 * preserves shipped store behavior; test builds can select staging explicitly.
 * Ordinary web hosts (including localhost and Pages previews) stay local. */
export function resolveApiBase(protocol: string, native: boolean, configured?: string): string {
  if (configured?.trim()) {
    const url = new URL(configured.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("VITE_API_BASE must be an HTTP(S) origin without credentials, path, query or fragment");
    }
    return url.origin;
  }
  return native || protocol === "app:" ? PRODUCTION_API : "";
}
