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

export interface MountOptions {
  /**
   * Override the base path under which runtime assets are resolved. When set,
   * sprite URLs become `${assetsBase}sprites/*.svg` instead of the build-baked
   * default `${import.meta.env.BASE_URL}assets/*`.
   *
   * Use this when the bundle is served from a deploy path that differs from
   * the one passed to `vite build --base=…`, so the same bundle can be reused
   * (e.g. at `/play/assets/` or under a CDN prefix) without a rebuild.
   *
   * A trailing slash is appended if missing. Empty string or whitespace-only
   * is treated as unset and falls back to the default.
   * Default: `${import.meta.env.BASE_URL}assets/`.
   */
  assetsBase?: string;
}

export interface MountedGame {
  destroy(): void;
}

/**
 * Normalize an assetsBase value to a guaranteed trailing-slash form. Treats
 * empty string or whitespace-only as "use default" (defensive against an
 * embedder passing `assetsBase: ''` or a templated value that resolved
 * empty), and appends a trailing slash if missing so `${base}sprites/foo`
 * never silently produces `/play/assetssprites/foo` and 404s.
 */
function normalizeAssetsBase(raw: string | undefined): string {
  const fallback = `${import.meta.env.BASE_URL}assets/`;
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') return fallback;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function mount(target: HTMLElement, options?: MountOptions): MountedGame {
  const assetsBase = normalizeAssetsBase(options?.assetsBase);

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
    callbacks: {
      // preBoot fires before any scene is added or starts preload(), so the
      // registry value is available to GameScene.preload() when it builds
      // its sprite URLs.
      preBoot: (game) => {
        game.registry.set('assetsBase', assetsBase);
      },
    },
  };

  const game = new Phaser.Game(config);

  return {
    destroy() {
      game.destroy(true);
    },
  };
}
