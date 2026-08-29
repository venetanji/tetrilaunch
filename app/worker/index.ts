/// <reference types="@cloudflare/workers-types" />

// Cloudflare Worker: serves the built Vite app (via the ASSETS binding) and a
// small D1-backed leaderboard API — the all-time boards under /api/scores and
// the Skydeck's per-day board under /api/daily (see DAY_MIN below).

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

/** The board key's second part (lib/api.ts's BoardDay): 0 on every all-time
 *  board, a YYYYMMDD UTC day on the Skydeck's. Not returned in a row — a row
 *  only ever appears inside the board it was asked for. */
type BoardDay = number;

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
/** The Skydeck's board (lib/api.ts's BOARD_SKYDECK), one below Tier S and for
 *  the same reason: the roof is not a rung either. It is reachable ONLY on
 *  /api/daily — /api/scores keeps the domain it shipped with, so nothing this
 *  build adds can widen an existing board's key by one clamp. */
const MARK_SKYDECK = -2;
/** Day bounds for /api/daily. The floor rejecting 0 is half of the invariant
 *  ALL_TIME below is the other half of: a daily row always has `day > 0` and an
 *  all-time row always has `day = 0`, so the two routes partition the table
 *  rather than agreeing to. It also rejects anything that is not a plausible
 *  YYYYMMDD; the ceiling bounds the column. Deliberately NOT a freshness window
 *  against the Worker's own clock: a run undocks before it lands, a paused tab
 *  can land a day late, and the endpoint has no authentication at all — so a
 *  window would cost honest slow players their score while buying nothing an
 *  attacker could not simply route around. */
const DAY_MIN = 20_000_101;
const DAY_MAX = 20_991_231;

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
 * AN ALL-TIME BOARD IS `day = 0`. One predicate, on every query this route
 * serves, and it is what makes the two routes actually separate rather than
 * separate by convention.
 *
 * Without it the daily rows leak upward in two ways, and the second is the one
 * that is easy to miss (codex review, PR #166):
 *
 *  - The COMBINED board (`mark === null`) is unpartitioned by definition, so it
 *    ranked every Skydeck row ever posted against the all-time list a client
 *    older than tier boards sees. That client cannot ask for a Tier, so it had
 *    no way not to see them.
 *  - A per-Tier board is only safe as long as no daily row can carry a Tier's
 *    mark — and /api/daily's clamp accepts the whole Mark range, so one could.
 *    Nothing the shipped client does writes such a row, but "the client does
 *    not do that" is not a schema guarantee, and the query is one word from
 *    being one.
 *
 * Rows written before the day column existed default to 0
 * (migrations/0003_daily_boards.sql), so every score that was on an all-time
 * board stays exactly where it was and in the same order.
 */
const ALL_TIME = "day = 0";

/**
 * The top `limit` scores, for one Tier or across all of them — all time.
 *
 * `mark === null` is the COMBINED board, and it is not a debug affordance: it
 * is what a client that predates tier boards gets when it asks with no mark,
 * so a shipped store build keeps seeing one ranked list containing its own
 * submissions instead of an empty one. New clients always name a Tier.
 */
async function getTop(env: Env, mark: number | null, limit: number): Promise<ScoreRow[]> {
  const sql = `SELECT name, score, mark, level, lines, created_at
       FROM scores WHERE ${ALL_TIME}${mark === null ? "" : " AND mark = ?"}
       ORDER BY score DESC, created_at ASC
       LIMIT ?`;
  const stmt = env.DB.prepare(sql);
  const { results } = await (mark === null ? stmt.bind(limit) : stmt.bind(mark, limit))
    .all<ScoreRow>();
  return results ?? [];
}

/**
 * The top `limit` scores on ONE day of one board.
 *
 * Both halves of the key are bound, and neither is optional: there is no
 * "combined" daily board to fall back to. A day that has seen no submissions
 * answers with an empty list, which is what a board nobody has flown yet is.
 */
async function getTopDaily(
  env: Env,
  mark: number,
  day: BoardDay,
  limit: number,
): Promise<ScoreRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT name, score, mark, level, lines, created_at
       FROM scores WHERE mark = ? AND day = ?
       ORDER BY score DESC, created_at ASC
       LIMIT ?`,
  )
    .bind(mark, day, limit)
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
    // `day` is NOT named here, so it takes the column default of 0 — which is
    // what makes this row an all-time row (see ALL_TIME). Naming it would let a
    // future edit write a day onto a board that has none.
    const insert = await env.DB.prepare(
      `INSERT INTO scores (name, score, mark, level, lines, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(name, score, mark, level, lines, created)
      .run();

    // Rank WITHIN the Tier just played — the only board this score is on.
    // Strictly-greater is competition ranking: a tie shares the rank, and the
    // row just inserted does not count itself. ALL_TIME for the same reason the
    // list above carries it: a rank is a position ON a board, so it has to
    // count exactly the rows that board shows.
    const rankRow = await env.DB.prepare(
      `SELECT COUNT(*) AS higher FROM scores WHERE ${ALL_TIME} AND mark = ? AND score > ?`,
    )
      .bind(mark, score)
      .first<{ higher: number }>();

    const rank = (rankRow?.higher ?? 0) + 1;
    const scores = await getTop(env, mark, 10);
    return json({ ok: true, id: insert.meta.last_row_id, rank, name, score, mark, scores }, 201);
  }

  // ---- The daily boards. -------------------------------------------------
  //
  // A SEPARATE ROUTE rather than a `day` parameter on /api/scores, and the
  // reason is compatibility in the other direction: a client older than this
  // deploy must keep getting exactly the boards it asks for, and a NEWER client
  // talking to an older Worker must fail visibly rather than have its board id
  // clamped onto a board that exists. lib/api.ts's boardPath states the whole
  // argument. The consequence here is the property worth keeping: nothing above
  // this line changed, so no all-time board can move.
  if (url.pathname === "/api/daily" && request.method === "GET") {
    const mark = clampInt(url.searchParams.get("mark"), MARK_SKYDECK, MARK_SKYDECK, MARK_MAX);
    const day = clampInt(url.searchParams.get("day"), 0, 0, DAY_MAX);
    const limit = clampInt(url.searchParams.get("limit"), 10, 1, 50);
    if (day < DAY_MIN) return json({ error: "invalid_day" }, 400);
    return json({ scores: await getTopDaily(env, mark, day, limit) });
  }

  if (url.pathname === "/api/daily" && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const name = sanitizeName(body.name);
    const score = clampInt(body.score, -1, 0, 100_000_000);
    // No 0 default for the board here, unlike /api/scores: nothing predates
    // this route, so there is no old client to keep working and "untiered" has
    // no meaning on a board that is keyed by a day.
    const mark = clampInt(body.mark, MARK_SKYDECK, MARK_SKYDECK, MARK_MAX);
    const day = clampInt(body.day, 0, 0, DAY_MAX);
    const level = clampInt(body.level, 1, 1, 999);
    const lines = clampInt(body.lines, 0, 0, 100_000);
    if (score < 0) return json({ error: "invalid_score" }, 400);
    if (day < DAY_MIN) return json({ error: "invalid_day" }, 400);

    const created = Date.now();
    const insert = await env.DB.prepare(
      `INSERT INTO scores (name, score, mark, level, lines, created_at, day)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(name, score, mark, level, lines, created, day)
      .run();

    // Rank within THE DAY, not within the board — the day is half the key, and
    // ranking a Tuesday score against every Monday that came before it is the
    // "mixed all-time board ranks days rather than players" reading the daily
    // exists to avoid (docs/DESIGN.md).
    const rankRow = await env.DB.prepare(
      `SELECT COUNT(*) AS higher FROM scores WHERE mark = ? AND day = ? AND score > ?`,
    )
      .bind(mark, day, score)
      .first<{ higher: number }>();

    const rank = (rankRow?.higher ?? 0) + 1;
    const scores = await getTopDaily(env, mark, day, 10);
    return json(
      { ok: true, id: insert.meta.last_row_id, rank, name, score, mark, day, scores },
      201,
    );
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
