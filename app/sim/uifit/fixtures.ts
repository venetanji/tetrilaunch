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
import {
  LESSONS, LESSON_COUNT, LICENCE_LESSON_COUNT, REVEAL, lessonHasEconomy, levelForLesson,
} from "../../src/game/school";
import { BOARD_SANDBOX, BOARD_SKYDECK, type ScoreEntry } from "../../src/lib/api";
import type { Settings } from "../../src/lib/store";
import type { PieceType } from "../../src/game/theme";
import { CHAIN_RUNGS_MAX, makeBaseLevel } from "../../src/game/level";

/** Tier 1's first bay — the numbers a fixture should show, now that the tier
 *  ladder means "the bay" is a function of the Mark being flown (level.ts).
 *  Was the BAY_1 alias, which could only ever describe one tier. */
const BAY_1 = makeBaseLevel(0);
import {
  newMeta, schoolStepOfFlight, SCHOOL_STEPS, SLOT_BASE, SLOT_CAP,
  tierProgressFor, type MetaState,
} from "../../src/game/meta";
import { hazardOffers, type HazardId, type Ratchets } from "../../src/game/hazards";
import { MARK_COUNT, MAX_TIER, newTiers, UPGRADES, type RefitOrder, type UpgradeTiers } from "../../src/game/upgrades";
import { previewRows } from "../../src/game/preview";
import { finalsForTier } from "../../src/game/finals";
import { buyUpgrades, levelForRun, newRun, RUN_LEVELS } from "../../src/game/run";
import { CLAUSE_STOPS, skydeckRunFor } from "../../src/game/skydeck";
import { dailyContracts, dailySeed, schoolBoard } from "../../src/game/contracts";
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
  sound: true, music: true, haptics: true, seenDragHint: true, seenTutorial: true,
  leftHandRail: false, stickAssist: true, stickSling: false, wheelRotates: false, devMode: false,
  systemCursor: false,
};

const STORE = { available: true, unlimited: false };

/** A SIGNED-IN account, which is the only face of the account screen the
 *  deletion notice can be opened from — and the taller of the two faces, since
 *  it draws the "Signed in as" pair plus two block buttons.
 *
 *  Its own constant rather than a field on STORE: adding one there would put a
 *  Player Account row on the `settings` fixture, which measures a screen this
 *  change does not touch. The label is a long one on purpose — a Google display
 *  name is whatever the provider returns, and the panel is measured over the
 *  widest thing the screen behind it can print. */
const ACCOUNT = {
  available: true,
  ready: true,
  label: "commander.vasquez@example.com",
  providers: { google: true, apple: true },
};

/** A FIXED Skydeck day.
 *
 *  Everything about the mode is a function of the date (game/skydeck.ts), and a
 *  fixture that read the clock would measure a different screen every morning —
 *  which is fine in the app and useless in a harness whose whole output is a
 *  budget compared against a baseline. One day, chosen and pinned, exactly the
 *  way every other fixture pins its seed. */
const SKY_DAY = new Date(Date.UTC(2026, 7, 27));
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
    mark: 6,
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
 *  overflow: the bank's NOTCH cell carries the clause tally beside the notch
 *  count ("Notches · clause Bay 10" over "7 · 2/3", the longest label that row
 *  can deal), and the projection is drawn on a bay that already carries
 *  standing clauses, so more of its rows are pinned than a ladder bay's at the
 *  same notch count.
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
    mark: run.mark,
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
    // The roof earns and spends scrap again (run.ts's refitAfterBay), so the
    // widest case is a bank row carrying BOTH: a three-figure scrap total with
    // the refit countdown on its label, and the clause tally in the notch cell.
    scrap: 104,
    baysToRefit: 3,
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
    mark: 10,
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
function refit(order: RefitOrder, over: { tiers?: UpgradeTiers; ratchets?: Ratchets; mark?: number } = {}): string {
  const run = {
    ...newRun(20_260_815, [], 400, (over.tiers ?? HUD_BASE.tiers) as UpgradeTiers, over.mark ?? 6),
    levelIndex: 6,
    carry: 120,
    scrap: 340,
    ratchets: over.ratchets ?? HUD_BASE.ratchets,
  };
  return S.refitScreen({
    bayNum: 6,
    nextBayName: "Cryo Vault",
    scrap: run.scrap,
    tiers: run.tiers,
    mark: over.mark ?? 6,
    order,
    // No banked ratchets — main.ts's refitHTML passes none, and the reason it
    // does is a layout one, so a fixture that passed them would measure a
    // screen the app never renders. The run's notches travel as the `tally`
    // the belt breakdown quotes, exactly as they do there.
    preview: previewRows(
      levelForRun(run), levelForRun(buyUpgrades(run, order, MAX_TIER) ?? run), {}, run.ratchets),
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
/** The seal state a paused Deep Run is really in (run.ts's sealStateFor), for
 *  the pause fixtures' Restart Bay and the rail's ⏸. `at-stake` because that is
 *  what a run that has retried nothing answers, and the Mark is one the save
 *  has not sealed — the state the owner's screenshot was taken in. */
const PAUSE_SEAL = { state: "at-stake" as const, mark: 4 };

/** The quit gate a paused Deep Run past bay 1 is really in (run.ts's
 *  quitLosesProgress), for the pause fixtures' Quit button. Unarmed, which is
 *  how the card mounts; `pause-armed` measures the other state. The bay matches
 *  the seal's story above — one run, one screenshot. */
const PAUSE_QUIT = { armed: false, bayNum: 4 };

/**
 * The per-line price the HUD fixtures quote the chain ladder at, chosen so the
 * row is measured at the WIDEST label a live bay ever puts in it.
 *
 * hudHTML mounts whatever ladder state it is handed, and the fixtures hand it a
 * bay at rest — combo 0, where the quote is scorePerLine itself, since
 * payoutMult(1, null) is 1. What a live bay actually draws is that price times
 * a streak multiplier that keeps climbing past the ladder's twelfth rung:
 * level.ts's per-line price tops out at 100 + 9*10 = 190 on bay 10, and
 * payoutMult puts a 20-crush chain at x5.75 of it — "Next $1092", a four-digit
 * label. So this is the price that makes a RESTING render come out the width a
 * live row reaches, which is the only width the harness can see. Same
 * worst-case-by-construction reasoning as HUD_BASE's four-digit funds figure,
 * which is likewise not a number bay 7 hands out.
 */
const CHAIN_QUOTE = 1_080;

const HUD_BASE = {
  beltPreview: { bomb: false, type: "T" as PieceType, quarterTurns: 1, empty: false, hidden: false, material: "cryo" as const },
  // The transport's held slot (canvas A5's two-deep queue) — a bulk-adjacent
  // wide piece so the muzzle-end tile is measured at its fattest.
  loaded: { bomb: false, type: "I" as PieceType, quarterTurns: 1, empty: false, hidden: false, material: "slag" as const },
  tier: 6,
  target: 1_700,
  score: 1_259,
  launchCost: 25,
  // The chain ladder, at rest but priced for the WIDEST label the row ever
  // carries — see CHAIN_QUOTE.
  chain: { ...S.CHAIN_AT_REST, scorePerLine: CHAIN_QUOTE },
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
  tiers: {
    bay: 2, launcher: 1, hydraulics: 3, magazine: 1, reactor: 2, bonds: 1, demolition: 0,
    thaw: 0, cushion: 0, incinerator: 0,
  },
  // THE WIDEST RACK THE GAME CAN PRODUCE, stated explicitly now that it is no
  // longer implied.
  //
  // The rack used to draw one plate per track in UPGRADES, so this fixture
  // measured a ten-slot row whatever `tiers` said — six lit plates and four
  // unbought ones. With system slots the row is the RIG (components.ts's
  // shipPlatesHTML), so the same `tiers` would draw six boxes and the fit
  // budget the compact clamp was written against would stop being measured by
  // anything. SLOT_CAP restores it: six mounted plus four OPEN, the same ten
  // boxes at the same widths, which is the case app.css's "the tenth slot ends
  // the clamp" arithmetic is about.
  slots: SLOT_CAP,
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
  tiers: {
    bay: 3, launcher: 3, hydraulics: 3, magazine: 3, reactor: 3, bonds: 3, demolition: 3,
    thaw: 3, cushion: 3, incinerator: 3,
  },
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

/** THE GROUND FLOOR, mid-licence — the state every other menu fixture cannot
 *  reach, because `licensed` absent reads as earned (screens.ts's tierOpen).
 *
 *  It is the tower a first-time player actually opens on: the car parked in the
 *  lobby, every Mark in the shaft locked, and the lobby carrying a count
 *  instead of its name. Worth its own fixture for the same reason menu-first
 *  is — it is the screen the most people will ever see, and it was the one no
 *  fixture measured. */
const TOWER_LICENCE: S.TowerState = {
  unlocked: 1, selected: S.LICENCE_TIER, skydeck: false, contracts: 0,
  licensed: false, basics: false, licenceDone: 3, licenceTotal: SCHOOL_STEPS,
};

/** THE TWO RUNGS THAT ARE NOT BAYS — the ladder's fifth step, with the basics
 *  behind the player and the Contract board in front of them.
 *
 *  A state no other menu fixture reaches, and the one this reordering created:
 *  the car is in the lobby, the entrance is still lit, Contracts and the
 *  Workshop have just come UNLOCKED (so the row is three live buttons where
 *  TOWER_LICENCE draws one), and the primary is DISABLED under an instruction
 *  rather than a count. Worth its own fixture on menu-licence's own argument —
 *  every player passes through it exactly once, and no fixture measured it. */
const TOWER_LADDER_SHOP: S.TowerState = {
  // rigged:false is what makes the Contracts button read the on-ramp line
  // ("one buys your first system") rather than the daily board's terms —
  // main.ts's towerState always sets it, and this fixture used to leave it
  // absent, which reads as rigged.
  ...TOWER_LICENCE, basics: true, licenceDone: LICENCE_LESSON_COUNT, rigged: false,
  // …and the GATE, which is what makes this fixture the state it claims to be:
  // the count alone cannot say whether a save four flights in is at the
  // Contract, at the Workshop or looking at lesson 5 (screens.ts's
  // TowerState.gate). Without it the panel drew a live pip for a lesson the
  // ladder refuses and the primary printed a step number instead of the
  // instruction.
  gate: "contract",
};

/** THE OTHER GATE — the Contract cleared and the Reactor still unbought. The
 *  rung the owner got stuck on, and the one whose lobby note names the shop
 *  ("Install the Reactor to go on") rather than counting steps. Same count as
 *  the fixture above and a different screen, which is exactly why `gate` had to
 *  become a field rather than something the count implies. */
const TOWER_LADDER_SHOP2: S.TowerState = { ...TOWER_LADDER_SHOP, gate: "workshop" };

/** …AND THE TENTH STEP, the Final Exam waiting on the primary. All nine sockets
 *  lit is the fullest the plate's 3x3 grid ever draws while it is still an
 *  entrance — the block is complete and not yet SOLID, which is precisely the
 *  state the exam resolves — and the subtitle is the longest the lobby's
 *  primary carries ("Step 10 of 10 · Final Exam"). */
const TOWER_EXAM: S.TowerState = {
  ...TOWER_LICENCE, basics: true, rigged: true, licenceDone: SCHOOL_STEPS - 1,
};

/** THE STEP AFTER THAT ONE — licensed, and no system installed yet.
 *
 *  The tower a player meets between Flight School and their first Deep Run: the
 *  car parked on Tier 1, every Mark still locked (this time by the rig gate,
 *  meta.ts's rigStarted), and the primary DISABLED under the longest sentence
 *  it ever carries in that state. It is a distinct layout from `menu-licence`
 *  and not a re-skin of it — the parked floor is a Mark, so the recap panel
 *  draws Tier 1's bay rather than the lobby's lesson track, and the primary is
 *  a disabled Deep Run rather than a live Flight School.
 *
 *  Worth its own fixture on the same argument menu-licence makes: it is a
 *  screen every single player passes through exactly once, in the session
 *  where they are most likely to give up, and no fixture measured it. */
const TOWER_UNRIGGED: S.TowerState = {
  unlocked: 1, selected: 1, skydeck: false, contracts: 1,
  licensed: true, basics: true, licenceDone: SCHOOL_STEPS, licenceTotal: SCHOOL_STEPS,
  rigged: false,
};

/** THE PLATE COLLAPSED — the licence held, and the car still parked on the
 *  ground floor.
 *
 *  The other half of the entrance's rule, and a state no other menu fixture
 *  reaches: every one of them parks on a Mark, so none of them has ever
 *  measured the lobby wearing the selection ring at the 22px it drops back to.
 *  It is a real screen — the lobby stays selectable for a re-fly forever
 *  (screens.ts's tierOpen), and it is where a player lands after finishing a
 *  lesson — and it is the fixture that would catch the collapse failing to
 *  happen: the tower here must be pixel-for-pixel the licensed tower every
 *  other menu fixture draws. */
const TOWER_LOBBY_HELD: S.TowerState = {
  unlocked: 1, selected: S.LICENCE_TIER, skydeck: false, contracts: 0,
  licensed: true, basics: true, licenceDone: SCHOOL_STEPS, licenceTotal: SCHOOL_STEPS,
};

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
  // The tutorial bay's REAL line price, not HUD_BASE's worst case: this fixture
  // exists to measure the panel a first-timer sees, and the reveal hides the
  // ladder outright until the deck is done anyway.
  chain: { ...S.CHAIN_AT_REST, scorePerLine: BAY_1.scorePerLine },
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
/** A lesson's Contract block, the way main.ts's hudOpts fills one — so the
 *  fixture measures the panel the bay actually renders rather than a
 *  hand-written approximation of it. */
const LESSON_HUD = (l: (typeof LESSONS)[number]) => ({
  name: l.name,
  kind: "lines" as const,
  goal: l.goal
    ? (l.goal.kind === "atOnce" ? l.goal.lines : l.goal.kind === "grade" ? l.goal.count : l.goal.to)
    : l.lines,
  lines: 1,
  goalLabel: l.goalLabel,
  showCombo: l.reveal >= REVEAL.combo,
  hideReload: true,
  launchesLeft: l.launches,
  remaining: [],
  lost: 2,
  conditions: l.conditions,
  tier: 1,
  progress: null,
});

/** A whole lesson HUD, as main.ts's hudOpts builds one.
 *
 *  TWO SHAPES, because a lesson has two. Up to the Workshop it is a
 *  Contract-shaped panel — a goal over a supply, no money. Above it the bay
 *  carries the Deep Run economy (game/school.ts's lessonHasEconomy), so it draws
 *  the Deep Run readout with the ship rack the purchase filled and the lesson's
 *  own goal on the bay-note row. The fixtures had only ever built the first
 *  shape, which is why they have to go through one helper now: nine
 *  `lesson-hud-*` fixtures each choosing a panel by hand is nine chances to
 *  measure a screen the app does not render. */
const LESSON_HUD_OPTS = (l: (typeof LESSONS)[number]): Parameters<typeof S.hudHTML>[0] =>
  (lessonHasEconomy(l)
    ? {
      ...HUD_TUTORIAL,
      contract: null,
      drill: { name: l.name, kind: "Lesson" as const },
      // The bay's own float and target, so the figures on the panel are the
      // ones the bay actually opens with (school.ts's levelForLesson).
      score: levelForLesson(l).startingFunds,
      target: levelForLesson(l).targetScore,
      launchCost: levelForLesson(l).launchCost,
      // The Reactor, aboard — the state every one of these bays is flown in.
      tiers: { ...newTiers(), reactor: 1 },
      slots: SLOT_BASE,
      bayGoal: l.goal || l.lines > 0
        ? {
          label: "Goal",
          value: `<span id="hud-taskn">1</span>/${
            l.goal
              ? (l.goal.kind === "atOnce" ? l.goal.lines
                : l.goal.kind === "grade" ? l.goal.count : l.goal.to)
              : l.lines
          } ${l.goalLabel ?? "rows"}`,
        }
        : { label: "Bay", value: l.conditions },
    }
    : { ...HUD_TUTORIAL, contract: LESSON_HUD(l) });

/** main.ts's syncRevealStage, as the harness needs it: the stage stamped onto
 *  #hud as `data-reveal`, which is what app.css hides the readout's blocks
 *  against. Same trick withCoach uses below and for the same reason — the
 *  harness must measure the DOM the app actually shows mid-lesson, not a
 *  reconstruction of it. */
/**
 * Stamp attributes onto the HUD root, whatever classes it is wearing.
 *
 * THE THREE HELPERS BELOW ALL USED TO STRING-REPLACE `<div class="hud"
 * id="hud">`, and `hudHTML` emits `<div class="hud hud--contract" id="hud">`
 * for every Contract-shaped panel — which is every Flight School bay. So the
 * replace matched nothing and returned the HUD untouched: the nine
 * `lesson-hud-*` fixtures never carried `data-reveal`, the spotlight fixture
 * never carried `data-hilite`, and the harness spent its whole life measuring
 * the FULL readout while reporting on the staged one. A no-op that returns its
 * input is the worst shape a test helper can have, so this one throws.
 */
const stampHud = (hud: string, attrs: string): string => {
  const out = hud.replace(/<div class="hud([^"]*)" id="hud"/, `<div class="hud$1" id="hud" ${attrs}`);
  if (out === hud) throw new Error(`stampHud found no HUD root to stamp with ${attrs}`);
  return out;
};

const withReveal = (hud: string, stage: number): string => stampHud(hud, `data-reveal="${stage}"`);

/** The rail spotlight a lesson asks for (game/school.ts's Lesson.spotlight,
 *  published by main.ts's syncRevealStage as `data-hilite`). Same trick
 *  withReveal uses: stamp the attribute the app stamps, so the harness measures
 *  the rail the player actually sees rather than a reconstruction of it. */
const withHilite = (hud: string, what: string): string => stampHud(hud, `data-hilite="${what}"`);

const withCoach = (hud: string, step: number, coach: string): string =>
  stampHud(hud, `data-coach="${step}" data-carded="1"`)
    .replace('<div class="plant">', `<div class="plant">${coach}`);

/**
 * A LESSON'S HUD WITH ITS CARD OVER THE PANEL, exactly as main.ts mounts one.
 *
 * This used to go through `withCoach`, which stamped `data-coach` — an
 * attribute a lesson bay never carries. So the harness measured a panel that
 * was height-capped, tightened, pointer-transparent and fade-enabled, and the
 * app rendered one that was none of those (see app.css's `[data-carded]` note
 * for what that cost on device). A fixture that stamps an attribute the app
 * does not is not a stricter test; it is a test of a different screen.
 *
 * The three the app really stamps: the lesson's reveal STAGE, the card-in-panel
 * flag, and the card itself as the plant's FIRST CHILD — which is still the
 * mount point, and matters more than it used to. The card is absolutely
 * positioned over `.plant` now (app.css's `[data-carded]` overlay section, and
 * the owner report quoted there), so being that element's child is what makes
 * the panel its containing block; a fixture that appended the card anywhere
 * else would measure a card floating over the field.
 *
 * WHAT THESE FIXTURES MEASURE THAT THEY DID NOT BEFORE: the readout underneath.
 * `[data-carded]` used to `display: none` seven `.pl-` blocks, so every
 * `lesson-card*` row was a card over a nearly empty panel and the reveal STAGE
 * passed in here changed almost nothing about what was on screen. Nothing is
 * hidden by the card any more — the stage alone decides — so each of these now
 * puts a real card over the real readout that lesson has earned, which is the
 * arrangement the player sees and the one the `plant` assertion's carded clause
 * checks.
 */
const withCard = (hud: string, stage: number, card: string): string =>
  stampHud(hud, `data-carded="1" data-reveal="${stage}"`)
    .replace('<div class="plant">', `<div class="plant">${card}`);

/** What a lesson's card actually prints (meta.ts's schoolLadder): the STEP this
 *  flight sits on, out of the ladder's TEN. The two gates between lesson 4 and
 *  lesson 5 take no ordinal, so a flight's step is its index plus one — and
 *  this still goes through schoolStepOfFlight rather than doing that
 *  arithmetic, because the ladder's shape is what decides and it has already
 *  been a shape where it was not. */
const lessonStep = (i: number): number => schoolStepOfFlight(i);
const lessonTotal = (_i: number): number => SCHOOL_STEPS;

/**
 * A Deep Run HUD with the chain ladder in a state main.ts's syncHud would have
 * written — congested, or a finished full chain.
 *
 * Through hudHTML's own `chain` option, not a string edit: the panel mounts the
 * LIVE ladder (a pause card can go up nine crushes into a streak), so passing a
 * state here is what the app itself does rather than a harness trick. That also
 * means these two fixtures measure the real render path, markup and all.
 */
const withChain = (chain: S.ChainState): string =>
  S.hudHTML({ ...HUD_BASE, contract: null, chain });

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
  // THE ROOF PARKED: the tower's top floor selected, the primary button
  // re-labelled, and its subtitle counting the day's standing clauses.
  //
  // The recap panel used to grow a three-row clause list in its extras slot
  // here, which made this the tallest the menu's tightest column ever got. The
  // list is gone — the day's clauses are met at the stops that arm them, not
  // read off the home screen — so what this row now measures is the roof's
  // BUTTON copy against the ladder's, which is a different and still real worst
  // case: the roof's subtitle is the longest the primary carries, and it got
  // longer again when the yard reopened — "no refits" was replaced by the term
  // that actually separates the floor now that it has one, "a step above Mark
  // 10" (screens.ts's menuPlaySub, level.ts's SKYDECK_RUNG). The clause COUNT is
  // all the screen is given, and it is date-independent, so this fixture no
  // longer needs a pinned day at all.
  "menu-skydeck": () =>
    S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, SKY_TOWER, CLAUSE_STOPS.length),
  "menu-skydeck-live": () =>
    live(S.menuScreen(98_760, 1_480, STORE, PROGRESS, GUIDE, SKY_TOWER, CLAUSE_STOPS.length)),
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
  // THE FIRST SCREEN OF ALL — the lobby parked, the ladder locked, and the
  // primary wearing its third face ("Flight School") over the longest subtitle
  // that face carries ("Lesson 4 of 4 · resume"). Paired
  // live and not, like every other menu state, because the brand column's
  // height is what the row is measured against.
  "menu-licence": () =>
    S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "licence", install: null, firstLaunch: false,
    }, TOWER_LICENCE),
  "menu-licence-live": () =>
    live(S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "licence", install: null, firstLaunch: false,
    }, TOWER_LICENCE)),
  // …AND THE STEP AFTER IT: licensed, nothing installed, the ladder shut by the
  // rig gate and the primary disabled under "Install your first system in the
  // Workshop". The salvage figure is one milestone (15) and the install is the
  // 15 it buys, which is the state the Workshop button's on-ramp line renders —
  // the longest that subtitle gets. Paired live and not, like every other menu
  // state, because the brand column's height is what the row is measured
  // against.
  "menu-unrigged": () =>
    S.menuScreen(0, 15, STORE, tierProgressFor({ ...newMeta(), tierContracts: 1 }), {
      step: "workshop",
      install: { name: "Reactor Output", cost: 15 },
      firstLaunch: false,
    }, TOWER_UNRIGGED),
  "menu-unrigged-live": () =>
    live(S.menuScreen(0, 15, STORE, tierProgressFor({ ...newMeta(), tierContracts: 1 }), {
      step: "workshop",
      install: { name: "Reactor Output", cost: 15 },
      firstLaunch: false,
    }, TOWER_UNRIGGED)),

  // THE PLATE COLLAPSED — see TOWER_LOBBY_HELD above. Paired live and not, like
  // every other menu state, because the brand column's height is what the row is
  // measured against, and the manual's button is a docked overlay in one of
  // those states and a real row in the other (app.css's .menu__howto).
  //
  // THE TWO GATES (TOWER_LADDER_SHOP): the basics behind the
  // player, the two shops just unlocked, and the lobby's primary DISABLED under
  // an instruction rather than a count. It is a distinct layout from
  // menu-licence — three live action rows instead of one, and a subtitle that
  // is a sentence — and it is the screen every player meets exactly once, in
  // the session where they are most likely to give up.
  "menu-school-shop": () =>
    S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "contracts", install: { name: "Reactor Output", cost: 15 }, firstLaunch: false,
    }, TOWER_LADDER_SHOP),
  "menu-school-shop-live": () =>
    live(S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "contracts", install: { name: "Reactor Output", cost: 15 }, firstLaunch: false,
    }, TOWER_LADDER_SHOP)),
  // THE SECOND GATE (TOWER_LADDER_SHOP2) — the Contract cleared, the Reactor
  // still unbought. Same count as the fixture above and a different screen: the
  // primary reads "Install the Reactor to go on" and the lobby's note names the
  // shop instead of counting steps. This is the rung the owner got stuck on.
  "menu-school-buy": () =>
    S.menuScreen(0, 15, STORE, tierProgressFor({ ...newMeta(), tierContracts: 1 }), {
      step: "workshop", install: { name: "Reactor Output", cost: 15 }, firstLaunch: false,
    }, TOWER_LADDER_SHOP2),
  // …AND THE TENTH STEP (TOWER_EXAM): all nine sockets lit — the fullest the
  // plate's 3x3 grid ever draws while it is still an entrance — and the longest
  // subtitle the lobby's primary carries ("Step 10 of 10 · Final Exam").
  "menu-school-exam": () =>
    S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "licence", install: null, firstLaunch: false,
    }, TOWER_EXAM),
  "menu-lobby-held": () =>
    S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "contracts", install: null, firstLaunch: false,
    }, TOWER_LOBBY_HELD),
  "menu-lobby-held-live": () =>
    live(S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "contracts", install: null, firstLaunch: false,
    }, TOWER_LOBBY_HELD)),
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
  //   guide-rig        the deepest chapter — fourteen rows since the rack-slot
  //                    topic landed, so the index really scrolls — on a
  //                    PROGRESSED save, where the tab counts are non-zero and
  //                    nothing is gated.
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
  // The account screen's signed-in face, and the deletion notice over it — the
  // pair main.ts renders for the "account-delete" state. Measured because the
  // notice is a NEW modal and every new modal has to fit the whole device
  // matrix; measured over the screen behind it rather than alone because that
  // is the composition that ships, and the scrim is the only thing between two
  // stacks of block buttons.
  account: () => S.accountScreen(ACCOUNT),
  "account-delete": () => S.accountScreen(ACCOUNT) + S.accountDeleteModal(),
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
  // The multi-board states: the tab strip only exists once a second board does,
  // and it takes a row off the board's own height, so each board gets a fixture.
  "leaderboard-tabs": () =>
    S.leaderboardScreen(S.leaderboardRowsHTML(S.fullBoard(ENTRIES), "PILOT4"),
      { board: 7, tier: 7, sandbox: true }),
  "leaderboard-sandbox": () =>
    S.leaderboardScreen(S.leaderboardRowsHTML(S.fullBoard(ENTRIES), "PILOT4"),
      { board: BOARD_SANDBOX, sandbox: true }),
  // THE WIDEST STRIP the screen can render: a save with the roof open AND Tier
  // S found carries three tabs, which is the state to measure — the Skydeck's
  // own tab is the longest of the three, and the heading it sits under is the
  // only one that carries a date. A Mark-10 ladder tab beside it, since the
  // roof opens only on a beaten ladder.
  "leaderboard-skydeck": () =>
    S.leaderboardScreen(S.leaderboardRowsHTML(S.fullBoard(ENTRIES), "PILOT4"),
      {
        board: BOARD_SKYDECK, tier: 10, sandbox: true, skydeck: true,
        day: dailySeed(new Date(Date.UTC(2026, 7, 27))),
      }),

  // TWO fixtures, because the screen has two shapes and only one of them was
  // ever measured. `workshop` is the early save: nothing owned, so there are no
  // strips and most of the shelf wears a "Needs Tier N" gate. `workshop-owned`
  // is a Mark-3 save, where the shelf is down to its last cards and carries
  // both ownership strips at its foot. One shelf in both — the Systems/Options
  // tabs are gone and both card kinds render together.
  //
  // …and the split now measures the ON-RAMP as well, at no extra fixture cost:
  // midMeta owns no system, so `workshop` renders the first-visit blurb and the
  // refused Start Run ("Install a system to fly" — the wider of the two labels,
  // which is the one the row has to fit), while ownedMeta's five installs give
  // `workshop-owned` the standing blurb and the live primary. The two states of
  // meta.ts's rigStarted, one on each fixture.
  workshop: () => S.workshopScreen(midMeta()),
  "workshop-owned": () => S.workshopScreen(ownedMeta()),
  // THE SCHOOL'S SHELF — one card, rung 6 (meta.ts's schoolLadder). Its own
  // fixture because it is the shortest this screen ever renders and the only
  // state in which the rack is absent: one install, no unlocks, no rack row, no
  // +1 slot, a two-sentence blurb and a refused Start Run. A shelf this empty
  // is the case where `.workshop__shop`'s scroller has nothing to scroll and
  // the aside is the tallest thing in the row.
  "workshop-school": () => S.workshopScreen({
    ...newMeta(), licence: LICENCE_LESSON_COUNT, claimedContracts: ["school"], salvage: 15,
  }),
  // …AND THE SAME SHELF ONE PURCHASE LATER, which is the state the owner got
  // stuck on: the Reactor is installed, the wallet is empty, the card has
  // dropped to its tier-2 price and the primary is now an ENABLED "Continue
  // Flight School →" wearing the next-step badge. It is the widest label that
  // button ever carries and the only state in which this screen's primary is
  // both live and mid-school, so it is the row that has to fit.
  "workshop-school-go": () => S.workshopScreen({
    ...newMeta(), licence: LICENCE_LESSON_COUNT, claimedContracts: ["school"],
    salvage: 0, loadout: { ...newTiers(), reactor: 1 },
  }),

  // THE BOARD, AND IT IS A SET-PIECE BOARD — 20260815 is an odd day and tier 3
  // is past SETPIECE_MIN_TIER, so contracts.ts's alternation deals Lines / Set
  // Piece / Pattern here rather than Lines / Lines / Pattern. Kept on this seed
  // deliberately rather than moved to an even one: three DIFFERENT card kinds
  // side by side is the widest the board's card grid ever has to be, since the
  // set piece's ask ("3 timed in a row") is the longest unit string any card
  // renders and the kind chip "Set Piece" the longest kind label. An even-day
  // board is the same grid with two identical cards in it.
  contracts: () =>
    S.contractsScreen({
      contracts: dailyContracts(3, 20_260_815),
      tier: 3,
      cleared: [],
      progress: PROGRESS,
      // The WHY strip's longest state (A9): a named install and its price.
      nextInstall: { name: "Press Hydraulics", cost: 30 },
    }),
  // THE SAME BOARD ON THE ON-RAMP, where the WHY strip answers a different
  // question — not "what does a tier's quota bank" but "what does ONE clear
  // buy", because the player reading it has no rig and one card pays for the
  // system that opens the Deep Run. It is the longer of the two strips (it
  // names the install AND the door), so this is the state the footnote's row
  // has to fit at.
  "contracts-first-system": () =>
    S.contractsScreen({
      contracts: dailyContracts(3, 20_260_815),
      tier: 1,
      cleared: [],
      progress: tierProgressFor(newMeta()),
      nextInstall: { name: "Reactor Output", cost: 15 },
      firstSystem: true,
    }),
  // THE SCHOOL'S BOARD — one card, rung 5 of the ground floor (contracts.ts's
  // schoolBoard). Its own fixture because nothing else on this screen survives
  // the narrowing: one card in a grid built for three, no tier chip beside the
  // title, no allowance line, and a footnote that explains the whole MODE
  // rather than pricing a quota — the longest strip this screen draws, on the
  // one board every player sees exactly once.
  "contracts-school": () =>
    S.contractsScreen({
      contracts: schoolBoard(),
      tier: 1,
      cleared: [],
      progress: tierProgressFor({ ...newMeta(), licence: LICENCE_LESSON_COUNT }),
      nextInstall: { name: "Reactor Output", cost: 15 },
      school: true,
    }),

  hud: () => S.hudHTML({ ...HUD_BASE, contract: null }),
  // THE SAME BAY WITH A CONTROLLER IN THE PLAYER'S HANDS, and the widest form
  // of it. The rail's buttons now carry a legend row apiece — a keycap and the
  // connected pad's own mark (components.ts's railLegendHTML) — and this is the
  // only fixture that renders the pad half, because the harness stamps
  // <html data-pad> for it (see padFamilyFor). PlayStation rather than Xbox:
  // the marks are drawn glyphs where the Xbox chips are single letters, so the
  // PS family is the taller and wider of the two chips on every button.
  //
  // A PAD IS THE ACTIVE INPUT — the state in which the rail draws pad marks and
  // no keycaps at all (app.css's rail-legend block keys off <html data-profile>
  // crossed with <html data-pad>, both stamped for this fixture by
  // rootHooksFor). The `hud` fixture beside it is the other half of the same
  // pair: same rail, same loadout, keycaps instead. Between them every rail
  // button is measured in both of the two states it can be drawn in.
  "hud-pad": () => S.hudHTML({ ...HUD_BASE, contract: null, profile: "gamepad" }),
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
  // THE RIG AS IT UNDOCKS: four slots, which is meta.ts's SLOT_BASE and the
  // rack every run starts and most runs finish with. `hud-lance` above is the
  // ten-slot CAP, and it stayed the only rack this harness measured while the
  // plate was one flat width — a coefficient measured for ten is a coefficient
  // measured for every count.
  //
  // It stopped being one: app.css's --plate-w divides the rack's row budget by
  // its own slot count, so the common rack is now a DIFFERENT width from the
  // worst-case one and the widest plate in the app is the one this fixture
  // draws, not the one above. Same three abilities, same row, so the only thing
  // that moves between the two is the count — which is exactly the variable
  // under test.
  //
  // The TIERS have to come down with the slot count, not just `slots`:
  // shipPlatesHTML treats the count as a floor rather than a truncation (a
  // system aboard always gets a plate), so HUD_BASE's six mounted tracks would
  // draw a six-slot rack whatever this said. Four mounted, four slots, no open
  // boxes — the rig at the top of the ladder.
  "hud-rig4": () =>
    S.hudHTML({
      ...HUD_BASE,
      contract: null,
      autoloaderOwned: false,
      thawOwned: true,
      thawCharges: 12,
      tiers: {
        bay: 2, launcher: 1, hydraulics: 3, magazine: 0, reactor: 0, bonds: 1,
        demolition: 0, thaw: 0, cushion: 0, incinerator: 0,
      },
      slots: SLOT_BASE,
    }),
  /* NO "hud-hints-dismissed" fixture. It rendered the HUD as every bay past the
     first shot mounted it — the key-hint strip already faded — which was a
     state worth pinning while the strip had a transience to get wrong. The
     strip is gone, the mount is unconditional, and the fixture was otherwise
     `hud` spelled a second way. Its baseline entry went with it. */
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
  // TIER 10, THE WHOLE PANEL AT ONCE — the state every absolute number in the
  // R4 readout was tuned against, and the one no other fixture renders.
  //
  // Four worst cases meet on this one screen and nowhere else. FIVE-FIGURE
  // FUNDS against a five-figure target ("$18420 / 21000"), which is what the
  // stacked figure and the 6ch/8ch reservations in app.css's digit-stable block
  // exist for. A THREE-FIGURE LAUNCH PRICE, which is the 5ch the price row
  // reserves. A CLOCK UNDER A MINUTE, so the `is-low` alarm is measured in
  // place rather than only asserted in sim/systems.ts. And TEN AXES PLUS A
  // CLAUSE — eleven marks on a row whose scroller `hud-notched`'s eight already
  // overflow — which is the case the notch TOTAL was added for: the figure
  // survives at the row's head when its tail cannot be reached.
  //
  // Ten and not eleven: `target` (Quota Raise) is in hazards.ts's RETIRED_AXES
  // and no run can be dealt it, so an eleven-axis line would measure a state
  // the game cannot produce — the same trap the `hud-contract` fixture's own
  // note records paying for twice.
  //
  // The stacks are the shape a Mark 10 run actually banks: two ratchets a bay
  // over ten bays is twenty picks against ten axes, so most axes carry a badge
  // and a few carry three. 24 is what these add up to, restated by the row
  // itself rather than written here as a literal.
  "hud-t10": () =>
    S.hudHTML({
      ...HUD_BASE,
      contract: null,
      tier: 10,
      bayNum: 10,
      score: 18_420,
      target: 21_000,
      launchCost: 168,
      // 0:38 — under CLOCK_ALARM_MS and over LOW_TIME_WARN_MS, which is the one
      // window where the alarm's colour renders without the pulse's class on
      // top of it. The pulse is a live write; this is the mount state.
      timeLeftMs: 38_000,
      ratchets: {
        cost: 3, time: 3, wind: 3, sweeper: 2, cryo: 2,
        rebar: 2, slag: 2, volatile: 3, tar: 2, magnetic: 2,
      } as Ratchets,
      final: "cold-chain",
    }),
  // THE CHAIN LADDER'S OTHER TWO STATES. Every HUD fixture above hands the
  // panel a ladder AT REST — nothing crushed, nothing congested — because that
  // is the state a bay opens in and the state most of them are measuring the
  // rest of the panel against. Rendered only from those, the harness would be
  // measuring one ladder twelve times over and the other two never.
  //
  // Passed through hudHTML's own `chain` option, which is the same door main.ts
  // uses (its chainState), so these measure the real render path rather than a
  // hand-written stand-in.
  //
  // WHAT IS NEW IN THEM is geometry, not just colour, which is why they are
  // worth a row of the matrix each. Congested mounts the GATE — a 2px rule
  // absolutely positioned 3px proud of the rungs' box top and bottom, the only
  // thing on this row that deliberately leaves its container — and swaps the
  // label from a price to a cap. Full chain carries the longest label the row
  // can hold at the state where every rung also has a glow.
  "hud-congested": () =>
    withChain({ combo: 4, tierIdx: 1, capMult: 0.6, scorePerLine: CHAIN_QUOTE, full: false, rungs: CHAIN_RUNGS_MAX }),
  "hud-fullchain": () =>
    withChain({ combo: 9, tierIdx: -1, capMult: 1, scorePerLine: CHAIN_QUOTE, full: true, rungs: CHAIN_RUNGS_MAX }),

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

  // THE THIRD CONTRACT KIND, and the only one that renders the CHAIN LADDER
  // (contracts.ts's SET PIECE). It is the tallest of the three plant panels by
  // exactly one row and the widest goal label of any Contract — "Best streak /
  // Goal" against "Lines / Goal" — so it is the case that decides whether the
  // readout's three columns still fit once the funds block's label grows.
  //
  // The ladder is deliberately SHORT here (rungs 3, the tier-7 ask) rather than
  // CHAIN_AT_REST's 14: chainRungsFor returns exactly the goal on a set piece,
  // and a fixture that measured the 14-rung row would be measuring a state this
  // bay cannot reach while missing the one it always shows.
  "hud-contract-setpiece": () =>
    S.hudHTML({
      ...HUD_BASE,
      ratchets: {} as Ratchets,
      // Everything a Contract cannot carry, for hud-contract's reasons exactly.
      tiers: {} as UpgradeTiers,
      bondBreakerOwned: false,
      bondCharges: 0,
      demoOwned: false,
      autoloaderOwned: false,
      bombCharges: 0,
      thawOwned: false,
      thawCharges: 0,
      timeLimitSec: 0,
      // MID-STREAK, not at rest: two rungs lit of three, which is the only
      // state in which the ladder's lit, next and dark rungs are all on screen
      // at once.
      chain: { combo: 2, tierIdx: -1, capMult: 1, scorePerLine: 0, full: false, rungs: 3 },
      contract: {
        name: "Transfer Yard",
        kind: "setpiece",
        tier: 7,
        goal: 3,
        lines: 2,
        goalLabel: "Best streak",
        showCombo: true,
        launchesLeft: 6,
        remaining: [],
        lost: 4,
        // setpieceConditions at tier 7 — the longest the string gets, because N
        // and the rack depth are both at their ladder maximum there
        // (contracts.ts's RACK_DEPTHS).
        conditions: "3 timed in a row · all I · 5-deep rack",
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
  //
  // RESTART BAY CARRIES ITS SEAL FACE, because a paused Deep Run always has
  // one — a fixture that passed none measured a button the app does not draw,
  // and the glyph is 11px plus its margin inside a row that already holds four
  // controls. `at-stake` is the state a fresh run pauses in; all three faces
  // are the same box, so the row's width is the same in each and this measures
  // the widest the row can get either way.
  //
  // …AND ITS QUIT CARRIES THE GATE, for the same reason Restart Bay carries its
  // seal face: a paused Deep Run past bay 1 always has one (run.ts's
  // quitLosesProgress), so a fixture passing none measured a button the app
  // does not draw. The gated button is the WIDER of the two — app.css stacks
  // both faces in one grid cell so the row cannot reflow when it arms, which
  // means the idle button reserves "QUIT ANYWAY" and is ~34px past the bare
  // ghost it replaces. That widening lands on the row this fixture exists to
  // measure, which is why it belongs in the default pause and not only in the
  // armed one below.
  // NO BAY-1 FIXTURE, for the reason there is no Skydeck one (see below): that
  // card is a strict NARROWING of this one and cannot overflow anything this
  // does not. Bay 1 swaps the priced Restart Bay for the free Retry Run
  // (screens.ts's pauseModal, run.ts's retryIsWholeRun), which drops the 11px
  // seal glyph and its margin and shortens the label by two characters, and it
  // draws the UNGATED Quit — the bare ghost, ~34px narrower than the gated
  // button this fixture reserves "QUIT ANYWAY" for. Same four controls, same
  // reference block, less of both. What bay 1 removes is pinned in
  // sim/systems.ts, where the question is which control is there.
  pause: () =>
    S.hudHTML({ ...HUD_BASE, contract: null, seal: PAUSE_SEAL }) +
    S.pauseModal(
      true, "keyboard", { bond: true, demo: true, thaw: false, auto: true },
      PAUSE_SEAL, PAUSE_QUIT,
    ),
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
    S.hudHTML({ ...HUD_BASE, contract: null, profile: "gamepad", seal: PAUSE_SEAL }) +
    S.pauseModal(
      true, "gamepad", { bond: true, demo: true, thaw: false, auto: true },
      PAUSE_SEAL, PAUSE_QUIT,
    ),
  // THE ARMED QUIT (screens.ts's quitArmNoteHTML) — the one state of this card
  // that adds a row, and therefore the only one worth a fixture of its own.
  //
  // The note is two lines of prose between the button row and the control
  // reference, which makes this the TALLEST the pause card ever gets: the
  // keyboard arm with the full loadout (the longest hint list the block
  // renders) plus the warning above it, measured on the fine-pointer rows where
  // both are visible at once. A landscape phone draws no reference block at all
  // (coarse pointer), so the note there costs the card nothing it did not
  // already have room for — the desktop rows are the binding case and the
  // reason this fixture exists.
  //
  // Bay 10 deliberately: the copy interpolates the bay number twice (the button
  // name and the note), and two digits is the widest either can get.
  //
  // NO SKYDECK FIXTURE. The roof's card is a strict SUBSET of `pause` — the
  // same panel with Restart Bay and one hint line removed (run.ts's
  // bayRetryable) — so it cannot overflow anything `pause` does not, and a
  // fixture for it would buy the matrix nothing but two more inherited HUD
  // entries. What it removes is pinned in sim/systems.ts, where the question is
  // whether the control is there rather than whether it fits.
  "pause-armed": () =>
    S.hudHTML({ ...HUD_BASE, contract: null, seal: PAUSE_SEAL }) +
    S.pauseModal(
      true, "keyboard", { bond: true, demo: true, thaw: false, auto: true },
      PAUSE_SEAL, { armed: true, bayNum: RUN_LEVELS },
    ),
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
      bayNum: 6, bayName: "Cryo Vault", funds: 1_820, target: 1_700, lines: 14, scrap: 28,
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
  // THE STATE NO FIXTURE REACHED: a rig sitting at tier 2 on every track, and a
  // belt carrying all six materials.
  //
  // Tier 2 is the only rung whose button offers the CAPSTONE, and the capstone
  // is where the tracks' effect copy stopped being a phrase — "+2 charges,
  // resupply, a wider blast and a better rate" on the Demolition Rack, "a
  // deeper liner, and no launch sets one off inside it" on the Impact Cushion.
  // HUD_BASE's rig is at 0, 1, 2 or 3 on each track and never at 2 on any of
  // the three that carry that copy, so the shelf's widest button was measured
  // nowhere on nineteen devices — which is how it reached a player's screenshot
  // bursting out of the card with the description column beside it wrapped to
  // one word per line. The buttons carry a price now (screens.ts's buy-button
  // note); this is the fixture that holds them to it.
  //
  // Six material axes for the same reason on the panel beside the shelf: the
  // belt tile's per-material breakdown is as wide as the run has materials, and
  // HUD_BASE banks two. Mark 10, where all six axes are open, is where a rig
  // this built actually is.
  "refit-capstone": () => refit({}, {
    tiers: Object.fromEntries(UPGRADES.map((u) => [u.id, MAX_TIER - 1])) as UpgradeTiers,
    ratchets: { wind: 2, sweeper: 1, slag: 2, cryo: 1, rebar: 1, volatile: 1, tar: 1, magnetic: 1 },
    mark: 10,
  }),

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
  /* FLIGHT SCHOOL (game/school.ts). Two things need measuring and they are
     independent, so they get separate fixtures.

     THE CARD, on the two lessons whose copy is worst-case: the deck's bodies
     are budgeted in sim/systems.ts by character count, but characters are not
     pixels — a card is measured here. "Time the row" carries the longest body
     in the ladder and "Clutter" the one with the most interpolated numbers.

     THE REVEAL, at EVERY stage, for the reason the coach's own note gives about
     shipping all four of its steps: the budget is the readout against what the
     stage has already spent, and those vary independently, so a middle stage
     can be tighter than either end. Rendered with NO card over it as the state
     after the player hides the live tip. */
  "lesson-card": () => withCard(
    S.hudHTML(LESSON_HUD_OPTS(LESSONS[4])), LESSONS[4].reveal,
    S.lessonCardHTML(LESSONS[4], lessonStep(4), 0, lessonTotal(4)),
  ),
  // The only profile-aware Flight School card: the first thing a new player
  // reads must fit after spelling out the touch slingshot gesture in full.
  "lesson-card-aim": () => withCard(
    S.hudHTML(LESSON_HUD_OPTS(LESSONS[0])), LESSONS[0].reveal,
    S.lessonCardHTML(LESSONS[0], lessonStep(0), 0, lessonTotal(0), "touch"),
  ),
  "lesson-card-last": () => withCard(
    S.hudHTML(LESSON_HUD_OPTS(LESSONS[8])), LESSONS[8].reveal,
    S.lessonCardHTML(LESSONS[8], lessonStep(8), 1, lessonTotal(8)),
  ),
  /* WHAT THE THREE FIXTURES ABOVE DO NOT COVER.

     Every card leads with a drawing now (ui/lessonart.ts), and the drawing is
     the tallest thing in the card — so which drawing a fixture happens to
     render is a fit question rather than a decoration one. The three above take
     the set-piece board (`lesson-card`, `lesson-card-aim`) and the congestion
     pile (`lesson-card-last`). These are the rest:

     THE LONGEST CARD THE LADDER CAN PRODUCE, which is lesson 1 on a GAMEPAD.
     Its body is the card plus the pad's aim sentence out of the one hint table
     ("Aim with the left stick — up/down for angle, left/right for power — and
     press A to fire"), 122 characters against the touch card's 95 — and nothing
     measured it, because `lesson-card-aim` is the touch profile and
     `lesson-card-pad` is a card with no gesture prefix at all. It is the case
     that pushed the card 11px past the panel's cap on the 640x360 phone, and it
     is what the strip's give-way (app.css's `.lart__strip`) is written for.

     THE WELL, because it is the tallest strip the generator can produce: an I
     standing on its end is four cubes above a two-deep pile, six rows in a band
     that everywhere else carries three. It is also the one card whose gesture
     prefix is `rotate` rather than `aim`, so it pins the other half of that
     branch.

     LOST CARGO, because it is the one lesson with no wall at all, which selects
     a different picture entirely (the miss, with its `−$` tag). A tag is TEXT
     inside the SVG, and text inside a drawing is the thing that scales
     differently from everything around it. */
  "lesson-card-aim-pad": () => withCard(
    S.hudHTML({ ...LESSON_HUD_OPTS(LESSONS[0]), profile: "gamepad" }),
    LESSONS[0].reveal,
    S.lessonCardHTML(LESSONS[0], lessonStep(0), 0, lessonTotal(0), "gamepad"),
  ),
  "lesson-card-well": () => withCard(
    S.hudHTML(LESSON_HUD_OPTS(LESSONS[2])), LESSONS[2].reveal,
    S.lessonCardHTML(LESSONS[2], lessonStep(2), 0, lessonTotal(2), "touch"),
  ),
  "lesson-card-lost": () => withCard(
    S.hudHTML(LESSON_HUD_OPTS(LESSONS[7])), LESSONS[7].reveal,
    S.lessonCardHTML(LESSONS[7], lessonStep(7), 0, lessonTotal(7)),
  ),
  // The pad's route to the card's one button (screens.ts's padKey), on the
  // widest button label the deck has.
  "lesson-card-pad": () => withCard(
    S.hudHTML({ ...LESSON_HUD_OPTS(LESSONS[4]), profile: "gamepad" }),
    LESSONS[4].reveal,
    S.lessonCardHTML(LESSONS[4], lessonStep(4), 1, lessonTotal(4), "gamepad"),
  ),
  ...Object.fromEntries(LESSONS.map((l, i) => [
    `lesson-hud-${i}`,
    () => withReveal(S.hudHTML(LESSON_HUD_OPTS(l)), l.reveal),
  ])),
  // THE ROTATE SPOTLIGHT, on the lesson that asks for it. The two rail buttons
  // grow a lit ring and a pulse, which is the only thing on this screen that
  // changes a control's box — so it is the one that could push the rail's
  // column and needs measuring.
  "lesson-hilite-rotate": () => withHilite(
    withReveal(S.hudHTML(LESSON_HUD_OPTS(LESSONS[2])), LESSONS[2].reveal),
    "rotate",
  ),
  // The result, three ways. The third is the HAND-OFF card — the win that ends
  // the four basics and opens the two shops (meta.ts's schoolLadder) — and it
  // is the widest of the three: its primary is a screen's own door with an icon
  // in it ("Contract board →") and the ghost tower link renders beside it,
  // where every other cleared lesson draws one button and a ghost. Three
  // controls at their widest, on a card every player meets exactly once.
  "lesson-end-won": () => S.hudHTML(LESSON_HUD_OPTS(LESSONS[0]))
    + S.lessonEndModal({
      won: true, name: LESSONS[0].name, step: lessonStep(0), total: SCHOOL_STEPS,
      brief: LESSONS[0].brief, lines: 1, shotsUsed: 3, launches: 0, next: "lesson",
    }),
  "lesson-end-lost": () => S.hudHTML(LESSON_HUD_OPTS(LESSONS[8]))
    + S.lessonEndModal({
      won: false, name: LESSONS[8].name, step: lessonStep(8), total: SCHOOL_STEPS,
      brief: LESSONS[8].brief, lines: 1, shotsUsed: 22, launches: 0, next: "lesson",
      // THE THIRD STAT, and the state that makes the row widest: a money lesson
      // lost to a bankroll that ran out, so the card reports both halves of the
      // win condition and the money half is the one that failed.
      funds: { score: 18, target: levelForLesson(LESSONS[8]).targetScore },
    }),
  "lesson-end-licence": () => S.hudHTML(LESSON_HUD_OPTS(LESSONS[3]))
    + S.lessonEndModal({
      won: true, name: LESSONS[3].name, step: lessonStep(3), total: SCHOOL_STEPS,
      brief: LESSONS[3].brief, lines: 2, shotsUsed: 14, launches: 0, next: "contract",
    }),
  // …AND THE LAST LESSON'S, which hands over to the graduation flight rather
  // than to a shop: same card, different sentence and a plain exit, and the
  // sentence is the longest blurb this modal carries.
  "lesson-end-exam": () => S.hudHTML(LESSON_HUD_OPTS(LESSONS[8]))
    + S.lessonEndModal({
      won: true, name: LESSONS[8].name, step: lessonStep(8), total: SCHOOL_STEPS,
      brief: LESSONS[8].brief, lines: 2, shotsUsed: 14, launches: 0,
      funds: { score: 640, target: levelForLesson(LESSONS[8]).targetScore },
      next: "exam", lastLesson: true,
    }),
  // THE FINAL EXAM'S TWO ENDS (meta.ts's schoolLadder, step 10). Both
  // are the DEEP RUN's cards rather than a lesson's — the bay is Tier 1 bay 1 —
  // so neither has ever been measured over a school HUD: the clear carries the
  // one hint line in the app that is not "tap to continue", and the failure is
  // the bay-1 diagnosis card without the tutorial's NEXT STEP block, which is
  // the shortest that card ever renders and therefore the layout its foot has
  // to survive.
  "exam-clear": () => S.hudHTML({ ...HUD_TUTORIAL, contract: null })
    + S.bayClearScreen({
      bayNum: 1, bayName: BAY_1.name, funds: 1_120, target: BAY_1.targetScore,
      lines: 11, scrap: 18,
      hint: "Licence earned — Tier 1 is open · tap to continue",
    }),
  "exam-fail": () => S.hudHTML({ ...HUD_TUTORIAL, contract: null })
    + S.examFailHTML("broke", BAY_1, SCHOOL_STEPS, SCHOOL_STEPS),

  // The two run-screen intros, over the screens they describe. Both carry two
  // paragraphs, which is the most copy any modal in the app holds — these and
  // the board's are what decide whether `.end__main` can take a second one.
  "draft-intro": () => draft([]) + S.draftIntroModal({ offered: 2, picks: 1 }),
  "refit-intro": () => refit({}) + S.refitIntroModal({ scrap: 340, stops: 3 }),

  // The board introducing itself, over the board (screens.ts's
  // contractsIntroModal). Two paragraphs is the most copy any modal in the app
  // carries, so this is the one that decides whether `.end__main` can hold two.
  "contracts-intro": () =>
    S.contractsScreen({
      contracts: dailyContracts(3, 20_260_815),
      tier: 1,
      cleared: [],
      progress: PROGRESS,
      nextInstall: { name: "Press Hydraulics", cost: 30 },
    }) + S.contractsIntroModal({ needed: PROGRESS.needed, daily: 3, milestone: PROGRESS.milestone }),

  // The purchase that explains itself (screens.ts's systemDrillOfferModal),
  // over the Workshop it was bought from. The Incinerator's is the worst case
  // of the ten: the longest system name paired with the longest drill brief.
  "sys-drill-offer": () => S.workshopScreen({ ...newMeta(), licence: LESSON_COUNT, salvage: 400, mark: 5 })
    + S.systemDrillOfferModal({
      name: "Incinerator",
      drill: DRILLS["sys-incinerator"].name,
      brief: DRILLS["sys-incinerator"].brief,
    }),

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
  sandbox: () => sandboxScreen({ s: SANDBOX_BAY, meta: midMeta(), best: 98_760, fullGame: true }),
  "sandbox-contract": () =>
    sandboxScreen({ s: SANDBOX_CONTRACT, meta: midMeta(), best: 0, fullGame: true }),
  // The developer build: one extra row, in a column that already scrolls.
  "sandbox-dev": () =>
    sandboxScreen({
      s: SANDBOX_BAY, meta: midMeta(), best: 98_760, fullGame: true, cheats: cheatRowHTML(midMeta()),
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

  // THE STATE MOST CLEARS LAND IN, and until this fixture the only one of the
  // Contract end's five payout banners that nothing measured. Two of every
  // three clears in a tier tick the quota rather than complete it, so this is
  // the row a player reads most and the two fixtures above are the rare ends.
  //
  // It is also the banner's WIDEST HEADING: a completion heads it "Tier 10
  // complete!", a quota tick "Tier 2 · Contracts 0/3" — 22 characters against
  // 17, in --font-pixel, whose advance is a full em. Measured at the roomy
  // 11px that heading is ~256px against the 290px column the 1280x720 row
  // gives it, which is the closest this row's heading comes to wrapping
  // anywhere in the matrix; a point more and it costs a line of modal height.
  //
  // The body is the sentence at its longest reachable shape: an award to
  // announce, a quota still open, and a target price to walk toward, with the
  // inline pixel-face emphasis mid-sentence rather than at its end (where the
  // completion states put it). 0/3 rather than 1/3 because "3 more Contracts"
  // is the plural, and the Deep Run clause rides along while runDone is false.
  "contract-end-progress": () =>
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
      award: { firstClear: true, completedTier: null, salvage: 15 },
      progress: { tier: 2, runDone: false, contracts: 0, needed: 3, award: 60, milestone: 15 },
      salvageTotal: 1_700,
      nextInstall: { name: "Demolition Rack", cost: 40 },
    }),

  // THE ON-RAMP'S HAND-OFF, and it is here for the ACTION ROW rather than the
  // body. The clear that pays for the first system takes the primary away from
  // "Next: <card> →" and points it at the shop, under the longest label this
  // modal's primary ever carries — and the ghost board link renders beside it,
  // because the primary is no longer the board. Three controls at their widest,
  // on the one card every player meets exactly once.
  "contract-end-first-system": () =>
    S.contractEndModal({
      won: true,
      name: "Cold Storage Backlog",
      kind: "lines",
      lines: 4,
      goal: 4,
      launchesUsed: 11,
      launches: 12,
      queue: [],
      cubesWasted: 0,
      award: { firstClear: true, completedTier: null, salvage: 15 },
      progress: { tier: 1, runDone: false, contracts: 1, needed: 3, award: 60, milestone: 15 },
      salvageTotal: 15,
      nextInstall: { name: "Reactor Output", cost: 15 },
      nextContract: { name: "Cold Storage Backlog" },
      firstSystem: true,
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
    // ...and the Incinerator's saving, which lands on the SAME breakdown row
    // immediately after it — so this fixture measures the row at its widest
    // realistic content rather than at one segment of it. Five digits again,
    // and the bound is the same one: the hood can never remit more than the
    // bills beside it charged.
    incineratedFunds: 10_240,
    // ...and the TIMING TALLY, which lands on that same breakdown row ahead of
    // both of them (screens.ts's gradeBreakdownClause). Present for exactly the
    // reason its two neighbours are non-zero: the clause only renders for a
    // band the run actually earned, so an omitted tally would measure the row
    // without the segment rather than with it.
    //
    // Three digits in each named band, which is the widest this can honestly
    // read against the 240 lines above — a run cannot earn more excellent rows
    // than it cleared rows, and the two bands that print are a subset of that
    // total. The two that do NOT print are still filled in, so the fixture is a
    // tally a real run could produce rather than an arithmetic impossibility.
    grades: { excellent: 148, good: 62, swept: 24, lucky: 6 },
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
/** The rail `hud-lance` and `hud-rig4` render: the REACHABLE three-ability
 *  worst case, where HUD_LOADOUT above is the legacy one. Same slot count (7
 *  with a fullscreen toggle), different third button — see the fixture, and
 *  HUD_BASE's `thawOwned` note for why the two are separate objects rather than
 *  one object carrying four abilities at once. The two screens differ in their
 *  RACK, not in their rail, so they share this. */
const LANCE_RAIL = { bond: true, demo: true, thaw: true, auto: false };
const NO_RAIL = { bond: false, demo: false, thaw: false, auto: false };
export function railLoadoutFor(
  id: string,
): { bond: boolean; demo: boolean; thaw: boolean; auto: boolean } {
  if (id === "hud-lance" || id === "hud-rig4") return LANCE_RAIL;
  return id === "hud" || id === "hud-pad" || id === "hud-rich" || id === "hud-notched"
    // …and the two chain-state fixtures, which are `hud` with one row swapped
    // and therefore render `hud`'s three ability buttons. Same failure as every
    // entry below if they are missed: the harness sizes the rail for a bare
    // loadout while the markup draws the full one, and the buttons hang off the
    // bottom of every handset — findings that belong to the fixture, not the
    // screen. (This one was reproduced, not assumed: two `offscreen` and two
    // `safearea` findings on the iPhone X before the ids were added here.)
    || id === "hud-congested" || id === "hud-fullchain"
    // …and "hud-t10", which is `hud` at the top of the ladder: same three
    // ability buttons, same seven-slot rail, different numbers.
    || id === "hud-t10"
    || id === "pause" || id === "pause-pad"
    // …and "pause-armed", which is `pause` with one more row on the card and
    // the SAME HUD behind it. It reproduced the identical eleven `offscreen`
    // findings the two entries below record, from the identical cause.
    || id === "pause-armed"
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

/**
 * The ROOT HOOKS a fixture needs stamped on <html> before it is measured.
 *
 * Two of app.css's structural switches are root attributes rather than media
 * queries — the input profile (D2) and the connected pad's family — and until
 * now the harness stamped neither, so every rule behind them was dark on every
 * device row. Both are stamped now, and they have to be: the rail's legends are
 * gated on the pair, so without them not one keycap or pad mark in the game
 * would be measured anywhere.
 *
 * Returned as a pair rather than stamped by the fixture itself, because a
 * fixture returns an HTML STRING for #overlay and cannot reach the document
 * element. main.ts writes both hooks the same way (setProfile, syncPadFamily);
 * this is the harness's copy of that hand-off. It is deliberately narrow — the
 * fixtures written to pin gamepad COPY (pause-pad, coach-pad) keep rendering
 * exactly what they always rendered — so this adds coverage without silently
 * re-measuring anything.
 */
export function rootHooksFor(id: string): { profile: string | null; pad: string | null } {
  // PlayStation rather than Xbox: the marks are drawn glyphs where the Xbox
  // chips are single letters, so the PS family is the taller and wider of the
  // two chips on every button — the worst case of the pair.
  if (id === "hud-pad") return { profile: "gamepad", pad: "playstation" };
  // Everything else takes the harness's boot default for its pointer type
  // (keyboard on a mouse row, touch on a handset), which is what main.ts does.
  return { profile: null, pad: null };
}
