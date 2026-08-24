import type { LevelConfig } from "./level";
import { makeBaseLevel } from "./level";
import { applyRatchets, hazardsForMark, type HazardId, type Ratchets } from "./hazards";
import { applyFinal, FINALS, type FinalId } from "./finals";
import { applyUpgrades, MARK_COUNT } from "./upgrades";
import { CUBES_PER_LINE, dailySeed, PLANNING_EFFICIENCY } from "./contracts";
import { SIZE_SPEC } from "./pieces";
import type { RunState } from "./run";
import { RUN_LEVELS } from "./run";

/**
 * GOD TIER — the eleventh rung, and the only part of the game that never runs
 * out.
 *
 * Past Tier 10 `meta.ts`'s advanceTier clamps the Mark and the ladder simply
 * stops having an opinion. What goes there is deliberately NOT an eleventh
 * Tier: it is a DAILY. Ten bays, one seed, the same ten bays for everybody on
 * Earth that day, a board that resets at midnight UTC.
 *
 * That shape is chosen for the same reason Contracts are generated rather than
 * authored: a hand-built endgame is a content treadmill nobody on this project
 * has time to feed, and a daily built from a seed produces a genuinely new
 * object every day forever at a content cost of zero. See docs/LONGEVITY.md.
 *
 * ---------------------------------------------------------------------------
 * IT IS GENERATED THE WAY A CONTRACT IS GENERATED
 *
 * docs/DESIGN.md, on Contracts: "seed + template + difficulty budget … so
 * difficulty becomes a number you spend rather than an accident of the roll."
 * This is that, one level up — the unit being generated is a RUN, not a bay.
 *
 *   SEED      contracts.ts's dailySeed(), already shared and already UTC-dated.
 *   TEMPLATE  a named DAY SHAPE (GOD_TEMPLATES) that weights the pressure menu,
 *             so two days differ in character and not only in numbers, and the
 *             card can say what today IS before it is flown.
 *   BUDGET    one scalar, spent bay by bay, with the per-bay allowance rising
 *             across the run so bay 1 is a warm-up and bay 10 is not.
 *
 * ---------------------------------------------------------------------------
 * A BOSS BAY IS A FINAL INSPECTION YOU DID NOT GET TO CHOOSE
 *
 * The one idea in here worth stating on its own, because it buys twenty
 * authored, individually SIZED boss encounters for the price of not passing
 * null. finals.ts already carries twenty clauses across the ten Tiers, each
 * priced in "extra lines the bay demands" against a measured baseline, each
 * with card copy naming its own number. Applied to an arbitrary bay instead of
 * only to bay 10, and dealt rather than offered, they are exactly what a boss
 * should be: announced, unduckable, specific, and about one system.
 *
 * Bay 10 is ALWAYS a boss, and God Tier flies at Mark 10, where level.ts sends
 * the last bay's joints to Infinity — the capstone format, nothing shatters,
 * the Bond Breaker is the only shatter in the bay. Bay 10 was already the most
 * authored thing in the game; this stops it being the only one.
 *
 * ---------------------------------------------------------------------------
 * THE PLAYER STILL DRAFTS
 *
 * The ratchet draft runs between bays exactly as it always has, and the day's
 * pre-applied notches sit UNDER the player's picks (see levelForGod). Removing
 * the draft would make the day a fixed obstacle course; keeping it makes the
 * day a shared POSITION that everyone plays their own way, which is what a
 * competitive daily wants. The offers are seeded off the day, so everyone is
 * dealt the same hands and what they take is theirs.
 *
 * One thing the day does take over: bay 10's Final Inspection. The day already
 * chose it — that IS the boss. So a God Tier run's last draft is an ordinary
 * ratchet draft (main.ts skips run.ts's isFinalDraft in this mode) rather than
 * an inspection stacked on top of a clause, which is the version that could
 * add two quota raises to the same bay and turn the capstone into a lose
 * button.
 */

/** God Tier is flown at the top of the ladder, always. Named rather than
 *  inlined because three separate things read it — the level ladder, the build
 *  budget, and which hazard axes exist — and they have to agree. */
export const GOD_MARK = MARK_COUNT;

/**
 * Attempts on a LIVE day. The same number for everyone, subscriber or not.
 *
 * This is the constant the brief and docs/DESIGN.md disagree over, so it is
 * the constant that carries the argument. The brief asked for limited retries
 * lifted by Unlimited. DESIGN.md says, in the modes table and again under
 * Monetization: purchasable power, none — "you can pay to progress faster,
 * never to rank higher." On a seeded daily, best-of-N against best-of-infinity
 * is not a subtle edge, it is the whole board, so selling retries here would
 * be selling rank outright and would be the first thing the project ever sold
 * that is usable in the exam.
 *
 * What ships keeps everything the brief wanted except that: retries exist,
 * they are limited, and they are limited identically whether you pay or not.
 * The subscription lifts the cap on the ARCHIVE instead — every PAST day,
 * replayable without limit, each with its own all-time board — which is a
 * large and permanently growing product that cannot move a live ranking by a
 * single place, because those days are closed.
 *
 * Three, because one bad opening should be recoverable and a board should not
 * be an endurance test. If the call is ever overruled, this is the one line
 * that changes, and docs/LONGEVITY.md should be rewritten to say the line was
 * crossed knowingly rather than left saying it wasn't.
 */
export const GOD_ATTEMPTS = 3;

/* -------------------------------------------------------------------------
 * THE PRESSURE MENU
 *
 * Four kinds, all of them things that already exist and are already
 * calibrated. Nothing in God Tier is a new mechanic; it is a new SCHEDULE for
 * mechanics the ladder spent ten Tiers teaching.
 * ---------------------------------------------------------------------- */

export type PressureId = "notch" | "content" | "boss" | "ration" | "quota";

/**
 * What one unit of each pressure costs out of the day's budget.
 *
 * FIRST PASS, and the relative ordering is the part that was reasoned about
 * rather than the absolute numbers. A content notch costs more than a number
 * notch because a material changes what the bay IS rather than how much it
 * asks for; a boss costs more than either because finals.ts priced its clauses
 * at four to eight extra lines apiece; a ration costs most of all because it
 * is the only pressure that changes what KIND of bay you are in — it takes the
 * shift clock away and runs the bay to launches instead.
 */
export const PRESSURE_COST: Record<PressureId, number> = {
  notch: 6,
  content: 10,
  boss: 30,
  ration: 18,
  quota: 8,
};

/** Funding target one `quota` unit adds to a bay. Deliberately smaller than
 *  hazards.ts's retired TARGET_NOTCH of 300: that was one notch of a whole
 *  axis, this is one unit of a budget that can buy several on one bay. */
export const QUOTA_UNIT = 150;

/**
 * A RATIONED BAY trades its shift clock for a launch budget.
 *
 * The first build made this a launch ceiling ON TOP of the clock, and measured
 * against the bay it was decoration. A 150s bay at level.ts's 1350ms cooldown
 * physically permits ~111 shots and a human aiming at the measured ~4.5s a
 * shot fits ~33; the funds model below prices bay 2 at 87 launches for a stock
 * rig, so a ceiling sized off it was never once the binding constraint. A
 * pressure the card promises and the bay never delivers is worse than no
 * pressure.
 *
 * So it takes the clock AWAY instead, and the bay runs to launches the way a
 * Contract does. That makes it the one pressure on the menu that changes what
 * KIND of bay you are in rather than how much it asks for — which is worth
 * more to a daily than another multiplier, because a day with two rationed
 * bays in it is structurally a different run and not merely a harder one.
 *
 * docs/DESIGN.md's argument for launch budgets transfers intact: a budget is
 * spent only by ACTING, so it is worth exactly the same to a fast player and a
 * deliberate one, where the clock it replaces is not.
 */

/** Earliest bay index a ration may land on.
 *
 *  Not a difficulty choice — an arithmetic one. A bay's net per line is its
 *  payout less the launches that line costs, and early bays are dreadful at it
 *  (bay 2 nets $27 a line against bay 10's $107), so the modelled launch
 *  requirement RISES as you go back down the ladder: 87 launches at bay 2
 *  against 47 at bay 10. A rationed bay 2 would be a ten-minute clockless
 *  slog, which is not what "rationed" is supposed to feel like. From the
 *  midpoint on, the model lands between 50 and 75 — a four-to-six minute bay. */
export const RATION_MIN_BAY = 4;

/**
 * Slack over the modelled launch requirement a ration leaves.
 *
 * The model is crude and the failure mode is catastrophic, so the slack is
 * generous and stated rather than tuned to the edge. hazards.ts's floors exist
 * for the identical reason and say it plainly: an axis that can reach an
 * unplayable bay is not a difficulty knob, it is a lose button.
 *
 * 1.25 sits between contracts.ts's SLACK of 1.15 — which prices a bay that is
 * MEANT to be lost and retried for free — and something merely safe. It is
 * also generous twice over in practice, because the model prices a STOCK rig
 * and nobody arrives at God Tier flying one.
 */
export const RATION_SLACK = 1.25;

/* -------------------------------------------------------------------------
 * DAY TEMPLATES
 * ---------------------------------------------------------------------- */

export type GodTemplateId = "gauntlet" | "foundry" | "austerity" | "squeeze" | "wildcat";

export interface GodTemplate {
  id: GodTemplateId;
  /** Two words, on the card. */
  name: string;
  /** One line, on the card, saying what today is before it is flown. A daily
   *  whose character is only discoverable by losing to it is a daily people
   *  play once. */
  blurb: string;
  /** Relative pull of each pressure when the budget is spent. A zero means
   *  "never on this day", which is how a template gets an identity rather than
   *  a tilt: Foundry days are never rationed at all, so the day reads as
   *  ABOUT its materials. */
  weights: Record<PressureId, number>;
}

export const GOD_TEMPLATES: GodTemplate[] = [
  {
    id: "gauntlet",
    name: "Gauntlet",
    blurb: "Inspectors on the floor all shift — several bays carry a clause you did not pick.",
    weights: { notch: 1, content: 1, boss: 6, ration: 0, quota: 1 },
  },
  {
    id: "foundry",
    name: "Foundry",
    blurb: "Every belt runs hot — the manifest is materials, most of the way down.",
    weights: { notch: 1, content: 7, boss: 1, ration: 0, quota: 1 },
  },
  {
    id: "austerity",
    name: "Austerity",
    blurb: "Shipments are rationed — the back half runs to launches, with no clock at all.",
    weights: { notch: 1, content: 1, boss: 1, ration: 6, quota: 2 },
  },
  {
    id: "squeeze",
    name: "Squeeze",
    blurb: "The clock and the fuel bill, all shift, every bay.",
    weights: { notch: 7, content: 1, boss: 1, ration: 0, quota: 3 },
  },
  {
    id: "wildcat",
    name: "Wildcat",
    blurb: "No pattern to it. The day spends where it lands.",
    weights: { notch: 3, content: 3, boss: 3, ration: 2, quota: 3 },
  },
];

export function godTemplateById(id: string): GodTemplate | undefined {
  return GOD_TEMPLATES.find((t) => t.id === id);
}

/* -------------------------------------------------------------------------
 * BUDGET
 * ---------------------------------------------------------------------- */

/** The day's total spend, before the seed's wobble.
 *
 *  Sized so a middling day buys roughly one boss, a handful of notches and a
 *  material or two — about 140 points against PRESSURE_COST's boss at 30 —
 *  which is meant to read as "Tier 10 plus a hard day", not as a different
 *  game. God Tier's difficulty is supposed to come from the SCHEDULE being
 *  unduckable, not from the numbers being enormous; a run that is unwinnable
 *  for everyone posts an empty board. */
export const GOD_BUDGET_BASE = 140;

/** How far a day may swing either side of the base. Days are meant to differ;
 *  they are not meant to be a lottery between trivial and impossible, so the
 *  band is narrow and the CHARACTER (the template) carries the variety. */
export const GOD_BUDGET_SWING = 30;

/* -------------------------------------------------------------------------
 * THE GENERATED DAY
 * ---------------------------------------------------------------------- */

export interface GodBay {
  /** 0-based, matching RunState.levelIndex. */
  index: number;
  /** Notches pre-applied to this bay — free, unchosen, and UNDER whatever the
   *  player has ratcheted for themselves (see levelForGod). */
  ratchets: Ratchets;
  /** A Final Inspection clause dealt onto this bay, or null. */
  boss: FinalId | null;
  /** RATIONED: the bay runs to this many launches with NO shift clock, the way
   *  a Contract does. 0 = an ordinary clocked bay, which is every bay the
   *  ladder itself deals (level.ts's launchBudget). */
  launchBudget: number;
  /** Funding target ADDED on top of the ladder's own for this bay. */
  quota: number;
  /** Budget this bay consumed. A readout for the card, so a day's shape is
   *  legible before it is flown rather than only in hindsight. */
  spent: number;
}

export interface GodRun {
  /** contracts.ts's dailySeed() for the day this belongs to — also the board
   *  key's payload, so the two can never name different days. */
  seed: number;
  template: GodTemplate;
  budget: number;
  bays: GodBay[];
}

/** The leaderboard key for a God Tier day. `god:YYYYMMDD`, because dailySeed
 *  IS the date in that form — see lib/api.ts's board keys. */
export function godBoardKey(seed: number = dailySeed()): string {
  return `god:${Math.floor(seed)}`;
}

/** Days since the Unix epoch for a YYYYMMDD daily seed.
 *
 *  Streaks need "was yesterday's day the one before this one", and seeds are
 *  NOT contiguous integers — 20260901 minus 20260831 is 70. Converting to a
 *  day index makes the question a subtraction again, and doing it from the
 *  seed rather than from a Date keeps the whole module a pure function of its
 *  inputs, which is what lets sim/systems.ts sweep a year of days without a
 *  clock. */
export function godDayIndex(seed: number): number {
  const s = Math.floor(seed);
  const y = Math.floor(s / 10000);
  const m = Math.floor(s / 100) % 100;
  const d = s % 100;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** mulberry32, the same generator contracts.ts uses. Duplicated rather than
 *  exported across modules for the reason that file gives: a shared PRNG whose
 *  call order changes in one caller silently re-rolls every other caller's
 *  content. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length) % xs.length];
}

/** Weighted pick over the pressure menu, skipping anything this bay can no
 *  longer afford or has already taken all it may. Returns null when nothing is
 *  buyable, which ends the bay's spend rather than looping. */
function pickPressure(
  rng: () => number,
  weights: Record<PressureId, number>,
  allowed: readonly PressureId[],
  left: number,
): PressureId | null {
  const open = allowed.filter((p) => weights[p] > 0 && PRESSURE_COST[p] <= left);
  if (!open.length) return null;
  const total = open.reduce((a, p) => a + weights[p], 0);
  let roll = rng() * total;
  for (const p of open) {
    roll -= weights[p];
    if (roll <= 0) return p;
  }
  return open[open.length - 1];
}

/**
 * Launches the modelled competent player needs to bank `cfg`'s target, at
 * contracts.ts's own PLANNING_EFFICIENCY.
 *
 * Same closed form the Contract budget uses, run against a bay that has a
 * BANKROLL rather than free launches — which is the whole difference and the
 * reason this can't just call launchesFor. With L lines at λ launches each:
 *
 *     startingFunds + L*scorePerLine - L*λ*launchCost >= targetScore
 *
 * so L is the shortfall over the NET a line yields once its own launches are
 * paid for, and the answer is L*λ. A bay whose net per line is zero or
 * negative cannot be banked at all by this model — early bays get close, since
 * bay 1 pays $100 a line against $72.50 of launches — so that case returns
 * Infinity and the generator declines to ration that bay at all.
 */
export function modelledLaunches(cfg: LevelConfig): number {
  // Launches a line costs, from the same two facts contracts.ts's launchesFor
  // is built on: a line is CUBES_PER_LINE cubes wide and a launch delivers
  // this bay's payload size times the measured efficiency. Reading the bay's
  // own pieceSize matters — a micro bay pays nearly twice the launches a bulk
  // bay does for the same line, and a ration blind to that would be a
  // different constraint on every bay it landed on.
  const perLine = CUBES_PER_LINE / (SIZE_SPEC[cfg.pieceSize].cubes * PLANNING_EFFICIENCY);
  const net = cfg.scorePerLine - perLine * cfg.launchCost;
  if (net <= 0) return Infinity;
  const shortfall = Math.max(0, cfg.targetScore - cfg.startingFunds);
  return Math.ceil((shortfall / net) * perLine);
}

/**
 * The day. A pure function of the seed, so every player on Earth generates the
 * same ten bays and the board means something.
 *
 * The spend walks bay by bay with a RISING allowance — bay i gets a share
 * proportional to (i + 1), normalised — so the day opens survivable and closes
 * hard. Two rules are enforced outside the roll because a roll cannot be
 * trusted with them:
 *
 *  - **Bay 10 is always a boss**, whatever the template and whatever is left
 *    in the purse. The capstone is the point.
 *  - **At most one boss per bay**, and a rationed bay's launch budget is
 *    computed from that bay's own arithmetic rather than rolled, so it is
 *    never a number that happens to sit below what the bay demands.
 */
export function generateGodRun(seed: number = dailySeed()): GodRun {
  const rng = mulberry32(seed);
  const template = pick(rng, GOD_TEMPLATES);
  const budget =
    GOD_BUDGET_BASE + Math.round((rng() * 2 - 1) * GOD_BUDGET_SWING);

  const numberAxes = hazardsForMark(GOD_MARK).filter((h) => h.kind === "number").map((h) => h.id);
  const contentAxes = hazardsForMark(GOD_MARK).filter((h) => h.kind === "content").map((h) => h.id);
  // Every clause in the table is fair game: God Tier is past the ladder, so
  // there is no reveal left to protect and a Tier-1 clause on bay 2 is a
  // perfectly good easy boss.
  const bosses = FINALS.map((f) => f.id);

  /* THE STRUCTURAL PRESSURES ARE PLACED BEFORE THE SPEND, not rolled inside it.
   *
   * The first build rolled everything together and the expensive pressures
   * never appeared. A bay's allowance is a tenth or so of the day; a boss
   * costs 30 and a ration 18, so the cheap pressures always got there first
   * and every template produced the same run with different notches on it.
   * Gauntlet — the day whose entire identity is bosses — dealt exactly the one
   * forced onto bay 10, i.e. it was Wildcat with a different name on the card,
   * and Austerity — the rationing day — shipped zero rations.
   *
   * So the day buys its bosses and its rations out of the WHOLE purse up
   * front, at the share its template weights them at, and the bays then split
   * what is left on the pressures small enough for a bay to afford. That is
   * the difference between a template that tilts a roll and a template that
   * decides what the day IS, which is what the card promises.
   */
  const weightSum = (Object.values(template.weights) as number[]).reduce((a, b) => a + b, 0);
  /** Seats a structural pressure buys at this template's share of the purse.
   *  ROUNDED, not floored: at floor, a template weighting bosses at a fifth of
   *  a 132-point day computes 0.94 seats and ships none, which reads as the
   *  weight being ignored rather than as it being small. */
  const seatsFor = (id: PressureId, max: number): number => {
    if (weightSum <= 0) return 0;
    const share = template.weights[id] / weightSum;
    return Math.max(0, Math.min(max, Math.round((budget * share) / PRESSURE_COST[id])));
  };

  // Bay 1 is left structurally clean — the day's legible opening — and bay 10
  // already carries its forced boss, so extra bosses have RUN_LEVELS - 2 seats.
  // Rations start at RATION_MIN_BAY for the arithmetic reason stated there,
  // and bay 10 may carry one.
  const bossAt = new Map<number, FinalId>();
  bossAt.set(RUN_LEVELS - 1, pick(rng, bosses));
  placeSeats(rng, seatsFor("boss", RUN_LEVELS - 2), 1, RUN_LEVELS - 2, (at) => {
    if (bossAt.has(at)) return false;
    bossAt.set(at, pick(rng, bosses));
    return true;
  });

  /* ONE STRUCTURAL PRESSURE PER BAY, and a rationed bay buys nothing else.
   *
   * Measured, not assumed. Over a two-year sweep the unconstrained version
   * produced rationed bays of up to 179 launches — roughly a thirteen-minute
   * bay — because a ration is SIZED from what the bay demands and the same bay
   * had also bought two quota units and a Rush Order. Every one of those is
   * priced fairly on its own; stacked on a clockless bay they compound into
   * something no player would call a puzzle.
   *
   * So a ration never shares a bay with a boss (below) and never buys quota
   * (see the per-bay loop). What is left is a bay whose budget is a function
   * of the ladder and its own notches, which the same sweep lands between 62
   * and 105 launches — the long tail being a bay that also spent notches on
   * the fuel levy, which is the one axis that makes a launch buy less. Four to
   * eight minutes, which is what "rationed" is meant to feel like.
   */
  const rationSeats = RUN_LEVELS - RATION_MIN_BAY;
  const rationAt = new Set<number>();
  placeSeats(rng, seatsFor("ration", rationSeats), RATION_MIN_BAY, rationSeats, (at) => {
    if (rationAt.has(at) || bossAt.has(at)) return false;
    rationAt.add(at);
    return true;
  });

  // What the bays get to split: the purse less everything already placed.
  const placedCost =
    bossAt.size * PRESSURE_COST.boss + rationAt.size * PRESSURE_COST.ration;
  const bayPool = Math.max(0, budget - placedCost);
  // Shares proportional to (i + 1), so the last bay's allowance is ten times
  // the first's and the day opens survivable.
  const weightTotal = (RUN_LEVELS * (RUN_LEVELS + 1)) / 2;

  const bays: GodBay[] = [];
  let carried = 0;
  for (let i = 0; i < RUN_LEVELS; i++) {
    const ratchets: Ratchets = {};
    const boss = bossAt.get(i) ?? null;
    const rationed = rationAt.has(i);
    let quota = 0;
    let spent =
      (boss ? PRESSURE_COST.boss : 0) + (rationed ? PRESSURE_COST.ration : 0);
    // Unspent allowance rolls forward rather than evaporating: without it a
    // bay that could not afford the pressure it rolled would quietly refund
    // the day, and the early bays (whose share is a rounding error) would
    // contribute nothing to the late ones.
    let left = Math.floor((bayPool * (i + 1)) / weightTotal) + carried;

    for (;;) {
      // A rationed bay may still take notches and materials — those change how
      // hard each launch is to place, which is exactly the question a launch
      // budget asks — but never quota, which changes how MANY launches it
      // needs and would re-inflate the budget the ration was sized against.
      const menu: PressureId[] = rationed
        ? ["notch", "content"]
        : ["notch", "content", "quota"];
      const p = pickPressure(rng, template.weights, menu, left);
      if (!p) break;
      left -= PRESSURE_COST[p];
      spent += PRESSURE_COST[p];
      if (p === "notch") {
        const axis = pick(rng, numberAxes) as HazardId;
        ratchets[axis] = (ratchets[axis] ?? 0) + 1;
      } else if (p === "content") {
        const axis = pick(rng, contentAxes) as HazardId;
        ratchets[axis] = (ratchets[axis] ?? 0) + 1;
      } else {
        quota += QUOTA_UNIT;
      }
    }
    carried = Math.max(0, left);

    // The ration is SIZED last, from the bay as the rest of the spend left it
    // — the quota it just bought is part of what those launches have to bank,
    // so pricing it first would price it against a bay that no longer exists.
    // (Its SEAT was placed up front; only the number is computed here.)
    let launchBudget = 0;
    if (rationed) {
      // applyRatchets COPIES (it promises not to mutate `base`), so the
      // returned config is the one to price — a discarded return here would
      // have priced an unratcheted bay.
      //
      // Priced on a STOCK rig, with no upgrades applied: the day is generated
      // once for everybody and cannot know whose reactor is reading it, and a
      // ration sized to a maxed rig would be a lose button for a thin one.
      // Sizing to the floor and letting a good rig find it generous is the
      // safe direction to be wrong in.
      const base = makeBaseLevel(i, GOD_MARK);
      base.targetScore += quota;
      const probe = applyRatchets(base, ratchets);
      // The boss clause is priced in too where it changes the arithmetic — a
      // Rush Order on a rationed bay raises the quota those launches have to
      // bank, and a budget blind to it is the one combination here that could
      // produce a bay nobody can clear.
      if (boss) applyFinal(probe, boss);
      const need = modelledLaunches(probe);
      // Infinity = a bay this model cannot bank at all (see modelledLaunches).
      // Refuse the ration rather than emit one: the pressure is refunded to
      // the next bay's purse, which is strictly better than shipping a bay
      // nobody can clear.
      if (Number.isFinite(need)) {
        launchBudget = Math.ceil(need * RATION_SLACK);
      } else {
        spent -= PRESSURE_COST.ration;
        carried += PRESSURE_COST.ration;
      }
    }

    bays.push({ index: i, ratchets, boss, launchBudget, quota, spent });
  }

  return { seed, template, budget, bays };
}

/** Seat `want` structural pressures on bay indices `[from, from + span)`.
 *
 *  Re-rolls on a collision rather than sampling without replacement, so the
 *  placement stays a pure function of the same call sequence and a change to
 *  how many seats a template wants cannot re-roll the rest of the day. The
 *  try budget is what bounds it: a day that wants more seats than there are
 *  bays simply gets fewer, which is the right failure — a generator that
 *  looped until it fit would hang on exactly the day nobody could clear. */
function placeSeats(
  rng: () => number,
  want: number,
  from: number,
  span: number,
  take: (at: number) => boolean,
): void {
  for (let n = 0; n < want; n++) {
    for (let tries = 0; tries < 16; tries++) {
      if (take(from + Math.floor(rng() * span))) break;
    }
  }
}

/** Memoised exactly as contracts.ts's daily board is, and for the same reason:
 *  a pure function of the seed looks free to call and is called on every
 *  render, and this one probes ten bays through makeBaseLevel/applyRatchets to
 *  price its ceilings. Keyed on the seed, so a date rollover cannot serve
 *  yesterday's day. */
const DAY_CACHE = new Map<number, GodRun>();

export function godRunFor(seed: number = dailySeed()): GodRun {
  const hit = DAY_CACHE.get(seed);
  if (hit) return hit;
  const day = generateGodRun(seed);
  DAY_CACHE.set(seed, day);
  return day;
}

/**
 * The LevelConfig a God Tier run's current bay is actually played with.
 *
 * Mirrors run.ts's levelForRun layer for layer, and the ORDER is the same
 * order for the same stated reason — each layer is the conditions the one
 * below it is flown in:
 *
 *   ladder at Mark 10  ->  the SHIP (upgrades)  ->  ratchets  ->  the day's
 *   boss clause  ->  the day's quota  ->  the ration  ->  the carry
 *
 * The day's notches are merged INTO the player's before applyRatchets rather
 * than applied as a second pass, and that is not a shortcut: hazards.ts prices
 * its cost and time axes on a Fibonacci ladder whose nth rung depends on how
 * deep the axis already is, so two separate one-notch passes would both charge
 * rung one and a day's notch would be permanently cheaper than a player's.
 * Summing the counts is the only reading that prices them as what they are —
 * notches on the same axis.
 *
 * The boss goes on before the quota so a clause that scales a target scales
 * the LADDER's target rather than the day's surcharge, which keeps a boss
 * costing the same on a quota bay as anywhere else.
 */
export function levelForGod(run: RunState, day: GodRun): LevelConfig {
  const bay = day.bays[Math.max(0, Math.min(day.bays.length - 1, run.levelIndex))];
  const base = makeBaseLevel(run.levelIndex, GOD_MARK);
  applyUpgrades(base, run.tiers);

  const merged: Ratchets = { ...run.ratchets };
  for (const [id, n] of Object.entries(bay.ratchets)) {
    merged[id as HazardId] = (merged[id as HazardId] ?? 0) + (n ?? 0);
  }
  const cfg = applyRatchets(base, merged);

  // finals.ts's own applyFinal rather than def.apply, deliberately: the
  // material-mix cap it re-enforces afterwards is what stops a clause that
  // raises a material from blowing past MIX_TOTAL_CAP on a bay the day has
  // already loaded with content notches. It is also total — an id this build
  // no longer carries is a no-op, the same tolerance a stale saved clause
  // already gets.
  if (bay.boss) applyFinal(cfg, bay.boss);
  cfg.targetScore += bay.quota;
  // A RATIONED bay trades the clock for launches. Written AFTER the ratchets,
  // and that ordering is load-bearing: hazards.ts's Shift Cut floors
  // timeLimitSec at 45 rather than letting it reach zero, so a clock lifted
  // before the ratchets ran would be handed straight back at 45 seconds by any
  // day that also spent a notch on time. The launch budget goes on in the same
  // breath so the two can never be set apart — a clockless bay with no budget
  // is a bay that cannot end.
  if (bay.launchBudget > 0) {
    cfg.launchBudget = bay.launchBudget;
    cfg.timeLimitSec = 0;
  }
  if (run.levelIndex > 0) cfg.startingFunds = cfg.startingFunds + run.carry;
  cfg.bondBreakerCharges = Math.max(0, run.bondCharges);
  return cfg;
}

/* -------------------------------------------------------------------------
 * THE ATTEMPT LEDGER
 *
 * What a player has spent on today, and what they have standing from every
 * day before it. Lives on MetaState (meta.ts's GodRecord) because it outlives
 * a run and a session both; the rules live here because they are about the
 * day, not about the save.
 * ---------------------------------------------------------------------- */

export interface GodRecord {
  /** The day `attempts`/`todayBest` refer to (a dailySeed), or 0 when the
   *  player has never flown one. Compared rather than cleared on a rollover:
   *  a stale day simply doesn't match, which is one less thing that has to
   *  happen at midnight for the ledger to be right. */
  day: number;
  /** Ranked attempts spent on `day`. */
  attempts: number;
  /** Best finalRunScore posted on `day`. */
  todayBest: number;
  /** Days flown, ever. */
  days: number;
  /** Consecutive days flown, counting back from `day`. A streak loses a
   *  NUMBER when a day is missed and never an entitlement or a currency —
   *  which is what separates it from a retention mechanic that punishes. */
  streak: number;
  /** All-time best score and deepest bay across every God Tier day. */
  best: number;
  bestBay: number;
}

export function newGodRecord(): GodRecord {
  return { day: 0, attempts: 0, todayBest: 0, days: 0, streak: 0, best: 0, bestBay: 0 };
}

/** Ranked attempts left on `seed`. A day the ledger has never seen is a full
 *  purse; the count only ever decrements within one day. */
export function godAttemptsLeft(rec: GodRecord, seed: number = dailySeed()): number {
  if (rec.day !== seed) return GOD_ATTEMPTS;
  return Math.max(0, GOD_ATTEMPTS - rec.attempts);
}

/** Record one finished God Tier attempt. Pure; returns a new record.
 *
 *  Spending an attempt is what a FINISHED run does, win or lose — a God Tier
 *  day is meant to be lost, and a cap that only counted wins would be no cap
 *  at all. The streak advances on the first attempt of a day and is unmoved by
 *  the second and third, so playing three times is not three days of standing.
 */
export function recordGodAttempt(
  rec: GodRecord,
  seed: number,
  score: number,
  bayReached: number,
): GodRecord {
  const fresh = rec.day !== seed;
  const gap = fresh && rec.day > 0 ? godDayIndex(seed) - godDayIndex(rec.day) : 0;
  return {
    day: seed,
    attempts: (fresh ? 0 : rec.attempts) + 1,
    todayBest: Math.max(fresh ? 0 : rec.todayBest, score),
    days: rec.days + (fresh ? 1 : 0),
    // Exactly one day since the last one flown continues the streak; anything
    // else starts a new one at 1. Guarded on `fresh` so three attempts today
    // is a streak of one, not three.
    streak: fresh ? (gap === 1 ? rec.streak + 1 : 1) : rec.streak,
    best: Math.max(rec.best, score),
    bestBay: Math.max(rec.bestBay, Math.max(0, Math.floor(bayReached))),
  };
}
