// Scratch: did the drag span's shrink move the PAD's power curve?
//
// The endpoints agreeing is not the curve agreeing. powerRatioForDrag subtracts
// a FIXED DRAG_MIN (28 world px) that did not scale when DRAG_MAX went from 220
// to 110, so routing a deflection through d * STICK_DRAG rescales the ramp but
// not its foot — and the offset that used to be 13% of the span is now 25%.
// This prints both curves side by side.
import { powerRatioForDrag } from "../src/game/cannon";
import { stickPowerRatio } from "../src/game/gamepad";

/** The mapping as it shipped BEFORE the pull-room fix: STICK_DRAG 240 fed
 *  through DRAG_MIN 28 / DRAG_MAX 220. The reference every sample below is
 *  measured against. */
const oldCurve = (d: number): number =>
  Math.max(0, Math.min(1, (d * 240 - 28) / (220 - 28)));

/** The mapping as it shipped IN the pull-room fix: STICK_DRAG 110*1.09 fed
 *  through the new span, DRAG_MIN still 28. */
const pr163Curve = (d: number): number => powerRatioForDrag(d * 110 * 1.09);

const DEADZONE = 0.22;
console.log("  defl |  before |  PR#163 |    now  | before-now");
for (const d of [DEADZONE, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9167, 0.95, 1]) {
  const a = oldCurve(d);
  const b = pr163Curve(d);
  const c = stickPowerRatio(d);
  console.log(
    `  ${d.toFixed(4)} | ${(a * 100).toFixed(1).padStart(6)}% | ${(b * 100).toFixed(1).padStart(6)}% | ` +
      `${(c * 100).toFixed(1).padStart(6)}% | ${(a - c).toExponential(2)}`,
  );
}
let worst = 0;
for (let i = 0; i <= 10000; i++) {
  const d = i / 10000;
  worst = Math.max(worst, Math.abs(oldCurve(d) - stickPowerRatio(d)));
}
console.log(`\nworst |before - now| over 10001 deflections: ${worst.toExponential(3)}`);
