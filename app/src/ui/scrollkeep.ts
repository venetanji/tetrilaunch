/**
 * Keeping the player's place in a shelf across a wholesale re-render.
 *
 * THE DEFECT this exists for, in the owner's words: "after a purchase the
 * scroll refreshes to the top". There is no component framework here — a
 * screen is a pure function returning a string, and main.ts's renderOverlay
 * rewrites `overlay.innerHTML` wholesale on every state change. So a Workshop
 * purchase does not update the shelf; it replaces it, and a FRESH element
 * scrolls to 0. Buying the seventh system on a 900px shelf inside a 180px pane
 * threw the player 725px back up, onto stock they had already read past.
 *
 * SCOPED TO `[data-scroll]`, which is app.css's deliberate scroll opt-in (see
 * its "THE scroll opt-in" note and sim/uifit/run.ts's ALLOWED_SCROLLERS): the
 * five regions whose content is genuinely unbounded — a shop with more stock
 * than screen, a leaderboard, the refit shelf, the bindings list, the guide
 * index. Those are places a player LIVES in, and an offset in one is a
 * position they chose. The backstop scrollers (`.coach__body`,
 * `.guide__body`) are deliberately not included: those have `overflow-y: auto`
 * as a safety valve and needing it is a CI failure, so restoring an offset
 * into one would be preserving a defect's symptom — and worse, they carry
 * per-selection PROSE, where the old offset belongs to text that is no longer
 * on screen.
 *
 * PURE, over the smallest structural shape an element can present, so the
 * whole rule is reachable from sim/systems.ts with no browser in the room —
 * the same split revealShift makes in padnav.ts. The DOM half (which regions
 * exist, and when a re-render counts as "the same view redrawn") stays at the
 * one call seam in main.ts.
 */

/** As much of an element as this file needs: an identity and an offset. */
export interface ScrollRegion {
  readonly id: string;
  readonly className: string;
  scrollTop: number;
}

/**
 * The identity a region is matched by across the rewrite.
 *
 * ID FIRST — four of the five regions carry one (`#lb-body`, `#refit-grid`,
 * `#controls-grid`, `#guide-list`), and an id is the most stable name a
 * screen gives anything. The Workshop's shelf has only a class, so the FIRST
 * class stands in: first rather than the whole `className`, because a state
 * class appended later ("is-empty", a mid-purchase flash) must not silently
 * rename the region and turn this restore back into the jump it fixes.
 *
 * A region with neither is unidentifiable and gets no restore — the honest
 * answer, since matching it by position alone would let a Workshop shelf's
 * offset land in the guide index the moment the player navigated between two
 * screens that each have exactly one scroller.
 */
export function scrollKey(r: ScrollRegion): string {
  if (r.id) return r.id;
  return r.className.trim().split(/\s+/)[0] ?? "";
}

/**
 * Where the player is in each shelf of the OUTGOING screen.
 *
 * Offsets of 0 are not recorded: a shelf at the top restores to the top by
 * doing nothing, and leaving them out means the restore below can skip its
 * work entirely on the overwhelmingly common render that had nobody scrolled
 * anywhere.
 */
export function captureScroll(regions: Iterable<ScrollRegion>): Map<string, number> {
  const keep = new Map<string, number>();
  for (const r of regions) {
    const key = scrollKey(r);
    if (key && r.scrollTop > 0) keep.set(key, r.scrollTop);
  }
  return keep;
}

/**
 * Put each shelf of the INCOMING screen back where its predecessor was.
 *
 * A key with no match in the new markup is dropped rather than guessed at —
 * the region genuinely stopped existing, and there is nowhere for its offset
 * to go. An offset past the new content simply clamps, which is the right
 * answer when the shelf got shorter (the last system on it was just bought).
 */
export function restoreScroll(
  regions: Iterable<ScrollRegion>,
  keep: ReadonlyMap<string, number>,
): void {
  if (keep.size === 0) return;
  for (const r of regions) {
    const y = keep.get(scrollKey(r));
    if (y !== undefined) r.scrollTop = y;
  }
}
