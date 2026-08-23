import { Game } from "./game";
import { screenToWorld } from "./render";
import { actionForKey, keyFor } from "./bindings";
import { MIN_FIRE_RATIO } from "./cannon";

/**
 * Angry-Birds-style drag aiming on the canvas + keyboard fallback (web).
 * Dragging from the cannon sets direction (angle) and distance (power); the
 * parabola preview updates live and releasing fires. The drag is bound to
 * the pointer that started it, so on touch a SECOND finger can tap the
 * side-rail buttons mid-aim (rotate keeps the drag alive; the ✕ cancels it
 * via cancelAim) without its release firing the shot.
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
    return this.dragging ? this.dragRatio : null;
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

  private onDown = (e: PointerEvent): void => {
    const g = this.game();
    if (!g || g.status !== "playing" || g.paused) return;
    // A second finger landing on the canvas mid-aim (reaching for the rail
    // and missing a button) must not re-anchor the drag in progress.
    if (this.dragging) return;
    this.dragging = true;
    this.dragPointerId = e.pointerId;
    this.dragStart = this.worldPoint(e);
    this.dragRatio = 0;
    this.aimBefore = { angle: g.cannon.angle, power: g.cannon.power };
    g.aiming = true;
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.dragPointerId) return;
    this.applyAim(e);
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
    const restore = this.aimBefore;
    this.dragging = false;
    this.dragStart = null;
    this.dragPointerId = null;
    this.dragRatio = 0;
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
      this.onMisfire?.(e.clientX, e.clientY);
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

  // Continuous keyboard aim/power (web fallback). The arrows stay as fixed
  // aliases alongside the bindable letters — they are the convention every
  // keyboard player tries first.
  private tickKeys = (): void => {
    const g = this.game();
    if (g && g.status === "playing" && !g.paused) {
      if (this.keys.has(keyFor("aimUp")) || this.keys.has("arrowup")) g.cannon.aimUp();
      if (this.keys.has(keyFor("aimDown")) || this.keys.has("arrowdown")) g.cannon.aimDown();
      if (this.keys.has(keyFor("powerUp")) || this.keys.has("arrowright")) g.cannon.powerUp();
      if (this.keys.has(keyFor("powerDown")) || this.keys.has("arrowleft")) g.cannon.powerDown();
      if (this.keys.size) g.updateTrajectory();
    }
    this.raf = requestAnimationFrame(this.tickKeys);
  };
}
