// fixed.ts — fixed-point arithmetic primitives for src/sim/
// Source: RESEARCH.md Pattern 3 (lines 428–466), verified against PRD §3 / §6.
//
// FP_SHIFT = 8 means 1 tile = 256 fixed-point units.
// All sim-layer quantities use these helpers; floats are banned in src/sim/.
//
// Safe upper bound: values up to 2^23 FP units (32,768 tiles) are safe before
// Math.imul overflow (RESEARCH.md Pattern 3 overflow semantics, T-05-07).

/** Number of fractional bits. 1 tile = 2^FP_SHIFT fixed-point units. */
export const FP_SHIFT = 8;

/** Fixed-point representation of 1.0 (one tile). */
export const FP_ONE = 1 << FP_SHIFT; // 256

/**
 * Multiply two fixed-point values.
 * Returns fixed-point result. Uses Math.imul for C-style 32-bit signed integer
 * semantics; signed right-shift preserves negative values correctly.
 * Do NOT use >>> here — it would convert negatives to large positive uint32 values.
 */
export function fpMul(a: number, b: number): number {
  return Math.imul(a, b) >> FP_SHIFT;
}

/**
 * Divide two fixed-point values. Returns fixed-point result.
 * Left-shifts dividend before dividing to preserve sub-unit precision.
 * Math.trunc keeps integer semantics (not Math.floor — different for negatives).
 */
export function fpDiv(a: number, b: number): number {
  // eslint-disable-next-line no-restricted-syntax -- fpDiv is the only sanctioned division in src/sim/; result is immediately truncated to integer via Math.trunc
  return Math.trunc((a << FP_SHIFT) / b);
}

/**
 * Convert an integer tile count to fixed-point representation.
 * The `| 0` coerces to int32 (acceptable — contract requires integer input).
 */
export function toFixed(tiles: number): number {
  return (tiles * FP_ONE) | 0;
}

/**
 * Convert a fixed-point value to a floating-point tile count.
 * RENDER LAYER ONLY — do not store or use the result inside src/sim/.
 */
export function toFloat(fixed: number): number {
  // eslint-disable-next-line no-restricted-syntax -- toFloat is the render-layer conversion boundary; returns a float intentionally for Phaser coordinate consumption
  return fixed / FP_ONE;
}
