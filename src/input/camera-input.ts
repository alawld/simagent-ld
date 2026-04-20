// camera-input.ts — Phase 8 (Phase 8.5-stabilized) camera pan input orchestrator.
//
// Supported camera pan triggers after the Phase 8.5 stabilization pass:
//   1. Space + left-drag — primary map-style pan gesture. Works on any mouse
//      or trackpad that can left-click. While Space is held, world-input
//      handlers (dig marking, food mark, entrance designation, chamber menu)
//      are suppressed so the same gesture never races between pan and world
//      action.
//   2. Middle-button drag — secondary pan gesture for users with a three-
//      button mouse. Retained because it is strictly more convenient than
//      reaching for Space when it is available.
//   3. Keyboard pan — arrow keys + WASD (secondary path; per-frame poll).
//
// Edge-pan (cursor-near-edge scroll) was removed in Phase 8.5 (2026-04-19). It
// did not match the intended map-style surface navigation, it fought with HUD
// widgets on the edges, and it caused drift when the cursor rested near a
// canvas edge. The PRD (§7a) has been amended; `EDGE_PAN_THRESHOLD_PX` is kept
// as a historical constant in `camera.ts` but is no longer consumed here.
//
// `panInputState` is a module-level singleton exposed so surface-input and
// underground-input can suppress their own pointerdown handling while a pan
// gesture is in flight. This keeps the left-drag excavation gesture intact
// while still giving the player a practical trackpad-friendly primary pan.
//
// No Phaser *runtime* dependency at the module level — Phaser types are
// imported with `import type` only so this file can be tested without Phaser.

import type * as Phaser from 'phaser';
import {
  HUD,
  TILE_SIZE_PX,
} from '../render/sprites.js';
import {
  type ViewState,
  type CameraState,
  clampCamera,
  CAMERA_SCROLL_SPEED,
} from '../render/camera.js';
import {
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
} from '../sim/constants.js';

// ---------------------------------------------------------------------------
// panInputState — module-level singleton
// ---------------------------------------------------------------------------

/**
 * Shared pan-gesture state, read by world-input handlers so they know when to
 * suppress a left-click (the same physical gesture is pan, not world action).
 *
 * Mutated by registerDragPan's Phaser event handlers. Exposed as a live object
 * so consumers can read the latest values without subscribing.
 *
 * - `spaceHeld` flips on Space keydown / keyup. While true, a left-drag pans.
 * - `isPanning`  is true from pan-start pointerdown until pointerup. This
 *   covers both Space+left and middle-button gestures.
 */
export const panInputState = {
  spaceHeld: false,
  isPanning: false,
};

/**
 * Test-only reset so unit tests that exercise world-input handlers do not
 * inherit state from a prior test that set `spaceHeld = true`. Production
 * code should never need to call this.
 */
export function resetPanInputStateForTests(): void {
  panInputState.spaceHeld = false;
  panInputState.isPanning = false;
}

// ---------------------------------------------------------------------------
// isPointerOverHUD
// ---------------------------------------------------------------------------

/**
 * isPointerOverHUD — return true if the screen-pixel point (px, py) falls
 * inside any *visible* HUD zone rectangle.
 *
 * Used by drag-pan and world-input handlers to suppress pointer events that
 * land on HUD widgets.
 *
 * PRD §6 reserves HUD.SPEED and HUD.SAVE_ICON as Phase 9 layout slots —
 * Phase 8 renders nothing there, so masking those zones in Phase 8 creates
 * invisible input-dead zones that feel broken to the player. They are
 * intentionally omitted from the zone list here and should be re-added in
 * Phase 9 when the speed controls and autosave indicator render.
 *
 * Inclusion rule: x in [rect.x, rect.x + rect.w) and y in [rect.y, rect.y + rect.h).
 */
export function isPointerOverHUD(px: number, py: number): boolean {
  const zones = [
    HUD.STATS,
    HUD.TRIANGLE,
    HUD.MINIMAP,
    HUD.VIEW_TOGGLE,
  ] as const;
  for (const zone of zones) {
    if (
      px >= zone.x &&
      px < zone.x + zone.w &&
      py >= zone.y &&
      py < zone.y + zone.h
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// PanInputs
// ---------------------------------------------------------------------------

/**
 * PanInputs — shape of everything processCameraInput needs per frame.
 *
 * Passed from GameScene.update() each frame.
 *
 * Phase 8.5: edge-pan was removed, so `pointer`, `canvasW`, and `canvasH` are
 * no longer needed here. Keyboard pan is evaluated synchronously in
 * processCameraInput; drag-pan mutations happen inside registerDragPan's
 * event handlers.
 */
export interface PanInputs {
  /** Phaser cursor-key state (arrow keys). */
  cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  /** WASD key state. */
  wasd: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  /**
   * Drag state reference returned from registerDragPan.
   * processCameraInput does NOT read this — drag-pan mutations happen
   * directly in the pointermove handler. Included here for debugging.
   */
  dragState: { isDragging: boolean; lastX: number; lastY: number; active: boolean };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return [worldW, worldH] tile dimensions for the currently active view. */
function worldDimensions(viewState: ViewState): [number, number] {
  return viewState.activeView === 'surface'
    ? [SURFACE_GRID_WIDTH, SURFACE_GRID_HEIGHT]
    : [UNDERGROUND_GRID_WIDTH, UNDERGROUND_GRID_HEIGHT];
}

/** Return the active camera for the current view. */
function activeCamera(viewState: ViewState): CameraState {
  return viewState.activeView === 'surface'
    ? viewState.surfaceCamera
    : viewState.undergroundCamera;
}

// ---------------------------------------------------------------------------
// processCameraInput
// ---------------------------------------------------------------------------

/**
 * processCameraInput — apply keyboard pan triggers then clamp.
 *
 * Called once per frame from GameScene.update(). Drag-pan mutations happen
 * inside the event handlers registered by registerDragPan; this function
 * applies the keyboard triggers and issues the single end-of-frame clamp.
 *
 * Pan order:
 *   1. Keyboard (arrow keys + WASD) — each axis independent.
 *   2. clampCamera() — single call at end of frame.
 *
 * The Phaser camera scroll is synced in GameScene.update() after this call
 * returns.
 *
 * Phase 8.5: edge-pan was removed — see module header.
 */
export function processCameraInput(viewState: ViewState, inputs: PanInputs): void {
  const cam = activeCamera(viewState);
  const [worldW, worldH] = worldDimensions(viewState);

  // --- Keyboard pan ---
  if (inputs.cursors.left.isDown || inputs.wasd.A.isDown) {
    cam.x -= CAMERA_SCROLL_SPEED;
  }
  if (inputs.cursors.right.isDown || inputs.wasd.D.isDown) {
    cam.x += CAMERA_SCROLL_SPEED;
  }
  if (inputs.cursors.up.isDown || inputs.wasd.W.isDown) {
    cam.y -= CAMERA_SCROLL_SPEED;
  }
  if (inputs.cursors.down.isDown || inputs.wasd.S.isDown) {
    cam.y += CAMERA_SCROLL_SPEED;
  }

  // --- Single clamp at end of frame ---
  clampCamera(cam, worldW, worldH);
}

// ---------------------------------------------------------------------------
// registerDragPan
// ---------------------------------------------------------------------------

/**
 * DragState — shared mutable object tracking drag-pan progress.
 */
export interface DragState {
  /** True when a left-button drag has moved at least one pixel. */
  isDragging: boolean;
  /** Last pointer X seen during drag (pixels). */
  lastX: number;
  /** Last pointer Y seen during drag (pixels). */
  lastY: number;
  /** True from pointerdown (left, non-HUD) until pointerup. */
  active: boolean;
}

/**
 * registerDragPan — wire drag-pan event handlers on a Phaser.Scene.
 *
 * Supported pan gestures (Phase 8.5):
 *   1. **Space + left-drag** (primary, trackpad-friendly). While the Space
 *      key is held, pressing the left mouse button on a non-HUD region
 *      starts a pan; moving the pointer drags the camera; releasing the
 *      button ends the gesture. Works on any pointing device that has a
 *      left button (i.e. every mouse and trackpad).
 *   2. **Middle-button drag** (secondary, three-button mouse). Does not
 *      require Space. Retained because it is faster than reaching for Space
 *      when a middle button is available.
 *
 * Contract with world-input handlers:
 *   - While `panInputState.spaceHeld === true` or `panInputState.isPanning
 *     === true`, surface-input and underground-input must no-op on
 *     left-click / drag. This is how we keep left-drag excavation
 *     (underground dig marking) intact while still giving the player a
 *     practical primary pan gesture — the two gestures are disambiguated
 *     by the Space modifier, not by the mouse button.
 *
 * Returns the shared dragState object for back-compat with PanInputs
 * (processCameraInput ignores it). `panInputState` is the source of truth
 * for cross-module pan-mode checks.
 *
 * HUD-zone pointerdown and HUD-zone pointermove are ignored so a drag
 * starting inside a HUD widget never pans the camera.
 */
export function registerDragPan(scene: Phaser.Scene, viewState: ViewState): DragState {
  const dragState: DragState = {
    isDragging: false,
    lastX: 0,
    lastY: 0,
    active: false,
  };

  // --- Space modifier tracking -----------------------------------------
  // We use the keyboard.addKey helper so Phaser manages the KeyCode lookup
  // (avoids a direct `Phaser.Input.Keyboard.KeyCodes.SPACE` reference, which
  // would require a runtime Phaser import). addCapture prevents Space from
  // scrolling the host page while the canvas has focus.
  const keyboard = scene.input.keyboard;
  if (keyboard) {
    keyboard.addCapture('SPACE');
    const spaceKey = keyboard.addKey('SPACE');
    spaceKey.on('down', () => {
      panInputState.spaceHeld = true;
    });
    spaceKey.on('up', () => {
      panInputState.spaceHeld = false;
      // If we were panning via Space+left-drag but the user released Space
      // before releasing the mouse, end the pan gracefully. pointerup below
      // will also clear, so this is just defensive.
      if (dragState.active && !panInputState.isPanning) return;
    });
  }

  const isPanTriggerDown = (pointer: Phaser.Input.Pointer): boolean => {
    if (pointer.middleButtonDown()) return true;
    if (panInputState.spaceHeld && pointer.leftButtonDown()) return true;
    return false;
  };

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!isPanTriggerDown(pointer)) return;
    if (isPointerOverHUD(pointer.x, pointer.y)) return;
    dragState.active = true;
    dragState.lastX = pointer.x;
    dragState.lastY = pointer.y;
    dragState.isDragging = false;
    panInputState.isPanning = true;
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (!dragState.active) return;
    // Continue pan only while the originating trigger is still held.
    if (!isPanTriggerDown(pointer)) return;
    if (isPointerOverHUD(pointer.x, pointer.y)) return;

    const dx = (pointer.x - dragState.lastX) / TILE_SIZE_PX;
    const dy = (pointer.y - dragState.lastY) / TILE_SIZE_PX;

    const cam = activeCamera(viewState);
    cam.x -= dx;
    cam.y -= dy;

    const [worldW, worldH] = worldDimensions(viewState);
    clampCamera(cam, worldW, worldH);

    dragState.lastX = pointer.x;
    dragState.lastY = pointer.y;
    dragState.isDragging = true;
  });

  scene.input.on('pointerup', () => {
    dragState.active = false;
    dragState.isDragging = false;
    panInputState.isPanning = false;
  });

  return dragState;
}
