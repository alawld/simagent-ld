// triangle-widget.ts — Phase 8 behavior triangle widget pure math + Graphics draw.
//
// Provides: vertex geometry, barycentric coordinate math, screen/ratio conversion,
// drag state, and a draw function. UI wiring lives in UIScene.
//
// This file has no Phaser imports — only GfxLike from draw-surface.ts.
// All functions are pure (no side effects on external state).

import { HUD, COLOR_PLAYER_COLONY } from './sprites.js';
import type { GfxLike } from './draw-surface.js';

// ---------------------------------------------------------------------------
// Triangle vertex geometry (equilateral-ish inside HUD.TRIANGLE 120x120 at 8,456)
//
// Forage at top-center, Dig at bottom-left, Fight at bottom-right.
// Margins keep vertices away from zone edges for readability.
// ---------------------------------------------------------------------------

const CX = HUD.TRIANGLE.x + HUD.TRIANGLE.w / 2; // 68 (horizontal center)
const CY = HUD.TRIANGLE.y + 12;                  // 468 (top vertex, 12px from top)
const BY = HUD.TRIANGLE.y + HUD.TRIANGLE.h - 8;  // 568 (bottom edge, 8px from bottom)

export const TRIANGLE_VERTICES = {
  forage: { x: CX,                              y: CY },
  dig:    { x: HUD.TRIANGLE.x + 8,              y: BY },
  fight:  { x: HUD.TRIANGLE.x + HUD.TRIANGLE.w - 8, y: BY },
} as const;

// ---------------------------------------------------------------------------
// TriangleDragState — mutable drag tracking (owned by UIScene)
// ---------------------------------------------------------------------------

export interface TriangleDragState {
  isDragging: boolean;
  targetRatio: { forage: number; dig: number; fight: number };
}

export function createTriangleDragState(): TriangleDragState {
  return { isDragging: false, targetRatio: { forage: 100, dig: 0, fight: 0 } };
}

// ---------------------------------------------------------------------------
// screenToBarycentric — pixel coords to {forage, dig, fight} integer percentages
//
// Uses standard 2D signed-area barycentric formula.
// Each weight is clamped to [0, 1] to project out-of-triangle points onto the
// nearest edge (satisfies T-08-10 clamp mitigation).
// fight = 100 - forage - dig guarantees sum === 100 exactly.
// ---------------------------------------------------------------------------

export function screenToBarycentric(px: number, py: number): { forage: number; dig: number; fight: number } {
  const v0 = TRIANGLE_VERTICES.forage;
  const v1 = TRIANGLE_VERTICES.dig;
  const v2 = TRIANGLE_VERTICES.fight;
  const denom = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
  const w0 = ((v1.y - v2.y) * (px - v2.x) + (v2.x - v1.x) * (py - v2.y)) / denom;
  const w1 = ((v2.y - v0.y) * (px - v2.x) + (v0.x - v2.x) * (py - v2.y)) / denom;
  const w2 = 1 - w0 - w1;
  // Clamp each weight to [0,1] so out-of-triangle drags project to nearest edge.
  const f  = Math.max(0, Math.min(1, w0));
  const d  = Math.max(0, Math.min(1, w1));
  const fi = Math.max(0, Math.min(1, w2));
  const sum = f + d + fi || 1; // guard against all-zero degenerate case
  const forage = Math.round((f  / sum) * 100);
  const dig    = Math.round((d  / sum) * 100);
  const fight  = Math.max(0, 100 - forage - dig); // guarantee sum === 100
  return { forage, dig, fight };
}

// ---------------------------------------------------------------------------
// ratioToScreenPos — inverse of screenToBarycentric: ratio -> pixel position
//
// Weighted centroid of the three vertices.
// ---------------------------------------------------------------------------

export function ratioToScreenPos(ratio: { forage: number; dig: number; fight: number }): { x: number; y: number } {
  const total = ratio.forage + ratio.dig + ratio.fight || 1;
  const wF  = ratio.forage / total;
  const wD  = ratio.dig    / total;
  const wFt = ratio.fight  / total;
  return {
    x: wF * TRIANGLE_VERTICES.forage.x + wD * TRIANGLE_VERTICES.dig.x + wFt * TRIANGLE_VERTICES.fight.x,
    y: wF * TRIANGLE_VERTICES.forage.y + wD * TRIANGLE_VERTICES.dig.y + wFt * TRIANGLE_VERTICES.fight.y,
  };
}

// ---------------------------------------------------------------------------
// isInsideTriangle — point-in-triangle test via barycentric sign
// ---------------------------------------------------------------------------

export function isInsideTriangle(px: number, py: number): boolean {
  const v0 = TRIANGLE_VERTICES.forage;
  const v1 = TRIANGLE_VERTICES.dig;
  const v2 = TRIANGLE_VERTICES.fight;
  const denom = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
  const w0 = ((v1.y - v2.y) * (px - v2.x) + (v2.x - v1.x) * (py - v2.y)) / denom;
  const w1 = ((v2.y - v0.y) * (px - v2.x) + (v0.x - v2.x) * (py - v2.y)) / denom;
  const w2 = 1 - w0 - w1;
  return w0 >= 0 && w1 >= 0 && w2 >= 0;
}

// ---------------------------------------------------------------------------
// drawTriangle — render the triangle widget onto a GfxLike (called per frame)
//
// Draws: filled triangle background, current-ratio filled circle,
// target-ratio outline circle. Labels are Phaser Text in UIScene.
// ---------------------------------------------------------------------------

export function drawTriangle(
  gfx: GfxLike,
  currentRatio: { forage: number; dig: number; fight: number },
  targetRatio:  { forage: number; dig: number; fight: number },
): void {
  const v = TRIANGLE_VERTICES;
  // Filled triangle background
  gfx.fillStyle(0x222222, 0.8);
  gfx.fillTriangle(v.forage.x, v.forage.y, v.dig.x, v.dig.y, v.fight.x, v.fight.y);
  // Current ratio marker (filled circle — actual task census)
  const curr = ratioToScreenPos(currentRatio);
  gfx.fillStyle(COLOR_PLAYER_COLONY, 1);
  gfx.fillCircle(curr.x, curr.y, 6);
  // Target ratio marker (outline circle — player-set allocation or drag preview)
  const tgt = ratioToScreenPos(targetRatio);
  gfx.lineStyle(2, 0xffffff, 1);
  gfx.strokeCircle(tgt.x, tgt.y, 6);
}
