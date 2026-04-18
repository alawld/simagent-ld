// draw-surface.ts — Phase 8 surface view drawing module.
//
// Pure functions: take a GfxLike + WorldState snapshots, issue Graphics API calls.
// No scene management, no input handling, no state mutation.
//
// Uses ONLY Graphics primitives: fillRect, fillCircle, strokeCircle, fillTriangle,
// lineStyle, fillStyle — NO Image, NO Sprite, NO texture loading (HUD-05).
//
// Draw order: drawSurface calls drawSurfaceTerrain then drawSurfaceEntities.
// Pheromone overlay is NOT called from here — GameScene calls drawPheromoneOverlay
// between terrain and entities per RESEARCH §Architecture draw-order diagram.

import { sgGet, SurfaceTileState } from '../sim/terrain.js';
import { isAlive } from '../sim/ant/ant-store.js';
import { FP_SHIFT } from '../sim/fixed.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { WorldState } from '../sim/types.js';
import {
  TILE_SIZE_PX,
  COLOR_SURFACE_GRASS_PRIMARY,
  COLOR_SURFACE_DIRT,
  COLOR_FOOD_PILE_NORMAL,
  COLOR_FOOD_PILE_MARKED,
  COLOR_SURFACE_ENTRANCE_HOLE,
  COLOR_PLAYER_COLONY,
  COLOR_ENEMY_COLONY,
  COLOR_QUEEN_OUTLINE,
} from './sprites.js';
import type { CameraState } from './camera.js';

// ---------------------------------------------------------------------------
// GfxLike — minimal Graphics interface (Phaser.GameObjects.Graphics satisfies this)
//
// Defined here; re-exported from draw-underground.ts and draw-pheromone.ts.
// Tests use a spy recorder (MockGfx) that implements this interface.
// ---------------------------------------------------------------------------

export interface GfxLike {
  clear(): GfxLike;
  fillStyle(color: number, alpha?: number): GfxLike;
  lineStyle(width: number, color: number, alpha?: number): GfxLike;
  fillRect(x: number, y: number, w: number, h: number): GfxLike;
  fillCircle(x: number, y: number, r: number): GfxLike;
  strokeCircle(x: number, y: number, r: number): GfxLike;
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): GfxLike;
}

// ---------------------------------------------------------------------------
// Viewport helpers (shared by all draw modules)
// ---------------------------------------------------------------------------

/** Compute visible tile range from camera state. Returns { left, top, right, bottom }. */
function visibleRange(
  cam: CameraState,
  gridWidth: number,
  gridHeight: number,
): { left: number; top: number; right: number; bottom: number } {
  const left   = Math.floor(cam.x - cam.viewportWidth  / 2);
  const top    = Math.floor(cam.y - cam.viewportHeight / 2);
  const right  = Math.min(left + cam.viewportWidth  + 1, gridWidth);
  const bottom = Math.min(top  + cam.viewportHeight + 1, gridHeight);
  return { left, top, right, bottom };
}

// ---------------------------------------------------------------------------
// drawSurfaceTerrain
// ---------------------------------------------------------------------------

/**
 * Draw the surface terrain tiles visible through the camera.
 *
 * Each tile is a single fillRect: Grass → COLOR_SURFACE_GRASS_PRIMARY,
 * Dirt → COLOR_SURFACE_DIRT. Clips to [0, grid bounds). (SURF-06)
 */
export function drawSurfaceTerrain(gfx: GfxLike, world: WorldState, cam: CameraState): void {
  const { left, top, right, bottom } = visibleRange(cam, world.surface.width, world.surface.height);

  for (let ty = Math.max(top, 0); ty < bottom; ty++) {
    for (let tx = Math.max(left, 0); tx < right; tx++) {
      const state = sgGet(world.surface, tx, ty);
      const color = state === SurfaceTileState.Dirt
        ? COLOR_SURFACE_DIRT
        : COLOR_SURFACE_GRASS_PRIMARY;
      gfx.fillStyle(color, 1);
      gfx.fillRect(
        (tx - left) * TILE_SIZE_PX,
        (ty - top)  * TILE_SIZE_PX,
        TILE_SIZE_PX,
        TILE_SIZE_PX,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// drawSurfaceEntities
// ---------------------------------------------------------------------------

/**
 * Draw food piles, entrance holes, and ants (workers + queens) on the surface.
 *
 * Moving entities (ants) are interpolated between prev and curr state at alpha.
 * Static entities (food piles, entrances) read directly from curr. (VIEW-03)
 */
export function drawSurfaceEntities(
  gfx: GfxLike,
  prev: WorldState,
  curr: WorldState,
  alpha: number,
  cam: CameraState,
): void {
  const left = Math.floor(cam.x - cam.viewportWidth  / 2);
  const top  = Math.floor(cam.y - cam.viewportHeight / 2);

  const canvasW = cam.viewportWidth  * TILE_SIZE_PX;
  const canvasH = cam.viewportHeight * TILE_SIZE_PX;

  // --- Food piles ---
  for (const pile of curr.foodPiles) {
    const sx = (pile.tileX - left) * TILE_SIZE_PX;
    const sy = (pile.tileY - top)  * TILE_SIZE_PX;
    // Trivial viewport cull
    if (sx < -TILE_SIZE_PX || sx > canvasW || sy < -TILE_SIZE_PX || sy > canvasH) continue;
    const color = pile.isMarkedPriority ? COLOR_FOOD_PILE_MARKED : COLOR_FOOD_PILE_NORMAL;
    gfx.fillStyle(color, 1);
    gfx.fillCircle(sx + TILE_SIZE_PX / 2, sy + TILE_SIZE_PX / 2, TILE_SIZE_PX / 2 - 2);
  }

  // --- Entrance holes on surface ---
  for (const colony of Object.values(curr.colonies)) {
    if (!colony.entrances) continue;
    for (const entrance of colony.entrances) {
      const sx = (entrance.surfaceTileX - left) * TILE_SIZE_PX;
      const sy = (entrance.surfaceTileY - top)  * TILE_SIZE_PX;
      if (sx < -TILE_SIZE_PX || sx > canvasW || sy < -TILE_SIZE_PX || sy > canvasH) continue;
      gfx.fillStyle(COLOR_SURFACE_ENTRANCE_HOLE, 1);
      gfx.fillRect(sx, sy, TILE_SIZE_PX, TILE_SIZE_PX);
    }
  }

  // --- Ants on surface (zone === 0) ---
  const maxId = curr.ants.alive.length;
  for (let id = 0; id < maxId; id++) {
    if (!isAlive(curr.ants, id)) continue;
    if (curr.ants.zone[id] !== 0) continue; // surface only

    // Interpolate position: fixed-point → pixel
    const prevPxX = (prev.ants.posX[id]! >> FP_SHIFT) * TILE_SIZE_PX;
    const currPxX = (curr.ants.posX[id]! >> FP_SHIFT) * TILE_SIZE_PX;
    const prevPxY = (prev.ants.posY[id]! >> FP_SHIFT) * TILE_SIZE_PX;
    const currPxY = (curr.ants.posY[id]! >> FP_SHIFT) * TILE_SIZE_PX;

    const screenX = prevPxX + (currPxX - prevPxX) * alpha - left * TILE_SIZE_PX;
    const screenY = prevPxY + (currPxY - prevPxY) * alpha - top  * TILE_SIZE_PX;

    // Trivial viewport cull
    if (screenX < -TILE_SIZE_PX || screenX > canvasW || screenY < -TILE_SIZE_PX || screenY > canvasH) continue;

    const colonyId = curr.ants.colonyId[id]!;
    const colony = curr.colonies[colonyId];
    const isQueen = colony !== undefined && id === colony.queenEntityId;

    const color = colonyId === PLAYER_COLONY_ID ? COLOR_PLAYER_COLONY : COLOR_ENEMY_COLONY;

    if (isQueen) {
      gfx.fillStyle(color, 1);
      gfx.fillRect(screenX - 5, screenY - 5, 10, 10);
      gfx.lineStyle(1, COLOR_QUEEN_OUTLINE, 1);
      gfx.strokeCircle(screenX, screenY, 7);
    } else {
      gfx.fillStyle(color, 1);
      gfx.fillRect(screenX - 3, screenY - 3, 6, 6);
    }
  }
}

// ---------------------------------------------------------------------------
// drawSurface — orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrator: draw terrain then entities for the surface view.
 *
 * Note: pheromone overlay is drawn by GameScene between terrain and entities;
 * it is NOT called from here.
 */
export function drawSurface(
  gfx: GfxLike,
  prev: WorldState,
  curr: WorldState,
  alpha: number,
  cam: CameraState,
): void {
  drawSurfaceTerrain(gfx, curr, cam);
  drawSurfaceEntities(gfx, prev, curr, alpha, cam);
}
