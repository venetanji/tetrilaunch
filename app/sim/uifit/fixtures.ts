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
import { newMeta, tierProgressFor, type MetaState } from "../../src/game/meta";
import { hazardOffers } from "../../src/game/hazards";
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
};

const STORE = { available: true, unlimited: false };

/** A mid-run meta: salvage banked, some unlocks owned, so the Workshop renders
 *  its owned strip as well as its grid (the taller of the two states). */
function midMeta(): MetaState {
  const m = newMeta();
  m.salvage = 1_480;
  m.runs = 37;
  m.bestBay = 8;
  return m;
}

/** Four digits of funds against a four-digit target — the readout width that
 *  regressed before (see sim/systems.ts's "$1000+ wrap regression"). */
const HUD_BASE = {
  beltPreview: { bomb: false, type: "T" as PieceType, quarterTurns: 1, empty: false, material: "cryo" as const },
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
  ratchets: { spill: 2, drift: 1, cryo: 1, slag: 2 },
  tiers: { bay: 2, launcher: 1, hydraulics: 3, magazine: 1, reactor: 2, bonds: 1, demolition: 0 },
};

const PROGRESS = tierProgressFor(midMeta());

/**
 * Screen id -> markup. Ids are stable: run.mjs, the PNG filenames and any
 * allowlist in the assertions all key off them.
 */
export const SCREENS: Record<string, () => string> = {
  splash: () => S.splashScreen(),

  menu: () => S.menuScreen(98_760, 1_480, STORE, PROGRESS),
  // The entitled state swaps the upsell chip for the ★ badge; both have to fit.
  "menu-unlimited": () =>
    S.menuScreen(98_760, 1_480, { available: true, unlimited: true }, PROGRESS),

  howto: () => S.howtoScreen(),
  settings: () => S.settingsScreen(SETTINGS, STORE),
  leaderboard: () => S.leaderboardScreen(S.leaderboardRowsHTML(S.fullBoard(ENTRIES), "PILOT4")),

  "workshop-systems": () => S.workshopScreen(midMeta(), "systems"),
  "workshop-options": () => S.workshopScreen(midMeta(), "options"),

  contracts: () =>
    S.contractsScreen({
      contracts: dailyContracts(3, 20_260_815),
      tier: 3,
      cleared: [],
      progress: PROGRESS,
    }),

  hud: () => S.hudHTML({ ...HUD_BASE, contract: null }),
  "hud-contract": () =>
    S.hudHTML({
      ...HUD_BASE,
      timeLimitSec: 0,
      contract: {
        name: "Cold Storage Backlog",
        kind: "pattern",
        goal: 4,
        lines: 1,
        launchesLeft: 6,
        remaining: ["I", "O", "T", "L", "J", "S"] as PieceType[],
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

  draft: () =>
    S.draftScreen({
      bayNum: 6,
      bayName: "Slag Works",
      nextBayName: "Cryo Vault",
      funds: 1_820,
      carry: 120,
      offers: hazardOffers(20_260_815, 6, 6),
      ratchets: HUD_BASE.ratchets,
      picked: [],
      picksNeeded: 2,
      scrap: 340,
      baysToRefit: 2,
    }),

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
    tiers: HUD_BASE.tiers,
  });
}

export const SCREEN_IDS = Object.keys(SCREENS);
