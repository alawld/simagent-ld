// context-menu-state.ts — Module-level singleton ContextMenuState.
//
// Shared state between UIScene (renderer) and underground-input (trigger).
// underground-input sets visible=true + coordinates when the player right-clicks
// an Open tunnel-end. UIScene reads the state each frame to draw the context menu.
//
// Deferred hide: UIScene and underground-input both register pointerdown handlers
// in Phaser. The firing order across scenes is not guaranteed, so synchronously
// flipping `visible=false` inside a handler causes races — a handler that runs
// second would see visible=false and misinterpret the click (e.g., dig-mark the
// tile beneath the menu, or skip the chamber-placement selection). To avoid that,
// `requestHideContextMenu()` defers the hide to the next UIScene.update frame via
// the `pendingHide` flag. All handlers in the current pointerdown dispatch observe
// a consistent `visible=true` state.
//
// Tests use `hideContextMenu()` for immediate synchronous reset between cases.

export interface ContextMenuState {
  visible:     boolean;
  screenX:     number;
  screenY:     number;
  anchorTileX: number;
  anchorTileY: number;
  /** Set by requestHideContextMenu; cleared by applyPendingContextMenuHide on the next update frame. */
  pendingHide: boolean;
}

export const contextMenuState: ContextMenuState = {
  visible:     false,
  screenX:     0,
  screenY:     0,
  anchorTileX: 0,
  anchorTileY: 0,
  pendingHide: false,
};

/**
 * Immediately hide the menu. Use in tests for state reset and in the
 * view-change auto-dismiss path (UIScene.update already runs once per frame,
 * so there is no race to worry about).
 */
export function hideContextMenu(): void {
  contextMenuState.visible     = false;
  contextMenuState.pendingHide = false;
}

/**
 * Request the menu be hidden on the next frame. Use inside pointerdown
 * handlers so all cross-scene handlers in the current dispatch observe
 * a consistent `visible=true` state.
 */
export function requestHideContextMenu(): void {
  contextMenuState.pendingHide = true;
}

/**
 * Apply any pending hide. Call at the start of UIScene.update each frame,
 * before any state is read for rendering.
 */
export function applyPendingContextMenuHide(): void {
  if (contextMenuState.pendingHide) {
    contextMenuState.visible     = false;
    contextMenuState.pendingHide = false;
  }
}
