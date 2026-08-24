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
  level: number;
  lines: number;
  created_at: number;
  board: string;
}

/**
 * BOARD KEYS — see migrations/0002_boards.sql.
 *
 * `run` (the legacy board every pre-boards score is filed under), `tier:N`,
 * `god:YYYYMMDD`. Validated as a SHAPE rather than against a list of known
 * boards, deliberately: the client owns which boards exist (a new Tier, a new
 * day, a future contract board), and a Worker that had to be redeployed before
 * a new board could be posted to would make every client change a two-part
 * release. What the Worker owns is that the key cannot be used to write
 * anything a board key shouldn't be — hence the tight character class and the
 * length cap, both enforced on read AND write so a malformed key can't be
 * stored and then never be findable.
 */
const BOARD_RE = /^[a-z]+(:[a-z0-9-]{1,24})?$/;
const DEFAULT_BOARD = "run";

function sanitizeBoard(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase().slice(0, 32);
  return BOARD_RE.test(s) ? s : DEFAULT_BOARD;
}

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

async function getTop(env: Env, board: string, limit: number): Promise<ScoreRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT name, score, level, lines, created_at, board
       FROM scores WHERE board = ?
       ORDER BY score DESC, created_at ASC
       LIMIT ?`,
  )
    .bind(board, limit)
    .all<ScoreRow>();
  return results ?? [];
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (url.pathname === "/api/scores" && request.method === "GET") {
    // `board` is the key; `level` is still read and still clamped, but only as
    // the FALLBACK for a client that predates boards — it maps onto the legacy
    // 'run' board, which is where every one of its own scores already is.
    const board = url.searchParams.has("board")
      ? sanitizeBoard(url.searchParams.get("board"))
      : DEFAULT_BOARD;
    const limit = clampInt(url.searchParams.get("limit"), 10, 1, 50);
    const scores = await getTop(env, board, limit);
    return json({ board, scores });
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
    // Kept as a column and still written: it is the bay/Tier the run reached,
    // which the row is worth carrying even now that ranking keys on `board`.
    const level = clampInt(body.level, 1, 1, 999);
    const lines = clampInt(body.lines, 0, 0, 100_000);
    const board = sanitizeBoard(body.board ?? DEFAULT_BOARD);
    if (score < 0) return json({ error: "invalid_score" }, 400);

    const created = Date.now();
    const insert = await env.DB.prepare(
      `INSERT INTO scores (name, score, level, lines, created_at, board) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(name, score, level, lines, created, board)
      .run();

    const rankRow = await env.DB.prepare(
      `SELECT COUNT(*) AS higher FROM scores WHERE board = ? AND score > ?`,
    )
      .bind(board, score)
      .first<{ higher: number }>();

    const rank = (rankRow?.higher ?? 0) + 1;
    const scores = await getTop(env, board, 10);
    return json({ ok: true, id: insert.meta.last_row_id, rank, name, score, board, scores }, 201);
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
