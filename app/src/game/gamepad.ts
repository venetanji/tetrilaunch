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
 * setting (store.ts's stickSling). OFF — the default — the stick is a pair of
 * rate dials: up/down trims the angle, left/right trims the power, and a
 * centred stick HOLDS the aim, so the thumb rests between adjustments instead
 * of staying tense to keep a deflection alive. ON, the stick deflection is the
 * touch drag's pull-back vector (cannon.aimFromDrag) — the expressive mode that
 * carries angle and power in one gesture, kept for the players who like it and
 * demoted for being the tiring one. "Stick aiming assist" (a Controls toggle)
 * smooths the slingshot's raw stick through a short lerp so analogue jitter
 * doesn't wobble the arc; the dials need no smoothing — stickRate starts every
 * rate from zero at the deadzone's edge.
 *
 * THE TWO MODES ARE GATED ON DIFFERENT QUESTIONS, and that separation is the
 * load-bearing part rather than a tidiness. The slingshot asks "how far is the
 * stick from centre" — one circular magnitude, because it is reading a pull.
 * The dials ask each axis on its own, because they are two independent trims
 * and a stick resting off true zero must move NEITHER. Sharing one circular
 * gate let a stick idling at (0.2, -0.2) — inside both axes' deadzones, but
 * 0.28 from centre — enter the aim path every frame; it wrote nothing today,
 * but the property "a resting stick cannot modify the aim" rested on two
 * thresholds happening to agree rather than on one test.
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
const DPAD = [DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT];
/** Held-D-pad autorepeat for MENU navigation: the first repeat lands this long
 *  after the press, then one every NAV_REPEAT_MS while the direction is held.
 *  A pad delivers no key-repeat of its own — the API is a state snapshot — so
 *  without this the only way down a 57-chip screen (the Tier S bench) is 57
 *  separate presses.
 *
 *  The numbers are a keyboard's: long enough that a deliberate single step
 *  never doubles (the delay is ~24 frames at 60Hz, far past any press a thumb
 *  makes on purpose), short enough between repeats to cross a long column at a
 *  useful pace. The STICK deliberately has no equivalent (see STICK_NAV_ON): a
 *  thumb resting at a threshold is not the same statement as a D-pad held
 *  down. */
const NAV_REPEAT_DELAY_MS = 400;
const NAV_REPEAT_MS = 120;

/**
 * The frame the dials' rates are QUOTED in — cannon.nudgeAngle/nudgePower take
 * a factor of one 60Hz step, so this is what converts elapsed milliseconds into
 * that unit. The dials charge TIME, not polls.
 *
 * They used to charge polls, and main.ts polls once per rendered frame, so the
 * rate rode the display's refresh: at 60Hz a pinned stick crossed the whole
 * aim cone in a second, and at 120Hz it crossed it in half of one. That is not
 * a hypothetical — the owner's primary surface is the Electron shell on a TV,
 * measured at ~8.3ms frame pacing in #116's tests, so the dials were running at
 * twice the speed they were tuned at for the one player who reported them. A
 * dial whose speed depends on the panel it is drawn to is not a tuned control.
 *
 * 60Hz is unchanged to the bit: at a 16.667ms cadence dt/DIAL_FRAME_MS is 1 and
 * every nudge is exactly the step it always was (and the first poll of a
 * session is seeded to one frame rather than zero, so even the very first
 * charge matches what the per-poll code did).
 */
const DIAL_FRAME_MS = 1000 / 60;
/**
 * The longest gap a single poll may charge the dials for.
 *
 * A backgrounded tab, a garbage-collection stall or a tabbed-away TV delivers
 * the next rAF timestamp seconds after the last one, and an unclamped dt would
 * spend all of it in one step — the player alt-tabs back with a stick still
 * leaning and finds the barrel pinned at the cone limit. Six frames' worth is
 * long enough that ordinary jank is charged honestly (nothing a 120Hz shell
 * does comes close) and short enough that the worst case is a nudge the player
 * can see happen rather than a jump they can only undo.
 */
const DIAL_MAX_STEP_MS = 100;

/**
 * ONE AXIS of the rate dials, as a signed rate in -1..1 — the factor
 * cannon.nudgeAngle/nudgePower scale their per-frame step by.
 *
 * Exported and pure because it is the whole statement of "a resting stick
 * changes nothing": everything inside the deadzone answers EXACTLY zero, and
 * the live span is rescaled so the first rate past the edge is zero rather
 * than 0.22 of full speed. A dial that jumped to a fifth of its rate the
 * instant it woke would make the smallest deliberate trim the same size as an
 * accidental brush.
 *
 * Signed and per-axis rather than a vector, because the two dials are
 * independent: pushing the stick straight up must not also touch the power,
 * and a thumb that cannot hold a perfect vertical would have it do exactly
 * that under any radial mapping.
 */
export function stickRate(v: number): number {
  const a = Math.abs(v);
  if (a <= DEADZONE) return 0;
  return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
}

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
   *  it, and the hook should not have to know which physical control moved.
   *  A HELD direction arrives repeatedly (NAV_REPEAT_MS), so the hook has to
   *  be idempotent per press rather than counting them. */
  onUiButton(button: number): boolean;
  /** Stick-assist setting, read live so the toggle applies immediately. */
  assist(): boolean;
  /** Slingshot-stick setting (store.ts's stickSling), read live for the same
   *  reason: the toggle has to be feelable from the Controls screen without
   *  a round trip through a bay. */
  sling(): boolean;
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
  /** The D-pad direction the UI layer is currently holding, and when its next
   *  repeat is due (see NAV_REPEAT_DELAY_MS). -1 when nothing is held — which
   *  includes a D-pad held during PLAY, where the same buttons are aim and
   *  power nudges and repeat is the game's business, not the menu's. */
  private navHeld = -1;
  private navRepeatAt = 0;
  /** The previous poll's timestamp, for the dials' dt (see DIAL_FRAME_MS).
   *  Null until the first poll, which is charged one frame rather than zero so
   *  a 60Hz session is bit-identical to the per-poll code it replaced. */
  private lastPoll: number | null = null;
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
    // BEFORE the no-pad return, so every path advances the clock. A pad plugged
    // in thirty seconds into a menu must not hand the dials thirty seconds of
    // credit on its first frame — it gets one clamped step like everything
    // else, and only because the clamp exists at all.
    const elapsed = this.lastPoll === null ? DIAL_FRAME_MS : now - this.lastPoll;
    this.lastPoll = now;
    /** Elapsed time in units of one 60Hz frame — what the nudge steps are
     *  quoted in. Clamped at both ends: a timestamp that goes backwards (a
     *  clock the browser re-bases) charges nothing rather than unwinding the
     *  aim, and a long stall charges DIAL_MAX_STEP_MS rather than all of it. */
    const dtFrames = Math.min(DIAL_MAX_STEP_MS, Math.max(0, elapsed)) / DIAL_FRAME_MS;

    const pads = navigator.getGamepads?.();
    const pad = pads ? Array.from(pads).find((p) => p && p.connected) : null;
    if (!pad) {
      this.connected = null;
      this.prev = [];
      // A pad that vanishes mid-hold must not leave a direction repeating into
      // the menu, the same reasoning setAutoHeld follows for the trigger.
      this.navHeld = -1;
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
      if (!this.hooks.playing() && this.hooks.onUiButton(i)) {
        // Arm the autorepeat only for a press the UI ACCEPTED, and only for a
        // direction: a confirm or a back that repeated would fire its screen's
        // action again, and a press the UI refused (a screen with nothing to
        // focus) has nothing to repeat into.
        if (DPAD.includes(i)) {
          this.navHeld = i;
          this.navRepeatAt = now + NAV_REPEAT_DELAY_MS;
        }
        continue;
      }
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

    // Held-direction autorepeat, outside play only. Driven from the pressed
    // STATE rather than from edges — that is the whole point, since the API
    // reports no repeats — and released the moment the button comes up or
    // gameplay takes the D-pad back.
    if (this.navHeld >= 0) {
      if (!pressed[this.navHeld] || this.hooks.playing()) {
        this.navHeld = -1;
      } else if (now >= this.navRepeatAt) {
        this.navRepeatAt = now + NAV_REPEAT_MS;
        this.hooks.onUiButton(this.navHeld);
      }
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

      // Centred stick re-anchors the assist so the next deflection starts from
      // rest instead of the last aim's tail. Outside the mode branch on
      // purpose: sx/sy belong to the slingshot, but the toggle is read live
      // and a player who flips it mid-bay must not have the first slingshot
      // frame lerp out of a vector left over from before the dials.
      if (!deflected) {
        this.sx = 0;
        this.sy = 0;
      }

      if (!this.hooks.sling()) {
        // RATE DIALS (the default) — the stick is a pair of trims, not a
        // position: push up and the barrel rises, push right and the power
        // climbs, centre it and everything HOLDS where you left it, for as
        // long as you leave it. Holding a deflection to hold an aim keeps the
        // thumb tense for the whole bay, where a dial is touched only to
        // change something. The rates are the keyboard's own nudge steps
        // scaled by deflection (cannon.nudgeAngle/nudgePower) and by ELAPSED
        // TIME (dtFrames), so a pinned stick trims the same amount per second
        // on a 60Hz phone and a 120Hz TV — see DIAL_FRAME_MS for why that is
        // not a theoretical concern.
        //
        // GATED ON stickRate PER AXIS, never on `deflected` — see the header.
        // The aim path is entered only by an axis that has actually left its
        // own deadzone, so "a resting stick modifies nothing" is one test
        // rather than an agreement between two. dtFrames multiplies that rate
        // and never gates it: a zero rate stays zero however long the frame
        // was, so no amount of stall can move a resting stick's aim.
        const fx = stickRate(ax);
        const fy = stickRate(ay);
        if (fx !== 0 || fy !== 0) {
          // Stick up reads negative on the axis and must RAISE the barrel.
          if (fy !== 0) g.cannon.nudgeAngle(-fy * dtFrames);
          if (fx !== 0) g.cannon.nudgePower(fx * dtFrames);
          g.updateTrajectory();
        }
      } else if (deflected) {
        // SLINGSHOT (the Controls opt-in, store.ts's stickSling): the stick
        // deflection IS the pull-back vector, exactly the touch drag spoken
        // through a thumbstick — aimFromDrag puts the barrel opposite the
        // pull. Kept as an option because it is the expressive mode (one
        // gesture carries angle and power together); demoted from default
        // because it is the tiring one, and because an ABSOLUTE map means
        // letting go of the stick necessarily rewrites the aim on the way
        // down (a pinned pull reads 25% power as it springs back through the
        // deadzone). That is inherent to a slingshot — you fire from the held
        // pull, the way a finger does — and it is exactly why the dials, not
        // this, answer the pad by default.
        // THE AIM ITSELF NEEDS NO dt, and that is worth stating rather than
        // assuming: aimFromDrag is an absolute map, so a given deflection is a
        // given aim no matter how often it is asked. Poll it twice as fast and
        // the barrel lands in exactly the same place, twice as smoothly.
        //
        // The ASSIST does need it. A flat 0.3-per-poll lerp is a time constant
        // wearing a frame's clothing — ~100ms to settle at 60Hz, ~50ms at
        // 120Hz — so the smoothing the toggle promises got weaker on precisely
        // the fast panel that jitters most visibly. Compounding it over the
        // elapsed frames is the standard fix and is exact at 60Hz: dtFrames 1
        // gives back 0.3 to the bit. It converges to the same aim either way
        // (a lerp cannot run away the way an integrated rate can), so this is
        // about the feel of the approach, not about where the shot goes.
        const target = { x: ax, y: ay };
        if (this.hooks.assist()) {
          const k = 1 - Math.pow(1 - ASSIST_LERP, dtFrames);
          this.sx += (target.x - this.sx) * k;
          this.sy += (target.y - this.sy) * k;
        } else {
          this.sx = target.x;
          this.sy = target.y;
        }
        g.cannon.aimFromDrag(this.sx * STICK_DRAG, this.sy * STICK_DRAG);
        g.updateTrajectory();
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
