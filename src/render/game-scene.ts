// game-scene.ts — Phase 9 Phaser GameScene: drives game loop, renders world, handles keyboard/camera.
//
// Owns: createGameLoop wiring, draw dispatch, Tab view-toggle, camera-pan triggers,
//       GamePhase FSM (Playing|Paused|GameOver|SavePrompt), save boot flow,
//       AI controller wiring (onBeforeTick → runAIController per AI colony),
//       outcome handling (gameLoop.pause() + UIScene overlay), autosave.
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
// Pitfall 4: NEVER use .keys()/.entries()/.get() on world.colonies — it is a PLAIN OBJECT (ADR-0006).
// Pitfall 5: No setMsPerTick(Infinity) for pause — use gameLoop.pause()/resume() (Plan 06 Task 1).
// Pitfall 6: Pause key is P, NOT Space — Space+left-drag is the primary map-pan gesture (Phase 8.5).

import * as Phaser from 'phaser';
import { createScenario } from '../sim/scenario.js';
import { copyWorldState, type WorldState } from '../sim/types.js';
import { tick } from '../sim/tick.js';
import { createGameLoop, type GameLoop, MS_PER_TICK } from '../platform/game-loop.js';
import { hasSave, loadSave, deleteSave, tickAutosave } from '../platform/save.js';
import { deserializeWorldState } from '../platform/save.js';
import { runAIController } from './ai-controller.js';
import {
  GamePhase,
  deriveAIColonyIds,
  appendInputLog,
  generateFreshSeed,
  decideBootMode,
} from './game-scene-logic.js';
import {
  type ViewState,
  createViewState,
  toggleView,
  clampCamera,
} from './camera.js';
import {
  PLAYER_COLONY_ID,
  PLAYER_START_X, PLAYER_START_Y,
  SURFACE_GRID_WIDTH, SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH, UNDERGROUND_GRID_HEIGHT,
} from '../sim/constants.js';
import { GameOutcome } from '../sim/game-over.js';
import { drawSurface, type GfxLike } from './draw-surface.js';
import { drawUnderground } from './draw-underground.js';
import { drawPheromoneOverlay } from './draw-pheromone.js';
import { processCameraInput, registerDragPan } from '../input/camera-input.js';
import { registerSurfaceInput, type SurfaceInputState } from '../input/surface-input.js';
import { registerUndergroundInput } from '../input/underground-input.js';
// UIScenePhase9 — subset of UIScene public API added in Plan 06 Task 3.
// Typed here to avoid circular imports; UIScene implements these methods.
interface UIScenePhase9 {
  showGameOverOverlay(outcome: GameOutcome, onRestart: () => void): void;
  hideGameOverOverlay(): void;
  showSavePromptOverlay(callbacks: { onContinue: () => void; onNewGame: () => void }): void;
  hideSavePromptOverlay(): void;
}
import type { SimCommand } from '../sim/commands.js';

// Re-export GamePhase for Plan 07 and other consumers
export { GamePhase, decideBootMode, deriveAIColonyIds, appendInputLog, generateFreshSeed };
export type { GamePhase as GamePhaseType };

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

  // Phase 9 — GamePhase FSM + session fields
  private gamePhase: GamePhase = GamePhase.Playing;
  private currentOutcome: GameOutcome = GameOutcome.None;
  private aiColonyIds: ReturnType<typeof deriveAIColonyIds> = [];
  private readonly inputLog: SimCommand[] = [];
  private lastAutosaveMs: number = 0;
  private currentSeed: number = 0;
  private speedMultiplier: number = 1;

  constructor() { super({ key: 'GameScene' }); }

  create() {
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

    // Phase 9 Plan 06 keyboard — P toggles pause; 1/2/4 set speed.
    // SPACE is reserved for pan gesture (Phase 8.5 decision — see file header Pitfall 6).
    this.input.keyboard!.on('keydown-P', () => {
      if (this.gamePhase === GamePhase.Playing) {
        this.gamePhase = GamePhase.Paused;
        this.gameLoop.pause();
      } else if (this.gamePhase === GamePhase.Paused) {
        this.gamePhase = GamePhase.Playing;
        this.gameLoop.resume();
      }
    });
    this.input.keyboard!.on('keydown-ONE', () => { this.speedMultiplier = 1; });
    this.input.keyboard!.on('keydown-TWO', () => { this.speedMultiplier = 2; });
    this.input.keyboard!.on('keydown-FOUR', () => { this.speedMultiplier = 4; });

    // UIScene + input handlers take a LAZY world accessor — `this.world` is
    // assigned by bootFresh/bootFromSave below, and may be replaced again on
    // restart. Capturing the current (undefined) reference here would freeze
    // the HUD + world input against a pre-boot world (see Phase 9 stabilization).
    const getWorld = (): WorldState | undefined => this.world;

    // Launch HUD scene on top.
    this.scene.launch('UIScene', { viewState: this.viewState, getWorld });
    this.scene.bringToTop('UIScene');

    // World input dispatchers — internally guard on viewState.activeView.
    this.surfaceInputState = registerSurfaceInput(this, getWorld, this.viewState);
    registerUndergroundInput(this, getWorld, this.viewState);

    // Phase 9 boot: check for existing save. If found, show SavePrompt overlay.
    // Otherwise boot a fresh scenario directly.
    const bootMode = decideBootMode(hasSave);
    if (bootMode === 'prompt') {
      this.gamePhase = GamePhase.SavePrompt;
      const uiScene = this.scene.get('UIScene') as unknown as UIScenePhase9;
      uiScene.showSavePromptOverlay({
        onContinue: () => this.bootFromSave(),
        onNewGame: () => {
          deleteSave();
          this.bootFresh();
        },
      });
    } else {
      this.bootFresh();
    }
  }

  // ---------------------------------------------------------------------------
  // Boot helpers
  // ---------------------------------------------------------------------------

  private bootFresh(): void {
    // W1: seed formula — Date.now() is ~1.7e12, exceeds int32. Bitmask-clamp to positive int32.
    // Bitwise ops truncate to int32; 0x7fffffff mask ensures sign bit is clear.
    const seed = generateFreshSeed(Date.now());
    this.currentSeed = seed;
    // createScenario creates BOTH colonies (PLAYER_COLONY_ID + ENEMY_COLONY_ID) unconditionally.
    this.world = createScenario(seed);
    this.finishBoot();
  }

  private bootFromSave(): void {
    const loaded = loadSave();
    if (loaded === null) {
      // Corrupt save: fall through to fresh
      deleteSave();
      this.bootFresh();
      return;
    }
    // Plan 04 SaveFile shape: { version, seed, inputLog, snapshot }
    this.currentSeed = loaded.seed;
    this.world = deserializeWorldState(loaded.snapshot);
    // SCEN-06 replay truth: restore inputLog completely so the continued session
    // can be replayed byte-for-byte from (seed, inputLog) per Plan 04 Task 1.
    for (const c of loaded.inputLog) this.inputLog.push(c);
    this.finishBoot();
  }

  private finishBoot(): void {
    this.prevState = createScenario(this.currentSeed);
    copyWorldState(this.world, this.prevState);

    // B1: world.colonies is a PLAIN OBJECT per ADR-0006.
    // Use Object.keys — NEVER .keys()/.entries()/.get() (those are Map APIs).
    this.aiColonyIds = deriveAIColonyIds(this.world, PLAYER_COLONY_ID);

    this.gameLoop = createGameLoop(tick, this.world, {
      onBeforeTick: (w) => {
        // Run AI for all AI colonies FIRST (AI commands enqueued before drain)
        for (const aiCid of this.aiColonyIds) {
          runAIController(w, aiCid);
        }
        // Then snapshot prevState for render interpolation
        copyWorldState(w, this.prevState);
      },
      onAfterDrain: (cmds) => {
        // SCEN-06 replay truth: never truncate — appendInputLog handles all commands
        appendInputLog(this.inputLog, cmds);
      },
      onTickOutcome: (outcome) => {
        this.currentOutcome = outcome;
        this.gamePhase = GamePhase.GameOver;
        // W2: first-class pause via Plan 06 Task 1 API — no setMsPerTick(Infinity)
        this.gameLoop.pause();
        const uiScene = this.scene.get('UIScene') as unknown as UIScenePhase9;
        uiScene.showGameOverOverlay(outcome, () => this.restartGame());
      },
      getMsPerTick: () => MS_PER_TICK / this.speedMultiplier,
    });

    this.gamePhase = GamePhase.Playing;
    this.gameLoop.resume();  // ensure running (createGameLoop default is not paused)
    this.lastAutosaveMs = performance.now();
    // UIScene and world-input handlers resolve `this.world` lazily via the
    // getWorld accessor installed in create(), so the new reference is picked
    // up automatically on bootFresh, bootFromSave, and restartGame.
  }

  private restartGame(): void {
    deleteSave();
    this.currentOutcome = GameOutcome.None;
    // bootFresh → finishBoot resumes the loop; this is the authoritative restart path.
    this.bootFresh();
    const uiScene = this.scene.get('UIScene') as unknown as UIScenePhase9;
    uiScene.hideGameOverOverlay();
  }

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------

  update(time: number, delta: number) {
    // SavePrompt phase: overlay handles input; no tick updates expected.
    if (this.gamePhase === GamePhase.SavePrompt) return;

    // Tab toggles view (JustDown handles key-press edge, not held).
    if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
      toggleView(this.viewState);
    }

    // Track active view for anything that needs to diff on toggle.
    if (this.viewState.activeView !== this.lastActiveView) {
      this.lastActiveView = this.viewState.activeView;
    }

    // Drive platform accumulator. When paused/GameOver, gameLoop.pause() already
    // freezes tick execution via its internal flag — update() is safe to call.
    this.gameLoop.update(delta);

    // Apply keyboard-pan + final clamp.
    processCameraInput(this.viewState, {
      cursors: this.cursors,
      wasd: this.wasd,
      dragState: this.dragState,
    });

    const cam = this.viewState.activeView === 'surface' ? this.viewState.surfaceCamera : this.viewState.undergroundCamera;
    const worldW = this.viewState.activeView === 'surface' ? SURFACE_GRID_WIDTH : UNDERGROUND_GRID_WIDTH;
    const worldH = this.viewState.activeView === 'surface' ? SURFACE_GRID_HEIGHT : UNDERGROUND_GRID_HEIGHT;
    clampCamera(cam, worldW, worldH);

    // Draw world.
    const alpha = this.gameLoop.accumulatorMs / MS_PER_TICK;
    const gfx = this.gfx as unknown as GfxLike;
    gfx.clear();
    drawPheromoneOverlay(gfx, this.world, cam, this.viewState.activeView);
    if (this.viewState.activeView === 'surface') {
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

    // Autosave — only while actively Playing
    if (this.gamePhase === GamePhase.Playing) {
      this.lastAutosaveMs = tickAutosave(
        this.currentSeed,
        this.inputLog,
        this.world,
        this.lastAutosaveMs,
        time,
      );
    }
  }

  /** Accessor for UIScene / Plan 05 / Plan 06 — safe read-only reference. */
  getWorld(): WorldState { return this.world; }
  getViewState(): ViewState { return this.viewState; }
}
