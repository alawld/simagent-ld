// minimap.ts — Phase 8 minimap pure draw + click-to-pan helpers.
//
// Renders the surface overview (160x160 at HUD.MINIMAP) onto a GfxLike.
// The minimap always shows the surface view regardless of activeView per PRD §7a.
//
// Exports:
//   drawMinimap(gfx, world, viewState) — called per frame from UIScene.update()
//   minimapClickToTile(px, py) — converts screen pixel to tile coord, returns null if outside
//   applyMinimapClick(viewState, px, py) — pan surface camera + X-link underground camera
//   MINIMAP_SCALE_X, MINIMAP_SCALE_Y — pixel-to-tile scale factors

import {
  HUD,
  COLOR_PLAYER_COLONY,
  COLOR_ENEMY_COLONY,
  COLOR_FOOD_PILE_NORMAL,
  COLOR_SURFACE_GRASS_PRIMARY,
  COLOR_SURFACE_DIRT,
} from './sprites.js';
import { SURFACE_GRID_WIDTH, SURFACE_GRID_HEIGHT, PLAYER_COLONY_ID, ENEMY_COLONY_ID } from '../sim/constants.js';
import { SurfaceTileState, sgGet } from '../sim/terrain.js';
import type { WorldState } from '../sim/types.js';
import type { ViewState } from './camera.js';
import { clampCamera } from './camera.js';
import type { GfxLike } from './draw-surface.js';

export const MINIMAP_SCALE_X = HUD.MINIMAP.w / SURFACE_GRID_WIDTH;   // 160 / 128 = 1.25
export const MINIMAP_SCALE_Y = HUD.MINIMAP.h / SURFACE_GRID_HEIGHT;  // 1.25

export function drawMinimap(gfx: GfxLike, world: WorldState, viewState: ViewState): void {
  // Surface terrain: grass base, then dirt tiles overlaid (PRD §7a — minimap
  // is a surface overview, not a debug panel). Tile cells are ~1.25×1.25 px;
  // we draw them at ceil(scale)+1 so neighbors abut without seams.
  gfx.fillStyle(COLOR_SURFACE_GRASS_PRIMARY, 1);
  gfx.fillRect(HUD.MINIMAP.x, HUD.MINIMAP.y, HUD.MINIMAP.w, HUD.MINIMAP.h);

  const surface = world.surface;
  if (surface !== undefined) {
    gfx.fillStyle(COLOR_SURFACE_DIRT, 1);
    const cellW = Math.ceil(MINIMAP_SCALE_X) + 1;
    const cellH = Math.ceil(MINIMAP_SCALE_Y) + 1;
    for (let ty = 0; ty < surface.height; ty++) {
      for (let tx = 0; tx < surface.width; tx++) {
        if (sgGet(surface, tx, ty) !== SurfaceTileState.Dirt) continue;
        const px = HUD.MINIMAP.x + tx * MINIMAP_SCALE_X;
        const py = HUD.MINIMAP.y + ty * MINIMAP_SCALE_Y;
        gfx.fillRect(px, py, cellW, cellH);
      }
    }
  }

  // Food piles (2x2 pixels per pile)
  for (const pile of world.foodPiles) {
    const px = HUD.MINIMAP.x + pile.tileX * MINIMAP_SCALE_X;
    const py = HUD.MINIMAP.y + pile.tileY * MINIMAP_SCALE_Y;
    gfx.fillStyle(COLOR_FOOD_PILE_NORMAL, 1);
    gfx.fillRect(px - 1, py - 1, 2, 2);
  }

  // Colony markers (4x4 pixels, colored by colony ID)
  for (const colonyIdStr of Object.keys(world.colonies)) {
    const colonyId = Number(colonyIdStr);
    const colony = world.colonies[colonyId]!;
    const color = colonyId === PLAYER_COLONY_ID ? COLOR_PLAYER_COLONY
                : colonyId === ENEMY_COLONY_ID  ? COLOR_ENEMY_COLONY
                : COLOR_PLAYER_COLONY;

    let tileX = 0, tileY = 0;
    if (colony.entrances && colony.entrances.length > 0) {
      // Prefer the first entrance position (surface tile)
      tileX = colony.entrances[0]!.surfaceTileX;
      tileY = colony.entrances[0]!.surfaceTileY;
    } else if (colony.queenEntityId >= 0) {
      // Fall back to queen entity position (FP_SHIFT=8 for fixed-point coords)
      const queenId = colony.queenEntityId;
      tileX = (world.ants.posX[queenId]! >> 8);
      tileY = (world.ants.posY[queenId]! >> 8);
    }

    const px = HUD.MINIMAP.x + tileX * MINIMAP_SCALE_X;
    const py = HUD.MINIMAP.y + tileY * MINIMAP_SCALE_Y;
    gfx.fillStyle(color, 1);
    gfx.fillRect(px - 2, py - 2, 4, 4);
  }

  // Viewport rect — always tracks surfaceCamera (minimap shows surface always per PRD §7a)
  const cam = viewState.surfaceCamera;
  const rx = HUD.MINIMAP.x + (cam.x - cam.viewportWidth  / 2) * MINIMAP_SCALE_X;
  const ry = HUD.MINIMAP.y + (cam.y - cam.viewportHeight / 2) * MINIMAP_SCALE_Y;
  const rw = cam.viewportWidth  * MINIMAP_SCALE_X;
  const rh = cam.viewportHeight * MINIMAP_SCALE_Y;

  // Four one-pixel fillRects form the viewport outline (GfxLike has no strokeRect)
  gfx.fillStyle(0xffffff, 0.8);
  gfx.fillRect(rx,          ry,          rw, 1);   // top edge
  gfx.fillRect(rx,          ry + rh - 1, rw, 1);   // bottom edge
  gfx.fillRect(rx,          ry,          1,  rh);  // left edge
  gfx.fillRect(rx + rw - 1, ry,          1,  rh);  // right edge
}

export function minimapClickToTile(px: number, py: number): { tileX: number; tileY: number } | null {
  if (px < HUD.MINIMAP.x || px >= HUD.MINIMAP.x + HUD.MINIMAP.w) return null;
  if (py < HUD.MINIMAP.y || py >= HUD.MINIMAP.y + HUD.MINIMAP.h) return null;
  return {
    tileX: (px - HUD.MINIMAP.x) / MINIMAP_SCALE_X,
    tileY: (py - HUD.MINIMAP.y) / MINIMAP_SCALE_Y,
  };
}

export function applyMinimapClick(viewState: ViewState, px: number, py: number): boolean {
  const tile = minimapClickToTile(px, py);
  if (!tile) return false;
  viewState.surfaceCamera.x = tile.tileX;
  viewState.surfaceCamera.y = tile.tileY;
  clampCamera(viewState.surfaceCamera, SURFACE_GRID_WIDTH, SURFACE_GRID_HEIGHT);
  // X-link per PRD §7c: minimap pans surface; underground X follows surface X
  if (viewState.activeView === 'underground') {
    viewState.undergroundCamera.x = viewState.surfaceCamera.x;
  }
  return true;
}
