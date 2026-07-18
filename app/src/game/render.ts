import Matter from "matter-js";
import { CELL, WORLD } from "./engine";
import { COLORS, PIECE_COLORS, shade, type PieceType } from "./theme";
import { pieceOffsets, type Cube } from "./pieces";
import type { Compactor } from "./compactor";
import { Cannon, CANNON } from "./cannon";
import { blinkVisible } from "./lineClear";

export interface Viewport {
  scale: number;
  ox: number;
  oy: number;
}

export function computeViewport(cw: number, ch: number): Viewport {
  const scale = Math.min(cw / WORLD.width, ch / WORLD.height);
  return {
    scale,
    ox: (cw - WORLD.width * scale) / 2,
    oy: (ch - WORLD.height * scale) / 2,
  };
}

/** Map a client (CSS px) point to world coordinates. */
export function screenToWorld(
  cssW: number,
  cssH: number,
  rectLeft: number,
  rectTop: number,
  clientX: number,
  clientY: number,
): Matter.Vector {
  const vp = computeViewport(cssW, cssH);
  return {
    x: (clientX - rectLeft - vp.ox) / vp.scale,
    y: (clientY - rectTop - vp.oy) / vp.scale,
  };
}

export interface Scene {
  cubes: Cube[];
  compactor: Compactor;
  cannon: Cannon;
  trajectory: Matter.Vector[];
  now: number;
  aiming: boolean;
}

export function render(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  scene: Scene,
): void {
  const vp = computeViewport(cssW, cssH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cssW * dpr, cssH * dpr);

  // Letterbox backdrop
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cssW * dpr, cssH * dpr);

  ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.ox * dpr, vp.oy * dpr);
  // Clip to the world rect
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WORLD.width, WORLD.height);
  ctx.clip();

  drawBackground(ctx);
  drawWalls(ctx);
  drawCompactor(ctx, scene.compactor);
  for (const cube of scene.cubes) drawCube(ctx, cube, scene.now);
  drawTrajectory(ctx, scene.trajectory);
  // Drawn AFTER the cannon: the barrel is opaque and longer than its visual
  // tip, and previously painted over ghost cells at some aim angles.
  drawCannon(ctx, scene.cannon, scene.aiming);
  drawLoadedPiece(ctx, scene.cannon);

  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(
    WORLD.width * 0.5, -80, 80,
    WORLD.width * 0.5, WORLD.height * 0.4, WORLD.width * 0.8,
  );
  g.addColorStop(0, "#161636");
  g.addColorStop(1, "#07070f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WORLD.width; x += CELL) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
  }
  for (let y = 0; y <= WORLD.height; y += CELL) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
  }
  ctx.stroke();
}

/** Left/bottom/right glow only — the top is physically open (pieces can fly
 *  above the frame and fall back in), so the visuals leave the sky open too. */
function drawWalls(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = COLORS.aim;
  ctx.shadowColor = COLORS.wallGlow;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(2, WORLD.height - 2);
  ctx.lineTo(WORLD.width - 2, WORLD.height - 2);
  ctx.lineTo(WORLD.width - 2, 2);
  ctx.stroke();
  ctx.restore();
}

function drawCompactor(ctx: CanvasRenderingContext2D, c: Compactor): void {
  const x = c.x - c.width / 2;
  const top = c.top;
  const h = c.height;
  ctx.save();
  ctx.shadowColor = COLORS.compactorGlow;
  ctx.shadowBlur = 26;
  const grad = ctx.createLinearGradient(x, 0, x + c.width, 0);
  grad.addColorStop(0, "#ff5c78");
  grad.addColorStop(0.5, COLORS.compactor);
  grad.addColorStop(1, "#c31b3d");
  ctx.fillStyle = grad;
  ctx.fillRect(x, top, c.width, h);
  // glowing cap so the top edge (the "arc over" line) reads clearly
  ctx.fillStyle = "#ffd0d8";
  ctx.fillRect(x - 3, top - 4, c.width + 6, 6);
  // hazard stripes
  ctx.beginPath();
  ctx.rect(x, top, c.width, h);
  ctx.clip();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "#0a0a12";
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let y = top - c.width; y < WORLD.height; y += 34) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + c.width, y + c.width);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCube(ctx: CanvasRenderingContext2D, cube: Cube, now: number): void {
  if (!blinkVisible(cube, now)) return;
  const b = cube.body;
  const color = cube.blinkStart !== null ? "#ff6464" : cube.color;
  const dark = shade(color, -70);
  const light = shade(color, 45);

  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  const h = CELL / 2;

  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Per-type interior pattern (ported from main.py draw_square_piece)
  ctx.save();
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.clip();
  drawPattern(ctx, cube.type, -h, -h, CELL, dark, light);
  ctx.restore();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = light;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.stroke();
  ctx.restore();
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  type: PieceType,
  x: number,
  y: number,
  s: number,
  dark: string,
  light: string,
): void {
  ctx.lineWidth = 1.5;
  const line = (x1: number, y1: number, x2: number, y2: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (type) {
    case "I":
      for (let i = 0; i < s; i += 8) { line(x, y + i, x + s, y + i, dark); }
      break;
    case "O":
      for (let i = 4; i < s / 2; i += 6) {
        ctx.strokeStyle = i % 12 === 4 ? dark : light;
        ctx.strokeRect(x + i, y + i, s - 2 * i, s - 2 * i);
      }
      break;
    case "T":
      for (let i = -s; i < s; i += 9) { line(x + i, y, x + i + s, y + s, dark); }
      break;
    case "L":
      for (let i = 0; i < s; i += 8) { line(x + i, y, x + i, y + s, dark); }
      break;
    case "J":
      for (let i = 0; i < s * 2; i += 9) { line(x + s - i, y, x + 2 * s - i, y + s, dark); }
      break;
    case "S":
      ctx.fillStyle = dark;
      for (let i = 5; i < s; i += 8) {
        for (let j = 5; j < s; j += 8) {
          ctx.beginPath();
          ctx.arc(x + i, y + j, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case "Z":
      for (let i = 0; i < s; i += 9) { line(x, y + i, x + s, y + i, dark); }
      for (let i = 0; i < s; i += 9) { line(x + i, y, x + i, y + s, light); }
      break;
  }
}

function drawTrajectory(ctx: CanvasRenderingContext2D, pts: Matter.Vector[]): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.shadowColor = COLORS.trajectory;
  ctx.shadowBlur = 10;
  for (let i = 0; i < pts.length; i += 3) {
    const t = i / pts.length;
    ctx.globalAlpha = 0.9 * (1 - t) + 0.15;
    ctx.fillStyle = COLORS.trajectory;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, 4 * (1 - t) + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Loaded-piece "ghost" scale relative to CELL — small enough to not dominate the view. */
const GHOST_SCALE = 0.55;
/** Ghost piece opacity — see-through enough to read as a preview, not a real piece. */
const GHOST_ALPHA = 0.45;

/**
 * Draw the currently loaded piece, semi-transparent, at the cannon's muzzle in
 * its current orientation — so aiming shows the real world-space rotation the
 * player will fire. Uses the same pieceOffsets helper as pieces.ts
 * createTetrisPiece (centroid-anchored rotation), scaled down by GHOST_SCALE
 * so it reads as a preview rather than a real piece.
 */
function drawLoadedPiece(ctx: CanvasRenderingContext2D, cannon: Cannon): void {
  const color = PIECE_COLORS[cannon.currentType];
  const tip = cannon.tip;
  const offsets = pieceOffsets(cannon.currentType, cannon.pieceRotation);
  const cell = CELL * GHOST_SCALE;
  const h = cell / 2;

  ctx.save();
  ctx.globalAlpha = GHOST_ALPHA;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  for (const { x: ox, y: oy } of offsets) {
    const rx = ox * GHOST_SCALE;
    const ry = oy * GHOST_SCALE;
    roundRect(ctx, tip.x + rx - h, tip.y + ry - h, cell, cell, 4);
    ctx.fill();
  }
  ctx.restore();
}

function drawCannon(ctx: CanvasRenderingContext2D, cannon: Cannon, aiming: boolean): void {
  const ratio = cannon.powerRatio;
  const barrelColor = `rgb(${Math.round(150 + 105 * ratio)}, ${Math.round(220 - 120 * ratio)}, 90)`;

  // Barrel
  ctx.save();
  ctx.translate(cannon.x, cannon.y);
  ctx.rotate(-cannon.angle);
  ctx.shadowColor = barrelColor;
  ctx.shadowBlur = aiming ? 22 : 12;
  ctx.fillStyle = barrelColor;
  roundRect(ctx, 0, -14, CANNON.barrel + 8, 28, 8);
  ctx.fill();
  ctx.restore();

  // Base
  ctx.save();
  ctx.translate(cannon.x, cannon.y);
  ctx.shadowColor = COLORS.aim;
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#1b1b2e";
  ctx.beginPath();
  ctx.arc(0, 0, CANNON.size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.aim;
  ctx.stroke();
  ctx.restore();

  // Slingshot pull band while aiming
  if (aiming) {
    const tip = cannon.tip;
    ctx.save();
    ctx.strokeStyle = COLORS.aim;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cannon.x, cannon.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
