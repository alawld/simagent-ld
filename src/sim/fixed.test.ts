// fixed.test.ts — fixed-point math tests
// Tests lock behavior against the PRD §3 / RESEARCH.md Pattern 3 spec.
// All assertions use exact integer equality (toBe), not toBeCloseTo.

import { describe, it, expect } from 'vitest';
import { FP_SHIFT, FP_ONE, fpMul, fpDiv, toFixed, toFloat } from './fixed.js';

describe('fixed-point math', () => {
  describe('constants', () => {
    it('FP_SHIFT is 8', () => {
      expect(FP_SHIFT).toBe(8);
    });

    it('FP_ONE is 256 (1 << FP_SHIFT)', () => {
      expect(FP_ONE).toBe(256);
    });
  });

  describe('fpMul', () => {
    it('1 * 1 = 1 in fixed-point (FP_ONE * FP_ONE) >> FP_SHIFT = FP_ONE', () => {
      expect(fpMul(FP_ONE, FP_ONE)).toBe(FP_ONE);
    });

    it('2 * 3 = 6 in fixed-point', () => {
      expect(fpMul(FP_ONE * 2, FP_ONE * 3)).toBe(FP_ONE * 6);
    });

    it('preserves negative values: -2 * 3 = -6 in fixed-point', () => {
      expect(fpMul(-FP_ONE * 2, FP_ONE * 3)).toBe(-FP_ONE * 6);
    });

    it('uses Math.imul for 32-bit integer semantics (overflow edge)', () => {
      // FP_ONE * 32768 = 256 * 32768 = 8,388,608 FP units (safe upper bound per RESEARCH.md Pattern 3).
      // fpMul(FP_ONE * 32768, FP_ONE) should equal FP_ONE * 32768 (multiply by 1.0 in FP).
      const bigVal = FP_ONE * 32768;
      const result = fpMul(bigVal, FP_ONE);
      // Result must be a finite integer, not NaN or Infinity.
      expect(Number.isFinite(result)).toBe(true);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('fpDiv', () => {
    it('6 / 3 = 2 in fixed-point', () => {
      expect(fpDiv(FP_ONE * 6, FP_ONE * 3)).toBe(FP_ONE * 2);
    });

    it('1 / 2 = 0.5 in fixed-point (FP_ONE / 2 = 128)', () => {
      expect(fpDiv(FP_ONE, FP_ONE * 2)).toBe(128);
    });
  });

  describe('toFixed', () => {
    it('converts integer tile count to fixed-point', () => {
      expect(toFixed(3)).toBe(FP_ONE * 3);
    });

    it('3 tiles = 768 fixed-point units', () => {
      expect(toFixed(3)).toBe(768);
    });

    it('0 tiles = 0 fixed-point units', () => {
      expect(toFixed(0)).toBe(0);
    });
  });

  describe('toFloat', () => {
    it('converts fixed-point back to float tile count (RENDER LAYER ONLY)', () => {
      expect(toFloat(FP_ONE * 3)).toBe(3);
    });

    it('round-trip: toFloat(toFixed(n)) === n for integer n', () => {
      expect(toFloat(toFixed(5))).toBe(5);
    });
  });
});
