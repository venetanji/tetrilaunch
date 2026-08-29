import type { Game } from "./game";
import { actionForPad, padFor, type BindableAction } from "./bindings";
import { dragLenForRatio, NUDGE_FRAME_MS, NUDGE_MAX_STEP_MS } from "./cannon";

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

/** Deadzone below which the stick reads as centred — covers worn sticks.
 *  Exported for the pin that the first deflection PAST it still asks for
 *  power: the pull-room fix briefly put zero there, and a stick whose first
 *  live millimetre does nothing is a stick with two deadzones. */
export const DEADZONE = 0.22;
/**
 * THE STICK'S POWER CURVE, IN DEFLECTION — where it belongs, and where it now
 * lives rather than being borrowed from a length in world px.
 *
 * The curve is unchanged from the one pad players have always had. It used to
 * be spelled `powerRatioForDrag(deflection * 240)` against cannon.ts's old
 * 28/220 span, which made the pad's feel an accident of a mapping written for a
 * thumb on glass — and the pull-room fix proved how sharp that accident was.
 * When DRAG_MAX shrank from 220 to CANNON.x - CELL so a full pull would fit on
 * the playfield, rescaling the stick's length rescaled the ramp but NOT its
 * foot (DRAG_MIN is a fixed 28 that does not scale with the span): a
 * half-deflected stick fell from 48% to 39%, and the deadzone edge went from
 * 13% to exactly zero, growing a dead band at the bottom of the throw. The
 * endpoints still agreed, so nothing was red.
 *
 * So the two landmarks are stated here, as the fractions of full throw they
 * always were — the numerators are the px triple the curve was born in, kept
 * visible so the derivation can be audited rather than trusted:
 *
 *   FOOT: below this deflection the stick asks for no power at all (28 / 240).
 *   FULL: at this deflection it is asking for everything (220 / 240) — a
 *   little inside 1.0, because a stick rarely reports a clean pin: worn
 *   returns, a diagonal clipped to the circle, a pad that reads 0.96 hard
 *   over. The last ~8% of the throw is headroom, not ramp.
 */
const STICK_POWER_FOOT = 28 / 240;
const STICK_POWER_FULL = 220 / 240;

/**
 * Deflection magnitude (0..1) -> power ratio (0..1), the slingshot stick's own
 * ramp. Pure and exported so sim/systems.ts can pin it as a CURVE — sampled
 * across the throw against the mapping as it shipped — rather than at its two
 * endpoints, which is precisely the pin that would have caught the regression
 * described above and did not exist.
 */
export function stickPowerRatio(deflection: number): number {
  const t = (deflection - STICK_POWER_FOOT) / (STICK_POWER_FULL - STICK_POWER_FOOT);
  return Math.max(0, Math.min(1, t));
}
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
 *
 * THE NUMBER ITSELF now lives in cannon.ts beside the steps it divides, and
 * input.ts's held keys divide by the same one — a stick and a key that trimmed
 * at different rates would undo the whole point of sharing the step constant.
 * Aliased rather than inlined so the dial-specific reasoning above and below
 * still has a local name to hang off.
 */
const DIAL_FRAME_MS = NUDGE_FRAME_MS;
/**
 * The longest gap a single poll may charge the dials for.
 *
 * The player alt-tabs back with a stick still leaning and must not find the
 * barrel pinned at the cone limit. Shared with the keyboard's held keys — see
 * cannon.ts's NUDGE_MAX_STEP_MS for the full argument.
 */
const DIAL_MAX_STEP_MS = NUDGE_MAX_STEP_MS;

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
  /**
   * The connected pad's `Gamepad.id` changed — a pad appeared, vanished (null)
   * or was swapped for another. main.ts derives the pad FAMILY from it
   * (bindings.ts's padFamilyFromId), which decides what every pad label in the
   * game says and which of the two marks the rail's legends draw.
   *
   * FIRED FROM INSIDE poll(), THE INSTANT THE IDENTITY IS READ AND BEFORE ANY
   * OTHER HOOK. That ordering is the whole reason this is a hook rather than
   * something main.ts polls for itself, and it was found the hard way: main.ts
   * used to call its own sync AFTER pad.poll() returned. Browsers hide a pad
   * until its first button press, so the poll that first sees a DualSense is
   * the same poll that fires onActivity — which flips the profile to gamepad
   * and re-renders the hint strip and the pause card. With the sync trailing,
   * every one of those labels rendered in the standard mapping's Xbox default
   * and a DualSense player read "A fire" and "LB/RB rotate" until some
   * unrelated render happened to repaint them. Derived here, the family is
   * correct before anything can render, and no future hook can be ordered
   * wrongly relative to it. (Codex review, PR #174.)
   */
  onPad(id: string | null): void;
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
      // Announced on the EDGE, not every frame: a game with no pad attached
      // polls this branch sixty times a second for its whole life, and the hook
      // relabels rendered surfaces.
      if (this.connected !== null) {
        this.connected = null;
        this.hooks.onPad(null);
      }
      this.prev = [];
      // A pad that vanishes mid-hold must not leave a direction repeating into
      // the menu, the same reasoning setAutoHeld follows for the trigger.
      this.navHeld = -1;
      return;
    }
    // BEFORE the button and stick work below, which is where onActivity and
    // every other hook are reached from — see GamepadHooks.onPad for why that
    // order is the point rather than an accident.
    if (pad.id !== this.connected) {
      this.connected = pad.id;
      this.hooks.onPad(pad.id);
    }

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
        // THE PAD ASKS FOR A RATIO, NOT FOR A LENGTH. aimFromDrag is the one
        // place aim and power are applied together, so the stick still speaks
        // through it — but it hands over the pull length that MEANS the power
        // the deflection asked for (dragLenForRatio), rather than a deflection
        // scaled by some number chosen to sit past the touch span. The angle is
        // untouched by this: aimFromDrag takes it from atan2, which is blind to
        // the vector's length, so normalising to `len` rotates nothing.
        //
        // Multiplying a deflection by a length is what coupled the pad's feel
        // to the touch mapping's ramp, and the pull-room fix is what showed the
        // bill: DRAG_MIN does not scale with the span, so halving the span
        // moved every interior point of this curve while leaving both ends
        // where they were. See stickPowerRatio.
        const mag = Math.hypot(this.sx, this.sy);
        if (mag > 0) {
          const len = dragLenForRatio(stickPowerRatio(mag));
          g.cannon.aimFromDrag((this.sx / mag) * len, (this.sy / mag) * len);
        }
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
      case "thaw": g.useThawLance(now); break;
      // "auto" is held, handled from level state above; null is an unbound
      // button and does nothing.
      default: break;
    }
  }
}
