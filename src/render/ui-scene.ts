// ui-scene.ts — Phase 8 UIScene: full HUD implementation.
//
// Renders per-frame: colony stats, behavior triangle widget, minimap, view-toggle button,
// and the context menu (when visible).
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
import { computeHudStats, formatStatsPrefix } from './hud-stats.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { SetBehaviorRatioCommand, PlaceChamberCommand } from '../sim/commands.js';

// HUD-02 stats row lives entirely inside the 200x24 HUD.STATS rect so
// isPointerOverHUD() correctly masks drag-pan / world-input click-through.
// Two Texts on one 10px row: "Ants: N  Food: N  Queen:" (white) + "N%"/"DEAD"
// (color-coded by queen health). The 10px font keeps the full line under 200px
// even for typical POC counts.
const STATS_ROW_Y   = HUD.STATS.y + 6;
const STATS_TEXT_X  = HUD.STATS.x + 4;

export class UIScene extends Phaser.Scene {
  private viewState!: ViewState;
  private world!: WorldState;
  private gfx!: Phaser.GameObjects.Graphics;
  private statsText!: Phaser.GameObjects.Text;
  private queenPctText!: Phaser.GameObjects.Text;
  private triangleLabels!: Phaser.GameObjects.Text[];
  private viewToggleText!: Phaser.GameObjects.Text;
  private contextMenuLabels!: Phaser.GameObjects.Text[];
  private dragState!: TriangleDragState;

  constructor() { super({ key: 'UIScene' }); }

  init(data: { viewState: ViewState; world: WorldState }) {
    this.viewState = data.viewState;
    this.world = data.world;
  }

  create() {
    this.gfx = this.add.graphics();
    this.dragState = createTriangleDragState();

    // HUD-02 stats row — both Texts confined to the 200x24 HUD.STATS rect.
    this.statsText = this.add.text(
      STATS_TEXT_X,
      STATS_ROW_Y,
      'Ants: 0  Food: 0  Queen:',
      { color: '#ffffff', fontSize: '10px', fontFamily: 'monospace' },
    );
    this.statsText.setScrollFactor(0);

    this.queenPctText = this.add.text(
      STATS_TEXT_X,
      STATS_ROW_Y,
      '100%',
      { color: '#22bb44', fontSize: '10px', fontFamily: 'monospace' },
    );
    this.queenPctText.setScrollFactor(0);

    // Triangle vertex labels — static text, created once.
    this.triangleLabels = [
      this.add.text(
        TRIANGLE_VERTICES.forage.x - 20,
        TRIANGLE_VERTICES.forage.y - 16,
        'Forage',
        { color: '#ffffff', fontSize: '10px' },
      ),
      this.add.text(
        TRIANGLE_VERTICES.dig.x - 20,
        TRIANGLE_VERTICES.dig.y + 4,
        'Dig',
        { color: '#ffffff', fontSize: '10px' },
      ),
      this.add.text(
        TRIANGLE_VERTICES.fight.x - 4,
        TRIANGLE_VERTICES.fight.y + 4,
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

    // Auto-dismiss the underground context menu if the player switches away
    // from the underground view (via Tab key, toggle button, or minimap click).
    // The menu only makes sense while underground; leaving it visible on the
    // surface view would be a stale artifact.
    if (contextMenuState.visible && this.viewState.activeView !== 'underground') {
      hideContextMenu();
    }

    const colony = this.world.colonies[PLAYER_COLONY_ID];

    // HUD-02 stats row — both Texts confined inside the 200x24 HUD.STATS
    // rect so isPointerOverHUD() correctly suppresses world-input
    // click-through. queenPctText right edge is clamped to the HUD.STATS
    // right edge regardless of font-metric variation across browsers.
    if (colony) {
      const s = computeHudStats(this.world, colony);
      this.statsText.setText(`${formatStatsPrefix(s)}  Queen:`);
      this.queenPctText.setText(s.queenAlive ? `${s.queenHealthPct}%` : 'DEAD');
      const pctColor = !s.queenAlive ? '#cc3322'
        : s.queenHealthPct > 60 ? '#22bb44' // green  — healthy
        : s.queenHealthPct > 30 ? '#ddaa22' // amber  — warning
        : '#cc3322';                         // red    — critical / dead
      this.queenPctText.setColor(pctColor);

      const naturalX = this.statsText.x + this.statsText.width + 4;
      const maxX     = HUD.STATS.x + HUD.STATS.w - this.queenPctText.width;
      this.queenPctText.setPosition(Math.min(naturalX, maxX), STATS_ROW_Y);
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

  private isInsideRect(
    px: number,
    py: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }
}
