// allocation-system.ts — PRD §7a/§7b behavior allocation math
//
// Pure, stateless functions. No tick integration, no ant reassignment, no colony state writes.
// Downstream caller (Plan 10 tick.ts) reads the result and writes colony.computedAllocation.
//
// Invariant: result.nurse + result.forage + result.dig + result.fight === workerCount
// for all non-negative inputs with finite ratio values.
//
// Remainder distribution (PRD §7b line 1999): forage gets +1 first, dig gets +1 second,
// fight never receives remainder. Max remainder is 2 (when all 3 ratio slots are > 0).

import type { BehaviorRatio, WorkerAllocation } from '../colony/colony-store.js';
import { NURSE_RATIO } from '../constants.js';

/**
 * Compute the number of nurses required for a given brood count.
 *
 * PRD §7a: one nurse required per NURSE_RATIO brood members (floor division),
 * capped at total worker count. Integer truncation via `| 0` (not Math.floor).
 *
 * @param broodCount  - Total brood (larvae + eggs) currently in the colony.
 * @param workerCount - Total available workers.
 * @returns Number of workers that must be assigned as nurses.
 */
export function computeNurseCount(broodCount: number, workerCount: number): number {
  // eslint-disable-next-line no-restricted-syntax -- PRD §7a integer ratio, not float math
  const needed = (broodCount / NURSE_RATIO) | 0;
  return needed < workerCount ? needed : workerCount;
}

/**
 * Allocate workers across tasks according to PRD §7a (nurse carveout) and §7b (triangle floor-split).
 *
 * Algorithm:
 *  1. Nurse carveout (PRD §7a): nurses are computed BEFORE the triangle split.
 *  2. Remaining workers are split forage/dig/fight by integer floor of the ratio weights.
 *  3. Remainder distribution (PRD §7b): any leftover workers go forage-first, then dig.
 *     Fight never receives a remainder bonus via this path.
 *
 * Invariant: result.nurse + result.forage + result.dig + result.fight === workerCount
 *
 * Edge cases:
 *  - workerCount === 0: all fields are 0.
 *  - broodCount === 0: nurseCount === 0, all workers go to the triangle split.
 *  - total ratio === 0 (ratio {0,0,0}): all non-nurse workers are idle (0 allocated).
 *  - broodCount >> workerCount: nurseCount capped at workerCount, available = 0.
 *
 * @param workerCount - Total workers to allocate.
 * @param broodCount  - Colony brood count, used for nurse carveout.
 * @param ratio       - Player/AI target task distribution triangle.
 * @returns WorkerAllocation with exact per-task counts summing to workerCount.
 */
export function allocateWorkers(
  workerCount: number,
  broodCount: number,
  ratio: BehaviorRatio,
): WorkerAllocation {
  const nurseCount = computeNurseCount(broodCount, workerCount);
  const available = workerCount - nurseCount;

  const total = ratio.forage + ratio.dig + ratio.fight;
  if (total === 0 || available === 0) {
    return { nurse: nurseCount, forage: 0, dig: 0, fight: 0 };
  }

  // eslint-disable-next-line no-restricted-syntax -- PRD §7b integer ratio, not float math
  const forage = ((available * ratio.forage) / total) | 0;
  // eslint-disable-next-line no-restricted-syntax -- PRD §7b integer ratio, not float math
  const dig    = ((available * ratio.dig)    / total) | 0;
  // eslint-disable-next-line no-restricted-syntax -- PRD §7b integer ratio, not float math
  const fight  = ((available * ratio.fight)  / total) | 0;
  const remainder = available - forage - dig - fight;

  return {
    nurse:  nurseCount,
    forage: forage + (remainder > 0 ? 1 : 0),
    dig:    dig    + (remainder > 1 ? 1 : 0),
    fight:  fight,
  };
}
