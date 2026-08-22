/**
 * ICONS — the menu's option glyphs, inlined as SVG.
 *
 * These replace the emoji the menu used to mix in (a clipboard on Contracts, a
 * cog on Workshop, nothing on the other four), which was inconsistent in two
 * ways at once: only some options had one, and the ones that did were drawn by
 * the platform. An emoji is a font glyph the device owns — it renders as
 * Android's full-colour art here, Apple's there, and a flat outline on desktop
 * Chrome, it cannot take the neon accent colour the rest of the button uses,
 * and its metrics shift the button's height by a pixel or two per platform.
 *
 * Inline SVG fixes all three: one drawing everywhere, `currentColor` so a glyph
 * inherits whatever the button is already doing (including `.btn--secondary`'s
 * hover, which recolours the label to the accent), and a fixed box so the
 * button's height is ours rather than the font's.
 *
 * Drawn on a 16x16 grid with integer coordinates, square caps and mitred
 * joins — blocky rather than rounded, because the surrounding design system is
 * a pixel typeface and deliberately steppy geometry (see the rivets, the
 * chunky toggle). A rounded outline set would read as a different product.
 */

export type IconName =
  | "play" | "contracts" | "workshop" | "howto" | "leaderboard" | "settings" | "star"
  // One per upgrade track (upgrades.ts's UPGRADES). These replaced three-letter
  // codes — "BAY", "LCH", "HYD" — which were text pretending to be glyphs: they
  // needed reading rather than recognising, and at refit-card size the reading
  // cost was the whole point of the header.
  | "bay" | "launcher" | "hydraulics" | "magazine" | "reactor" | "bonds" | "demolition"
  // One per option unlock (meta.ts's UNLOCKS). Same id-is-the-icon-name
  // convention as the tracks above: the shop card casts the id at the call
  // site, so there is no glyph field on UnlockDef and meta.ts never imports
  // from ui/. A row card leads with the glyph, so an unlock without one leaves
  // a hole where every other row has its mark.
  | "demo" | "bulk" | "survey" | "scrap-cache" | "micro"
  | "sturdy" | "overclock" | "short-lines" | "bond-breaker" | "auto"
  // Direction of a value change on the refit buy button. These were the text
  // glyphs ▲/▼, which sat off-centre against the pixel label beside them for
  // exactly the reason in the header note: a font glyph carries the font's own
  // metrics, and those do not line up with a different family at a different
  // size. An SVG on a known 16x16 box does.
  | "up" | "down"
  // The control glyphs (canvas B5): the touch rail — the PRIMARY control
  // surface on mobile — ran on ⛶⏸⟲⟳✕⚡💥, i.e. emoji and dingbats the
  // platform draws. Android's full-colour art, Apple's flat art and desktop's
  // outlines disagree per device, none can take the button's accent colour,
  // and their metrics wobble the buttons. Emoji survive only in flavour copy
  // now, never in a control.
  | "pause" | "fullscreen" | "rotl" | "rotr" | "close" | "check" | "bond" | "retry"
  // THE TWO CURRENCIES, and they must never look alike. Both used to render as
  // the ♻ emoji — literally the same character for scrap and for salvage, on
  // the refit chip and the workshop chip, and on both shops' price buttons —
  // which is a currency confusion, not a styling one: a player reading "♻ 55"
  // in the yard and "♻ 15" in the Workshop has no way to know the two numbers
  // come out of different pockets, one that dies with the run and one that
  // never does. So they are drawn, they are a stroked pair of arcs against two
  // solid slabs of cut plate, and the paint mode is the tell at 11px (the same
  // argument `overclock` and `auto` settle between themselves below).
  | "salvage" | "scrap";

/** Inner markup per icon. Shapes that read better solid are filled; the rest
 *  stroke, and the wrapper supplies the shared stroke attributes. */
const PATHS: Record<IconName, string> = {
  // Launch triangle — solid, so the primary action reads heaviest.
  play: `<path d="M5 3l8 5-8 5z" fill="currentColor" stroke="none"/>`,
  // Clipboard: board, the clip tab on top, two lines of brief.
  contracts:
    `<path d="M3 4h10v10H3z"/><path d="M6 4V2h4v2"/><path d="M6 8h4"/><path d="M6 11h4"/>`,
  // A nut rather than a cog: six flats survive 14px far better than gear teeth,
  // and the Workshop is where you bolt things onto the ship.
  workshop: `<path d="M8 2l5 3v6l-5 3-5-3V5z"/><path d="M6.5 6.5h3v3h-3z"/>`,
  // An open manual, lines of text on both leaves.
  howto:
    `<path d="M2 3h12v10H2z"/><path d="M8 3v10"/><path d="M4 6h2"/><path d="M4 9h2"/><path d="M10 6h2"/><path d="M10 9h2"/>`,
  // Podium bars, tallest in the middle — solid, so it reads at a glance.
  leaderboard: `<path d="M2 13V9h3.5v4zM6.25 13V3h3.5v10zM10.5 13V6H14v7z" fill="currentColor" stroke="none"/>`,
  // Slider rows with square handles.
  settings:
    `<path d="M2 4h12"/><path d="M2 8h12"/><path d="M2 12h12"/>` +
    `<path d="M4.5 2.5h2.5v3H4.5z" fill="currentColor"/>` +
    `<path d="M9 6.5h2.5v3H9z" fill="currentColor"/>` +
    `<path d="M5.5 10.5h2.5v3H5.5z" fill="currentColor"/>`,
  star: `<path d="M8 2l1.8 4.2 4.2.4-3.2 2.9 1 4.5L8 11.6 4.2 14l1-4.5L2 6.6l4.2-.4z" fill="currentColor" stroke="none"/>`,

  // ---- upgrade tracks ----
  // Bay Extension: the wall, and the compaction zone widening away from it.
  // The arrow points the way the open stop actually moves.
  bay: `<path d="M13 2v12"/><path d="M3 8h8"/><path d="M6 5L3 8l3 3"/>`,
  // Launcher Coils: a barrel with the coil windings stacked along it, angled up
  // the way the cannon sits.
  launcher: `<path d="M2 12l9-9"/><path d="M4 9l2 2"/><path d="M6 7l2 2"/><path d="M8 5l2 2"/><path d="M11 2h3v3z" fill="currentColor" stroke="none"/>`,
  // Press Hydraulics: the compactor face with the ram behind it, pressing down.
  hydraulics: `<path d="M2 12h12"/><path d="M4 9h8v3H4z" fill="currentColor" stroke="none"/><path d="M8 2v5"/><path d="M6 4l2-2 2 2"/>`,
  // Loader Magazine: a belt of three shells feeding the breech.
  magazine: `<path d="M2 6h12v6H2z"/><path d="M5 6V3"/><path d="M8 6V3"/><path d="M11 6V3"/>`,
  // Reactor Output: a core with output rising off it — the funds engine.
  reactor: `<path d="M6 7h4v4H6z" fill="currentColor" stroke="none"/><path d="M3 13V10"/><path d="M8 13v-1"/><path d="M13 13V4"/><path d="M3 5l2-2 2 2"/>`,
  // Bond Emitter: a joint at the centre throwing bonds outward — the shatter.
  bonds: `<path d="M7 7h2v2H7z" fill="currentColor" stroke="none"/><path d="M8 6V2"/><path d="M8 10v4"/><path d="M6 8H2"/><path d="M10 8h4"/>`,
  // Demolition Rack: a charge, solid, with a lit fuse running off it. Straight
  // segments only — a curved fuse is the one shape in this set that would need
  // anti-aliasing to read, which is exactly what the pixel frame doesn't give.
  demolition: `<path d="M3 8h8v6H3z" fill="currentColor" stroke="none"/><path d="M9 8V5l3-2"/><path d="M12 3h2"/><path d="M12 3V1"/>`,

  // ---- Option unlocks (meta.ts's UNLOCKS) ---------------------------------
  // Demolition Licence: a detonation, not a charge — `demolition` above is the
  // rack you install, this is the permit that puts the card in the draft. Four
  // DIAGONAL spikes off a 4x4 core, where `bonds` throws four axis-aligned
  // ones off a 2x2: at 13px the diagonal/orthogonal split is what separates
  // them, so neither may drift toward the other's angles.
  demo:
    `<path d="M6 6h4v4H6z" fill="currentColor" stroke="none"/><path d="M4 4L2 2"/><path d="M12 4l2-2"/><path d="M4 12l-2 2"/><path d="M12 12l2 2"/>`,
  // Bulk Freight: a five-cube pentomino as one solid mass. Filled because the
  // mod's whole character is density (1.35x) — an outline would read light,
  // which is what `micro` is.
  bulk:
    `<path d="M3 3h6v4H3z" fill="currentColor" stroke="none"/><path d="M3 7h10v4H3z" fill="currentColor" stroke="none"/>`,
  // Weather Survey: three wind streaks of unequal length with a direction
  // chevron. Deliberately unequal and short of the box — `settings` is three
  // FULL-width rails with handles, and equal-length streaks would collide.
  survey:
    `<path d="M2 5h7"/><path d="M2 8h10"/><path d="M2 11h5"/><path d="M9 3l3 2-3 2"/>`,
  // Scrap Cache: a crate with an X brace. The brace is the whole idea — a plain
  // rect with a lid is `contracts`' clipboard at 13px, and nothing else in the
  // set uses a diagonal cross.
  "scrap-cache":
    `<path d="M2 5h12v9H2z"/><path d="M2 5l12 9"/><path d="M14 5L2 14"/>`,
  // Micro Freight: a two-cube domino, small and separated. The gap is load
  // bearing — closed up it is one 6x3 bar, and the point is that this piece is
  // two light cubes rather than one mass.
  micro:
    `<path d="M4 7h3v3H4z" fill="currentColor" stroke="none"/><path d="M9 7h3v3H9z" fill="currentColor" stroke="none"/>`,
  // Reinforced Bonds: two blocks and the link that HOLDS, with two cross-ties.
  // Reads as the opposite of `bond-breaker` below on purpose — same two blocks,
  // intact link versus snapped one.
  sturdy:
    `<path d="M2 6h3v4H2z" fill="currentColor" stroke="none"/><path d="M11 6h3v4h-3z" fill="currentColor" stroke="none"/><path d="M5 8h6"/><path d="M7 6v4"/><path d="M9 6v4"/>`,
  // Press Overclock: the press wall, and two chevrons for the sweep it now
  // makes 50% faster. Stroked throughout so it cannot be mistaken for `auto`
  // below, which is a filled block throwing filled shots.
  overclock:
    `<path d="M2 3v10"/><path d="M5 3l4 5-4 5"/><path d="M10 3l4 5-4 5"/>`,
  // Line Recalibration: a full line for reference, and above it the same span
  // closing inward — the row needs one fewer cube. Inward arrows rather than a
  // shortened bar, because a bar that is merely shorter has nothing to be
  // shorter THAN at 13px.
  "short-lines":
    `<path d="M2 6h5"/><path d="M9 6h5"/><path d="M5 4l2 2-2 2"/><path d="M11 4l-2 2 2 2"/><path d="M2 12h12"/>`,
  // Bond Breaker: two blocks driven apart by a bolt. The bolt matches the ⚡
  // the in-game button already uses for this mod, so the shop and the field
  // agree on what it looks like.
  "bond-breaker":
    `<path d="M2 6h3v4H2z" fill="currentColor" stroke="none"/><path d="M11 6h3v4h-3z" fill="currentColor" stroke="none"/><path d="M8 3l-2 5h4l-2 5"/>`,
  // Autoloader: the launcher block and two shots already away. Filled block +
  // filled shots against `overclock`'s all-stroke wall + chevrons — the paint
  // mode is the tell, since both are "a thing on the left throwing right".
  auto:
    `<path d="M2 4h3v8H2z" fill="currentColor" stroke="none"/><path d="M7 7h2v2H7z" fill="currentColor" stroke="none"/><path d="M11 7h2v2h-2z" fill="currentColor" stroke="none"/>`,

  // Solid triangles, centred on the 16x16 box so both read at the same optical
  // height whichever way they point.
  up: `<path d="M8 4l5 8H3z" fill="currentColor" stroke="none"/>`,
  down: `<path d="M8 12L3 4h10z" fill="currentColor" stroke="none"/>`,

  // ---- control glyphs (canvas B5) -----------------------------------------
  // Two solid bars — the one shape everyone reads as pause at any size.
  pause: `<path d="M4.5 3h2.5v10H4.5z" fill="currentColor" stroke="none"/><path d="M9 3h2.5v10H9z" fill="currentColor" stroke="none"/>`,
  // Four corners opening outward. Square caps keep it on the pixel grid where
  // ⛶'s font metrics floated it.
  fullscreen:
    `<path d="M2 6V2h4"/><path d="M10 2h4v4"/><path d="M14 10v4h-4"/><path d="M6 14H2v-4"/>`,
  // The rotate pair: a three-quarter arc with a blocky arrowhead at its open
  // end. Mirrored, not rotated — the arrowheads must sit at the TOP on both,
  // where a thumb on the rail actually looks.
  rotl: `<path d="M12.6 11.2A5.6 5.6 0 1 1 12.6 4.8"/><path d="M13.4 1.6v3.8H9.6"/>`,
  rotr: `<path d="M3.4 11.2A5.6 5.6 0 1 0 3.4 4.8"/><path d="M2.6 1.6v3.8h3.8"/>`,
  close: `<path d="M3.5 3.5l9 9"/><path d="M12.5 3.5l-9 9"/>`,
  check: `<path d="M2.5 8.5l4 4L13.5 4.5"/>`,
  // The Bond Breaker bolt — the same silhouette `bond-breaker`'s shop glyph
  // throws between its blocks, solid here because it is a lit trigger.
  bond: `<path d="M9.5 1L4 9h3.2L6 15l6-8H8.6z" fill="currentColor" stroke="none"/>`,
  // Salvage — the FOREVER currency: two arcs chasing each other with blocky
  // arrowheads. Recycling, because salvage is what the wreck of a dead run
  // comes back as, and it is the cycle that never ends.
  salvage:
    `<path d="M12.8 6A5.2 5.2 0 0 0 3.5 5"/><path d="M13.5 2.2v3.9H9.6"/>` +
    `<path d="M3.2 10a5.2 5.2 0 0 0 9.3 1"/><path d="M2.5 13.8V9.9h3.9"/>`,
  // Scrap — the ONE-RUN currency: two offcuts of cut plate, stacked, sheared
  // opposite ways so the pair reads as loose material rather than a repeated
  // pattern. Deliberately the opposite of `salvage` on both axes a glyph has at
  // 11px: solid against stroked, and flat straight edges against a rotating
  // cycle of arcs. Nothing here curves, so at the size it renders in on a price
  // button it can never be read as the arcs.
  //
  // It was a jagged heap first, and the heap was wrong for a reason worth
  // keeping: a flat-bottomed silhouette with three notches in its top edge is a
  // CROWN at 22px and up, and a crown means rank. Every "pile" variant landed
  // somewhere in crown / mountain range / sunrise — the notched-top silhouette
  // is too well spoken for. Straight sheared slabs mean stock metal and nothing
  // else.
  scrap:
    `<path d="M4 3h7l2 3H6z" fill="currentColor" stroke="none"/>` +
    `<path d="M4 8h9l-2 5H2z" fill="currentColor" stroke="none"/>`,
  // The retry arrow (was the ↻ dingbat on Try/Play Again buttons).
  retry: `<path d="M3.4 11.2A5.6 5.6 0 1 0 3.4 4.8"/><path d="M2.6 1.6v3.8h3.8"/>`,
};

/**
 * One icon, sized to the text it sits beside.
 *
 * `aria-hidden` because every caller pairs the glyph with its own visible label
 * — announcing "leaderboard leaderboard" is worse than announcing nothing.
 * `flex: none` so a long label can never squeeze the glyph out of square.
 */
export function icon(name: IconName, size = 14): string {
  return `<svg class="ico" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"
    >${PATHS[name]}</svg>`;
}
