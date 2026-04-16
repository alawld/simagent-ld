// ant-system.ts — PRD §4c + §5b + §8a step 10/12 ant interaction and movement
//
// Implements five exported functions:
//   antPickupFood        — PRD §4c L1093-1104: pickup from food pile, internal subTask transition
//   antDepositFood       — PRD §4c (Errata E-01): chamberless deposit + idle-checkpoint transition
//   getTaskDirection     — Phase 6 placeholder for non-forager direction (Open Q1 resolution)
//   tickPheromoneDeposit — PRD §8a step 10 + §5b carry-only rule: deposit food trail per alive carrying ant
//   tickAntMovement      — PRD §8a step 12: gradient-driven forager movement + clamp
//
// Key semantic decisions:
//   - antPickupFood: on NONZERO transfer, sets subTask=CarryingFood internally (caller does NOT flip).
//     Zero transfer (capacity-full or empty-pile) must NOT flip subTask (PRD §4c L1097).
//   - antDepositFood: Errata E-01 supersedes original §4c subTask=SearchingFood write.
//     On deposit, writes task=Idle, subTask=0. Plan 10 step 9 reassigns next tick.
//   - tickPheromoneDeposit: only ants with foodCarrying > 0 AND alive === 1 deposit (§5b carry-only rule).
//   - tickAntMovement: foragers use sampleGradient on their colony's food-trail surface grid.
//     Non-foragers use getTaskDirection placeholder (returns {0,0} — Phase 7 fills pathfinding).
//
// No Math.random, Math.floor, Math.round, Date.now. Use | 0 and >> FP_SHIFT.
// No per-iteration allocations beyond sampleGradient's return object (accepted in Phase 6).
// world.nextEntityId is the upper bound for entity iteration; alive=0 slots are skipped.

import type { WorldState } from '../types.js';
import type { ColonyRecord } from '../colony/colony-store.js';
import type { AntComponents } from './ant-store.js';
import { AntTask, ForagingSubState, PheromoneType } from '../enums.js';
import {
  WORKER_CARRY_CAPACITY,
  FOOD_PICKUP_AMOUNT,
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
} from '../constants.js';
import { FP_SHIFT } from '../fixed.js';
import { Rng } from '../rng.js';
import { depositFoodTrail, sampleGradient } from '../pheromone/pheromone-system.js';
import { pheromoneGridKey } from '../pheromone/pheromone-store.js';

// ---------------------------------------------------------------------------
// antPickupFood — PRD §4c L1093-1104
//
// Transfers min(capacity, pile.amount, FOOD_PICKUP_AMOUNT) from pile to ant.
// Returns amount transferred (0 if no transfer occurred).
//
// Subtask transition rule (PRD §4c L1103):
//   On nonzero transfer → sets ants.subTask[antId] = ForagingSubState.CarryingFood.
//   On zero transfer (capacity-full or empty-pile) → NO transition. subTask unchanged.
//
// pile is a plain {amount: number} object — Phase 6 headless tests use synthetic piles.
// Phase 7 (UNDR-07) adds the FoodPile entity type and the overlap-detection step in tick().
// ---------------------------------------------------------------------------

/**
 * Attempt to pick up food from a pile into an ant's carry inventory.
 *
 * Transfers `min(remaining_capacity, pile.amount, FOOD_PICKUP_AMOUNT)` from pile to ant.
 * On a nonzero transfer, internally transitions the ant to ForagingSubState.CarryingFood
 * per PRD §4c L1103 (caller does NOT flip subTask separately).
 *
 * @param ants   Ant components SoA.
 * @param antId  Entity ID of the forager.
 * @param pile   Food source with a mutable `amount` field.
 * @returns      Amount transferred (0 means no pickup — no transition occurred).
 */
export function antPickupFood(
  ants: AntComponents,
  antId: number,
  pile: { amount: number },
): number {
  const carried = ants.foodCarrying[antId]!;
  const capacity = WORKER_CARRY_CAPACITY - carried;

  if (capacity <= 0) return 0; // already at capacity — no pickup, no transition (PRD §4c L1097)

  const requested = capacity < FOOD_PICKUP_AMOUNT ? capacity : FOOD_PICKUP_AMOUNT;
  const available = pile.amount < requested ? pile.amount : requested;

  if (available <= 0) return 0; // pile empty — no pickup, no transition

  ants.foodCarrying[antId] = carried + available;
  pile.amount -= available;

  // PRD §4c L1103: transition to CarryingFood (food-trail pheromone deposit rule activates)
  ants.subTask[antId] = ForagingSubState.CarryingFood;

  return available;
}

// ---------------------------------------------------------------------------
// antDepositFood — chamberless fallback per PRD §4c + Errata E-01
//
// Transfers ants.foodCarrying[antId] into colony.foodStored.
// Zeros foodCarrying. Writes task=Idle, subTask=0 (idle-checkpoint transition).
//
// Errata E-01 (2026-04-16) is authoritative for the completion-write contract:
//   task = AntTask.Idle, subTask = 0   (NOT SearchingFood as the original §4c stated)
//   Plan 10 step 9 next tick reassigns — back to Foraging+SearchingFood if allocation
//   still demands forage, or to a different task if the triangle shifted.
//
// Phase 7 adds chamber-aware routing (UNDR-07). Phase 6 ships the pooled-only path.
// Early-return if foodCarrying <= 0 (defensive guard per PRD §4c — deposit is only
// called when an ant arrives carrying food; the guard pins exact no-op behavior).
// ---------------------------------------------------------------------------

/**
 * Deposit all food an ant is carrying into the colony food pool.
 *
 * Chamberless fallback (Phase 6): deposits to colony.foodStored directly.
 * Writes AntTask.Idle + subTask=0 (Errata E-01 idle-checkpoint transition).
 * Early-returns if foodCarrying === 0 (no-op; no task transition occurs).
 *
 * @param world    WorldState (reads ants, writes ants.foodCarrying, task, subTask).
 * @param colony   ColonyRecord (writes colony.foodStored).
 * @param antId    Entity ID of the depositing forager.
 */
export function antDepositFood(world: WorldState, colony: ColonyRecord, antId: number): void {
  const amount = world.ants.foodCarrying[antId]!;
  if (amount <= 0) return;

  colony.foodStored += amount;
  world.ants.foodCarrying[antId] = 0;

  // Idle-checkpoint transition per PRD §4c + §7c as revised by Errata E-01 (2026-04-16):
  // on full deposit the action system writes task=Idle, subTask=0. Plan 10 step 9
  // next tick reassigns (back to Foraging+SearchingFood if allocation still demands
  // forage, or to a different task if the triangle shifted).
  world.ants.task[antId] = AntTask.Idle;
  world.ants.subTask[antId] = 0;
}

// ---------------------------------------------------------------------------
// getTaskDirection — Phase 6 placeholder (Open Q1 resolution)
//
// Returns {dx:0, dy:0} for all task/subTask combinations.
// Phase 7 fills in spatial pathfinding (UNDR-02, UNDR-03, SURF-05).
// ---------------------------------------------------------------------------

/**
 * Return the movement direction for a non-forager ant.
 *
 * Phase 6 resolution of Open Q1 (06-RESEARCH.md): all non-forager tasks
 * return {dx:0, dy:0} — stationary. Phase 7 adds spatial pathfinding
 * (UNDR-02, UNDR-03, SURF-05) and fills this function with real logic.
 *
 * @param _task     AntTask discriminant (unused in Phase 6).
 * @param _subTask  Sub-task discriminant (unused in Phase 6).
 * @returns         Zero direction vector.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getTaskDirection(_task: number, _subTask: number): { dx: number; dy: number } {
  return { dx: 0, dy: 0 }; // Phase 7 fills spatial pathfinding
}

// ---------------------------------------------------------------------------
// tickPheromoneDeposit — PRD §8a step 10 + §5b carry-only rule (PHER-03)
//
// Iterates 0..world.nextEntityId. For each alive ant with foodCarrying > 0,
// computes tile position via >> FP_SHIFT, constructs the pheromoneGridKey,
// looks up the grid, and calls depositFoodTrail.
//
// If the grid is missing, the deposit is silently skipped (scenario-dependent presence).
// Dead slots (alive !== 1) are skipped. Non-carrying ants (foodCarrying <= 0) are skipped.
//
// O(nextEntityId) — unused slots skipped via the alive === 1 guard.
// ---------------------------------------------------------------------------

/**
 * Deposit food-trail pheromone for every alive, food-carrying ant.
 *
 * PRD §5b carry-only rule (PHER-03): only ants with foodCarrying > 0 deposit.
 * Deposit targets the colony's food-trail surface grid (Phase 6 hardcoded zone).
 *
 * @param world  WorldState (reads ants, pheromoneGrids).
 */
export function tickPheromoneDeposit(world: WorldState): void {
  const ants = world.ants;

  for (let id = 0; id < world.nextEntityId; id++) {
    if (ants.alive[id] !== 1) continue;
    if (ants.foodCarrying[id]! <= 0) continue;

    const colonyId = ants.colonyId[id]!;
    const tileX = ants.posX[id]! >> FP_SHIFT;
    const tileY = ants.posY[id]! >> FP_SHIFT;
    const key = pheromoneGridKey(colonyId, PheromoneType.FoodTrail, 'surface');
    const grid = world.pheromoneGrids[key];
    if (!grid) continue; // grid missing — silently skip (scenario-dependent presence)

    depositFoodTrail(grid, tileX, tileY);
  }
}

// ---------------------------------------------------------------------------
// tickAntMovement — PRD §8a step 12
//
// For each alive ant:
//   - Foragers (AntTask.Foraging): look up colony's food-trail surface grid,
//     call sampleGradient(grid, tileX, tileY, rng) → {dx, dy}.
//   - Non-foragers: call getTaskDirection(task, subTask) → {dx:0, dy:0} (Phase 6).
//   - Update posX += dx * speed, posY += dy * speed.
//   - Clamp posX to [0, SURFACE_GRID_WIDTH * FP_ONE - 1], posY similarly.
//
// Bounds use << instead of *: (SURFACE_GRID_WIDTH << FP_SHIFT) - 1.
// No Math.floor, no floats, no division. Clamp uses if/else for zero alloc.
// ---------------------------------------------------------------------------

/**
 * Move every alive ant one step based on its current task.
 *
 * Foragers sample the pheromone gradient from their colony's food-trail grid.
 * Non-foragers receive {0,0} direction (Phase 6 placeholder; Phase 7 fills pathfinding).
 * Position is clamped to the surface grid bounds after movement.
 *
 * @param world  WorldState (reads + writes ants, reads pheromoneGrids).
 * @param rng    WorldState Rng instance (passed explicitly — no singletons).
 */
export function tickAntMovement(world: WorldState, rng: Rng): void {
  const ants = world.ants;
  const maxX = (SURFACE_GRID_WIDTH << FP_SHIFT) - 1;
  const maxY = (SURFACE_GRID_HEIGHT << FP_SHIFT) - 1;

  for (let id = 0; id < world.nextEntityId; id++) {
    if (ants.alive[id] !== 1) continue;

    const task = ants.task[id]!;
    let dx: number;
    let dy: number;

    if (task === AntTask.Foraging) {
      const colonyId = ants.colonyId[id]!;
      const tileX = ants.posX[id]! >> FP_SHIFT;
      const tileY = ants.posY[id]! >> FP_SHIFT;
      const key = pheromoneGridKey(colonyId, PheromoneType.FoodTrail, 'surface');
      const grid = world.pheromoneGrids[key];
      if (grid) {
        const dir = sampleGradient(grid, tileX, tileY, rng);
        dx = dir.dx;
        dy = dir.dy;
      } else {
        dx = 0;
        dy = 0;
      }
    } else {
      const dir = getTaskDirection(task, ants.subTask[id]!);
      dx = dir.dx;
      dy = dir.dy;
    }

    const speed = ants.speed[id]!;
    let posX = ants.posX[id]! + dx * speed;
    let posY = ants.posY[id]! + dy * speed;

    // Clamp to SURFACE grid bounds (Phase 6: hardcoded; Phase 7 generalizes per-zone)
    if (posX < 0) posX = 0;
    else if (posX > maxX) posX = maxX;
    if (posY < 0) posY = 0;
    else if (posY > maxY) posY = maxY;

    ants.posX[id] = posX;
    ants.posY[id] = posY;
  }
}
