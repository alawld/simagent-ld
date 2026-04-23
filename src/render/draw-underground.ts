// draw-underground.ts — Phase 8 underground cross-section drawing module.
//
// Pure functions: take a GfxLike + AntSpriteLayer + WorldState snapshots,
// issue Graphics API calls and AntSpriteLayer.drawAnt calls. Renders ONLY
// the player colony's underground grid (PRD §7b — enemy grids are not drawn).
//
// Non-ant primitives use ONLY Graphics: fillRect, fillCircle, strokeCircle,
// fillTriangle, lineStyle, fillStyle. Ants go through the AntSpriteLayer —
// GameScene plugs in a Phaser-backed sprite pool; tests plug in a recording
// mock. draw-underground.ts itself remains Phaser-free.
//
// Draw order: drawUnderground calls drawUndergroundTerrain then drawUndergroundEntities.
// Pheromone overlay is called externally by GameScene between terrain and entities.

export type { GfxLike } from './draw-surface.js';

import type { GfxLike } from './draw-surface.js';
import type { AntSpriteLayer } from './ant-sprite-layer.js';
import { ugGet, UndergroundTileState } from '../sim/terrain.js';
import { isAlive } from '../sim/ant/ant-store.js';
import { FP_SHIFT, FP_ONE } from '../sim/fixed.js';
import { PLAYER_COLONY_ID, FOOD_CHAMBER_CAPACITY } from '../sim/constants.js';
import { ChamberType } from '../sim/enums.js';
import { CHAMBER_DIMENSIONS } from '../sim/colony/chamber.js';
import type { WorldState } from '../sim/types.js';
import type { ColonyRecord } from '../sim/colony/colony-store.js';
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
  COLOR_CHAMBER_FOOD_STORAGE_FILL,
  COLOR_PLAYER_COLONY,
  COLOR_QUEEN_OUTLINE,
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
// projectFoodStorageFill — responsive per-chamber fill (09 render polish)
//
// colony.foodStored is the authoritative pooled total (PRD §2 reconcile
// contract). ChamberRecord.foodStored is *derived* state refreshed only on
// tickReconcile (every RECONCILE_INTERVAL_TICKS), so reading it for the
// per-chamber visual lags real deposits by up to one reconcile interval.
//
// This projection mirrors tickReconcile's distribution logic exactly: walk
// completed FoodStorage chambers in colony.chambers order and hand each one
// up to FOOD_CHAMBER_CAPACITY units from the pool. Pure — never mutates
// colony, chamber, or any sim state. Render-only view.
// ---------------------------------------------------------------------------

/**
 * Projected fill (0..FOOD_CHAMBER_CAPACITY) for the named FoodStorage chamber,
 * derived live from colony.foodStored rather than the lagging
 * ChamberRecord.foodStored field. Returns 0 if chamberId isn't a FoodStorage
 * chamber in this colony.
 */
export function projectFoodStorageFill(colony: ColonyRecord, chamberId: number): number {
  let distributed = 0;
  for (const ch of colony.chambers) {
    if (ch.chamberType !== ChamberType.FoodStorage) continue;
    const available = colony.foodStored - distributed;
    const fill = available <= 0
      ? 0
      : available < FOOD_CHAMBER_CAPACITY ? available : FOOD_CHAMBER_CAPACITY;
    if (ch.chamberId === chamberId) return fill;
    distributed += fill;
  }
  return 0;
}

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
        // Phase 8.5 usability (PRD §7c.1): highlight entrance-column ceiling
        // gaps with a translucent gold tint so the "way in" reads at a glance
        // even when the grid is almost entirely Solid (first-visit state).
        if (entranceXSet.has(tx)) {
          gfx.fillStyle(COLOR_QUEEN_OUTLINE, 0.28);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
        }
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
          // Phase 8.5 readability: overlay alpha 0.4→0.55 so Marked tiles read
          // distinctly from Open floor without washing out the blue tint.
          gfx.fillStyle(COLOR_UNDERGROUND_OPEN, 1);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
          gfx.fillStyle(COLOR_MARKED_TILE_OVERLAY, 0.55);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
        } else if (state === UndergroundTileState.BeingDug) {
          // Draw open base then overlay
          // Phase 8.5 readability: overlay alpha 0.5→0.65 so BeingDug tiles
          // read as actively worked, not just "vaguely tinted".
          gfx.fillStyle(COLOR_UNDERGROUND_OPEN, 1);
          gfx.fillRect(screenX, screenY, TILE_SIZE_PX, TILE_SIZE_PX);
          gfx.fillStyle(COLOR_BEING_DUG_OVERLAY, 0.65);
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
  sprites: AntSpriteLayer,
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
  // Phase 8.5 usability (PRD §7c.1): after drawing the chamber fill, queen
  // chambers get a 2-px gold outline so at least one landmark is visible on
  // the first underground Tab, even when the rest of the grid is all-Solid.
  for (const chamber of colony.chambers) {
    const dims = CHAMBER_DIMENSIONS[chamber.chamberType];
    if (dims === undefined) continue;
    const tileX = chamber.posX >> FP_SHIFT;
    const tileY = chamber.posY >> FP_SHIFT;
    const screenX = (tileX - left) * TILE_SIZE_PX;
    const screenY = (tileY - top)  * TILE_SIZE_PX;
    const color = CHAMBER_COLORS[chamber.chamberType] ?? COLOR_CHAMBER_QUEEN;
    const w = dims.width  * TILE_SIZE_PX;
    const h = dims.height * TILE_SIZE_PX;
    gfx.fillStyle(color, 1);
    gfx.fillRect(screenX, screenY, w, h);
    if (chamber.chamberType === ChamberType.Queen) {
      gfx.fillStyle(COLOR_QUEEN_OUTLINE, 0.7);
      gfx.fillRect(screenX,         screenY,         w, 2);     // top
      gfx.fillRect(screenX,         screenY + h - 2, w, 2);     // bottom
      gfx.fillRect(screenX,         screenY,         2, h);     // left
      gfx.fillRect(screenX + w - 2, screenY,         2, h);     // right
    }
    // FoodStorage fill visualization — per-tile amber food-cache sprites
    // stacked from the chamber floor upward. Fill count is driven by the
    // *projected* per-chamber share of colony.foodStored (NOT the lagging
    // ChamberRecord.foodStored), so deposits show the instant the forager
    // returns instead of snapping into place at the next reconcile tick.
    //
    // Each tile in the chamber footprint can hold one food-cache SVG; the
    // ratio `projected / FOOD_CHAMBER_CAPACITY` maps to the number of filled
    // tiles, bottom-row first. Tiles are sprite-layer draws (drawStatic)
    // rather than Graphics primitives — draw-underground.ts stays Phaser-free
    // and GameScene's AntSpritePool handles the actual image objects.
    if (chamber.chamberType === ChamberType.FoodStorage) {
      const projected = projectFoodStorageFill(colony, chamber.chamberId);
      if (projected > 0) {
        const totalTiles = dims.width * dims.height;
        const frac = Math.min(1, projected / FOOD_CHAMBER_CAPACITY);
        const filledTiles = Math.min(totalTiles, Math.max(1, Math.round(frac * totalTiles)));
        // Fill bottom-row first so the pile appears to stack upward. Walk
        // rows from the chamber floor (bottom) toward the ceiling; within
        // each row, walk left→right. Stop once `filledTiles` are placed.
        let placed = 0;
        for (let row = dims.height - 1; row >= 0 && placed < filledTiles; row--) {
          for (let col = 0; col < dims.width && placed < filledTiles; col++) {
            const cx = screenX + col * TILE_SIZE_PX + TILE_SIZE_PX / 2;
            const cy = screenY + row * TILE_SIZE_PX + TILE_SIZE_PX / 2;
            sprites.drawStatic({
              kind: 'food-cache',
              x: cx,
              y: cy,
              tint: COLOR_CHAMBER_FOOD_STORAGE_FILL,
            });
            placed++;
          }
        }
      }
    }
  }

  // --- Underground ants (zone === 1, player colony only per PRD §7b) ---
  // Wrong-plane flicker guard (09 render polish): mirror draw-surface. When
  // prev.zone !== curr.zone (queen descending/ascending through an entrance)
  // or the slot wasn't alive in prev (freshly-spawned ant whose prev.posX/Y
  // is a stale default), interpolating prev→curr briefly renders the ant on
  // the wrong plane or at the origin. Snap to curr in those cases.
  const maxId = curr.ants.alive.length;
  for (let id = 0; id < maxId; id++) {
    if (!isAlive(curr.ants, id)) continue;
    if (curr.ants.zone[id] !== 1) continue; // underground only
    if (curr.ants.colonyId[id] !== PLAYER_COLONY_ID) continue; // no enemy leak

    const useInterp = isAlive(prev.ants, id) && prev.ants.zone[id] === curr.ants.zone[id];

    // Interpolate: posX = surface X, posY = depth (Pitfall 6). Multiply BEFORE
    // dividing so sub-tile precision survives — truncating with `>> FP_SHIFT`
    // first would snap the ant to its tile's upper-left corner, and it would
    // appear pinned to the entrance/chamber origin instead of moving through it.
    const prevPxX = (prev.ants.posX[id]! * TILE_SIZE_PX) / FP_ONE;
    const currPxX = (curr.ants.posX[id]! * TILE_SIZE_PX) / FP_ONE;
    const prevPxY = (prev.ants.posY[id]! * TILE_SIZE_PX) / FP_ONE;
    const currPxY = (curr.ants.posY[id]! * TILE_SIZE_PX) / FP_ONE;

    const baseX = useInterp ? prevPxX + (currPxX - prevPxX) * alpha : currPxX;
    const baseY = useInterp ? prevPxY + (currPxY - prevPxY) * alpha : currPxY;
    const screenX = baseX - left * TILE_SIZE_PX;
    const screenY = baseY - top  * TILE_SIZE_PX;

    // Trivial viewport cull
    if (screenX < -TILE_SIZE_PX || screenX > canvasW || screenY < -TILE_SIZE_PX || screenY > canvasH) continue;

    // Facing: rotate the SVG (head on -x natively) toward the interpolated
    // motion vector. Stationary ants (dx=dy=0) hold a stable default pose via
    // rotation=0 rather than snapping to an arbitrary direction. When we
    // skipped interpolation (zone flip / spawn frame), the prev→curr delta
    // doesn't represent motion, so use rotation=0 as well. See
    // AntSpriteDrawOptions.rotation for the math.
    const dx = currPxX - prevPxX;
    const dy = currPxY - prevPxY;
    const rotation = (!useInterp || Math.abs(dx) + Math.abs(dy) < 0.01) ? 0 : Math.atan2(-dy, -dx);

    const isQueen = id === colony.queenEntityId;
    sprites.drawAnt({
      kind: isQueen ? 'queen' : 'worker',
      x: screenX,
      y: screenY,
      tint: COLOR_PLAYER_COLONY,
      rotation,
    });
  }

  // Eggs + larvae (nursery brood). Route through the sprite layer so both
  // stages use the repo-owned SVGs in code/public/assets/sprites/. Drawn
  // from the brood entity positions exactly — the sim's nurses have already
  // moved them into the nursery footprint, so rendering at the entity's
  // current tile is what places them inside the chamber visually.
  drawBrood(sprites, curr, colony.eggs, 'egg', left, top, canvasW, canvasH);
  drawBrood(sprites, curr, colony.larvae, 'larva', left, top, canvasW, canvasH);
}

/** Shared loop for rendering a list of brood entity IDs as static sprites. */
function drawBrood(
  sprites: AntSpriteLayer,
  curr: WorldState,
  entityIds: readonly number[],
  kind: 'egg' | 'larva',
  left: number,
  top: number,
  canvasW: number,
  canvasH: number,
): void {
  for (const id of entityIds) {
    if (!isAlive(curr.ants, id)) continue;
    const tileX = curr.ants.posX[id]! >> FP_SHIFT;
    const tileY = curr.ants.posY[id]! >> FP_SHIFT;
    const screenX = (tileX - left) * TILE_SIZE_PX;
    const screenY = (tileY - top)  * TILE_SIZE_PX;
    if (screenX < -TILE_SIZE_PX || screenX > canvasW || screenY < -TILE_SIZE_PX || screenY > canvasH) continue;
    sprites.drawStatic({
      kind,
      x: screenX + TILE_SIZE_PX / 2,
      y: screenY + TILE_SIZE_PX / 2,
    });
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
  sprites: AntSpriteLayer,
  prev: WorldState,
  curr: WorldState,
  alpha: number,
  cam: CameraState,
): void {
  drawUndergroundTerrain(gfx, curr, cam);
  drawUndergroundEntities(gfx, sprites, prev, curr, alpha, cam);
}
