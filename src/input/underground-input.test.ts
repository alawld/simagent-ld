// underground-input.test.ts — Vitest unit tests for src/input/underground-input.ts
//
// Tests cover pure dispatch logic only.
// Phaser scene integration (registerUndergroundInput) is verified by Plan 07 Playwright smoke test.
//
// Key invariants:
//   - isTunnelEnd: Open + at least one Solid 4-neighbor → true.
//   - Left-click on Solid/Open tile → MarkDigTileCommand; Marked/BeingDug → no command.
//   - Drag debounce: only new tile coordinates emit commands.
//   - Right-click on Marked → CancelDigMarkCommand (CTRL-04: BeingDug NOT cancellable).
//   - Right-click on Open tunnel-end → contextMenuState.visible=true.
//   - Right-click on BeingDug → no state change.
//   - contextMenuState reset between tests using hideContextMenu().
//
// UndergroundTileState values (terrain.ts): Solid=0, Marked=1, BeingDug=2, Open=3

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isTunnelEnd,
  handleUndergroundLeftClick,
  handleUndergroundDrag,
  handleUndergroundRightClick,
} from './underground-input.js';
import { contextMenuState, hideContextMenu } from '../render/context-menu-state.js';
import { UndergroundTileState, ugSet, createUndergroundGrid } from '../sim/terrain.js';
import type { WorldState } from '../sim/types.js';
import type { ViewState } from '../render/camera.js';
import { VIEWPORT_WIDTH_TILES, VIEWPORT_HEIGHT_TILES } from '../render/camera.js';
import { HUD, TILE_SIZE_PX } from '../render/sprites.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { SimCommand } from '../sim/commands.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ViewState for tests. */
function makeViewState(
  view: 'surface' | 'underground' = 'underground',
  camX = 64,
  camY = 32,
): ViewState {
  return {
    activeView: view,
    surfaceCamera: { x: camX, y: camY, viewportWidth: VIEWPORT_WIDTH_TILES, viewportHeight: VIEWPORT_HEIGHT_TILES },
    undergroundCamera: { x: camX, y: camY, viewportWidth: VIEWPORT_WIDTH_TILES, viewportHeight: VIEWPORT_HEIGHT_TILES },
    undergroundVisited: true,
  };
}

/**
 * Convert tile coords to screen pixel coords for the underground camera.
 * screenX = (tileX - (camX - vw/2)) * TILE_SIZE_PX
 */
function tileToScreen(tileX: number, tileY: number, camX: number, camY: number): { x: number; y: number } {
  const px = (tileX - (camX - VIEWPORT_WIDTH_TILES / 2)) * TILE_SIZE_PX;
  const py = (tileY - (camY - VIEWPORT_HEIGHT_TILES / 2)) * TILE_SIZE_PX;
  return { x: px, y: py };
}

/**
 * Build a WorldState stub with a single underground grid for PLAYER_COLONY_ID.
 * gridWidth/gridHeight default to 20x20 for test convenience.
 */
function makeWorld(overrides: {
  tick?: number;
  gridWidth?: number;
  gridHeight?: number;
} = {}): WorldState {
  const w = overrides.gridWidth ?? 20;
  const h = overrides.gridHeight ?? 20;
  const grid = createUndergroundGrid(w, h);
  return {
    tick: overrides.tick ?? 0,
    rngState: 0,
    nextEntityId: 0,
    commandQueue: [] as SimCommand[],
    ants: { posX: new Int32Array(0), posY: new Int32Array(0), colonyId: new Int32Array(0), task: new Int32Array(0), subTask: new Int32Array(0), speed: new Int32Array(0), foodCarrying: new Int32Array(0), starvationTimer: new Int32Array(0), age: new Int32Array(0), alive: new Int32Array(0), lifespan: new Int32Array(0), zone: new Int32Array(0), digTileX: new Int32Array(0), digTileY: new Int32Array(0), digTicksRemaining: new Int32Array(0), targetPosX: new Int32Array(0), targetPosY: new Int32Array(0) },
    colonies: {},
    pheromoneGrids: {},
    surface: { data: new Uint8Array(0), width: 0, height: 0 },
    undergroundGrids: { [PLAYER_COLONY_ID]: grid },
    foodPiles: [],
    pendingChambers: {},
  } as unknown as WorldState;
}

/** UndergroundInputState equivalent (the private interface in underground-input.ts). */
function makeState(isDragging = false, lastX = -1, lastY = -1) {
  return { isDragging, lastMarkedTileX: lastX, lastMarkedTileY: lastY };
}

// ---------------------------------------------------------------------------
// Reset contextMenuState singleton between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  hideContextMenu();
  contextMenuState.screenX = 0;
  contextMenuState.screenY = 0;
  contextMenuState.anchorTileX = 0;
  contextMenuState.anchorTileY = 0;
});

// ---------------------------------------------------------------------------
// isTunnelEnd
// ---------------------------------------------------------------------------

describe('isTunnelEnd', () => {
  it('returns true for an Open tile surrounded by 4 Solid neighbors', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    // Center tile (5,5): set Open; all 4 neighbors remain Solid (default)
    ugSet(grid, 5, 5, UndergroundTileState.Open);
    expect(isTunnelEnd(world, 5, 5, PLAYER_COLONY_ID)).toBe(true);
  });

  it('returns false for an Open tile with no Solid neighbors (surrounded by Open)', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    // Set (5,5) and all 4 neighbors to Open
    ugSet(grid, 5, 5, UndergroundTileState.Open);
    ugSet(grid, 5, 4, UndergroundTileState.Open); // N
    ugSet(grid, 6, 5, UndergroundTileState.Open); // E
    ugSet(grid, 5, 6, UndergroundTileState.Open); // S
    ugSet(grid, 4, 5, UndergroundTileState.Open); // W
    expect(isTunnelEnd(world, 5, 5, PLAYER_COLONY_ID)).toBe(false);
  });

  it('returns false for a Solid tile (must be Open)', () => {
    const world = makeWorld();
    // (5,5) stays Solid by default
    expect(isTunnelEnd(world, 5, 5, PLAYER_COLONY_ID)).toBe(false);
  });

  it('returns false for a Marked tile (must be Open)', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 5, UndergroundTileState.Marked);
    expect(isTunnelEnd(world, 5, 5, PLAYER_COLONY_ID)).toBe(false);
  });

  it('returns false for a BeingDug tile (must be Open)', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 5, UndergroundTileState.BeingDug);
    expect(isTunnelEnd(world, 5, 5, PLAYER_COLONY_ID)).toBe(false);
  });

  it('returns true when Open tile is at the left edge with a valid Solid neighbor (not skipping valid neighbors at boundary)', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    // (0, 5) at the left edge: W neighbor (−1, 5) is out-of-bounds (skipped),
    // but N (0,4), E (1,5), S (0,6) remain Solid — so still true.
    ugSet(grid, 0, 5, UndergroundTileState.Open);
    expect(isTunnelEnd(world, 0, 5, PLAYER_COLONY_ID)).toBe(true);
  });

  it('returns false when all valid (in-bounds) neighbors are Open at an edge tile', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    // (0, 5): W is out-of-bounds; set N, E, S all to Open → no Solid neighbors
    ugSet(grid, 0, 5, UndergroundTileState.Open);
    ugSet(grid, 0, 4, UndergroundTileState.Open); // N
    ugSet(grid, 1, 5, UndergroundTileState.Open); // E
    ugSet(grid, 0, 6, UndergroundTileState.Open); // S
    expect(isTunnelEnd(world, 0, 5, PLAYER_COLONY_ID)).toBe(false);
  });

  it('returns false when the undergroundGrid for colonyId is missing', () => {
    const world = makeWorld();
    // Query a non-existent colony (2)
    expect(isTunnelEnd(world, 5, 5, 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleUndergroundLeftClick
// ---------------------------------------------------------------------------

describe('handleUndergroundLeftClick', () => {
  it('pushes MarkDigTileCommand for a Solid tile', () => {
    const world = makeWorld({ tick: 7 });
    // (5,10) stays Solid by default
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(1);
    const cmd = world.commandQueue[0] as { type: string; colonyId: number; tileX: number; tileY: number; issuedAtTick: number };
    expect(cmd.type).toBe('MarkDigTile');
    expect(cmd.colonyId).toBe(PLAYER_COLONY_ID);
    expect(cmd.tileX).toBe(5);
    expect(cmd.tileY).toBe(10);
    expect(cmd.issuedAtTick).toBe(7);
  });

  it('pushes MarkDigTileCommand for an Open tile', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 10, UndergroundTileState.Open);
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(1);
    expect((world.commandQueue[0] as { type: string }).type).toBe('MarkDigTile');
  });

  it('is a no-op when activeView is surface', () => {
    const world = makeWorld();
    const vs = makeViewState('surface', 64, 32);
    const state = makeState();
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op when pointer is over a HUD zone', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    handleUndergroundLeftClick(world, vs, HUD.TRIANGLE.x + 5, HUD.TRIANGLE.y + 5, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op for a Marked tile (already claimed)', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 10, UndergroundTileState.Marked);
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op for a BeingDug tile (already claimed)', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 10, UndergroundTileState.BeingDug);
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundLeftClick(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op for out-of-bounds tile coordinates', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    // screen coord that maps to tileX < 0
    handleUndergroundLeftClick(world, vs, -640, 0, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('sets isDragging=true and records lastMarkedTile after a successful click', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundLeftClick(world, vs, x, y, state);
    expect(state.isDragging).toBe(true);
    expect(state.lastMarkedTileX).toBe(5);
    expect(state.lastMarkedTileY).toBe(10);
  });

  it('hides context menu and consumes click (no MarkDigTile) when menu is visible', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 32);
    const state = makeState();
    contextMenuState.visible = true;
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundLeftClick(world, vs, x, y, state);
    expect(contextMenuState.visible).toBe(false);
    expect(world.commandQueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleUndergroundDrag
// ---------------------------------------------------------------------------

describe('handleUndergroundDrag', () => {
  it('pushes MarkDigTileCommand when drag enters a new tile', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 32);
    // Start dragging from (5,10), move to (6,10)
    const state = makeState(true, 5, 10);
    const { x, y } = tileToScreen(6, 10, 64, 32);
    handleUndergroundDrag(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(1);
    const cmd = world.commandQueue[0] as { type: string; tileX: number; tileY: number };
    expect(cmd.type).toBe('MarkDigTile');
    expect(cmd.tileX).toBe(6);
    expect(cmd.tileY).toBe(10);
    expect(state.lastMarkedTileX).toBe(6);
    expect(state.lastMarkedTileY).toBe(10);
  });

  it('does NOT push a command when pointer stays on the same tile (debounce)', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 32);
    // isDragging=true, last tile was (5,10), drag stays at (5,10)
    const state = makeState(true, 5, 10);
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundDrag(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op when isDragging is false', () => {
    const world = makeWorld();
    const vs = makeViewState('underground', 64, 32);
    const state = makeState(false, 5, 10);
    const { x, y } = tileToScreen(6, 10, 64, 32);
    handleUndergroundDrag(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('sets isDragging=false when activeView switches to surface mid-drag', () => {
    const world = makeWorld();
    const vs = makeViewState('surface', 64, 32); // view switched
    const state = makeState(true, 5, 10);
    const { x, y } = tileToScreen(6, 10, 64, 32);
    handleUndergroundDrag(world, vs, x, y, state);
    expect(state.isDragging).toBe(false);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('does NOT push a command for a Marked tile during drag', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 6, 10, UndergroundTileState.Marked);
    const vs = makeViewState('underground', 64, 32);
    const state = makeState(true, 5, 10);
    const { x, y } = tileToScreen(6, 10, 64, 32);
    handleUndergroundDrag(world, vs, x, y, state);
    expect(world.commandQueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleUndergroundRightClick
// ---------------------------------------------------------------------------

describe('handleUndergroundRightClick', () => {
  it('pushes CancelDigMarkCommand for a Marked tile', () => {
    const world = makeWorld({ tick: 2 });
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 10, UndergroundTileState.Marked);
    const vs = makeViewState('underground', 64, 32);
    const { x, y } = tileToScreen(5, 10, 64, 32);
    handleUndergroundRightClick(world, vs, x, y);
    expect(world.commandQueue).toHaveLength(1);
    const cmd = world.commandQueue[0] as { type: string; colonyId: number; tileX: number; tileY: number; issuedAtTick: number };
    expect(cmd.type).toBe('CancelDigMark');
    expect(cmd.colonyId).toBe(PLAYER_COLONY_ID);
    expect(cmd.tileX).toBe(5);
    expect(cmd.tileY).toBe(10);
    expect(cmd.issuedAtTick).toBe(2);
  });

  it('sets contextMenuState.visible=true for an Open tunnel-end tile', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    // (5,5) Open; N (5,4) stays Solid → tunnel end
    ugSet(grid, 5, 5, UndergroundTileState.Open);
    const vs = makeViewState('underground', 64, 32);
    const { x, y } = tileToScreen(5, 5, 64, 32);
    handleUndergroundRightClick(world, vs, x, y);
    expect(contextMenuState.visible).toBe(true);
    expect(contextMenuState.anchorTileX).toBe(5);
    expect(contextMenuState.anchorTileY).toBe(5);
    expect(contextMenuState.screenX).toBeCloseTo(x);
    expect(contextMenuState.screenY).toBeCloseTo(y);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('does NOT open context menu for an Open tile that is NOT a tunnel end', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    // (5,5) Open; all 4 neighbors Open → not a tunnel end
    ugSet(grid, 5, 5, UndergroundTileState.Open);
    ugSet(grid, 5, 4, UndergroundTileState.Open);
    ugSet(grid, 6, 5, UndergroundTileState.Open);
    ugSet(grid, 5, 6, UndergroundTileState.Open);
    ugSet(grid, 4, 5, UndergroundTileState.Open);
    const vs = makeViewState('underground', 64, 32);
    const { x, y } = tileToScreen(5, 5, 64, 32);
    handleUndergroundRightClick(world, vs, x, y);
    expect(contextMenuState.visible).toBe(false);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op for a Solid tile', () => {
    const world = makeWorld();
    // (5,5) stays Solid by default
    const vs = makeViewState('underground', 64, 32);
    const { x, y } = tileToScreen(5, 5, 64, 32);
    handleUndergroundRightClick(world, vs, x, y);
    expect(contextMenuState.visible).toBe(false);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op for a BeingDug tile (CTRL-04: finish-then-switch)', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 5, UndergroundTileState.BeingDug);
    const vs = makeViewState('underground', 64, 32);
    const { x, y } = tileToScreen(5, 5, 64, 32);
    handleUndergroundRightClick(world, vs, x, y);
    expect(contextMenuState.visible).toBe(false);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op when activeView is surface', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 5, UndergroundTileState.Marked);
    const vs = makeViewState('surface', 64, 32);
    const { x, y } = tileToScreen(5, 5, 64, 32);
    handleUndergroundRightClick(world, vs, x, y);
    expect(world.commandQueue).toHaveLength(0);
  });

  it('is a no-op when pointer is over HUD', () => {
    const world = makeWorld();
    const grid = world.undergroundGrids[PLAYER_COLONY_ID]!;
    ugSet(grid, 5, 5, UndergroundTileState.Marked);
    const vs = makeViewState('underground', 64, 32);
    handleUndergroundRightClick(world, vs, HUD.STATS.x + 5, HUD.STATS.y + 5);
    expect(world.commandQueue).toHaveLength(0);
  });
});
