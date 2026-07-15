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

async function getTop(env: Env, level: number, limit: number): Promise<ScoreRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT name, score, level, lines, created_at
       FROM scores WHERE level = ?
       ORDER BY score DESC, created_at ASC
       LIMIT ?`,
  )
    .bind(level, limit)
    .all<ScoreRow>();
  return results ?? [];
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (url.pathname === "/api/scores" && request.method === "GET") {
    const level = clampInt(url.searchParams.get("level"), 1, 1, 999);
    const limit = clampInt(url.searchParams.get("limit"), 10, 1, 50);
    const scores = await getTop(env, level, limit);
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
    const level = clampInt(body.level, 1, 1, 999);
    const lines = clampInt(body.lines, 0, 0, 100_000);
    if (score < 0) return json({ error: "invalid_score" }, 400);

    const created = Date.now();
    const insert = await env.DB.prepare(
      `INSERT INTO scores (name, score, level, lines, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(name, score, level, lines, created)
      .run();

    const rankRow = await env.DB.prepare(
      `SELECT COUNT(*) AS higher FROM scores WHERE level = ? AND score > ?`,
    )
      .bind(level, score)
      .first<{ higher: number }>();

    const rank = (rankRow?.higher ?? 0) + 1;
    const scores = await getTop(env, level, 10);
    return json({ ok: true, id: insert.meta.last_row_id, rank, name, score, scores }, 201);
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
