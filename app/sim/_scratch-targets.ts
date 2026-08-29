// Scratch: print the target table the findings doc quotes, so no number in it
// is typed by hand.
import { targetScoreFor, skydeckTargetScoreFor, precisionPremium } from "../src/game/level";

for (const t of [4, 8, 9, 10]) {
  console.log(
    `T${t} x${precisionPremium(t).toFixed(2)}  bay1 $${targetScoreFor(0, t)}`
    + `  bay5 $${targetScoreFor(4, t)}  bay10 $${targetScoreFor(9, t)}`,
  );
}
console.log(
  `T11 x${precisionPremium(11).toFixed(2)}  bay1 $${skydeckTargetScoreFor(0)}`
  + `  bay5 $${skydeckTargetScoreFor(4)}  bay10 $${skydeckTargetScoreFor(9)}`,
);
