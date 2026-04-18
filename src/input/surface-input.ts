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
import { isPointerOverHUD } from './camera-input.js';

// ---------------------------------------------------------------------------
// SurfaceInputState — mutable per-registration state
// ---------------------------------------------------------------------------

interface SurfaceInputState {
  /** Right-click preview state: null = no pending designation, number = tileX of pending entrance. */
  pendingEntranceTileX: number | null;
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
 *   1. If pendingEntranceTileX matches the clicked tileX → push DesignateEntranceCommand and reset.
 *   2. Else → try food-pile mark at the clicked tile.
 *
 * No-ops if: activeView !== 'surface', pointer over HUD, or tile out of bounds.
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
  const { tileX, tileY } = screenToTile(screenX, screenY, viewState.surfaceCamera);
  if (tileX < 0 || tileY < 0) return;

  // Entrance designation confirmation: left-click on the same tileX that was right-clicked.
  if (state.pendingEntranceTileX !== null && state.pendingEntranceTileX === tileX) {
    const cmd: DesignateEntranceCommand = {
      type: 'DesignateEntrance',
      colonyId: PLAYER_COLONY_ID,
      surfaceTileX: tileX,
      surfaceTileY: tileY,
      issuedAtTick: world.tick,
    };
    world.commandQueue.push(cmd);
    state.pendingEntranceTileX = null;
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
  // Suppress unused-variable warning for tileY — it isn't stored in the preview because
  // DesignateEntranceCommand will recalculate it from the confirmation click coords.
  void tileY;
  state.pendingEntranceTileX = tileX;
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
): void {
  const state: SurfaceInputState = { pendingEntranceTileX: null };
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (pointer.leftButtonDown()) {
      handleSurfaceLeftClick(world, viewState, pointer.x, pointer.y, state);
    } else if (pointer.rightButtonDown()) {
      handleSurfaceRightClick(world, viewState, pointer.x, pointer.y, state);
    }
  });
}
