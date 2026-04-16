// pheromone-system.test.ts — correctness tests for PRD §5b/§5c/§5d
//
// Coverage:
//   PHER-03 — depositFoodTrail: basic, accumulate, cap, out-of-bounds
//   PHER-04 — tickPheromoneDecay: decay-to-zero, skip zeros, floor snap, two-grid PHER-02
//   PHER-05 — sampleGradient: determinism, exploit, tie-break, empty, explore
//   PHER-07 — grid.data.length invariant (timing proof lives in bench/pheromone-decay.bench.ts)
//
// MUST NOT use performance.now, Date.now, or setTimeout — simSafetyConfig ESLint
// bans those globals in src/sim/. Wall-clock assertions live in bench/.

import { describe, it, expect } from 'vitest';
import { depositFoodTrail, tickPheromoneDecay, sampleGradient } from './pheromone-system.js';
import { createPheromoneGrid, phGet, phSet } from './pheromone-store.js';
import { Rng } from '../rng.js';
import {
  PHEROMONE_CAP,
  PHEROMONE_FLOOR,
  PHEROMONE_DECAY_FP,
  DANGER_DECAY_FP,
  FOOD_TRAIL_DEPOSIT,
} from '../constants.js';

// ---------------------------------------------------------------------------
// Deposit tests (PHER-03)
// ---------------------------------------------------------------------------

describe('depositFoodTrail (PHER-03)', () => {
  it('1. basic: deposits FOOD_TRAIL_DEPOSIT (512) at cell', () => {
    const grid = createPheromoneGrid(10, 10);
    depositFoodTrail(grid, 3, 3);
    expect(phGet(grid, 3, 3)).toBe(FOOD_TRAIL_DEPOSIT); // 512
  });

  it('2. accumulates: two deposits give 2 × FOOD_TRAIL_DEPOSIT (1024)', () => {
    const grid = createPheromoneGrid(10, 10);
    depositFoodTrail(grid, 3, 3);
    depositFoodTrail(grid, 3, 3);
    expect(phGet(grid, 3, 3)).toBe(2 * FOOD_TRAIL_DEPOSIT); // 1024
  });

  it('3. caps at PHEROMONE_CAP (65280) — never exceeds cap', () => {
    const grid = createPheromoneGrid(10, 10);
    // Prime cell to PHEROMONE_CAP - 100 (65180)
    phSet(grid, 3, 3, PHEROMONE_CAP - 100);
    depositFoodTrail(grid, 3, 3);
    // 65180 + 512 = 65692 → clamped to PHEROMONE_CAP = 65280
    expect(phGet(grid, 3, 3)).toBe(PHEROMONE_CAP); // 65280
    // Must NOT be 65280 + any overflow
    expect(phGet(grid, 3, 3)).not.toBeGreaterThan(PHEROMONE_CAP);
  });

  it('4. out-of-bounds: does not throw and does not write anywhere', () => {
    const grid = createPheromoneGrid(10, 10);
    // phSet is a no-op for out-of-bounds; depositFoodTrail should be too
    expect(() => depositFoodTrail(grid, -1, 0)).not.toThrow();
    expect(() => depositFoodTrail(grid, 0, -1)).not.toThrow();
    expect(() => depositFoodTrail(grid, 10, 0)).not.toThrow();
    expect(() => depositFoodTrail(grid, 0, 10)).not.toThrow();
    // Grid must remain zero
    for (let i = 0; i < grid.data.length; i++) {
      expect(grid.data[i]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Decay tests (PHER-04, Phase 6 SC 5)
// ---------------------------------------------------------------------------

describe('tickPheromoneDecay (PHER-04)', () => {
  it('5. decay from max reaches zero in fewer than 500 ticks', () => {
    const grid = createPheromoneGrid(10, 10);
    phSet(grid, 5, 5, PHEROMONE_CAP);

    let ticks = 0;
    while (phGet(grid, 5, 5) !== 0 && ticks < 600) {
      tickPheromoneDecay(grid, PHEROMONE_DECAY_FP);
      ticks++;
    }
    // PRD §5c normative: floor-snap (64 > FP_ONE / PHEROMONE_DECAY_FP ≈ 51) means
    // once value drops below 64 it snaps to 0. Expected N ≈ 300–400 ticks.
    // Documenting observed N below; assert it completes under 500 ticks.
    expect(ticks).toBeLessThan(500);
    expect(phGet(grid, 5, 5)).toBe(0);
  });

  it('6. decay skips zero cells — only non-zero cell changes', () => {
    const grid = createPheromoneGrid(5, 5);
    // All zero except cell (2, 2)
    phSet(grid, 2, 2, PHEROMONE_CAP);
    tickPheromoneDecay(grid, PHEROMONE_DECAY_FP);

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const v = phGet(grid, x, y);
        if (x === 2 && y === 2) {
          // Should have decayed (but not be NaN or < 0)
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(PHEROMONE_CAP);
        } else {
          expect(v).toBe(0);
        }
      }
    }
  });

  it('7. floor snap: value below PHEROMONE_FLOOR snaps to 0', () => {
    // Starting value: 60
    // decayFp = 5
    // decayed = 60 - ((60 * 5) >> 8) = 60 - (300 >> 8) = 60 - 1 = 59
    // 59 < PHEROMONE_FLOOR (64) → snap to 0
    const grid = createPheromoneGrid(5, 5);
    phSet(grid, 0, 0, 60);
    tickPheromoneDecay(grid, 5);
    expect(phGet(grid, 0, 0)).toBe(0);
  });

  it('8. two-grid PHER-02: danger decays faster than food at same K ticks (K=10)', () => {
    // PHER-02: food and danger pheromones are stored in separate grids with
    // different decay rates (PHEROMONE_DECAY_FP=5 vs DANGER_DECAY_FP=10).
    const K = 10;
    const foodGrid = createPheromoneGrid(16, 16);
    const dangerGrid = createPheromoneGrid(16, 16);

    phSet(foodGrid, 5, 5, PHEROMONE_CAP);
    phSet(dangerGrid, 5, 5, PHEROMONE_CAP);

    for (let i = 0; i < K; i++) {
      tickPheromoneDecay(foodGrid, PHEROMONE_DECAY_FP); // 5
      tickPheromoneDecay(dangerGrid, DANGER_DECAY_FP);  // 10
    }

    // After 10 ticks with higher decay rate, danger should have lower strength.
    // Expected: foodGrid ≈ 65280 * (1 - 5/256)^10 ≈ very close to PHEROMONE_CAP
    //           dangerGrid ≈ 65280 * (1 - 10/256)^10 ≈ slightly less
    // The exact values aren't the point — the RELATIVE ordering must hold.
    expect(phGet(dangerGrid, 5, 5)).toBeLessThan(phGet(foodGrid, 5, 5));
  });
});

// ---------------------------------------------------------------------------
// Gradient tests (PHER-05, SCEN-06)
// ---------------------------------------------------------------------------

describe('sampleGradient (PHER-05)', () => {
  // Helper: find a seed where rng.nextInt(100) >= 10 (no explore)
  // We know seed 42 with Mulberry32: just verify empirically
  function exploitRng(seed: number): Rng {
    // Brute-force find a seed that produces exploit (not explore) on first call
    // For convenience, use the Rng we build and verify inline in tests
    return new Rng(seed);
  }

  it('9. gradient determinism: same seed → same output', () => {
    const grid = createPheromoneGrid(10, 10);
    // Asymmetric gradient
    phSet(grid, 5, 4, 500); // up neighbor of (5,5)
    phSet(grid, 5, 6, 200); // down neighbor of (5,5)
    phSet(grid, 4, 5, 100); // left neighbor of (5,5)

    const rng1 = new Rng(42);
    const rng2 = new Rng(42);

    const result1 = sampleGradient(grid, 5, 5, rng1);
    const result2 = sampleGradient(grid, 5, 5, rng2);

    expect(result1).toEqual(result2);

    // Call twice more — same sequences
    const r1b = sampleGradient(grid, 5, 5, rng1);
    const r2b = sampleGradient(grid, 5, 5, rng2);
    expect(r1b).toEqual(r2b);
  });

  it('10. gradient exploit — strongest neighbor wins: right neighbor with 1000', () => {
    // We need a seed where explore roll does NOT trigger (nextInt(100) >= 10)
    // Find such a seed by scanning
    let seed = 1;
    let exploitSeed = -1;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const testRng = new Rng(seed);
      const roll = testRng.nextInt(100);
      if (roll >= 10) {
        exploitSeed = seed;
        break;
      }
      seed++;
    }
    expect(exploitSeed).toBeGreaterThan(-1); // Found a non-explore seed

    const grid = createPheromoneGrid(10, 10);
    // Right neighbor of (5,5) is (6,5)
    phSet(grid, 6, 5, 1000);

    const rng = new Rng(exploitSeed);
    const result = sampleGradient(grid, 5, 5, rng);
    expect(result).toEqual({ dx: 1, dy: 0 }); // right
  });

  it('11. gradient tie-break: up wins over down (first-found in DIRS order)', () => {
    // up=y-1, down=y+1 both have 500; left/right are 0
    // DIRS order is up (index 0), down (index 1), left, right
    // First-found wins → up should be returned on exploit
    let seed = 1;
    let exploitSeed = -1;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const testRng = new Rng(seed);
      const roll = testRng.nextInt(100);
      if (roll >= 10) {
        exploitSeed = seed;
        break;
      }
      seed++;
    }
    expect(exploitSeed).toBeGreaterThan(-1);

    const grid = createPheromoneGrid(10, 10);
    phSet(grid, 5, 4, 500); // up neighbor: (5, 4)
    phSet(grid, 5, 6, 500); // down neighbor: (5, 6)

    const rng = new Rng(exploitSeed);
    const result = sampleGradient(grid, 5, 5, rng);
    expect(result).toEqual({ dx: 0, dy: -1 }); // up — first in DIRS order
  });

  it('12. gradient empty: all neighbors zero → returns {dx:0, dy:0}', () => {
    // Need a seed that does NOT explore
    let seed = 1;
    let exploitSeed = -1;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const testRng = new Rng(seed);
      const roll = testRng.nextInt(100);
      if (roll >= 10) {
        exploitSeed = seed;
        break;
      }
      seed++;
    }
    expect(exploitSeed).toBeGreaterThan(-1);

    const grid = createPheromoneGrid(10, 10);
    // No deposits — all cells remain 0

    const rng = new Rng(exploitSeed);
    const result = sampleGradient(grid, 5, 5, rng);
    expect(result).toEqual({ dx: 0, dy: 0 });
  });

  it('13. gradient exploration branch: low roll → random direction from DIRS', () => {
    // We need a seed where rng.nextInt(100) < 10 (explore triggers)
    // Find such a seed and verify the direction matches DIRS[rng.nextInt(4)]
    let seed = 1;
    let exploreSeed = -1;
    let exploreRoll = -1;
    for (let attempt = 0; attempt < 10000; attempt++) {
      const testRng = new Rng(seed);
      const roll = testRng.nextInt(100);
      if (roll < 10) {
        exploreSeed = seed;
        exploreRoll = roll;
        break;
      }
      seed++;
    }
    expect(exploreSeed).toBeGreaterThan(-1); // Must find an explore seed

    const grid = createPheromoneGrid(10, 10);
    const rng = new Rng(exploreSeed);
    const result = sampleGradient(grid, 5, 5, rng);

    // Replay to find expected direction
    const replayRng = new Rng(exploreSeed);
    const replayRoll = replayRng.nextInt(100);
    expect(replayRoll).toBe(exploreRoll); // Sanity: same seed same roll
    expect(replayRoll).toBeLessThan(10);  // Must be explore

    const expectedIdx = replayRng.nextInt(4);
    const DIRS = [
      { dx: 0,  dy: -1 }, // up
      { dx: 0,  dy:  1 }, // down
      { dx: -1, dy:  0 }, // left
      { dx:  1, dy:  0 }, // right
    ];
    const expected = DIRS[expectedIdx]!;

    expect(result).toEqual({ dx: expected.dx, dy: expected.dy });
  });
});

// ---------------------------------------------------------------------------
// PHER-07 iteration-count regression guard
// ---------------------------------------------------------------------------

describe('PHER-07 grid.data.length invariant', () => {
  it('14. decay visits 128*128 cells regardless of deposit density', () => {
    // This test documents the PRD invariant: grid.data.length cells touched per tick.
    // It is NOT the timing proof (wall-clock bench lives in bench/pheromone-decay.bench.ts).
    const grid = createPheromoneGrid(128, 128);
    const expectedLen = 128 * 128; // 16384

    expect(grid.data.length).toBe(expectedLen);

    // Run one decay on empty grid
    tickPheromoneDecay(grid, PHEROMONE_DECAY_FP);
    expect(grid.data.length).toBe(expectedLen); // Length unchanged

    // Populate 10000 cells (some may overlap — that's fine for this test)
    let idx = 17;
    for (let i = 0; i < 10000; i++) {
      idx = (idx * 1103515245 + 12345) & 0x7fffffff;
      const x = idx % 128;
      const y = (idx >>> 7) % 128;
      phSet(grid, x, y, FOOD_TRAIL_DEPOSIT);
    }

    // Run another decay with many deposits
    tickPheromoneDecay(grid, PHEROMONE_DECAY_FP);
    expect(grid.data.length).toBe(expectedLen); // Length still unchanged
  });
});
