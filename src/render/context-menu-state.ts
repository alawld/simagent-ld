// context-menu-state.ts — Module-level singleton ContextMenuState.
//
// Shared state between UIScene (renderer) and underground-input (Plan 06 trigger).
// Plan 06 sets visible=true + coordinates when the player right-clicks underground.
// UIScene reads the state each frame to draw the context menu.
//
// No logic lives here — pure data container with two helpers.

export interface ContextMenuState {
  visible: boolean;
  screenX: number;
  screenY: number;
  anchorTileX: number;
  anchorTileY: number;
}

export const contextMenuState: ContextMenuState = {
  visible: false,
  screenX: 0,
  screenY: 0,
  anchorTileX: 0,
  anchorTileY: 0,
};

export function hideContextMenu(): void {
  contextMenuState.visible = false;
}
