#!/usr/bin/env npx tsx
// Playtest session analyser.
//
//   npx tsx sim/playtest.ts path/to/tetrilaunch-playtest-*.json
//
// Reads a session exported by lib/telemetry.ts (__playtest.download() in the
// browser console) and prints the numbers the sim harness cannot produce,
// because they all depend on how a human actually plays.
//
// The questions, in priority order:
//
//  1. IS A HUMAN EVER COOLDOWN-BOUND? The sim bots fire the instant the
//     cooldown clears, so MAGAZINE reads to them as pure throughput — and a
//     full rig LOSES to a stock one because the bot bankrupts itself firing.
//     If a human's aim time routinely exceeds the cooldown, the cooldown never
//     binds and MAGAZINE is worth nothing to them either. That would be a real
//     finding about a track we currently sell.
//  2. WHAT IS A HUMAN'S SHOTS-PER-LINE? It sets the whole economy. The bots are
//     bad at it; every balance number derived from them inherits that.
//  3. DOES THE CLOCK BIND? Bots finish bays in 41-67s against 150-240s limits.
//     Humans deliberate, so the slack may be much smaller — or negative.
//  4. HOW CLOSE TO BROKE? An end-of-bay total hides a near-death at 40s.
import * as fs from "node:fs";

interface Shot { t: number; wait: number | null; funds: number; bomb: boolean; power: number; angle: number }
interface Bay extends ModeTag {
  bay: number; mark: number; target: number; timeLimitSec: number; cooldownMs: number;
  launchCost: number; scorePerLine: number; mods: string[]; pieceSize: string;
  shots: Shot[]; funds: { t: number; v: number }[]; lineClears: { t: number; lines: number }[];
  abilities: { t: number; kind: string }[];
  result: "won" | "lost" | null; reason: string | null; secs: number;
  lines: number; lostPieces: number; endScore: number;
}
interface Run { mark: number; bays: Bay[]; won: boolean | null; salvage: number }
/** Optional: sessions recorded before the field existed have no `mode`. */
interface ModeTag { mode?: "run" | "contract" }
interface Session { version: number; label: string; runs: Run[] }

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx sim/playtest.ts <session.json>");
  process.exit(1);
}
const session = JSON.parse(fs.readFileSync(file, "utf8")) as Session;

const bays = session.runs.flatMap((r) => r.bays).filter((b) => b.result !== null);
if (!bays.length) {
  console.error("No completed bays in this session.");
  process.exit(1);
}

/**
 * Contract bays have no clock and no bankroll, so they must be kept out of the
 * clock and bankroll analyses — pooled in, a Contract's timeLimitSec of 0 makes
 * the clock slack divide by zero, and its absent bankroll drags the low-water
 * mark to $0 and reports every Contract as "within 2 shots of broke".
 *
 * `mode` was added after the first sessions were recorded, so infer it when
 * absent rather than discarding that data: only a Contract has no clock.
 */
function modeOf(b: Bay): "run" | "contract" {
  return b.mode ?? (b.timeLimitSec > 0 ? "run" : "contract");
}
const runBays = bays.filter((b) => modeOf(b) === "run");
const contractBays = bays.filter((b) => modeOf(b) === "contract");

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

console.log(`Session${session.label ? ` "${session.label}"` : ""} — ${session.runs.length} run(s), ${bays.length} completed bays\n`);

// ---------------------------------------------------------------------------
// 1. Aim time vs cooldown — the headline.
// ---------------------------------------------------------------------------
// A bay's FIRST shot reports wait: null (there is no prior shot to be ready
// after), so it is excluded rather than counted as zero.
const waits = bays.flatMap((b) => b.shots.map((s) => s.wait).filter((w): w is number => w !== null));
// "Cooldown-bound" = fired within this many ms of the cannon becoming ready,
// i.e. the player was waiting on the gun rather than the gun waiting on them.
const BOUND_MS = 150;
const bound = waits.filter((w) => w <= BOUND_MS).length;

console.log("1. AIM TIME  (ms spent after the cannon was ready)");
if (!waits.length) {
  console.log("   no measurable shots");
} else {
  console.log(`   median ${quantile(waits, 0.5).toFixed(0)}ms · p25 ${quantile(waits, 0.25).toFixed(0)} · p75 ${quantile(waits, 0.75).toFixed(0)} · p90 ${quantile(waits, 0.9).toFixed(0)}`);
  console.log(`   cooldown-bound (fired within ${BOUND_MS}ms of ready): ${pct(bound / waits.length)} of ${waits.length} shots`);
  const cds = [...new Set(bays.map((b) => b.cooldownMs))].sort((a, b) => a - b);
  console.log(`   cooldowns seen: ${cds.join(", ")}ms`);
  const verdict = bound / waits.length > 0.5
    ? "MAGAZINE is real — the gun is the constraint more often than not."
    : bound / waits.length > 0.2
      ? "MAGAZINE is situational — it binds on a minority of shots."
      : "MAGAZINE looks DEAD for a human — aim time dominates the cooldown.";
  console.log(`   -> ${verdict}`);
}

// ---------------------------------------------------------------------------
// 2. Shot efficiency.
// ---------------------------------------------------------------------------
const totalShots = bays.reduce((a, b) => a + b.shots.length, 0);
const totalLines = bays.reduce((a, b) => a + b.lines, 0);
const totalLost = bays.reduce((a, b) => a + b.lostPieces, 0);
console.log("\n2. EFFICIENCY");
console.log(`   ${(totalShots / Math.max(1, totalLines)).toFixed(2)} shots per line  (${totalShots} shots, ${totalLines} lines)`);
console.log(`   ${(totalLost / Math.max(1, totalShots) * 100).toFixed(1)}% of shots lost to the wrong side`);

// Split by mode: this is the number contracts.ts's PLANNING_EFFICIENCY is
// derived from, and Contracts differ from Deep Run in piece size and in having
// no reason to conserve shots — so a pooled figure would mis-set the budget.
for (const [name, set] of [["deep run", runBays], ["contract", contractBays]] as const) {
  if (!set.length) continue;
  const s = set.reduce((a, b) => a + b.shots.length, 0);
  const l = set.reduce((a, b) => a + b.lines, 0);
  if (!s) continue;
  // Cubes that reached a line / cubes fired. Assumes 4-cube std pieces; a
  // per-size figure needs the piece size of each SHOT, which the sweep
  // telemetry spec adds.
  const eff = (l * 8) / (s * 4);
  console.log(`   ${name}: ${(s / Math.max(1, l)).toFixed(2)} shots/line · efficiency ~${eff.toFixed(2)} (${set.length} bays)`);
}

// ---------------------------------------------------------------------------
// 3. Clock pressure.
// ---------------------------------------------------------------------------
console.log("\n3. CLOCK  (Deep Run bays only — Contracts have no clock)");
const wins = runBays.filter((b) => b.result === "won" && b.timeLimitSec > 0);
if (wins.length) {
  const slack = wins.map((b) => 1 - b.secs / b.timeLimitSec);
  console.log(`   won bays used ${pct(1 - quantile(slack, 0.5))} of the limit (median) · tightest ${pct(1 - Math.min(...slack))}`);
  console.log(`   -> ${quantile(slack, 0.5) > 0.4 ? "clock is SLACK — the target is the real constraint" : "clock BINDS — time pressure is doing work"}`);
} else {
  console.log("   no timed bays won yet");
}
// Losses are listed per mode: "launches" can only happen in a Contract and
// "broke" only in a Deep Run, so a pooled tally reads as one distribution when
// it is two.
for (const [name, set] of [["deep run", runBays], ["contract", contractBays]] as const) {
  if (!set.length) continue;
  const byReason = new Map<string, number>();
  for (const b of set.filter((x) => x.result === "lost")) {
    byReason.set(b.reason ?? "?", (byReason.get(b.reason ?? "?") ?? 0) + 1);
  }
  const won = set.filter((b) => b.result === "won").length;
  console.log(`   ${name}: ${won}/${set.length} won · losses: ` +
    ([...byReason].map(([r, n]) => `${r} x${n}`).join(", ") || "none"));
}

// ---------------------------------------------------------------------------
// 4. Bankroll pressure — how close to broke, and when.
// ---------------------------------------------------------------------------
console.log("\n4. BANKROLL  (Deep Run bays only — Contracts have no bankroll)");
const mins = runBays
  .filter((b) => b.launchCost > 0)
  .map((b) => {
    const lowest = b.funds.length ? Math.min(...b.funds.map((f) => f.v)) : b.endScore;
    return { bay: b.bay, lowest, cost: b.launchCost, shotsLeft: Math.floor(lowest / b.launchCost) };
  });
if (!mins.length) {
  console.log("   no bays with a bankroll");
} else {
  console.log(`   median low-water mark: $${quantile(mins.map((m) => m.lowest), 0.5).toFixed(0)}` +
    ` (${quantile(mins.map((m) => m.shotsLeft), 0.5).toFixed(0)} shots of headroom)`);
  const scary = mins.filter((m) => m.shotsLeft <= 2).length;
  console.log(`   bays that got within 2 shots of broke: ${scary}/${mins.length}`);
}

// ---------------------------------------------------------------------------
// 5. Abilities — the tracks the bots cannot exercise at all.
// ---------------------------------------------------------------------------
const bond = bays.reduce((a, b) => a + b.abilities.filter((x) => x.kind === "bond").length, 0);
const bomb = bays.reduce((a, b) => a + b.abilities.filter((x) => x.kind === "bomb-arm").length, 0);
console.log("\n5. ABILITIES  (invisible to the sim bots)");
console.log(`   Bond Breaker used ${bond}x · Demolition armed ${bomb}x across ${bays.length} bays`);

// ---------------------------------------------------------------------------
// Per-bay table.
// ---------------------------------------------------------------------------
console.log("\nPer bay:");
console.log("  mode      bay mark  result  reason   secs/limit  lines  shots  s/line  medWait  end/target");
for (const b of bays) {
  const w = b.shots.map((s) => s.wait).filter((x): x is number => x !== null);
  console.log(
    "  " + modeOf(b).padEnd(9) +
    String(b.bay).padStart(3) + String(b.mark).padStart(5) +
    (b.result ?? "?").padStart(8) + (b.reason ?? "-").padStart(9) +
    // A Contract has no limit, so "/0" would read as a limit of zero.
    `${b.secs.toFixed(0)}/${b.timeLimitSec > 0 ? b.timeLimitSec : "-"}`.padStart(12) +
    String(b.lines).padStart(7) + String(b.shots.length).padStart(7) +
    (b.shots.length / Math.max(1, b.lines)).toFixed(1).padStart(8) +
    (w.length ? quantile(w, 0.5).toFixed(0) + "ms" : "-").padStart(9) +
    `${b.endScore}/${b.target}`.padStart(12),
  );
}
