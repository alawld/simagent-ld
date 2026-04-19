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

  private isInsideRect(
    px: number,
    py: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }
}
