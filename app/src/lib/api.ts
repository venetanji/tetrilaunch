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

/**
 * WHICH BOARD a score is filed under.
 *
 * The D1 rows have carried a `level` column since the first migration, indexed
 * with the score (`idx_scores_level_score`) and filtered on by every read — it
 * has simply always been written as 1, because there was only ever one board.
 * That column IS the board discriminator, so a second board needs no schema
 * change and no second table: it needs an id nothing else uses.
 *
 * Named constants rather than the bare numbers at the call sites, because the
 * one thing that must never happen is a sandbox run landing on the Deep Run
 * board — a practice run flies a Mark it never earned, with a rig it never
 * bought, from a bay it never reached, and a single `1` typed where a `2`
 * belonged would put that score next to honest ones with nothing to mark it.
 */
export type BoardId = number;
/** The real thing: a Deep Run flown from bay 1 on the player's own rig. */
export const BOARD_DEEP_RUN: BoardId = 1;
/** Tier S. Anything goes, so it is scored apart from anything that doesn't. */
export const BOARD_SANDBOX: BoardId = 2;

export interface ScoreEntry {
  name: string;
  score: number;
  /** The board the entry is filed under (a BoardId) — the wire name is `level`
   *  because that is the D1 column, and renaming it would orphan every row
   *  already on the board. */
  level: number;
  lines: number;
  created_at: number;
}

export interface SubmitResult {
  ok: boolean;
  rank: number;
  scores: ScoreEntry[];
}

export async function fetchLeaderboard(board: BoardId = BOARD_DEEP_RUN, limit = 10): Promise<ScoreEntry[]> {
  try {
    const res = await fetch(`${apiBase()}/api/scores?level=${board}&limit=${limit}`);
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
  board: BoardId,
  lines: number,
): Promise<SubmitResult | null> {
  try {
    const res = await fetch(`${apiBase()}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score, level: board, lines }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmitResult;
  } catch {
    return null;
  }
}
