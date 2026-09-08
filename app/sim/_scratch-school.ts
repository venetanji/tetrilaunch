// Scratch probe: FLIGHT SCHOOL's post-Workshop lessons under the bots.
//
// Reports, per (lesson, bot, seed): whether the lesson's own teaching goal was
// reached, whether the funding target was reached, when each happened (shots),
// and what the bay's bankroll looked like at the end. Sizes school.ts's
// LESSON_FLOAT_SHOTS / LESSON_TARGET_ROWS — the question is "does a pilot that
// passes the GOAL also fund the TARGET, with room to spare".
import { Game } from "../src/game/game";
import { LESSONS, levelForLesson } from "../src/game/school";
import { newTiers, type UpgradeTiers } from "../src/game/upgrades";
import { BOTS } from "./bots";

const DT = 1000 / 60;
const BOT_NAMES = (process.env.BOTS ?? "aim,middle,lob,lob-flat").split(",");
const SEEDS = Number(process.env.SEEDS ?? 5);
const FIRST = Number(process.env.FIRST ?? 4);
const RIG: UpgradeTiers = process.env.RIG === "reactor"
  ? { ...newTiers(), reactor: 1 }
  : newTiers();

interface Row {
  lesson: string; bot: string; seed: number;
  goal: boolean; funded: boolean; won: boolean;
  goalShot: number | null; fundShot: number | null;
  shots: number; lines: number; score: number; target: number; lost: number;
  reason: string | null;
}

const rows: Row[] = [];
for (let li = FIRST; li < LESSONS.length; li++) {
  const lesson = LESSONS[li];
  for (const name of BOT_NAMES) {
    for (let s = 1; s <= SEEDS; s++) {
      const cfg = levelForLesson(lesson, RIG);
      let shots = 0;
      let goalShot: number | null = null;
      let fundShot: number | null = null;
      const g = new Game(cfg, { onShoot: () => { shots += 1; } }, 0x5c400 + li);
      const bot = BOTS[name](s);
      let now = 0;
      let steps = 0;
      // 900s of wall clock: these bays have no launch budget and the gold ones
      // reset forever, so the only honest cap is a long one.
      const cap = 54_000;
      while (g.status === "playing" && steps < cap) {
        now += DT;
        bot.act(g, now);
        g.update(now);
        steps += 1;
        if (goalShot === null && g.taskMet) goalShot = shots;
        if (fundShot === null && g.score >= g.target) fundShot = shots;
      }
      rows.push({
        lesson: lesson.id, bot: name, seed: s,
        goal: goalShot !== null, funded: fundShot !== null, won: g.status === "won",
        goalShot, fundShot,
        shots, lines: g.linesTotal, score: g.score, target: g.target,
        lost: g.lostTotal, reason: g.status === "lost" ? g.lossReason : null,
      });
      g.destroy();
    }
  }
}

const pct = (n: number, d: number): string => `${Math.round((100 * n) / d)}%`;
const med = (xs: number[]): string => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? String(s[Math.floor(s.length / 2)]) : "—";
};
console.log(`rig=${process.env.RIG ?? "stock"} seeds=${SEEDS} bots=${BOT_NAMES.join(",")}`);
console.log("lesson              bot        win   goal  fund  goal@ fund@ lines score/target  reasons");
for (let li = FIRST; li < LESSONS.length; li++) {
  const lesson = LESSONS[li];
  for (const name of BOT_NAMES) {
    const r = rows.filter((x) => x.lesson === lesson.id && x.bot === name);
    const reasons = [...new Set(r.map((x) => x.reason).filter(Boolean))].join(",") || "—";
    console.log(
      `${lesson.id.padEnd(18)} ${name.padEnd(9)} `
      + `${pct(r.filter((x) => x.won).length, r.length).padStart(5)} `
      + `${pct(r.filter((x) => x.goal).length, r.length).padStart(5)} `
      + `${pct(r.filter((x) => x.funded).length, r.length).padStart(5)} `
      + `${med(r.map((x) => x.goalShot ?? NaN)).padStart(5)} `
      + `${med(r.map((x) => x.fundShot ?? NaN)).padStart(5)} `
      + `${med(r.map((x) => x.lines)).padStart(5)} `
      + `${med(r.map((x) => x.score)).padStart(5)}/${String(r[0].target >= Number.MAX_SAFE_INTEGER ? "—" : r[0].target).padEnd(5)} `
      + reasons,
    );
  }
}
