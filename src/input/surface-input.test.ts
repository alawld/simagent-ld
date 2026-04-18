// surface-input.test.ts — Vitest unit tests for src/input/surface-input.ts
//
// Tests cover pure dispatch logic only.
// Phaser scene integration (registerSurfaceInput) is verified by Plan 07 Playwright smoke test.
//
// Key invariants:
//   - Food-pile mark pushes MarkFoodPileCommand with correct tile coords.
//   - Entrance designation: right-click sets preview; left-click same tileX confirms.
//   - Both handlers are no-ops when activeView !== 'surface'.
//   - Both handlers are no-ops when pointer is over a HUD zone.
//   - Tile out-of-bounds (tileX/Y < 0) → no command.

import { describe, it, expect } from 'vitest';
import {
  findFoodPileAt,
  handleSurfaceLeftClick,
  handleSurfaceRightClick,
} from './surface-input.js';
import type { WorldState } from '../sim/types.js';
import type { ViewState } from '../render/camera.js';
import { VIEWPORT_WIDTH_TILES, VIEWPORT_HEIGHT_TILES } from '../render/camera.js';
import { HUD, TILE_SIZE_PX } from '../render/sprites.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { SimCommand } from '../sim/commands.js';

// Re-export TILE_SIZE_PX from sprites where it actually lives — camera.ts re-exports via void
// but we need the numeric value. It is 16 per Plan 01.
// We derive screen coords from tile coords: screenX = tile * 16 - (cam.x - vw/2) * 16
// i.e. screenX = (tile - cam.x + vw/2) * TILE_SIZE_PX

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ViewState pointing to the given view, camera centered at cx,cy. */
function makeViewState(
  view: 'surface' | 'underground' = 'surface',
  camX = 64,
  camY = 64,
): ViewState {
  return {
    activeView: view,
    surfaceCamera: { x: camX, y: camY, viewportWidth: VIEWPORT_WIDTH_TILES, viewportHeight: VIEWPORT_HEIGHT_TILES },
    undergroundCamera: { x: camX, y: camY, viewportWidth: VIEWPORT_WIDTH_TILES, viewportHeight: VIEWPORT_HEIGHT_TILES },
    undergroundVisited: false,
  };
}

/**
 * Convert tile coords to screen pixel coords given the surface camera at (camX, camY).
 * screenX = (tileX - (camX - vw/2)) * TILE_SIZE_PX
 * (center of tile: add 0.5 * TILE_SIZE_PX; but surface-input hits the top-left pixel of tile via
 *  Math.floor, so we use the first pixel of the tile.)
 */
function tileToScreen(tileX: number, tileY: number, camX: number, camY: number): { x: number; y: number } {
  const px = (tileX - (camX - VIEWPORT_WIDTH_TILES / 2)) * TILE_SIZE_PX;
  const py = (tileY - (camY - VIEWPORT_HEIGHT_TILES / 2)) * TILE_SIZE_PX;
  return { x: px, y: py };
}

/** Build a minimal WorldState stub with given foodPiles and commandQueue. */
function makeWorld(overrides: {
  tick?: number;
  foodPiles?: WorldState['foodPiles'];
} = {}): WorldState {
  return {
    tick: overrides.tick ?? 0,
    rngState: 0,
    nextEntityId: 0,
    commandQueue: [] as SimCommand[],
    ants: { posX: new Int32Array(0), posY: new Int32Array(0), colonyId: new Int32Array(0), task: new Int32Array(0), subTask: new Int32Array(0), speed: new Int32Array(0), foodCarrying: new Int32Array(0), starvationTimer: new Int32Array(0), age: new Int32Array(0), alive: new Int32Array(0), lifespan: new Int32Array(0), zone: new Int32Array(0), digTileX: new Int32Array(0), digTileY: new Int32Array(0), digTicksRemaining: new Int32Array(0), targetPosX: new Int32Array(0), targetPosY: new Int32Array(0) },
    colonies: {},
    pheromoneGrids: {},
    surface: { data: new Uint8Array(0), width: 0, height: 0 },
    undergroundGrids: {},
    foodPiles: overrides.foodPiles ?? [],
    pendingChambers: {},
  } as unknown as WorldState;
}

/** A SurfaceInputState equivalent (the private interface in surface-input.ts). */
function makeState(pendingEntranceTileX: number | null = null) {
  return { pendingEntranceTileX };
}

// ---------------------------------------------------------------------------
// findFoodPileAt
// ---------------------------------------------------------------------------

describe('findFoodPileAt', () => {
  it('returns the pile at the exact tile coordinate', () => {
    const world = makeWorld({
      foodPiles: [
        { foodPileId: 1, tileX: 10, tileY: 20, isMarkedPriority: false },
        { foodPileId: 2, tileX: 30, tileY: 40, isMarkedPriority: false },
        { foodPileId: 3, tileX: 50, tileY: 60, isMarkedPriority: true },
      ],
    });
    expect(findFoodPileAt(world, 30, 40)).toEqual({ foodPileId: 2, tileX: 30, tileY: 40, isMarkedPriority: false });
  });

  it('returns null when no pile is at the given tile', () => {
    const world = makeWorld({
      foodPiles: [{ foodPileId: 1, tileX: 10, tileY: 20, isMarkedPriority: false }],
    });
    expect(findFoodPileAt(world, 11, 20)).toBeNull();
  });

  it('returns null on an empty food piles array', () => {
    const world = makeWorld({ foodPiles: [] });
    expect(findFoodPileAt(world, 0, 0)).toBeNull();
  });

  it('returns first match when multiple piles share coords (edge case)', () => {
    const world = makeWorld({
      foodPiles: [
        { foodPileId: 1, tileX: 5, tileY: 5, isMarkedPriority: false },
        { foodPileId: 2, tileX: 5, tileY: 5, isMarkedPriority: true },
      ],
    });
    const result = findFoodPileAt(world, 5, 5);
    expect(result?.foodPileId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// handleSurfaceLeftClick — food pile mark
// ---------------------------------------------------------------------------

describe('handleSurfaceLeftClick — food pile mark', () => {
  it('pushes MarkFoodPileCommand for a pile at the clicked tile', () => {
    const world = makeWorld({
      tick: 5,
      foodPiles: [{ foodPileId: 7, tileX: 10, tileY: 20, isMarkedPriority: false }],
    });
    const vs = makeViewState('surface', 64, 64);
    const state = makeState();
    const { x, y } = tileToScreen(10, 20, 64, 64);
    handleSurfaceLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(1);
    const cmd = world.commandQueue[0] as { type: string; colonyId: number; tileX: number; tileY: number; issuedAtTick: number };
    expect(cmd.type).toBe('MarkFoodPile');
    expect(cmd.colonyId).toBe(PLAYER_COLONY_ID);
    expect(cmd.tileX).toBe(10);
    expect(cmd.tileY).toBe(20);
    expect(cmd.issuedAtTick).toBe(5);
  });

  it('pushes no command when no food pile exists at the clicked tile', () => {
    const world = makeWorld({ foodPiles: [{ foodPileId: 1, tileX: 5, tileY: 5, isMarkedPriority: false }] });
    const vs = makeViewState('surface', 64, 64);
    const state = makeState();
    const { x, y } = tileToScreen(6, 5, 64, 64);
    handleSurfaceLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op when activeView is underground', () => {
    const world = makeWorld({ foodPiles: [{ foodPileId: 1, tileX: 10, tileY: 20, isMarkedPriority: false }] });
    const vs = makeViewState('underground', 64, 64);
    const state = makeState();
    const { x, y } = tileToScreen(10, 20, 64, 64);
    handleSurfaceLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op when pointer is over HUD TRIANGLE zone', () => {
    const world = makeWorld({ foodPiles: [{ foodPileId: 1, tileX: 10, tileY: 20, isMarkedPriority: false }] });
    const vs = makeViewState('surface', 64, 64);
    const state = makeState();
    // HUD.TRIANGLE zone — use a point guaranteed inside it.
    const hudX = HUD.TRIANGLE.x + 5;
    const hudY = HUD.TRIANGLE.y + 5;
    handleSurfaceLeftClick(world, vs, hudX, hudY, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op when tileX < 0 (out-of-bounds click)', () => {
    const world = makeWorld({ foodPiles: [] });
    const vs = makeViewState('surface', 64, 64);
    const state = makeState();
    // Camera at x=64, vw=50 → left edge at tile (64-25)=39, screen 0
    // Pixel -1 → tileX = floor((-1 + (64-25)*16)/16) = floor(-1/16 + 39) = 38 which is valid
    // To get tileX<0, we need screenX such that floor(screenX/16 + (64-50/2)) < 0
    // tileX = floor((screenX + (camX - vw/2) * TS) / TS) < 0 when screenX + (64-25)*16 < 0
    // screenX < -624; use screenX=-640
    handleSurfaceLeftClick(world, vs, -640, 0, state);
    expect(world.commandQueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleSurfaceLeftClick — entrance designation confirmation
// ---------------------------------------------------------------------------

describe('handleSurfaceLeftClick — entrance designation confirmation', () => {
  it('pushes DesignateEntranceCommand and clears preview when tileX matches pending', () => {
    const world = makeWorld({ tick: 3 });
    const vs = makeViewState('surface', 64, 64);
    const state = makeState(15); // pending entrance at tileX=15
    const { x, y } = tileToScreen(15, 30, 64, 64);
    handleSurfaceLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(1);
    const cmd = world.commandQueue[0] as { type: string; colonyId: number; surfaceTileX: number; surfaceTileY: number; issuedAtTick: number };
    expect(cmd.type).toBe('DesignateEntrance');
    expect(cmd.colonyId).toBe(PLAYER_COLONY_ID);
    expect(cmd.surfaceTileX).toBe(15);
    expect(cmd.surfaceTileY).toBe(30);
    expect(cmd.issuedAtTick).toBe(3);
    expect(state.pendingEntranceTileX).toBeNull();
  });

  it('does NOT push DesignateEntrance when clicked tileX differs from pending', () => {
    const world = makeWorld({ foodPiles: [] });
    const vs = makeViewState('surface', 64, 64);
    const state = makeState(15); // pending entrance at tileX=15
    const { x, y } = tileToScreen(20, 30, 64, 64); // click at tileX=20
    handleSurfaceLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
    // Preview persists (not cleared on mismatch)
    expect(state.pendingEntranceTileX).toBe(15);
  });

  it('falls through to food-pile check when tileX does not match pending', () => {
    const world = makeWorld({
      foodPiles: [{ foodPileId: 99, tileX: 20, tileY: 30, isMarkedPriority: false }],
    });
    const vs = makeViewState('surface', 64, 64);
    const state = makeState(15); // pending entrance at tileX=15
    const { x, y } = tileToScreen(20, 30, 64, 64); // click at food pile tileX=20 != 15
    handleSurfaceLeftClick(world, vs, x, y, state);
    // Should push MarkFoodPile (not DesignateEntrance)
    expect(world.commandQueue).toHaveLength(1);
    const cmd = world.commandQueue[0] as { type: string };
    expect(cmd.type).toBe('MarkFoodPile');
    // Preview still persists
    expect(state.pendingEntranceTileX).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// handleSurfaceRightClick
// ---------------------------------------------------------------------------

describe('handleSurfaceRightClick', () => {
  it('sets pendingEntranceTileX to the clicked tileX', () => {
    const world = makeWorld();
    const vs = makeViewState('surface', 64, 64);
    const state = makeState();
    const { x, y } = tileToScreen(40, 50, 64, 64);
    handleSurfaceRightClick(world, vs, x, y, state);
    expect(state.pendingEntranceTileX).toBe(40);
  });

  it('is a no-op when activeView is underground', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 64);
    const state = makeState();
    const { x, y } = tileToScreen(40, 50, 64, 64);
    handleSurfaceRightClick(world, vs, x, y, state);
    expect(state.pendingEntranceTileX).toBeNull();
  });

  it('is a no-op when pointer is over HUD', () => {
    const world = makeWorld();
    const vs = makeViewState('surface', 64, 64);
    const state = makeState();
    handleSurfaceRightClick(world, vs, HUD.STATS.x + 5, HUD.STATS.y + 5, state);
    expect(state.pendingEntranceTileX).toBeNull();
  });

  it('is a no-op when tile coords are out of bounds (tileX < 0)', () => {
    const world = makeWorld();
    const vs = makeViewState('surface', 64, 64);
    const state = makeState();
    handleSurfaceRightClick(world, vs, -640, 0, state);
    expect(state.pendingEntranceTileX).toBeNull();
  });

  it('overwrites an existing pending entrance with the new tileX', () => {
    const world = makeWorld();
    const vs = makeViewState('surface', 64, 64);
    const state = makeState(10); // previous pending at tileX=10
    const { x, y } = tileToScreen(40, 50, 64, 64);
    handleSurfaceRightClick(world, vs, x, y, state);
    expect(state.pendingEntranceTileX).toBe(40);
  });
});
