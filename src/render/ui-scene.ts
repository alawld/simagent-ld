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
import { contextMenuState, hideContextMenu } from './context-menu-state.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import { ChamberType } from '../sim/enums.js';
import type { SetBehaviorRatioCommand, PlaceChamberCommand } from '../sim/commands.js';

export class UIScene extends Phaser.Scene {
  private viewState!: ViewState;
  private world!: WorldState;
  private gfx!: Phaser.GameObjects.Graphics;
  private statsText!: Phaser.GameObjects.Text;
  private triangleLabels!: Phaser.GameObjects.Text[];
  private viewToggleText!: Phaser.GameObjects.Text;
  private dragState!: TriangleDragState;

  constructor() { super({ key: 'UIScene' }); }

  init(data: { viewState: ViewState; world: WorldState }) {
    this.viewState = data.viewState;
    this.world = data.world;
  }

  create() {
    this.gfx = this.add.graphics();
    this.dragState = createTriangleDragState();

    // Stats text — updates each frame via setText; created once here.
    this.statsText = this.add.text(
      HUD.STATS.x,
      HUD.STATS.y,
      'Ants: 0  Food: 0  Queen: 100',
      { color: '#ffffff', fontSize: '14px', fontFamily: 'monospace' },
    );
    this.statsText.setScrollFactor(0);

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

    // Pointer events for HUD interactions.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
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
      // Context menu selection or dismiss
      if (contextMenuState.visible) {
        if (this.isInsideContextMenu(pointer.x, pointer.y)) {
          const choice = this.contextMenuItemAt(pointer.x, pointer.y);
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
        }
        hideContextMenu();
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
    this.gfx.clear();

    const colony = this.world.colonies[PLAYER_COLONY_ID];

    // Stats bar
    if (colony) {
      const foodDisplay = colony.foodStored >> 8; // FP_SHIFT=8: convert from fixed-point to human units
      this.statsText.setText(
        `Ants: ${colony.workerCount}  Food: ${foodDisplay}  Queen: ${colony.queenStarvationTimer}`,
      );
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
      this.drawContextMenu();
    }
  }

  private drawContextMenu(): void {
    const MENU_W = 120;
    const ITEM_H = 24;
    const ITEM_COUNT = 3;
    // Semi-transparent dark background
    this.gfx.fillStyle(0x222222, 0.95);
    this.gfx.fillRect(
      contextMenuState.screenX,
      contextMenuState.screenY,
      MENU_W,
      ITEM_H * ITEM_COUNT,
    );
    // Colored stripe per item to differentiate choices visually (Phase 8 simplicity).
    // Phase 9 may add Phaser.GameObjects.Text children for full text labels.
    const stripColors = [0x4a1a4a, 0x1a4a1a, 0x4a3a1a]; // Queen, Nursery, Food
    for (let i = 0; i < ITEM_COUNT; i++) {
      this.gfx.fillStyle(stripColors[i]!, 1);
      this.gfx.fillRect(
        contextMenuState.screenX + 2,
        contextMenuState.screenY + i * ITEM_H + 2,
        MENU_W - 4,
        ITEM_H - 4,
      );
    }
  }

  private contextMenuItemAt(px: number, py: number): ChamberType | null {
    const ITEM_H = 24;
    const relY = py - contextMenuState.screenY;
    if (relY < 0 || relY >= ITEM_H * 3) return null;
    const idx = Math.floor(relY / ITEM_H);
    // Ordered: 0=Queen, 1=Nursery, 2=FoodStorage (T-08-13: only valid ChamberType values)
    const choices: ChamberType[] = [
      ChamberType.Queen,
      ChamberType.Nursery,
      ChamberType.FoodStorage,
    ];
    return choices[idx] ?? null;
  }

  private isInsideContextMenu(px: number, py: number): boolean {
    const MENU_W = 120;
    const MENU_H = 72; // 3 items x 24px
    return (
      px >= contextMenuState.screenX &&
      px < contextMenuState.screenX + MENU_W &&
      py >= contextMenuState.screenY &&
      py < contextMenuState.screenY + MENU_H
    );
  }

  private isInsideRect(
    px: number,
    py: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }
}
