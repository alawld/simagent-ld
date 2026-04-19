// camera-input.ts — Phase 8 camera pan input orchestrator.
//
// Implements all four scroll triggers (arrow keys, WASD, mouse edge-pan, drag-pan)
// plus the HUD zone guard (isPointerOverHUD) per RESEARCH §Pattern 4.
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
  EDGE_PAN_THRESHOLD_PX,
} from '../render/camera.js';
import {
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
} from '../sim/constants.js';

// ---------------------------------------------------------------------------
// isPointerOverHUD
// ---------------------------------------------------------------------------

/**
 * isPointerOverHUD — return true if the screen-pixel point (px, py) falls
 * inside any *visible* HUD zone rectangle.
 *
 * Used by drag-pan, edge-pan, and world-input handlers to suppress
 * pointer events that land on HUD widgets.
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
  /** Active pointer (mouse / touch) for edge-pan. */
  pointer: Phaser.Input.Pointer;
  /** Canvas width in pixels — used for right/bottom edge-pan guard. */
  canvasW: number;
  /** Canvas height in pixels. */
  canvasH: number;
  /**
   * Drag state reference returned from registerDragPan.
   * processCameraInput does NOT read this — drag-pan mutations happen
   * directly in the pointermove handler.  Included here for debugging.
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
 * processCameraInput — apply keyboard + edge-pan pan triggers then clamp.
 *
 * Called once per frame from GameScene.update().  Drag-pan mutations happen
 * inside the event handlers registered by registerDragPan; this function
 * applies the remaining triggers and issues the single end-of-frame clamp.
 *
 * Pan order:
 *   1. Keyboard (arrow keys + WASD) — each axis independent.
 *   2. Edge-pan (mouse near canvas edge) — canvas-bounds guard applied.
 *   3. clampCamera() — single call at end of frame.
 *
 * The Phaser camera scroll is synced in GameScene.update() after this call
 * returns.
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

  // --- Edge-pan (canvas-bounds guard: pointer must be inside [0, canvasW] × [0, canvasH]) ---
  // Suppress edge-pan when the pointer is over a visible HUD widget — the
  // stats bar, triangle, and minimap all overlap the 32px edge bands, and
  // scrolling the camera while the player is dragging the triangle or
  // clicking the minimap makes the UI feel unstable.
  const { pointer, canvasW, canvasH } = inputs;

  if (!isPointerOverHUD(pointer.x, pointer.y)) {
    if (pointer.x >= 0 && pointer.x < EDGE_PAN_THRESHOLD_PX) {
      cam.x -= CAMERA_SCROLL_SPEED;
    }
    if (pointer.x > canvasW - EDGE_PAN_THRESHOLD_PX && pointer.x <= canvasW) {
      cam.x += CAMERA_SCROLL_SPEED;
    }
    if (pointer.y >= 0 && pointer.y < EDGE_PAN_THRESHOLD_PX) {
      cam.y -= CAMERA_SCROLL_SPEED;
    }
    if (pointer.y > canvasH - EDGE_PAN_THRESHOLD_PX && pointer.y <= canvasH) {
      cam.y += CAMERA_SCROLL_SPEED;
    }
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
 * Drag-pan is bound to **middle-button drag only** so it cannot collide
 * with left-click world actions (dig marking, food-pile mark, entrance
 * designation, chamber context menu). The left button is reserved
 * entirely for world input; the arrow keys, WASD, and mouse edge-pan
 * remain available for camera movement. (Phase 9 may add spacebar-held
 * pan if middle-button is awkward on trackpads.)
 *
 * Returns the shared dragState object so GameScene can pass it through
 * PanInputs for debugging (processCameraInput ignores it).
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

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.middleButtonDown()) return;
    if (isPointerOverHUD(pointer.x, pointer.y)) return;
    dragState.active = true;
    dragState.lastX = pointer.x;
    dragState.lastY = pointer.y;
    dragState.isDragging = false;
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (!dragState.active || !pointer.middleButtonDown()) return;
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
  });

  return dragState;
}
