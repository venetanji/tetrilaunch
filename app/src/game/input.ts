import { Game } from "./game";
import { screenToWorld } from "./render";
import { actionForKey, keyFor } from "./bindings";
import { MIN_FIRE_RATIO } from "./cannon";

/**
 * Canvas aiming + keyboard fallback (web). TWO SCHEMES, split by device.
 *
 * MOUSE — point at where you want the shipment to go and click. Holding the
 * button down keeps the arc glued to the cursor while it moves; releasing
 * fires. The angle and power are solved backwards out of the forward
 * ballistics model (game.ts's aimAt → cannon.ts's solveAimForTarget), so the
 * dotted arc runs through the cursor rather than being something the player
 * has to construct by feel.
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
 * ROTATION ON THE MOUSE (right button and wheel) is what makes the left-click
 * scheme above a COMPLETE control scheme rather than most of one. Aiming and
 * firing were already on the mouse; turning the shipment was not, so a desktop
 * player still had to reach for the keyboard or the on-screen rail between
 * every shot for the one input that decides whether the piece fits. Both new
 * gestures land on the same pair the keyboard, the gamepad and the rail all
 * call (cannon.rotateLeft/rotateRight + updateTrajectory, via `rotate` below),
 * so there is exactly one definition of what "turn it" means.
 *
 * THEY DO NOT TOUCH THE GESTURE IN PROGRESS. `rotate` reads no drag state and
 * writes none: no dragStart, no dragPointerId, no aimBefore, no pendingTarget.
 * That is the same contract the side-rail rotate buttons already keep (a
 * second finger on the rail leaves the drag alive; only the ✕ cancels it), and
 * it is what lets a player hold the left button on a spot, turn the piece, and
 * watch the arc through that same spot redraw around the new shape.
 *
 * Both are MOUSE-ONLY by construction, and deliberately so — see onDown's
 * button guard for why the pointerType test is there rather than a bare
 * `e.button !== 0`. Touch and pen take the identical path they took before.
 */

/** Pixels of wheel travel that earn one rotation, and the unit every device's
 *  delta is converted into. 100 because that is what a physical detent reports
 *  on every clicky wheel worth naming: Chrome and Edge on Windows send
 *  deltaY 100 per notch, Firefox sends deltaMode 1 with deltaY 3 (three lines,
 *  hence WHEEL_STEP_PX / 3 below), and a Windows "one screen at a time"
 *  setting sends deltaMode 2 with deltaY 1. The devices that DON'T land on 100
 *  — Magic Mouse, trackpads, anything with inertia — are exactly the ones that
 *  send a continuous stream of small deltas instead, which is what the
 *  accumulator is for. Getting this wrong in the low direction is much worse
 *  than in the high: a threshold under a real notch spins the piece several
 *  times per flick, and the piece only has four orientations, so an overshoot
 *  is indistinguishable from a random draw. */
const WHEEL_STEP_PX = 100;

/** Which way a wheel-DOWN turn (positive deltaY) turns the shipment. THE ONE
 *  LINE THAT REVERSES THE WHEEL — flip this to false and both directions swap
 *  together, because the ⟲ case below is derived from it rather than written
 *  out separately. There is no convention to inherit here: down-is-clockwise
 *  matches "scroll down, the piece rolls forward under your finger", which is
 *  the reading we picked, and the opposite reading ("the wheel is a dial, down
 *  is anticlockwise") is just as defensible. Typed `boolean` rather than left
 *  to literal inference so flipping it does not make the comparison below a
 *  compile error about an impossible comparison. */
const WHEEL_DOWN_ROTATES_RIGHT: boolean = true;

export type RotateDir = "left" | "right";

/** One wheel event's worth of rotation, as a pure function of the accumulator
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
export function wheelRotation(
  accum: number,
  deltaY: number,
  deltaMode: number,
): { accum: number; dir: RotateDir | null } {
  // deltaMode is the unit the device chose to speak in — 0 px, 1 lines,
  // 2 pages — and it is per-EVENT, not per-device: the same wheel can switch
  // modes when a modifier or an OS setting changes. Normalising here rather
  // than at the call site means the threshold above is one number in one unit.
  const px = deltaY * (deltaMode === 1 ? WHEEL_STEP_PX / 3 : deltaMode === 2 ? WHEEL_STEP_PX : 1);
  if (px === 0) return { accum, dir: null };
  const next = Math.sign(px) === Math.sign(accum) ? accum + px : px;
  if (Math.abs(next) < WHEEL_STEP_PX) return { accum: next, dir: null };
  return { accum: 0, dir: (px > 0) === WHEEL_DOWN_ROTATES_RIGHT ? "right" : "left" };
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
  /** The aim as it stood when the current gesture STARTED, restored if that
   *  gesture turns out to be a misfire. Without it a graze that travels far
   *  enough to move the cannon but not far enough to fire still costs the
   *  player the shot they had lined up — the accident would be free of ammo
   *  and expensive in setup, which is only half a fix. */
  private aimBefore: { angle: number; power: number } | null = null;
  /** Wheel travel banked toward the next rotation, in normalised px. Lives on
   *  the controller rather than inside onWheel because a trackpad's notch is
   *  spread across many events (see wheelRotation). Zeroed whenever the wheel
   *  arrives on a bay that is not being played, so a half-turn banked before a
   *  pause cannot fall out of the machine on the first scroll after it. */
  private wheelAccum = 0;
  private raf = 0;

  constructor(
    canvas: HTMLCanvasElement,
    game: () => Game | null,
    onMisfire?: (clientX: number, clientY: number) => void,
  ) {
    this.canvas = canvas;
    this.game = game;
    this.onMisfire = onMisfire;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
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
      // BEFORE the `this.dragging` bail below, so this fires DURING a left-drag
      // too. That is the gesture the mouse scheme is missing without it: hold
      // the left button on the gap you want to fill, right-click to turn the
      // piece until it fits, release. Treating the second button as a
      // collision and refusing it would leave the player choosing between
      // holding their aim and turning their shipment, which is the exact
      // reach-for-the-keyboard this change is here to delete.
      if (e.button === 2) this.rotate("right");
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
    if (!this.dragging || e.pointerId !== this.dragPointerId) return;
    if (this.targeting) this.pendingTarget = this.worldPoint(e);
    else this.applyAim(e);
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
    if (this.targeting) this.applyTarget(this.worldPoint(e));
    const restore = this.aimBefore;
    this.dragging = false;
    this.dragStart = null;
    this.dragPointerId = null;
    this.dragRatio = 0;
    this.targeting = false;
    this.pendingTarget = null;
    this.aimBefore = null;
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

  /** The wheel turns the shipment. See wheelRotation for the accumulator and
   *  WHEEL_DOWN_ROTATES_RIGHT for which way, both module-level and both
   *  deliberately outside this method so the direction is one line to reverse.
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
    const r = wheelRotation(this.wheelAccum, e.deltaY, e.deltaMode);
    this.wheelAccum = r.accum;
    if (r.dir) this.rotate(r.dir);
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
    if (g && g.status === "playing" && !g.paused) {
      if (this.pendingTarget) this.applyTarget(this.pendingTarget);
      if (this.keys.has(keyFor("aimUp")) || this.keys.has("arrowup")) g.cannon.aimUp();
      if (this.keys.has(keyFor("aimDown")) || this.keys.has("arrowdown")) g.cannon.aimDown();
      if (this.keys.has(keyFor("powerUp")) || this.keys.has("arrowright")) g.cannon.powerUp();
      if (this.keys.has(keyFor("powerDown")) || this.keys.has("arrowleft")) g.cannon.powerDown();
      if (this.keys.size) g.updateTrajectory();
    }
    this.raf = requestAnimationFrame(this.tickKeys);
  };
}
