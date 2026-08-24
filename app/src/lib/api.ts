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
 * A board is identified by a MARK, and the wire field is `mark`
 * (migrations/0002_tier_boards.sql). Three branches wanted this key at once
 * and each picked the `level` column, which is why it is worth writing down
 * what it ended up being:
 *
 *   #88 keyed boards on the TIER, through `level`. Right idea — a Tier 10 run
 *   banks more lines against a heavier target than a Tier 1 run ever can
 *   (level.ts's targetScoreFor), and finalRunScore counts lines, so one shared
 *   list ranks the ladder rather than the play.
 *
 *   #90 keyed boards on the MODE, also through `level`: 1 for Deep Run, 2 for
 *   Tier S. Also right — a sandbox run flies a Mark it never earned, on a rig
 *   it never bought, from a bay it never reached, and one of those next to
 *   honest scores ends the board.
 *
 *   Together, through one column, they collide: #88's Tier 2 board and #90's
 *   Tier S board are both `level = 2`, so sandbox scores would have landed on
 *   the Tier 2 leaderboard. Neither branch is wrong; the column is.
 *
 * So the key is its own column, and its domain says what a board is:
 *
 *   1..MARK_COUNT   the Deep Run board for that Tier
 *   BOARD_SANDBOX   Tier S — negative, because it is not a rung. #90's tower
 *                   already draws it under the base slab with a negative id
 *                   for exactly this reason; this is the same statement, on
 *                   the wire.
 *   0               untiered. Where a client older than tier boards lands,
 *                   since it sends no `mark` at all — it keeps working and
 *                   its scores stay out of every real board.
 *
 * `level` goes back to meaning the bay a run reached, which is what it is
 * named after and what it has never once been used for.
 */
export type BoardId = number;
/** Tier S. Anything goes, so it is scored apart from anything that doesn't. */
export const BOARD_SANDBOX: BoardId = -1;
/** Is `b` a real rung of the ladder, rather than Tier S or an untiered row? */
export function isLadderBoard(b: BoardId): boolean {
  return b >= 1;
}

export interface ScoreEntry {
  name: string;
  score: number;
  /** The board this entry is filed under (a BoardId). */
  mark: number;
  /** The bay the run ended on. Display only — never the board's key. */
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

export async function fetchLeaderboard(board: BoardId, limit = 10): Promise<ScoreEntry[]> {
  try {
    const res = await fetch(`${apiBase()}/api/scores?mark=${board}&limit=${limit}`);
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
  /** The bay the run ended on. */
  level: number,
  lines: number,
): Promise<SubmitResult | null> {
  try {
    const res = await fetch(`${apiBase()}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score, mark: board, level, lines }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmitResult;
  } catch {
    return null;
  }
}
