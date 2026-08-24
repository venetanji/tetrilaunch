/// <reference types="@cloudflare/workers-types" />

// Cloudflare Worker: serves the built Vite app (via the ASSETS binding) and a
// small D1-backed leaderboard API under /api/scores.

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

interface ScoreRow {
  name: string;
  score: number;
  /** Which board this row is on. 1..MARK_MAX is the Deep Run board for that
   *  Tier; BOARD_SANDBOX (-1) is Tier S, which is not a rung and must never
   *  share a list with one; 0 is "untiered", where a client that predates tier
   *  boards lands because it sends no mark at all. */
  mark: number;
  /** The bay the run ended on. Carried for display, NOT the board's key —
   *  it was hardcoded to 1 by every client until tier boards landed. */
  level: number;
  lines: number;
  created_at: number;
}

/** Tiers the ladder has (game/upgrades.ts's MARK_COUNT). Restated rather than
 *  imported: the Worker bundle has no business pulling in game code to learn
 *  one integer, and the only thing this number does here is bound a clamp, so
 *  a ladder that grows past it costs a rejected-into-range value, not a bug. */
const MARK_MAX = 10;
/** Tier S (lib/api.ts's BOARD_SANDBOX). Negative because it is not a rung —
 *  the same statement the home tower makes by drawing it under the base slab.
 *  It is the FLOOR of the clamp rather than a special case, so a sandbox score
 *  can never be rounded onto a real Tier's board. */
const MARK_MIN = -1;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function sanitizeName(raw: unknown): string {
  const s = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 12);
  return s.length ? s : "ACE";
}

/**
 * The top `limit` scores, for one Tier or across all of them.
 *
 * `mark === null` is the COMBINED board, and it is not a debug affordance: it
 * is what a client that predates tier boards gets when it asks with no mark,
 * so a shipped store build keeps seeing one ranked list containing its own
 * submissions instead of an empty one. New clients always name a Tier.
 */
async function getTop(env: Env, mark: number | null, limit: number): Promise<ScoreRow[]> {
  const sql = `SELECT name, score, mark, level, lines, created_at
       FROM scores${mark === null ? "" : " WHERE mark = ?"}
       ORDER BY score DESC, created_at ASC
       LIMIT ?`;
  const stmt = env.DB.prepare(sql);
  const { results } = await (mark === null ? stmt.bind(limit) : stmt.bind(mark, limit))
    .all<ScoreRow>();
  return results ?? [];
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (url.pathname === "/api/scores" && request.method === "GET") {
    // ABSENT, not "absent or unparseable": `?mark=` off the query string means
    // the caller wants the combined board, while `?mark=banana` is a caller
    // that meant a Tier and got it wrong, and quietly widening the second one
    // to every Tier would answer a different question than the one asked.
    const raw = url.searchParams.get("mark");
    const mark = raw === null ? null : clampInt(raw, 1, MARK_MIN, MARK_MAX);
    const limit = clampInt(url.searchParams.get("limit"), 10, 1, 50);
    const scores = await getTop(env, mark, limit);
    return json({ scores });
  }

  if (url.pathname === "/api/scores" && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const name = sanitizeName(body.name);
    const score = clampInt(body.score, -1, 0, 100_000_000);
    // 0 is the DEFAULT on purpose: a client that predates tier boards sends no
    // mark, and 0 is where it lands. Rejecting it would 400 every shipped
    // store build the moment this deploys. -1 is the floor, so Tier S has a
    // value of its own below every real Tier.
    const mark = clampInt(body.mark, 0, MARK_MIN, MARK_MAX);
    const level = clampInt(body.level, 1, 1, 999);
    const lines = clampInt(body.lines, 0, 0, 100_000);
    if (score < 0) return json({ error: "invalid_score" }, 400);

    const created = Date.now();
    const insert = await env.DB.prepare(
      `INSERT INTO scores (name, score, mark, level, lines, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(name, score, mark, level, lines, created)
      .run();

    // Rank WITHIN the Tier just played — the only board this score is on.
    // Strictly-greater is competition ranking: a tie shares the rank, and the
    // row just inserted does not count itself.
    const rankRow = await env.DB.prepare(
      `SELECT COUNT(*) AS higher FROM scores WHERE mark = ? AND score > ?`,
    )
      .bind(mark, score)
      .first<{ higher: number }>();

    const rank = (rankRow?.higher ?? 0) + 1;
    const scores = await getTop(env, mark, 10);
    return json({ ok: true, id: insert.meta.last_row_id, rank, name, score, mark, scores }, 201);
  }

  return json({ error: "not_found" }, 404);
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
