// main.ts — Phaser.Game bootstrap entry point.
//
// Registers GameScene (world rendering + game loop) and UIScene (HUD stub, Plan 05 fills it).
// Fixed-pixel canvas: 800×592 with scale.mode = NONE to avoid DPR distortion (Pitfall 3).

import * as Phaser from 'phaser';
import { GameScene } from './render/game-scene.js';
import { UIScene } from './render/ui-scene.js';
import { CANVAS_W, CANVAS_H } from './render/sprites.js';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: CANVAS_W,
  height: CANVAS_H,
  backgroundColor: '#000000',
  parent: 'game-container',
  // Pitfall 3 — fixed-pixel canvas, no DPR scaling
  scale: {
    mode: Phaser.Scale.NONE,
    width: CANVAS_W,
    height: CANVAS_H,
  },
  scene: [GameScene, UIScene],
};

new Phaser.Game(config);
