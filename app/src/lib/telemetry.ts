/**
 * PLAYTEST TELEMETRY — local-only, opt-in, exported by hand.
 *
 * Exists to answer what the sim harness structurally cannot. sim/marks.ts
 * showed the bots are a ceilinged instrument: they fire the instant the
 * cooldown clears, never use Bond Breaker or Demolition, and can't pace
 * spending — so a full rig LOSES to a stock one purely because MAGAZINE makes
 * the bot bankrupt itself (measured on the six-track, 660-point rig of the day;
 * Demolition made it a seventh track and upgrades.ts's FULL_BUILD_COST 770,
 * which changes the price of that rig and not the finding). Every question that
 * turns on how a human actually plays has to be measured on a human.
 *
 * The headline question this is built around: **is a human ever cooldown-bound?**
 * The bots' aim time is 0 by construction, so MAGAZINE reads to them as pure
 * throughput. If a human spends ~2s lining up a shot against a 900ms cooldown,
 * the cooldown never binds, and the whole track is worth nothing to them either
 * — which would be a real finding about an upgrade we currently sell.
 *
 * PRIVACY / SCOPE. Nothing here leaves the device. There is no network call in
 * this file and there must never be one: it writes to localStorage and hands
 * back a JSON blob the player downloads deliberately. It is OFF unless switched
 * on (see `enable`), so a shipped build records nothing by default. If this ever
 * becomes real analytics that phones home, that is a different feature with
 * different consent requirements — do not quietly promote this one.
 */
import type { ShotInfo } from "../game/game";
import type { RunState } from "../game/run";
import type { UpgradeTiers } from "../game/upgrades";

const KEY = "tetrilaunch.playtest.v1";
const FLAG = "tetrilaunch.playtest.on";

/** One launch. Times are already bay-relative (Game.elapsedMs). */
export type ShotRecord = ShotInfo;

export interface BayRecord {
  bay: number;
  mark: number;
  seed: number;
  /** Which half of the game this bay came from. A Contract has no clock and no
   *  bankroll, so pooling it with Deep Run bays makes both the clock and the
   *  bankroll analyses meaningless — sim/playtest.ts splits on this. Absent in
   *  sessions recorded before this field existed; the analyser infers those.
   *
   *  "skydeck" is a THIRD value rather than a flag beside "run", and it earns
   *  the split the same way "contract" did: that bay was flown on a fixed daily
   *  seed, a rung above the ladder's last on money (level.ts's
   *  applySkydeckEconomy), and with one or more standing Final clauses on it
   *  (game/skydeck.ts), so its clock slack and its low-water mark are answers
   *  to a different question from a Mark-10 Deep Run bay's. Pooled,
   *  they would move the medians the ladder is tuned against — which is exactly
   *  the corruption this field was added to prevent, one mode later.
   *
   *  Old recordings stay parseable: nothing before this change ever wrote
   *  "skydeck", and the analyser's inference (no clock => contract) is
   *  unchanged and still correct for every session that predates it. */
  mode: "run" | "contract" | "skydeck";
  target: number;
  timeLimitSec: number;
  cooldownMs: number;
  launchCost: number;
  scorePerLine: number;
  /** Compactor geometry, so a shot's `cphase` can be turned back into seconds
   *  offline. The bar covers (open - minLine) cells each way at `speed` px per
   *  physics step, which is the whole cycle period — without these three a
   *  phase is a number with no duration attached, and the question we are
   *  asking ("is the shooting window long enough for a second shot?") is
   *  precisely a question about duration. Absent in sessions recorded before
   *  this field existed; the analyser skips those rather than guessing. */
  compactorSpeed: number;
  compactorOpenCells: number;
  compactorMinLineCells: number;
  tiers: UpgradeTiers;
  /** Notches taken per axis, flattened to "id:n" (hazards.ts). Replaced the
   *  drafted-mod list: a run's shape is now what the player ratcheted. */
  notches: string[];
  pieceSize: string;
  shots: ShotRecord[];
  /** Sampled every SAMPLE_MS so a bay's funds curve can be plotted — "how close
   *  to broke did this get, and when" is invisible in an end-of-bay total. */
  funds: { t: number; v: number }[];
  lineClears: { t: number; lines: number }[];
  abilities: { t: number; kind: "bond" | "bomb-arm" | "thaw" }[];
  result: "won" | "lost" | null;
  reason: string | null;
  secs: number;
  lines: number;
  /** CUBES lost off the wrong side, NOT pieces — it is Game.lostTotal, which
   *  adds lostCubes.length per decay. Cubes per shot varies with the bay's
   *  pieceSize (tiny 2, std 4, bulk 5), so this over a shot count is not a
   *  fraction of shots; sim/playtest.ts once reported it as one and printed
   *  106%. The name predates the cube-wise penalty and is now frozen: it is a
   *  key in sessions already persisted to localStorage.
   *
   *  Also the Contract HUD's "Lost" column now (screens.ts's hudHTML), which
   *  is the first time this number is player-visible — so the units matter to
   *  anyone reconciling a session export against what was on screen. */
  lostPieces: number;
  endScore: number;
}

export interface RunRecord {
  startedAt: number;
  mark: number;
  loadout: UpgradeTiers;
  unlocks: string[];
  bays: BayRecord[];
  refits: { bay: number; scrapBefore: number; bought: string | null }[];
  won: boolean | null;
  salvage: number;
}

interface Session {
  version: 1;
  /** Free-text label so several sittings can be told apart after export. */
  label: string;
  runs: RunRecord[];
}

/** Funds are sampled rather than logged per change: a bay is 144-180s (the
 *  tier ladder's clock, before any Shift Cut notch) and the
 *  value moves on every shot and every clear, which would bloat the export for
 *  a curve nobody reads at that resolution. */
const SAMPLE_MS = 1000;

let session: Session | null = null;
let run: RunRecord | null = null;
/**
 * The record endRun just closed, held in case that run turns out not to have
 * ended — the game-over card's Retry Bay hands the same RunState back
 * (main.ts's resetBay), so the run keeps flying after it was filed.
 *
 * A RUN THAT RESUMES MUST RESUME INTO ITS OWN RECORD, not into a second one.
 * `run` is what startBay writes into and endRun nulls, so without this the
 * retried bay and every bay after it were dropped on the floor — startBay's
 * `!run` guard silently discarded them, and the second endRun no-oped, leaving
 * the analyser a run that ended at the bay it lost with nothing after it. That
 * is also exactly the double-count the other direction would have caused: a
 * fresh startRun would have filed the continuation as a SECOND run, disagreeing
 * with meta.ts's own count (recordRunEnd's `refiled`, which exists to keep the
 * lifetime total a count of runs rather than of endings). One record, one run,
 * on both sides of the save.
 *
 * Held as the exact record rather than "the last one in the session" so it can
 * only ever re-open the run that was just closed, and only once — resumeRun
 * clears it, and startRun clears it too.
 */
let closed: RunRecord | null = null;
let bay: BayRecord | null = null;
let lastSample = 0;

/** Telemetry records only when switched on. Off in every normal build, so the
 *  default player experience produces no data at all. */
export function recording(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function enable(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    /* private mode — recording simply stays off */
  }
}

function load(): Session {
  if (session) return session;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Session;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.runs)) {
        session = parsed;
        return session;
      }
    }
  } catch {
    /* fall through to a fresh session */
  }
  session = { version: 1, label: "", runs: [] };
  return session;
}

/** Persist after every bay rather than at run end: a playtest that ends with a
 *  closed tab or a reload mid-run should still yield its finished bays. */
function persist(): void {
  if (!session) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* quota — keep recording in memory, the export still works this session */
  }
}

export function startRun(mark: number, loadout: UpgradeTiers, unlocks: string[]): void {
  if (!recording()) return;
  const s = load();
  // A genuinely new run supersedes any record still waiting to be resumed: the
  // player left the loss card by the other door, and that run is over.
  closed = null;
  run = {
    startedAt: Date.now(),
    mark,
    loadout: { ...loadout },
    unlocks: [...unlocks],
    bays: [],
    refits: [],
    won: null,
    salvage: 0,
  };
  s.runs.push(run);
  persist();
}

/**
 * The mode tag for a bay of the Deep Run family (BayRecord.mode).
 *
 * Here rather than inline at main.ts's one call site because sim/playtest.ts's
 * whole grouping turns on it and sim/systems.ts has to be able to pin that the
 * two modes are distinguishable at all. A Skydeck bay carries mark 10 and a
 * clock, so nothing else about the record tells them apart — which is exactly
 * how they came to be pooled (PR #124 review).
 */
export function runMode(run: RunState): "run" | "skydeck" {
  return run.skydeck ? "skydeck" : "run";
}

export function startBay(cfg: {
  bay: number; mark: number; seed: number; mode: "run" | "contract" | "skydeck";
  target: number; timeLimitSec: number;
  cooldownMs: number; launchCost: number; scorePerLine: number;
  compactorSpeed: number; compactorOpenCells: number; compactorMinLineCells: number;
  tiers: UpgradeTiers; notches: string[]; pieceSize: string;
}): void {
  if (!recording() || !run) return;
  bay = {
    ...cfg,
    tiers: { ...cfg.tiers },
    notches: [...cfg.notches],
    shots: [],
    funds: [],
    lineClears: [],
    abilities: [],
    result: null,
    reason: null,
    secs: 0,
    lines: 0,
    lostPieces: 0,
    endScore: 0,
  };
  run.bays.push(bay);
  lastSample = -Infinity;
}

export function shot(info: ShotInfo): void {
  if (!bay) return;
  bay.shots.push({ ...info, t: Math.round(info.t) });
}

export function lineClear(lines: number, t: number): void {
  if (!bay) return;
  bay.lineClears.push({ t: Math.round(t), lines });
}

export function ability(kind: "bond" | "bomb-arm" | "thaw", t: number): void {
  if (!bay) return;
  bay.abilities.push({ t: Math.round(t), kind });
}

/** Called every frame; samples at SAMPLE_MS. Cheap enough to sit in the loop. */
export function sampleFunds(score: number, t: number): void {
  if (!bay) return;
  if (t - lastSample < SAMPLE_MS) return;
  lastSample = t;
  bay.funds.push({ t: Math.round(t), v: score });
}

export function endBay(r: {
  result: "won" | "lost"; reason: string | null; secs: number;
  /** `lostPieces` is Game.lostTotal — a CUBE count, not a piece count. See
   *  BayRecord.lostPieces for why the name stays wrong. */
  lines: number; lostPieces: number; endScore: number;
}): void {
  if (!bay) return;
  Object.assign(bay, r);
  bay = null;
  persist();
}

export function refit(bayNum: number, scrapBefore: number, bought: string | null): void {
  if (!run) return;
  run.refits.push({ bay: bayNum, scrapBefore, bought });
  persist();
}

export function endRun(won: boolean, salvage: number): void {
  if (!run) return;
  run.won = won;
  run.salvage = salvage;
  closed = run;
  run = null;
  bay = null;
  persist();
}

/**
 * Re-open the run endRun just closed, because it is still being flown.
 *
 * The one caller is main.ts's resetBay, on the retry that comes back from the
 * game-over card. Everything the resumed run does from here — its bays, its
 * refits, its outcome — lands in the record it was already writing, which is
 * what keeps the analyser's run count agreeing with the save's (see `closed`).
 *
 * `won` GOES BACK TO NULL, and that is the whole of what re-opening changes.
 * The loss that closed the record has been reversed by the player continuing;
 * leaving it set would have the export report a run that both lost and, a few
 * bays later, won. `salvage` is deliberately left alone: a losing filing banks
 * nothing (meta.ts's recordRunEnd pays only on a false→true tier edge), so the
 * value sitting there is 0 and the next endRun overwrites it with the real one.
 *
 * Idempotent, and narrow. A run already open is left alone — a resumed run that
 * later restarts a bay from the PAUSE modal comes through resetBay again, and
 * that one has nothing to re-open. With recording off it does nothing at all,
 * like everything else here.
 */
export function resumeRun(): void {
  if (!recording() || run || !closed) return;
  run = closed;
  closed = null;
  run.won = null;
  persist();
}

export function setLabel(label: string): void {
  load().label = label;
  persist();
}

export function summary(): { runs: number; bays: number; shots: number } {
  const s = load();
  let bays = 0;
  let shots = 0;
  for (const r of s.runs) {
    bays += r.bays.length;
    for (const b of r.bays) shots += b.shots.length;
  }
  return { runs: s.runs.length, bays, shots };
}

/** The whole session as JSON, for `sim/playtest.ts` to analyse. */
export function exportJSON(): string {
  return JSON.stringify(load(), null, 2);
}

/** Trigger a download of the session file. */
export function download(): void {
  const blob = new Blob([exportJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tetrilaunch-playtest-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function clear(): void {
  session = { version: 1, label: "", runs: [] };
  run = null;
  bay = null;
  persist();
}
