// allocation-system.test.ts — Tests for PRD §7a/§7b allocation math
//
// Coverage:
//   - computeNurseCount (4 cases)
//   - allocateWorkers PRD §8b scenarios (3 cases: high-brood, three-way split, CLNY-09)
//   - Edge cases (6 cases: zero ratio, zero workers, all nursing, remainder=2, fight-heavy, unequal ratio)
//   - CTRL-04 immediate allocation proof (1 case)
//   - Sum invariant property sweep (1 case, 20 fixed inputs)
//
// Each test runs in <1ms; full suite <50ms.

import { describe, it, expect } from 'vitest';
import { computeNurseCount, allocateWorkers } from './allocation-system.js';

// ---------------------------------------------------------------------------
// computeNurseCount
// ---------------------------------------------------------------------------

describe('computeNurseCount', () => {
  it('basic: floor(12/3)=4, capped at 10 → 4', () => {
    expect(computeNurseCount(12, 10)).toBe(4);
  });

  it('capped at workerCount: floor(30/3)=10, capped at 3 → 3', () => {
    expect(computeNurseCount(30, 3)).toBe(3);
  });

  it('zero brood: no nurses needed → 0', () => {
    expect(computeNurseCount(0, 10)).toBe(0);
  });

  it('zero workers: workerCount cap wins → 0', () => {
    expect(computeNurseCount(6, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// allocateWorkers — PRD §8b scenarios
// ---------------------------------------------------------------------------

describe('allocateWorkers — PRD §8b scenarios', () => {
  it('5. Nurse Carveout at High Brood (CLNY-09 path): workerCount=3, broodCount=30, forage-only', () => {
    // floor(30/3)=10, capped at 3 → all 3 nurse; available=0 → forage/dig/fight=0
    const result = allocateWorkers(3, 30, { forage: 10, dig: 0, fight: 0 });
    expect(result).toEqual({ nurse: 3, forage: 0, dig: 0, fight: 0 });
    expect(result.nurse + result.forage + result.dig + result.fight).toBe(3);
  });

  it('6. Three-Way Split with Remainder (PRD §8b lines 2249-2272): 10 workers, equal 1:1:1 ratio', () => {
    // nurseCount=0, available=10; floor(10/3)=3 each, sum=9, remainder=1 → forage+1
    const result = allocateWorkers(10, 0, { forage: 1, dig: 1, fight: 1 });
    expect(result).toEqual({ nurse: 0, forage: 4, dig: 3, fight: 3 });
    expect(result.nurse + result.forage + result.dig + result.fight).toBe(10);
  });

  it('7. CLNY-09 proof: workerCount=10, broodCount=3, 100% forage → nurse enforced', () => {
    // min(floor(3/3), 10) = min(1, 10) = 1; available=9; all forage → forage=9
    const result = allocateWorkers(10, 3, { forage: 10, dig: 0, fight: 0 });
    expect(result).toEqual({ nurse: 1, forage: 9, dig: 0, fight: 0 });
    expect(result.nurse + result.forage + result.dig + result.fight).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// allocateWorkers — edge cases
// ---------------------------------------------------------------------------

describe('allocateWorkers — edge cases', () => {
  it('8. Zero ratio sum: all non-nurse workers go idle (returned as 0)', () => {
    const result = allocateWorkers(5, 0, { forage: 0, dig: 0, fight: 0 });
    expect(result).toEqual({ nurse: 0, forage: 0, dig: 0, fight: 0 });
  });

  it('9. Zero workers: all fields are 0', () => {
    const result = allocateWorkers(0, 0, { forage: 10, dig: 0, fight: 0 });
    expect(result).toEqual({ nurse: 0, forage: 0, dig: 0, fight: 0 });
  });

  it('10. All workers nursing: broodCount much larger than workerCount', () => {
    // floor(15/3)=5, capped at 5 → all 5 nurse; available=0
    const result = allocateWorkers(5, 15, { forage: 10, dig: 0, fight: 0 });
    expect(result).toEqual({ nurse: 5, forage: 0, dig: 0, fight: 0 });
  });

  it('11. Remainder = 2 (goes forage then dig): 11 workers, equal 1:1:1 ratio', () => {
    // nurseCount=0, available=11; floor(11/3)=3 each, sum=9, remainder=2
    // forage+1=4, dig+1=4, fight+0=3 → sum=11
    const result = allocateWorkers(11, 0, { forage: 1, dig: 1, fight: 1 });
    expect(result).toEqual({ nurse: 0, forage: 4, dig: 4, fight: 3 });
    expect(result.nurse + result.forage + result.dig + result.fight).toBe(11);
  });

  it('12. Fight-heavy: 100% fight → no remainder (exact division)', () => {
    // nurseCount=0, available=10; total=1, forage=0, dig=0, fight=floor(10*1/1)=10, remainder=0
    const result = allocateWorkers(10, 0, { forage: 0, dig: 0, fight: 1 });
    expect(result).toEqual({ nurse: 0, forage: 0, dig: 0, fight: 10 });
    expect(result.nurse + result.forage + result.dig + result.fight).toBe(10);
  });

  it('13. Unequal ratio 3:2:1 with no remainder: 6 workers', () => {
    // nurseCount=0, available=6; total=6; forage=floor(6*3/6)=3, dig=floor(6*2/6)=2, fight=floor(6*1/6)=1, remainder=0
    const result = allocateWorkers(6, 0, { forage: 3, dig: 2, fight: 1 });
    expect(result).toEqual({ nurse: 0, forage: 3, dig: 2, fight: 1 });
    expect(result.nurse + result.forage + result.dig + result.fight).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// CTRL-04 — allocation returns immediately (no tick state)
// ---------------------------------------------------------------------------

describe('allocateWorkers — CTRL-04 immediate allocation', () => {
  it('14. CTRL-04: two consecutive calls with different ratios return independent results', () => {
    // Simulates "SetBehaviorRatio sequence" at the math level.
    // Both allocations are computed in one call each — no tick advance, no state.
    // This documents that the math is instant; ant retasking (finish-then-switch)
    // is Plan 10 + downstream wiring.
    const alloc1 = allocateWorkers(10, 0, { forage: 10, dig: 0, fight: 0 });
    expect(alloc1.forage).toBe(10);
    expect(alloc1.dig).toBe(0);
    expect(alloc1.fight).toBe(0);

    const alloc2 = allocateWorkers(10, 0, { forage: 0, dig: 10, fight: 0 });
    expect(alloc2.dig).toBe(10);
    expect(alloc2.forage).toBe(0);
    expect(alloc2.fight).toBe(0);

    // alloc1 is unchanged (pure function, no shared state)
    expect(alloc1.forage).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Sum invariant property sweep — 20 fixed inputs
// ---------------------------------------------------------------------------

describe('allocateWorkers — sum invariant', () => {
  it('15. nurse + forage + dig + fight === workerCount for all 20 fixed inputs', () => {
    const cases: Array<[number, number, { forage: number; dig: number; fight: number }]> = [
      [10,  5,  { forage: 3, dig: 2, fight: 1 }],
      [100, 50, { forage: 1, dig: 1, fight: 1 }],
      [1,   0,  { forage: 1, dig: 0, fight: 0 }],
      [50,  0,  { forage: 10, dig: 5, fight: 5 }],
      [0,   0,  { forage: 10, dig: 0, fight: 0 }],
      [20,  3,  { forage: 7, dig: 2, fight: 1 }],
      [15,  15, { forage: 1, dig: 1, fight: 1 }],
      [30,  90, { forage: 10, dig: 0, fight: 0 }], // all nursing
      [7,   6,  { forage: 2, dig: 2, fight: 2 }],
      [8,   0,  { forage: 3, dig: 3, fight: 3 }],  // remainder=2 → forage+1, dig+1
      [12,  9,  { forage: 5, dig: 3, fight: 2 }],
      [25,  0,  { forage: 10, dig: 0, fight: 0 }],  // forage-only, no brood → all forage
      [5,   5,  { forage: 10, dig: 5, fight: 5 }],
      [3,   3,  { forage: 1, dig: 1, fight: 0 }],
      [99,  0,  { forage: 4, dig: 3, fight: 3 }],
      [10,  30, { forage: 1, dig: 0, fight: 0 }],  // broodCount >> workerCount
      [6,   6,  { forage: 0, dig: 10, fight: 0 }],
      [40,  12, { forage: 6, dig: 2, fight: 2 }],
      [11,  0,  { forage: 1, dig: 1, fight: 1 }],  // remainder=2
      [100, 0,  { forage: 10, dig: 0, fight: 0 }],
    ];

    for (const [workerCount, broodCount, ratio] of cases) {
      const result = allocateWorkers(workerCount, broodCount, ratio);
      const sum = result.nurse + result.forage + result.dig + result.fight;
      expect(sum).toBe(workerCount);
    }
  });
});
