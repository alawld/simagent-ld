// draw-underground.test.ts — Vitest unit tests for the underground cross-section drawing module.
//
// Uses MockGfx (spy recorder) to capture GfxLike calls without Phaser.
// All tests run in Node via Vitest — no browser, no Phaser install required.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  drawUndergroundTerrain,
  drawUndergroundEntities,
  drawUnderground,
} from './draw-underground.js';
import type { GfxLike } from './draw-surface.js';
import type { WorldState } from '../sim/types.js';
import { createWorldState } from '../sim/types.js';
import { ugSet, UndergroundTileState, createUndergroundGrid } from '../sim/terrain.js';
import { initAnt } from '../sim/ant/ant-store.js';
import { FP_SHIFT } from '../sim/fixed.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import { ChamberType } from '../sim/enums.js';
import { CHAMBER_DIMENSIONS } from '../sim/colony/chamber.js';
import { createColonyRecord } from '../sim/colony/colony-store.js';
import type { ChamberRecord } from '../sim/colony/colony-store.js';
import {
  TILE_SIZE_PX,
  COLOR_UNDERGROUND_CEILING_STRIP,
  COLOR_UNDERGROUND_OPEN,
  COLOR_UNDERGROUND_SOLID,
  COLOR_MARKED_TILE_OVERLAY,
  COLOR_BEING_DUG_OVERLAY,
  COLOR_CHAMBER_QUEEN,
  COLOR_ANT_EGG,
  COLOR_ANT_LARVAE,
  COLOR_QUEEN_OUTLINE,
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

  callsOf(method: string): GfxCall[] {
    return this.calls.filter(c => c.method === method);
  }

  reset(): void { this.calls = []; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCamera(cx: number, cy: number, vpW: number, vpH: number): CameraState {
  return { x: cx, y: cy, viewportWidth: vpW, viewportHeight: vpH };
}

/** Build a WorldState with a player colony and a 10×10 underground grid. */
function makeWorldWithUnderground(): WorldState {
  const w = createWorldState(1);
  // Install a 10×10 underground grid for the player colony
  w.undergroundGrids[PLAYER_COLONY_ID] = createUndergroundGrid(10, 10);
  // Install player colony record
  const colony = createColonyRecord(PLAYER_COLONY_ID, 999);
  colony.entrances = [];
  colony.rallyPoint = null;
  colony.digFlowFieldDirty = false;
  w.colonies[PLAYER_COLONY_ID] = colony;
  return w;
}

// ---------------------------------------------------------------------------
// Tests: drawUndergroundTerrain
// ---------------------------------------------------------------------------

describe('drawUndergroundTerrain', () => {
  let gfx: MockGfx;
  let world: WorldState;

  beforeEach(() => {
    gfx = new MockGfx();
    world = makeWorldWithUnderground();
  });

  it('returns immediately (no draws) when player underground grid is absent', () => {
    const w = createWorldState(1); // no undergroundGrids
    const cam = makeCamera(5, 5, 10, 10);
    drawUndergroundTerrain(gfx, w, cam);
    expect(gfx.calls.length).toBe(0);
  });

  it('draws ceiling row with COLOR_UNDERGROUND_CEILING_STRIP for non-entrance columns', () => {
    const cam = makeCamera(5, 0.5, 10, 1); // viewport: ty=0 only
    // left=floor(5-5)=0, top=floor(0.5-0.5)=0, right=min(0+10+1,10)=10, bottom=min(0+1+1,10)=2
    // ty=0 is the ceiling row
    drawUndergroundTerrain(gfx, world, cam);
    const ceilingStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_CEILING_STRIP);
    expect(ceilingStyles.length).toBeGreaterThan(0);
  });

  it('draws COLOR_UNDERGROUND_OPEN at entrance column in ceiling row', () => {
    // Add an entrance at surfaceTileX=3
    world.colonies[PLAYER_COLONY_ID]!.entrances = [
      { entranceId: 1, surfaceTileX: 3, surfaceTileY: 64, isOpen: true },
    ];
    const cam = makeCamera(5, 0.5, 10, 1); // see ceiling row only
    drawUndergroundTerrain(gfx, world, cam);

    // Ceiling (ty=0): tx=3 should produce COLOR_UNDERGROUND_OPEN, others CEILING_STRIP
    // Count styles for both colors
    const openStyles    = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_OPEN);
    const ceilingStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_CEILING_STRIP);
    // tx=3 → 1 open style; tx=0..9 except 3 → 9 ceiling styles
    expect(openStyles.length).toBe(1);
    expect(ceilingStyles.length).toBe(9);
  });

  it('draws Solid tiles with COLOR_UNDERGROUND_SOLID', () => {
    // All tiles default to Solid; camera centered at (5,5) sees interior tiles
    const cam = makeCamera(5, 5, 4, 4);
    drawUndergroundTerrain(gfx, world, cam);
    const solidStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_SOLID);
    expect(solidStyles.length).toBeGreaterThan(0);
  });

  it('draws Open tiles with COLOR_UNDERGROUND_OPEN', () => {
    ugSet(world.undergroundGrids[PLAYER_COLONY_ID]!, 5, 5, UndergroundTileState.Open);
    const cam = makeCamera(5, 5, 2, 2);
    // left=4, top=4, right=min(7,10)=7, bottom=min(7,10)=7 → see tile (5,5)
    drawUndergroundTerrain(gfx, world, cam);
    const openStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_OPEN);
    expect(openStyles.length).toBeGreaterThan(0);
  });

  it('draws Marked tiles: open base + overlay with COLOR_MARKED_TILE_OVERLAY', () => {
    ugSet(world.undergroundGrids[PLAYER_COLONY_ID]!, 5, 5, UndergroundTileState.Marked);
    const cam = makeCamera(5.5, 5.5, 2, 2);
    drawUndergroundTerrain(gfx, world, cam);
    // Should have both UNDERGROUND_OPEN and MARKED_TILE_OVERLAY styles for (5,5)
    const openStyles   = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_OPEN);
    const markedStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_MARKED_TILE_OVERLAY);
    expect(openStyles.length).toBeGreaterThan(0);
    expect(markedStyles.length).toBeGreaterThan(0);
  });

  it('draws BeingDug tiles: open base + overlay with COLOR_BEING_DUG_OVERLAY', () => {
    ugSet(world.undergroundGrids[PLAYER_COLONY_ID]!, 5, 5, UndergroundTileState.BeingDug);
    const cam = makeCamera(5.5, 5.5, 2, 2);
    drawUndergroundTerrain(gfx, world, cam);
    const beingDugStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_BEING_DUG_OVERLAY);
    expect(beingDugStyles.length).toBeGreaterThan(0);
  });

  it('places ceiling gap at exactly the entrance tileX, leaves other columns as ceiling', () => {
    world.colonies[PLAYER_COLONY_ID]!.entrances = [
      { entranceId: 1, surfaceTileX: 2, surfaceTileY: 64, isOpen: true },
      { entranceId: 2, surfaceTileX: 7, surfaceTileY: 64, isOpen: true },
    ];
    // Camera showing full width of 10-tile grid at row 0
    const cam = makeCamera(5, 0.5, 10, 1);
    drawUndergroundTerrain(gfx, world, cam);
    const openStyles    = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_OPEN);
    const ceilingStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_UNDERGROUND_CEILING_STRIP);
    // 2 entrance gaps → 2 open, 8 ceiling
    expect(openStyles.length).toBe(2);
    expect(ceilingStyles.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Tests: drawUndergroundEntities
// ---------------------------------------------------------------------------

describe('drawUndergroundEntities', () => {
  let gfx: MockGfx;
  let world: WorldState;

  beforeEach(() => {
    gfx = new MockGfx();
    world = makeWorldWithUnderground();
  });

  it('draws ant at (5,3) pixels matching posX=5<<FP_SHIFT, posY=3<<FP_SHIFT with zone=1', () => {
    const antId = 0;
    world.colonies[PLAYER_COLONY_ID]!.queenEntityId = 999; // make ant 0 a worker

    initAnt(world.ants, antId, {
      colonyId: PLAYER_COLONY_ID,
      posX: 5 << FP_SHIFT,
      posY: 3 << FP_SHIFT,
      zone: 1, // underground
    });

    const cam = makeCamera(5, 3, 20, 20);
    drawUndergroundEntities(gfx, world, world, 0, cam);

    const rects = gfx.callsOf('fillRect');
    // left = floor(5-10) = -5, top = floor(3-10) = -7
    // screenX = (5 - (-5)) * 16 = 160; worker rect at (screenX-3, screenY-3, 6, 6)
    const left = Math.floor(cam.x - cam.viewportWidth / 2);
    const top  = Math.floor(cam.y - cam.viewportHeight / 2);
    const expectedX = (5 - left) * TILE_SIZE_PX - 3;
    const expectedY = (3 - top)  * TILE_SIZE_PX - 3;
    const workerRect = rects.find(r =>
      Math.abs((r.args[0] as number) - expectedX) < 0.5 &&
      Math.abs((r.args[1] as number) - expectedY) < 0.5 &&
      r.args[2] === 6 && r.args[3] === 6
    );
    expect(workerRect).toBeDefined();
  });

  it('does NOT draw ants with zone=0 (surface ants excluded from underground renderer)', () => {
    const antId = 0;
    initAnt(world.ants, antId, {
      colonyId: PLAYER_COLONY_ID,
      posX: 5 << FP_SHIFT,
      posY: 5 << FP_SHIFT,
      zone: 0, // surface — should NOT be drawn by underground renderer
    });

    const cam = makeCamera(5, 5, 20, 20);
    drawUndergroundEntities(gfx, world, world, 0, cam);

    // No rects from ants (no chambers either)
    const rects = gfx.callsOf('fillRect');
    expect(rects.length).toBe(0);
  });

  it('draws queen with 10×10 rect + strokeCircle with COLOR_QUEEN_OUTLINE', () => {
    const queenId = 0;
    world.colonies[PLAYER_COLONY_ID]!.queenEntityId = queenId;
    initAnt(world.ants, queenId, {
      colonyId: PLAYER_COLONY_ID,
      posX: 5 << FP_SHIFT,
      posY: 5 << FP_SHIFT,
      zone: 1,
    });

    const cam = makeCamera(5, 5, 20, 20);
    drawUndergroundEntities(gfx, world, world, 0, cam);

    const rects = gfx.callsOf('fillRect');
    const queenRect = rects.find(r => r.args[2] === 10 && r.args[3] === 10);
    expect(queenRect).toBeDefined();

    const strokes = gfx.callsOf('strokeCircle');
    expect(strokes.length).toBeGreaterThanOrEqual(1);

    const lineStyles = gfx.callsOf('lineStyle').filter(c => c.args[1] === COLOR_QUEEN_OUTLINE);
    expect(lineStyles.length).toBeGreaterThanOrEqual(1);
  });

  it('draws a queen chamber fillRect with COLOR_CHAMBER_QUEEN covering chamber dimensions', () => {
    const queenDims = CHAMBER_DIMENSIONS[ChamberType.Queen]; // 5×3
    const chamber: ChamberRecord = {
      chamberId:   1,
      chamberType: ChamberType.Queen,
      foodStored:  0,
      posX:        5 << FP_SHIFT,
      posY:        10 << FP_SHIFT,
      width:       queenDims.width,
      height:      queenDims.height,
    };
    world.colonies[PLAYER_COLONY_ID]!.chambers = [chamber];

    const cam = makeCamera(5, 10, 20, 20);
    drawUndergroundEntities(gfx, world, world, 0, cam);

    const rects = gfx.callsOf('fillRect');
    // Chamber rect: w=5*16=80, h=3*16=48
    const chamberRect = rects.find(r => r.args[2] === queenDims.width * TILE_SIZE_PX && r.args[3] === queenDims.height * TILE_SIZE_PX);
    expect(chamberRect).toBeDefined();

    const queenStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_CHAMBER_QUEEN);
    expect(queenStyles.length).toBeGreaterThanOrEqual(1);
  });

  it('draws eggs as fillCircle with COLOR_ANT_EGG', () => {
    const eggId = 5;
    initAnt(world.ants, eggId, {
      colonyId: PLAYER_COLONY_ID,
      posX: 4 << FP_SHIFT,
      posY: 5 << FP_SHIFT,
      zone: 1,
    });
    world.colonies[PLAYER_COLONY_ID]!.eggs = [eggId];

    const cam = makeCamera(5, 5, 20, 20);
    drawUndergroundEntities(gfx, world, world, 0, cam);

    const eggStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_ANT_EGG);
    expect(eggStyles.length).toBeGreaterThanOrEqual(1);
    const eggCircles = gfx.callsOf('fillCircle');
    // At least one circle for the egg
    expect(eggCircles.length).toBeGreaterThanOrEqual(1);
  });

  it('draws larvae as fillCircle with COLOR_ANT_LARVAE', () => {
    const larvaId = 6;
    initAnt(world.ants, larvaId, {
      colonyId: PLAYER_COLONY_ID,
      posX: 4 << FP_SHIFT,
      posY: 5 << FP_SHIFT,
      zone: 1,
    });
    world.colonies[PLAYER_COLONY_ID]!.larvae = [larvaId];

    const cam = makeCamera(5, 5, 20, 20);
    drawUndergroundEntities(gfx, world, world, 0, cam);

    const larvaStyles = gfx.callsOf('fillStyle').filter(c => c.args[0] === COLOR_ANT_LARVAE);
    expect(larvaStyles.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: drawUnderground (orchestrator)
// ---------------------------------------------------------------------------

describe('drawUnderground', () => {
  it('returns without throw when player underground grid is undefined', () => {
    const gfx = new MockGfx();
    const w = createWorldState(1); // no undergroundGrids
    const cam = makeCamera(5, 5, 10, 10);
    expect(() => drawUnderground(gfx, w, w, 0, cam)).not.toThrow();
    expect(gfx.callsOf('fillRect').length).toBe(0);
  });

  it('produces terrain draws (fillRect) and no throw for standard world', () => {
    const gfx = new MockGfx();
    const world = makeWorldWithUnderground();
    const cam = makeCamera(5, 5, 10, 10);
    expect(() => drawUnderground(gfx, world, world, 0, cam)).not.toThrow();
    expect(gfx.callsOf('fillRect').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// HUD-05 enforcement: draw-underground.ts source must not reference Image/Sprite etc.
// ---------------------------------------------------------------------------

describe('HUD-05 compliance — draw-underground.ts source', () => {
  it('contains no Phaser.GameObjects.Image, Sprite, load.image, load.spritesheet, load.atlas', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, 'draw-underground.ts'), 'utf8');
    expect(src).not.toMatch(/Phaser\.GameObjects\.Image/);
    expect(src).not.toMatch(/Phaser\.GameObjects\.Sprite/);
    expect(src).not.toMatch(/load\.image/);
    expect(src).not.toMatch(/load\.spritesheet/);
    expect(src).not.toMatch(/load\.atlas/);
  });
});
