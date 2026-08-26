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
 */
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

  private onDown = (e: PointerEvent): void => {
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
