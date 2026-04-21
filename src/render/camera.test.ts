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
  resetViewState,
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
// resetViewState — Phase 9 session reset
// ---------------------------------------------------------------------------

describe('resetViewState', () => {
  it('restores activeView to "surface" regardless of prior view', () => {
    const vs = createViewState(10, 10);
    vs.activeView = 'underground';
    resetViewState(vs, 24, 64);
    expect(vs.activeView).toBe('surface');
  });

  it('rebinds surfaceCamera center to the given start tile', () => {
    const vs = createViewState(10, 10);
    vs.surfaceCamera.x = 999;
    vs.surfaceCamera.y = 999;
    resetViewState(vs, 24, 64);
    expect(vs.surfaceCamera.x).toBe(24);
    expect(vs.surfaceCamera.y).toBe(64);
  });

  it('rebinds undergroundCamera to (start, UNDERGROUND_GRID_HEIGHT/2)', () => {
    const vs = createViewState(10, 10);
    vs.undergroundCamera.x = 999;
    vs.undergroundCamera.y = 999;
    resetViewState(vs, 24, 64);
    expect(vs.undergroundCamera.x).toBe(24);
    expect(vs.undergroundCamera.y).toBe(UNDERGROUND_GRID_HEIGHT / 2);
  });

  it('clears undergroundVisited so the next toggle re-centers Y', () => {
    const vs = createViewState(24, 64);
    toggleView(vs); // → underground, visited=true
    toggleView(vs); // → surface
    expect(vs.undergroundVisited).toBe(true);
    resetViewState(vs, 24, 64);
    expect(vs.undergroundVisited).toBe(false);
    // Next underground toggle should re-center Y (first-visit semantics).
    vs.undergroundCamera.y = 5;
    toggleView(vs);
    expect(vs.undergroundCamera.y).toBe(UNDERGROUND_GRID_HEIGHT / 2);
  });

  it('preserves the ViewState object identity (mutates in place)', () => {
    // Critical invariant: UIScene + input handlers capture this reference in
    // create(). A reassigned object would strand those references on the old.
    const vs = createViewState(10, 10);
    const surfaceCamRef = vs.surfaceCamera;
    const undergroundCamRef = vs.undergroundCamera;
    resetViewState(vs, 24, 64);
    expect(vs.surfaceCamera).toBe(surfaceCamRef);
    expect(vs.undergroundCamera).toBe(undergroundCamRef);
  });

  it('restores viewport dimensions to canonical defaults', () => {
    const vs = createViewState(10, 10);
    vs.surfaceCamera.viewportWidth = 99;
    vs.surfaceCamera.viewportHeight = 99;
    vs.undergroundCamera.viewportWidth = 99;
    vs.undergroundCamera.viewportHeight = 99;
    resetViewState(vs, 24, 64);
    expect(vs.surfaceCamera.viewportWidth).toBe(VIEWPORT_WIDTH_TILES);
    expect(vs.surfaceCamera.viewportHeight).toBe(VIEWPORT_HEIGHT_TILES);
    expect(vs.undergroundCamera.viewportWidth).toBe(VIEWPORT_WIDTH_TILES);
    expect(vs.undergroundCamera.viewportHeight).toBe(VIEWPORT_HEIGHT_TILES);
  });

  it('restart simulation: mid-game underground pan does not leak into fresh session', () => {
    const vs = createViewState(24, 64);
    toggleView(vs); // underground
    vs.undergroundCamera.x = 100;
    vs.undergroundCamera.y = 40;
    vs.surfaceCamera.x = 80;
    resetViewState(vs, 24, 64);
    expect(vs.activeView).toBe('surface');
    expect(vs.surfaceCamera.x).toBe(24);
    expect(vs.surfaceCamera.y).toBe(64);
    expect(vs.undergroundCamera.x).toBe(24);
    expect(vs.undergroundCamera.y).toBe(UNDERGROUND_GRID_HEIGHT / 2);
    expect(vs.undergroundVisited).toBe(false);
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
  it('pointer at canvas center (400, 296) with camera at world center (64, 64) returns the tile the renderer drew there', () => {
    // Camera center at tile (64, 64), viewport 50×37.
    //   Horizontal: cam.x=64, vw/2=25 (integer) → left = 64-25 = 39
    //     tileX = floor(400/16) + 39 = 25 + 39 = 64
    //   Vertical:   cam.y=64, vh/2=18.5 (fractional) → top = floor(45.5) = 45
    //     tileY = floor(296/16) + 45 = 18 + 45 = 63
    // The odd viewport height means the renderer draws tile 63 at screen
    // y=288..303, so a click at y=296 hits tile 63 — not 64.
    const cam = makeCamera(64, 64);
    const result = screenToTile(400, 296, cam);
    expect(result.tileX).toBe(64);
    expect(result.tileY).toBe(63);
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

  it('round-trip: tile pixel coordinates through screenToTile return same tile', () => {
    // For tile (tx, ty), the top-left pixel the renderer draws it at is:
    //   screenX = (tx - camLeft) * TILE_SIZE_PX
    // where camLeft = Math.floor(cam.x - cam.viewportWidth/2) — the
    // integer-tile snap the renderer applies. screenToTile mirrors that
    // floor, so any pixel inside the drawn tile must round-trip to (tx, ty).
    const cam = makeCamera(64, 64);
    const camLeft = Math.floor(cam.x - cam.viewportWidth / 2);
    const camTop = Math.floor(cam.y - cam.viewportHeight / 2);

    // Test a specific tile inside the viewport: tile (70, 70)
    const tx = 70;
    const ty = 70;
    const screenX = (tx - camLeft) * TILE_SIZE_PX;
    const screenY = (ty - camTop) * TILE_SIZE_PX;
    const result = screenToTile(screenX, screenY, cam);
    expect(result.tileX).toBe(tx);
    expect(result.tileY).toBe(ty);
  });

  it('fractional camera: clicks anywhere in a rendered tile resolve to that tile', () => {
    // Regression: drag-pan and the 0.5-tile keyboard scroll leave cam.x
    // fractional. The renderer snaps its tile offset with Math.floor(cam.x -
    // viewportWidth/2), so visible tiles are integer-aligned. If screenToTile
    // used the raw fractional camera instead, the tile it reports drifts up
    // to a full tile away from what the player sees — which is why food-pile
    // clicks only worked near the center of the drawn mark.
    const cam = makeCamera(64.3, 64.7); // mid-pan / mid-scroll
    const left = Math.floor(cam.x - cam.viewportWidth / 2); // renderer's floor
    const top = Math.floor(cam.y - cam.viewportHeight / 2);

    // Tile (70, 70) is drawn spanning screen px [(70-left)*16, (70-left+1)*16)
    // horizontally — every click inside that span must resolve to tileX=70.
    const tx = 70;
    const ty = 70;
    const tileLeftPx = (tx - left) * TILE_SIZE_PX;
    const tileTopPx = (ty - top) * TILE_SIZE_PX;

    // Four corners + center of the drawn tile all map to (70, 70)
    for (const [dx, dy] of [[0, 0], [15, 0], [0, 15], [15, 15], [8, 8]]) {
      const r = screenToTile(tileLeftPx + dx!, tileTopPx + dy!, cam);
      expect(r.tileX).toBe(tx);
      expect(r.tileY).toBe(ty);
    }
  });
});
