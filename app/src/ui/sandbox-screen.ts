/**
 * TIER S — the sandbox's level selection screen.
 *
 * WHAT CHANGED, AND WHY IT IS NOT THE SAME SCREEN ANY MORE.
 *
 * This was a developer tool: a wall of unlabelled chips, deliberately ugly,
 * on the argument that every pixel spent making it pretty was a pixel not
 * spent on a row of buttons. That was right while it was reachable only from a
 * build nobody ships. It is wrong now — the mode has a floor under the tower
 * (screens.ts's SANDBOX_TIER), a board of its own (lib/api.ts's
 * BOARD_SANDBOX), and a player on the other side of it who has never read
 * hazards.ts. A tool can assume its reader knows what "sbx-rig" means; a game
 * mode has to say what the thing does.
 *
 * So the screen is now organised the way the DECISION is organised, in three
 * columns that answer three questions in order:
 *
 *   1. WHAT ARE YOU FLYING — a Deep Run bay, a Contract, a lines Contract —
 *      and at which Mark. This is the choice everything else hangs off, so it
 *      is one column on its own and nothing else is in it.
 *   2. HOW HARD — the rig you bring, the belt you face, the axes already
 *      notched onto the bay. Three separate kinds of "harder", grouped.
 *   3. WHAT YOU GET — the briefing, derived from the real pipeline, and the
 *      launch button under it.
 *
 * THE BRIEFING IS NOT WRITTEN, IT IS DERIVED. Every number in column 3 comes
 * from `sandboxRunFor` + `levelForRun` (or the shipping Contract generator) —
 * the exact calls main.ts makes on launch. A practice bay that is not the bay
 * it advertised teaches the wrong lesson with total confidence, which is worse
 * than teaching nothing, and a hand-written summary would drift from the
 * tables the first time anyone retunes them.
 *
 * THE SAVE-EDITING CHEATS ARE STILL BUILD-GATED. Everything above ships. The
 * row that can set the Mark, grant salvage, unlock everything and wipe the
 * save does not: it renders only when lib/sandbox.ts's SANDBOX is true, it is
 * the only thing on this screen that carries SANDBOX_MARKER, and
 * scripts/verify-store-bundle.mjs fails any shippable bundle that contains it.
 * The mode is a mode; the cheats are a cheat.
 */
import {
  applySandboxMaterials, ratchetTotal, sandboxAxes, sandboxFinals, sandboxRunFor,
  SANDBOX_BAYS, SANDBOX_FINAL_BAY, SANDBOX_MATERIALS, SANDBOX_RATCHET_MAX,
  SANDBOX_TIERS, sandboxVariants,
  type SandboxState,
} from "../game/sandbox";
import { MATERIAL_SPEC } from "../game/theme";
import { formatMMSS, materialIconHTML } from "./components";
import {
  generateContract, levelForContract, PATTERN_SLOT, variantSpec,
} from "../game/contracts";
import { levelForRun, RUN_LEVELS } from "../game/run";
import { finalById } from "../game/finals";
import { MAX_TIER, tiersCost, UPGRADES, type UpgradeTiers } from "../game/upgrades";
import type { MetaState } from "../game/meta";
import { tierIncluded } from "../game/meta";

export interface SandboxScreenOpts {
  s: SandboxState;
  meta: MetaState;
  /** Personal best on the Tier S board (lib/store.ts's loadBest). */
  best: number;
  /** The save-editing row's markup, or "" — lib/sandbox-cheats.ts's
   *  cheatRowHTML, rendered by the caller.
   *
   *  A STRING rather than a `dev: boolean` this module would branch on, and
   *  the reason is the tree-shake: main.ts is the one place that writes
   *  `SANDBOX ? cheatRowHTML(...) : ""`, so Rollup eliminates the branch, the
   *  call and the whole cheats module from every shippable bundle. A boolean
   *  here would have put the row's markup in this module — which ships. */
  cheats?: string;
  /** Whether the tier-3 gate is open (main.ts's fullGame()). Tier S is a
   *  level SELECT, not a level GRANT: without this the easter egg was a free
   *  tour of all ten Tiers' hazards, materials and finals — the exact content
   *  the gate sells. Free accounts keep the sandbox for the Tiers they hold,
   *  the tower's own rule (meta.ts's tierIncluded). */
  fullGame: boolean;
}

/* ---------------------------------------------------------------------------
 * Chips. One shape for every selection on the screen, because every selection
 * on the screen is the same kind of thing: a value out of a small set, chosen
 * by tapping it. A screen that invents a second control for the fourth row is
 * a screen the player has to learn twice.
 * ------------------------------------------------------------------------ */
interface Chip {
  value: string | number;
  text: string;
  on: boolean;
  /** Locked — greyed, still rendered. A developer (or a player) looking for
   *  "where did Guided go" is better served by a chip that says "tier 9" than
   *  by an absence, and this was already the old screen's rule. */
  off?: boolean;
  title?: string;
  /** Notches taken, for the axis chips — drawn as a pip row. */
  pips?: number;
}

function chipHTML(action: string, key: string, c: Chip): string {
  const pips = c.pips !== undefined
    ? `<span class="sbx-chip__pips" aria-hidden="true">${
        Array.from({ length: SANDBOX_RATCHET_MAX }, (_, i) =>
          `<i${i < (c.pips ?? 0) ? ' class="on"' : ""}></i>`).join("")
      }</span>`
    : "";
  return `<button class="sbx-chip${c.on ? " is-on" : ""}" type="button"`
    + `${c.off ? " disabled" : ""} data-action="${action}" data-${key}="${c.value}"`
    + `${c.title ? ` title="${c.title}"` : ""} aria-pressed="${c.on}">`
    + `${c.text}${pips}</button>`;
}

function rowHTML(label: string, hint: string, chips: string, mod = ""): string {
  return `<div class="sbx-row${mod ? ` sbx-row--${mod}` : ""}">
    <div class="sbx-row__lbl">${label}${hint ? `<span>${hint}</span>` : ""}</div>
    <div class="sbx-row__opts">${chips}</div>
  </div>`;
}

function chipRow(
  label: string, hint: string, action: string, key: string, options: Chip[], mod = "",
): string {
  return rowHTML(label, hint, options.map((o) => chipHTML(action, key, o)).join(""), mod);
}

/* ---------------------------------------------------------------------------
 * The briefing — column 3.
 * ------------------------------------------------------------------------ */
function factHTML(label: string, value: string, tint?: string): string {
  return `<div class="sbx-fact"><span class="sbx-fact__lbl">${label}</span>`
    + `<span class="sbx-fact__val"${tint ? ` style="color:${tint}"` : ""}>${value}</span></div>`;
}

/** What a Deep Run launch would actually build, read off the real pipeline.
 *  levelForRun is the function the Game is constructed from, so nothing here
 *  can promise a bay the launch does not deliver. */
function bayBriefing(s: SandboxState, meta: MetaState): string {
  const run = sandboxRunFor(s, meta.unlocks);
  const cfg = applySandboxMaterials(levelForRun(run), s.material);
  const bay = run.levelIndex + 1;
  const notches = ratchetTotal(s.ratchets);
  // The clause is already IN the numbers above — levelForRun applied it while
  // building cfg, which is the whole reason the briefing is derived rather than
  // written. This only names it, so a raised Target has something on the panel
  // that accounts for it. Read back off the run rather than off `s.final` so it
  // shows exactly when it BITES: on bay 10 and not on the nine before it.
  const clause = run.levelIndex === RUN_LEVELS - 1 ? finalById(run.final ?? "") : undefined;
  return `<div class="sbx-brief">
    <div class="sbx-brief__ttl">${cfg.name}</div>
    <div class="sbx-brief__sub">Bay ${bay}/${RUN_LEVELS} · Tier ${run.mark} · ${cfg.pieceSize} shipments${
      notches > 0 ? ` · ${notches} notch${notches === 1 ? "" : "es"}` : ""
    }${clause ? ` · ${clause.name}` : ""}</div>
    ${clause
      ? `<p class="sbx-brief__clause"><b>${clause.name}</b> ${clause.desc}</p>`
      : ""}
    <div class="sbx-brief__facts">
      ${factHTML("Target", `$${cfg.targetScore}`, "var(--accent)")}
      ${factHTML("Float", `$${cfg.startingFunds}`, "var(--warn)")}
      ${factHTML("Launch", `$${cfg.launchCost}`)}
      ${factHTML("Clock", formatMMSS(cfg.timeLimitSec * 1000))}
      ${factHTML("Shots", `${Math.floor((cfg.startingFunds) / Math.max(1, cfg.launchCost))}`)}
      ${factHTML("Bonds", cfg.jointBreakStretch === Infinity ? "∞" : `×${cfg.jointBreakStretch.toFixed(1)}`)}
    </div>
    <p class="sbx-brief__note">The run continues from here — clear the bay and it drafts,
      refits and rolls on to bay ${RUN_LEVELS} exactly as a Deep Run does. Nothing it earns
      leaves Tier S.</p>
  </div>`;
}

/** The Contract the current settings would launch, generated with the SHIPPING
 *  generator so the panel and the LAUNCH button cannot drift. Regenerating on
 *  every render is free at this size and is what makes RESEED a one-tap way to
 *  walk the whole space one variant can produce at one tier. */
function contractBriefing(s: SandboxState): string {
  const c = s.target.kind === "pattern"
    ? generateContract(s.seed, s.tier, PATTERN_SLOT, s.target.variant)
    : generateContract(s.seed, s.tier, 0);
  const cfg = levelForContract(c);
  const wall = c.standing.reduce((a, h) => a + h, 0);
  return `<div class="sbx-brief">
    <div class="sbx-brief__ttl">${c.name}</div>
    <div class="sbx-brief__sub">Tier ${c.tier} · ${
      c.variant === "plain" ? "Plain" : variantSpec(c.variant).name
    } · ${c.pieceSize} shipments</div>
    <p class="sbx-brief__brief">${c.brief}</p>
    <div class="sbx-brief__facts">
      ${factHTML("Goal", String(c.goal), "var(--accent)")}
      ${factHTML("Line", `${c.lineCells} cells`)}
      ${factHTML(c.kind === "pattern" ? "Queue" : "Launches",
        c.kind === "pattern" ? `${c.queue.length} pcs` : String(c.launches))}
      ${factHTML("Clock", cfg.timeLimitSec > 0 ? formatMMSS(cfg.timeLimitSec * 1000) : "none")}
      ${wall > 0 ? factHTML("Wall", c.standing.join("·")) : ""}
      ${c.material ? factHTML("Cargo", c.material) : ""}
    </div>
    <p class="sbx-brief__note">A Contract strips the run economy — no rig, no funds, no
      refit — so the rig and axes above are ignored here. ${
        c.kind === "pattern"
          ? "The queue tiles the goal exactly: every shipment has a right place."
          : "Retry it as often as you like; the seed is the puzzle."
      }</p>
    <div class="sbx-brief__id">${c.id}</div>
  </div>`;
}

/* ---------------------------------------------------------------------------
 * The rig — column 2.
 * ------------------------------------------------------------------------ */
function rigHTML(tiers: UpgradeTiers): string {
  const chips = UPGRADES.map((u) => {
    const t = tiers[u.id] ?? 0;
    return `<button class="sbx-chip sbx-chip--rig${t > 0 ? " is-on" : ""}" type="button"
      data-action="sbx-rig" data-track="${u.id}" title="${u.name} — tap to raise, wraps at ${MAX_TIER}">
      <span class="sbx-chip__n">${u.name.split(" ")[0]}</span>
      <span class="sbx-chip__pips" aria-hidden="true">${
        Array.from({ length: MAX_TIER }, (_, i) => `<i${i < t ? ' class="on"' : ""}></i>`).join("")
      }</span></button>`;
  }).join("");
  return `${chips}
    <button class="sbx-chip sbx-chip--act" type="button" data-action="sbx-rig-max">MAX</button>
    <button class="sbx-chip sbx-chip--act" type="button" data-action="sbx-rig-none">STOCK</button>`;
}

/**
 * THE FINAL INSPECTION — column 2's last row, and the one thing on this screen
 * that could not be reached at all before it existed.
 *
 * A clause is dealt by CLEARING BAY 9 (run.ts's isFinalDraft) and applies to
 * bay 10 and nowhere else. So seeing one meant playing nine bays correctly and
 * then being offered the half of the pair you were not trying to look at — and
 * the pair is the Tier's own exam, the most Tier-specific content in the game.
 * Twenty clauses, each previously behind a complete run of the right rung.
 *
 * Two properties this row has to keep honest.
 *
 *  - IT ONLY MEANS ANYTHING ON BAY 10, because that is the only bay levelForRun
 *    applies it to. So picking a clause MOVES the target there (main.ts's
 *    sbx-final) rather than quietly doing nothing, and the hint says which bay
 *    you are being sent to. The alternative — letting a clause sit selected over
 *    bay 3 and silently not apply — is the exact "advertised a bay it did not
 *    deliver" failure this screen's whole briefing column exists to prevent.
 *  - THE PAIR BELONGS TO THE MARK. finalsForTier is the game's own table, so
 *    changing the Mark changes which two are on offer; main.ts drops a selection
 *    that the new rung does not carry (sandbox.ts's finalFitsTier), because a
 *    clause in force with no chip lit is worse than no clause at all.
 *
 * NONE is a chip rather than an absence, and it is the default: the ladder's
 * own bay 10 — the one every player actually meets first — is the one with no
 * clause on it yet, and it has to stay selectable after you have looked at the
 * other two.
 */
function inspectionRow(s: SandboxState, isBay: boolean): string {
  const pair = sandboxFinals(s.tier);
  const onBay10 = s.target.kind === "bay" && s.target.bay === SANDBOX_FINAL_BAY;
  const hint = !isBay
    ? "Deep Run only"
    : onBay10
      ? `bay ${SANDBOX_FINAL_BAY}'s clause`
      : `sends you to bay ${SANDBOX_FINAL_BAY}`;
  return chipRow("Inspection", hint, "sbx-final", "final", [
    {
      value: "none",
      text: "None",
      on: s.final === null,
      off: !isBay,
      title: `Bay ${SANDBOX_FINAL_BAY} exactly as the ladder deals it`,
    },
    ...pair.map((f) => ({
      value: f.id,
      text: f.name,
      on: s.final === f.id,
      off: !isBay,
      // The clause's own text, with its number in it — the same string the
      // inspection modal shows, so what you read here is what you accepted.
      title: `${f.desc} — Tier ${f.tier}'s exam, on the ${f.system} half`,
    })),
  ], "pack");
}

export function sandboxScreen(opts: SandboxScreenOpts): string {
  const { s, meta, best } = opts;
  const isBay = s.target.kind === "bay";
  const variants = sandboxVariants(s.tier);
  const axes = sandboxAxes(s.tier);
  const notches = ratchetTotal(s.ratchets);

  // The three modes, as one row — the choice everything below hangs off.
  const modes = [
    { value: "bay", text: "Deep Run", on: isBay,
      title: "A real run, started at the bay you pick, on the rig you pick" },
    { value: "pattern", text: "Contract", on: s.target.kind === "pattern",
      title: "A generated pattern Contract — a fixed queue that tiles the goal" },
    { value: "lines", text: "Lines", on: s.target.kind === "lines",
      title: "The tier's launch-budget Contract: clear lines inside a shot budget" },
  ];

  return `<div class="screen neon-backdrop">
    <div class="sbx">
      <header class="sbx__hdr">
        <div class="sbx__id">
          <span class="sbx__plate" aria-hidden="true">S</span>
          <span>
            <span class="eyebrow">Tier S · Sandbox</span>
            <h2 class="display sbx__ttl">Level select</h2>
          </span>
        </div>
        <p class="sbx__lede">Fly any rung, any bay, any Contract, on any rig. Nothing here
          pays salvage or moves the ladder — Tier S keeps its own board.</p>
        <div class="sbx__hdr-end">
          <div class="sbx__best"><span>Tier S best</span><b>${best || "—"}</b></div>
          <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
        </div>
      </header>

      <div class="sbx__cols">
        <section class="sbx-col" aria-label="What to fly">
          <h3 class="sbx-col__ttl">What</h3>
          ${chipRow("Mode", "", "sbx-mode", "mode", modes)}
          ${chipRow("Tier", "difficulty rung", "sbx-tier", "tier",
            // Locked, not hidden — the same choice the variant row makes one
            // row down ("locked ones show their rung"): a chip that vanishes
            // teaches nothing, a chip that says why it refuses sells the why.
            SANDBOX_TIERS.map((t) => ({
              value: t, text: String(t), on: t === s.tier,
              off: !tierIncluded(t, opts.fullGame),
              title: tierIncluded(t, opts.fullGame) ? undefined : "Full Game required",
            })))}
          ${
            isBay
              ? chipRow("Bay", `start cold at any of the ${RUN_LEVELS}`, "sbx-target", "target",
                  SANDBOX_BAYS.map((b) => ({
                    value: `bay${b}`,
                    text: String(b),
                    on: s.target.kind === "bay" && s.target.bay === b,
                  })))
              : chipRow("Variant", "locked ones show their rung", "sbx-variant", "variant",
                  variants.map((v) => ({
                    value: v.id,
                    text: v.locked ? `${v.name} · t${v.tier}` : v.name,
                    on: s.target.kind === "pattern" && s.target.variant === v.id,
                    off: v.locked || s.target.kind === "lines",
                  })))
          }
          ${rowHTML("Seed", "walks the generator", `
            <button class="sbx-chip sbx-chip--seed" type="button" data-action="sbx-reseed"
              title="Re-roll — every Contract is a function of this number">↻ ${s.seed}</button>`)}
        </section>

        <section class="sbx-col" aria-label="How hard">
          <h3 class="sbx-col__ttl">How hard</h3>
          ${rowHTML("Rig", isBay ? `${tiersCost(s.tiers)} pts installed` : "Deep Run only", rigHTML(s.tiers))}
          ${chipRow("Belt", "what the cannon ships", "sbx-material", "material", [
            { value: "mix", text: "Ladder mix", on: s.material === "mix",
              title: "Exactly what the Tier deals" },
            { value: "all", text: "Parade", on: s.material === "all",
              title: "An even run of all six — for comparing them side by side" },
            ...SANDBOX_MATERIALS.map((m) => ({
              value: m,
              text: `${materialIconHTML(m, 13)} ${MATERIAL_SPEC[m].name}`,
              on: s.material === m,
            })),
          ], "pack")}
          ${chipRow(
            "Axes",
            isBay
              ? `pre-ratcheted · ${notches}/${axes.length * SANDBOX_RATCHET_MAX}`
              : "Deep Run only",
            "sbx-axis", "axis",
            axes.map((h) => ({
              value: h.id,
              text: h.name,
              on: (s.ratchets[h.id] ?? 0) > 0,
              off: !isBay,
              title: `${h.desc(s.tier)} — tap to notch, wraps at ${SANDBOX_RATCHET_MAX}`,
              pips: s.ratchets[h.id] ?? 0,
            })),
            "pack",
          )}
          ${notches > 0 && isBay
            ? `<button class="sbx-chip sbx-chip--act sbx-axes__clear" type="button"
                data-action="sbx-axis-clear">Clear axes</button>`
            : ""}
          ${inspectionRow(s, isBay)}
          ${opts.cheats ?? ""}
        </section>

        <section class="sbx-col sbx-col--brief" aria-label="Briefing">
          <h3 class="sbx-col__ttl">Briefing</h3>
          ${isBay ? bayBriefing(s, meta) : contractBriefing(s)}
          <button class="btn btn--primary btn--lg btn--block sbx__launch" data-action="sbx-launch">
            ${isBay ? `Launch bay ${s.target.kind === "bay" ? s.target.bay : 1}` : "Launch Contract"}
          </button>
        </section>
      </div>
    </div>
  </div>`;
}
