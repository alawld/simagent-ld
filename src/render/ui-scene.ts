// ui-scene.ts — Phase 8 UIScene stub.
//
// Full HUD body lands in Plan 05. This stub exists so GameScene can launch UIScene
// without errors and visually confirm the scene is running.
//
// setScrollFactor(0) is applied to all children so HUD elements stay fixed
// relative to the screen even when the world camera scrolls.

import * as Phaser from 'phaser';
import type { ViewState } from './camera.js';
import type { WorldState } from '../sim/types.js';

export class UIScene extends Phaser.Scene {
  private viewState!: ViewState;
  private world!: WorldState;

  constructor() { super({ key: 'UIScene' }); }

  init(data: { viewState: ViewState; world: WorldState }) {
    this.viewState = data.viewState;
    this.world = data.world;
  }

  create() {
    // Plan 05 fills this with stats, triangle, minimap, view-toggle button.
    // For now, just a text marker so we can visually confirm UIScene is launched.
    const label = this.add.text(8, 8, 'HUD (Plan 05 stub)', { color: '#ffffff', fontSize: '12px' });
    label.setScrollFactor(0);
  }

  update() {
    // Plan 05: per-frame HUD updates
    void this.viewState;
    void this.world;
  }
}
