/**
 * PLAYTEST TELEMETRY — local-only, opt-in, exported by hand.
 *
 * Exists to answer what the sim harness structurally cannot. sim/marks.ts
 * showed the bots are a ceilinged instrument: they fire the instant the
 * cooldown clears, never use Bond Breaker or Demolition, and can't pace
 * spending — so a full 660-point rig LOSES to a stock one purely because
 * MAGAZINE makes the bot bankrupt itself. Every question that turns on how a
 * human actually plays has to be measured on a human.
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
   *  sessions recorded before this field existed; the analyser infers those. */
  mode: "run" | "contract";
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
  abilities: { t: number; kind: "bond" | "bomb-arm" }[];
  result: "won" | "lost" | null;
  reason: string | null;
  secs: number;
  lines: number;
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

/** Funds are sampled rather than logged per change: a bay is 150-240s and the
 *  value moves on every shot and every clear, which would bloat the export for
 *  a curve nobody reads at that resolution. */
const SAMPLE_MS = 1000;

let session: Session | null = null;
let run: RunRecord | null = null;
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

export function startBay(cfg: {
  bay: number; mark: number; seed: number; mode: "run" | "contract";
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

export function ability(kind: "bond" | "bomb-arm", t: number): void {
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
  run = null;
  bay = null;
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
