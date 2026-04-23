// draw-surface.test.ts — Vitest unit tests for the surface view drawing module.
//
// Uses MockGfx (GfxLike spy) for terrain/food/entrance/rally primitives and
// MockAntSprites (AntSpriteLayer spy) for ant draws. All tests run in Node
// via Vitest — no browser, no Phaser install required.

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
import type {
  AntSpriteDrawOptions,
  AntSpriteLayer,
  StaticSpriteDrawOptions,
} from './ant-sprite-layer.js';
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
// MockAntSprites — spy recorder implementing AntSpriteLayer
// ---------------------------------------------------------------------------

class MockAntSprites implements AntSpriteLayer {
  calls: AntSpriteDrawOptions[] = [];
  staticCalls: StaticSpriteDrawOptions[] = [];
  beginFrames = 0;
  endFrames = 0;
  beginFrame(): void { this.beginFrames++; }
  drawAnt(opts: AntSpriteDrawOptions): void { this.calls.push({ ...opts }); }
  drawStatic(opts: StaticSpriteDrawOptions): void { this.staticCalls.push({ ...opts }); }
  endFrame(): void { this.endFrames++; }
  reset(): void {
    this.calls = []; this.staticCalls = [];
    this.beginFrames = 0; this.endFrames = 0;
  }
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
    const cam = makeCamera(1.5, 1.5, 3, 3);
    drawSurfaceTerrain(gfx, world, cam);
    const rects = gfx.callsOf('fillRect');
    expect(rects.length).toBe(16);
  });

  it('assigns COLOR_SURFACE_GRASS_PRIMARY to Grass tiles', () => {
    const world = createWorldState(1);
    const cam = makeCamera(1.5, 1.5, 3, 3);
    drawSurfaceTerrain(gfx, world, cam);
    const grassStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_SURFACE_GRASS_PRIMARY);
    expect(grassStyles.length).toBe(16);
  });

  it('assigns COLOR_SURFACE_DIRT to Dirt tiles', () => {
    const world = makeWorld4x4();
    const cam = makeCamera(1.5, 1.5, 3, 3);
    drawSurfaceTerrain(gfx, world, cam);
    const dirtStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_SURFACE_DIRT);
    expect(dirtStyles.length).toBe(4);
  });

  it('clips viewport to grid bounds — no fillRect with negative tx or ty offset', () => {
    const world = createWorldState(1);
    const cam = makeCamera(0, 64, 50, 37);
    drawSurfaceTerrain(gfx, world, cam);
    const rects = gfx.callsOf('fillRect');
    for (const r of rects) {
      const screenX = r.args[0] as number;
      expect(screenX).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps right/bottom to grid bounds on large viewport', () => {
    const world = createWorldState(1);
    const cam = makeCamera(0, 0, 200, 200);
    drawSurfaceTerrain(gfx, world, cam);
    const rects = gfx.callsOf('fillRect');
    expect(rects.length).toBeLessThanOrEqual(128 * 128);
  });
});

// ---------------------------------------------------------------------------
// Tests: drawSurfaceEntities
// ---------------------------------------------------------------------------

describe('drawSurfaceEntities', () => {
  let gfx: MockGfx;
  let sprites: MockAntSprites;
  let world: WorldState;

  beforeEach(() => {
    gfx = new MockGfx();
    sprites = new MockAntSprites();
    world = createWorldState(1);
  });

  it('draws 2 fillCircle calls for two food piles (one marked, one normal)', () => {
    const playerColony = createColonyRecord(PLAYER_COLONY_ID, 999);
    playerColony.entrances = [];
    playerColony.rallyPoint = null;
    playerColony.digFlowFieldDirty = false;
    playerColony.priorityFoodPileId = 1;
    world.colonies[PLAYER_COLONY_ID] = playerColony;
    world.foodPiles.push({ foodPileId: 1, tileX: 5, tileY: 5 });
    world.foodPiles.push({ foodPileId: 2, tileX: 6, tileY: 5 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
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
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    const markedStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_FOOD_PILE_MARKED);
    const normalStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_FOOD_PILE_NORMAL);
    expect(markedStyles.length).toBe(1);
    expect(normalStyles.length).toBe(1);
  });

  it('does not render an enemy colony priority pile as marked on the player HUD', () => {
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
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    const markedStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_FOOD_PILE_MARKED);
    expect(markedStyles.length).toBe(0);
  });

  it('preserves sub-tile fixed-point precision when projecting ant position to pixels', () => {
    // Regression: previous code did `(posX >> FP_SHIFT) * TILE_SIZE_PX`, which
    // truncated sub-tile precision before multiplying by tile size. The sprite
    // layer now receives screen-space pixels directly, so the same assertion
    // applies: an ant at tile 10.5 must land at pixel 10.5 * TILE_SIZE_PX.
    const prev = createWorldState(1);
    const curr = createWorldState(1);
    const workerId = 0;
    const colonyId = PLAYER_COLONY_ID;
    const colony = createColonyRecord(colonyId, 99);
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    curr.colonies[colonyId] = colony;
    prev.colonies[colonyId] = colony;

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
    drawSurfaceEntities(gfx, sprites, prev, curr, 0, cam);

    const left = Math.floor(cam.x - cam.viewportWidth / 2);
    const top  = Math.floor(cam.y - cam.viewportHeight / 2);
    const expectedScreenX = 10.5 * TILE_SIZE_PX - left * TILE_SIZE_PX;
    const expectedScreenY = 5.5  * TILE_SIZE_PX - top  * TILE_SIZE_PX;
    const antCall = sprites.calls.find(c =>
      c.kind === 'worker' &&
      Math.abs(c.x - expectedScreenX) < 0.01 &&
      Math.abs(c.y - expectedScreenY) < 0.01,
    );
    expect(antCall).toBeDefined();
  });

  it('interpolates ant position at alpha=0.5 to halfway between prev and curr', () => {
    const prev = createWorldState(1);
    const curr = createWorldState(1);
    const queenId = 99;
    const workerId = 0;
    const colonyId = PLAYER_COLONY_ID;

    const colony = createColonyRecord(colonyId, queenId);
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    curr.colonies[colonyId] = colony;
    prev.colonies[colonyId] = colony;

    initAnt(prev.ants, workerId, { colonyId, posX: 10 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });
    initAnt(curr.ants, workerId, { colonyId, posX: 20 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });

    const cam = makeCamera(15, 5, 50, 37);
    drawSurfaceEntities(gfx, sprites, prev, curr, 0.5, cam);

    const left = Math.floor(cam.x - cam.viewportWidth / 2);
    const expectedScreenX = (10 * 16 + (20 * 16 - 10 * 16) * 0.5) - left * TILE_SIZE_PX;
    const antCall = sprites.calls.find(c =>
      c.kind === 'worker' && Math.abs(c.x - expectedScreenX) < 0.5,
    );
    expect(antCall).toBeDefined();
  });

  it('draws queen sprite (kind=queen) when ant id matches queenEntityId', () => {
    const antId = 0;
    const colonyId = PLAYER_COLONY_ID;

    const colony = createColonyRecord(colonyId, antId); // queen = antId 0
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    world.colonies[colonyId] = colony;

    initAnt(world.ants, antId, { colonyId, posX: 5 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);

    expect(sprites.calls.length).toBe(1);
    expect(sprites.calls[0]!.kind).toBe('queen');
    expect(sprites.calls[0]!.tint).toBe(COLOR_PLAYER_COLONY);
  });

  it('draws worker sprite (kind=worker) for non-queen ants', () => {
    const antId = 1; // not the queen (queen=0)
    const colonyId = PLAYER_COLONY_ID;

    const colony = createColonyRecord(colonyId, 0);
    colony.entrances = [];
    colony.rallyPoint = null;
    colony.digFlowFieldDirty = false;
    world.colonies[colonyId] = colony;

    initAnt(world.ants, antId, { colonyId, posX: 5 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);

    expect(sprites.calls.length).toBe(1);
    expect(sprites.calls[0]!.kind).toBe('worker');
  });

  it('tints player ants with COLOR_PLAYER_COLONY and enemy ants with COLOR_ENEMY_COLONY', () => {
    const playerAntId = 0;
    const enemyAntId  = 1;
    const playerColony = createColonyRecord(PLAYER_COLONY_ID, 99);
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
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);

    const playerTints = sprites.calls.filter(c => c.tint === COLOR_PLAYER_COLONY);
    const enemyTints  = sprites.calls.filter(c => c.tint === COLOR_ENEMY_COLONY);
    expect(playerTints.length).toBe(1);
    expect(enemyTints.length).toBe(1);
  });

  it('does NOT draw ants with zone=1 (underground ants)', () => {
    world.colonies[PLAYER_COLONY_ID] = (() => {
      const c = createColonyRecord(PLAYER_COLONY_ID, 99);
      c.entrances = []; c.rallyPoint = null; c.digFlowFieldDirty = false;
      return c;
    })();
    initAnt(world.ants, 0, { colonyId: PLAYER_COLONY_ID, posX: 5 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 1 });
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    expect(sprites.calls.length).toBe(0);
    expect(gfx.callsOf('fillCircle').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: ant facing direction (09 render polish)
//
// The SVG sources face -x natively (head on the left of the texture). To make
// the sprite head point along the motion vector (dx, dy), drawSurfaceEntities
// passes rotation = atan2(-dy, -dx). When (dx, dy) ≈ (0, 0) rotation defaults
// to 0 so stationary ants hold a stable pose.
// ---------------------------------------------------------------------------

describe('drawSurfaceEntities — ant facing direction', () => {
  function makeWorldWithSurfaceAnt(): { world: WorldState; antId: number } {
    const world = createWorldState(1);
    const antId = 0;
    const colony = createColonyRecord(PLAYER_COLONY_ID, 999);
    colony.entrances = []; colony.rallyPoint = null; colony.digFlowFieldDirty = false;
    world.colonies[PLAYER_COLONY_ID] = colony;
    initAnt(world.ants, antId, {
      colonyId: PLAYER_COLONY_ID,
      posX: 5 << FP_SHIFT,
      posY: 5 << FP_SHIFT,
      zone: 0,
    });
    return { world, antId };
  }

  it('rotation defaults to 0 when prev == curr (stationary ant)', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const { world } = makeWorldWithSurfaceAnt();
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    expect(sprites.calls.length).toBe(1);
    expect(sprites.calls[0]!.rotation).toBe(0);
  });

  it('moving right (+x): rotation has magnitude π (head flipped to face +x)', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const { world: prev, antId } = makeWorldWithSurfaceAnt();
    const { world: curr } = makeWorldWithSurfaceAnt();
    // Shift curr ant one full tile to the right relative to prev.
    curr.ants.posX[antId] = 6 << FP_SHIFT;
    curr.ants.posY[antId] = 5 << FP_SHIFT;
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, prev, curr, 1, cam);
    expect(sprites.calls.length).toBe(1);
    // atan2(-0, -1) returns -π in JS; +π and -π both rotate the sprite to face right.
    expect(Math.abs(sprites.calls[0]!.rotation!)).toBeCloseTo(Math.PI, 5);
  });

  it('moving down (+y): rotation = -π/2', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const { world: prev, antId } = makeWorldWithSurfaceAnt();
    const { world: curr } = makeWorldWithSurfaceAnt();
    curr.ants.posX[antId] = 5 << FP_SHIFT;
    curr.ants.posY[antId] = 6 << FP_SHIFT;
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, prev, curr, 1, cam);
    expect(sprites.calls[0]!.rotation).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('moving up (-y): rotation = +π/2', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const { world: prev, antId } = makeWorldWithSurfaceAnt();
    const { world: curr } = makeWorldWithSurfaceAnt();
    curr.ants.posX[antId] = 5 << FP_SHIFT;
    curr.ants.posY[antId] = 4 << FP_SHIFT;
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, prev, curr, 1, cam);
    expect(sprites.calls[0]!.rotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it('moving left (-x): rotation = 0', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const { world: prev, antId } = makeWorldWithSurfaceAnt();
    const { world: curr } = makeWorldWithSurfaceAnt();
    curr.ants.posX[antId] = 4 << FP_SHIFT;
    curr.ants.posY[antId] = 5 << FP_SHIFT;
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, prev, curr, 1, cam);
    // Sprite's native head is at -x so zero rotation already points left.
    expect(sprites.calls[0]!.rotation).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// Tests: wrong-plane flicker guard (09 render polish)
//
// Interpolating prev→curr is only valid when the slot was alive in prev AND
// prev.zone matches curr.zone. Otherwise we'd briefly draw the ant somewhere
// it never was:
//  - zone flip (e.g. queen descending through an entrance)
//  - spawn frame (prev posX/Y is a stale default like 0)
// In both cases drawSurfaceEntities must snap to the curr position.
// ---------------------------------------------------------------------------

describe('drawSurfaceEntities — wrong-plane flicker guard', () => {
  it('zone flip (prev.zone=1, curr.zone=0) → snap to curr, no interpolation', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const prev = createWorldState(1);
    const curr = createWorldState(1);
    const antId = 0;
    const colonyId = PLAYER_COLONY_ID;
    const colony = createColonyRecord(colonyId, 999);
    colony.entrances = []; colony.rallyPoint = null; colony.digFlowFieldDirty = false;
    prev.colonies[colonyId] = colony;
    curr.colonies[colonyId] = colony;

    initAnt(prev.ants, antId, { colonyId, posX: 10 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 1 });
    initAnt(curr.ants, antId, { colonyId, posX: 20 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });

    const cam = makeCamera(15, 5, 50, 37);
    drawSurfaceEntities(gfx, sprites, prev, curr, 0.5, cam);

    expect(sprites.calls.length).toBe(1);
    const left = Math.floor(cam.x - cam.viewportWidth / 2);
    const expectedCurrX = 20 * TILE_SIZE_PX - left * TILE_SIZE_PX;
    expect(sprites.calls[0]!.x).toBeCloseTo(expectedCurrX, 5);
    expect(sprites.calls[0]!.rotation).toBe(0);
  });

  it('spawn frame (prev slot !isAlive) → snap to curr, no pull toward default origin', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const prev = createWorldState(1);
    const curr = createWorldState(1);
    const antId = 0;
    const colonyId = PLAYER_COLONY_ID;
    const colony = createColonyRecord(colonyId, 999);
    colony.entrances = []; colony.rallyPoint = null; colony.digFlowFieldDirty = false;
    prev.colonies[colonyId] = colony;
    curr.colonies[colonyId] = colony;

    // prev deliberately not initialized — slot is !isAlive with default posX=0.
    initAnt(curr.ants, antId, { colonyId, posX: 20 << FP_SHIFT, posY: 5 << FP_SHIFT, zone: 0 });

    const cam = makeCamera(20, 5, 50, 37);
    drawSurfaceEntities(gfx, sprites, prev, curr, 0.5, cam);

    expect(sprites.calls.length).toBe(1);
    const left = Math.floor(cam.x - cam.viewportWidth / 2);
    const expectedCurrX = 20 * TILE_SIZE_PX - left * TILE_SIZE_PX;
    expect(sprites.calls[0]!.x).toBeCloseTo(expectedCurrX, 5);
    expect(sprites.calls[0]!.rotation).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: rally-point marker (Phase 9 usability fix)
// ---------------------------------------------------------------------------

describe('drawSurfaceEntities — rally-point marker', () => {
  let gfx: MockGfx;
  let sprites: MockAntSprites;
  let world: WorldState;

  beforeEach(() => {
    gfx = new MockGfx();
    sprites = new MockAntSprites();
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
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBeGreaterThan(0);
  });

  it('renders no rally marker when rallyPoint is null', () => {
    addPlayerColony(null);
    const cam = makeCamera(5, 5, 20, 20);
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBe(0);
  });

  it('rally marker moves with the rally point tile (camera-relative position)', () => {
    addPlayerColony({ tileX: 10, tileY: 4 });
    const cam = makeCamera(10, 4, 20, 20);
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    const rects = rallyRects(gfx);
    expect(rects.length).toBeGreaterThan(0);
    const left = Math.floor(cam.x - cam.viewportWidth  / 2);
    const top  = Math.floor(cam.y - cam.viewportHeight / 2);
    const sx = (10 - left) * TILE_SIZE_PX;
    const sy = (4  - top)  * TILE_SIZE_PX;
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

    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBeGreaterThan(0);

    world.colonies[PLAYER_COLONY_ID]!.rallyPoint = null;
    gfx.reset();

    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
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
    drawSurfaceEntities(gfx, sprites, world, world, 0, cam);
    expect(rallyRects(gfx).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: drawSurface orchestrator
// ---------------------------------------------------------------------------

describe('drawSurface', () => {
  it('calls both terrain and entity draws (terrain rects + entity draws present)', () => {
    const gfx = new MockGfx();
    const sprites = new MockAntSprites();
    const world = createWorldState(1);
    world.foodPiles.push({ foodPileId: 1, tileX: 5, tileY: 5 });
    const cam = makeCamera(5, 5, 10, 10);
    drawSurface(gfx, sprites, world, world, 0, cam);
    expect(gfx.callsOf('fillRect').length).toBeGreaterThan(0);
    expect(gfx.callsOf('fillCircle').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HUD-05 compliance — draw-surface.ts source
//
// The module itself must still be Phaser-free. Ant sprites now flow through
// the AntSpriteLayer interface (implemented by AntSpritePool in GameScene),
// so draw-surface.ts never references Phaser.GameObjects.Image/Sprite or any
// load.* API directly. The guard below keeps the module Phaser-free and
// positively asserts the sprite-layer integration point.
// ---------------------------------------------------------------------------

describe('HUD-05 compliance — draw-surface.ts source', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__dirname, 'draw-surface.ts'), 'utf8');

  it('does not reference Phaser.GameObjects.Image, Sprite, load.image, load.spritesheet, load.atlas', () => {
    expect(src).not.toMatch(/Phaser\.GameObjects\.Image/);
    expect(src).not.toMatch(/Phaser\.GameObjects\.Sprite/);
    expect(src).not.toMatch(/load\.image/);
    expect(src).not.toMatch(/load\.spritesheet/);
    expect(src).not.toMatch(/load\.atlas/);
  });

  it('delegates ant drawing to the AntSpriteLayer interface', () => {
    expect(src).toMatch(/AntSpriteLayer/);
    expect(src).toMatch(/sprites\.drawAnt\(/);
  });
});
