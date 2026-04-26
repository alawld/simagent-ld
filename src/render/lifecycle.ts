// lifecycle.ts — render-layer lifecycle event names shared between the scene
// (which emits) and main.ts (which converts to a Promise on the mount()
// return value). Lives in its own module so the event-name contract is
// authored independently of the GameScene class — the scene module is
// large, and a typo'd literal on either side would silently fail. A single
// imported constant gives both ends one source of truth.

/**
 * Emitted on `game.events` once `GameScene.create()` has finished — preload
 * assets loaded, scene graph constructed, boot path (fresh world or
 * SavePrompt overlay) dispatched and ready to render on the next frame.
 * Surfaced via `MountedGame.ready: Promise<void>` so host pages can hide a
 * loading spinner the moment the game is interactive.
 */
export const SUBTERRANS_READY_EVENT = 'subterrans:ready';
