// lifecycle.ts — render-layer lifecycle event names shared between the scene
// (which emits) and main.ts (which converts to Promise on the mount() return
// value). Kept in its own file so main.ts doesn't pull in the full GameScene
// module just to reference the event constant.

/**
 * Emitted on `game.events` once `GameScene.create()` has finished — preload
 * assets are loaded, the canvas is painted, and the chosen boot path
 * (fresh world or SavePrompt overlay) is dispatched. Surfaced via
 * `MountedGame.ready: Promise<void>` so host pages can hide a loading
 * spinner the moment the game is interactive.
 */
export const SUBTERRANS_READY_EVENT = 'subterrans:ready';
