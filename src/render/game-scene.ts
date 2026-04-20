// game-scene.ts — Phase 8 Phaser GameScene: drives game loop, renders world, handles keyboard/camera.
//
// Owns: createGameLoop wiring, draw dispatch, Tab view-toggle, camera-pan triggers.
// UIScene is launched on top of GameScene (stub in Plan 05).
//
// Coordinate model (Phase 8.5 stabilization):
//   The project owns the camera. `CameraState` is in tile units; the draw modules
//   project world tiles into screen pixels manually by subtracting `left/top` in
//   visibleRange(). Phaser's own camera (`this.cameras.main`) is left at
//   scroll=0 and bounds=default — it is NOT synced to CameraState. Previously we
//   also set `cameras.main.scrollX/scrollY` from CameraState, which double-
//   translated the Graphics object and pushed the world offscreen (this was the
//   "surface appears all black" + "underground click Y-offset" bug). The fix is
//   a single transform: manual projection in the draw modules.
//
// Pitfall 1: Do not sync `cameras.main.scrollX/scrollY` from CameraState. The
//            draw modules already project to screen space.
// Pitfall 2: Keyboard registration is GameScene-only — UIScene must NOT call createCursorKeys().
// Pitfall 3: scale.mode = NONE, fixed 800x592 — no DPR scaling.

import * as Phaser from 'phaser';
import { createScenario } from '../sim/scenario.js';
import { copyWorldState, type WorldState } from '../sim/types.js';
import { tick } from '../sim/tick.js';
import { createGameLoop, type GameLoop, MS_PER_TICK } from '../platform/game-loop.js';
import {
  type ViewState,
  createViewState,
  toggleView,
  clampCamera,
} from './camera.js';
import {
  PLAYER_START_X, PLAYER_START_Y,
  SURFACE_GRID_WIDTH, SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH, UNDERGROUND_GRID_HEIGHT,
} from '../sim/constants.js';
import { drawSurface, type GfxLike } from './draw-surface.js';
import { drawUnderground } from './draw-underground.js';
import { drawPheromoneOverlay } from './draw-pheromone.js';
import { processCameraInput, registerDragPan } from '../input/camera-input.js';
import { registerSurfaceInput, type SurfaceInputState } from '../input/surface-input.js';
import { registerUndergroundInput } from '../input/underground-input.js';

export class GameScene extends Phaser.Scene {
  private world!: WorldState;
  private prevState!: WorldState;
  private viewState!: ViewState;
  private gameLoop!: GameLoop;
  private gfx!: Phaser.GameObjects.Graphics;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private tabKey!: Phaser.Input.Keyboard.Key;
  private dragState!: { isDragging: boolean; lastX: number; lastY: number; active: boolean };
  private surfaceInputState!: SurfaceInputState;
  private lastActiveView: ViewState['activeView'] | null = null;

  constructor() { super({ key: 'GameScene' }); }

  create() {
    // Use a fixed seed for dev reproducibility; Phase 9 introduces save-loading that overrides.
    const seed = 1;
    this.world = createScenario(seed);
    this.prevState = createScenario(seed);
    copyWorldState(this.world, this.prevState);

    this.viewState = createViewState(PLAYER_START_X, PLAYER_START_Y);
    this.gfx = this.add.graphics();

    // Input registration — keyboard is GameScene-only (Pitfall 2).
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
    this.tabKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
    // Prevent Tab from moving focus to browser UI:
    this.input.keyboard!.addCapture('TAB');
    this.input.mouse!.disableContextMenu();

    // Drag-pan registration — returns dragState ref for processCameraInput
    this.dragState = registerDragPan(this, this.viewState);

    // Phase 8.5: Phaser's main camera is intentionally left at scroll=0 with
    // default bounds. CameraState drives the manual projection inside the draw
    // modules; syncing Phaser's camera to the same value caused a double-
    // translation that pushed the world offscreen. See file header.

    // Platform accumulator — snapshot hook wired; speed/pause remain Phase 9 seams.
    this.gameLoop = createGameLoop(tick, this.world, {
      onBeforeTick: (w) => copyWorldState(w, this.prevState),
    });

    // Launch HUD scene on top.
    this.scene.launch('UIScene', { viewState: this.viewState, world: this.world });
    this.scene.bringToTop('UIScene');

    // World input dispatchers — internally guard on viewState.activeView.
    // Both handlers coexist with registerDragPan: Phaser fires all pointerdown
    // handlers; each guards isPointerOverHUD + activeView so they don't interfere.
    this.surfaceInputState = registerSurfaceInput(this, this.world, this.viewState);
    registerUndergroundInput(this, this.world, this.viewState);
  }

  update(_time: number, delta: number) {
    // Tab toggles view (JustDown handles key-press edge, not held).
    if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
      toggleView(this.viewState);
    }

    // Track active view for anything that needs to diff on toggle. Phaser's
    // camera intentionally stays at default bounds / scroll=0 (see header).
    if (this.viewState.activeView !== this.lastActiveView) {
      this.lastActiveView = this.viewState.activeView;
    }

    // Drive platform accumulator (Phase 8 snapshot hook fires before each tick).
    this.gameLoop.update(delta);

    // Apply keyboard-pan + final clamp. Drag-pan runs in its own handlers
    // inside registerDragPan. Edge-pan was removed in Phase 8.5.
    processCameraInput(this.viewState, {
      cursors: this.cursors,
      wasd: this.wasd,
      dragState: this.dragState,
    });

    // Pick the active CameraState for draw dispatch. Phaser's camera is NOT
    // synced — the draw modules project manually (see file header).
    const cam = this.viewState.activeView === 'surface' ? this.viewState.surfaceCamera : this.viewState.undergroundCamera;

    // After all pan triggers, ensure the active CameraState is clamped once
    // per frame (safety net for floating-point drift; pan paths also clamp).
    const worldW = this.viewState.activeView === 'surface' ? SURFACE_GRID_WIDTH : UNDERGROUND_GRID_WIDTH;
    const worldH = this.viewState.activeView === 'surface' ? SURFACE_GRID_HEIGHT : UNDERGROUND_GRID_HEIGHT;
    clampCamera(cam, worldW, worldH);

    // Draw world.
    const alpha = this.gameLoop.accumulatorMs / MS_PER_TICK;
    const gfx = this.gfx as unknown as GfxLike;
    gfx.clear();
    drawPheromoneOverlay(gfx, this.world, cam, this.viewState.activeView);
    if (this.viewState.activeView === 'surface') {
      // Phase 8.5 interaction-feedback: forward the right-click entrance
      // preview so the player sees a gold frame on the tile that a
      // confirming left-click will place the entrance at.
      const pending =
        this.surfaceInputState.pendingEntranceTileX !== null &&
        this.surfaceInputState.pendingEntranceTileY !== null
          ? {
              tileX: this.surfaceInputState.pendingEntranceTileX,
              tileY: this.surfaceInputState.pendingEntranceTileY,
            }
          : null;
      drawSurface(gfx, this.prevState, this.world, alpha, cam, pending);
    } else {
      drawUnderground(gfx, this.prevState, this.world, alpha, cam);
    }
  }

  /** Accessor for UIScene / Plan 05 / Plan 06 — safe read-only reference. */
  getWorld(): WorldState { return this.world; }
  getViewState(): ViewState { return this.viewState; }
}
