// dig-system.ts — Phase 7 PRD §4a BFS multi-source flow-field for underground excavation
//
// Scope: BFS computation + per-colony Int32Array cache only.
// This module does NOT write tiles, does NOT write ant components,
// does NOT run the dig-worker state machine.
//
// Tile writes (BeingDug claim, Open excavation) live in Plan 06's tickDigExecution.
// Dead-digger BeingDug→Marked reversion lives in Plan 05's tickDeadDiggerCleanup.
// Flow-field recompute-when-dirty driver lives in Plan 08's tick step 9.
//
// DO NOT import Phaser, DOM, or any non-sim module.
// DO NOT use Math.random(), Date, performance.now(), or floating-point arithmetic.

import type { ColonyId } from './colony/colony-store.js';
import {
  UndergroundTileState,
} from './terrain.js';
import type { UndergroundGrid } from './terrain.js';

// ---------------------------------------------------------------------------
// Direction constants for BFS output array
//
// Directions pointing TOWARD the nearest Marked tile source:
//   0 = North (row decreases)
//   1 = East  (col increases)
//   2 = South (row increases)
//   3 = West  (col decreases)
//  -1 = source (tile is Marked)
//  -2 = unreachable (no Marked tile reachable from this tile)
// ---------------------------------------------------------------------------

/** Reverse of each expansion direction: if we expanded North (0), neighbor points South (2) back to us. */
const REVERSE = [2, 3, 0, 1] as const;

/** Neighbor offsets [dRow, dCol] for each direction (0=N, 1=E, 2=S, 3=W). */
const NEIGHBOR_DR = [-1, 0, 1, 0] as const;
const NEIGHBOR_DC = [0, 1, 0, -1] as const;

// ---------------------------------------------------------------------------
// DigFlowFields — per-colony flow-field cache
//
// Created once at scenario creation by createDigFlowFields(). Not part of
// WorldState (per Open Question 1 resolution: cache is transient, not saved).
// ---------------------------------------------------------------------------

export interface DigFlowFields {
  /** Direction array per colony. Key = colonyId. Value = Int32Array of length W*H. */
  fields: Record<ColonyId, Int32Array>;
  /** BFS scratch queue per colony. Pre-allocated to avoid per-tick allocation. */
  queues: Record<ColonyId, Int32Array>;
}

/**
 * Create a DigFlowFields cache — call once at scenario creation.
 * Both fields and queues start empty; ensureDigFlowField allocates lazily.
 */
export function createDigFlowFields(): DigFlowFields {
  return { fields: {}, queues: {} };
}

// ---------------------------------------------------------------------------
// ensureDigFlowField — lazy allocator
// ---------------------------------------------------------------------------

/**
 * Ensure the flow-field for a colony is initialized, allocating if first use.
 * Returns the direction Int32Array for the colony.
 *
 * @param digFlowFields - The shared DigFlowFields cache.
 * @param colonyId      - The colony whose flow-field to ensure.
 * @param gridSize      - Total tile count (width × height) for the underground grid.
 */
export function ensureDigFlowField(
  digFlowFields: DigFlowFields,
  colonyId: ColonyId,
  gridSize: number,
): Int32Array {
  if (!(colonyId in digFlowFields.fields)) {
    digFlowFields.fields[colonyId] = new Int32Array(gridSize);
    digFlowFields.queues[colonyId] = new Int32Array(gridSize);
  }
  return digFlowFields.fields[colonyId]!;
}

// ---------------------------------------------------------------------------
// computeDigFlowField — multi-source BFS (PRD §4a)
// ---------------------------------------------------------------------------

/**
 * Multi-source BFS from all Marked tiles through Open and BeingDug tiles.
 *
 * Output directions: 0=North, 1=East, 2=South, 3=West, -1=source (Marked), -2=unreachable.
 *
 * Algorithm:
 *   1. Fill `out` with -2 (unreachable/unvisited).
 *   2. Seed: scan all tiles; where tile === Marked, set out[idx] = -1 (source), enqueue.
 *   3. BFS: dequeue index, try 4 neighbors. Skip if out-of-bounds, Solid, or already visited.
 *      Set out[nIdx] = REVERSE[d] (direction pointing BACK toward the Marked source). Enqueue.
 *
 * BFS expands through Open (3) and BeingDug (2) tiles only.
 * Marked (1) tiles are sources — not expanded through, they are endpoints.
 * Solid (0) tiles block expansion.
 *
 * @param underground - The colony's underground grid (read-only via ugGet not needed; direct data access for perf).
 * @param out         - Pre-allocated Int32Array of length W*H. Filled in-place.
 * @param queue       - Pre-allocated Int32Array of length W*H for BFS queue (reused each call).
 */
export function computeDigFlowField(
  underground: UndergroundGrid,
  out: Int32Array,
  queue: Int32Array,
): void {
  const { data, width, height } = underground;
  const size = width * height;

  // Step 1: fill out with -2 (unreachable)
  out.fill(-2);

  // Step 2: seed BFS from all Marked tiles
  let head = 0;
  let tail = 0;

  for (let idx = 0; idx < size; idx++) {
    if (data[idx] === UndergroundTileState.Marked) {
      out[idx] = -1; // source
      queue[tail++] = idx;
    }
  }

  // Step 3: BFS expansion
  while (head < tail) {
    const idx = queue[head++]!;
    // eslint-disable-next-line no-restricted-syntax -- integer division via `| 0` truncation; BFS index-to-row conversion, not fixed-point math
    const row = (idx / width) | 0;
    const col = idx % width;

    for (let d = 0; d < 4; d++) {
      const nRow = row + NEIGHBOR_DR[d]!;
      const nCol = col + NEIGHBOR_DC[d]!;

      // Bounds check
      if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) {
        continue;
      }

      const nIdx = nRow * width + nCol;

      // Skip if already visited (not -2)
      if (out[nIdx] !== -2) {
        continue;
      }

      const tileState = data[nIdx]!;

      // Skip Solid tiles (BFS does not expand through Solid)
      // Skip Marked tiles — they are sources, already handled in seed phase
      if (
        tileState === UndergroundTileState.Solid ||
        tileState === UndergroundTileState.Marked
      ) {
        continue;
      }

      // Open (3) or BeingDug (2) — passable
      // REVERSE[d]: if we expanded in direction d, the neighbor points back via REVERSE[d]
      out[nIdx] = REVERSE[d]!;
      queue[tail++] = nIdx;
    }
  }
}
