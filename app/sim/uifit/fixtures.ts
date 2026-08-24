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
import type { ScoreEntry } from "../../src/lib/api";
import type { Settings } from "../../src/lib/store";
import type { PieceType } from "../../src/game/theme";
import { LEVEL_1 } from "../../src/game/level";
import { newMeta, tierProgressFor, type MetaState } from "../../src/game/meta";
import { hazardOffers, type HazardId, type Ratchets } from "../../src/game/hazards";
import type { UpgradeTiers } from "../../src/game/upgrades";
import { previewRows } from "../../src/game/preview";
import { finalsForTier } from "../../src/game/finals";
import { levelForRun, newRun, RUN_LEVELS } from "../../src/game/run";
import { dailyContracts } from "../../src/game/contracts";

const ENTRIES: ScoreEntry[] = Array.from({ length: 24 }, (_, i) => ({
  // A long name is the wide case for the row's flexible column.
  name: i === 3 ? "LONGESTNAME" : `PILOT${i + 1}`,
  score: 98_760 - i * 1_137,
  level: 10 - (i % 10),
  lines: 240 - i * 7,
  created_at: 1_760_000_000 + i,
}));

const SETTINGS: Settings = {
  sound: true, music: true, haptics: true, seenDragHint: true, seenTutorial: true,
  leftHandRail: false, stickAssist: true,
};

const STORE = { available: true, unlimited: false };

/** The bay-clear ratchet at a given tentative selection. Both sides of the
 *  projection come from levelForRun, exactly as main.ts builds them, so the
 *  harness measures the real number of rows the screen can grow. */
function draft(selected: HazardId[]): string {
  const run = { ...newRun(20_260_815, [], 400, undefined, 6), levelIndex: 6, carry: 120, scrap: 340 };
  const withPicks: Ratchets = { ...HUD_BASE.ratchets };
  for (const id of selected) withPicks[id] = (withPicks[id] ?? 0) + 1;
  return S.draftScreen({
    bayNum: 6,
    bayName: "Slag Works",
    tier: 6,
    nextBayName: "Cryo Vault",
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

/** The FINAL INSPECTION (game/finals.ts) — the run's last draft.
 *
 *  Tier 10 deliberately: its clauses carry the longest copy in the table and
 *  its projection is the widest the screen can produce, because the pair moves
 *  cargo size and the launch price at once on a bay that already has four
 *  banked axes pinned ACTIVE. A screen that fits this fits every other Tier's.
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
    bayName: "Gravity Well",
    tier: 10,
    nextBayName: "Compactor Core",
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
  // A full run's pick history — the mods row is the plant panel's widest child.
  // Typed, because `spill` and `drift` were sitting here: ids no HazardId ever
  // had, so two of the four chips the "widest child" is supposed to be measured
  // at were never rendered. Ratchets is a weak type, so the pair typechecked.
  ratchets: { wind: 2, sweeper: 1, cryo: 1, slag: 2 } as Ratchets,
  tiers: { bay: 2, launcher: 1, hydraulics: 3, magazine: 1, reactor: 2, bonds: 1, demolition: 0 },
};

const PROGRESS = tierProgressFor(midMeta());

/** The menu's first-session inputs (canvas A2/A3), mid-progression: the one
 *  NEXT STEP badge on Workshop (salvage covers an install) and the live
 *  numbers the subtitles state the offer in. */
const GUIDE = {
  step: "workshop" as const,
  install: { name: "Loader Magazine", cost: 25 },
  firstLaunch: false,
};

/** A first-bay HUD as the tutorial actually meets it: stock rig, no abilities,
 *  bay 1's real numbers (LEVEL_1). The coach only ever runs on bay 1 of a
 *  fresh player's Deep Run, so measuring it over HUD_BASE would price a rail
 *  and a mods row the first session cannot have. */
const HUD_TUTORIAL = {
  beltPreview: { bomb: false, type: "T" as PieceType, quarterTurns: 0, empty: false, hidden: false, material: "standard" as const },
  loaded: { bomb: false, type: "L" as PieceType, quarterTurns: 0, empty: false, hidden: false, material: "standard" as const },
  tier: 1,
  target: LEVEL_1.targetScore,
  score: LEVEL_1.startingFunds,
  launchCost: LEVEL_1.launchCost,
  bayNum: 1,
  timeLimitSec: LEVEL_1.timeLimitSec,
  timeLeftMs: LEVEL_1.timeLimitSec * 1000,
  pieceSize: "std" as const,
  bondBreakerOwned: false,
  bondCharges: 0,
  demoOwned: false,
  autoloaderOwned: false,
  bombCharges: 0,
  ratchets: {} as Ratchets,
  tiers: { bay: 0, launcher: 0, hydraulics: 0, magazine: 0, reactor: 0, bonds: 0, demolition: 0 },
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
  // A2's first launch: the SEVENTH action row (Guided Tutorial, badged) plus
  // the upsell chip — the tallest menu the app can produce, which is exactly
  // why it is its own fixture.
  "menu-first": () =>
    S.menuScreen(0, 0, STORE, tierProgressFor(newMeta()), {
      step: "contracts",
      install: { name: "Reactor Output", cost: 15 },
      firstLaunch: true,
    }),

  howto: () => S.howtoScreen(),
  settings: () => S.settingsScreen(SETTINGS, STORE),
  // The Controls screen (canvas D1), one fixture per family: the keyboard tab
  // in its capture state (the widest row copy), the gamepad tab with a real
  // pad id detected (the longest Detected line).
  "controls-touch": () =>
    S.controlsScreen({ tab: "touch", settings: SETTINGS, padName: null, rebinding: null }),
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
  // (HUD_BASE, six of seven tracks bought) told it nothing about the moment
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
      tiers: { bay: 0, launcher: 0, hydraulics: 0, magazine: 0, reactor: 0, bonds: 0, demolition: 0 },
    }),
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
  pause: () => S.hudHTML({ ...HUD_BASE, contract: null }) + S.pauseModal(),
  bayclear: () =>
    S.hudHTML({ ...HUD_BASE, contract: null }) +
    S.bayClearScreen({
      bayNum: 7, bayName: "Cryo Vault", funds: 1_820, target: 1_700, lines: 14, scrap: 96,
    }),

  refit: () =>
    S.refitScreen({ bayNum: 6, nextBayName: "Cryo Vault", scrap: 340, tiers: HUD_BASE.tiers, mark: 6 }),

  draft: () => draft([]),
  // The draft with a notch SELECTED is the taller state — the projection grows
  // a struck-through old value on every row the pick moves, and the capstone's
  // two-pick hand moves the most rows at once. Measured as its own screen so a
  // projection that fits empty and overflows selected cannot pass.
  "draft-picked": () => draft(["cost", "sweeper"]),

  // The Final Inspection, both states, for the same reason the draft ships
  // both: accepting a clause grows a struck-through old value on every row it
  // moves, and the Tier-10 pair moves the most rows of any pair.
  inspection: () => inspection(null),
  "inspection-signed": () => inspection("dead-weight"),

  // The tutorial, EVERY step. It used to be the two extremes — step 0 (plant
  // fully collapsed) and step 3 (most of the readout revealed) — on the
  // reasoning that they bracket the card's height budget. They do not: the
  // budget is the card's copy against what the reveal has already spent, and
  // those two vary independently, so a middle step can be tighter than both
  // ends (step 2 carries the second-longest body with Reload and Launches
  // already taking their rows). Every step ships to every first-session
  // player and each is read once, in one glance; there is no reason for the
  // harness to see half of them. Four fixtures, one per card.
  coach: () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 0, S.coachHTML(0, LEVEL_1)),
  "coach-rotate": () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 1, S.coachHTML(1, LEVEL_1)),
  "coach-row": () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 2, S.coachHTML(2, LEVEL_1)),
  "coach-final": () => withCoach(S.hudHTML({ ...HUD_TUTORIAL, contract: null }), 3, S.coachHTML(3, LEVEL_1)),
  // The tutorial-failure modal over the dead bay's HUD — "broke" carries the
  // fullest explanation copy of the three causes.
  "coach-fail": () =>
    S.hudHTML({ ...HUD_TUTORIAL, contract: null }) + S.coachFailHTML("broke", LEVEL_1, LEVEL_1.name),

  // The one PORTRAIT screen: run.ts swaps the device's axes for it. `show` is
  // main.ts's toggle; without it the guard is display:none and measures as
  // nothing.
  guard: () => S.rotateGuardHTML().replace('class="rotate-guard"', 'class="rotate-guard show"'),

  "end-won": () => endModal(true),
  "end-lost": () => endModal(false),

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
};

function endModal(won: boolean): string {
  return S.endModal({
    won,
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
    // the segment to a full sentence: still 0 across all 13 devices). What the
    // value buys is the row at its real height, which is what the fit,
    // offscreen and tap assertions measure the rest of the modal against.
    salvagedFunds: 12_480,
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
  auto: HUD_BASE.autoloaderOwned,
};
const NO_RAIL = { bond: false, demo: false, auto: false };
export function railLoadoutFor(id: string): { bond: boolean; demo: boolean; auto: boolean } {
  return id === "hud" || id === "hud-rich" || id === "hud-notched"
    || id === "pause" || id === "bayclear"
    ? HUD_LOADOUT
    : NO_RAIL;
}
