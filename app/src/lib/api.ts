// Leaderboard client. Talks to the D1-backed Worker API.
// Same-origin when served by the Worker (tetrilaunch.com or the workers.dev
// fallback); absolute to the deployed Worker when running locally (vite dev),
// on a Cloudflare Pages preview (*.pages.dev branch deploys), or inside the
// Capacitor native shell. The Worker's /api responses are CORS-open
// (Access-Control-Allow-Origin: *), so the cross-origin cases need no proxy
// and share the production leaderboard.

const REMOTE = "https://tetrilaunch.com";

function apiBase(): string {
  const h = location.hostname;
  const servedByWorker =
    h === "tetrilaunch.com" || h === "www.tetrilaunch.com" || h.endsWith(".workers.dev");
  return servedByWorker ? "" : REMOTE;
}

export interface ScoreEntry {
  name: string;
  score: number;
  /** The Tier the run was flown at. 0 is "untiered" — a row banked by a client
   *  older than tier boards. Rows the app submits are always 1..MARK_COUNT. */
  mark: number;
  /** The bay the run ended on. Display only; the board's key is `mark`. */
  level: number;
  lines: number;
  created_at: number;
}

export interface SubmitResult {
  ok: boolean;
  rank: number;
  mark: number;
  scores: ScoreEntry[];
}

/**
 * One Tier's board, or the combined one.
 *
 * A Tier is the build budget a run was flown with, so scores are only
 * comparable inside one — which is why `mark` is required here rather than
 * defaulted. `null` asks for every Tier at once and exists for the legacy
 * shape, not as a default anything in the app should fall back to.
 */
export async function fetchLeaderboard(mark: number | null, limit = 10): Promise<ScoreEntry[]> {
  try {
    const q = mark === null ? "" : `mark=${mark}&`;
    const res = await fetch(`${apiBase()}/api/scores?${q}limit=${limit}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { scores: ScoreEntry[] };
    return data.scores ?? [];
  } catch {
    return [];
  }
}

export async function submitScore(
  name: string,
  score: number,
  mark: number,
  level: number,
  lines: number,
): Promise<SubmitResult | null> {
  try {
    const res = await fetch(`${apiBase()}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score, mark, level, lines }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmitResult;
  } catch {
    return null;
  }
}
