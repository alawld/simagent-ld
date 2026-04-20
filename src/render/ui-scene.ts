// ui-scene.ts — Phase 9 UIScene: full HUD + GameOver/SavePrompt overlays.
//
// Renders per-frame: colony stats, behavior triangle widget, minimap, view-toggle button,
// and the context menu (when visible).
//
// Phase 9 Plan 06 additions:
//   - showGameOverOverlay / hideGameOverOverlay — Victory/Defeat/MutualDestruction screen
//   - showSavePromptOverlay / hideSavePromptOverlay — Continue or New Game on refresh
//   - window.__phase9_ui.activeOverlay — published for Plan 07 Playwright observability
//   - SAVE_PROMPT_CONTINUE_RECT / SAVE_PROMPT_NEW_GAME_RECT / GAME_OVER_RESTART_RECT exports
//
// Two-scene topology: UIScene runs on top of GameScene. Phaser camera for UIScene is
// non-scrolling by default, so HUD elements stay screen-fixed.
//
// IMPORTANT: setScrollFactor(0) applied to all Text objects created in create().
// Graphics objects in UIScene do not need setScrollFactor since the UIScene camera
// does not scroll (no cameras.setBounds / no camera.scrollX mutation in UIScene).
//
// See CLAUDE.md note: do NOT write JSDoc comments with double-dash dividers in production
// files that touch world fields — check-sim-boundary.sh would false-positive on FNDN-07.

import * as Phaser from 'phaser';
import type { ViewState } from './camera.js';
import { toggleView } from './camera.js';
import type { WorldState } from '../sim/types.js';
import { HUD } from './sprites.js';
import { GameOutcome } from '../sim/game-over.js';
import { formatOutcomeTitle, formatKillStatsSubtitle } from './ui-scene-logic.js';
import { PLAYER_COLONY_ID as _PLAYER_COLONY_ID } from '../sim/constants.js';

// Re-export pure helpers for Plan 07 and external consumers
export { formatOutcomeTitle, formatKillStatsSubtitle };

// ---------------------------------------------------------------------------
// Plan 07 Playwright observability contract
// ---------------------------------------------------------------------------

export type ActiveOverlay = 'none' | 'save-prompt' | 'game-over';

declare global {
  interface Window {
    __phase9_ui?: { activeOverlay: ActiveOverlay };
  }
}

/** Publishes current overlay state to window.__phase9_ui for Playwright observability.
 *  Guarded by typeof window check so Vitest (Node) contexts don't crash. */
function setActiveOverlay(next: ActiveOverlay): void {
  if (typeof window !== 'undefined') {
    window.__phase9_ui = { activeOverlay: next };
  }
}

// ---------------------------------------------------------------------------
// Overlay button rects — exported for Plan 07 Playwright coordinate-based clicks
// ---------------------------------------------------------------------------

/** Canvas-local rect for the SavePrompt "Continue" button. */
export const SAVE_PROMPT_CONTINUE_RECT = { x: 300, y: 280, w: 120, h: 32 } as const;
/** Canvas-local rect for the SavePrompt "New Game" button. */
export const SAVE_PROMPT_NEW_GAME_RECT = { x: 300, y: 320, w: 120, h: 32 } as const;
/** Canvas-local rect for the GameOver "Restart" button. */
export const GAME_OVER_RESTART_RECT    = { x: 300, y: 320, w: 120, h: 32 } as const;
import {
  createTriangleDragState,
  drawTriangle,
  screenToBarycentric,
  isInsideTriangle,
  TRIANGLE_VERTICES,
  type TriangleDragState,
} from './triangle-widget.js';
import { drawMinimap, applyMinimapClick } from './minimap.js';
import {
  contextMenuState,
  hideContextMenu,
  requestHideContextMenu,
  applyPendingContextMenuHide,
} from './context-menu-state.js';
import {
  CONTEXT_MENU_ITEMS,
  contextMenuItemAt,
  isInsideContextMenu,
  itemLabelPos,
  drawContextMenuGeometry,
} from './context-menu-layout.js';
import {
  computeHudStats,
  formatAntsLabel,
  formatFoodLabel,
  queenBarRect,
  queenHealthBarColor,
  queenHealthBarFillWidth,
  HUD_STATS_COLORS,
  HUD_STATS_LAYOUT,
} from './hud-stats.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { SetBehaviorRatioCommand, PlaceChamberCommand } from '../sim/commands.js';

// HUD-02 stats row lives entirely inside the 200x24 HUD.STATS rect so
// isPointerOverHUD() correctly masks world-input click-through. Per PRD §6c:
//   - Semi-transparent dark background (0x000000, α=0.6) fills the full rect.
//   - "Ants: N" (white) + "Food: N" (green-tinted indicator) on one 10px row.
//   - "Queen:" label + visual health bar, right-anchored inside the rect.
const STATS_ROW_Y  = HUD.STATS.y + HUD_STATS_LAYOUT.textRowYOffset;
const STATS_TEXT_X = HUD.STATS.x + 4;

export class UIScene extends Phaser.Scene {
  private viewState!: ViewState;
  private world!: WorldState;
  private gfx!: Phaser.GameObjects.Graphics;
  private antsText!: Phaser.GameObjects.Text;
  private foodText!: Phaser.GameObjects.Text;
  private queenLabelText!: Phaser.GameObjects.Text;
  private triangleLabels!: Phaser.GameObjects.Text[];
  private viewToggleText!: Phaser.GameObjects.Text;
  private contextMenuLabels!: Phaser.GameObjects.Text[];
  private dragState!: TriangleDragState;

  // Phase 9 Plan 06 — overlay groups (null = overlay not currently shown)
  private gameOverGroup: Phaser.GameObjects.GameObject[] = [];
  private savePromptGroup: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'UIScene' }); }

  init(data: { viewState: ViewState; world: WorldState }) {
    this.viewState = data.viewState;
    this.world = data.world;
  }

  create() {
    this.gfx = this.add.graphics();
    this.dragState = createTriangleDragState();

    // HUD-02 stats row — three Texts confined to the 200x24 HUD.STATS rect.
    // antsText is white; foodText is green-tinted per PRD §6c; queenLabelText
    // sits immediately to the left of the visual queen health bar (drawn in
    // update() via gfx so its color can change per frame without Text churn).
    this.antsText = this.add.text(
      STATS_TEXT_X,
      STATS_ROW_Y,
      'Ants: 0',
      { color: HUD_STATS_COLORS.antsTextCss, fontSize: '10px', fontFamily: 'monospace' },
    );
    this.antsText.setScrollFactor(0);

    this.foodText = this.add.text(
      STATS_TEXT_X,
      STATS_ROW_Y,
      'Food: 0',
      { color: HUD_STATS_COLORS.foodTextCss, fontSize: '10px', fontFamily: 'monospace' },
    );
    this.foodText.setScrollFactor(0);

    this.queenLabelText = this.add.text(
      STATS_TEXT_X,
      STATS_ROW_Y,
      'Queen:',
      { color: HUD_STATS_COLORS.queenTextCss, fontSize: '10px', fontFamily: 'monospace' },
    );
    this.queenLabelText.setScrollFactor(0);

    // Triangle vertex labels — static text, created once.
    // Phase 8.5 HUD cleanup: offsets tightened so every label renders INSIDE
    // HUD.TRIANGLE (x: [8,128), y: [456,576)). The old offsets placed text
    // above/beside the zone (e.g. Forage at y=452, Dig at x=-4) which let
    // pointer clicks on the visible text fall through to world input.
    this.triangleLabels = [
      this.add.text(
        TRIANGLE_VERTICES.forage.x - 18,
        TRIANGLE_VERTICES.forage.y - 12,
        'Forage',
        { color: '#ffffff', fontSize: '10px' },
      ),
      this.add.text(
        TRIANGLE_VERTICES.dig.x - 6,
        TRIANGLE_VERTICES.dig.y - 12,
        'Dig',
        { color: '#ffffff', fontSize: '10px' },
      ),
      this.add.text(
        TRIANGLE_VERTICES.fight.x - 28,
        TRIANGLE_VERTICES.fight.y - 12,
        'Fight',
        { color: '#ffffff', fontSize: '10px' },
      ),
    ];
    for (const label of this.triangleLabels) {
      label.setScrollFactor(0);
    }

    // View toggle button label — text updated per-frame.
    this.viewToggleText = this.add.text(
      HUD.VIEW_TOGGLE.x + 4,
      HUD.VIEW_TOGGLE.y + 6,
      'Underground >',
      { color: '#ffffff', fontSize: '12px', backgroundColor: '#333333' },
    );
    this.viewToggleText.setPadding(4);
    this.viewToggleText.setScrollFactor(0);

    // Context menu item labels — created once, positioned/shown per frame.
    // One Phaser.Text per ChamberType (Queen / Nursery / Food Storage) so the
    // player can actually read the choices instead of seeing unlabeled stripes.
    this.contextMenuLabels = CONTEXT_MENU_ITEMS.map(item => {
      const t = this.add.text(
        0,
        0,
        item.label,
        { color: '#ffffff', fontSize: '13px', fontFamily: 'monospace' },
      );
      t.setScrollFactor(0);
      t.setVisible(false);
      t.setDepth(10); // draw above the gfx stripes
      return t;
    });

    // Pointer events for HUD interactions.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Context menu takes precedence when visible. A click inside selects an
      // item; a click anywhere else dismisses the menu AND falls through so
      // the underlying HUD control still receives the click — prevents the
      // menu from lingering after unrelated HUD interactions.
      if (contextMenuState.visible) {
        if (isInsideContextMenu(
          pointer.x, pointer.y,
          contextMenuState.screenX, contextMenuState.screenY,
        )) {
          const choice = contextMenuItemAt(
            pointer.x, pointer.y,
            contextMenuState.screenX, contextMenuState.screenY,
          );
          if (choice !== null) {
            const cmd: PlaceChamberCommand = {
              type: 'PlaceChamber',
              colonyId: PLAYER_COLONY_ID,
              chamberType: choice,
              anchorTileX: contextMenuState.anchorTileX,
              anchorTileY: contextMenuState.anchorTileY,
              issuedAtTick: this.world.tick,
            };
            this.world.commandQueue.push(cmd);
          }
          requestHideContextMenu();
          return;
        }
        requestHideContextMenu();
        // fall through — process the actual HUD target. The deferred hide
        // lets any cross-scene pointerdown handler that runs after this one
        // still observe visible=true and suppress its own world-click logic.
      }

      // View toggle button
      if (this.isInsideRect(pointer.x, pointer.y, HUD.VIEW_TOGGLE)) {
        toggleView(this.viewState);
        return;
      }
      // Minimap click
      if (applyMinimapClick(this.viewState, pointer.x, pointer.y)) return;
      // Behavior triangle drag start
      if (isInsideTriangle(pointer.x, pointer.y)) {
        this.dragState.isDragging = true;
        this.dragState.targetRatio = screenToBarycentric(pointer.x, pointer.y);
        return;
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.dragState.isDragging) return;
      if (!pointer.isDown) return;
      this.dragState.targetRatio = screenToBarycentric(pointer.x, pointer.y);
    });

    // Belt-and-suspenders: clear overlay window state on scene shutdown to
    // prevent stale __phase9_ui surviving a scene restart.
    this.events.on('shutdown', () => {
      this.hideGameOverOverlay();
      this.hideSavePromptOverlay();
      setActiveOverlay('none');
    });

    this.input.on('pointerup', () => {
      if (this.dragState.isDragging) {
        // Emit exactly one SetBehaviorRatioCommand per drag session (T-08-12).
        const cmd: SetBehaviorRatioCommand = {
          type: 'SetBehaviorRatio',
          colonyId: PLAYER_COLONY_ID,
          ratio: this.dragState.targetRatio,
          issuedAtTick: this.world.tick,
        };
        this.world.commandQueue.push(cmd);
        this.dragState.isDragging = false;
      }
    });
  }

  update() {
    // Apply any pending hide from the previous frame's pointerdown dispatch
    // BEFORE reading the state, so cross-scene race conditions are resolved
    // deterministically at the frame boundary.
    applyPendingContextMenuHide();
    this.gfx.clear();

    // Guard: world may be undefined during SavePrompt phase before bootFresh/bootFromSave
    // sets GameScene.world (GameScene.create() launches UIScene before calling bootFresh).
    // Overlay lifecycle still works (setActiveOverlay is called outside update()), so
    // skip all world-dependent HUD rendering until a world is available.
    if (!this.world) return;

    // Auto-dismiss the underground context menu if the player switches away
    // from the underground view (via Tab key, toggle button, or minimap click).
    // The menu only makes sense while underground; leaving it visible on the
    // surface view would be a stale artifact.
    if (contextMenuState.visible && this.viewState.activeView !== 'underground') {
      hideContextMenu();
    }

    const colony = this.world.colonies[PLAYER_COLONY_ID];

    // HUD-02 stats bar per PRD §6c:
    //   - semi-transparent dark background over the full 200x24 rect
    //   - "Ants: N" white text, "Food: N" green-tinted text, "Queen:" label
    //   - visual queen-health bar right-anchored inside the rect, color by pct
    this.gfx.fillStyle(HUD_STATS_COLORS.background, HUD_STATS_COLORS.backgroundAlpha);
    this.gfx.fillRect(HUD.STATS.x, HUD.STATS.y, HUD.STATS.w, HUD.STATS.h);

    if (colony) {
      const s = computeHudStats(this.world, colony);
      this.antsText.setText(formatAntsLabel(s));
      this.foodText.setText(formatFoodLabel(s));

      // Layout: antsText stays at left margin; foodText follows with a
      // two-space gap; queenLabel + bar right-anchor inside HUD.STATS.
      const bar = queenBarRect(HUD.STATS);

      this.foodText.setPosition(this.antsText.x + this.antsText.width + 8, STATS_ROW_Y);

      const queenLabelX = bar.x - this.queenLabelText.width - 4;
      this.queenLabelText.setPosition(queenLabelX, STATS_ROW_Y);

      // Queen health bar — track + proportional fill.
      this.gfx.fillStyle(HUD_STATS_COLORS.barTrack, 1);
      this.gfx.fillRect(bar.x, bar.y, bar.w, bar.h);
      const fillW = queenHealthBarFillWidth(s, bar.w);
      if (fillW > 0) {
        this.gfx.fillStyle(queenHealthBarColor(s), 1);
        this.gfx.fillRect(bar.x, bar.y, fillW, bar.h);
      }
    }

    // Behavior triangle widget
    if (colony) {
      const total = colony.taskCensus.nurse
                  + colony.taskCensus.forage
                  + colony.taskCensus.dig
                  + colony.taskCensus.fight;
      const currentRatio = total > 0
        ? {
            forage: Math.round(colony.taskCensus.forage * 100 / total),
            dig:    Math.round(colony.taskCensus.dig    * 100 / total),
            fight:  Math.round(colony.taskCensus.fight  * 100 / total),
          }
        : { forage: 100, dig: 0, fight: 0 };
      const targetRatio = this.dragState.isDragging
        ? this.dragState.targetRatio
        : colony.targetRatio;
      drawTriangle(this.gfx as unknown as import('./draw-surface.js').GfxLike, currentRatio, targetRatio);
    }

    // Minimap
    drawMinimap(this.gfx as unknown as import('./draw-surface.js').GfxLike, this.world, this.viewState);

    // View toggle button background
    this.gfx.fillStyle(0x333333, 1);
    this.gfx.fillRect(HUD.VIEW_TOGGLE.x, HUD.VIEW_TOGGLE.y, HUD.VIEW_TOGGLE.w, HUD.VIEW_TOGGLE.h);
    this.viewToggleText.setText(
      this.viewState.activeView === 'surface' ? 'Underground >' : '< Surface',
    );

    // Context menu (drawn last so it appears on top of other HUD elements)
    if (contextMenuState.visible) {
      drawContextMenuGeometry(
        this.gfx as unknown as import('./draw-surface.js').GfxLike,
        contextMenuState.screenX,
        contextMenuState.screenY,
      );
      for (let i = 0; i < this.contextMenuLabels.length; i++) {
        const label = this.contextMenuLabels[i]!;
        const pos = itemLabelPos(i, contextMenuState.screenX, contextMenuState.screenY);
        label.setPosition(pos.x, pos.y);
        label.setVisible(true);
      }
    } else {
      for (const label of this.contextMenuLabels) {
        label.setVisible(false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 9 Plan 06 — GameOver overlay
  // ---------------------------------------------------------------------------

  public showGameOverOverlay(outcome: GameOutcome, onRestart: () => void): void {
    this.hideGameOverOverlay(); // clear any prior instance first

    const W = 800;
    const H = 592;

    // Semi-transparent background — input-blocking to absorb clicks behind overlay.
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6);
    bg.setInteractive();
    bg.setDepth(20);

    const { text: titleText, color: titleColor } = formatOutcomeTitle(outcome);
    const title = this.add.text(W / 2, H / 2 - 60, titleText, {
      fontSize: '40px',
      fontFamily: 'monospace',
      color: '#' + titleColor.toString(16).padStart(6, '0'),
    });
    title.setOrigin(0.5);
    title.setDepth(21);

    // Kill stats subtitle — read via plain-object bracket access (ADR-0006)
    const playerColony = this.world.colonies[_PLAYER_COLONY_ID];
    const killCount = playerColony?.killCount ?? 0;
    const subtitle = this.add.text(W / 2, H / 2 - 10, formatKillStatsSubtitle(killCount), {
      fontSize: '18px',
      fontFamily: 'monospace',
      color: '#cccccc',
    });
    subtitle.setOrigin(0.5);
    subtitle.setDepth(21);

    // Restart button
    const btnR = GAME_OVER_RESTART_RECT;
    const btnBg = this.add.rectangle(
      btnR.x + btnR.w / 2, btnR.y + btnR.h / 2,
      btnR.w, btnR.h,
      0x444444, 1,
    );
    btnBg.setInteractive();
    btnBg.setDepth(21);
    btnBg.on('pointerdown', () => {
      onRestart();
    });

    const btnLabel = this.add.text(btnR.x + btnR.w / 2, btnR.y + btnR.h / 2, 'Restart', {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#ffffff',
    });
    btnLabel.setOrigin(0.5);
    btnLabel.setDepth(22);

    this.gameOverGroup = [bg, title, subtitle, btnBg, btnLabel];
    setActiveOverlay('game-over');
  }

  public hideGameOverOverlay(): void {
    for (const obj of this.gameOverGroup) obj.destroy();
    this.gameOverGroup = [];
    setActiveOverlay('none');
  }

  // ---------------------------------------------------------------------------
  // Phase 9 Plan 06 — SavePrompt overlay
  // ---------------------------------------------------------------------------

  public showSavePromptOverlay(callbacks: { onContinue: () => void; onNewGame: () => void }): void {
    this.hideSavePromptOverlay(); // clear any prior instance first

    const W = 800;
    const H = 592;

    // Semi-transparent background
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7);
    bg.setInteractive();
    bg.setDepth(20);

    const title = this.add.text(W / 2, H / 2 - 80, 'Resume saved game?', {
      fontSize: '28px',
      fontFamily: 'monospace',
      color: '#ffffff',
    });
    title.setOrigin(0.5);
    title.setDepth(21);

    const subtitle = this.add.text(W / 2, H / 2 - 40, 'Found a previous session. Continue or start new?', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: '#aaaaaa',
    });
    subtitle.setOrigin(0.5);
    subtitle.setDepth(21);

    // Continue button
    const contR = SAVE_PROMPT_CONTINUE_RECT;
    const contBg = this.add.rectangle(
      contR.x + contR.w / 2, contR.y + contR.h / 2,
      contR.w, contR.h,
      0x226622, 1,
    );
    contBg.setInteractive();
    contBg.setDepth(21);
    contBg.on('pointerdown', () => {
      this.hideSavePromptOverlay();
      callbacks.onContinue();
    });

    const contLabel = this.add.text(contR.x + contR.w / 2, contR.y + contR.h / 2, 'Continue', {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#ffffff',
    });
    contLabel.setOrigin(0.5);
    contLabel.setDepth(22);

    // New Game button
    const ngR = SAVE_PROMPT_NEW_GAME_RECT;
    const ngBg = this.add.rectangle(
      ngR.x + ngR.w / 2, ngR.y + ngR.h / 2,
      ngR.w, ngR.h,
      0x662222, 1,
    );
    ngBg.setInteractive();
    ngBg.setDepth(21);
    ngBg.on('pointerdown', () => {
      this.hideSavePromptOverlay();
      callbacks.onNewGame();
    });

    const ngLabel = this.add.text(ngR.x + ngR.w / 2, ngR.y + ngR.h / 2, 'New Game', {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#ffffff',
    });
    ngLabel.setOrigin(0.5);
    ngLabel.setDepth(22);

    this.savePromptGroup = [bg, title, subtitle, contBg, contLabel, ngBg, ngLabel];
    setActiveOverlay('save-prompt');
  }

  public hideSavePromptOverlay(): void {
    for (const obj of this.savePromptGroup) obj.destroy();
    this.savePromptGroup = [];
    setActiveOverlay('none');
  }

  private isInsideRect(
    px: number,
    py: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }
}
