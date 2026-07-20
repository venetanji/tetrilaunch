import { Game } from "./game";
import { screenToWorld } from "./render";

/**
 * Angry-Birds-style drag aiming on the canvas + keyboard fallback (web).
 * Dragging from the cannon sets direction (angle) and distance (power); the
 * parabola preview updates live and releasing fires.
 */
export class InputController {
  private canvas: HTMLCanvasElement;
  private game: () => Game | null;
  private keys = new Set<string>();
  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;
  /** pointerId of the aim drag in progress. Every move/up/cancel is matched
   *  against it so a SECOND touch (e.g. tapping the rotate button while
   *  aiming) can't hijack or release the shot. */
  private pointerId: number | null = null;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, game: () => Game | null) {
    this.canvas = canvas;
    this.game = game;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    this.raf = requestAnimationFrame(this.tickKeys);
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    cancelAnimationFrame(this.raf);
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
    // cannon reverses it 180° so pulling back fires forward. A pull-back that
    // hasn't cleared the dead zone arms a *cancel* instead of a shot.
    const armed = g.cannon.aimFromDrag(p.x - this.dragStart.x, p.y - this.dragStart.y);
    g.aimCancel = !armed;
    g.updateTrajectory();
  }

  private onDown = (e: PointerEvent): void => {
    const g = this.game();
    if (!g || g.status !== "playing" || g.paused) return;
    // Ignore extra touches once an aim drag owns the gesture — the rotate
    // buttons stay live for the other thumb without disturbing the aim.
    if (this.pointerId !== null) return;
    this.dragging = true;
    this.pointerId = e.pointerId;
    this.dragStart = this.worldPoint(e);
    g.aiming = true;
    // Starts in the dead zone: released here (a tap, no pull) = cancel.
    g.aimCancel = true;
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.applyAim(e);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    const g = this.game();
    const cancel = g?.aimCancel ?? false;
    this.endDrag();
    if (g && !cancel) g.shoot(performance.now());
  };

  // The OS aborted the touch (palm, gesture nav, etc.) — never fire.
  private onCancel = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.endDrag();
  };

  private endDrag(): void {
    this.dragging = false;
    this.pointerId = null;
    this.dragStart = null;
    const g = this.game();
    if (g) {
      g.aiming = false;
      g.aimCancel = false;
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    const g = this.game();
    if (!g || g.status !== "playing" || g.paused) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === " " || e.code === "Space") {
      e.preventDefault();
      g.shoot(performance.now());
    }
    if (k === "q") g.cannon.rotateLeft();
    if (k === "e") g.cannon.rotateRight();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  // Continuous keyboard aim/power (web fallback).
  private tickKeys = (): void => {
    const g = this.game();
    if (g && g.status === "playing" && !g.paused) {
      if (this.keys.has("w") || this.keys.has("arrowup")) g.cannon.aimUp();
      if (this.keys.has("s") || this.keys.has("arrowdown")) g.cannon.aimDown();
      if (this.keys.has("d") || this.keys.has("arrowright")) g.cannon.powerUp();
      if (this.keys.has("a") || this.keys.has("arrowleft")) g.cannon.powerDown();
      if (this.keys.size) g.updateTrajectory();
    }
    this.raf = requestAnimationFrame(this.tickKeys);
  };
}
