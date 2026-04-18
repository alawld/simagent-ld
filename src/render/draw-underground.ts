// draw-underground.ts — Phase 8 underground cross-section drawing module.
//
// Pure functions: take a GfxLike + WorldState snapshots, issue Graphics API calls.
// Renders ONLY the player colony's underground grid (PRD §7b — enemy grids are not drawn).
//
// Uses ONLY Graphics primitives: fillRect, fillCircle, strokeCircle, fillTriangle,
// lineStyle, fillStyle — NO Image, NO Sprite, NO texture loading (HUD-05).
//
// Draw order: drawUnderground calls drawUndergroundTerrain then drawUndergroundEntities.
// Pheromone overlay is called externally by GameScene between terrain and entities.

export type { GfxLike } from './draw-surface.js';

import type { GfxLike } from './draw-surface.js';
import { ugGet, UndergroundTileState } from '../sim/terrain.js';
import { isAlive } from '../sim/ant/ant-store.js';
import { FP_SHIFT } from '../sim/fixed.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import { ChamberType } from '../sim/enums.js';
import { CHAMBER_DIMENSIONS } from '../sim/colony/chamber.js';
import type { WorldState } from '../sim/types.js';
import {
  TILE_SIZE_PX,
  COLOR_UNDERGROUND_SOLID,
  COLOR_UNDERGROUND_OPEN,
  COLOR_MARKED_TILE_OVERLAY,
  COLOR_BEING_DUG_OVERLAY,
  COLOR_UNDERGROUND_CEILING_STRIP,
  COLOR_CHAMBER_QUEEN,
  COLOR_CHAMBER_NURSERY,
  COLOR_CHAMBER_FOOD_STORAGE,
  COLOR_PLAYER_COLONY,
  COLOR_ENEMY_COLONY,
  COLOR_QUEEN_OUTLINE,
  COLOR_ANT_EGG,
  COLOR_ANT_LARVAE,
} from './sprites.js';
import type { CameraState } from './camera.js';

// ---------------------------------------------------------------------------
// Chamber color map
// ---------------------------------------------------------------------------

const CHAMBER_COLORS: Record<number, number> = {
  [ChamberType.Queen]:       COLOR_CHAMBER_QUEEN,
  [ChamberType.Nursery]:     COLOR_CHAMBER_NURSERY,
  [ChamberType.FoodStorage]: COLOR_CHAMBER_FOOD_STORAGE,
};

// ---------------------------------------------------------------------------
// drawUndergroundTerrain
// ---------------------------------------------------------------------------

/**
 * Draw the underground terrain tiles for the player colony's grid.
 *
 * Ceiling strip (ty=0): drawn with COLOR_UNDERGROUND_CEILING_STRIP everywhere,
 * except at entrance surfaceTileX positions where COLOR_UNDERGROUND_OPEN is used.
 *
 * Interior (ty≥1): Solid → solid color; Open → open color; Marked → open + overlay;
 * BeingDug → open + overlay (PRD §7e, UNDR-09).
 *
 * Returns immediately if the player colony's underground grid is undefined (safety
 * for early game states — T-08-06 mitigate).
 */
export function drawUndergroundTerrain(gfx: GfxLike, world: WorldState, cam: CameraState): void {
  const grid = world.undergroundGrids[PLAYER_COLONY_ID];
  if (grid === undefined) return;

  const left   = Math.floor(cam.x - cam.viewportWidth  / 2);
  const top    = Math.floor(cam.y - cam.viewportHeight / 2);
  const right  = Math.min(left + cam.viewportWidth  + 1, grid.width);
  const bottom = Math.min(top  + cam.viewportHeight + 1, grid.height);

  // Collect entrance X positions for ceiling gap rendering
  const colony = world.colonies[PLAYER_COLONY_ID];
  const entranceXSet = new Set<number>();
  if (colony?.entrances) {
    for (const entrance of colony.entrances) {
      entranceXSet.add(entrance.surfaceTileX);
    }
  }

  for (let ty = Math.max(top, 0); ty < bottom; ty++) {
    for (let tx = Math.max(left, 0); tx < right; tx++) {
      const screenX = (tx - left) * TILE_SIZE_PX;
      const screenY = (ty - top)  * TILE_SIZE_PX;

      if (ty === 0) {
        // Ceiling strip: open gap at entrance columns, ceiling color elsewhere
        const color = entranceXSet.has(tx) ? COLOR_UNDERGROUND_OPEN : COLOR_UNDERGROUND_CEILING_STRIP;
        gfx.fillStyle(color, 1);
        gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
      } else {
        const state = ugGet(grid, tx, ty);
        if (state === UndergroundTileState.Solid) {
          gfx.fillStyle(COLOR_UNDERGROUND_SOLID, 1);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
        } else if (state === UndergroundTileState.Open) {
          gfx.fillStyle(COLOR_UNDERGROUND_OPEN, 1);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
        } else if (state === UndergroundTileState.Marked) {
          // Draw open base then overlay
          gfx.fillStyle(COLOR_UNDERGROUND_OPEN, 1);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
          gfx.fillStyle(COLOR_MARKED_TILE_OVERLAY, 0.4);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
        } else if (state === UndergroundTileState.BeingDug) {
          // Draw open base then overlay
          gfx.fillStyle(COLOR_UNDERGROUND_OPEN, 1);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
          gfx.fillStyle(COLOR_BEING_DUG_OVERLAY, 0.5);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// drawUndergroundEntities
// ---------------------------------------------------------------------------

/**
 * Draw chambers, ants, queen, eggs, and larvae in the underground view.
 *
 * Renders ONLY the player colony (PRD §7b — no enemy entity rendering).
 * Ant posX = surface X coordinate; posY = depth (PRD §7e / Pitfall 6).
 * Moving entities (ants) are interpolated between prev and curr at alpha.
 */
export function drawUndergroundEntities(
  gfx: GfxLike,
  prev: WorldState,
  curr: WorldState,
  alpha: number,
  cam: CameraState,
): void {
  const colony = curr.colonies[PLAYER_COLONY_ID];
  if (colony === undefined) return;

  const left = Math.floor(cam.x - cam.viewportWidth  / 2);
  const top  = Math.floor(cam.y - cam.viewportHeight / 2);

  const canvasW = cam.viewportWidth  * TILE_SIZE_PX;
  const canvasH = cam.viewportHeight * TILE_SIZE_PX;

  // --- Chambers ---
  for (const chamber of colony.chambers) {
    const dims = CHAMBER_DIMENSIONS[chamber.chamberType];
    if (dims === undefined) continue;
    const tileX = chamber.posX >> FP_SHIFT;
    const tileY = chamber.posY >> FP_SHIFT;
    const screenX = (tileX - left) * TILE_SIZE_PX;
    const screenY = (tileY - top)  * TILE_SIZE_PX;
    const color = CHAMBER_COLORS[chamber.chamberType] ?? COLOR_CHAMBER_QUEEN;
    gfx.fillStyle(color, 1);
    gfx.fillRect(screenX, screenY, dims.width * TILE_SIZE_PX, dims.height * TILE_SIZE_PX);
  }

  // --- Underground ants (zone === 1) ---
  const maxId = curr.ants.alive.length;
  for (let id = 0; id < maxId; id++) {
    if (!isAlive(curr.ants, id)) continue;
    if (curr.ants.zone[id] !== 1) continue; // underground only

    // Interpolate: posX = surface X, posY = depth (Pitfall 6)
    const prevPxX = (prev.ants.posX[id]! >> FP_SHIFT) * TILE_SIZE_PX;
    const currPxX = (curr.ants.posX[id]! >> FP_SHIFT) * TILE_SIZE_PX;
    const prevPxY = (prev.ants.posY[id]! >> FP_SHIFT) * TILE_SIZE_PX;
    const currPxY = (curr.ants.posY[id]! >> FP_SHIFT) * TILE_SIZE_PX;

    const screenX = prevPxX + (currPxX - prevPxX) * alpha - left * TILE_SIZE_PX;
    const screenY = prevPxY + (currPxY - prevPxY) * alpha - top  * TILE_SIZE_PX;

    // Trivial viewport cull
    if (screenX < -TILE_SIZE_PX || screenX > canvasW || screenY < -TILE_SIZE_PX || screenY > canvasH) continue;

    const colonyId = curr.ants.colonyId[id]!;
    const antColony = curr.colonies[colonyId];
    const isQueen = antColony !== undefined && id === antColony.queenEntityId;

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

  // Eggs (entity IDs in colony.eggs, positions read from world.ants)
  for (const eggId of colony.eggs) {
    if (!isAlive(curr.ants, eggId)) continue;
    const tileX = curr.ants.posX[eggId]! >> FP_SHIFT;
    const tileY = curr.ants.posY[eggId]! >> FP_SHIFT;
    const screenX = (tileX - left) * TILE_SIZE_PX;
    const screenY = (tileY - top)  * TILE_SIZE_PX;
    if (screenX < -TILE_SIZE_PX || screenX > canvasW || screenY < -TILE_SIZE_PX || screenY > canvasH) continue;
    gfx.fillStyle(COLOR_ANT_EGG, 1);
    gfx.fillCircle(screenX + TILE_SIZE_PX / 2, screenY + TILE_SIZE_PX / 2, 3);
  }

  // Larvae (entity IDs in colony.larvae, positions read from world.ants)
  for (const larvaId of colony.larvae) {
    if (!isAlive(curr.ants, larvaId)) continue;
    const tileX = curr.ants.posX[larvaId]! >> FP_SHIFT;
    const tileY = curr.ants.posY[larvaId]! >> FP_SHIFT;
    const screenX = (tileX - left) * TILE_SIZE_PX;
    const screenY = (tileY - top)  * TILE_SIZE_PX;
    if (screenX < -TILE_SIZE_PX || screenX > canvasW || screenY < -TILE_SIZE_PX || screenY > canvasH) continue;
    gfx.fillStyle(COLOR_ANT_LARVAE, 1);
    gfx.fillCircle(screenX + TILE_SIZE_PX / 2, screenY + TILE_SIZE_PX / 2, 4);
  }
}

// ---------------------------------------------------------------------------
// drawUnderground — orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrator: draw terrain then entities for the underground cross-section view.
 *
 * Note: pheromone overlay is drawn by GameScene between terrain and entities;
 * it is NOT called from here.
 */
export function drawUnderground(
  gfx: GfxLike,
  prev: WorldState,
  curr: WorldState,
  alpha: number,
  cam: CameraState,
): void {
  drawUndergroundTerrain(gfx, curr, cam);
  drawUndergroundEntities(gfx, prev, curr, alpha, cam);
}
