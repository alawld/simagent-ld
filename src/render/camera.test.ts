// camera.test.ts — Vitest tests for src/render/camera.ts
//
// Tests cover:
//   - createViewState: correct initial positions, independence of camera objects
//   - toggleView (VIEW-02, §7c): X-sync, first-visit Y-center, surface Y preservation, repeat-visit
//   - clampCamera: minimum/maximum clamp on both axes, degenerate guard
//   - screenToTile: center-canvas round-trip, top-left corner, tile round-trip

import { describe, it, expect } from 'vitest';
import {
  VIEWPORT_WIDTH_TILES,
  VIEWPORT_HEIGHT_TILES,
  createViewState,
  toggleView,
  clampCamera,
  screenToTile,
} from './camera.js';
import { TILE_SIZE_PX } from './sprites.js';
import { UNDERGROUND_GRID_HEIGHT } from '../sim/constants.js';

// Convenience: default viewport camera
function makeCamera(x: number, y: number) {
  return {
    x,
    y,
    viewportWidth: VIEWPORT_WIDTH_TILES,
    viewportHeight: VIEWPORT_HEIGHT_TILES,
  };
}

// ---------------------------------------------------------------------------
// createViewState
// ---------------------------------------------------------------------------

describe('createViewState', () => {
  it('surfaceCamera starts at (startTileX, startTileY)', () => {
    const vs = createViewState(24, 64);
    expect(vs.surfaceCamera.x).toBe(24);
    expect(vs.surfaceCamera.y).toBe(64);
  });

  it('undergroundCamera starts at (startTileX, UNDERGROUND_GRID_HEIGHT/2 = 32)', () => {
    const vs = createViewState(24, 64);
    expect(vs.undergroundCamera.x).toBe(24);
    expect(vs.undergroundCamera.y).toBe(UNDERGROUND_GRID_HEIGHT / 2); // 32
  });

  it('undergroundVisited is false initially', () => {
    const vs = createViewState(24, 64);
    expect(vs.undergroundVisited).toBe(false);
  });

  it('activeView is "surface" initially', () => {
    const vs = createViewState(24, 64);
    expect(vs.activeView).toBe('surface');
  });

  it('surfaceCamera and undergroundCamera are distinct object references', () => {
    const vs = createViewState(24, 64);
    expect(vs.surfaceCamera).not.toBe(vs.undergroundCamera);
  });

  it('cameras have correct viewport dimensions', () => {
    const vs = createViewState(10, 20);
    expect(vs.surfaceCamera.viewportWidth).toBe(VIEWPORT_WIDTH_TILES);
    expect(vs.surfaceCamera.viewportHeight).toBe(VIEWPORT_HEIGHT_TILES);
    expect(vs.undergroundCamera.viewportWidth).toBe(VIEWPORT_WIDTH_TILES);
    expect(vs.undergroundCamera.viewportHeight).toBe(VIEWPORT_HEIGHT_TILES);
  });
});

// ---------------------------------------------------------------------------
// toggleView — VIEW-02, §7c
// ---------------------------------------------------------------------------

describe('toggleView', () => {
  describe('first toggle: surface → underground (first visit)', () => {
    it('undergroundCamera.x becomes surfaceCamera.x', () => {
      const vs = createViewState(24, 64);
      vs.surfaceCamera.x = 50; // change surface X to test sync
      toggleView(vs);
      expect(vs.undergroundCamera.x).toBe(50);
    });

    it('undergroundCamera.y is set to UNDERGROUND_GRID_HEIGHT/2 on first visit', () => {
      const vs = createViewState(24, 64);
      vs.undergroundCamera.y = 99; // set to something other than 32 to verify override
      toggleView(vs);
      expect(vs.undergroundCamera.y).toBe(UNDERGROUND_GRID_HEIGHT / 2); // 32
    });

    it('undergroundVisited becomes true', () => {
      const vs = createViewState(24, 64);
      toggleView(vs);
      expect(vs.undergroundVisited).toBe(true);
    });

    it('activeView becomes "underground"', () => {
      const vs = createViewState(24, 64);
      toggleView(vs);
      expect(vs.activeView).toBe('underground');
    });
  });

  describe('second toggle: underground → surface (VIEW-03: surface Y preserved)', () => {
    it('surfaceCamera.x becomes undergroundCamera.x', () => {
      const vs = createViewState(24, 64);
      toggleView(vs); // → underground
      vs.undergroundCamera.x = 77;
      toggleView(vs); // → surface
      expect(vs.surfaceCamera.x).toBe(77);
    });

    it('activeView becomes "surface"', () => {
      const vs = createViewState(24, 64);
      toggleView(vs); // → underground
      toggleView(vs); // → surface
      expect(vs.activeView).toBe('surface');
    });

    it('surfaceCamera.y is NOT changed (VIEW-03: surface Y preserved across toggles)', () => {
      const vs = createViewState(24, 64);
      const originalSurfaceY = vs.surfaceCamera.y;
      toggleView(vs); // → underground
      toggleView(vs); // → surface
      expect(vs.surfaceCamera.y).toBe(originalSurfaceY);
    });
  });

  describe('third toggle: surface → underground (already visited)', () => {
    it('undergroundCamera.y is NOT re-centered (preserves prior underground.y)', () => {
      const vs = createViewState(24, 64);
      toggleView(vs); // first visit → y set to 32, visited=true
      vs.undergroundCamera.y = 55; // change underground Y after first visit
      toggleView(vs); // → surface
      toggleView(vs); // second visit → should NOT re-center to 32
      expect(vs.undergroundCamera.y).toBe(55);
    });

    it('undergroundCamera.x still syncs from surfaceCamera.x on repeated toggle', () => {
      const vs = createViewState(24, 64);
      toggleView(vs); // → underground (first visit)
      toggleView(vs); // → surface
      vs.surfaceCamera.x = 88;
      toggleView(vs); // → underground (second visit)
      expect(vs.undergroundCamera.x).toBe(88);
    });
  });
});

// ---------------------------------------------------------------------------
// clampCamera
// ---------------------------------------------------------------------------

describe('clampCamera', () => {
  it('clamps camera too far left/up to half-viewport boundary', () => {
    const cam = makeCamera(0, 0);
    clampCamera(cam, 128, 128);
    // half-viewport: 50/2 = 25, 37/2 = 18.5
    expect(cam.x).toBe(VIEWPORT_WIDTH_TILES / 2);   // 25
    expect(cam.y).toBe(VIEWPORT_HEIGHT_TILES / 2);  // 18.5
  });

  it('clamps camera too far right/down to worldSize - half-viewport boundary', () => {
    const cam = makeCamera(200, 200);
    clampCamera(cam, 128, 128);
    // max: 128 - 25 = 103, 128 - 18.5 = 109.5
    expect(cam.x).toBe(128 - VIEWPORT_WIDTH_TILES / 2);   // 103
    expect(cam.y).toBe(128 - VIEWPORT_HEIGHT_TILES / 2);  // 109.5
  });

  it('leaves camera unchanged when within valid bounds', () => {
    const cam = makeCamera(64, 64);
    clampCamera(cam, 128, 128);
    expect(cam.x).toBe(64);
    expect(cam.y).toBe(64);
  });

  it('handles degenerate case where worldW < viewportWidth (centers X)', () => {
    const cam = makeCamera(0, 32);
    clampCamera(cam, 10, 128); // world width 10 < viewport 50
    expect(cam.x).toBe(10 / 2); // 5 = worldW/2
  });

  it('handles degenerate case where worldH < viewportHeight (centers Y)', () => {
    const cam = makeCamera(64, 0);
    clampCamera(cam, 128, 10); // world height 10 < viewport 37
    expect(cam.y).toBe(10 / 2); // 5 = worldH/2
  });
});

// ---------------------------------------------------------------------------
// screenToTile
// ---------------------------------------------------------------------------

describe('screenToTile', () => {
  it('pointer at canvas center (400, 296) with camera at world center (64, 64) returns tile (64, 64)', () => {
    // Camera center at tile (64, 64), viewport 50×37
    // cameraPixelX = (64 - 25) * 16 = 39 * 16 = 624
    // tileX = Math.floor((400 + 624) / 16) = Math.floor(1024 / 16) = 64
    // cameraPixelY = (64 - 18.5) * 16 = 45.5 * 16 = 728
    // tileY = Math.floor((296 + 728) / 16) = Math.floor(1024 / 16) = 64
    const cam = makeCamera(64, 64);
    const result = screenToTile(400, 296, cam);
    expect(result.tileX).toBe(64);
    expect(result.tileY).toBe(64);
  });

  it('pointer at (0, 0) with camera clamped to minimum (25, 18.5) returns tile (0, 0)', () => {
    // Camera center at (25, 18.5) = half-viewport clamp
    // cameraPixelX = (25 - 25) * 16 = 0
    // tileX = Math.floor((0 + 0) / 16) = 0
    // cameraPixelY = (18.5 - 18.5) * 16 = 0
    // tileY = Math.floor((0 + 0) / 16) = 0
    const cam = makeCamera(VIEWPORT_WIDTH_TILES / 2, VIEWPORT_HEIGHT_TILES / 2);
    const result = screenToTile(0, 0, cam);
    expect(result.tileX).toBe(0);
    expect(result.tileY).toBe(0);
  });

  it('round-trip: center tile pixel coordinates through screenToTile return same tile', () => {
    // For tile (tx, ty), its pixel center is:
    //   screenX = (tx - camLeft) * TILE_SIZE_PX + TILE_SIZE_PX/2
    // where camLeft = cam.x - cam.viewportWidth/2
    // After screenToTile, should recover (tx, ty)
    const cam = makeCamera(64, 64);
    const camLeft = cam.x - cam.viewportWidth / 2;
    const camTop = cam.y - cam.viewportHeight / 2;

    // Test a specific tile inside the viewport: tile (70, 70)
    const tx = 70;
    const ty = 70;
    const screenX = (tx - camLeft) * TILE_SIZE_PX;
    const screenY = (ty - camTop) * TILE_SIZE_PX;
    const result = screenToTile(screenX, screenY, cam);
    expect(result.tileX).toBe(tx);
    expect(result.tileY).toBe(ty);
  });
});
