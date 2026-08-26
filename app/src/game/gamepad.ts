import type { Game } from "./game";
import { actionForPad, padFor, type BindableAction } from "./bindings";

/**
 * GAMEPAD SUPPORT (canvas D1) — the Gamepad API has no events for buttons,
 * only a state snapshot, so this is a poller: main.ts calls poll() once per
 * rendered frame (the same cadence input.ts's tickKeys runs at).
 *
 * The mapping is bindings.ts's pad table (rebindable on the Controls
 * screen); aim and power live on the LEFT STICK, deliberately unbindable —
 * a stick is not a button. HOW the stick speaks is the "Slingshot stick"
 * setting (store.ts's stickPull). OFF — the default, re-decided by the
 * owner's pad session — the stick is a pair of rate dials: up/down trims the
 * angle, left/right trims the power, and a centred stick HOLDS the aim, so
 * the thumb rests between adjustments instead of staying tense to keep a
 * deflection alive. ON, the stick deflection is the touch drag's pull-back
 * vector (cannon.aimFromDrag) — the expressive mode that carries angle and
 * power in one gesture, kept for the players who like it and demoted for
 * being the tiring one. "Stick aiming assist" (a Controls toggle) smooths
 * the slingshot's raw stick through a short lerp so analogue jitter doesn't
 * wobble the arc; the direct mode needs no smoothing — its deadzone rescale
 * starts every rate from zero.
 */

/** Deadzone below which the stick reads as centred — covers worn sticks. */
const DEADZONE = 0.22;
/** Full deflection maps to this drag length (past cannon.ts's DRAG_MAX, so
 *  a pinned stick is full power). */
const STICK_DRAG = 240;
/** Assist lerp factor per frame — settles in ~6 frames, ~100ms at 60Hz. */
const ASSIST_LERP = 0.3;
/** Stick-as-D-pad thresholds for MENU navigation (see onUiButton): a flick
 *  past ON fires one step and the stick must fall back under OFF before the
 *  next — a hysteresis edge, not an autorepeat, so a held stick moves focus
 *  once rather than strafing it across the screen. ON is well past DEADZONE
 *  because a menu step is a discrete act; the gap to OFF is what keeps a
 *  thumb resting at the threshold from machine-gunning. */
const STICK_NAV_ON = 0.55;
const STICK_NAV_OFF = 0.35;
/** The standard-mapping D-pad indices a stick flick translates to, so the
 *  UI hook speaks exactly one language (ui/padnav.ts's PAD_NAV). */
const DPAD_UP = 12, DPAD_DOWN = 13, DPAD_LEFT = 14, DPAD_RIGHT = 15;

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
  /** The UI layer's chance at a press edge — modal/menu navigation and
   *  activation (main.ts's onPadUiButton over ui/padnav.ts). Consulted after
   *  capture and the pause binding but BEFORE the playing gate, because one
   *  press is a UI press even mid-play (the coach card's dismiss); everything
   *  else falls through to the game exactly as before. Return true to
   *  consume. A stick flick while not playing arrives here too, translated
   *  to its D-pad index — the stick aims during play and navigates outside
   *  it, and the hook should not have to know which physical control moved. */
  onUiButton(button: number): boolean;
  /** Stick-assist setting, read live so the toggle applies immediately. */
  assist(): boolean;
  /** Slingshot-stick setting (store.ts's stickPull), read live for the same
   *  reason: the toggle has to be feelable from the Controls screen without
   *  a round trip through a bay. */
  pull(): boolean;
}

export class GamepadPoller {
  private hooks: GamepadHooks;
  private prev: boolean[] = [];
  /** The assist lerp's current smoothed stick vector. */
  private sx = 0;
  private sy = 0;
  /** Stick-nav hysteresis state per axis: the sign of the flick currently
   *  holding the axis "fired", or 0 when re-armed. */
  private navX = 0;
  private navY = 0;
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
      // RAW UI BUTTONS BEFORE THE PAUSE BINDING while gameplay is not live —
      // found in review. Pause is legally rebindable onto A (button 0), and
      // with the pause hook consulted first that rebind left a pad-only
      // player unable to confirm anything on a menu: the hook is a no-op
      // there, so A was eaten to do nothing. Outside play the UI's reading
      // of a press is the meaningful one (the pause modal included — its
      // Resume button is the focus landing, so A resumes either way).
      // DURING play the pause binding keeps precedence, so a rebound pause
      // still pauses mid-bay even while a coach card is listening for B.
      if (!this.hooks.playing() && this.hooks.onUiButton(i)) continue;
      if (action === "pause") {
        this.hooks.onPause();
        continue;
      }
      if (this.hooks.onUiButton(i)) continue;
      if (!this.hooks.playing()) continue;
      const g = this.hooks.game();
      if (!g) continue;
      this.act(g, action, now);
    }

    // Stick-as-D-pad, outside play only: one focus step per flick, per axis,
    // re-armed when the axis re-centres (see STICK_NAV_ON/OFF). During play
    // the stick is the aim and never reaches here.
    if (!this.hooks.playing()) {
      if (this.navX !== 0 && Math.abs(ax) < STICK_NAV_OFF) this.navX = 0;
      if (this.navY !== 0 && Math.abs(ay) < STICK_NAV_OFF) this.navY = 0;
      if (this.navX === 0 && Math.abs(ax) > STICK_NAV_ON) {
        this.navX = Math.sign(ax);
        this.hooks.onUiButton(ax > 0 ? DPAD_RIGHT : DPAD_LEFT);
      }
      if (this.navY === 0 && Math.abs(ay) > STICK_NAV_ON) {
        this.navY = Math.sign(ay);
        this.hooks.onUiButton(ay > 0 ? DPAD_DOWN : DPAD_UP);
      }
    } else {
      this.navX = 0;
      this.navY = 0;
    }

    const g = this.hooks.game();
    if (g && this.hooks.playing()) {
      // The one HELD binding, asserted from level state rather than edges so
      // a pad that vanishes mid-hold can't leave the trigger stuck down.
      g.setAutoHeld(pressed[padFor("auto")] ?? false);

      if (deflected) {
        if (!this.hooks.pull()) {
          // DIRECT (the default) — the stick is a pair of RATE dials, not a
          // position: push up and the barrel rises, push right and the power
          // climbs, centre it and everything HOLDS where you left it. This
          // replaced vector aiming as the default after the owner's pad
          // session: holding a deflection to hold an aim keeps the thumb
          // tense for the whole bay, where a dial is touched only to change
          // something. The rates are the keyboard's own nudge steps scaled
          // by deflection (cannon.nudgeAngle/nudgePower), so a pinned stick
          // equals a held key. Per-axis deadzone with the dead span rescaled
          // away, so motion starts from zero at the deadzone's edge instead
          // of jumping.
          const dz = (v: number): number => {
            const a = Math.abs(v);
            return a <= DEADZONE ? 0 : Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
          };
          const fx = dz(ax);
          const fy = dz(ay);
          if (fx !== 0 || fy !== 0) {
            // Stick up reads negative on the axis and must RAISE the barrel.
            if (fy !== 0) g.cannon.nudgeAngle(-fy);
            if (fx !== 0) g.cannon.nudgePower(fx);
            g.updateTrajectory();
          }
        } else {
          // SLINGSHOT (the Controls opt-in, store.ts's stickPull): the stick
          // deflection IS the pull-back vector, exactly the touch drag spoken
          // through a thumbstick — aimFromDrag puts the barrel opposite the
          // pull. Kept as an option because it is the expressive mode (one
          // gesture carries angle and power together); demoted from default
          // because it is the tiring one.
          const target = { x: ax, y: ay };
          if (this.hooks.assist()) {
            this.sx += (target.x - this.sx) * ASSIST_LERP;
            this.sy += (target.y - this.sy) * ASSIST_LERP;
          } else {
            this.sx = target.x;
            this.sy = target.y;
          }
          g.cannon.aimFromDrag(this.sx * STICK_DRAG, this.sy * STICK_DRAG);
          g.updateTrajectory();
        }
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
