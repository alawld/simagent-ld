// game-scene.ts — Phase 8 Phaser GameScene: drives game loop, renders world, handles keyboard/camera.
//
// Owns: createGameLoop wiring, draw dispatch, Tab view-toggle, all four camera-pan triggers.
// UIScene is launched on top of GameScene (stub in Plan 05).
//
// Pitfall 1: Phaser camera scrollX/scrollY are top-left pixel offsets; CameraState.x/y are
//            tile-unit centers. Conversion: scrollX = (cam.x - cam.viewportWidth/2) * TILE_SIZE_PX.
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
import { TILE_SIZE_PX } from './sprites.js';
import {
  PLAYER_START_X, PLAYER_START_Y,
  SURFACE_GRID_WIDTH, SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH, UNDERGROUND_GRID_HEIGHT,
} from '../sim/constants.js';
import { drawSurface, type GfxLike } from './draw-surface.js';
import { drawUnderground } from './draw-underground.js';
import { drawPheromoneOverlay } from './draw-pheromone.js';
import { processCameraInput, registerDragPan } from '../input/camera-input.js';
import { registerSurfaceInput } from '../input/surface-input.js';
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

    this.cameras.main.setBounds(0, 0, SURFACE_GRID_WIDTH * TILE_SIZE_PX, SURFACE_GRID_HEIGHT * TILE_SIZE_PX);

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
    registerSurfaceInput(this, this.world, this.viewState);
    registerUndergroundInput(this, this.world, this.viewState);
  }

  update(_time: number, delta: number) {
    // Tab toggles view (JustDown handles key-press edge, not held).
    if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
      toggleView(this.viewState);
      // Reset camera bounds when switching views (underground has different world size).
      if (this.viewState.activeView === 'surface') {
        this.cameras.main.setBounds(0, 0, SURFACE_GRID_WIDTH * TILE_SIZE_PX, SURFACE_GRID_HEIGHT * TILE_SIZE_PX);
      } else {
        this.cameras.main.setBounds(0, 0, UNDERGROUND_GRID_WIDTH * TILE_SIZE_PX, UNDERGROUND_GRID_HEIGHT * TILE_SIZE_PX);
      }
    }

    // Drive platform accumulator (Phase 8 snapshot hook fires before each tick).
    this.gameLoop.update(delta);

    // Apply camera pan triggers + clamp.
    processCameraInput(this.viewState, {
      cursors: this.cursors,
      wasd: this.wasd,
      pointer: this.input.activePointer,
      canvasW: this.scale.width,
      canvasH: this.scale.height,
      dragState: this.dragState,
    });

    // Sync Phaser camera scroll to the project's CameraState (Pitfall 1 — center-to-top-left conversion).
    const cam = this.viewState.activeView === 'surface' ? this.viewState.surfaceCamera : this.viewState.undergroundCamera;
    this.cameras.main.scrollX = (cam.x - cam.viewportWidth / 2) * TILE_SIZE_PX;
    this.cameras.main.scrollY = (cam.y - cam.viewportHeight / 2) * TILE_SIZE_PX;

    // After all pan triggers, ensure the active camera is clamped once per frame.
    // (processCameraInput clamps keyboard + edge-pan; drag-pan clamps inline.
    //  This final call is a safety net for accumulated floating-point drift.)
    const worldW = this.viewState.activeView === 'surface' ? SURFACE_GRID_WIDTH : UNDERGROUND_GRID_WIDTH;
    const worldH = this.viewState.activeView === 'surface' ? SURFACE_GRID_HEIGHT : UNDERGROUND_GRID_HEIGHT;
    clampCamera(cam, worldW, worldH);

    // Draw world.
    const alpha = this.gameLoop.accumulatorMs / MS_PER_TICK;
    const gfx = this.gfx as unknown as GfxLike;
    gfx.clear();
    drawPheromoneOverlay(gfx, this.world, cam, this.viewState.activeView);
    if (this.viewState.activeView === 'surface') {
      drawSurface(gfx, this.prevState, this.world, alpha, cam);
    } else {
      drawUnderground(gfx, this.prevState, this.world, alpha, cam);
    }
  }

  /** Accessor for UIScene / Plan 05 / Plan 06 — safe read-only reference. */
  getWorld(): WorldState { return this.world; }
  getViewState(): ViewState { return this.viewState; }
}
