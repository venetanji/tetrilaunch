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
  | "play" | "contracts" | "workshop" | "howto" | "leaderboard" | "settings" | "star";

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
