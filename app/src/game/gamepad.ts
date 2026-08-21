import type { Game } from "./game";
import { actionForPad, padFor, type BindableAction } from "./bindings";

/**
 * GAMEPAD SUPPORT (canvas D1) — the Gamepad API has no events for buttons,
 * only a state snapshot, so this is a poller: main.ts calls poll() once per
 * rendered frame (the same cadence input.ts's tickKeys runs at).
 *
 * The mapping is bindings.ts's pad table (rebindable on the Controls
 * screen); aim and power live on the LEFT STICK, deliberately unbindable —
 * a stick is not a button. Pushing the stick TOWARD the target aims there,
 * and the deflection sets the power, mapped onto the same drag-length range
 * the slingshot uses (cannon.aimFromDrag), so a full deflection is a full
 * pull. "Stick aiming assist" (a Controls toggle) smooths the raw stick
 * through a short lerp so analogue jitter doesn't wobble the arc; off, the
 * stick is raw.
 */

/** Deadzone below which the stick reads as centred — covers worn sticks. */
const DEADZONE = 0.22;
/** Full deflection maps to this drag length (past cannon.ts's DRAG_MAX, so
 *  a pinned stick is full power). */
const STICK_DRAG = 240;
/** Assist lerp factor per frame — settles in ~6 frames, ~100ms at 60Hz. */
const ASSIST_LERP = 0.3;

export interface GamepadHooks {
  game(): Game | null;
  /** True while gameplay input should act (main.ts's state === "playing"). */
  playing(): boolean;
  /** Any button/stick activity — main.ts flips the input profile on it. */
  onActivity(): void;
  /** The pause binding's press edge — main toggles pause/resume. */
  onPause(): void;
  /** While the Controls screen is capturing a rebind: the next button press
   *  lands here INSTEAD of acting. Return true to consume it. */
  onCapture(button: number): boolean;
  /** Stick-assist setting, read live so the toggle applies immediately. */
  assist(): boolean;
}

export class GamepadPoller {
  private hooks: GamepadHooks;
  private prev: boolean[] = [];
  /** The assist lerp's current smoothed stick vector. */
  private sx = 0;
  private sy = 0;
  private connected: string | null = null;

  constructor(hooks: GamepadHooks) {
    this.hooks = hooks;
  }

  /** The detected pad's id, for the Controls screen's chip. Null until one
   *  has announced itself (browsers hide pads until a button is pressed). */
  detected(): string | null {
    return this.connected;
  }

  poll(now: number): void {
    const pads = navigator.getGamepads?.();
    const pad = pads ? Array.from(pads).find((p) => p && p.connected) : null;
    if (!pad) {
      this.connected = null;
      this.prev = [];
      return;
    }
    this.connected = pad.id;

    const pressed = pad.buttons.map((b) => b.pressed);
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const deflected = Math.hypot(ax, ay) > DEADZONE;
    if (deflected || pressed.some((p, i) => p && !this.prev[i])) this.hooks.onActivity();

    // Press edges, oldest-first so a capture consumes exactly one.
    for (let i = 0; i < pressed.length; i++) {
      const edge = pressed[i] && !this.prev[i];
      if (!edge) continue;
      if (this.hooks.onCapture(i)) continue;
      const action = actionForPad(i);
      if (action === "pause") {
        this.hooks.onPause();
        continue;
      }
      if (!this.hooks.playing()) continue;
      const g = this.hooks.game();
      if (!g) continue;
      this.act(g, action, now);
    }

    const g = this.hooks.game();
    if (g && this.hooks.playing()) {
      // The one HELD binding, asserted from level state rather than edges so
      // a pad that vanishes mid-hold can't leave the trigger stuck down.
      g.setAutoHeld(pressed[padFor("auto")] ?? false);

      if (deflected) {
        const target = { x: ax, y: ay };
        if (this.hooks.assist()) {
          this.sx += (target.x - this.sx) * ASSIST_LERP;
          this.sy += (target.y - this.sy) * ASSIST_LERP;
        } else {
          this.sx = target.x;
          this.sy = target.y;
        }
        // Push TOWARD the target: aimFromDrag is slingshot pull-back, so the
        // stick vector is passed reversed.
        g.cannon.aimFromDrag(-this.sx * STICK_DRAG, -this.sy * STICK_DRAG);
        g.updateTrajectory();
      } else {
        // Centred stick re-anchors the assist so the next deflection starts
        // from rest instead of the last aim's tail.
        this.sx = 0;
        this.sy = 0;
      }
    }

    this.prev = pressed;
  }

  private act(g: Game, action: BindableAction | null, now: number): void {
    switch (action) {
      case "fire": g.shoot(now); break;
      case "rotl": g.cannon.rotateLeft(); g.updateTrajectory(); break;
      case "rotr": g.cannon.rotateRight(); g.updateTrajectory(); break;
      case "aimUp": g.cannon.aimUp(); g.updateTrajectory(); break;
      case "aimDown": g.cannon.aimDown(); g.updateTrajectory(); break;
      case "powerUp": g.cannon.powerUp(); g.updateTrajectory(); break;
      case "powerDown": g.cannon.powerDown(); g.updateTrajectory(); break;
      case "bond": g.useBondBreaker(now); break;
      case "demo": g.armBomb(); break;
      // "auto" is held, handled from level state above; null is an unbound
      // button and does nothing.
      default: break;
    }
  }
}
