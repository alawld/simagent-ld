// draw-surface.test.ts — Vitest unit tests for the surface view drawing module.
//
// Uses MockGfx (a spy recorder) to capture all GfxLike calls without Phaser.
// All tests run in Node via Vitest — no browser, no Phaser install required.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  drawSurfaceTerrain,
  drawSurfaceEntities,
  drawSurface,
} from './draw-surface.js';
import type { GfxLike } from './draw-surface.js';
import type { WorldState } from '../sim/types.js';
import { createWorldState } from '../sim/types.js';
import { sgSet, SurfaceTileState } from '../sim/terrain.js';
import { initAnt } from '../sim/ant/ant-store.js';
import { FP_SHIFT } from '../sim/fixed.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import { createColonyRecord } from '../sim/colony/colony-store.js';
import {
  TILE_SIZE_PX,
  COLOR_SURFACE_GRASS_PRIMARY,
  COLOR_SURFACE_DIRT,
  COLOR_FOOD_PILE_NORMAL,
  COLOR_FOOD_PILE_MARKED,
  COLOR_QUEEN_OUTLINE,
  COLOR_PLAYER_COLONY,
  COLOR_ENEMY_COLONY,
  COLOR_RALLY_POINT,
} from './sprites.js';
import type { CameraState } from './camera.js';

// ---------------------------------------------------------------------------
// MockGfx — spy recorder implementing GfxLike
// ---------------------------------------------------------------------------

interface GfxCall {
  method: string;
  args: unknown[];
}

class MockGfx implements GfxLike {
  calls: GfxCall[] = [];

  clear(): GfxLike { this.calls.push({ method: 'clear', args: [] }); return this; }
  fillStyle(color: number, alpha?: number): GfxLike {
    this.calls.push({ method: 'fillStyle', args: [color, alpha] }); return this;
  }
  lineStyle(width: number, color: number, alpha?: number): GfxLike {
    this.calls.push({ method: 'lineStyle', args: [width, color, alpha] }); return this;
  }
  fillRect(x: number, y: number, w: number, h: number): GfxLike {
    this.calls.push({ method: 'fillRect', args: [x, y, w, h] }); return this;
  }
  fillCircle(x: number, y: number, r: number): GfxLike {
    this.calls.push({ method: 'fillCircle', args: [x, y, r] }); return this;
  }
  strokeCircle(x: number, y: number, r: number): GfxLike {
    this.calls.push({ method: 'strokeCircle', args: [x, y, r] }); return this;
  }
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): GfxLike {
    this.calls.push({ method: 'fillTriangle', args: [x0, y0, x1, y1, x2, y2] }); return this;
  }

  /** Filter calls by method name. */
  callsOf(method: string): GfxCall[] {
    return this.calls.filter(c => c.method === method);
  }

  reset(): void { this.calls = []; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal camera centered at (cx, cy) with given viewport. */
function makeCamera(cx: number, cy: number, vpW: number, vpH: number): CameraState {
  return { x: cx, y: cy, viewportWidth: vpW, viewportHeight: vpH };
}

/** Build a WorldState with a small surface grid seeded with alternating Grass/Dirt. */
function makeWorld4x4(): WorldState {
  const w = createWorldState(1);
  // Replace surface with a 4x4 grid
  // sgGet/sgSet use the world.surface reference
  // We need a 4×4 grid; createWorldState uses SURFACE_GRID_WIDTH×SURFACE_GRID_HEIGHT (128×128)
  // Set specific tiles to Dirt for a known pattern
  // Make a 2×2 Dirt block starting at (2,0) to test alternating
  sgSet(w.surface, 2, 0, SurfaceTileState.Dirt);
  sgSet(w.surface, 3, 0, SurfaceTileState.Dirt);
  sgSet(w.surface, 2, 1, SurfaceTileState.Dirt);
  sgSet(w.surface, 3, 1, SurfaceTileState.Dirt);
  return w;
}

// ---------------------------------------------------------------------------
// Tests: drawSurfaceTerrain
// ---------------------------------------------------------------------------

describe('drawSurfaceTerrain', () => {
  let gfx: MockGfx;

  beforeEach(() => { gfx = new MockGfx(); });

  it('produces exactly vpW×vpH fillRect calls for a fully-visible window', () => {
    const world = makeWorld4x4();
    // Camera centered at (2,2) with 4×4 viewport — should see exactly 4×4=16 tiles
    // left = floor(2 - 4/2) = 0, right = min(0+4+1, 128)=5, bottom=5
    // But we want exactly 4×4; use a camera at (2,2) with viewport 4×4:
    // left=0, right=min(5,128)=5, bottom=5, so 5×5=25 tiles... hmm.
    // Use camera at exact center so no partial tile appears: center=(2.0, 2.0), vp=4×4
    // left=floor(2-2)=0, right=min(0+4+1,128)=5, so 5 cols; let's use vp=3×3 with cam at (1.5,1.5)
    // left=floor(1.5-1.5)=0, right=min(0+3+1,128)=4, bottom=4 → 4×4=16 calls exactly
    const cam = makeCamera(1.5, 1.5, 3, 3);
    drawSurfaceTerrain(gfx, world, cam);
    const rects = gfx.callsOf('fillRect');
    // We expect (right-max(left,0)) × (bottom-max(top,0)) = 4 × 4 = 16
    expect(rects.length).toBe(16);
  });

  it('assigns COLOR_SURFACE_GRASS_PRIMARY to Grass tiles', () => {
    const world = createWorldState(1); // all Grass
    const cam = makeCamera(1.5, 1.5, 3, 3);
    drawSurfaceTerrain(gfx, world, cam);
    const stylesBefore = gfx.callsOf('fillStyle');
    const grassStyles = stylesBefore.filter(c => c.args[0] === COLOR_SURFACE_GRASS_PRIMARY);
    // All 16 tiles are Grass → 16 fillStyle calls with grass color
    expect(grassStyles.length).toBe(16);
  });

  it('assigns COLOR_SURFACE_DIRT to Dirt tiles', () => {
    const world = makeWorld4x4();
    // tiles (2,0),(3,0),(2,1),(3,1) are Dirt
    const cam = makeCamera(1.5, 1.5, 3, 3);
    drawSurfaceTerrain(gfx, world, cam);
    const dirtStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_SURFACE_DIRT);
    // The 4×4 visible area has tx=0..3, ty=0..3
    // Dirt tiles at (2,0),(3,0),(2,1),(3,1) → 4 dirt styles
    expect(dirtStyles.length).toBe(4);
  });

  it('clips viewport to grid bounds — no fillRect with negative tx or ty offset', () => {
    const world = createWorldState(1);
    // Camera panned to the left edge: center at (0, 64), viewport 50×37
    // left = floor(0 - 25) = -25 → clamp tx to max(left, 0) = 0
    const cam = makeCamera(0, 64, 50, 37);
    drawSurfaceTerrain(gfx, world, cam);
    const rects = gfx.callsOf('fillRect');
    // All rect x values should be >= 0 (no negative screen positions for tiles at tx<0)
    for (const r of rects) {
      const screenX = r.args[0] as number;
      // screenX = (tx - left) * TILE_SIZE_PX; tx >= 0, left <= 0, so screenX >= 0 - left * 16
      // Since left = -25 and tx >= 0: screenX = (0 - (-25)) * 16 = 400 for first tile
      // All positive — no tile at tx<0 should appear
      expect(screenX).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps right/bottom to grid bounds on large viewport', () => {
    // A 128×128 grid with camera at corner and huge viewport should not exceed 128
    const world = createWorldState(1);
    const cam = makeCamera(0, 0, 200, 200);
    drawSurfaceTerrain(gfx, world, cam);
    const rects = gfx.callsOf('fillRect');
    // right = min(left + vp + 1, 128) = min(-100 + 200 + 1, 128) = 101 columns visible
    // top = floor(0-100) = -100, clamped to 0. bottom = min(-100+200+1, 128) = 101
    // So 101 × 101 = 10201 tiles rendered — all within grid
    expect(rects.length).toBeLessThanOrEqual(128 * 128);
  });
});

// ---------------------------------------------------------------------------
// Tests: drawSurfaceEntities
// ---------------------------------------------------------------------------

describe('drawSurfaceEntities', () => {
  let gfx: MockGfx;
  let world: WorldState;

  beforeEach(() => {
    gfx = new MockGfx();
    world = createWorldState(1);
  });

  it('draws 2 fillCircle calls for two food piles (one marked, one normal)', () => {
    // Phase 9: "marked" means pile.foodPileId === playerColony.priorityFoodPileId.
    const playerColony = createColonyRecord(PLAYER_COLONY_ID, 999);
    playerColony.entrances = [];
    playerColony.rallyPoint = null;
    playerColony.digFlowFieldDirty = false;
    playerColony.priorityFoodPileId = 1;
    world.colonies[PLAYER_COLONY_ID] = playerColony;
    world.foodPiles.push({ foodPileId: 1, tileX: 5, tileY: 5 });
    world.foodPiles.push({ foodPileId: 2, tileX: 6, tileY: 5 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    const circles = gfx.callsOf('fillCircle');
    expect(circles.length).toBe(2);
  });

  it('colors the player colony priority pile with COLOR_FOOD_PILE_MARKED', () => {
    const playerColony = createColonyRecord(PLAYER_COLONY_ID, 999);
    playerColony.entrances = [];
    playerColony.rallyPoint = null;
    playerColony.digFlowFieldDirty = false;
    playerColony.priorityFoodPileId = 1;
    world.colonies[PLAYER_COLONY_ID] = playerColony;
    world.foodPiles.push({ foodPileId: 1, tileX: 5, tileY: 5 });
    world.foodPiles.push({ foodPileId: 2, tileX: 6, tileY: 5 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    const markedStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_FOOD_PILE_MARKED);
    const normalStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_FOOD_PILE_NORMAL);
    expect(markedStyles.length).toBe(1);
    expect(normalStyles.length).toBe(1);
  });

  it('does not render an enemy colony priority pile as marked on the player HUD', () => {
    // Enemy colony marks pile 1; player has no priority pile. The HUD must NOT
    // highlight pile 1 — that would leak enemy AI intent to the player.
    const playerColony = createColonyRecord(PLAYER_COLONY_ID, 999);
    playerColony.entrances = [];
    playerColony.rallyPoint = null;
    playerColony.digFlowFieldDirty = false;
    playerColony.priorityFoodPileId = null;
    const enemyColonyId = PLAYER_COLONY_ID + 1;
    const enemyColony = createColonyRecord(enemyColonyId, 888);
    enemyColony.entrances = [];
    enemyColony.rallyPoint = null;
    enemyColony.digFlowFieldDirty = false;
    enemyColony.priorityFoodPileId = 1;
    world.colonies[PLAYER_COLONY_ID] = playerColony;
    world.colonies[enemyColonyId] = enemyColony;
    world.foodPiles.push({ foodPileId: 1, tileX: 5, tileY: 5 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    const markedStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_FOOD_PILE_MARKED);
    expect(markedStyles.length).toBe(0);
  });

  it('preserves sub-tile fixed-point precision when projecting ant position to pixels', () => {
    // Regression: previous code did `(posX >> FP_SHIFT) * TILE_SIZE_PX`, which
    // truncated sub-tile precision before multiplying by tile size. An ant
    // anywhere inside tile 10 (posX in [2560, 2815]) rendered at exactly the
    // same pixel as one at tile 10's upper-left corner — visually pinning it.
    // Fix: `(posX * TILE_SIZE_PX) / FP_ONE` preserves sub-tile offset.
    const prev = createWorldState(1);
    const curr = createWorldState(1);
    const workerId = 0;
    const colonyId = PLAYER_COLONY_ID;
    const colony = createColonyRecord(colonyId, 99); // queen id 99 ≠ worker
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    curr.colonies[colonyId] = colony;
    prev.colonies[colonyId] = colony;

    // Ant at tile 10.5 on X (posX = 10*256 + 128 = 2688) — halfway through tile 10.
    // Under the old buggy math this would render identically to posX=10<<FP_SHIFT.
    const HALF_FP = 128;
    initAnt(prev.ants, workerId, {
      colonyId,
      posX: (10 << FP_SHIFT) + HALF_FP,
      posY: (5 << FP_SHIFT)  + HALF_FP,
      zone: 0,
    });
    initAnt(curr.ants, workerId, {
      colonyId,
      posX: (10 << FP_SHIFT) + HALF_FP,
      posY: (5 << FP_SHIFT)  + HALF_FP,
      zone: 0,
    });

    const cam = makeCamera(10, 5, 20, 20);
    drawSurfaceEntities(gfx, prev, curr, 0, cam);

    const left = Math.floor(cam.x - cam.viewportWidth / 2);
    const top  = Math.floor(cam.y - cam.viewportHeight / 2);
    // posX in pixels = 10.5 * 16 = 168; screenX = 168 - left*16. Body 6×6 centered → x = screenX - 3.
    const expectedScreenX = 10.5 * TILE_SIZE_PX - left * TILE_SIZE_PX;
    const expectedScreenY = 5.5  * TILE_SIZE_PX - top  * TILE_SIZE_PX;
    const rects = gfx.callsOf('fillRect');
    const antRect = rects.find(r =>
      r.args[2] === 6 && r.args[3] === 6 &&
      Math.abs((r.args[0] as number) - (expectedScreenX - 3)) < 0.01 &&
      Math.abs((r.args[1] as number) - (expectedScreenY - 3)) < 0.01,
    );
    expect(antRect).toBeDefined();
  });

  it('interpolates ant position at alpha=0.5 to halfway between prev and curr', () => {
    // Ant (worker, not queen) at posX = 10 << FP_SHIFT in prev, 20 << FP_SHIFT in curr
    const prev = createWorldState(1);
    const curr = createWorldState(1);
    const queenId = 99; // queen ID that is NOT the worker ant
    const workerId = 0;
    const colonyId = PLAYER_COLONY_ID;

    // Setup colony: queen is entity 99, worker is entity 0
    const colony = createColonyRecord(colonyId, queenId);
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    curr.colonies[colonyId] = colony;
    prev.colonies[colonyId] = colony;

    // Worker ant: moves from tile 10 to tile 20 (X axis)
    initAnt(prev.ants, workerId, { colonyId, posX: 10 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });
    initAnt(curr.ants, workerId, { colonyId, posX: 20 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });

    const cam = makeCamera(15, 5, 50, 37);
    drawSurfaceEntities(gfx, prev, curr, 0.5, cam);

    const rects = gfx.callsOf('fillRect');
    // Expected position: prevPxX=10*16=160, currPxX=20*16=320, alpha=0.5 → midpoint=240px
    // screenX = 240 - left*16 = 240 - floor(15-25)*16 = 240 - (-10*16) = 240+160 = 400
    // Worker rect drawn at (screenX-3, screenY-3, 6, 6) → x arg = 397
    const left = Math.floor(cam.x - cam.viewportWidth / 2); // floor(15-25) = -10
    const expectedScreenX = (10 * 16 + (20 * 16 - 10 * 16) * 0.5) - left * TILE_SIZE_PX; // 400
    const antRect = rects.find(r => Math.abs((r.args[0] as number) - (expectedScreenX - 3)) < 0.5);
    expect(antRect).toBeDefined();
  });

  it('draws queen with larger rect (12×12) and a strokeCircle', () => {
    const antId = 0;
    const colonyId = PLAYER_COLONY_ID;

    const colony = createColonyRecord(colonyId, antId); // queen = antId 0
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    world.colonies[colonyId] = colony;

    initAnt(world.ants, antId, { colonyId, posX: 5 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);

    const rects = gfx.callsOf('fillRect');
    // Queen rect is 12×12 (Phase 8.5 readability bump from 10×10).
    const queenRect = rects.find(r => r.args[2] === 12 && r.args[3] === 12);
    expect(queenRect).toBeDefined();

    const strokeCircles = gfx.callsOf('strokeCircle');
    expect(strokeCircles.length).toBeGreaterThanOrEqual(1);

    const lineStyles = gfx.callsOf('lineStyle').filter(c => c.args[1] === COLOR_QUEEN_OUTLINE);
    expect(lineStyles.length).toBeGreaterThanOrEqual(1);
  });

  it('draws regular worker with 6×6 rect', () => {
    const antId = 1; // not the queen (queen=0)
    const colonyId = PLAYER_COLONY_ID;

    const colony = createColonyRecord(colonyId, 0); // queen = entity 0
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    world.colonies[colonyId] = colony;

    initAnt(world.ants, antId, { colonyId, posX: 5 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);

    const rects = gfx.callsOf('fillRect');
    const workerRect = rects.find(r => r.args[2] === 6 && r.args[3] === 6);
    expect(workerRect).toBeDefined();
  });

  it('uses COLOR_PLAYER_COLONY for player ants, COLOR_ENEMY_COLONY for enemy ants', () => {
    const playerAntId = 0;
    const enemyAntId  = 1;
    const playerColony = createColonyRecord(PLAYER_COLONY_ID, 99); // queen != either ant
    playerColony.entrances = [];
    playerColony.rallyPoint = null;
    playerColony.digFlowFieldDirty = false;
    world.colonies[PLAYER_COLONY_ID] = playerColony;

    const ENEMY_COLONY_ID = 2;
    const enemyColony = createColonyRecord(ENEMY_COLONY_ID, 99);
    enemyColony.entrances = [];
    enemyColony.rallyPoint = null;
    enemyColony.digFlowFieldDirty = false;
    world.colonies[ENEMY_COLONY_ID] = enemyColony;

    initAnt(world.ants, playerAntId, { colonyId: PLAYER_COLONY_ID, posX: 5 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });
    initAnt(world.ants, enemyAntId,  { colonyId: ENEMY_COLONY_ID,  posX: 7 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });

    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);

    const playerStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_PLAYER_COLONY);
    const enemyStyles  = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_ENEMY_COLONY);
    expect(playerStyles.length).toBeGreaterThanOrEqual(1);
    expect(enemyStyles.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT draw ants with zone=1 (underground ants)', () => {
    world.colonies[PLAYER_COLONY_ID] = (() => {
      const c = createColonyRecord(PLAYER_COLONY_ID, 99);
      c.entrances = []; c.rallyPoint = null; c.digFlowFieldDirty = false;
      return c;
    })();
    initAnt(world.ants, 0, { colonyId: PLAYER_COLONY_ID, posX: 5 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 1 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    const rects = gfx.callsOf('fillRect');
    expect(rects.length).toBe(0); // no surface draws
    const circles = gfx.callsOf('fillCircle');
    expect(circles.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: rally-point marker (Phase 9 usability fix)
// ---------------------------------------------------------------------------

describe('drawSurfaceEntities — rally-point marker', () => {
  let gfx: MockGfx;
  let world: WorldState;

  beforeEach(() => {
    gfx = new MockGfx();
    world = createWorldState(1);
  });

  function addPlayerColony(rallyPoint: { tileX: number; tileY: number } | null): void {
    const colony = createColonyRecord(PLAYER_COLONY_ID, 999);
    colony.entrances = [];
    colony.rallyPoint = rallyPoint;
    colony.digFlowFieldDirty = false;
    colony.priorityFoodPileId = null;
    world.colonies[PLAYER_COLONY_ID] = colony;
  }

  /** The rally marker is white fillRects. Identify them by fill color. */
  function rallyRects(g: MockGfx): GfxCall[] {
    const out: GfxCall[] = [];
    let currentStyleIsRally = false;
    for (const c of g.calls) {
      if (c.method === 'fillStyle') {
        currentStyleIsRally = c.args[0] === COLOR_RALLY_POINT;
      } else if (c.method === 'fillRect' && currentStyleIsRally) {
        out.push(c);
      }
    }
    return out;
  }

  it('renders a rally marker when the player colony has a rally point', () => {
    addPlayerColony({ tileX: 5, tileY: 5 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBeGreaterThan(0);
  });

  it('renders no rally marker when rallyPoint is null', () => {
    addPlayerColony(null);
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBe(0);
  });

  it('rally marker moves with the rally point tile (camera-relative position)', () => {
    addPlayerColony({ tileX: 10, tileY: 4 });
    const cam = makeCamera(10, 4, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    const rects = rallyRects(gfx);
    expect(rects.length).toBeGreaterThan(0);
    // Expected tile screen origin:
    //   left = floor(10 - 10) = 0; top = floor(4 - 10) = -6
    //   sx = (10 - 0) * 16 = 160; sy = (4 - (-6)) * 16 = 160
    const left = Math.floor(cam.x - cam.viewportWidth  / 2);
    const top  = Math.floor(cam.y - cam.viewportHeight / 2);
    const sx = (10 - left) * TILE_SIZE_PX;
    const sy = (4  - top)  * TILE_SIZE_PX;
    // Every rally rect must land within that 16×16 tile.
    for (const r of rects) {
      const rx = r.args[0] as number;
      const ry = r.args[1] as number;
      expect(rx).toBeGreaterThanOrEqual(sx);
      expect(ry).toBeGreaterThanOrEqual(sy);
      expect(rx).toBeLessThan(sx + TILE_SIZE_PX);
      expect(ry).toBeLessThan(sy + TILE_SIZE_PX);
    }
  });

  it('rally marker disappears after rallyPoint is cleared', () => {
    addPlayerColony({ tileX: 5, tileY: 5 });
    const cam = makeCamera(5, 5, 20, 20);

    drawSurfaceEntities(gfx, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBeGreaterThan(0);

    // Simulate what ClearRallyPoint does in the sim.
    world.colonies[PLAYER_COLONY_ID]!.rallyPoint = null;
    gfx.reset();

    drawSurfaceEntities(gfx, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBe(0);
  });

  it('does not render an enemy colony rally point on the player HUD', () => {
    addPlayerColony(null);
    const enemyId = PLAYER_COLONY_ID + 1;
    const enemy = createColonyRecord(enemyId, 888);
    enemy.entrances = [];
    enemy.rallyPoint = { tileX: 5, tileY: 5 };
    enemy.digFlowFieldDirty = false;
    enemy.priorityFoodPileId = null;
    world.colonies[enemyId] = enemy;

    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: drawSurface orchestrator
// ---------------------------------------------------------------------------

describe('drawSurface', () => {
  it('calls both terrain and entity draws (terrain rects + entity draws present)', () => {
    const gfx = new MockGfx();
    const world = createWorldState(1);
    world.foodPiles.push({ foodPileId: 1, tileX: 5, tileY: 5 });
    const cam = makeCamera(5, 5, 10, 10);
    drawSurface(gfx, world, world, 0, cam);
    // Terrain fillRects should be present
    expect(gfx.callsOf('fillRect').length).toBeGreaterThan(0);
    // Food pile circle should be present
    expect(gfx.callsOf('fillCircle').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HUD-05 enforcement: draw-surface.ts must not reference Image/Sprite/load.image etc.
// ---------------------------------------------------------------------------

describe('HUD-05 compliance — draw-surface.ts source', () => {
  it('contains no Phaser.GameObjects.Image, Sprite, load.image, load.spritesheet, load.atlas', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, 'draw-surface.ts'), 'utf8');
    expect(src).not.toMatch(/Phaser\.GameObjects\.Image/);
    expect(src).not.toMatch(/Phaser\.GameObjects\.Sprite/);
    expect(src).not.toMatch(/load\.image/);
    expect(src).not.toMatch(/load\.spritesheet/);
    expect(src).not.toMatch(/load\.atlas/);
  });
});
