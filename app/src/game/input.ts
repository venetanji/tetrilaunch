import { Game } from "./game";
import { screenToWorld } from "./render";

/**
 * Angry-Birds-style drag aiming on the canvas + keyboard fallback (web).
 * Dragging from the cannon sets direction (angle) and distance (power); the
 * parabola preview updates live and releasing fires. The drag is bound to
 * the pointer that started it, so on touch a SECOND finger can tap the
 * side-rail buttons mid-aim (rotate keeps the drag alive; the ✕ cancels it
 * via cancelAim) without its release firing the shot.
 */
export class InputController {
  private canvas: HTMLCanvasElement;
  private game: () => Game | null;
  private keys = new Set<string>();
  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragPointerId: number | null = null;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, game: () => Game | null) {
    this.canvas = canvas;
    this.game = game;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    this.raf = requestAnimationFrame(this.tickKeys);
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
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
    const g = this.game();
    if (g) g.aiming = false;
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
    g.cannon.aimFromDrag(p.x - this.dragStart.x, p.y - this.dragStart.y);
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
    this.dragging = false;
    this.dragStart = null;
    this.dragPointerId = null;
    const g = this.game();
    if (g) {
      g.aiming = false;
      g.shoot(performance.now());
    }
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
    if (k === " " || e.code === "Space") {
      e.preventDefault();
      g.shoot(performance.now());
    }
    if (k === "q") g.cannon.rotateLeft();
    if (k === "e") g.cannon.rotateRight();
    if (k === "b") g.useBondBreaker(performance.now());
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
