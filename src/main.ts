// main.ts — Phaser.Game bootstrap entry point.
//
// Exports a stable mount(target, options?) API so the game can be embedded
// inside arbitrary host pages (e.g. an Astro page on the public website)
// while the standalone index.html remains a thin caller of the same API.
//
// Render-layer entry only — the sim/render boundary is preserved (no
// src/sim/ imports, no mutation of WorldState from here).

import * as Phaser from 'phaser';
import { GameScene } from './render/game-scene.js';
import { UIScene } from './render/ui-scene.js';
import { CANVAS_W, CANVAS_H } from './render/sprites.js';

// Reserved for future mount-time flags (muteAudio, initialScene, etc.).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MountOptions {}

export interface MountedGame {
  destroy(): void;
}

export function mount(target: HTMLElement, options?: MountOptions): MountedGame {
  void options;

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: '#000000',
    parent: target,
    // Pitfall 3 — logical resolution stays fixed at CANVAS_W×CANVAS_H so
    // game pixels are not DPR-distorted. Phaser.Scale.FIT scales only the
    // canvas's CSS box to fill the parent while preserving aspect ratio,
    // so embedders can mount into containers of any size.
    scale: {
      mode: Phaser.Scale.FIT,
      width: CANVAS_W,
      height: CANVAS_H,
    },
    scene: [GameScene, UIScene],
  };

  const game = new Phaser.Game(config);

  return {
    destroy() {
      game.destroy(true);
    },
  };
}
