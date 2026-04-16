// pheromone-system.ts — PRD §5b/§5c/§5d pheromone deposit, decay, and gradient sampling
//
// Implements the four core pheromone operations:
//   depositFoodTrail  — PRD §5b: accumulate food-trail strength at a cell, clamped at PHEROMONE_CAP
//   depositDanger     — PRD §5b: defined for completeness; NOT called from Phase 6 tick steps (Phase 9 scope)
//   tickPheromoneDecay — PRD §5c: O(grid.data.length) sweep; floor-snap prevents zombie trails (PHER-04/PHER-07)
//   sampleGradient    — PRD §5d: deterministic 4-connected neighbor sampling with explore/exploit (PHER-05)
//
// MUST NOT use: Math.floor, Math.round, division (/), Date, performance, setTimeout, Math.random.
// All fixed-point operations use >>  and Math.imul.
// Rng is passed explicitly — no module-level singleton (PRD §4 / ARCH principle 4).

import type { PheromoneGrid } from './pheromone-store.js';
import { phGet, phSet } from './pheromone-store.js';
import { Rng } from '../rng.js';
import { FP_SHIFT } from '../fixed.js';
import {
  FOOD_TRAIL_DEPOSIT,
  PHEROMONE_CAP,
  PHEROMONE_FLOOR,
  EXPLORE_RATE_PERCENT,
} from '../constants.js';

// ---------------------------------------------------------------------------
// Direction table — fixed order: up, down, left, right (PRD §5d)
// ---------------------------------------------------------------------------

const DIRS = [
  { dx: 0,  dy: -1 }, // up
  { dx: 0,  dy:  1 }, // down
  { dx: -1, dy:  0 }, // left
  { dx:  1, dy:  0 }, // right
] as const;

// ---------------------------------------------------------------------------
// depositFoodTrail — PRD §5b verbatim
// ---------------------------------------------------------------------------

/**
 * Accumulate food-trail pheromone at (tileX, tileY), clamped to PHEROMONE_CAP.
 *
 * Carry-only rule (PHER-03): callers MUST only invoke this for food-carrying
 * foragers. The function itself does NOT check carry state — enforcement is at
 * call sites.
 *
 * Coordinates are already tile integers (posX >> FP_SHIFT at the call site).
 * Out-of-bounds coordinates are silently ignored (phSet is a no-op out of bounds).
 */
export function depositFoodTrail(grid: PheromoneGrid, tileX: number, tileY: number): void {
  const current = phGet(grid, tileX, tileY);
  const sum = current + FOOD_TRAIL_DEPOSIT;
  phSet(grid, tileX, tileY, sum > PHEROMONE_CAP ? PHEROMONE_CAP : sum);
}

// ---------------------------------------------------------------------------
// depositDanger — PRD §5b (defined; Phase 9 wires call sites)
// ---------------------------------------------------------------------------

/**
 * Phase 6: defined for type completeness; NOT called from any Phase 6 tick step.
 * Phase 9 wires combat deposit triggers.
 *
 * Accumulate danger-trail pheromone at (tileX, tileY), clamped to PHEROMONE_CAP.
 * Uses the same deposit magnitude as food-trail per PRD §5b (FOOD_TRAIL_DEPOSIT).
 */
export function depositDanger(grid: PheromoneGrid, tileX: number, tileY: number): void {
  const current = phGet(grid, tileX, tileY);
  const sum = current + FOOD_TRAIL_DEPOSIT;
  phSet(grid, tileX, tileY, sum > PHEROMONE_CAP ? PHEROMONE_CAP : sum);
}

// ---------------------------------------------------------------------------
// tickPheromoneDecay — PRD §5c verbatim (PHER-04, PHER-07)
// ---------------------------------------------------------------------------

/**
 * Sweep every cell in `grid.data`, applying fractional decay.
 *
 * Per-cell operation (PRD §5c):
 *   decayed = s - ((s * decayFp) >> FP_SHIFT)
 *   if decayed < PHEROMONE_FLOOR → snap to 0 (prevents zombie trails; PRD §5c normative)
 *
 * PHER-07 invariant: cost is O(grid.data.length) — independent of ant count.
 * The early continue on s === 0 is a mandatory fast path (PRD §5c).
 *
 * ESLint compliance: s * decayFp is multiplication (not division); >> FP_SHIFT
 * is a signed right-shift that correctly truncates to integer for positive s.
 * No Math.floor, no division operator, no allocation inside the loop.
 *
 * @param grid     The pheromone grid to decay in-place.
 * @param decayFp  Fixed-point decay rate (e.g., PHEROMONE_DECAY_FP = 5 means
 *                 ~1.95% decay per tick: 5/256 ≈ 0.0195).
 */
export function tickPheromoneDecay(grid: PheromoneGrid, decayFp: number): void {
  const data = grid.data;
  const len = data.length;
  for (let i = 0; i < len; i++) {
    const s = data[i]!;
    if (s === 0) continue;
    const decayed = s - ((s * decayFp) >> FP_SHIFT);
    data[i] = decayed < PHEROMONE_FLOOR ? 0 : decayed;
  }
}

// ---------------------------------------------------------------------------
// sampleGradient — PRD §5d (PHER-05, SCEN-06)
// ---------------------------------------------------------------------------

/**
 * Return the direction `{dx, dy}` a forager should move based on the pheromone
 * gradient at (tileX, tileY).
 *
 * Algorithm (PRD §5d):
 *   1. Explore check: rng.nextInt(100) — if < EXPLORE_RATE_PERCENT (10), pick
 *      rng.nextInt(4) and return DIRS[idx]. One PRNG call consumed unconditionally
 *      for the explore check; a second consumed only when explore is taken.
 *   2. Exploit: iterate DIRS in fixed order (up, down, left, right); phGet each
 *      neighbor; strict > comparison for first-found tie-break (deterministic).
 *   3. Empty fallback: if bestStrength === 0 (all empty), return {dx:0, dy:0}.
 *
 * PRNG invariants (critical for determinism):
 *   - nextInt(100) ALWAYS consumed once per call.
 *   - nextInt(4)   consumed ONLY when explore branch is taken.
 *   - No other Math.random or PRNG calls occur inside this function.
 *
 * @param grid   Pheromone grid to read neighbor strengths from.
 * @param tileX  Tile X of the forager (integer, already >> FP_SHIFT at call site).
 * @param tileY  Tile Y of the forager (integer, already >> FP_SHIFT at call site).
 * @param rng    WorldState Rng instance — passed explicitly, never a singleton.
 * @returns      Direction vector with dx, dy each in {-1, 0, 1}.
 */
export function sampleGradient(
  grid: PheromoneGrid,
  tileX: number,
  tileY: number,
  rng: Rng,
): { dx: number; dy: number } {
  // Explore branch (PRD §5d)
  if (rng.nextInt(100) < EXPLORE_RATE_PERCENT) {
    const idx = rng.nextInt(4);
    const dir = DIRS[idx]!;
    return { dx: dir.dx, dy: dir.dy };
  }

  // Exploit branch — 4-connected neighbor sampling, fixed order (up, down, left, right)
  let bestStrength = 0;
  let bestDx = 0;
  let bestDy = 0;

  for (let d = 0; d < 4; d++) {
    const dir = DIRS[d]!;
    const s = phGet(grid, tileX + dir.dx, tileY + dir.dy);
    if (s > bestStrength) {
      bestStrength = s;
      bestDx = dir.dx;
      bestDy = dir.dy;
    }
  }

  // Empty fallback
  if (bestStrength === 0) {
    return { dx: 0, dy: 0 };
  }

  return { dx: bestDx, dy: bestDy };
}
