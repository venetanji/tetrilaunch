// Leaderboard client. Talks to the D1-backed Worker API.
// Same-origin when served by the Worker (web/PWA); absolute to the deployed
// Worker when running locally (vite dev) or inside the Capacitor native shell.

const REMOTE = "https://tetrilaunch.venetanji.workers.dev";

function apiBase(): string {
  const h = location.hostname;
  const servedByWorker = h.endsWith(".workers.dev") || h === "tetrilaunch.venetanji.workers.dev";
  return servedByWorker ? "" : REMOTE;
}

export interface ScoreEntry {
  name: string;
  score: number;
  level: number;
  lines: number;
  created_at: number;
}

export interface SubmitResult {
  ok: boolean;
  rank: number;
  scores: ScoreEntry[];
}

export async function fetchLeaderboard(level = 1, limit = 10): Promise<ScoreEntry[]> {
  try {
    const res = await fetch(`${apiBase()}/api/scores?level=${level}&limit=${limit}`);
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
  level: number,
  lines: number,
): Promise<SubmitResult | null> {
  try {
    const res = await fetch(`${apiBase()}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score, level, lines }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmitResult;
  } catch {
    return null;
  }
}
