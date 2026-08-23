/**
 * The developer sandbox screen — pick a rung, launch it, skip the ladder.
 *
 * Lives in its own module rather than in screens.ts so the whole thing is one
 * import that a shippable build never makes (see lib/sandbox.ts for the gate and
 * why the tree-shake is backed by a grep). Same conventions as every other
 * screen: a pure function returning HTML, driven entirely by `data-action`
 * attributes that main.ts's delegated click handler routes.
 *
 * The layout is deliberately dense and unstyled-looking. This is a tool, not a
 * screen anyone is meant to enjoy, and every pixel spent making it pretty is a
 * pixel not spent on a row of buttons — which is the only thing it is for.
 */
import { SANDBOX_MARKER } from "../lib/sandbox";
import {
  SANDBOX_BAYS, SANDBOX_TIERS, sandboxVariants, type SandboxState,
} from "../game/sandbox";
import { generateContract, PATTERN_SLOT, variantSpec } from "../game/contracts";
import { MAX_TIER, UPGRADES } from "../game/upgrades";
import type { MetaState } from "../game/meta";

function chipRow(
  label: string, action: string, key: string,
  options: Array<{ value: string | number; text: string; on: boolean; off?: boolean }>,
): string {
  const buttons = options.map((o) =>
    `<button class="sbx-chip${o.on ? " sbx-chip--on" : ""}"${o.off ? " disabled" : ""} ` +
    `data-action="${action}" data-${key}="${o.value}">${o.text}</button>`).join("");
  return `<div class="sbx-row"><span class="sbx-row__lbl">${label}</span>
    <div class="sbx-row__opts">${buttons}</div></div>`;
}

export function sandboxScreen(s: SandboxState, meta: MetaState): string {
  const variants = sandboxVariants(s.tier);

  // The Contract the current settings would actually launch, generated with the
  // SHIPPING generator so what the panel promises and what the LAUNCH button
  // produces cannot drift. Regenerating it on every render is free at this size
  // and is what makes RESEED a one-tap way to walk the whole space a variant can
  // produce at a tier.
  let preview = "";
  if (s.target.kind !== "bay") {
    const c = s.target.kind === "pattern"
      ? generateContract(s.seed, s.tier, PATTERN_SLOT, s.target.variant)
      : generateContract(s.seed, s.tier, 0);
    const wall = c.standing.reduce((a, h) => a + h, 0);
    preview = `<div class="sbx-preview">
      <div class="sbx-preview__ttl">${c.name}${
        c.variant === "plain" ? "" : ` · ${variantSpec(c.variant).name}`
      }</div>
      <div class="sbx-preview__brief">${c.brief}</div>
      <div class="sbx-preview__facts">
        goal ${c.goal} · line ${c.lineCells} cells · ${c.pieceSize}
        ${c.kind === "pattern" ? ` · set ${c.queue.join("")}` : ` · ${c.launches} launches`}
        ${wall > 0 ? ` · wall [${c.standing.join(",")}]` : ""}
        ${c.material ? ` · ${c.material}` : ""}
      </div>
      <div class="sbx-preview__id">id ${c.id}</div>
    </div>`;
  } else {
    preview = `<div class="sbx-preview">
      <div class="sbx-preview__ttl">Deep Run · bay ${s.target.bay} at Mark ${s.tier}</div>
      <div class="sbx-preview__brief">Starts a real run positioned at that bay. Hazards
        are un-ratcheted — the draft has not happened, because it did not happen.</div>
      <div class="sbx-preview__facts">rig ${
        UPGRADES.map((u) => `${u.id.slice(0, 3)}${s.tiers[u.id] ?? 0}`).join(" ")
      }</div>
    </div>`;
  }

  const rig = UPGRADES.map((u) => {
    const t = s.tiers[u.id] ?? 0;
    return `<button class="sbx-chip${t > 0 ? " sbx-chip--on" : ""}" data-action="sbx-rig" data-track="${u.id}">
      ${u.name.split(" ")[0]} ${t}/${MAX_TIER}</button>`;
  }).join("");

  return `<div class="screen screen--fit neon-backdrop">
    <div class="sbx" data-build="${SANDBOX_MARKER}">
      <div class="sbx__hdr">
        <div>
          <div class="eyebrow">Not in any shipped build</div>
          <h2 class="display" style="font-size:var(--fs-h2)">Sandbox</h2>
        </div>
        <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
      </div>

      ${chipRow("Tier / Mark", "sbx-tier", "tier",
        SANDBOX_TIERS.map((t) => ({ value: t, text: String(t), on: t === s.tier })))}

      ${chipRow("Variant", "sbx-variant", "variant", variants.map((v) => ({
        value: v.id,
        // A locked variant keeps its rung on the button rather than vanishing:
        // "where did Guided go" is a worse question than "Guided: tier 9".
        text: v.locked ? `${v.name} · t${v.tier}` : v.name,
        on: s.target.kind === "pattern" && s.target.variant === v.id,
        off: v.locked,
      })))}

      ${chipRow("Other", "sbx-target", "target", [
        { value: "lines", text: "Lines Contract", on: s.target.kind === "lines" },
        ...SANDBOX_BAYS.map((b) => ({
          value: `bay${b}`,
          text: `Bay ${b}`,
          on: s.target.kind === "bay" && s.target.bay === b,
        })),
      ])}

      <div class="sbx-row"><span class="sbx-row__lbl">Rig</span>
        <div class="sbx-row__opts">
          ${rig}
          <button class="sbx-chip" data-action="sbx-rig-max">MAX ALL</button>
          <button class="sbx-chip" data-action="sbx-rig-none">STOCK</button>
        </div>
      </div>

      <div class="sbx-row"><span class="sbx-row__lbl">Save</span>
        <div class="sbx-row__opts">
          <button class="sbx-chip" data-action="sbx-grant-mark">Mark := tier (now ${meta.mark})</button>
          <button class="sbx-chip" data-action="sbx-grant-salvage">+1000 salvage (${meta.salvage})</button>
          <button class="sbx-chip" data-action="sbx-unlock-all">Unlock everything</button>
          <button class="sbx-chip sbx-chip--warn" data-action="sbx-wipe">Wipe save</button>
        </div>
      </div>

      ${preview}

      <div class="sbx__foot">
        <button class="btn btn--ghost" data-action="sbx-reseed">↻ Reseed</button>
        <button class="btn btn--primary btn--lg" data-action="sbx-launch">▶ Launch</button>
      </div>
    </div>
  </div>`;
}
