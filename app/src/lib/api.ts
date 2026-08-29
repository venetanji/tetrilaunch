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
 *   BOARD_SKYDECK   the roof's daily board, and the only key with a SECOND
 *                   part — see the day note below.
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
/**
 * THE SKYDECK'S OWN BOARD (game/skydeck.ts).
 *
 * NEGATIVE, for the same reason Tier S is and not by analogy: the roof is not a
 * rung. It flies Mark 10's bays a step further along (level.ts's SKYDECK_RUNG)
 * under three clauses the ladder never deals at once, so its scores are not
 * comparable to a Mark-10 Deep Run's — and the id has to be one that CLAMPING a
 * Mark can never produce.
 *
 * `SKYDECK_TIER` (screens.ts, = MARK_COUNT + 1) is the obvious candidate and is
 * exactly wrong: every server that knows only Marks clamps it to MARK_COUNT, so
 * the roof would file onto the Tier 10 board — which is the pooling this key
 * exists to end, arrived at through the key itself.
 */
export const BOARD_SKYDECK: BoardId = -2;
/** Is `b` a real rung of the ladder, rather than Tier S, the roof, or an
 *  untiered row? */
export function isLadderBoard(b: BoardId): boolean {
  return b >= 1;
}

/**
 * THE DAY a score is filed under — the board key's second part, and the only
 * board that has one.
 *
 * `DAY_NONE` is every all-time board: the Tiers, Tier S and the untiered row
 * all carry it, so the wire keeps ONE key shape and the column defaults to it
 * for every row written before the daily board existed.
 *
 * A Skydeck row carries `SkydeckRules.day` — contracts.ts's `dailySeed`, a
 * plain YYYYMMDD in UTC, stamped onto the run at undock. That is the whole of
 * the rollover rule and it is stated once, in the run: the day a score files
 * under is the day whose RUN it flew, not the day it happened to finish on, so
 * a run undocked at 23:50Z and landed at 00:10Z ranks against the players who
 * flew the same seed rather than against tomorrow's.
 */
export type BoardDay = number;
export const DAY_NONE: BoardDay = 0;

/** The shape of a run this module needs to file it. Structural rather than
 *  RunState, so the transport layer keeps no dependency on the game — the two
 *  fields below are the only run facts a board key is made of. */
export interface BoardRun {
  mark: number;
  sandbox: boolean;
  skydeck: { day: BoardDay } | null;
}

/**
 * WHICH BOARD a finished run belongs on. The one statement of the routing rule;
 * main.ts's runBoard() adds only the question of whether a run is on screen.
 *
 * Order matters. Tier S first, because a sandbox run can be configured INTO any
 * other mode's shape and none of its claims are earned. The roof next, because
 * a Skydeck run carries `mark = SKYDECK_MARK` (MARK_COUNT) and is otherwise
 * indistinguishable from a Mark-10 Deep Run at this seam — which is precisely
 * how it used to land on the Tier 10 board.
 */
export function boardForRun(run: BoardRun): BoardId {
  if (run.sandbox) return BOARD_SANDBOX;
  if (run.skydeck) return BOARD_SKYDECK;
  return run.mark;
}

/** The day that run files under: its own dealt day on the roof, DAY_NONE
 *  everywhere else. Read off the RUN, never off the clock — see BoardDay. */
export function boardDayForRun(run: BoardRun): BoardDay {
  return run.skydeck ? run.skydeck.day : DAY_NONE;
}

/** What a SCREEN knows when it asks which board to show. */
export interface BoardView {
  /** The run object in hand — which OUTLIVES the run on screen: main.ts only
   *  clears it when a Contract starts, so "there is a run" and "a run is on
   *  screen" are different questions, and `inRun` is the second one. */
  run: BoardRun | null;
  /** Is that run the thing being shown (main.ts's RUN_STATES)? */
  inRun: boolean;
  /** Is the tower's car parked on the roof, with the roof open to this save? */
  skydeckParked: boolean;
  /** The Mark a Deep Run started right now would fly. */
  mark: number;
}

/**
 * WHICH BOARD A SCREEN SHOWS — boardForRun plus the question of whether the run
 * is still on screen.
 *
 * `run` outliving the run is the whole reason this is not just boardForRun. A
 * finished Skydeck run is still in hand on the menu, so routing off it alone
 * sent a player who had since parked the car on Tier 7 to the roof's board:
 * the run they were looking at the board FOR was not the run they had just
 * flown (codex review, PR #166).
 *
 * TIER S IS THE ONE EXCEPTION and it is deliberately left as it was: a sandbox
 * run in hand answers this whatever the screen, because closing Tier S in
 * Settings mid-run must not move where that run was filed. Changing it is a
 * behaviour change that has nothing to do with the roof, so it is not made
 * here — but it is stated, because the asymmetry is otherwise a bug waiting to
 * be "fixed" by someone reading only the line below.
 */
export function boardForView(v: BoardView): BoardId {
  if (v.run?.sandbox) return BOARD_SANDBOX;
  if (v.run && v.inRun) return boardForRun(v.run);
  // Outside a run, and the two halves of this line are NOT symmetric — which is
  // worth saying, because the asymmetry is inherited rather than chosen here.
  // The roof is read off the PARKING, since parking on it is the only thing
  // that says the next run is a Skydeck run at all. A Mark is read off the
  // UNLOCK, not the parked floor, which is what this has always done and what
  // ladderBoard() still does: parking on an already-beaten Tier to practise it
  // arguably ought to open that Tier's board, but that is a change to every
  // ladder player's screen and it belongs to its own change, not to this one.
  return v.skydeckParked ? BOARD_SKYDECK : v.mark;
}

/**
 * …and WHICH DAY of it. `today` is passed rather than read off a clock so this
 * stays pure and so the pin can say which "today" it means.
 *
 * The run's own dealt day only while that run is on screen — the same gate
 * boardForView uses, and for the same reason: a stale Skydeck run in hand would
 * otherwise date a board opened from the menu with the day it was flown.
 */
export function boardDayForView(v: BoardView, today: BoardDay): BoardDay {
  if (boardForView(v) !== BOARD_SKYDECK) return DAY_NONE;
  return v.run?.skydeck && v.inRun ? boardDayForRun(v.run) : today;
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

/**
 * LAST FETCHED ROWS, PER BOARD — and a board's key includes its DAY.
 *
 * It lives here, with the key, rather than as a record on the app, because the
 * bug it prevents is a keying bug and keying is this module's job. The record
 * was keyed on the BoardId alone, which is right for every all-time board and
 * wrong for the only board that has two key parts: a session left open across
 * UTC midnight would paint the previous day's rows under today's heading —
 * cached rows are drawn immediately and the fetch repaints behind them — and on
 * a slow or failed request they would stay there, under a date claiming they
 * were something else (codex review, PR #166). A date on a board is a promise
 * about the rows under it; a cache that cannot tell two days apart breaks it.
 *
 * `day` is REQUIRED on both sides, so the compiler is what keeps a caller from
 * asking a two-part key with one part.
 */
export class BoardCache {
  private rows: Record<string, ScoreEntry[]> = {};

  /** One entry per (board, day) actually visited. Bounded by the session: one
   *  key per board, plus one more per board per midnight crossed. */
  private key(board: BoardId, day: BoardDay): string {
    return `${board}:${day}`;
  }

  /** The rows held for exactly this board AND day — never another day's. */
  get(board: BoardId, day: BoardDay): ScoreEntry[] {
    return this.rows[this.key(board, day)] ?? [];
  }

  set(board: BoardId, day: BoardDay, rows: ScoreEntry[]): void {
    this.rows[this.key(board, day)] = rows;
  }
}

/**
 * TWO ROUTES, and the split is a compatibility decision rather than a taste.
 *
 * `/api/scores` is the all-time boards and its wire is untouched. `/api/daily`
 * is the (board, day) boards. The obvious alternative — one route, `mark=-2`
 * plus a `day` — is what a DEPLOYED-BUT-OLD Worker turns into a bug: its mark
 * clamp is `max(MARK_MIN, min(MARK_MAX, n))`, so `-2` silently becomes `-1` and
 * the roof's scores land on the Tier S board, and a GET reads Tier S's rows
 * back under the Skydeck's heading. A coercion nobody asked for is exactly the
 * failure this key was reshaped to prevent (see the note above), and it must
 * not be reintroduced on the wire.
 *
 * A path an old Worker does not serve cannot coerce anything: it 404s, and both
 * calls below already treat a non-ok response as "no board". So against a
 * Worker that predates this build the Skydeck board reads EMPTY and a Skydeck
 * score posts nowhere — visibly nothing, rather than quietly wrong — and every
 * existing board keeps behaving exactly as it does today. The Worker and the
 * migration ship in this same repo; see the PR for the deploy step.
 */
function boardPath(day: BoardDay): string {
  return day === DAY_NONE ? "/api/scores" : "/api/daily";
}

export async function fetchLeaderboard(
  board: BoardId,
  limit = 10,
  /** DAY_NONE for an all-time board; a Skydeck day key otherwise. */
  day: BoardDay = DAY_NONE,
): Promise<ScoreEntry[]> {
  try {
    const q = `mark=${board}&limit=${limit}${day === DAY_NONE ? "" : `&day=${day}`}`;
    const res = await fetch(`${apiBase()}${boardPath(day)}?${q}`);
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
  /** The board key's second part — DAY_NONE on every all-time board. */
  day: BoardDay = DAY_NONE,
): Promise<SubmitResult | null> {
  try {
    const res = await fetch(`${apiBase()}${boardPath(day)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score, mark: board, level, lines, day }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmitResult;
  } catch {
    return null;
  }
}
