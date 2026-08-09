import Matter from "matter-js";
import { CELL, WORLD } from "./engine";
import { computeLayout } from "./layout";
import { COLORS, PIECE_COLORS, shade, type PieceSize, type PieceType } from "./theme";
import { pieceOffsets, type Cube } from "./pieces";
import type { Compactor } from "./compactor";
import { Cannon, CANNON } from "./cannon";
import { blinkVisible } from "./lineClear";
import type { LevelConfig } from "./level";
import { FX_TTL, type FxEvent } from "./fx";

export interface Viewport {
  scale: number;
  ox: number;
  oy: number;
}

/**
 * Where the world sits in the canvas, in CSS px. Delegates to the layout solver
 * (layout.ts) rather than doing its own naive centered fit, so the field rect
 * accounts for reserved chrome bands and safe-area insets. That delegation is
 * what keeps input honest: screenToWorld below calls this same function, so a
 * tap always maps through the exact transform the frame was drawn with — a
 * separate fit here would silently offset every aim on any non-16:9 viewport.
 */
export function computeViewport(cw: number, ch: number): Viewport {
  const l = computeLayout(cw, ch);
  return { scale: l.scale, ox: l.ox, oy: l.oy };
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
  /** Render-facing FX events (see fx.ts) — drawn by drawEffects() at the end
   *  of render(), over the settled field. */
  effects: FxEvent[];
  level: LevelConfig;
  /** Whether the NEXT shot fired will be a bomb — swaps the muzzle ghost. */
  nextIsBomb: boolean;
  bombs: Matter.Body[];
  /** Current signed wind acceleration (game.ts's windNow) — drives the HUD
   *  wind indicator's length/direction. Already post-stabilizer. */
  windNow: number;
  /** The bay's steady prevailing wind, or null to hide it — shown as a ghost
   *  marker on the gauge only when the Weather Survey unlock is owned (see
   *  meta.ts), so a headwind bay can be planned for rather than discovered. */
  windAverage: number | null;
  /** 0..1 reload progress (cannon.reloadRatio) — drives the muzzle ring. */
  reload: number;
  /** True while the bay's settle window is running (game.ts's Game.settling):
   *  the cannon is locked out, so it dims instead of promising a shot. */
  settling: boolean;
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
  drawWindIndicator(ctx, scene.level, scene.windNow, scene.windAverage);
  drawCompactor(ctx, scene.compactor);
  drawPistons(ctx, scene.compactor);
  for (const cube of scene.cubes) drawCube(ctx, cube, scene.now);
  for (const bomb of scene.bombs) drawBomb(ctx, bomb);
  drawTrajectory(ctx, scene.trajectory);
  // Drawn AFTER the cannon: the barrel is opaque and longer than its visual
  // tip, and previously painted over ghost cells at some aim angles.
  drawCannon(ctx, scene.cannon, scene.aiming, scene.settling);
  drawReloadRing(ctx, scene.cannon, scene.reload);
  if (!scene.settling) {
    drawLoadedPiece(ctx, scene.cannon, scene.level.pieceSize, scene.nextIsBomb);
  }
  drawEffects(ctx, scene.effects, scene.now);

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

/** Linear-interpolate between two "#rrggbb" hex colors (t clamped 0..1) —
 *  used by the wind gauge to shift calm→dangerous with strength. */
function lerpHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const lerp = (sh: number) => {
    const ca = (na >> sh) & 255;
    const cb = (nb >> sh) & 255;
    return Math.round(ca + (cb - ca) * k);
  };
  return `rgb(${lerp(16)},${lerp(8)},${lerp(0)})`;
}

/**
 * HUD wind gauge: a bold, glowing directional bar drawn on a translucent pill
 * just below the top HUD strip (the old thin arrow sat at world-y 34, behind
 * the DOM HUD, and was effectively invisible — see the wind-rework PR). Its
 * length and direction track windNow / level.windMax (signed, so it points the
 * way the wind is actually pushing airborne pieces — see game.ts's
 * windNow/applyWind), and its color ramps calm-cyan → hot-red as the gust
 * strengthens so a strong wind reads as an obvious hazard at a glance. Inert
 * (no draw) when level.windMax is 0 (the calm early bays), matching the
 * mechanic itself.
 */
const WIND_HUD_Y = 108; // world-y, clear of the ~64px DOM HUD strip up top
const WIND_HUD_HALF_LEN = 150; // px of bar reach at full strength (|ratio| = 1)
const WIND_HUD_HEAD = 15;

function drawWindIndicator(
  ctx: CanvasRenderingContext2D,
  level: LevelConfig,
  windNow: number,
  windAverage: number | null,
): void {
  if (level.windMax <= 0) return;
  const ratio = Math.max(-1, Math.min(1, windNow / level.windMax));
  const mag = Math.abs(ratio);
  const dir = ratio >= 0 ? 1 : -1;
  const cx = WORLD.width / 2;
  const y = WIND_HUD_Y;
  const len = ratio * WIND_HUD_HALF_LEN;
  const col = lerpHex(COLORS.aim, COLORS.compactor, mag);

  ctx.save();
  ctx.textAlign = "center";

  // Translucent backing pill so the gauge stays legible over any field state.
  const padX = WIND_HUD_HALF_LEN + 34;
  const pillTop = y - 30;
  const pillH = 52;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(7,7,15,0.55)";
  roundRect(ctx, cx - padX, pillTop, padX * 2, pillH, 12);
  ctx.fill();

  // "WIND" label.
  ctx.font = "700 13px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillStyle = COLORS.textDim;
  ctx.globalAlpha = 0.9;
  ctx.fillText("WIND", cx, y - 14);

  // Baseline track + center tick (the calm/zero reference).
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = COLORS.textDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - WIND_HUD_HALF_LEN, y);
  ctx.lineTo(cx + WIND_HUD_HALF_LEN, y);
  ctx.moveTo(cx, y - 8);
  ctx.lineTo(cx, y + 8);
  ctx.stroke();

  // Glowing strength bar.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 8 + 14 * mag;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx + len, y);
  ctx.stroke();

  // Arrowhead pointing the way the wind pushes.
  if (mag > 0.02) {
    const tipX = cx + len;
    ctx.beginPath();
    ctx.moveTo(tipX + dir * WIND_HUD_HEAD, y);
    ctx.lineTo(tipX, y - WIND_HUD_HEAD * 0.72);
    ctx.lineTo(tipX, y + WIND_HUD_HEAD * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  // Weather Survey (meta unlock): a dim tick at the bay's STEADY average, so
  // the live gust reads as "drifting around a known baseline" instead of an
  // unknowable number. Drawn behind the numeric readout, in the neutral track
  // color, so it never competes with the live bar for attention.
  if (windAverage !== null) {
    const avgRatio = Math.max(-1, Math.min(1, windAverage / level.windMax));
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx + avgRatio * WIND_HUD_HALF_LEN, y - 11);
    ctx.lineTo(cx + avgRatio * WIND_HUD_HALF_LEN, y + 11);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Stabilizer tag: when the launcher cancels part of the wind, say so — the
  // gauge is showing the POST-assist number (game.ts's windNow), and without
  // this the upgrade would silently look like "the weather got easier".
  if (level.windAssist > 0) {
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = COLORS.trajectory;
    ctx.font = "700 11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText(`STAB −${Math.round(level.windAssist * 100)}%`, cx + padX - 44, y - 14);
  }

  // Numeric strength readout under the bar, on the pushing side.
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = col;
  ctx.font = "700 12px 'JetBrains Mono', ui-monospace, monospace";
  const pct = Math.round(mag * 100);
  const glyph = dir >= 0 ? "▶" : "◀";
  ctx.fillText(mag < 0.02 ? "CALM" : `${glyph} ${pct}%`, cx, y + 22);
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

/**
 * Two hydraulic pistons (1d "recycling-plant" layout — see
 * design/screens/gameplay-variants.html's `.piston`) visually "driving" the
 * compactor bar toward the right wall: a fixed barrel mounted so it tucks
 * just under the right edge of the DOM plant panel (the panel spans field
 * x 1.67%..48.75%, i.e. world x 624 — see app.css's .plant; the mockup
 * mounts its barrels at frame x 462/960 = world 616, 8px under the panel
 * edge, so they read as bolted onto the machine), a telescoping rod that
 * stretches/shrinks to the bar's LIVE x-position every frame, and a head
 * that "attaches" right at the bar's left face. Drawn here (not as DOM)
 * precisely because the rod length has to track compactor.x every physics
 * step, same as the bar itself. Two heights, spread inside the compactor's
 * own half-height band (c.top..c.top+c.height) at the mockup's fractions,
 * so they never desync if compactorHeightFrac changes. The bar CAN sweep
 * left of the default mount on a widened bay (leftX bottoms out at 547 < 616
 * at compactorOpenCells 18 — Bay Extension T3, see upgrades.ts), which used to bury
 * the head inside the barrel; the whole rig now slides left per-level so
 * the barrel tip always clears the bar's leftmost face (see drawPistons).
 */
const PISTON_BARREL_X = 616; // world-x, preferred mount — tucked under the plant panel's right edge (624); slides left for wide bays (see drawPistons)
const PISTON_BARREL_LEN = 93;
const PISTON_BARREL_H = 35;
const PISTON_ROD_H = 15;
const PISTON_HEAD_W = 17;
const PISTON_HEAD_H = 51;
const PISTON_Y_FRACS = [0.27, 0.73]; // fraction down the compactor's [top, top+height] band — mockup's two mounts

function drawPistons(ctx: CanvasRenderingContext2D, c: Compactor): void {
  // Mount the rig at the mockup's 616 when the bay allows, but slide it left
  // for wide bays: the barrel tip must stay clear of the bar's LEFTMOST face
  // (c.leftX is the open stop) plus the head's width, or the head would
  // sweep through the housing on full retreat (a fully-extended bay at 18 open
  // cells puts that face at 534, 175px left of the default barrel tip).
  const minFace = c.leftX - c.width / 2;
  const mountX = Math.min(PISTON_BARREL_X, minFace - PISTON_HEAD_W - PISTON_BARREL_LEN - 6);
  for (const frac of PISTON_Y_FRACS) {
    const y = c.top + c.height * frac;
    const barrelX0 = mountX;
    const barrelX1 = barrelX0 + PISTON_BARREL_LEN;
    const headX = c.x - c.width / 2; // the bar's left face — where the piston pushes it
    const rodX0 = barrelX1;
    const rodX1 = Math.max(rodX0, headX - PISTON_HEAD_W / 2);

    ctx.save();

    // Barrel (fixed) — dark riveted housing, subtle top-down gradient.
    const barrelGrad = ctx.createLinearGradient(0, y - PISTON_BARREL_H / 2, 0, y + PISTON_BARREL_H / 2);
    barrelGrad.addColorStop(0, "#2c2c48");
    barrelGrad.addColorStop(1, "#171729");
    ctx.fillStyle = barrelGrad;
    roundRect(ctx, barrelX0, y - PISTON_BARREL_H / 2, PISTON_BARREL_LEN, PISTON_BARREL_H, 3);
    ctx.fill();
    ctx.strokeStyle = "#3d3d63";
    ctx.lineWidth = 1.5;
    roundRect(ctx, barrelX0, y - PISTON_BARREL_H / 2, PISTON_BARREL_LEN, PISTON_BARREL_H, 3);
    ctx.stroke();

    // Rod — telescopes to meet the bar; metallic gradient + cyan glow.
    if (rodX1 > rodX0) {
      const rodGrad = ctx.createLinearGradient(0, y - PISTON_ROD_H / 2, 0, y + PISTON_ROD_H / 2);
      rodGrad.addColorStop(0, "#e2e2f5");
      rodGrad.addColorStop(0.55, "#8f8fc0");
      rodGrad.addColorStop(1, "#5c5c88");
      ctx.shadowColor = "rgba(0,240,255,0.4)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = rodGrad;
      ctx.fillRect(rodX0, y - PISTON_ROD_H / 2, rodX1 - rodX0, PISTON_ROD_H);
      ctx.shadowBlur = 0;
    }

    // Head — attaches at the compactor's left face, same hazard-red as the bar.
    const headGrad = ctx.createLinearGradient(headX - PISTON_HEAD_W, 0, headX, 0);
    headGrad.addColorStop(0, "#ff6f8a");
    headGrad.addColorStop(1, "#ff2d55");
    ctx.shadowColor = "rgba(255,45,85,0.75)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = headGrad;
    roundRect(ctx, headX - PISTON_HEAD_W, y - PISTON_HEAD_H / 2, PISTON_HEAD_W, PISTON_HEAD_H, 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }
}

function drawCube(ctx: CanvasRenderingContext2D, cube: Cube, now: number): void {
  if (!blinkVisible(cube, now)) return;
  const b = cube.body;
  const color = cube.blinkStart !== null ? "#ff6464" : cube.color;
  const dark = shade(color, -70);
  const light = shade(color, 45);
  // A cube's material is legible from its color alone (theme.ts's
  // MATERIAL_SPEC), but the two that CHANGE ITS WORTH get a second, non-color
  // cue as well: color alone would leave a colour-blind player reading slag as
  // just another shipment, and the whole mechanic is knowing which cubes count.
  const slag = cube.material === "slag";
  const cold = cube.material === "cryo" && !cube.struck;

  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  const h = CELL / 2;

  // Slag is inert, so it does not glow — every live shipment on the field does.
  // Cold cryo glows harder than it will once thawed: the frost is the warning.
  ctx.shadowColor = color;
  ctx.shadowBlur = slag ? 0 : cold ? 22 : 16;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.clip();
  if (slag) {
    // Rubble hatching instead of the type pattern — slag has no shipment
    // identity left to advertise, which is precisely its point.
    drawSlagFace(ctx, -h, CELL, dark, light);
  } else {
    // Per-type interior pattern (ported from main.py draw_square_piece)
    drawPattern(ctx, cube.type, -h, -h, CELL, dark, light);
    // Frost crystals over the type pattern, so a cryo O still reads as an O.
    // They vanish the instant it thaws — that transition IS the feedback that
    // the strike landed, and the row is now completable.
    if (cold) drawFrost(ctx, -h, CELL);
  }
  ctx.restore();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = light;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.stroke();
  ctx.restore();
}

/** Slag's interior: coarse diagonal rubble, deliberately irregular and matte.
 *  Derived from the cube's own local coords so it is stable under rotation
 *  rather than shimmering as the cube tumbles. */
function drawSlagFace(
  ctx: CanvasRenderingContext2D,
  o: number,
  size: number,
  dark: string,
  light: string,
): void {
  ctx.fillStyle = dark;
  ctx.fillRect(o, o, size, size);
  ctx.strokeStyle = light;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.5;
  for (let i = -1; i < 4; i++) {
    const s = o + i * (size / 3);
    ctx.beginPath();
    ctx.moveTo(s, o + size);
    ctx.lineTo(s + size * 0.55, o);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Cold cryo's frost: a few white needles radiating from the cube's center.
 *  Drawn only while frozen (see drawCube) so thawing is a visible event. */
function drawFrost(ctx: CanvasRenderingContext2D, o: number, size: number): void {
  const c = o + size / 2;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * size * 0.36, c + Math.sin(a) * size * 0.36);
    ctx.stroke();
  }
  ctx.restore();
}

/** A live flying/rolling bomb — dark sphere with a subtle red glow and a
 *  small fuse-spark highlight, so it reads as distinct from a cube in flight. */
function drawBomb(ctx: CanvasRenderingContext2D, body: Matter.Body): void {
  const r = CELL * 0.45;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.shadowColor = "#ff2d55";
  ctx.shadowBlur = 14;
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, "#3a3a4a");
  grad.addColorStop(1, "#0a0a12");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ff2d55";
  ctx.stroke();
  ctx.fillStyle = "#ffe066";
  ctx.beginPath();
  ctx.arc(0, -r * 0.9, 3, 0, Math.PI * 2);
  ctx.fill();
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
 * so it reads as a preview rather than a real piece. When the level's bomb
 * cadence means the NEXT shot is a bomb, the piece ghost is swapped for a
 * small ghost bomb — the muzzle preview must promise what actually fires.
 */
function drawLoadedPiece(
  ctx: CanvasRenderingContext2D,
  cannon: Cannon,
  size: PieceSize,
  nextIsBomb: boolean,
): void {
  const tip = cannon.tip;

  if (nextIsBomb) {
    const r = CELL * GHOST_SCALE * 0.9;
    ctx.save();
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.shadowColor = "#ff2d55";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#1b1b2e";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff2d55";
    ctx.stroke();
    ctx.restore();
    return;
  }

  const color = PIECE_COLORS[cannon.currentType];
  const offsets = pieceOffsets(cannon.currentType, cannon.pieceRotation, size);
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

function drawCannon(
  ctx: CanvasRenderingContext2D,
  cannon: Cannon,
  aiming: boolean,
  settling = false,
): void {
  const ratio = cannon.powerRatio;
  const barrelColor = `rgb(${Math.round(150 + 105 * ratio)}, ${Math.round(220 - 120 * ratio)}, 90)`;

  ctx.save();
  // Settle window: the cannon is locked out (game.ts's shoot() refuses), so it
  // reads as powered down rather than sitting there looking loaded.
  if (settling) ctx.globalAlpha = 0.35;

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
  ctx.restore();
}

/**
 * Launch cooldown, drawn as an arc sweeping around the cannon base: empty the
 * instant a shot fires, closing to a full ring as the loader finishes. The
 * player's attention is on the cannon while aiming the next shot, so THIS is
 * where "can I fire yet" belongs — the plant panel's reload bar (see
 * ui/screens.ts's .pl-load) carries the same value for peripheral vision, but
 * this is the one you actually read mid-aim. Hidden once fully reloaded so a
 * ready cannon isn't wearing a permanent decoration.
 */
const RELOAD_RING_R = CANNON.size / 2 + 9;

function drawReloadRing(ctx: CanvasRenderingContext2D, cannon: Cannon, reload: number): void {
  if (reload >= 1) return;
  ctx.save();
  ctx.translate(cannon.x, cannon.y);
  // Track.
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = COLORS.textDim;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, RELOAD_RING_R, 0, Math.PI * 2);
  ctx.stroke();
  // Filled portion, starting at 12 o'clock and sweeping clockwise. Warm amber
  // while loading (it reads as "wait"), snapping to the aim cyan at the very
  // end so the moment it becomes fireable is visible in peripheral vision.
  const col = reload > 0.92 ? COLORS.aim : "#ffb020";
  ctx.globalAlpha = 1;
  ctx.strokeStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, RELOAD_RING_R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reload);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// FX layer — pure functions of (event, now). No mutable per-event state and
// no per-frame randomness (that would flicker): any "random-looking" spread
// (shard fling angles, spark placement) is derived from a fixed hash of the
// event's spawn position, so a given event always draws identically at a
// given `now`.
// ---------------------------------------------------------------------------

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Deterministic per-event angle offset (radians) so shard/spark fans don't
 *  all point the same way, without touching Math.random. */
function seedAngle(x: number, y: number): number {
  const seed = (x * 13 + y * 7) | 0;
  return (((seed % 360) + 360) % 360) * (Math.PI / 180);
}

/** Shatter (700ms): 7 shards flung outward from the cube's last position,
 *  plus a bright core flash for the first 120ms. */
const SHATTER_SHARD_COUNT = 7;
const SHATTER_FLING_DIST = 34;
const SHATTER_SHARD_SIZE = 5;
const SHATTER_SHARD_GLOW = 10;
const SHATTER_SPIN = Math.PI / 2;
const SHATTER_CORE_MS = 120;
const SHATTER_CORE_R = 10;

function drawShatterFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "shatter" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.shatter);
  if (t >= 1) return;

  const base = seedAngle(e.x, e.y);
  const dist = easeOutCubic(t) * SHATTER_FLING_DIST;
  const size = SHATTER_SHARD_SIZE * (1 - t);

  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.globalAlpha = 1 - t;
  ctx.shadowColor = e.color;
  ctx.shadowBlur = SHATTER_SHARD_GLOW;
  ctx.fillStyle = e.color;
  if (size > 0) {
    for (let i = 0; i < SHATTER_SHARD_COUNT; i++) {
      const angle = base + i * ((Math.PI * 2) / SHATTER_SHARD_COUNT);
      ctx.save();
      ctx.translate(Math.cos(angle) * dist, Math.sin(angle) * dist);
      ctx.rotate(angle + t * SHATTER_SPIN);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  if (elapsed >= 0 && elapsed < SHATTER_CORE_MS) {
    const coreT = elapsed / SHATTER_CORE_MS;
    ctx.save();
    ctx.globalAlpha = 1 - coreT;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, SHATTER_CORE_R * (1 - coreT), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Payout (1100ms): "+$amount" rising and fading over the cluster. */
const PAYOUT_RISE_PX = 48;
const PAYOUT_FADE_IN_MS = 80;
const PAYOUT_FADE_OUT_MS = 350;
const PAYOUT_CLAMP_MARGIN = 80;
const PAYOUT_FONT = "700 30px system-ui, sans-serif";
const PAYOUT_GLOW = 16;

function drawPayoutFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "payout" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.payout);
  if (t >= 1) return;

  const x = Math.min(Math.max(e.x, PAYOUT_CLAMP_MARGIN), WORLD.width - PAYOUT_CLAMP_MARGIN);
  const y = e.y - easeOutCubic(t) * PAYOUT_RISE_PX;

  let alpha: number;
  if (elapsed < PAYOUT_FADE_IN_MS) {
    alpha = elapsed / PAYOUT_FADE_IN_MS;
  } else if (elapsed > FX_TTL.payout - PAYOUT_FADE_OUT_MS) {
    alpha = (FX_TTL.payout - elapsed) / PAYOUT_FADE_OUT_MS;
  } else {
    alpha = 1;
  }
  alpha = clamp01(alpha);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.trajectory;
  ctx.shadowColor = COLORS.trajectory;
  ctx.shadowBlur = PAYOUT_GLOW;
  ctx.font = PAYOUT_FONT;
  ctx.textAlign = "center";
  ctx.fillText(`+$${e.amount}`, x, y);
  ctx.restore();
}

/** Salvage refund (1100ms): the funds a demolition charge paid back, rising
 *  from the blast. Same motion as a payout so it reads as income, but in the
 *  warn amber of the demolition kit rather than the payout green — at a glance
 *  the player can tell "a line sold" from "I sold scrap metal", which is the
 *  whole reason bombs refund instead of silently topping up the bankroll. */
const SALVAGE_COLOR = "#ffb020";

function drawSalvageFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "salvage" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.salvage);
  if (t >= 1) return;

  const x = Math.min(Math.max(e.x, PAYOUT_CLAMP_MARGIN), WORLD.width - PAYOUT_CLAMP_MARGIN);
  const y = e.y - easeOutCubic(t) * PAYOUT_RISE_PX;
  const alpha = clamp01(elapsed < PAYOUT_FADE_IN_MS ? elapsed / PAYOUT_FADE_IN_MS : 1 - t * t);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SALVAGE_COLOR;
  ctx.shadowColor = SALVAGE_COLOR;
  ctx.shadowBlur = PAYOUT_GLOW;
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`♻ +$${e.amount}`, x, y);
  ctx.restore();
}

/** Lost-cargo penalty (1100ms): "−$amount" SINKING from where the cubes
 *  blinked out, in the compactor's own red. The deliberate mirror of a payout:
 *  income rises green, an expense sinks red, so the two money verbs are
 *  distinguishable before the number is even read. Same fade envelope as the
 *  payout so the pair read as one family. */
const PENALTY_SINK_PX = 34;

function drawPenaltyFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "penalty" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.penalty);
  if (t >= 1) return;

  const x = Math.min(Math.max(e.x, PAYOUT_CLAMP_MARGIN), WORLD.width - PAYOUT_CLAMP_MARGIN);
  const y = e.y + easeOutCubic(t) * PENALTY_SINK_PX;

  let alpha: number;
  if (elapsed < PAYOUT_FADE_IN_MS) {
    alpha = elapsed / PAYOUT_FADE_IN_MS;
  } else if (elapsed > FX_TTL.penalty - PAYOUT_FADE_OUT_MS) {
    alpha = (FX_TTL.penalty - elapsed) / PAYOUT_FADE_OUT_MS;
  } else {
    alpha = 1;
  }
  alpha = clamp01(alpha);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.compactor;
  ctx.shadowColor = COLORS.compactor;
  ctx.shadowBlur = PAYOUT_GLOW;
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`−$${e.amount}`, x, y);
  ctx.restore();
}

/** Bay cleared (1400ms): a bright band sweeping the field left-to-right plus an
 *  expanding ring, spawned once when the settle window resolves (game.ts's
 *  resolveWin). Deliberately a CANVAS effect rather than only a DOM banner: the
 *  moment belongs to the field the player just filled, so the celebration
 *  should wash over the pile itself before the ui/screens.ts banner and the
 *  draft modal take the screen. Additive, inside its own save/restore. */
const BAYCLEAR_BAND_W = 240;

function drawBayClearFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "bayclear" }>,
  now: number,
): void {
  const t = clamp01((now - e.t0) / FX_TTL.bayclear);
  if (t >= 1) return;
  const eased = easeOutCubic(t);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Sweeping band.
  const cxBand = -BAYCLEAR_BAND_W + eased * (WORLD.width + BAYCLEAR_BAND_W * 2);
  const grad = ctx.createLinearGradient(cxBand - BAYCLEAR_BAND_W, 0, cxBand + BAYCLEAR_BAND_W, 0);
  grad.addColorStop(0, "rgba(0,255,156,0)");
  grad.addColorStop(0.5, `rgba(0,255,156,${0.5 * (1 - t)})`);
  grad.addColorStop(1, "rgba(0,255,156,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  // Expanding ring at the event point.
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = COLORS.trajectory;
  ctx.shadowColor = COLORS.trajectory;
  ctx.shadowBlur = 24;
  ctx.lineWidth = 8 * (1 - t) + 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, 60 + eased * 380, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Rowflash (450ms): the cleared row band, bright toward the wall it just
 *  got crushed into. Drawn additively ("lighter") so it blooms rather than
 *  paints a flat white bar; that GCO is scoped to this function's own
 *  save/restore, never leaking into siblings drawn after it. */
const ROWFLASH_EDGE_ALPHA = 0.9;

function drawRowFlashFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "rowflash" }>,
  now: number,
): void {
  const t = clamp01((now - e.t0) / FX_TTL.rowflash);
  if (t >= 1) return;

  const left = Math.min(e.x0, e.x1);
  const width = Math.abs(e.x1 - e.x0);
  if (width <= 0) return;

  const grad = ctx.createLinearGradient(e.x0, 0, e.x1, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, `rgba(255,255,255,${ROWFLASH_EDGE_ALPHA})`);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = (1 - t) * (1 - t);
  ctx.fillStyle = grad;
  ctx.fillRect(left, e.y - CELL / 2, width, CELL);
  ctx.restore();
}

/** Explosion (600ms): expanding ring + brief white flash + orbiting sparks. */
const EXPLOSION_RING_COLOR = "#ffb347";
const EXPLOSION_RADIUS_BASE_FRAC = 0.25;
const EXPLOSION_RADIUS_GROWTH_FRAC = 0.95;
const EXPLOSION_LINEWIDTH_MAX = 10;
const EXPLOSION_LINEWIDTH_MIN = 2;
const EXPLOSION_RING_GLOW = 28;
const EXPLOSION_FLASH_T = 0.25;
const EXPLOSION_FLASH_RADIUS_FRAC = 0.5;
const EXPLOSION_SPARK_COUNT = 6;
const EXPLOSION_SPARK_RADIUS = 3;
const EXPLOSION_SPARK_GLOW = 12;

function drawExplosionFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "explosion" }>,
  now: number,
): void {
  const t = clamp01((now - e.t0) / FX_TTL.explosion);
  if (t >= 1) return;

  const radius = e.r * (EXPLOSION_RADIUS_BASE_FRAC + EXPLOSION_RADIUS_GROWTH_FRAC * easeOutCubic(t));

  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.shadowColor = EXPLOSION_RING_COLOR;
  ctx.shadowBlur = EXPLOSION_RING_GLOW;
  ctx.strokeStyle = EXPLOSION_RING_COLOR;
  ctx.lineWidth = EXPLOSION_LINEWIDTH_MAX * (1 - t) + EXPLOSION_LINEWIDTH_MIN;
  ctx.beginPath();
  ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (t < EXPLOSION_FLASH_T) {
    ctx.save();
    ctx.globalAlpha = 1 - t / EXPLOSION_FLASH_T;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * EXPLOSION_FLASH_RADIUS_FRAC * (1 - t / EXPLOSION_FLASH_T), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const base = seedAngle(e.x, e.y);
  ctx.globalAlpha = 1 - t;
  ctx.shadowBlur = EXPLOSION_SPARK_GLOW;
  ctx.fillStyle = EXPLOSION_RING_COLOR;
  for (let i = 0; i < EXPLOSION_SPARK_COUNT; i++) {
    const angle = base + i * ((Math.PI * 2) / EXPLOSION_SPARK_COUNT);
    const sx = e.x + Math.cos(angle) * radius;
    const sy = e.y + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.arc(sx, sy, EXPLOSION_SPARK_RADIUS * (1 - t), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw all live FX events on top of the settled field. Pure function of
 *  (effects, now): every sub-drawer derives its progress from `now - t0`
 *  and a position-derived hash, so nothing here holds state across frames. */
function drawEffects(ctx: CanvasRenderingContext2D, effects: FxEvent[], now: number): void {
  ctx.save();
  for (const e of effects) {
    switch (e.kind) {
      case "shatter":
        drawShatterFx(ctx, e, now);
        break;
      case "payout":
        drawPayoutFx(ctx, e, now);
        break;
      case "rowflash":
        drawRowFlashFx(ctx, e, now);
        break;
      case "explosion":
        drawExplosionFx(ctx, e, now);
        break;
      case "salvage":
        drawSalvageFx(ctx, e, now);
        break;
      case "penalty":
        drawPenaltyFx(ctx, e, now);
        break;
      case "bayclear":
        drawBayClearFx(ctx, e, now);
        break;
    }
  }
  ctx.restore();
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
