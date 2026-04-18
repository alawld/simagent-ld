// underground-input.ts — Phase 8 underground-click dispatcher.
//
// Handles:
//   - Left-click / drag: MarkDigTileCommand on Solid or Open tiles (debounced per tile).
//   - Right-click on Marked tile: CancelDigMarkCommand (CTRL-04: BeingDug is NOT cancellable).
//   - Right-click on Open tunnel-end: contextMenuState mutation (UNDR-04).
//   - Right-click on other tiles: no-op.
//
// Guards:
//   - viewState.activeView must be 'underground' before dispatching any command.
//   - isPointerOverHUD rejects clicks that land on HUD zones (Pitfall 2).
//   - Tile bounds check before accessing grid or pushing commands.
//   - contextMenuState is suppressed and hidden on any left-click while menu is open.
//
// UndergroundTileState enum (terrain.ts):
//   Solid=0, Marked=1, BeingDug=2, Open=3

import * as Phaser from 'phaser';
import type { WorldState } from '../sim/types.js';
import type { ViewState } from '../render/camera.js';
import { screenToTile } from '../render/camera.js';
import { ugGet, UndergroundTileState } from '../sim/terrain.js';
import type { MarkDigTileCommand, CancelDigMarkCommand } from '../sim/commands.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import { isPointerOverHUD } from './camera-input.js';
import { contextMenuState, hideContextMenu } from '../render/context-menu-state.js';

// ---------------------------------------------------------------------------
// UndergroundInputState — mutable per-registration state
// ---------------------------------------------------------------------------

interface UndergroundInputState {
  /** True from the first pointerdown until pointerup — enables drag tile-mark. */
  isDragging: boolean;
  /** Last tile X that had a MarkDigTileCommand emitted during this drag. */
  lastMarkedTileX: number;
  /** Last tile Y that had a MarkDigTileCommand emitted during this drag. */
  lastMarkedTileY: number;
}

// ---------------------------------------------------------------------------
// isTunnelEnd
// ---------------------------------------------------------------------------

/**
 * Returns true if (tileX, tileY) in the given colony's underground grid is:
 *   (a) Open (UndergroundTileState.Open === 3), AND
 *   (b) at least one orthogonal 4-neighbor is Solid (UndergroundTileState.Solid === 0).
 *
 * Used by handleUndergroundRightClick to decide whether to open the chamber
 * context menu (UNDR-04 / PRD §8b).
 *
 * Out-of-bounds neighbors are skipped (not counted as Solid) — this preserves
 * correctness for tiles on the grid boundary, but a boundary-adjacent Open tile
 * with valid Solid neighbors still returns true.
 *
 * Returns false if the undergroundGrid for colonyId does not exist.
 */
export function isTunnelEnd(world: WorldState, tileX: number, tileY: number, colonyId: number): boolean {
  const grid = world.undergroundGrids[colonyId];
  if (!grid) return false;
  if (ugGet(grid, tileX, tileY) !== UndergroundTileState.Open) return false;
  const neighbors: Array<[number, number]> = [
    [tileX, tileY - 1],  // N
    [tileX + 1, tileY],  // E
    [tileX, tileY + 1],  // S
    [tileX - 1, tileY],  // W
  ];
  for (const [nx, ny] of neighbors) {
    if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
    if (ugGet(grid, nx, ny) === UndergroundTileState.Solid) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// handleUndergroundLeftClick
// ---------------------------------------------------------------------------

/**
 * Handles a left-click (or drag initiation) on the underground view.
 *
 * If context menu is open, hides it and suppresses the world click (the click
 * is consumed by the dismissal — PRD §8b).
 *
 * Otherwise, if the clicked tile is Solid or Open, pushes MarkDigTileCommand
 * and sets isDragging=true to enable subsequent drag marks.
 *
 * No-ops if: activeView !== 'underground', pointer over HUD, out of bounds,
 * or tile is Marked/BeingDug (already claimed).
 */
export function handleUndergroundLeftClick(
  world: WorldState,
  viewState: ViewState,
  screenX: number,
  screenY: number,
  state: UndergroundInputState,
): void {
  if (viewState.activeView !== 'underground') return;
  if (isPointerOverHUD(screenX, screenY)) return;
  // If context menu is visible, dismiss it and consume this click.
  if (contextMenuState.visible) { hideContextMenu(); return; }
  const { tileX, tileY } = screenToTile(screenX, screenY, viewState.undergroundCamera);
  const grid = world.undergroundGrids[PLAYER_COLONY_ID];
  if (!grid) return;
  if (tileX < 0 || tileY < 0 || tileX >= grid.width || tileY >= grid.height) return;
  // Only mark Solid or Open tiles (Marked/BeingDug are already claimed).
  const tileState = ugGet(grid, tileX, tileY);
  if (tileState !== UndergroundTileState.Solid && tileState !== UndergroundTileState.Open) return;
  const cmd: MarkDigTileCommand = {
    type: 'MarkDigTile',
    colonyId: PLAYER_COLONY_ID,
    tileX,
    tileY,
    issuedAtTick: world.tick,
  };
  world.commandQueue.push(cmd);
  state.isDragging = true;
  state.lastMarkedTileX = tileX;
  state.lastMarkedTileY = tileY;
}

// ---------------------------------------------------------------------------
// handleUndergroundDrag
// ---------------------------------------------------------------------------

/**
 * Handles pointer-move-while-down (drag) on the underground view.
 *
 * Emits MarkDigTileCommand only when the pointer enters a NEW tile
 * (debounce: compare against lastMarkedTileX/Y). Ignores tiles that are
 * already Marked or BeingDug.
 *
 * Flips isDragging to false and returns if the active view has changed
 * since drag started (prevents ghost tile marks on view-toggle mid-drag).
 */
export function handleUndergroundDrag(
  world: WorldState,
  viewState: ViewState,
  screenX: number,
  screenY: number,
  state: UndergroundInputState,
): void {
  if (!state.isDragging) return;
  if (viewState.activeView !== 'underground') { state.isDragging = false; return; }
  if (isPointerOverHUD(screenX, screenY)) return;
  const { tileX, tileY } = screenToTile(screenX, screenY, viewState.undergroundCamera);
  // Debounce: emit only when entering a new tile.
  if (tileX === state.lastMarkedTileX && tileY === state.lastMarkedTileY) return;
  const grid = world.undergroundGrids[PLAYER_COLONY_ID];
  if (!grid) return;
  if (tileX < 0 || tileY < 0 || tileX >= grid.width || tileY >= grid.height) return;
  const tileState = ugGet(grid, tileX, tileY);
  if (tileState !== UndergroundTileState.Solid && tileState !== UndergroundTileState.Open) return;
  const cmd: MarkDigTileCommand = {
    type: 'MarkDigTile',
    colonyId: PLAYER_COLONY_ID,
    tileX,
    tileY,
    issuedAtTick: world.tick,
  };
  world.commandQueue.push(cmd);
  state.lastMarkedTileX = tileX;
  state.lastMarkedTileY = tileY;
}

// ---------------------------------------------------------------------------
// handleUndergroundRightClick
// ---------------------------------------------------------------------------

/**
 * Handles a right-click on the underground view.
 *
 * Dispatch:
 *   - Marked tile → push CancelDigMarkCommand (CTRL-04: BeingDug is NOT cancellable).
 *   - Open tile that is a tunnel end → open context menu (UNDR-04).
 *   - All other tiles (Solid, BeingDug, non-tunnel-end Open) → no-op.
 *
 * No-ops if: activeView !== 'underground', pointer over HUD, or out of bounds.
 */
export function handleUndergroundRightClick(
  world: WorldState,
  viewState: ViewState,
  screenX: number,
  screenY: number,
): void {
  if (viewState.activeView !== 'underground') return;
  if (isPointerOverHUD(screenX, screenY)) return;
  const { tileX, tileY } = screenToTile(screenX, screenY, viewState.undergroundCamera);
  const grid = world.undergroundGrids[PLAYER_COLONY_ID];
  if (!grid) return;
  if (tileX < 0 || tileY < 0 || tileX >= grid.width || tileY >= grid.height) return;
  const tileState = ugGet(grid, tileX, tileY);

  if (tileState === UndergroundTileState.Marked) {
    // CancelDigMark — only on Marked tiles (CTRL-04: BeingDug finish-then-switch).
    const cmd: CancelDigMarkCommand = {
      type: 'CancelDigMark',
      colonyId: PLAYER_COLONY_ID,
      tileX,
      tileY,
      issuedAtTick: world.tick,
    };
    world.commandQueue.push(cmd);
    return;
  }

  if (tileState === UndergroundTileState.Open && isTunnelEnd(world, tileX, tileY, PLAYER_COLONY_ID)) {
    // Open tunnel end → show context menu (UNDR-04).
    contextMenuState.visible = true;
    contextMenuState.screenX = screenX;
    contextMenuState.screenY = screenY;
    contextMenuState.anchorTileX = tileX;
    contextMenuState.anchorTileY = tileY;
  }
  // Solid / BeingDug / non-tunnel-end Open → no-op (including no context menu).
}

// ---------------------------------------------------------------------------
// registerUndergroundInput — wires Phaser pointer events
// ---------------------------------------------------------------------------

/**
 * registerUndergroundInput — attach underground-click + drag handlers to a Phaser.Scene.
 *
 * Called from GameScene.create() (Plan 06 Task 3) after UIScene is launched.
 * Event registrations:
 *   - pointerdown: left → handleUndergroundLeftClick, right → handleUndergroundRightClick.
 *   - pointermove (while left button down): handleUndergroundDrag.
 *   - pointerup: resets isDragging.
 *
 * Coexistence with registerDragPan: both register pointerdown/pointermove/pointerup.
 * Phaser fires multiple handlers; drag-pan guards on right-click (no-ops on left clicks
 * from world-click handlers), and both guard on isPointerOverHUD.
 *
 * @param scene     - Phaser.Scene (GameScene) providing the input event bus.
 * @param world     - Mutable WorldState reference (commandQueue is written).
 * @param viewState - Render-layer ViewState; activeView is read for guard.
 */
export function registerUndergroundInput(
  scene: Phaser.Scene,
  world: WorldState,
  viewState: ViewState,
): void {
  const state: UndergroundInputState = {
    isDragging: false,
    lastMarkedTileX: -1,
    lastMarkedTileY: -1,
  };

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (pointer.leftButtonDown()) {
      handleUndergroundLeftClick(world, viewState, pointer.x, pointer.y, state);
    } else if (pointer.rightButtonDown()) {
      handleUndergroundRightClick(world, viewState, pointer.x, pointer.y);
    }
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (pointer.isDown && pointer.leftButtonDown()) {
      handleUndergroundDrag(world, viewState, pointer.x, pointer.y, state);
    }
  });

  scene.input.on('pointerup', () => {
    state.isDragging = false;
  });
}
