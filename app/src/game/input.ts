import { Game } from "./game";
import { screenToWorld } from "./render";
import { actionForKey, keyFor } from "./bindings";
import { MIN_FIRE_RATIO } from "./cannon";
import { WORLD } from "./engine";

/**
 * Canvas aiming + keyboard fallback (web). TWO SCHEMES, split by device.
 *
 * MOUSE — point at where you want the shipment to go and the arc follows the
 * cursor, button or no button; clicking fires it. The angle and power are
 * solved backwards out of the forward ballistics model (game.ts's aimAt →
 * cannon.ts's solveAimForTarget), so the dotted arc runs through the cursor
 * rather than being something the player has to construct by feel.
 *
 * HOVER AIMS, and that is the newer half. The scheme originally only tracked
 * the cursor while the button was HELD, which meant the answer to "where would
 * this shot go" cost a press — and a press on this device is also a launch, so
 * the only way to ask the question was to commit to the answer. Tracking on
 * plain movement makes the arc a readout instead of a transaction: the player
 * moves over the bay, reads where each spot puts the shipment, and clicks the
 * one they wanted. See onMove's hover branch for what "a valid position" means
 * and hoverAimable for when the bay will answer at all.
 *
 * IT IS A REAL AIM, not a ghost drawn beside the committed one. The cannon
 * swings, cannon.angle/power move, and a keyboard Fire pressed mid-hover
 * launches exactly the arc on screen. A second "preview aim" that the dots
 * showed and the shot did not use would break the one contract this whole file
 * and cannon.ts's solver exist to keep (dots == solver == shot), and it would
 * break it in the direction that costs launches. The cost of that choice is
 * that sweeping the cursor across the bay on the way to a rail button leaves
 * the barrel wherever it left the field — which is visible, in the arc, before
 * anything is spent.
 *
 * TOUCH (and pen, and any pointer type the browser will not vouch for) — the
 * original Angry-Birds drag. Press anywhere, pull away, and the drag vector
 * sets direction and power with the cannon reversing it 180°, so pulling back
 * fires forward. The drag is bound to the pointer that started it, so a SECOND
 * finger can tap the side-rail buttons mid-aim (rotate keeps the drag alive;
 * the ✕ cancels it via cancelAim) without its release firing the shot.
 *
 * WHY TOUCH DOES NOT GET TARGETING, since the obvious question is why the two
 * halves of one game now hold two different opinions about aiming:
 *
 *  1. A FINGER COVERS ITS OWN TARGET. The whole value of pointing at a spot is
 *     watching the arc arrive there, and on a phone the spot is underneath the
 *     thumb. The pull-back gesture exists in every slingshot game on the
 *     platform precisely because it puts the hand somewhere other than the
 *     thing being aimed at. A mouse cursor is a few px of arrow with the hand
 *     nowhere near the glass.
 *  2. THE MISFIRE GATE WOULD HAVE NOTHING LEFT TO READ. MIN_FIRE_RATIO exists
 *     because a stray touch on the canvas used to fire a full shot at an aim
 *     nobody chose (see cannon.ts's writeup), and it works by asking how far
 *     the gesture travelled — a question that only has an answer because the
 *     gesture has length. Under tap-to-target every graze is simultaneously a
 *     complete, valid aim and a complete, valid launch, and there is no signal
 *     left to separate the accident from the intent. That gate is the single
 *     most valuable thing on the touch input path and this change would delete
 *     it. The mouse never had it and never needed it: a click is a deliberate
 *     act at a pixel the player chose, which is the same line drawn here as in
 *     onUp's pointerType note and in app.css's `pointer: fine` rules.
 *  3. The onboarding hint, the coach's first card, the guide's Aim & Fire entry
 *     and the misfire correction all teach the pull-back and are all already
 *     scoped to touch. Keeping the gesture keeps them true.
 *
 * The line is drawn at `pointerType === "mouse"` — the same line onUp's
 * misfire gate already draws, and for the same stated reason: pen and unknown
 * pointer types land on touch hardware.
 *
 * A release only counts as a shot once the pull reached MIN_FIRE_RATIO of the
 * ship's power (see cannon.ts) — everything under that is treated as an
 * accidental touch and cancelled. `onMisfire` reports those so the HUD can say
 * so; it takes CLIENT coordinates because what it drives is DOM chrome (the
 * drag-hint guide, placed at the thumb), and the game has no business knowing
 * about CSS pixels.
 *
 * ROTATION ON THE MOUSE (right button ⟳, middle button ⟲) is what makes the
 * left-click scheme above a COMPLETE control scheme rather than most of one.
 * Aiming and firing were already on the mouse; turning the shipment was not,
 * so a desktop player still had to reach for the keyboard or the on-screen
 * rail between every shot for the one input that decides whether the piece
 * fits. Both gestures land on the same pair the keyboard, the gamepad and the
 * rail all call (cannon.rotateLeft/rotateRight + updateTrajectory, via
 * `rotate` below), so there is exactly one definition of what "turn it" means.
 * THE WHEEL'S SCROLL is the arc-height dial instead (see onWheel) — it turned
 * the piece for one play session, and what that session taught is that the
 * click-to-target scheme's real missing input was loft, not a third rotate.
 *
 * NONE OF THEM TOUCH THE GESTURE IN PROGRESS. `rotate` reads no drag state and
 * writes none: no dragStart, no dragPointerId, no aimBefore, no pendingTarget.
 * That is the same contract the side-rail rotate buttons already keep (a
 * second finger on the rail leaves the drag alive; only the ✕ cancels it), and
 * it is what lets a player hold the left button on a spot, turn the piece, and
 * watch the arc through that same spot redraw around the new shape.
 *
 * All are MOUSE-ONLY by construction, and deliberately so — see onDown's
 * button guard for why the pointerType test is there rather than a bare
 * `e.button !== 0`. Touch and pen take the identical path they took before.
 */

/** Pixels of wheel travel that earn one NOTCH (one loft step), and the unit
 *  every device's delta is converted into. 100 because that is what a physical
 *  detent reports on every clicky wheel worth naming: Chrome and Edge on
 *  Windows send deltaY 100 per notch, Firefox sends deltaMode 1 with deltaY 3
 *  (three lines, hence WHEEL_STEP_PX / 3 below), and a Windows "one screen at
 *  a time" setting sends deltaMode 2 with deltaY 1. The devices that DON'T
 *  land on 100 — Magic Mouse, trackpads, anything with inertia — are exactly
 *  the ones that send a continuous stream of small deltas instead, which is
 *  what the accumulator is for. Getting this wrong in the low direction is
 *  much worse than in the high: a threshold under a real notch spends the
 *  whole loft range on one flick, so every trackpad scroll would slam the dial
 *  to an end stop instead of stepping it. */
const WHEEL_STEP_PX = 100;

export type RotateDir = "left" | "right";

/** Loft the wheel adds or removes per notch (Game.aimLoft is 0..1, so five
 *  notches walk the whole family from the flattest arc to the steepest).
 *  Scroll UP raises the arc — the one mapping with a physical reading. */
const LOFT_STEP = 0.2;

/** Vertical drag that walks the loft dial end to end under the CLASSIC-WHEEL
 *  option (settings.wheelRotates — the wheel turns the shipment, so arc
 *  height moves onto "hold the right button mid-aim and drag up/down").
 *  150 CSS px ≈ a comfortable wrist stroke: short enough to reach either
 *  stop without re-gripping, long enough that one px of jitter moves the
 *  dial under 1%. */
const LOB_DRAG_PX = 150;

/** One wheel event's worth of NOTCHES, as a pure function of the accumulator
 *  and the event's raw delta, so it can be tested against real device traces
 *  without a browser (sim/systems.ts drives both a detent mouse and a trackpad
 *  flick through it).
 *
 *  WHY ACCUMULATE AT ALL. One notch of a real mouse wheel is a single event
 *  and rotating on it is correct. A trackpad two-finger swipe is thirty-odd
 *  events of a few px each covering the same distance, and rotating on each
 *  would spin the piece a dozen times for one flick — through four
 *  orientations three times over, landing somewhere the player did not choose.
 *  Summing until the total crosses one notch makes both devices mean the same
 *  thing by distance travelled rather than by event count.
 *
 *  A DIRECTION CHANGE RESETS rather than subtracting, so a scroll up after 90px
 *  of scroll down does not need 190px to register. The accumulator is asking
 *  "how far have you pushed THIS way", and pushing the other way ends that
 *  question.
 *
 *  THE REMAINDER IS DROPPED on a fire rather than carried, so no single event
 *  can ever be worth more than one turn. That is what keeps an inertial fling
 *  honest — one 400px momentum delta, or one deltaMode 2 page, is one turn and
 *  not four, which on a piece with four faces would land exactly back where it
 *  started. It also means a tiny nudge cannot trip a turn off change banked
 *  from a scroll the player has long since forgotten: every notch starts from
 *  zero. */
export function wheelNotch(
  accum: number,
  deltaY: number,
  deltaMode: number,
): { accum: number; notch: -1 | 0 | 1 } {
  // deltaMode is the unit the device chose to speak in — 0 px, 1 lines,
  // 2 pages — and it is per-EVENT, not per-device: the same wheel can switch
  // modes when a modifier or an OS setting changes. Normalising here rather
  // than at the call site means the threshold above is one number in one unit.
  const px = deltaY * (deltaMode === 1 ? WHEEL_STEP_PX / 3 : deltaMode === 2 ? WHEEL_STEP_PX : 1);
  if (px === 0) return { accum, notch: 0 };
  const next = Math.sign(px) === Math.sign(accum) ? accum + px : px;
  if (Math.abs(next) < WHEEL_STEP_PX) return { accum: next, notch: 0 };
  // +1 is a wheel-DOWN notch (positive deltaY); the caller owns what a
  // direction means, which is what let this survive the wheel changing jobs
  // (it turned the shipment once; it lofts the arc now).
  return { accum: 0, notch: px > 0 ? 1 : -1 };
}

/**
 * Is this world point somewhere the player could be pointing AT?
 *
 * The bay is 16:9 and the viewport is not, so screenToWorld happily returns
 * points out in the letterbox bands and in the strip the control rail is
 * parked over (render.ts's computeViewport reserves it). A CLICK out there is
 * still a click — the player pressed the button, they meant something by it,
 * and the solver's clamps turn it into the nearest honest arc. A HOVER out
 * there is just a mouse on its way somewhere, and answering it would swing the
 * barrel at the bay's edge every time the cursor crossed the band on its way
 * to a menu.
 *
 * Hence: the same path for both, one extra test on the hover. The world rect
 * rather than the playable interior (WALL_INNER) because the walls, the chute
 * mouth and the floor are all things a player legitimately aims at the face
 * of, and half a cube of slop at the boundary is smaller than the payload.
 */
function inField(p: { x: number; y: number }): boolean {
  return p.x >= 0 && p.x <= WORLD.width && p.y >= 0 && p.y <= WORLD.height;
}

export class InputController {
  private canvas: HTMLCanvasElement;
  private game: () => Game | null;
  private onMisfire?: (clientX: number, clientY: number) => void;
  private keys = new Set<string>();
  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragPointerId: number | null = null;
  /** Power ratio the CURRENT gesture has asked for, 0 until a move applies one.
   *  Zeroed on every pointerdown, so a tap — which never reaches applyAim —
   *  reads 0 and is cancelled rather than firing the last drag's shot. */
  private dragRatio = 0;
  /** Whether the gesture in progress is one the firing floor applies to, i.e.
   *  not a mouse. Recorded at pointerdown because the PWR readout has to mirror
   *  the GATE, and the gate is per-event — see liveDragRatio. */
  private dragGated = false;
  /** Whether the gesture in progress is TARGETING (mouse) rather than dragging.
   *  Recorded at pointerdown alongside dragGated and from the same test, so one
   *  gesture can never be half of each: a pointer that started as a drag stays
   *  a drag for its whole life even if the browser were to change its mind
   *  about the device mid-gesture. */
  private targeting = false;
  /** World point the most recent pointermove asked the cannon to aim at, held
   *  until the next animation frame applies it.
   *
   *  COALESCED, unlike the drag, and the asymmetry is real work rather than
   *  tidiness. Applying a drag is one atan2 and one lerp; applying a target is
   *  a search over the whole aim cone that runs the forward ballistics model
   *  something like 1,600 times (cannon.ts's solveAimForTarget). That is well
   *  under a millisecond, but a high-polling-rate mouse can deliver pointermove
   *  far faster than the display refreshes, and there is nothing to be gained
   *  from solving an aim for a cursor position that will never be drawn. So
   *  moves record where the cursor is and the existing rAF tick spends the
   *  budget once per frame. pointerdown and pointerup apply straight through:
   *  the first is the press the player is waiting to see answered, and the last
   *  decides where the shot actually goes. */
  private pendingTarget: { x: number; y: number } | null = null;
  /** The last point applyTarget actually SOLVED, kept for the wheel: the loft
   *  dial re-solves "the arc I am looking at", and once the button is up that
   *  is the last clicked point. Paired with the Game it was solved FOR, and
   *  onWheel checks the pair, because this controller outlives the bay — a
   *  point remembered in one bay's coordinates is a lie in the next one's,
   *  and the first scroll of a fresh bay must adjust the dial without
   *  swinging the barrel at a ghost. */
  private lastTarget: { x: number; y: number } | null = null;
  private lastTargetFor: Game | null = null;
  /** Live lob drag under the classic-wheel option: where the chord started
   *  (client Y and the loft it found) — null in the default scheme and
   *  whenever no chord is held. While set, ordinary moves dial Game.aimLoft
   *  from the vertical delta and the TARGET stays frozen at lobTarget: a
   *  hand pulling straight down still drifts a few px sideways, and a dial
   *  that also dragged the landing point would be two controls fighting on
   *  one gesture. */
  private lobFrom: { y: number; loft: number } | null = null;
  private lobTarget: { x: number; y: number } | null = null;
  /** The aim as it stood when the current gesture STARTED, restored if that
   *  gesture turns out to be a misfire. Without it a graze that travels far
   *  enough to move the cannon but not far enough to fire still costs the
   *  player the shot they had lined up — the accident would be free of ammo
   *  and expensive in setup, which is only half a fix. */
  private aimBefore: { angle: number; power: number } | null = null;
  /** Wheel travel banked toward the next loft notch, in normalised px. Lives
   *  on the controller rather than inside onWheel because a trackpad's notch
   *  is spread across many events (see wheelNotch). Zeroed whenever the wheel
   *  arrives on a bay that is not being played, so a half-notch banked before
   *  a pause cannot fall out of the machine on the first scroll after it. */
  private wheelAccum = 0;
  private raf = 0;

  /** settings.wheelRotates, read live so the Controls toggle applies without
   *  a restart — same contract as gamepad.ts's hooks. */
  private wheelRotates: () => boolean;

  constructor(
    canvas: HTMLCanvasElement,
    game: () => Game | null,
    onMisfire?: (clientX: number, clientY: number) => void,
    wheelRotates: () => boolean = () => false,
  ) {
    this.canvas = canvas;
    this.game = game;
    this.onMisfire = onMisfire;
    this.wheelRotates = wheelRotates;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    // The hover aim's off-switch. pointerleave and not pointerout: leave
    // fires once when the pointer actually exits the canvas, where out also
    // fires on every move between a child and its parent — the canvas has no
    // children today, but a handler that drops the aim on an event that means
    // "moved inside" is a trap for whoever adds one.
    canvas.addEventListener("pointerleave", this.onLeave);
    // ON THE CANVAS, NOT ON WINDOW, and that placement is the whole answer to
    // "does the wheel break scrolling anywhere". A wheel listener only runs
    // when the event's target is the element or a descendant, the canvas has no
    // descendants, and every screen that scrolls — Controls, Workshop, the
    // guide — is a DOM overlay that is not inside it. So a scroll over those
    // never reaches this handler and never sees a preventDefault. Same for
    // contextmenu: right-clicking a menu is still a right-click on a menu.
    // passive: false because the default for wheel on a scrollable region is
    // passive, and a passive listener's preventDefault is ignored with a
    // console warning — the page would scroll out from under the bay.
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.raf = requestAnimationFrame(this.tickKeys);
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    cancelAnimationFrame(this.raf);
  }

  /** Abort the drag in progress without firing (the aim-state ✕ button, or
   *  a browser pointercancel). The cannon keeps its last aim; the finger
   *  still held down is orphaned, so releasing it afterwards is a no-op. */
  cancelAim(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.dragStart = null;
    this.dragPointerId = null;
    this.dragRatio = 0;
    this.targeting = false;
    this.pendingTarget = null;
    this.lobFrom = null;
    this.lobTarget = null;
    // The ✕ deliberately does NOT restore the pre-drag aim, unlike a misfire.
    // The player pulled, watched the arc, and chose to stand down — the aim
    // they are looking at is the one they built, and snapping it back to
    // whatever preceded it would undo work they meant to do.
    this.aimBefore = null;
    const g = this.game();
    if (g) g.aiming = false;
  }

  /** The power ratio the live gesture is currently asking for, or null when no
   *  drag is in progress. The PWR meter reads THIS rather than cannon.powerRatio
   *  while aiming: the cannon holds the last APPLIED power, so during a tap or a
   *  sub-4px wobble the meter would advertise a shot the release is not going to
   *  fire — the readout siding with the bug it exists to expose. */
  get liveDragRatio(): number | null {
    // Null for a MOUSE gesture, so the meter falls back to cannon.powerRatio.
    // The floor does not apply to a mouse (see onUp's pointerType note), and a
    // readout that turns red and reads 0% for a release that is going to fire
    // normally is the same class of lie in the other direction — the meter
    // siding against the gate instead of with it.
    return this.dragging && this.dragGated ? this.dragRatio : null;
  }

  private worldPoint(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return screenToWorld(rect.width, rect.height, rect.left, rect.top, e.clientX, e.clientY);
  }

  private applyAim(e: PointerEvent): void {
    const g = this.game();
    if (!g || !this.dragStart) return;
    const p = this.worldPoint(e);
    // Slingshot: aim from the drag delta (works anywhere on screen), and the
    // cannon reverses it 180° so pulling back fires forward.
    this.dragRatio = g.cannon.aimFromDrag(p.x - this.dragStart.x, p.y - this.dragStart.y);
    g.updateTrajectory();
  }

  /** Solve the cannon onto a world point and redraw. The miss the solver
   *  reports is deliberately dropped on the floor here: the ARC is the report.
   *  A target outside the cannon's envelope comes back as the nearest arc it
   *  can throw, drawn short of the cursor with the PWR meter pinned, and that
   *  is a truer answer than any badge this class could raise — it says how far
   *  short, in the same picture that says everything else about the shot. See
   *  cannon.ts's solveAimForTarget for the reasoning, and note that a caller
   *  wanting to say something about it has `hit` available there. */
  private applyTarget(p: { x: number; y: number }): void {
    this.pendingTarget = null;
    // Remembered for the wheel (see lastTarget). Never read for firing — a
    // shot still spends the aim the cannon holds.
    this.lastTarget = p;
    this.lastTargetFor = this.game();
    this.game()?.aimAt(p);
  }

  /** Turn the loaded shipment, from wherever the request came from. The pair
   *  and the redraw are the same ones bindings.ts's "rotl"/"rotr" reach through
   *  the keyboard (onKey), the gamepad (gamepad.ts's act) and the side rail
   *  (main.ts's onGameAction) — one definition, four doors.
   *
   *  READS AND WRITES NO GESTURE STATE, which is the load-bearing property
   *  rather than an accident of it being short. A rotation arriving mid-aim
   *  must leave the drag exactly as it found it: the target the player is
   *  holding the button on, the pointer id that owns the gesture, and the
   *  pre-gesture aim the misfire path would restore. updateTrajectory then
   *  redraws the arc from that untouched aim around the new shape, which is
   *  precisely "keep the target, re-solve the picture". */
  private rotate(dir: RotateDir): void {
    const g = this.game();
    // Same guard onDown uses, checked here rather than at each call site
    // because both callers reach the game through the same accessor and there
    // is no third state either of them could be in.
    if (!g || g.status !== "playing" || g.paused) return;
    if (dir === "right") g.cannon.rotateRight();
    else g.cannon.rotateLeft();
    g.updateTrajectory();
  }

  private onDown = (e: PointerEvent): void => {
    // NON-PRIMARY MOUSE BUTTONS NEVER START AN AIM. Until this guard existed a
    // right-press ran the whole targeting gesture and its release called
    // shoot() — the barrel swung to wherever the cursor was and fired, because
    // onDown never looked at e.button and onUp's misfire gate is deliberately
    // skipped for a mouse (see there). That is a shot spent on a gesture the
    // player made to open a context menu. It predates the click-to-target
    // scheme: the old drag path had the same hole, a right-press just took a
    // drag's worth of movement to become expensive instead of being wrong on
    // contact.
    //
    // GATED ON pointerType, not written as a bare `e.button !== 0`, and the
    // distinction matters. Touch and pen report button 0 for the contact that
    // starts a gesture, so a bare test would pass them through unchanged — but
    // a pen with its barrel button held reports 2 or 5 for the same physical
    // press, and gating on the button alone would silently stop that pen from
    // aiming at all. The pointerType line is the one this whole file already
    // draws (the header, the misfire gate, app.css's `pointer: fine`), and
    // drawing it once more here keeps every non-mouse device on the byte-identical
    // path it was on before mouse rotation existed.
    if (e.pointerType === "mouse" && e.button !== 0) {
      // ⟳ on the right button, matching the rail's primary rotate — the two
      // sit next to each other in a desktop player's head and disagreeing
      // about which way "the rotate one" turns is worse than either choice.
      //
      // This branch handles the FRESH right-click only. The mid-aim chord —
      // hold the left button on the gap, right-click to turn the piece until
      // it fits — never reaches this handler in a real browser: Pointer
      // Events fire `pointerdown` only when the FIRST button takes the mouse
      // from no-buttons to pressed, and a button chorded onto a held one
      // arrives as a `pointermove` naming the changed button (found in
      // review; the first draft rotated here "before the dragging bail" and
      // the gesture it advertised was unreachable). onMove owns the chord
      // now; the `!dragging` gate below is what keeps a browser that fires
      // both events for a chord from turning the piece twice.
      if (e.button === 2 && !this.dragging) this.rotate("right");
      // ⟲ on the middle button — the wheel's PRESS, which stayed free when
      // the wheel's scroll changed jobs to the loft dial. The pair reads as
      // one rocker in the hand: right button clockwise, the button to its
      // left counter-clockwise, and a piece with four faces is never more
      // than two presses from any orientation whichever one the thumb finds
      // first. Same `!dragging` double-fire guard as the right button, same
      // chord path through onMove.
      else if (e.button === 1 && !this.dragging) this.rotate("left");
      return;
    }
    const g = this.game();
    if (!g || g.status !== "playing" || g.paused) return;
    // A second finger landing on the canvas mid-aim (reaching for the rail
    // and missing a button) must not re-anchor the drag in progress.
    if (this.dragging) return;
    this.dragging = true;
    this.dragGated = e.pointerType !== "mouse";
    this.targeting = e.pointerType === "mouse";
    this.dragPointerId = e.pointerId;
    this.dragStart = this.worldPoint(e);
    this.dragRatio = 0;
    this.aimBefore = { angle: g.cannon.angle, power: g.cannon.power };
    g.aiming = true;
    this.canvas.setPointerCapture?.(e.pointerId);
    // The cannon swings on the PRESS, not on the first move after it. A mouse
    // player's click is usually press-and-release with no move in between, so
    // waiting for a move would mean the most common gesture on the device fired
    // the previous shot's aim — the same stale-aim bug the touch path's misfire
    // gate exists to prevent, arriving through the other door.
    if (this.targeting) this.applyTarget(this.dragStart);
  };

  private onMove = (e: PointerEvent): void => {
    // THE MID-AIM CHORD LANDS HERE — see onDown's button-guard note. A button
    // pressed while another is held is a `pointermove` whose `button` names
    // the changed button and whose `buttons` bitmask carries its new state;
    // `buttons & 2` set means the right button just went DOWN (its release
    // reports the same button 2 with the bit cleared, and must not turn the
    // piece a second time). An ordinary move reports button -1, so this costs
    // every other move one integer compare. Falls through rather than
    // returning: the event still carries a position, and the whole point of
    // rotating mid-aim is watching the arc through the held target redraw
    // around the new shape.
    if (e.pointerType === "mouse" && e.button === 2 && (e.buttons & 2) !== 0) {
      if (this.wheelRotates() && this.dragging && this.targeting) {
        // CLASSIC-WHEEL OPTION: the wheel owns rotation, so this chord is
        // the arc-height drag instead — anchor it at the loft the dial
        // currently holds and at the target being aimed, both frozen for
        // the stroke's whole life.
        const g = this.game();
        if (g) {
          this.lobFrom = { y: e.clientY, loft: g.aimLoft };
          this.lobTarget = this.pendingTarget ?? this.lastTarget;
        }
      } else {
        this.rotate("right");
      }
    } else if (e.pointerType === "mouse" && e.button === 1 && (e.buttons & 4) !== 0) {
      // The middle button's chord — note `button` 1 but bitmask 4: the
      // event's `button` numbers the buttons left-to-right while `buttons`
      // gives the middle bit 4, an asymmetry the spec owns, not this file.
      // Same job in both wheel modes: nothing else wants the wheel's press.
      this.rotate("left");
    }
    // The lob drag in progress, if any. Ends the moment the right button's
    // bit clears — the chord's release is itself a pointermove (button 2,
    // bit gone), and any move after a release missed by the canvas reports
    // the same cleared mask, so the state cannot wedge on.
    if (this.lobFrom) {
      if ((e.buttons & 2) === 0) {
        this.lobFrom = null;
        this.lobTarget = null;
      } else {
        const g = this.game();
        if (g && this.lobTarget) {
          // Pull UP for more loft — the arc rises with the hand. Clamped to
          // the dial's own range, and routed through pendingTarget so the
          // rAF tick re-solves once per drawn frame like any other move.
          const next = Math.min(1, Math.max(0,
            this.lobFrom.loft + (this.lobFrom.y - e.clientY) / LOB_DRAG_PX));
          if (next !== g.aimLoft) {
            g.aimLoft = next;
            this.pendingTarget = this.lobTarget;
          }
        }
        // The cursor's position is the dial's input now, not the target's.
        return;
      }
    }
    if (!this.dragging) {
      // THE HOVER AIM. Mouse only — the line this file draws everywhere else,
      // and here it is not a judgement call but a fact about the hardware:
      // touch has no hover to read, a finger that is not touching the glass
      // reports nothing at all, so the touch scheme is untouched by
      // construction rather than by a guard someone has to remember.
      if (e.pointerType !== "mouse") return;
      const g = this.game();
      // Anything the bay will not answer clears the queued solve rather than
      // leaving it to fall out of the next frame — see hoverAimable.
      const p = g && this.hoverAimable(g) ? this.worldPoint(e) : null;
      this.pendingTarget = p && inField(p) ? p : null;
      return;
    }
    if (e.pointerId !== this.dragPointerId) return;
    if (this.targeting) this.pendingTarget = this.worldPoint(e);
    else this.applyAim(e);
  };

  /** Whether a hover should move the barrel at all.
   *
   *  THE MODALS ARE NOT IN HERE, and that is structural rather than an
   *  oversight: main.ts sets the overlay to `pointer-events: none` only while
   *  the app state is "playing", so a draft card, a refit modal or a run-end
   *  screen swallows every pointermove before the canvas can see it. The HUD's
   *  own controls do the same locally (app.css's `.hud > *`), which is why the
   *  aim simply stops moving while the cursor is over the plant panel instead
   *  of tracking behind it.
   *
   *  What IS in here is the state the canvas can be in while still receiving
   *  moves: a paused bay (the pause card is drawn over a live field), a bay
   *  whose target is met and is only waiting for the last shipments to settle,
   *  and a bay with nothing left to fire. All three are cases where an arc
   *  that follows the cursor would be advertising a shot the bay has already
   *  refused — Game.shoot's own list, minus the parts that recover by
   *  themselves (the reload, the launch budget), because an aim is worth
   *  drawing while you wait for the cooldown and worth drawing while you count
   *  whether you can afford the next one. */
  private hoverAimable(g: Game): boolean {
    return g.status === "playing" && !g.paused && !g.settling
      && (g.piecesLeft > 0 || g.bombArmed);
  }

  /** The cursor left the field: drop the queued solve so the last hover cannot
   *  land a frame later, from outside. The AIM ITSELF STAYS — the barrel holds
   *  the last position the cursor asked for rather than snapping back to some
   *  earlier one. Snapping would be motion that carries no information (the
   *  player is looking at the rail, not the arc) and would land the barrel
   *  somewhere they can no longer see the reason for; freezing leaves the bay
   *  exactly as they last saw it, which is also what the drag scheme does when
   *  a gesture ends. Never touches a live drag: a mouse with the button down
   *  holds pointer capture, and a capture that reports a leave is describing
   *  the pointer's position, not the end of the gesture. */
  private onLeave = (): void => {
    if (!this.dragging) this.pendingTarget = null;
  };

  private onUp = (e: PointerEvent): void => {
    // THE OTHER HALF OF onDown's BUTTON GUARD, and it is not redundant with it.
    // A mouse is ONE pointer with several buttons: every button's pointerdown
    // and pointerup carry the same pointerId. So the pointerId test below —
    // which is what keeps a second finger's release from firing a touch drag —
    // cannot tell the left button's release from the right button's, and
    // without this line releasing the right button after rotating mid-aim
    // would fire the left button's shot. The player would have asked to turn
    // the piece and been answered with a launch.
    //
    // Same pointerType gating as onDown, for the same pen reason, and it is
    // also why this can safely come BEFORE the `dragging` test: for a mouse
    // whose gesture never started, both guards return anyway.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Only the finger that started the drag fires it — any other pointer's
    // release (a rotate/✕ tap mid-aim) leaves the drag alive.
    if (!this.dragging || e.pointerId !== this.dragPointerId) return;
    // MISFIRE GATE. Read the gesture, never the cannon: cannon.power holds the
    // last APPLIED pull, so a tap would read the previous shot's setting back
    // and fire it. dragRatio is this gesture's own answer, and it is 0 for a tap.
    //
    // Read at RELEASE, not at the furthest point reached, and that is the
    // intended reading of "did they mean it": pulling the slingshot back and
    // walking the finger home before lifting is how a player takes it back.
    //
    // NOT APPLIED TO A MOUSE. The accident this prevents is a thumb grazing the
    // glass — a hand resting on the bezel, a finger reaching for the rail and
    // missing — and a mouse has no equivalent: a click is a deliberate act at a
    // pixel the player chose. Gating it would break click-to-fire for a desktop
    // player aiming on the keyboard, which is a working control scheme, to
    // solve a problem that device does not have. Same line the drag hint draws
    // (app.css hides it under `pointer: fine`). Pen and unknown pointer types
    // stay gated: both land on touch hardware.
    const misfired = e.pointerType !== "mouse" && this.dragRatio < MIN_FIRE_RATIO;
    // THE RELEASE POINT IS THE AIM, applied here rather than left to the next
    // animation frame that will never come. onMove only records where the
    // cursor went (see pendingTarget); a player who flicks the mouse and clicks
    // inside the same frame would otherwise fire at wherever the cursor was one
    // frame ago, which on a fast flick is most of the bay away. Unconditional
    // on a pending move rather than `if (this.pendingTarget)`: re-solving the
    // release position costs one solve and removes the case analysis.
    // ...unless a lob drag is still holding the right button: then the aim
    // in force is the FROZEN target the height was dialled onto, and firing
    // at the cursor — which spent the whole stroke as the dial's input, px
    // from where it started — would launch at a point nobody was aiming at.
    if (this.targeting) {
      this.applyTarget(this.lobFrom && this.lobTarget ? this.lobTarget : this.worldPoint(e));
    }
    const restore = this.aimBefore;
    this.dragging = false;
    this.dragStart = null;
    this.dragPointerId = null;
    this.dragRatio = 0;
    this.targeting = false;
    this.pendingTarget = null;
    this.aimBefore = null;
    this.lobFrom = null;
    this.lobTarget = null;
    const g = this.game();
    if (g) g.aiming = false;
    if (misfired) {
      // Nothing fired, nothing spent, and the cannon goes back to the aim it
      // had before the finger landed — a graze that travelled 20px still moved
      // the barrel, so leaving it where it stopped would make the accident cost
      // the shot the player had lined up. "Nothing happened" has to mean it.
      if (g && restore) {
        g.cannon.angle = restore.angle;
        g.cannon.power = restore.power;
        g.updateTrajectory();
      }
      // The cue only where the player is still looking at the bay. A gesture
      // can outlive the run — the clock expires or the bay is lost between
      // pointerdown and pointerup, and onDown's own status gate has already
      // been passed by then — and a guide box anchored at the thumb over the
      // end screen is explaining a shot that was never going to happen. The
      // teardown and the aim restore above stay unconditional; only the
      // teaching is situational.
      if (g && g.status === "playing" && !g.paused) this.onMisfire?.(e.clientX, e.clientY);
      return;
    }
    if (g) g.shoot(performance.now());
  };

  /** THE WHEEL IS THE ARC-HEIGHT DIAL — the owner's play session re-decided
   *  it (it briefly rotated the shipment; the buttons own rotation now, right
   *  ⟳ and middle ⟲). The click solves the arc to a point, and the wheel
   *  chooses WHICH arc of the family through that same point: scroll up and
   *  the ball comes down steeper onto the spot, scroll down and it flattens
   *  back toward the minimum-power drive (Game.aimLoft -> cannon.ts's loft).
   *  This is the control click-to-target was missing: the flat default
   *  regularly drew its prediction straight through the compactor bar with no
   *  way to ask for height. The dial persists across clicks within the bay
   *  and re-solves the held or last target immediately, so a notch answers on
   *  screen the moment it is spent. See wheelNotch for the accumulator.
   *
   *  NOT WHILE PAUSED, AND NOT ON A FINISHED BAY — and the reason is the
   *  preventDefault rather than the rotation. Killing the page's scroll is a
   *  thing this handler is allowed to do only while it is genuinely consuming
   *  the input; a paused bay with an overlay over it is a screen the player may
   *  well be reading, and a wheel that silently does nothing AND refuses to
   *  scroll is worse than either. So the early return leaves the event
   *  completely untouched, which is also what makes the answer to "does this
   *  break the Controls and Workshop screens" a structural no rather than a
   *  promise: those never reach this handler at all (see the listener
   *  registration), and even the canvas itself stops eating wheel events the
   *  moment it stops being a live bay. */
  private onWheel = (e: WheelEvent): void => {
    const g = this.game();
    if (!g || g.status !== "playing" || g.paused) {
      this.wheelAccum = 0;
      return;
    }
    // ctrl/⌘+wheel is the browser's zoom, not a scroll, and it is one of the
    // few accessibility affordances a player has on a canvas game that cannot
    // reflow. Swallowing it to rotate a piece nobody asked to rotate — nobody
    // holds ctrl to turn a shipment — would trade a real accommodation for
    // nothing. Left entirely alone, default included.
    if (e.ctrlKey || e.metaKey) return;
    // Unconditional once we are playing, and before the deltaY test rather
    // than after it: a diagonal trackpad swipe carries deltaX too, and letting
    // the horizontal half through would scroll the page sideways under a bay
    // that is meant to be the whole viewport. During play the wheel belongs to
    // the game whether or not this particular event earns a rotation.
    e.preventDefault();
    const r = wheelNotch(this.wheelAccum, e.deltaY, e.deltaMode);
    this.wheelAccum = r.accum;
    if (r.notch === 0) return;
    // CLASSIC-WHEEL OPTION (settings.wheelRotates): the wheel keeps its
    // original job — a notch turns the shipment, wheel-down clockwise the
    // way it always did — and the loft dial lives on the right-button chord
    // drag instead (see onMove). Read live, so flipping the Controls toggle
    // re-jobs the wheel mid-bay.
    if (this.wheelRotates()) {
      this.rotate(r.notch > 0 ? "right" : "left");
      return;
    }
    // Wheel-down is notch +1 and must LOWER the arc, so the loft subtracts.
    const next = Math.min(1, Math.max(0, g.aimLoft - r.notch * LOFT_STEP));
    if (next === g.aimLoft) return;
    g.aimLoft = next;
    // Re-solve at the target in hand — the one being held, else the last one
    // clicked — so the dial redraws the arc it is dialling. With no target
    // yet (a keyboard aimer pre-rolling the wheel) the loft still sticks and
    // the next click uses it; there is nothing honest to redraw until then.
    const t = this.pendingTarget ?? (this.lastTargetFor === g ? this.lastTarget : null);
    if (t) this.applyTarget(t);
  };

  /** No context menu on the bay. Electron ships without one, so this is
   *  invisible there, but the web and PWA builds are the same code and a
   *  browser answers the rotate gesture with a menu covering the field —
   *  which also swallows the pointerup that would have ended an aim in
   *  progress. Unconditional rather than gated on `playing`: the canvas is the
   *  game surface in every state, never a document with text to act on, and a
   *  menu offering to save it as an image is not something a paused bay should
   *  start offering. Every screen that isn't the bay is a DOM overlay outside
   *  the canvas and keeps its menu (see the listener registration). */
  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragPointerId) return;
    this.cancelAim();
  };

  private onKey = (e: KeyboardEvent): void => {
    const g = this.game();
    if (!g || g.status !== "playing" || g.paused) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    // Aim/power (tickKeys below) WANT the held state, so the key is recorded
    // above before this guard. The discrete actions must not repeat: OS key
    // repeat delivers a keydown every ~30ms while held, which would rapid-fire
    // the cannon at its cooldown rate and — worse — spend every Bond Breaker
    // charge on one leaned-on key. In a Contract that empties the launch
    // budget, which is the whole bay.
    if (e.repeat) return;
    // Actions come from the REBINDABLE table (game/bindings.ts, the Controls
    // screen edits it) rather than hardcoded letters, so a hint and its key
    // can never disagree.
    switch (actionForKey(k)) {
      case "fire":
        e.preventDefault();
        g.shoot(performance.now());
        break;
      case "rotl": g.cannon.rotateLeft(); break;
      case "rotr": g.cannon.rotateRight(); break;
      case "bond": g.useBondBreaker(performance.now()); break;
      // Arms/disarms a demolition charge — the next launch then fires the
      // bomb along the current aim instead of the loaded piece (armBomb).
      case "demo": g.armBomb(); break;
      // Autoloader: HELD, not tapped. setAutoHeld is idempotent, so OS key
      // repeat re-asserts the same state instead of restarting the burst.
      case "auto": g.setAutoHeld(true); break;
      default: break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === keyFor("auto")) this.game()?.setAutoHeld(false);
  };

  /** A window that loses focus never delivers keyup, so an alt-tab mid-burst
   *  would leave the trigger held down until the player pressed F again. */
  private onBlur = (): void => {
    this.keys.clear();
    this.game()?.setAutoHeld(false);
  };

  // Continuous keyboard aim/power (web fallback), plus the once-a-frame flush
  // of a held mouse's target (see pendingTarget). The arrows stay as fixed
  // aliases alongside the bindable letters — they are the convention every
  // keyboard player tries first.
  //
  // The two share a tick rather than the aim solve getting its own rAF loop
  // because they are the same job — "settle what the player is currently
  // asking for, once per drawn frame" — and because the ORDER matters on a
  // desktop where both are live at once. The target goes first, so a player
  // holding the mouse down and nudging W/S gets the keyboard nudge applied on
  // top of the solved aim rather than under it: the keys stay usable as a trim
  // on a solved shot instead of being silently overwritten every frame.
  private tickKeys = (): void => {
    const g = this.game();
    if (!g || g.status !== "playing" || g.paused) {
      // A QUEUED TARGET DOES NOT WAIT OUT A PAUSE. This branch used to be an
      // empty early-out, which was harmless while only a held button could
      // queue anything: the release that ended the gesture cleared it. A hover
      // has no release, so a cursor position recorded on the last frame before
      // a pause sat in the queue for the length of the pause card and then
      // swung the barrel the moment play resumed — an aim nobody made,
      // arriving after the thing that made it had been forgotten. Dropping it
      // here rather than at every place that pauses keeps the rule in one
      // place: what the queue holds is "where the cursor is RIGHT NOW", and a
      // bay that is not accepting aims makes that answer stale by definition.
      this.pendingTarget = null;
    } else {
      // A HELD target is applied unconditionally — the player is mid-gesture
      // and the bay's own guards decide what the release costs. A HOVERED one
      // is re-tested against the bay first: a move and the frame that answers
      // it are up to 16ms apart, and a bay that won or ran dry in between must
      // not have its barrel swung by a cursor position that outlived it.
      if (this.pendingTarget) {
        if (this.dragging || this.hoverAimable(g)) this.applyTarget(this.pendingTarget);
        else this.pendingTarget = null;
      }
      if (this.keys.has(keyFor("aimUp")) || this.keys.has("arrowup")) g.cannon.aimUp();
      if (this.keys.has(keyFor("aimDown")) || this.keys.has("arrowdown")) g.cannon.aimDown();
      if (this.keys.has(keyFor("powerUp")) || this.keys.has("arrowright")) g.cannon.powerUp();
      if (this.keys.has(keyFor("powerDown")) || this.keys.has("arrowleft")) g.cannon.powerDown();
      if (this.keys.size) g.updateTrajectory();
    }
    this.raf = requestAnimationFrame(this.tickKeys);
  };
}
