// Scratch probe: launch-to-first-rest, in physics steps, over the aim search's
// own angle/power grid. Sizes aim-strategies.ts's TIMED_FLIGHT_STEPS.
import { Game } from "../src/game/game";
import { makeBaseLevel } from "../src/game/level";

const DT = 1000 / 60;
const samples: number[] = [];
const perBay: Record<number, number[]> = {};
for (const bay of [1, 5, 10]) {
  perBay[bay] = [];
  for (let deg = 15; deg <= 55; deg += 5) {
    for (const pw of [16, 20, 24, 28]) {
      const cfg = makeBaseLevel(bay - 1, 10);
      cfg.windMax = 0;
      cfg.windGust = 0;
      const g = new Game(cfg, {}, 7);
      let now = 0;
      g.cannon.angle = (deg * Math.PI) / 180;
      g.cannon.power = pw;
      g.updateTrajectory();
      g.shoot(now);
      let steps = 0;
      let landed: number | null = null;
      while (steps < 600 && landed === null) {
        now += DT;
        g.update(now);
        steps += 1;
        // ALL of the shipment's cubes at rest, not the first: the grade reads
        // the NEWEST landing in a row, so the number a timing rule has to
        // predict is when the shipment has finished arriving.
        if (g.cubes.length > 0 && g.cubes.every((c) => c.landedStroke !== undefined)) {
          landed = steps;
        }
      }
      if (landed !== null) { samples.push(landed); perBay[bay].push(landed); }
      g.destroy();
    }
  }
}
const stat = (xs: number[]): string => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length} min=${s[0]} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} max=${s[s.length - 1]}`;
};
console.log(`ALL   ${stat(samples)}`);
for (const bay of [1, 5, 10]) console.log(`bay ${bay} ${stat(perBay[bay])}`);
