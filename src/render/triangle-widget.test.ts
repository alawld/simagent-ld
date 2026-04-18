// triangle-widget.test.ts — Vitest unit tests for triangle-widget.ts pure math.
//
// Tests run under Node (no Phaser). MockGfx pattern from draw-surface tests.

import { describe, it, expect } from 'vitest';
import {
  TRIANGLE_VERTICES,
  screenToBarycentric,
  ratioToScreenPos,
  isInsideTriangle,
  createTriangleDragState,
} from './triangle-widget.js';

// ---------------------------------------------------------------------------
// screenToBarycentric — vertex round-trips
// ---------------------------------------------------------------------------

describe('screenToBarycentric — vertex identity', () => {
  it('forage vertex returns forage=100, dig=0, fight=0', () => {
    const r = screenToBarycentric(TRIANGLE_VERTICES.forage.x, TRIANGLE_VERTICES.forage.y);
    expect(r.forage).toBe(100);
    expect(r.dig).toBe(0);
    expect(r.fight).toBe(0);
  });

  it('dig vertex returns dig=100, forage=0, fight=0', () => {
    const r = screenToBarycentric(TRIANGLE_VERTICES.dig.x, TRIANGLE_VERTICES.dig.y);
    expect(r.forage).toBe(0);
    expect(r.dig).toBe(100);
    expect(r.fight).toBe(0);
  });

  it('fight vertex returns fight=100, forage=0, dig=0', () => {
    const r = screenToBarycentric(TRIANGLE_VERTICES.fight.x, TRIANGLE_VERTICES.fight.y);
    expect(r.forage).toBe(0);
    expect(r.dig).toBe(0);
    expect(r.fight).toBe(100);
  });
});

describe('screenToBarycentric — centroid', () => {
  it('centroid returns forage=33, dig=33, fight=34 (sum=100)', () => {
    const cx = (TRIANGLE_VERTICES.forage.x + TRIANGLE_VERTICES.dig.x + TRIANGLE_VERTICES.fight.x) / 3;
    const cy = (TRIANGLE_VERTICES.forage.y + TRIANGLE_VERTICES.dig.y + TRIANGLE_VERTICES.fight.y) / 3;
    const r = screenToBarycentric(cx, cy);
    // fight = 100 - forage - dig, so the split may be 33/33/34 or 34/33/33 depending on rounding.
    expect(r.forage + r.dig + r.fight).toBe(100);
    // Each field should be close to 33 (within 2 due to integer rounding).
    expect(r.forage).toBeGreaterThanOrEqual(32);
    expect(r.forage).toBeLessThanOrEqual(35);
    expect(r.dig).toBeGreaterThanOrEqual(32);
    expect(r.dig).toBeLessThanOrEqual(35);
    expect(r.fight).toBeGreaterThanOrEqual(32);
    expect(r.fight).toBeLessThanOrEqual(35);
  });
});

// ---------------------------------------------------------------------------
// ratioToScreenPos — vertex identity
// ---------------------------------------------------------------------------

describe('ratioToScreenPos — vertex identity', () => {
  it('forage=100 returns forage vertex coords', () => {
    const pos = ratioToScreenPos({ forage: 100, dig: 0, fight: 0 });
    expect(pos.x).toBeCloseTo(TRIANGLE_VERTICES.forage.x, 5);
    expect(pos.y).toBeCloseTo(TRIANGLE_VERTICES.forage.y, 5);
  });

  it('forage=50, dig=50, fight=0 returns midpoint of forage-dig edge', () => {
    const mid = {
      x: (TRIANGLE_VERTICES.forage.x + TRIANGLE_VERTICES.dig.x) / 2,
      y: (TRIANGLE_VERTICES.forage.y + TRIANGLE_VERTICES.dig.y) / 2,
    };
    const pos = ratioToScreenPos({ forage: 50, dig: 50, fight: 0 });
    expect(pos.x).toBeCloseTo(mid.x, 5);
    expect(pos.y).toBeCloseTo(mid.y, 5);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: screenToBarycentric(ratioToScreenPos(R)) ≈ R
// ---------------------------------------------------------------------------

describe('round-trip within 1-unit tolerance', () => {
  it('{forage:40, dig:30, fight:30} round-trips within 1 unit', () => {
    const R = { forage: 40, dig: 30, fight: 30 };
    const pos = ratioToScreenPos(R);
    const R2 = screenToBarycentric(pos.x, pos.y);
    expect(Math.abs(R2.forage - R.forage)).toBeLessThanOrEqual(1);
    expect(Math.abs(R2.dig    - R.dig   )).toBeLessThanOrEqual(1);
    expect(Math.abs(R2.fight  - R.fight )).toBeLessThanOrEqual(1);
    expect(R2.forage + R2.dig + R2.fight).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// isInsideTriangle
// ---------------------------------------------------------------------------

describe('isInsideTriangle', () => {
  it('centroid is inside', () => {
    const cx = (TRIANGLE_VERTICES.forage.x + TRIANGLE_VERTICES.dig.x + TRIANGLE_VERTICES.fight.x) / 3;
    const cy = (TRIANGLE_VERTICES.forage.y + TRIANGLE_VERTICES.dig.y + TRIANGLE_VERTICES.fight.y) / 3;
    expect(isInsideTriangle(cx, cy)).toBe(true);
  });

  it('point above forage vertex is outside', () => {
    expect(isInsideTriangle(TRIANGLE_VERTICES.forage.x, TRIANGLE_VERTICES.forage.y - 10)).toBe(false);
  });

  it('point below baseline is outside', () => {
    expect(isInsideTriangle(TRIANGLE_VERTICES.dig.x, TRIANGLE_VERTICES.dig.y + 10)).toBe(false);
  });

  it('forage vertex is on boundary (inside by inclusive test)', () => {
    expect(isInsideTriangle(TRIANGLE_VERTICES.forage.x, TRIANGLE_VERTICES.forage.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sum invariant — all outputs must sum to 100
// ---------------------------------------------------------------------------

describe('sum invariant: forage+dig+fight === 100', () => {
  const testPoints = [
    [TRIANGLE_VERTICES.forage.x, TRIANGLE_VERTICES.forage.y],
    [TRIANGLE_VERTICES.dig.x,    TRIANGLE_VERTICES.dig.y   ],
    [TRIANGLE_VERTICES.fight.x,  TRIANGLE_VERTICES.fight.y ],
    [68, 510],  // interior point
    [50, 490],  // another interior point
  ];
  for (const [px, py] of testPoints) {
    it(`sum=100 at (${px!.toFixed(1)}, ${py!.toFixed(1)})`, () => {
      const r = screenToBarycentric(px!, py!);
      expect(r.forage + r.dig + r.fight).toBe(100);
    });
  }
});

// ---------------------------------------------------------------------------
// Clamp: drag far outside triangle returns valid ratio summing to 100
// ---------------------------------------------------------------------------

describe('clamp: out-of-triangle drag', () => {
  it('x=1000, y=1000 returns valid ratio summing to 100 with all fields >= 0', () => {
    const r = screenToBarycentric(1000, 1000);
    expect(r.forage).toBeGreaterThanOrEqual(0);
    expect(r.dig).toBeGreaterThanOrEqual(0);
    expect(r.fight).toBeGreaterThanOrEqual(0);
    expect(r.forage + r.dig + r.fight).toBe(100);
  });

  it('x=0, y=0 (far above triangle) returns valid ratio summing to 100', () => {
    const r = screenToBarycentric(0, 0);
    expect(r.forage).toBeGreaterThanOrEqual(0);
    expect(r.dig).toBeGreaterThanOrEqual(0);
    expect(r.fight).toBeGreaterThanOrEqual(0);
    expect(r.forage + r.dig + r.fight).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// createTriangleDragState
// ---------------------------------------------------------------------------

describe('createTriangleDragState', () => {
  it('returns isDragging=false with forage=100 default', () => {
    const s = createTriangleDragState();
    expect(s.isDragging).toBe(false);
    expect(s.targetRatio).toEqual({ forage: 100, dig: 0, fight: 0 });
  });
});
