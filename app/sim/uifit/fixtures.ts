/**
 * One deterministic fixture per screen.
 *
 * These call the REAL screen functions from src/ui/screens.ts with the same
 * shapes main.ts's renderOverlay passes them, so the harness measures the
 * markup the app actually ships rather than a hand-written stand-in. Where a
 * screen takes generated data (hazard offers, the Contract board) the fixture
 * calls the real generator with a fixed seed — same reason.
 *
 * Fixtures are deliberately WORST-CASE within what the game can produce: four
 * digits of funds, a full drafted-mod row, every optional chip present. A
 * screen that fits its emptiest state and overflows its fullest one is a screen
 * that overflows.
 */
import * as S from "../../src/ui/screens";
import { sandboxScreen } from "../../src/ui/sandbox-screen";
import { cheatRowHTML } from "../../src/lib/sandbox-cheats";
import { newSandbox, type SandboxState } from "../../src/game/sandbox";
import { BOARD_SANDBOX, type ScoreEntry } from "../../src/lib/api";
import type { Settings } from "../../src/lib/store";
import type { PieceType } from "../../src/game/theme";
import { makeBaseLevel } from "../../src/game/level";

/** Tier 1's first bay — the numbers a fixture should show, now that the tier
 *  ladder means "the bay" is a function of the Mark being flown (level.ts).
 *  Was the BAY_1 alias, which could only ever describe one tier. */
const BAY_1 = makeBaseLevel(0);
import { newMeta, tierProgressFor, type MetaState } from "../../src/game/meta";
import { hazardOffers, type HazardId, type Ratchets } from "../../src/game/hazards";
import { MARK_COUNT, MAX_TIER, newTiers, type RefitOrder, type UpgradeTiers } from "../../src/game/upgrades";
import { previewRows } from "../../src/game/preview";
import { finalsForTier } from "../../src/game/finals";
import { buyUpgrades, levelForRun, newRun, RUN_LEVELS } from "../../src/game/run";
import {
  CLAUSE_STOPS, clauseDefs, skydeckRulesFor, skydeckRunFor,
} from "../../src/game/skydeck";
import { dailyContracts } from "../../src/game/contracts";
import { DRILLS } from "../../src/game/drills";
import { GUIDE_TOPICS, type GuideTopic } from "../../src/game/guide";

/** The catalogue row with the most copy among those `pick` accepts — the pane's
 *  real worst case, asked of the data instead of hardcoded. Tags are stripped
 *  first: `<b>` costs the pane nothing, and counting it would rank a
 *  number-heavy topic above a genuinely longer one. */
function longestTopic(pick: (t: GuideTopic) => boolean): GuideTopic {
  return GUIDE_TOPICS.filter(pick).reduce((a, b) =>
    b.body.replace(/<[^>]+>/g, "").length > a.body.replace(/<[^>]+>/g, "").length ? b : a,
  );
}

const ENTRIES: ScoreEntry[] = Array.from({ length: 24 }, (_, i) => ({
  // A long name is the wide case for the row's flexible column.
  name: i === 3 ? "LONGESTNAME" : `PILOT${i + 1}`,
  score: 98_760 - i * 1_137,
  // One Tier's board, which is what the screen shows: every row on a board is
  // by definition the same Tier, so varying it here would measure a list the
  // app cannot produce.
  mark: 7,
  level: 10 - (i % 10),
  lines: 240 - i * 7,
  created_at: 1_760_000_000 + i,
}));

const SETTINGS: Settings = {
  sound: true, music: true, haptics: true, seenDragHint: true, seenTutorial: true, seenKeyHints: true,
  leftHandRail: false, stickAssist: true, stickSling: false, wheelRotates: false, devMode: false,
};

const STORE = { available: true, unlimited: false };

/** A FIXED Skydeck day.
 *
 *  Everything about the mode is a function of the date (game/skydeck.ts), and a
 *  fixture that read the clock would measure a different screen every morning —
 *  which is fine in the app and useless in a harness whose whole output is a
 *  budget compared against a baseline. One day, chosen and pinned, exactly the
 *  way every other fixture pins its seed. */
const SKY_DAY = new Date(Date.UTC(2026, 7, 27));
/** …and the three rows it puts on the menu's recap panel. Built through the
 *  same call main.ts makes, so the fixture cannot drift from the app. */
const SKY_RULES = clauseDefs(skydeckRulesFor(SKY_DAY)).map((c) => ({ bay: c.bay, name: c.def.name }));
/** Every Mark sealed — what the roof now costs (meta.ts's skydeckOpen), and
 *  therefore what any fixture drawing an OPEN Skydeck has to hold. A roof open
 *  over unsealed floors is a state the app can no longer produce, and a fixture
 *  measuring one would be measuring a screen nobody sees. */
const ALL_SEALED = Array.from({ length: MARK_COUNT }, (_, i) => i + 1);
/** The tower with the roof OPEN and the car parked on it — the one state that
 *  renders the clause list. */
const SKY_TOWER: S.TowerState = {
  unlocked: MARK_COUNT, selected: S.SKYDECK_TIER, skydeck: true, contracts: 2,
  sealed: ALL_SEALED,
};

/** The bay-clear ratchet at a given tentative selection. Both sides of the
 *  projection come from levelForRun, exactly as main.ts builds them, so the
 *  harness measures the real number of rows the screen can grow. */
function draft(selected: HazardId[]): string {
  const run = { ...newRun(20_260_815, [], 400, undefined, 6), levelIndex: 6, carry: 120, scrap: 340 };
  const withPicks: Ratchets = { ...HUD_BASE.ratchets };
  for (const id of selected) withPicks[id] = (withPicks[id] ?? 0) + 1;
  return S.draftScreen({
    bayNum: 6,
    tier: 6,
    funds: 1_820,
    carry: 120,
    offers: hazardOffers(20_260_815, 6, 6),
    ratchets: HUD_BASE.ratchets,
    selected,
    picksNeeded: 2,
    // HUD_BASE's four banked axes make this the widest projection the screen
    // can produce: every one of their rows is pinned ACTIVE (Codex #1), so a
    // draft that fits this fixture fits the tallest honest state.
    preview: previewRows(
      levelForRun({ ...run, ratchets: HUD_BASE.ratchets }),
      levelForRun({ ...run, ratchets: withPicks }),
      HUD_BASE.ratchets,
    ),
    scrap: 340,
    baysToRefit: 2,
  });
}

/** The SKYDECK's draft (game/skydeck.ts) — the ratchet screen the daily run
 *  actually shows.
 *
 *  Two things about it are not reachable through `draft` above and both can
 *  overflow: the bank's third cell counts CLAUSES instead of scrap (a longer
 *  label than "Scrap · refit in 2"), and the projection is drawn on a bay that
 *  already carries standing clauses, so more of its rows are pinned than a
 *  ladder bay's at the same notch count.
 *
 *  Bay 7, the second stop, deliberately: it is the one draft where a clause has
 *  just armed AND another is still coming, so the cell carries its longest
 *  copy. A FIXED day (2026-08-27) rather than today's, because a fixture that
 *  re-rolled its own clauses every morning would make this harness's budget a
 *  function of the calendar — see screens.ts's skydeckRulesHTML.
 */
function skydeckDraft(selected: HazardId[]): string {
  const run = { ...skydeckRunFor(newTiers(), [], SKY_DAY), levelIndex: 6, carry: 120 };
  const withPicks: Ratchets = { ...HUD_BASE.ratchets };
  for (const id of selected) withPicks[id] = (withPicks[id] ?? 0) + 1;
  return S.draftScreen({
    bayNum: 6,
    tier: run.mark,
    funds: 1_820,
    carry: 120,
    offers: hazardOffers(run.seed, 6, run.mark, undefined, HUD_BASE.ratchets),
    ratchets: HUD_BASE.ratchets,
    selected,
    picksNeeded: 1,
    preview: previewRows(
      levelForRun({ ...run, ratchets: HUD_BASE.ratchets }),
      levelForRun({ ...run, ratchets: withPicks }),
      HUD_BASE.ratchets,
    ),
    scrap: 0,
    baysToRefit: null,
    standing: { active: 2, total: CLAUSE_STOPS.length, nextBay: RUN_LEVELS },
  });
}

/**
 * The FORCED-MATERIAL ratchet (hazards.ts's MATERIAL_DRAFT_BAYS) at Tier 10 —
 * the draft's worst case for the CARD TITLE, which is a different worst case
 * from `draft()`'s and needs its own fixture.
 *
 * Every material axis is named "<Substance> Contract", and the substances run
 * to eight letters, so a materials-only hand is the only hand that can deal
 * TWO seventeen-character names at once. The ordinary hand cannot: it deals at
 * most one content card, and the number axes are all short ("Fuel Levy",
 * "Shift Cut"). A player's report is what found this — on a 792x360 phone the
 * two cards sit side by side, and "Volatile Contract" was rendering as
 * "Volatile Contrac" with the tail clipped away.
 *
 * Seed 25 rather than the file's usual 20_260_815, asked of the generator
 * rather than asserted: it is the lowest seed whose bay-8 hand at Tier 10 is
 * Volatile + Magnetic, the two longest names in HAZARDS. Bay 8 because
 * MATERIAL_DRAFT_BAYS forces one there, and Tier 10 because `forced` only
 * matters where picksPerBay is 2 — the partner card is capped at one seat, so
 * its footer says "undo" where the material's says "double".
 *
 * This does NOT replace `draft()`, which is the worst case for the PROJECTION
 * (four banked axes, every row pinned ACTIVE) and stays the fixture that
 * measures the modal's height. Two different worst cases, two fixtures.
 *
 * Nor does the Skydeck one above replace it, and the three are worth reading
 * as a set: `draft` is the tallest projection, `materialDraft` the longest
 * titles, `skydeckDraft` the widest bank label on a clause-loaded bay. A
 * forced-material Skydeck hand is a real state and is deliberately NOT a fourth
 * fixture — its cards are this fixture's, at one pick instead of two, so the
 * title row it measures is already measured here.
 */
function materialDraft(selected: HazardId[]): string {
  const SEED = 25;
  const LEVEL_INDEX = 7;
  const run = { ...newRun(SEED, [], 400, undefined, 10), levelIndex: LEVEL_INDEX, carry: 120, scrap: 340 };
  const withPicks: Ratchets = { ...HUD_BASE.ratchets };
  for (const id of selected) withPicks[id] = (withPicks[id] ?? 0) + 1;
  return S.draftScreen({
    bayNum: LEVEL_INDEX + 1,
    tier: 10,
    funds: 1_820,
    carry: 120,
    offers: hazardOffers(SEED, LEVEL_INDEX, 10, 2, HUD_BASE.ratchets),
    ratchets: HUD_BASE.ratchets,
    selected,
    picksNeeded: 2,
    preview: previewRows(
      levelForRun({ ...run, ratchets: HUD_BASE.ratchets }),
      levelForRun({ ...run, ratchets: withPicks }),
      HUD_BASE.ratchets,
    ),
    scrap: 340,
    baysToRefit: 1,
    forced: true,
  });
}

/** The FINAL INSPECTION (game/finals.ts) — the run's last draft.
 *
 *  Tier 10 deliberately: its clauses carry the longest copy in the table and
 *  its projection is the widest the screen can produce, because Odd Lots
 *  moves every material row at once on a bay that already has four banked
 *  axes pinned ACTIVE. A screen that fits this fits every other Tier's.
 */
function inspection(selected: string | null): string {
  const run = {
    ...newRun(20_260_815, [], 400, undefined, 10),
    levelIndex: RUN_LEVELS - 1,
    carry: 120,
    scrap: 340,
    ratchets: HUD_BASE.ratchets,
  };
  return S.finalScreen({
    bayNum: 9,
    tier: 10,
    funds: 1_820,
    carry: 120,
    offers: finalsForTier(10),
    selected,
    preview: previewRows(
      levelForRun(run),
      levelForRun({ ...run, final: selected as never }),
      HUD_BASE.ratchets,
    ),
    scrap: 340,
  });
}

/** The refit yard at a given staged order. `buyUpgrades` builds the "after"
 *  side exactly as main.ts's refitHTML does — the same call Undock makes — so
 *  the harness measures the real number of projection rows an order can grow
 *  rather than a hand-written guess at them. */
function refit(order: RefitOrder): string {
  const run = {
    ...newRun(20_260_815, [], 400, HUD_BASE.tiers as UpgradeTiers, 6),
    levelIndex: 6,
    carry: 120,
    scrap: 340,
    ratchets: HUD_BASE.ratchets,
  };
  return S.refitScreen({
    bayNum: 6,
    nextBayName: "Cryo Vault",
    scrap: run.scrap,
    tiers: run.tiers,
    mark: 6,
    order,
    // No banked ratchets — main.ts's refitHTML passes none, and the reason it
    // does is a layout one, so a fixture that passed them would measure a
    // screen the app never renders.
    preview: previewRows(levelForRun(run), levelForRun(buyUpgrades(run, order, MAX_TIER) ?? run)),
  });
}

/** A mid-run meta: salvage banked, some unlocks owned, so the Workshop renders
 *  its owned strip as well as its grid (the taller of the two states). */
function midMeta(): MetaState {
  const m = newMeta();
  m.salvage = 1_480;
  m.runs = 37;
  m.bestBay = 8;
  return m;
}

/**
 * A PROGRESSED save, which midMeta above is not: it is `newMeta()` with three
 * numbers written on it, so the ✓ Installed and ✓ Owned strips — the only part
 * of the Workshop that GROWS with the save — were empty in the one fixture
 * measuring that screen, and never measured at all. Adding this immediately
 * caught them overflowing the fixed aside they used to live in, on nine of the
 * thirteen devices; they render in the scroller now.
 *
 * Five systems installed at mixed tiers (the long strip), one option owned, two
 * systems still on the shelf. Mark 3 beaten, so nothing is gated by tier and
 * the remaining cards render their price rather than their "Needs Tier N" line
 * — the gated case is midMeta's, at Mark 0. Loadout costs 135 of Mark 4's 308
 * budget, i.e. a legal one (upgrades.ts's loadoutLegal), because an
 * over-budget readout is a bug report rather than a layout case.
 */
function ownedMeta(): MetaState {
  const m = newMeta();
  m.salvage = 240;
  m.runs = 52;
  m.bestBay = 10;
  m.mark = 3;
  m.unlocks = ["survey"];
  m.loadout = { ...m.loadout, reactor: 2, launcher: 1, magazine: 1, bay: 1, hydraulics: 1 };
  return m;
}

/** Four digits of funds against a four-digit target — the readout width that
 *  regressed before (see sim/systems.ts's "$1000+ wrap regression"). */
const HUD_BASE = {
  beltPreview: { bomb: false, type: "T" as PieceType, quarterTurns: 1, empty: false, hidden: false, material: "cryo" as const },
  // The transport's held slot (canvas A5's two-deep queue) — a bulk-adjacent
  // wide piece so the muzzle-end tile is measured at its fattest.
  loaded: { bomb: false, type: "I" as PieceType, quarterTurns: 1, empty: false, hidden: false, material: "slag" as const },
  tier: 6,
  target: 1_700,
  score: 1_259,
  launchCost: 25,
  bayNum: 7,
  timeLimitSec: 150,
  timeLeftMs: 127_000,
  pieceSize: "std" as const,
  bondBreakerOwned: true,
  bondCharges: 2,
  demoOwned: true,
  autoloaderOwned: true,
  bombCharges: 3,
  // NO LANCE HERE, and it is a deliberate omission rather than an oversight.
  // Turning it on would re-measure all nineteen rows of every screen built on
  // this object for a state the app cannot produce: HUD_BASE already carries
  // the AUTOLOADER, and nothing in a shipped run writes level.autoLaunchMs any
  // more (mods.ts is the only writer, and the ratchet draft replaced the mod
  // draft), so bond + demo + auto is legacy chrome kept for its WIDTH. Adding
  // a fourth ability on top of a third that cannot occur measures a rail no
  // player will ever hold. The reachable worst case gets its own screen
  // instead — see `hud-lance`, which is the same seven-slot rail with the
  // legacy trigger swapped for the real one.
  thawOwned: false,
  thawCharges: 0,
  // A full run's pick history — the mods row is the plant panel's widest child.
  // Typed, because `spill` and `drift` were sitting here: ids no HazardId ever
  // had, so two of the four chips the "widest child" is supposed to be measured
  // at were never rendered. Ratchets is a weak type, so the pair typechecked.
  ratchets: { wind: 2, sweeper: 1, cryo: 1, slag: 2 } as Ratchets,
  tiers: { bay: 2, launcher: 1, hydraulics: 3, magazine: 1, reactor: 2, bonds: 1, demolition: 0, thaw: 0 },
};

const PROGRESS = tierProgressFor(midMeta());

/** Tier S set to the WIDEST bay it can describe: the capstone Mark (every
 *  hazard axis open, so the axis row is at its longest), the last bay, a maxed
 *  rig, the material parade, and four axes already notched. Every one of those
 *  is the state that makes some row on that screen as long as it can get. */
const SANDBOX_BAY: SandboxState = {
  ...newSandbox(),
  tier: MARK_COUNT,
  target: { kind: "bay", bay: RUN_LEVELS },
  tiers: { bay: 3, launcher: 3, hydraulics: 3, magazine: 3, reactor: 3, bonds: 3, demolition: 3, thaw: 3 },
  material: "all",
  ratchets: { wind: 3, sweeper: 2, cryo: 1, slag: 3 } as Ratchets,
};

/** The Contract half, at the tier where the variant row is longest: tier 8
 *  offers six unlocked variants and greys "Guided · t9", which is the widest
 *  that row gets (a locked chip carries its rung as well as its name). */
const SANDBOX_CONTRACT: SandboxState = {
  ...newSandbox(),
  tier: 8,
  target: { kind: "pattern", variant: "blind" },
};

/** The tower with the whole ladder beaten and the car on the Skydeck — the
 *  state every string in the base-bay panel is longest in. midMeta is a Mark-0
 *  save, so this is the only fixture that reaches it.
 *
 *  FULLY SEALED, which includes Mark 10 and that Mark specifically: the seal is
 *  stamped in the slack between the plate's number and its windows, and 10 is
 *  the only two-digit number the ladder has — i.e. the narrowest that slack
 *  ever gets. Without a stamp there the seal renders nowhere in the whole
 *  matrix and every "no new violations" run is measuring a floor that has no
 *  stamp on it.
 *
 *  It used to hold Mark 10 ALONE, which was the narrowest case and is no longer
 *  a state: the roof it draws open now costs every seal (meta.ts's
 *  skydeckOpen). The narrow case survives inside the full set; what is lost is
 *  a tower mixing stamps and empty sockets, and `menu`'s Tier-1 fallback tower
 *  draws sockets on every run of the matrix, so that half is still measured. */
const TOWER_TOP: S.TowerState = {
  unlocked: MARK_COUNT,
  selected: S.SKYDECK_TIER,
  skydeck: true,
  sealed: ALL_SEALED,
};

/** The same tower with Tier S open — the tallest the column ever gets, because
 *  the basement plate is drawn UNDER the base slab and raises the tower's own
 *  height cap by its height rather than taking it out of the shaft (see
 *  app.css's .tower--sub). Worth its own fixture precisely because it is the
 *  one change to this column that cannot be caught by measuring the shaft. */
const TOWER_SANDBOX: S.TowerState = { ...TOWER_TOP, sandbox: true };

/** The menu's first-session inputs (canvas A2/A3), mid-progression: the one
 *  NEXT STEP badge on Workshop (salvage covers an install) and the live
 *  numbers the subtitles state the offer in. */
const GUIDE = {
  step: "workshop" as const,
  install: { name: "Loader Magazine", cost: 25 },
  firstLaunch: false,
};

/** A first-bay HUD as the tutorial actually meets it: stock rig, no abilities,
 *  bay 1's real numbers (BAY_1). The coach only ever runs on bay 1 of a
 *  fresh player's Deep Run, so measuring it over HUD_BASE would price a rail
 *  and a mods row the first session cannot have. */
const HUD_TUTORIAL = {
  beltPreview: { bomb: false, type: "T" as PieceType, quarterTurns: 0, empty: false, hidden: false, material: "standard" as const },
  loaded: { bomb: false, type: "L" as PieceType, quarterTurns: 0, empty: false, hidden: false, material: "standard" as const },
  tier: 1,
  target: BAY_1.targetScore,
  score: BAY_1.startingFunds,
  launchCost: BAY_1.launchCost,
  bayNum: 1,
  timeLimitSec: BAY_1.timeLimitSec,
  timeLeftMs: BAY_1.timeLimitSec * 1000,
  pieceSize: "std" as const,
  bondBreakerOwned: false,
  bondCharges: 0,
  demoOwned: false,
  autoloaderOwned: false,
  bombCharges: 0,
  // A tutorial bay grants no systems at all, the lance included.
  thawOwned: false,
  thawCharges: 0,
  ratchets: {} as Ratchets,
  tiers: newTiers(),
};

/** main.ts's mountCoach puts the card INSIDE .plant as its first child, and
 *  syncCoachReveal stamps the step onto #hud as `data-coach` — the attribute
 *  the progressive-reveal CSS keys off. Reproduced as string edits so the
 *  harness measures the DOM the app actually shows mid-tutorial, not a
 *  sibling layout it never renders. */
const withCoach = (hud: string, step: number, coach: string): string =>
  hud
    .replace('<div class="hud" id="hud">', `<div class="hud" id="hud" data-coach="${step}">`)
    .replace('<div class="plant">', `<div class="plant">${coach}`);

/** main.ts adds `is-live` to .menu__demo once the attract demo is running on a
 *  real canvas. Applied here as a string edit rather than by mounting the demo:
 *  the class is the entire difference to LAYOUT, and running Matter.js in the
 *  harness would buy nothing but nondeterminism. */
const live = (html: string): string =>
  html.replace('class="menu__demo"', 'class="menu__demo is-live"');

/**
 * Screen id -> markup. Ids are stable: run.mjs, the PNG filenames and any
 * allowlist in the assertions all key off them.
 */
export const SCREENS: Record<string, () => string> = {
  splash: () => S.splashScreen(),

  // The menu has FOUR states that differ in height, and all four have to fit.
  //
  // `is-live` is added by main.ts once the attract demo mounts, which swaps the
  // brand column from a big wordmark + paragraph to a fixed 16:9 canvas — a
  // materially different height. The plain fixture is therefore the
  // reduced-motion / no-2D-context fallback, not an artificial state: it is what
  // a player with "reduce motion" on actually sees.
  menu: () => S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE),
  // THE ROOF PARKED. The recap panel grows a three-row clause list in its
  // extras slot and the primary button re-labels, on the menu column that is
  // already the screen's tightest — so this is the tallest that column gets in
  // any build. Fixed clauses (SKY_DAY) rather than today's: see skydeckDraft.
  "menu-skydeck": () =>
    S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, SKY_TOWER, SKY_RULES),
  "menu-skydeck-live": () =>
    live(S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, SKY_TOWER, SKY_RULES)),
  "menu-live": () => live(S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE)),
  // The entitled state swaps the upsell chip for the ★ badge; both have to fit.
  "menu-unlimited": () =>
    S.menuScreen(98_760, 1_480, { available: true, unlimited: true }, PROGRESS, GUIDE),
  "menu-unlimited-live": () =>
    live(S.menuScreen(98_760, 1_480, { available: true, unlimited: true }, PROGRESS, GUIDE)),
  // No store at all: `available: false` renders neither the upsell nor the
  // badge, so the status strip is three readouts instead of four rows. Every
  // other menu fixture sets `available: true`, which left this state — the one
  // the web build and every keyless APK actually shows, including the debug
  // APK this repo's own CI hands out — untested. It is not merely a shorter
  // menu: app.css sizes the demo panel off whether that row exists, so this is
  // the fixture that holds the larger panel's width honest.
  "menu-nostore": () =>
    S.menuScreen(98_760, 1_480, { available: false, unlimited: false }, PROGRESS, GUIDE),
  "menu-nostore-live": () =>
    live(S.menuScreen(98_760, 1_480, { available: false, unlimited: false }, PROGRESS, GUIDE)),
  // The tier tower at the TOP of the ladder, which is the widest every string
  // on the base-bay panel gets: "Skydeck · Base bay" for the eyebrow, "×1.9 ∞"
  // for the bond multiplier (UNBREAKABLE_MARK's capstone), and "6/6 · 2 picks"
  // for the belt count (all six materials dealt, and CAPSTONE_MARK's second
  // ratchet). PROGRESS above is a Mark-0 save, so every other menu fixture
  // measures the panel at Tier 1 — where the belt is empty and the bonds read
  // "×1.0" — and would never have caught the top of the ladder overflowing.
  "menu-tower-top": () =>
    S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, TOWER_TOP),
  "menu-tower-top-live": () =>
    live(S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, TOWER_TOP)),
  // Tier S open: the tower grows a basement plate under its slab, so the menu's
  // centre column is taller than any other fixture makes it. Paired live and
  // not, like every other menu state, because the brand column's height is what
  // the row is measured against.
  "menu-tier-s": () =>
    S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, TOWER_SANDBOX),
  "menu-tier-s-live": () =>
    live(S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, TOWER_SANDBOX)),
  // A2's first launch: the SEVENTH action row (Guided Tutorial, badged) plus
  // the upsell chip — the tallest menu the app can produce, which is exactly
  // why it is its own fixture.
  "menu-first": () =>
    S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "contracts",
      install: { name: "Reactor Output", cost: 15 },
      firstLaunch: true,
    }),

  // THE GUIDE (How to Play). Seven fixtures, because the pane has seven shapes
  // and the screen it replaces had ONE fixture — a single argument-less call —
  // which is how a horizontal card row shipped for months clipping its own copy
  // on every device in this matrix with every assertion green.
  //
  //   guide            a new save on the FIRST topic: the CTA foot (Guided
  //                    Tutorial, no drill), and every material row locked.
  //   guide-drill      an unlocked drill's foot — the two-line brief plus the
  //                    Run affordance.
  //   guide-locked     the same card gated, which renders a DIFFERENT foot and
  //                    adds a tier badge to the pane header. On a material
  //                    topic, since that is where the gate actually bites.
  //   guide-art        the widest art strip the screen can produce (seven shape
  //                    tiles) under a body.
  //   guide-rig        the deepest chapter — ten rows, so the index really
  //                    scrolls — on a PROGRESSED save, where the tab counts are
  //                    non-zero and nothing is gated.
  //   guide-worst      the tallest pane the catalogue can build, computed.
  //   guide-worst-art  the same, among the topics that also carry art.
  guide: () => S.guideScreen({ chapter: "basics", topicId: "tutorial", meta: newMeta() }),
  // THE WORST CASE, computed rather than named. The pane's budget is spent by
  // the BODY, and which topic has the longest one changes every time a
  // paragraph is edited — so pinning a topic id here would measure whichever
  // row happened to be longest the day the fixture was written. These two ask
  // the catalogue: the longest body outright, and the longest body that also
  // carries the art strip (the strip is ~34px of the pane, so it is a
  // materially tighter budget and a different worst case).
  "guide-worst": () => {
    const t = longestTopic(() => true);
    return S.guideScreen({ chapter: t.chapter, topicId: t.id, meta: ownedMeta() });
  },
  "guide-worst-art": () => {
    const t = longestTopic((x) => !!x.material || x.id === "sizes" || x.id === "rotate");
    return S.guideScreen({ chapter: t.chapter, topicId: t.id, meta: ownedMeta() });
  },
  "guide-drill": () =>
    S.guideScreen({ chapter: "basics", topicId: "topout", meta: newMeta() }),
  "guide-locked": () =>
    S.guideScreen({ chapter: "cargo", topicId: "mat-magnetic", meta: newMeta() }),
  "guide-art": () =>
    S.guideScreen({ chapter: "basics", topicId: "rotate", meta: newMeta() }),
  "guide-rig": () => S.guideScreen({ chapter: "rig", topicId: "sys-bonds", meta: ownedMeta() }),

  // The drill result, both verdicts. The LOSS card is the tall one: it repeats
  // the drill's brief where the win card states one short line.
  //
  // The modal alone, no HUD behind it — the same shape the `contract-end`
  // fixture takes. main.ts does mount both together, but the HUD is measured by
  // its own fixtures at every rail configuration, and stacking HUD_BASE's
  // four-ability rail under a modal measures the rail's slot count rather than
  // the card.
  "drill-end-won": () =>
    S.drillEndModal({
      won: true, name: "Cold Chain", topic: "Cryo", lines: 2, goal: 2,
      shotsUsed: 14, launches: 20,
      brief: DRILLS["mat-cryo"].brief,
    }),
  "drill-end-lost": () =>
    S.drillEndModal({
      won: false, name: "Cold Chain", topic: "Cryo", lines: 1, goal: 2,
      shotsUsed: 20, launches: 20,
      brief: DRILLS["mat-cryo"].brief,
    }),
  settings: () => S.settingsScreen(SETTINGS, STORE),
  // The Controls screen (canvas D1), one fixture per family: the keyboard tab
  // in its capture state (the widest row copy), the gamepad tab with a real
  // pad id detected (the longest Detected line).
  "controls-touch": () =>
    S.controlsScreen({ tab: "touch", settings: SETTINGS, padName: null, rebinding: null }),
  // The guide's door into the same screen. Its eyebrow and back target differ,
  // and "How to Play" is the wider of the two eyebrows — measured because the
  // header is the one row on this screen with no slack.
  "controls-from-guide": () =>
    S.controlsScreen({
      tab: "touch", settings: SETTINGS, padName: null, rebinding: null, back: "howto",
    }),
  "controls-keyboard": () =>
    S.controlsScreen({ tab: "keyboard", settings: SETTINGS, padName: null, rebinding: "fire" }),
  "controls-gamepad": () =>
    S.controlsScreen({
      tab: "gamepad",
      settings: SETTINGS,
      // The longest id seen in the field, not a representative one: a pad's
      // `Gamepad.id` is whatever the driver reports, and the DualSense's runs
      // six characters past the Xbox pad's. This row renders the widest string
      // the Controls screen ever shows, so the fixture carries the worst case.
      padName: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
      rebinding: null,
    }),
  leaderboard: () => S.leaderboardScreen(S.leaderboardRowsHTML(S.fullBoard(ENTRIES), "PILOT4")),
  // The two-board state: the tab strip only exists once Tier S is open, and it
  // takes a row off the board's own height, so both boards get a fixture.
  "leaderboard-tabs": () =>
    S.leaderboardScreen(S.leaderboardRowsHTML(S.fullBoard(ENTRIES), "PILOT4"),
      { board: 7, tier: 7, sandbox: true }),
  "leaderboard-sandbox": () =>
    S.leaderboardScreen(S.leaderboardRowsHTML(S.fullBoard(ENTRIES), "PILOT4"),
      { board: BOARD_SANDBOX, sandbox: true }),

  // TWO fixtures, because the screen has two shapes and only one of them was
  // ever measured. `workshop` is the early save: nothing owned, so there are no
  // strips and most of the shelf wears a "Needs Tier N" gate. `workshop-owned`
  // is a Mark-3 save, where the shelf is down to its last cards and carries
  // both ownership strips at its foot. One shelf in both — the Systems/Options
  // tabs are gone and both card kinds render together.
  workshop: () => S.workshopScreen(midMeta()),
  "workshop-owned": () => S.workshopScreen(ownedMeta()),

  contracts: () =>
    S.contractsScreen({
      contracts: dailyContracts(3, 20_260_815),
      tier: 3,
      cleared: [],
      progress: PROGRESS,
      // The WHY strip's longest state (A9): a named install and its price.
      nextInstall: { name: "Press Hydraulics", cost: 30 },
    }),

  hud: () => S.hudHTML({ ...HUD_BASE, contract: null }),
  // A STOCK RIG at the top of a run: nothing installed, nothing ratcheted, no
  // abilities. This is the state the build rack's fixed slots exist for — it
  // used to render as an empty row, so the one moment the harness measured
  // (HUD_BASE, six of the eight tracks bought) told it nothing about the moment
  // every run actually starts in. The rack is at its WIDEST here in slot terms
  // and its emptiest in content, which is exactly the pair worth asserting.
  "hud-stock": () =>
    S.hudHTML({
      ...HUD_BASE,
      contract: null,
      tier: 1,
      bayNum: 1,
      score: 200,
      target: 800,
      bondBreakerOwned: false,
      bondCharges: 0,
      demoOwned: false,
      autoloaderOwned: false,
      bombCharges: 0,
      ratchets: {} as Ratchets,
      tiers: newTiers(),
    }),
  // THE LANCE'S OWN SCREEN, and the reachable ability worst case.
  //
  // HUD_BASE's three abilities are bond + demo + AUTOLOADER, and the third has
  // had no writer since the mod draft was replaced (mods.ts is the only thing
  // that sets level.autoLaunchMs; hazards.ts deals notches now). So the widest
  // rail the harness measured was one no run can build. This is the widest one
  // a run CAN build: the two consumables a Deep Run really carries, plus the
  // Thaw Lance, at the four-digit charge-count-free state both badges render
  // in. Same seven slots, so the column arithmetic the 360dp phone lives on
  // (7x44 + 6x6 + 16 = 360) is unchanged and still exact.
  //
  // What is new here and nowhere else: the lance's chip in the plant's ability
  // row (a third 88px chip on the row that already leads with a vertical BUILD
  // tag and two of them) and its rail button with the charge badge. Both are
  // the states syncHud patches every frame, so a fixture that never rendered
  // them would leave the app's third ability trigger unmeasured on all
  // nineteen rows.
  "hud-lance": () =>
    S.hudHTML({
      ...HUD_BASE,
      contract: null,
      autoloaderOwned: false,
      thawOwned: true,
      // Two digits, which is what a maxed rack shows for most of a bay and the
      // wider of the two badge states — THAW_CHARGES_PER_TIER x MAX_TIER is 6,
      // so a live badge never exceeds one digit today; 12 measures the badge at
      // a width a re-tuned notch size could actually produce rather than at
      // today's exact ceiling.
      thawCharges: 12,
      tiers: { ...HUD_BASE.tiers, thaw: 2 },
    }),
  // The HUD as every bay PAST the first shot mounts it (main.ts's
  // armKeyHints): the hint strip faded, the bay floor clear. The strip's
  // shown-state geometry is measured by every other HUD fixture; this one
  // pins the mount-time dismissed path — the state the strip's transience
  // exists to produce — through the real hudHTML plumbing rather than a
  // class toggled in the harness.
  "hud-hints-dismissed": () => S.hudHTML({ ...HUD_BASE, contract: null, hintsDismissed: true }),
  // Five figures against a four-figure target. A Reactor build carrying
  // overshoot between bays reaches this, and it is the widest the funds readout
  // can get — the case sim/systems.ts's width budget flags as short of slack.
  "hud-rich": () => S.hudHTML({ ...HUD_BASE, score: 24_680, target: 2_150, contract: null }),
  // A Contract carries NO ratchets — main.ts's startContract nulls the run,
  // and the axes live on the run — so this inherited HUD_BASE's four of them
  // and measured a state the app cannot produce. With the notch line rendering
  // only in Deep Run that would now be invisible rather than merely wrong,
  // which is the kind of fixture drift worth killing at the source.
  // The notch line at its WIDEST honest state: every axis a Mark 10 run can
  // deal, some of them stacked. One notch per bay over ten bays is the cap, so
  // this is the deepest run's line and the case that decides whether the row
  // scrolls its tail (see components.ts's runNotchTallyHTML).
  "hud-notched": () =>
    S.hudHTML({
      ...HUD_BASE,
      contract: null,
      ratchets: {
        cost: 2, time: 1, wind: 2, sweeper: 1,
        cryo: 1, rebar: 1, slag: 1, volatile: 1,
      } as Ratchets,
    }),

  "hud-contract": () =>
    S.hudHTML({
      ...HUD_BASE,
      ratchets: {} as Ratchets,
      // Same reason the ratchets above are empty: main.ts's hudOpts hands a
      // Contract `tiers: {}` unconditionally, because ship upgrades are a Deep
      // Run's to carry. Inheriting HUD_BASE's six bought tracks measured a
      // state the app cannot produce — and now that the rack does not render in
      // a Contract at all, it would have measured nothing while claiming to.
      //
      // The identical trap caught the five fields below. levelForContract
      // (contracts.ts) builds off makeBaseLevel and never writes
      // bondBreakerCharges, bombCharges or autoLaunchMs, so they stay at
      // makeBaseLevel's literal 0 for every Contract; Game's constructor
      // copies them straight through (`this.bondCharges = level.
      // bondBreakerCharges`, `this.bombCharges = level.bombCharges`), and
      // hudOpts derives bondBreakerOwned/demoOwned/autoloaderOwned from
      // exactly those zeros (g.bondCharges > 0, g.level.bombCharges > 0,
      // g.level.autoLaunchMs > 0 — all false). Inheriting HUD_BASE's
      // true/2/true/true/3 measured a build no Contract can carry: with
      // `plates` already "" (screens.ts, contract mode never renders the
      // rack), bondChip and demoChip were the only things keeping `plates ||
      // bondChip || demoChip` truthy, so `.pl-mods` rendered a row the real
      // app never shows on a Contract screen. Silent on all 10 compact
      // devices, where `.hud--contract .pl-mods` is `display: none`
      // regardless (app.css) — but real on the three roomy tablets, where
      // nothing hides it, and it was the entire `plant`/`draghint` overflow.
      tiers: {} as UpgradeTiers,
      bondBreakerOwned: false,
      bondCharges: 0,
      demoOwned: false,
      autoloaderOwned: false,
      bombCharges: 0,
      // ...and the lance, which levelForContract cannot grant either: it never
      // calls applyUpgrades, so level.thawCharges stays at makeBaseLevel's 0
      // and hudOpts derives thawOwned from exactly that zero. Stated rather
      // than inherited, so this list stays the full account of what a Contract
      // does not carry.
      thawOwned: false,
      thawCharges: 0,
      timeLimitSec: 0,
      contract: {
        name: "Cold Storage Backlog",
        kind: "pattern",
        tier: 1,
        goal: 4,
        lines: 1,
        launchesLeft: 6,
        remaining: ["I", "O", "T", "L", "J", "S"] as PieceType[],
        lost: 0,
        // The variant tail alone (contracts.ts's patternConditions) — the
        // shipment count is the Shipments column and the manifest row.
        conditions: "6 shapes, no waste",
        progress: PROGRESS,
      },
    }),

  // The OTHER Contract kind, and the SHORTEST state the plant panel has: a
  // lines Contract renders no manifest row, so the panel is readout, reload,
  // conditions and tier — four rows, in the restored footprint, with the
  // remainder as air at the bottom. Worth its own screen because it is the case
  // every height change here is aimed at. That template named a `queue`
  // area unconditionally and this kind renders nothing into it, so the panel
  // paid a row's share of the gap for an empty band; nothing in the harness
  // could see it, because a gap is not an overflow, a wrap or a clip. There is
  // no grid here any more, and this is what says so if one comes back.
  "hud-contract-lines": () =>
    S.hudHTML({
      ...HUD_BASE,
      ratchets: {} as Ratchets,
      tiers: {} as UpgradeTiers,
      // The ability flags go for the same reason as `tiers` above (see
      // hud-contract's comment): levelForContract never grants bond, demo or
      // autoloader charges, so all five stay at the zero/false a live
      // Contract actually renders with.
      bondBreakerOwned: false,
      bondCharges: 0,
      demoOwned: false,
      autoloaderOwned: false,
      bombCharges: 0,
      // ...and the lance, which levelForContract cannot grant either: it never
      // calls applyUpgrades, so level.thawCharges stays at makeBaseLevel's 0
      // and hudOpts derives thawOwned from exactly that zero. Stated rather
      // than inherited, so this list stays the full account of what a Contract
      // does not carry.
      thawOwned: false,
      thawCharges: 0,
      timeLimitSec: 0,
      contract: {
        name: "Foundry Overrun",
        kind: "lines",
        tier: 1,
        goal: 5,
        lines: 2,
        launchesLeft: 9,
        remaining: [],
        // Two digits, which is already enough to tip the column past its
        // label: "LOST" is 17.797px against 18px for two mono digits at the
        // compact floor. Three digits is not structurally impossible —
        // lostTotal counts every cube that misses the compactor over a whole
        // attempt, uncapped by anything but the launch budget, and the
        // generator's own worst lines Contract (tier 12, std pieces, volatile
        // material, tight launch budget: 44 launches x 4 cubes) allows up to
        // 176 fired, so a run that loses nearly all of them clears three
        // digits. That is a degenerate run rather than a wider Contract, and
        // it goes untested here — two digits is the state a Contract in
        // progress actually shows.
        lost: 14,
        // Three complications is the cap (contracts.ts's maxComplications
        // hits 3 at tier 6 and stays there for every tier after — not tier
        // 9), and this is the longest set of notes the generator emits — 52
        // chars, measured across 400 seeds x tiers 1-12.
        conditions: "volatile shipments · tight launch budget · crosswind",
        progress: PROGRESS,
      },
    }),

  // Modals render OVER the HUD in the app; measuring them alone would miss any
  // collision with the chrome underneath.
  //
  // The pause modal carries the control-reference block now (pauseKeysHTML) —
  // the keyboard arm with the full ability loadout, which is the longest hint
  // list the block can render and therefore the tallest this modal gets on the
  // fine-pointer rows (the block is display:none on coarse ones, exactly like
  // the strip it replaces).
  pause: () =>
    S.hudHTML({ ...HUD_BASE, contract: null }) +
    S.pauseModal(true, "keyboard", { bond: true, demo: true, thaw: false, auto: true }),
  // The PAD's reference card, which stopped being a shorter version of the
  // keyboard's the moment it took on the menu gestures (screens.ts's hintParts
  // — D-pad, A, B and the Controls button, four hints no keyboard arm has).
  // The full loadout again, so this is the tallest the block gets on a pad,
  // and it is measured on the fine-pointer rows for the same reason the
  // keyboard one is: the block is display:none on coarse pointers.
  //
  // It arrives carrying two baseline entries, which is not the usual direction
  // of travel and is worth stating: they are the 800x600 window's undersized
  // ability chips and tight rig badges, byte-identical to the ones `pause`
  // already records, because the HUD UNDER the modal is the same HUD. A new
  // fixture over known-defective chrome inherits that chrome's known list; the
  // card itself measures clean on all nineteen rows.
  "pause-pad": () =>
    S.hudHTML({ ...HUD_BASE, contract: null, profile: "gamepad" }) +
    S.pauseModal(true, "gamepad", { bond: true, demo: true, thaw: false, auto: true }),
  bayclear: () =>
    S.hudHTML({ ...HUD_BASE, contract: null }) +
    S.bayClearScreen({
      bayNum: 7, bayName: "Cryo Vault", funds: 1_820, target: 1_700, lines: 14, scrap: 96,
    }),
  // The same card on a Skydeck stop, where the third stat names the clause that
  // just armed instead of the scrap payout. "Bled Hydraulics" deliberately: the
  // longest clause NAME any standing stop can deal, so a row that fits this
  // fits every stop.
  "bayclear-clause": () =>
    S.hudHTML({ ...HUD_BASE, contract: null }) +
    S.bayClearScreen({
      bayNum: 6, bayName: "Cryo Vault", funds: 1_820, target: 1_700, lines: 14, scrap: 0,
      slot: { value: "Bled Hydraulics", label: "clause \u00b7 from Bay 7" },
    }),

  refit: () => refit({}),
  // The yard with an ORDER STAGED is the taller state, for the same reason
  // "draft-picked" is: every staged rung grows a struck-through old value on
  // its card AND a moved tile on the projection.
  //
  // And this is the WHOLE yard staged: every rung HUD_BASE's rig can still
  // climb, which comes to 325 of its 340 scrap — i.e. the largest order a
  // player at this stop can actually place. Seventeen projection tiles, ten of
  // them moved, on a bay that already has four banked axes pinned ACTIVE. The
  // one track it cannot stage is the Demolition Rack, which is not installed,
  // so the fixture also holds the shelf's longest foot copy throughout.
  "refit-staged": () => refit({ bay: 1, launcher: 2, magazine: 1, reactor: 1, bonds: 2 }),

  draft: () => draft([]),
  // The Skydeck's own draft, both states, for the same reason the ladder's
  // ships both — and because its bank cell and its clause-loaded projection
  // are not reachable through the fixtures above.
  //
  // THE FIVE SKYDECK FIXTURES ARRIVE CARRYING 26 BASELINE ENTRIES between them,
  // which is not the usual direction of travel and is worth stating (the same
  // statement "pause-pad" makes below, for the same reason). Every one of them
  // is byte-identical to an entry its LADDER twin already records — the tower's
  // undersized floor plates under `menu`, `.draft__body`'s 800x600 scroll under
  // `draft`, the HUD's chips and badge air under `bayclear`. A new fixture over
  // known-defective chrome inherits that chrome's known list; the Skydeck's own
  // markup (the recap panel's clause rows, the draft's clause cell, the
  // bay-clear card's swapped stat) measures clean on all nineteen rows.
  "draft-skydeck": () => skydeckDraft([]),
  "draft-skydeck-picked": () => skydeckDraft(["cost"]),
  // The draft with a notch SELECTED is the taller state — the projection grows
  // a struck-through old value on every row the pick moves, and the capstone's
  // two-pick hand moves the most rows at once. Measured as its own screen so a
  // projection that fits empty and overflows selected cannot pass.
  "draft-picked": () => draft(["cost", "sweeper"]),

  // The forced-material hand, PICKED — one fixture, not the pair the ordinary
  // draft ships. This one measures the card's title row, and after the badge
  // and the box moved to the footer that row is name-and-glyph in every state:
  // an unpicked twin would measure the same geometry twice. Picked rather than
  // empty because it is the state the player reported, and the state whose
  // footer carries the most (a lit box AND the level badge the pick created).
  "draft-material-picked": () => materialDraft(["volatile", "magnetic"]),

  // The Final Inspection, both states, for the same reason the draft ships
  // both: accepting a clause grows a struck-through old value on every row it
  // moves, and the Tier-10 pair moves the most rows of any pair.
  inspection: () => inspection(null),
  "inspection-signed": () => inspection("odd-lots"),

  // The tutorial, EVERY step. It used to be the two extremes — step 0 (plant
  // fully collapsed) and step 3 (most of the readout revealed) — on the
  // reasoning that they bracket the card's height budget. They do not: the
  // budget is the card's copy against what the reveal has already spent, and
  // those two vary independently, so a middle step can be tighter than both
  // ends (step 2 carries the second-longest body with Reload and Launches
  // already taking their rows). Every step ships to every first-session
  // player and each is read once, in one glance; there is no reason for the
  // harness to see half of them. Four fixtures, one per card.
  coach: () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 0, S.coachHTML(0, BAY_1)),
  "coach-rotate": () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 1, S.coachHTML(1, BAY_1)),
  "coach-row": () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 2, S.coachHTML(2, BAY_1)),
  "coach-final": () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 3, S.coachHTML(3, BAY_1)),
  // The pad player's deck differs in the two places that cost width: the aim
  // card's body renders the gamepad hint sentence, and every card's button
  // wears the B chip (screens.ts's padKey — the pad's only route to it). Step
  // 0 carries the longest gamepad body and step 3 the widest button, so those
  // two pin the profile.
  "coach-pad": () =>
    withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null, profile: "gamepad" }), 0, S.coachHTML(0, BAY_1, "gamepad")),
  "coach-final-pad": () =>
    withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null, profile: "gamepad" }), 3, S.coachHTML(3, BAY_1, "gamepad")),
  // The tutorial-failure modal over the dead bay's HUD — "broke" carries the
  // fullest explanation copy of the three causes.
  "coach-fail": () =>
    S.hudHTML({ ...HUD_TUTORIAL, contract: null }) + S.coachFailHTML("broke", BAY_1, BAY_1.name),

  // The one PORTRAIT screen: run.ts swaps the device's axes for it. `show` is
  // main.ts's toggle; without it the guard is display:none and measures as
  // nothing.
  guard: () => S.rotateGuardHTML().replace('class="rotate-guard"', 'class="rotate-guard show"'),

  "end-won": () => endModal(true),
  "end-lost": () => endModal(false),
  // Tier S's end. The progress row is replaced wholesale (no tier, no salvage,
  // no Workshop invitation) and the action row carries the bench button in
  // place of the bay retry the mode does not offer.
  "end-sandbox": () => endModal(false, true),

  // THE ONE-TIME SEAL NOTICE (screens.ts's sealBreakModal), over the paused bay
  // it is priced against — the placement main.ts renders it in. Two paragraphs
  // and a two-button row: the whole panel is prose, so it is the copy budget
  // rather than a control that decides whether it fits, and it is the only
  // panel in the game a player is expected to read every word of.
  //
  // The widest numbers it can hold: a two-digit bay, a two-digit Mark, and a
  // seal count one short of the ladder — with `tier: null`, which is the LONGER
  // of the two second paragraphs the panel can print and therefore the one this
  // fixture has to measure.
  //
  // MEASURED, not assumed. The obvious guess is the other way round — the
  // frontier branch adds a whole "Tier N still opens." sentence the re-fly
  // branch drops — and it is wrong: stripped of tags, the frontier paragraph
  // runs 457 characters against the fallback's 487, because what replaces that
  // sentence ("Everything else this run can earn, it still earns — the run
  // counts and its salvage banks.") is longer than it is. This comment shipped
  // asserting the opposite for exactly one commit, which is why the number is
  // written down here instead of the claim.
  //
  // It is also the branch a Mark-10 save really produces (meta.ts's
  // tierOpenableBy returns null on a finished ladder), so the worst case and
  // the honest case are the same panel here.
  //
  // …and `explain: true`, the LONG form, for the same reason and on the same
  // kind of measurement. The panel now has two lengths as well as two branches
  // — the first-time explainer and the confirmation every seal-breaking retry
  // after it — and all four combinations were measured rather than reasoned
  // about: 457 / 487 chars with the lesson, 263 / 293 without it. The long
  // re-fly panel is the maximum of the four, and the short form is a strict
  // subset of it (the same panel with one paragraph removed, the same width,
  // the same button row), so measuring the maximum covers both and a second
  // fixture would buy the matrix nothing.
  //
  // It arrives carrying two baseline entries, exactly as `pause-pad` did and
  // for the identical reason: they are the 800x600 window's undersized ability
  // chips and tight rig badges, byte-for-byte the ones `pause` already records,
  // because the HUD UNDER the modal is the same HUD. A new fixture over
  // known-defective chrome inherits that chrome's known list; the panel itself
  // measures clean on all nineteen rows.
  "seal-break": () =>
    S.hudHTML({ ...HUD_BASE, contract: null }) + S.sealBreakModal({
      bayNum: RUN_LEVELS, mark: MARK_COUNT, tier: null, sealed: MARK_COUNT - 1, explain: true,
    }),

  // TIER S itself, in all three of the shapes it takes. The mode ships, so
  // these are shipping screens and are held to the same fit budget as every
  // other one — which is the whole reason they are here and the old developer
  // tool never was.
  //
  // The rig/axis columns are at their WORST CASE deliberately: Mark 10 opens
  // every axis hazards.ts has, which is the longest that column can be, and
  // the belt row carries all six materials plus both overrides at every Mark.
  sandbox: () => sandboxScreen({ s: SANDBOX_BAY, meta: midMeta(), best: 98_760 }),
  "sandbox-contract": () =>
    sandboxScreen({ s: SANDBOX_CONTRACT, meta: midMeta(), best: 0 }),
  // The developer build: one extra row, in a column that already scrolls.
  "sandbox-dev": () =>
    sandboxScreen({
      s: SANDBOX_BAY, meta: midMeta(), best: 98_760, cheats: cheatRowHTML(midMeta()),
    }),

  "contract-end": () =>
    S.contractEndModal({
      won: true,
      name: "Cold Storage Backlog",
      kind: "pattern",
      lines: 4,
      goal: 4,
      launchesUsed: 11,
      launches: 12,
      queue: ["I", "O", "T", "L", "J", "S", "Z", "I"] as PieceType[],
      cubesWasted: 6,
      award: { firstClear: true, completedTier: 3, salvage: 220 },
      progress: PROGRESS,
      salvageTotal: 1_700,
      // The A10 target-price sentence is the salvage row's longest state.
      nextInstall: { name: "Demolition Rack", cost: 40 },
    }),

  // THE LAST RUNG. A tier completion that opens no floor says so, and says
  // what is still open instead (screens.ts's tierOpenedClause) — which makes
  // this the LONGEST the salvage row's body ever gets: the same three-part
  // sentence as any completion, with a clause naming the shelf and the seals
  // where the other states print "Tier N is open". Measured rather than
  // assumed, because that row wraps inside a fixed-height modal.
  "contract-end-ladder": () =>
    S.contractEndModal({
      won: true,
      name: "Cold Storage Backlog",
      kind: "pattern",
      lines: 4,
      goal: 4,
      launchesUsed: 11,
      launches: 12,
      queue: ["I", "O", "T", "L", "J", "S", "Z", "I"] as PieceType[],
      cubesWasted: 6,
      award: { firstClear: true, completedTier: MARK_COUNT, salvage: 15 },
      progress: tierProgressFor({ ...newMeta(), mark: MARK_COUNT }),
      salvageTotal: 1_700,
      nextInstall: { name: "Demolition Rack", cost: 40 },
    }),

  // The Tier S variant of the same modal: the award row is replaced and the
  // actions point back at the bench, so it is a different row count and a
  // different widest string.
  "contract-end-sandbox": () =>
    S.contractEndModal({
      won: true,
      name: "Cold Storage Backlog",
      kind: "pattern",
      lines: 4,
      goal: 4,
      launchesUsed: 11,
      launches: 12,
      queue: ["I", "O", "T", "L", "J", "S", "Z", "I"] as PieceType[],
      cubesWasted: 6,
      award: null,
      progress: PROGRESS,
      salvageTotal: 1_700,
      sandbox: true,
    }),
};

function endModal(won: boolean, sandbox = false): string {
  return S.endModal({
    // THE EXITS AT THEIR WIDEST. A lost ladder run is the only shape that draws
    // all four — Retry Run, Retry Bay with its broken-seal glyph, Contracts
    // with the NEXT STEP badge, and Menu — over the sentence that prices the
    // retry, which is the row's real worst case and the one line above it that
    // can wrap. A win draws three (no bay to hand back) and Tier S draws its
    // own three, so both of those states are still measured by the other two
    // fixtures rather than being replaced by this one.
    contracts: { remaining: 3, next: !won },
    // …and the seal line at ITS widest, which is now the "held" state — a
    // re-fly of an already-sealed Mark (run.ts's sealStateFor, added for the
    // #135 P2). MEASURED, not guessed, because the last fixture in this file
    // shipped a wrong guess about exactly this: stripped of tags the three
    // lines run 113 (held) / 96 (at-stake) / 69 (spent) characters, so the
    // state this row has to be measured against is the one that names a Mark
    // and explains why the press is free. Two digits in the Mark for the same
    // reason the bay number is a worst case.
    //
    // The glyph is the same box in all three (same clip, same 11px), so this
    // choice moves the line and nothing else — which is why one fixture still
    // covers the row rather than three.
    retryBay: !won && !sandbox ? { seal: "held" as const, mark: 10 } : undefined,
    // The board a run posts to is its own Mark (main.ts's boardTier).
    boardTier: 1,
    won,
    sandbox,
    sandboxSetup: sandbox ? "Mark 10 · from bay 9 · 6 notches · parade belt" : undefined,
    score: 98_760,
    lines: 240,
    baysCleared: won ? 10 : 6,
    funds: 1_820,
    best: 91_400,
    name: "LONGESTNAME",
    rows: S.leaderboardRowsHTML(S.endBoard(ENTRIES, "LONGESTNAME"), "LONGESTNAME"),
    reason: won ? null : "broke",
    bayNum: won ? 10 : 7,
    bayName: "Cryo Vault",
    runComplete: won,
    tierCompleted: won ? 3 : null,
    tierSalvage: won ? 220 : 40,
    progress: PROGRESS,
    salvageTotal: 1_700,
    scrapEarned: 640,
    // Non-zero on purpose: the demolition segment only renders above zero, so a
    // 0 here would measure a foot line that never grew the segment at all.
    // Worth knowing what this does and does not buy — the foot WRAPS, so no
    // amount of text in it trips a violation on its own (verified by stretching
    // the segment to a full sentence: still 0 across all 13 devices the matrix
    // held when that check was run — devices.ts's DEVICES is 19 rows now, and
    // the six added since have not been put through the same stretch). What the
    // value buys is the row at its real height, which is what the fit,
    // offscreen and tap assertions measure the rest of the modal against.
    salvagedFunds: 12_480,
    // Non-zero for the same reason, and on the row that actually constrains:
    // the detonation segment lands in the end card's BREAKDOWN (screens.ts's
    // volatileFoot), which is a one-line muted row under the stat trio rather
    // than the wrapping sandbox foot above. Five digits is the widest this can
    // plausibly read — a Tier-10 bay's charge is a quarter of a spill fine that
    // tops out around $43/cube (level.ts), so a run that ate detonations all
    // the way down is in this range and nothing is above it.
    volatileLosses: 10_240,
    tiers: HUD_BASE.tiers,
  });
}

export const SCREEN_IDS = Object.keys(SCREENS);

/** The rail loadout each screen renders, mirroring what main.ts's hudOpts
 *  feeds the layout solver (layout.ts's railSlotsFor). Deep Run screens built
 *  on HUD_BASE carry all three abilities — the seven-slot worst case — and
 *  screens with no HUD have no rail, so they get the base budget. `hud-stock`
 *  falls through to NO_RAIL on purpose rather than by omission: it is a rig
 *  that owns no abilities, so the rail it renders is the base one. The harness
 *  applies this BEFORE publishing the layout, exactly like the app.
 *
 *  The two Contract screens fall through to NO_RAIL for the identical reason
 *  `hud-stock` does. HUD_LOADOUT reads HUD_BASE.bondBreakerOwned/demoOwned/
 *  autoloaderOwned directly — the same three fields the hud-contract fixture's
 *  own comment already corrected to false in the hudHTML() opts, because
 *  levelForContract never grants any of them. This mapping is a SEPARATE
 *  reader of the same HUD_BASE data and was not corrected with it, so both
 *  Contract screens kept handing the layout solver a Deep-Run-worst-case
 *  seven-slot rail — a state main.ts's hudOpts (bond: g.bondCharges > 0, demo:
 *  g.level.bombCharges > 0, auto: g.level.autoLaunchMs > 0, all false for a
 *  Contract) never produces.
 *
 *  Not a rounding error: railColumnCap (layout.ts) divides the usable column
 *  height by railSlots, and computeLayout's `columnFits` check is a MODE
 *  switch, not a scale factor — seven slots that don't fit the column at all
 *  fail it and fall back to a bottom band, which is subtracted from the field
 *  before --field-h is set. On the tightest device in the matrix that is
 *  exactly what was happening: iPhone 13 mini's `mode` was "tall" (bottom
 *  band) at seven slots and "snug" (side band) at the real four, taking
 *  --field-h from 271.00px to 335.25px and the plant's design floor from
 *  116.42px to 144.02px — measured with sim/uifit's own harness, both
 *  Contract screens, both before and after this fix. Every other device in
 *  the matrix is MODE-unaffected (`columnFits` was already true at seven
 *  slots, so none of them fell to the bottom-band branch either way) — but
 *  not fully unaffected: railColumnCap still shrinks as railSlots grows, so
 *  nine of the other twelve (every phone; the three tablets are already
 *  clamped at RAIL_MAX=60 regardless of slot count) had their rail buttons
 *  quietly undersized too, from 44-52.43px up to the real four-slot 60px cap
 *  — measured the same way, `hud` (seven slots) against `hud-contract` (four)
 *  at the same device and insets. That is exactly why `plant`/`draghint`/
 *  `rail` stayed green the whole time this was wrong: none of the three
 *  measures a rail button's own size, only whether it overlaps the field —
 *  and nothing here overflowed a box either; the box itself was the wrong
 *  size, or, on those nine, comfortably inside a box sized for buttons
 *  smaller than the ones the real Contract actually renders. */
const HUD_LOADOUT = {
  bond: HUD_BASE.bondBreakerOwned,
  demo: HUD_BASE.demoOwned,
  thaw: HUD_BASE.thawOwned,
  auto: HUD_BASE.autoloaderOwned,
};
/** The rail `hud-lance` renders: the REACHABLE three-ability worst case, where
 *  HUD_LOADOUT above is the legacy one. Same slot count (7 with a fullscreen
 *  toggle), different third button — see the fixture, and HUD_BASE's
 *  `thawOwned` note for why the two are separate objects rather than one
 *  object carrying four abilities at once. */
const LANCE_RAIL = { bond: true, demo: true, thaw: true, auto: false };
const NO_RAIL = { bond: false, demo: false, thaw: false, auto: false };
export function railLoadoutFor(
  id: string,
): { bond: boolean; demo: boolean; thaw: boolean; auto: boolean } {
  if (id === "hud-lance") return LANCE_RAIL;
  return id === "hud" || id === "hud-rich" || id === "hud-notched"
    || id === "hud-hints-dismissed" || id === "pause" || id === "pause-pad"
    // "bayclear-clause" is the same card over the same HUD, so it needs the
    // same rail: without it the harness sizes the rail for a bare loadout
    // while the markup still renders three ability buttons, and they overflow
    // the bottom of every phone in the matrix — twelve `offscreen` findings
    // that are the fixture's own doing rather than the screen's.
    || id === "bayclear" || id === "bayclear-clause"
    // …and "seal-break" for the identical reason, which it reproduced exactly:
    // the notice is a modal over the same HUD as `pause`, and without this the
    // harness sized a bare rail under three rendered ability buttons and
    // reported twelve `offscreen` findings that belong to the fixture rather
    // than to the panel.
    || id === "seal-break"
    ? HUD_LOADOUT
    : NO_RAIL;
}
