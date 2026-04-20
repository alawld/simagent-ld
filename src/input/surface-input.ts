// surface-input.ts — Phase 8 surface-click dispatcher.
//
// Handles left-click (food-pile mark + entrance designation confirmation)
// and right-click (entrance preview) on the surface view.
//
// Guards:
//   - viewState.activeView must be 'surface' before dispatching any command.
//   - isPointerOverHUD rejects clicks that land on HUD zones (Pitfall 2).
//   - Tile bounds check (tileX/Y >= 0) before pushing commands.

import * as Phaser from 'phaser';
import type { WorldState } from '../sim/types.js';
import type { ViewState } from '../render/camera.js';
import { screenToTile } from '../render/camera.js';
import type { FoodPile } from '../sim/food.js';
import type { MarkFoodPileCommand, DesignateEntranceCommand } from '../sim/commands.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import { isPointerOverHUD, panInputState } from './camera-input.js';

// ---------------------------------------------------------------------------
// SurfaceInputState — mutable per-registration state
// ---------------------------------------------------------------------------

/**
 * Exported so the render layer (draw-surface.ts) can read `pendingEntranceTileX`
 * / `pendingEntranceTileY` and draw a preview outline on the tile the player
 * right-clicked. Phase 8.5 interaction-feedback fix: before, the right-click
 * preview was invisible and players had to remember the exact tile between
 * right-click and the confirming left-click.
 */
export interface SurfaceInputState {
  /** Right-click preview state: null = no pending designation, number = tileX of pending entrance. */
  pendingEntranceTileX: number | null;
  /** TileY companion to pendingEntranceTileX — needed so the render layer can outline the right cell. */
  pendingEntranceTileY: number | null;
}

// ---------------------------------------------------------------------------
// findFoodPileAt — O(n) scan over world.foodPiles
// ---------------------------------------------------------------------------

/**
 * Returns the FoodPile at (tileX, tileY) or null if none.
 * Called by handleSurfaceLeftClick when no entrance confirmation is pending.
 */
export function findFoodPileAt(world: WorldState, tileX: number, tileY: number): FoodPile | null {
  for (const pile of world.foodPiles) {
    if (pile.tileX === tileX && pile.tileY === tileY) return pile;
  }
  return null;
}

// ---------------------------------------------------------------------------
// handleSurfaceLeftClick
// ---------------------------------------------------------------------------

/**
 * Handles a left-click on the surface view.
 *
 * Priority order:
 *   1. If the clicked tile matches the pending entrance preview in BOTH X and Y,
 *      push DesignateEntranceCommand and clear the preview.
 *   2. Else → try food-pile mark at the clicked tile.
 *
 * No-ops if: activeView !== 'surface', pointer over HUD, or tile out of bounds.
 *
 * Phase 8.5 fix: confirmation previously matched only `tileX`, which meant a
 * player could right-click to preview tile (X, Y1), left-click a different row
 * (X, Y2) on the same column, and still confirm — but the command fired with
 * the second tile's Y. The preview frame and the placed entrance could
 * disagree. Confirmation now requires both tile coordinates to match the
 * previewed tile exactly; a non-matching left-click falls through to food-pile
 * mark and leaves the preview intact so the player can try again.
 */
export function handleSurfaceLeftClick(
  world: WorldState,
  viewState: ViewState,
  screenX: number,
  screenY: number,
  state: SurfaceInputState,
): void {
  if (viewState.activeView !== 'surface') return;
  if (isPointerOverHUD(screenX, screenY)) return;
  // Pan-mode guard: while Space is held or a pan gesture is already in flight,
  // the left-click is the pan trigger — not a world action.
  if (panInputState.spaceHeld || panInputState.isPanning) return;
  const { tileX, tileY } = screenToTile(screenX, screenY, viewState.surfaceCamera);
  if (tileX < 0 || tileY < 0) return;

  // Entrance designation confirmation: left-click on the exact tile that was
  // previewed by a prior right-click (both X and Y must match).
  if (
    state.pendingEntranceTileX !== null &&
    state.pendingEntranceTileY !== null &&
    state.pendingEntranceTileX === tileX &&
    state.pendingEntranceTileY === tileY
  ) {
    const cmd: DesignateEntranceCommand = {
      type: 'DesignateEntrance',
      colonyId: PLAYER_COLONY_ID,
      surfaceTileX: tileX,
      surfaceTileY: tileY,
      issuedAtTick: world.tick,
    };
    world.commandQueue.push(cmd);
    state.pendingEntranceTileX = null;
    state.pendingEntranceTileY = null;
    return;
  }

  // Food-pile mark at clicked tile.
  const pile = findFoodPileAt(world, tileX, tileY);
  if (pile) {
    const cmd: MarkFoodPileCommand = {
      type: 'MarkFoodPile',
      colonyId: PLAYER_COLONY_ID,
      tileX: pile.tileX,
      tileY: pile.tileY,
      issuedAtTick: world.tick,
    };
    world.commandQueue.push(cmd);
  }
}

// ---------------------------------------------------------------------------
// handleSurfaceRightClick
// ---------------------------------------------------------------------------

/**
 * Handles a right-click on the surface view.
 *
 * Sets pendingEntranceTileX to the clicked tileX (entrance designation preview).
 * A subsequent left-click on the same tile confirms and pushes DesignateEntranceCommand.
 *
 * No-ops if: activeView !== 'surface', pointer over HUD, or tile out of bounds.
 *
 * Note: tileY is recorded as context but DesignateEntranceCommand carries both coords.
 */
export function handleSurfaceRightClick(
  world: WorldState,
  viewState: ViewState,
  screenX: number,
  screenY: number,
  state: SurfaceInputState,
): void {
  if (viewState.activeView !== 'surface') return;
  if (isPointerOverHUD(screenX, screenY)) return;
  const { tileX, tileY } = screenToTile(screenX, screenY, viewState.surfaceCamera);
  if (tileX < 0 || tileY < 0) return;
  state.pendingEntranceTileX = tileX;
  state.pendingEntranceTileY = tileY;
}

// ---------------------------------------------------------------------------
// registerSurfaceInput — wires Phaser pointer events
// ---------------------------------------------------------------------------

/**
 * registerSurfaceInput — attach surface-click handlers to a Phaser.Scene.
 *
 * Called from GameScene.create() (Plan 06 Task 3) after UIScene is launched.
 * Each handler internally guards on viewState.activeView === 'surface',
 * so surface + underground handlers may both be registered without interference.
 *
 * @param scene     - Phaser.Scene (GameScene) providing the input event bus.
 * @param world     - Mutable WorldState reference (commandQueue is written).
 * @param viewState - Render-layer ViewState; activeView is read for guard.
 */
export function registerSurfaceInput(
  scene: Phaser.Scene,
  world: WorldState,
  viewState: ViewState,
): SurfaceInputState {
  const state: SurfaceInputState = {
    pendingEntranceTileX: null,
    pendingEntranceTileY: null,
  };
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (pointer.leftButtonDown()) {
      handleSurfaceLeftClick(world, viewState, pointer.x, pointer.y, state);
    } else if (pointer.rightButtonDown()) {
      handleSurfaceRightClick(world, viewState, pointer.x, pointer.y, state);
    }
  });
  return state;
}
