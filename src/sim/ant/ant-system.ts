// ant-system.ts — PRD §4c + §5b + §8a step 10/12 ant interaction and movement
//
// Implements seven exported functions:
//   antPickupFood        — PRD §4c L1093-1104: pickup from food pile, internal subTask transition
//   antDepositFood       — PRD §4c (Errata E-01): chamber-aware deposit + idle-checkpoint transition
//   getTaskDirection     — PURE direction lookup for non-forager movement (no state mutations)
//   tickDigExecution     — Step-10 dig-worker state machine (Marked→BeingDug→Open)
//   routeForagerPriority — Step-13 forager priority routing to marked food piles
//   tickPheromoneDeposit — PRD §8a step 10 + §5b carry-only rule: deposit food trail per alive carrying ant
//   tickAntMovement      — PRD §8a step 16: gradient-driven forager movement + zone-aware bounds + zone transitions
//
// Key semantic decisions:
//   - antPickupFood: on NONZERO transfer, sets subTask=CarryingFood internally (caller does NOT flip).
//     Zero transfer (capacity-full or empty-pile) must NOT flip subTask (PRD §4c L1097).
//   - antDepositFood: Errata E-01 supersedes original §4c subTask=SearchingFood write.
//     On deposit, writes task=Idle, subTask=0. Plan 10 step 9 reassigns next tick.
//     Phase 7 (UNDR-07): chamber-aware routing when FoodStorage chamber exists.
//   - tickDigExecution: owns the Marked→BeingDug claim and BeingDug→Open countdown.
//     MUST run at step 10 (after idle-reassignment, before checkPendingChambers step 11).
//     MUST NOT be called from tickAntMovement (step 16) — ordering contract is critical.
//   - getTaskDirection: PURE — reads world state, MUST NOT mutate tiles, ant sub-state, or colony flags.
//   - tickPheromoneDeposit: only ants with foodCarrying > 0 AND alive === 1 deposit (§5b carry-only rule).
//   - tickAntMovement: foragers use sampleGradient on their colony's food-trail surface grid.
//     Non-foragers use getTaskDirection (pure, no state transitions).
//     Zone-aware bounds and zone transitions handled here (SURF-05).
//
// No Math.random, Math.floor, Math.round, Date.now. Use | 0 and >> FP_SHIFT.
// No per-iteration allocations beyond sampleGradient's return object (accepted in Phase 6).
// world.nextEntityId is the upper bound for entity iteration; alive=0 slots are skipped.

import type { WorldState } from '../types.js';
import type { ColonyRecord } from '../colony/colony-store.js';
import { AntTask, ForagingSubState, DiggingSubState, NursingSubState, ChamberType, PheromoneType } from '../enums.js';
import {
  WORKER_CARRY_CAPACITY,
  FOOD_PICKUP_AMOUNT,
  FOOD_CHAMBER_CAPACITY,
  DIG_TICKS_PER_TILE,
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
} from '../constants.js';
import { FP_SHIFT } from '../fixed.js';
import { Rng } from '../rng.js';
import { depositFoodTrail, sampleGradient } from '../pheromone/pheromone-system.js';
import { pheromoneGridKey } from '../pheromone/pheromone-store.js';
import type { DigFlowFields } from '../dig-system.js';
import { Zone, UndergroundTileState, ugGet, ugSet } from '../terrain.js';

// ---------------------------------------------------------------------------
// Direction tables for dig flow-field to dx/dy conversion
// Flow-field direction encoding: 0=N, 1=E, 2=S, 3=W
// ---------------------------------------------------------------------------
const DIR_DX = [0, 1, 0, -1] as const;  // N, E, S, W
const DIR_DY = [-1, 0, 1, 0] as const;  // N, E, S, W

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
  ants: WorldState['ants'],
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
// antDepositFood — chamber-aware routing per UNDR-07 + chamberless fallback
//
// Transfers ants.foodCarrying[antId] into colony food storage.
// Zeros foodCarrying. Writes task=Idle, subTask=0 (idle-checkpoint transition).
//
// Errata E-01 (2026-04-16) is authoritative for the completion-write contract:
//   task = AntTask.Idle, subTask = 0   (NOT SearchingFood as the original §4c stated)
//   Plan 10 step 9 next tick reassigns — back to Foraging+SearchingFood if allocation
//   still demands forage, or to a different task if the triangle shifted.
//
// Phase 7 (UNDR-07): if colony has a FoodStorage chamber, route food there first.
//   - Overflow (if chamber is full or multiple chambers) goes to colony.foodStored.
//   - Chamberless fallback (Phase 6 behavior) preserved when no FoodStorage chamber exists.
// Early-return if foodCarrying <= 0 (defensive guard per PRD §4c — deposit is only
// called when an ant arrives carrying food; the guard pins exact no-op behavior).
// ---------------------------------------------------------------------------

/**
 * Deposit all food an ant is carrying into the colony food store.
 *
 * Phase 7 (UNDR-07): routes to food storage chamber when one exists.
 * Chamberless fallback (Phase 6): deposits to colony.foodStored directly.
 * Writes AntTask.Idle + subTask=0 (Errata E-01 idle-checkpoint transition).
 * Early-returns if foodCarrying === 0 (no-op; no task transition occurs).
 *
 * @param world    WorldState (reads ants, writes ants.foodCarrying, task, subTask).
 * @param colony   ColonyRecord (writes chamber.foodStored or colony.foodStored).
 * @param antId    Entity ID of the depositing forager.
 */
export function antDepositFood(world: WorldState, colony: ColonyRecord, antId: number): void {
  const amount = world.ants.foodCarrying[antId]!;
  if (amount <= 0) return;

  let remaining = amount;

  // Phase 7 UNDR-07: chamber-aware routing
  for (let i = 0; i < colony.chambers.length && remaining > 0; i++) {
    const chamber = colony.chambers[i]!;
    if (chamber.chamberType !== ChamberType.FoodStorage) continue;

    const space = FOOD_CHAMBER_CAPACITY - chamber.foodStored;
    if (space <= 0) continue; // this chamber is full — try next

    const toDeposit = remaining < space ? remaining : space;
    chamber.foodStored += toDeposit;
    remaining -= toDeposit;
    break; // deposit to first available food chamber, overflow to colony pool
  }

  // Chamberless fallback (Phase 6 behavior) — also handles overflow from full chambers
  if (remaining > 0) {
    colony.foodStored += remaining;
  }

  world.ants.foodCarrying[antId] = 0;

  // Idle-checkpoint transition per PRD §4c + §7c as revised by Errata E-01 (2026-04-16):
  // on full deposit the action system writes task=Idle, subTask=0. Plan 10 step 9
  // next tick reassigns (back to Foraging+SearchingFood if allocation still demands
  // forage, or to a different task if the triangle shifted).
  world.ants.task[antId] = AntTask.Idle;
  world.ants.subTask[antId] = 0;
}

// ---------------------------------------------------------------------------
// getTaskDirection — PURE direction lookup (no state mutations)
//
// Returns the movement direction for a non-forager ant based on task/subTask.
// PURE: reads world state and flow-field, MUST NOT mutate tiles, ant sub-state,
// or colony flags. All dig-worker state transitions (Marked→BeingDug claim,
// BeingDug→Open excavation) live in tickDigExecution at step 10.
// ---------------------------------------------------------------------------

/**
 * Compute movement direction for a non-forager ant based on task and context.
 * PURE — reads world state but MUST NOT mutate tiles, ant sub-state, or colony flags.
 * All dig-worker state transitions (Marked→BeingDug claim, BeingDug→Open open)
 * live in `tickDigExecution` and run at tick step 10 per accepted Phase 3 PRD §9a.
 *
 * Dig workers in MovingToTile: read flow-field direction, convert to dx/dy.
 *   Direction=-1 (ant is ON the Marked tile) → return {0,0} so the ant holds
 *   position until step 10 claims the tile next tick.
 * Dig workers in Excavating: return {0,0} (stationary while digging).
 * Nursing ants: move toward nearest nursery or queen chamber tile (Manhattan).
 *   If no such chamber, {0,0}.
 * Fighting ants: {0,0} (Phase 9 fills rally logic).
 * Idle ants: {0,0} (awaiting task assignment).
 *
 * @param world         WorldState (reads ants, colonies, undergroundGrids).
 * @param antId         Entity ID of the ant.
 * @param digFlowFields Per-colony flow-field cache.
 * @returns             Direction vector {dx, dy}.
 */
export function getTaskDirection(
  world: WorldState,
  antId: number,
  digFlowFields: DigFlowFields,
): { dx: number; dy: number } {
  const ants = world.ants;
  const task = ants.task[antId]!;
  const subTask = ants.subTask[antId]!;

  if (task === AntTask.Digging) {
    if (subTask === DiggingSubState.Excavating) {
      // Stationary while digging — countdown happens in tickDigExecution at step 10
      return { dx: 0, dy: 0 };
    }

    // MovingToTile: read flow-field direction
    const colonyId = ants.colonyId[antId]!;
    const flowField = digFlowFields.fields[colonyId];
    if (!flowField) return { dx: 0, dy: 0 };

    const underground = world.undergroundGrids[colonyId];
    if (!underground) return { dx: 0, dy: 0 };

    const tileX = ants.posX[antId]! >> FP_SHIFT;
    const tileY = ants.posY[antId]! >> FP_SHIFT;
    const direction = flowField[tileY * underground.width + tileX];

    if (direction === undefined || direction === -1 || direction === -2) {
      // -1 = source (ant is ON Marked tile, claim happens in tickDigExecution)
      // -2 = unreachable
      return { dx: 0, dy: 0 };
    }

    return { dx: DIR_DX[direction]!, dy: DIR_DY[direction]! };
  }

  if (task === AntTask.Nursing) {
    // Move toward nearest nursery or queen chamber tile (Manhattan distance)
    const colonyId = ants.colonyId[antId]!;
    const colony = world.colonies[colonyId];
    if (!colony || colony.chambers.length === 0) return { dx: 0, dy: 0 };

    const antTileX = ants.posX[antId]! >> FP_SHIFT;
    const antTileY = ants.posY[antId]! >> FP_SHIFT;

    let bestDx = 0;
    let bestDy = 0;
    let bestDist = -1;

    for (let i = 0; i < colony.chambers.length; i++) {
      const chamber = colony.chambers[i]!;
      const ct = chamber.chamberType;
      if (ct !== (0 as typeof ChamberType.Queen) && ct !== (1 as typeof ChamberType.Nursery)) continue;

      const chamberTileX = chamber.posX >> FP_SHIFT;
      const chamberTileY = chamber.posY >> FP_SHIFT;
      const dist = Math.abs(antTileX - chamberTileX) + Math.abs(antTileY - chamberTileY);

      if (bestDist < 0 || dist < bestDist) {
        bestDist = dist;
        // Compute unit direction step
        const rawDx = chamberTileX - antTileX;
        const rawDy = chamberTileY - antTileY;
        // Prefer axis with greater distance; if equal pick X
        if (Math.abs(rawDx) >= Math.abs(rawDy)) {
          bestDx = rawDx > 0 ? 1 : rawDx < 0 ? -1 : 0;
          bestDy = 0;
        } else {
          bestDx = 0;
          bestDy = rawDy > 0 ? 1 : rawDy < 0 ? -1 : 0;
        }
      }
    }

    return { dx: bestDx, dy: bestDy };
  }

  // Fighting, Idle, and anything else: stationary
  return { dx: 0, dy: 0 };
}

// ---------------------------------------------------------------------------
// tickDigExecution — step-10 dig-worker state machine (PRD §9a)
//
// Owns the Marked→BeingDug claim and BeingDug→Open countdown.
// Called from tick.ts step 10, AFTER existing idle-reassignment,
// BEFORE step 11 checkPendingChambers / step 12 checkEntranceCompletion.
//
// CRITICAL ordering: do NOT call this from tickAntMovement (step 16) —
// that would break the same-tick chamber/entrance completion semantics.
// ---------------------------------------------------------------------------

/**
 * Step-10 dig-worker execution. Owns the Marked→BeingDug→Open state machine.
 * Called from tick.ts step 10, after the existing idle-reassignment worker allocation,
 * and BEFORE step 11 checkPendingChambers / step 12 checkEntranceCompletion — those
 * steps depend on this tick's transitions having already happened (accepted Phase 3 PRD §9b).
 *
 * For each alive ant with task === AntTask.Digging:
 *   - DiggingSubState.MovingToTile: read flow-field at ant's current tile.
 *     If direction === -1 (ant is ON the Marked tile): claim it.
 *       ugSet(underground, tileX, tileY, UndergroundTileState.BeingDug);
 *       colony.digFlowFieldDirty = true;
 *       ants.digTileX[id] = tileX; ants.digTileY[id] = tileY;
 *       ants.digTicksRemaining[id] = DIG_TICKS_PER_TILE;
 *       ants.subTask[id] = DiggingSubState.Excavating;
 *     Otherwise: no-op (the ant will move toward the Marked tile in step 16).
 *
 *   - DiggingSubState.Excavating: decrement ants.digTicksRemaining[id].
 *     If it reaches 0:
 *       ugSet(underground, digTileX, digTileY, UndergroundTileState.Open);
 *       colony.digFlowFieldDirty = true;
 *       ants.digTileX[id] = -1; ants.digTileY[id] = -1;
 *       ants.subTask[id] = DiggingSubState.MovingToTile;
 *
 * @param world          WorldState (reads/writes ants, undergroundGrids, colonies).
 * @param digFlowFields  Per-colony flow-field cache (reads fields for direction lookup).
 */
export function tickDigExecution(
  world: WorldState,
  digFlowFields: DigFlowFields,
): void {
  const ants = world.ants;

  for (let id = 0; id < world.nextEntityId; id++) {
    if (ants.alive[id] !== 1) continue;
    if (ants.task[id] !== AntTask.Digging) continue;
    // Dig workers must be underground
    if (ants.zone[id] !== Zone.Underground) continue;

    const colonyId = ants.colonyId[id]!;
    const colony = world.colonies[colonyId];
    if (!colony) continue;

    const underground = world.undergroundGrids[colonyId];
    if (!underground) continue;

    const subTask = ants.subTask[id]!;

    if (subTask === DiggingSubState.MovingToTile) {
      // Check flow-field to see if ant is ON a Marked tile
      const flowField = digFlowFields.fields[colonyId];
      if (!flowField) continue;

      const tileX = ants.posX[id]! >> FP_SHIFT;
      const tileY = ants.posY[id]! >> FP_SHIFT;
      const direction = flowField[tileY * underground.width + tileX];

      if (direction === -1) {
        // Ant is ON the Marked tile — claim it
        ugSet(underground, tileX, tileY, UndergroundTileState.BeingDug);
        colony.digFlowFieldDirty = true;
        ants.digTileX[id] = tileX;
        ants.digTileY[id] = tileY;
        ants.digTicksRemaining[id] = DIG_TICKS_PER_TILE;
        ants.subTask[id] = DiggingSubState.Excavating;
      }
      // Otherwise: no-op (ant will move toward Marked tile in step 16 movement)

    } else if (subTask === DiggingSubState.Excavating) {
      // Decrement countdown
      const remaining = ants.digTicksRemaining[id]!;
      if (remaining <= 0) continue; // guard against unexpected state

      const newRemaining = remaining - 1;
      ants.digTicksRemaining[id] = newRemaining;

      if (newRemaining === 0) {
        // Excavation complete — open the tile
        const digTileX = ants.digTileX[id]!;
        const digTileY = ants.digTileY[id]!;
        ugSet(underground, digTileX, digTileY, UndergroundTileState.Open);
        colony.digFlowFieldDirty = true;
        ants.digTileX[id] = -1;
        ants.digTileY[id] = -1;
        ants.subTask[id] = DiggingSubState.MovingToTile;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// routeForagerPriority — step-13 forager priority routing (PRD §5a)
//
// For each Foraging ant in SearchingFood sub-state:
//   - If any food pile has isMarkedPriority=true, set ant's targetPosX/Y to nearest.
//   - If no marked piles, clear targetPosX/Y to -1.
//
// Tie-breaking: lower foodPileId wins (determinism, per RESEARCH.md).
// ---------------------------------------------------------------------------

/**
 * For each Foraging ant in SearchingFood sub-state:
 *   - If any food pile has isMarkedPriority=true, set ant's targetPosX/Y to the nearest
 *     marked pile (Manhattan distance). Lower foodPileId breaks ties (deterministic).
 *   - If no marked piles, clear targetPosX/Y to -1 (fall through to pheromone gradient).
 *
 * @param world  WorldState (reads ants, foodPiles; writes ants.targetPosX/Y).
 */
export function routeForagerPriority(world: WorldState): void {
  const ants = world.ants;
  const foodPiles = world.foodPiles;

  // Pre-filter: find marked piles once before the ant loop
  // (avoid re-scanning piles for every ant)
  let hasMarked = false;
  for (let p = 0; p < foodPiles.length; p++) {
    if (foodPiles[p]!.isMarkedPriority) {
      hasMarked = true;
      break;
    }
  }

  for (let id = 0; id < world.nextEntityId; id++) {
    if (ants.alive[id] !== 1) continue;
    if (ants.task[id] !== AntTask.Foraging) continue;
    if (ants.subTask[id] !== ForagingSubState.SearchingFood) continue;

    if (!hasMarked) {
      // No marked piles — clear target
      ants.targetPosX[id] = -1;
      ants.targetPosY[id] = -1;
      continue;
    }

    const antTileX = ants.posX[id]! >> FP_SHIFT;
    const antTileY = ants.posY[id]! >> FP_SHIFT;

    let bestPileId = -1;
    let bestDist = -1;
    let bestTileX = 0;
    let bestTileY = 0;

    for (let p = 0; p < foodPiles.length; p++) {
      const pile = foodPiles[p]!;
      if (!pile.isMarkedPriority) continue;

      const dist = Math.abs(antTileX - pile.tileX) + Math.abs(antTileY - pile.tileY);

      if (
        bestPileId === -1 ||
        dist < bestDist ||
        (dist === bestDist && pile.foodPileId < bestPileId)
      ) {
        bestPileId = pile.foodPileId;
        bestDist = dist;
        bestTileX = pile.tileX;
        bestTileY = pile.tileY;
      }
    }

    if (bestPileId !== -1) {
      ants.targetPosX[id] = bestTileX << FP_SHIFT;
      ants.targetPosY[id] = bestTileY << FP_SHIFT;
    } else {
      ants.targetPosX[id] = -1;
      ants.targetPosY[id] = -1;
    }
  }
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
// tickAntMovement — PRD §8a step 16 (zone-aware, SURF-05)
//
// For each alive ant:
//   - Foragers: check targetPosX/Y for priority target; otherwise use pheromone gradient.
//   - Non-foragers: call pure getTaskDirection(world, id, digFlowFields) → {dx, dy}.
//     (No dig state transitions here — those are in tickDigExecution at step 10.)
//   - Update posX += dx * speed, posY += dy * speed.
//   - Clamp posX/posY to zone-appropriate bounds (Surface or Underground).
//   - Apply zone transitions (Surface ↔ Underground) via open entrances (PRD §5d).
//
// Bounds use << instead of *: (GRID_WIDTH << FP_SHIFT) - 1.
// No Math.floor, no floats, no division. Clamp uses if/else for zero alloc.
// ---------------------------------------------------------------------------

/**
 * Move every alive ant one step based on its current task and zone.
 *
 * Foragers sample the pheromone gradient (or follow priority target if set).
 * Non-foragers receive direction from pure getTaskDirection.
 * Position is clamped to zone-appropriate grid bounds after movement.
 * Zone transitions applied after position update (PRD §5d — Pitfall 6).
 *
 * IMPORTANT: tickDigExecution MUST have already run this tick (step 10).
 * This function MUST NOT perform any dig state transitions — it only moves ants.
 *
 * @param world          WorldState (reads + writes ants, reads pheromoneGrids, undergroundGrids, colonies).
 * @param rng            WorldState Rng instance (passed explicitly — no singletons).
 * @param digFlowFields  Per-colony flow-field cache (passed to getTaskDirection for dig workers).
 */
export function tickAntMovement(world: WorldState, rng: Rng, digFlowFields: DigFlowFields): void {
  const ants = world.ants;
  const surfaceMaxX = (SURFACE_GRID_WIDTH << FP_SHIFT) - 1;
  const surfaceMaxY = (SURFACE_GRID_HEIGHT << FP_SHIFT) - 1;
  const undergroundMaxX = (UNDERGROUND_GRID_WIDTH << FP_SHIFT) - 1;
  const undergroundMaxY = (UNDERGROUND_GRID_HEIGHT << FP_SHIFT) - 1;

  for (let id = 0; id < world.nextEntityId; id++) {
    if (ants.alive[id] !== 1) continue;

    const task = ants.task[id]!;
    const zone = ants.zone[id]!;
    let dx: number;
    let dy: number;

    if (task === AntTask.Foraging) {
      // Check for priority target (set by routeForagerPriority at step 13)
      const targetX = ants.targetPosX[id]!;
      const targetY = ants.targetPosY[id]!;

      if (targetX !== -1 && targetY !== -1) {
        // Move toward priority target
        const posX = ants.posX[id]!;
        const posY = ants.posY[id]!;
        const rawDx = targetX - posX;
        const rawDy = targetY - posY;
        // Unit step toward target
        if (Math.abs(rawDx) >= Math.abs(rawDy)) {
          dx = rawDx > 0 ? 1 : rawDx < 0 ? -1 : 0;
          dy = 0;
        } else {
          dx = 0;
          dy = rawDy > 0 ? 1 : rawDy < 0 ? -1 : 0;
        }
      } else {
        // No priority target — use pheromone gradient
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
      }
    } else {
      // Non-forager: pure direction lookup (NO state mutations)
      const dir = getTaskDirection(world, id, digFlowFields);
      dx = dir.dx;
      dy = dir.dy;
    }

    const speed = ants.speed[id]!;
    let posX = ants.posX[id]! + dx * speed;
    let posY = ants.posY[id]! + dy * speed;

    // Clamp to zone-appropriate bounds
    if (zone === Zone.Underground) {
      if (posX < 0) posX = 0;
      else if (posX > undergroundMaxX) posX = undergroundMaxX;
      if (posY < 0) posY = 0;
      else if (posY > undergroundMaxY) posY = undergroundMaxY;
    } else {
      // Zone.Surface (default)
      if (posX < 0) posX = 0;
      else if (posX > surfaceMaxX) posX = surfaceMaxX;
      if (posY < 0) posY = 0;
      else if (posY > surfaceMaxY) posY = surfaceMaxY;
    }

    ants.posX[id] = posX;
    ants.posY[id] = posY;

    // --- Zone transitions (PRD §5d — applied AFTER position update) ---
    // Surface → Underground: ant on surface at an open entrance, task requires underground
    if (zone === Zone.Surface) {
      const needsUnderground =
        task === AntTask.Digging ||
        task === AntTask.Nursing ||
        (task === AntTask.Foraging && ants.subTask[id] === ForagingSubState.CarryingFood);

      if (needsUnderground) {
        const tileX = posX >> FP_SHIFT;
        const tileY = posY >> FP_SHIFT;
        const colonyId = ants.colonyId[id]!;
        const colony = world.colonies[colonyId];
        if (colony) {
          for (let e = 0; e < colony.entrances.length; e++) {
            const entrance = colony.entrances[e]!;
            if (entrance.isOpen && entrance.surfaceTileX === tileX && entrance.surfaceTileY === tileY) {
              ants.zone[id] = Zone.Underground;
              ants.posY[id] = 0; // enter at top of underground grid
              break;
            }
          }
        }
      }
    } else if (zone === Zone.Underground) {
      // Underground → Surface: ant at tileY=0 at an open entrance, task requires surface
      const needsSurface =
        task === AntTask.Idle ||
        (task === AntTask.Foraging && ants.subTask[id] === ForagingSubState.SearchingFood);

      if (needsSurface) {
        const tileX = posX >> FP_SHIFT;
        const tileY = posY >> FP_SHIFT;

        if (tileY === 0) {
          const colonyId = ants.colonyId[id]!;
          const colony = world.colonies[colonyId];
          if (colony) {
            for (let e = 0; e < colony.entrances.length; e++) {
              const entrance = colony.entrances[e]!;
              if (entrance.isOpen && entrance.surfaceTileX === tileX) {
                ants.zone[id] = Zone.Surface;
                ants.posY[id] = entrance.surfaceTileY << FP_SHIFT;
                break;
              }
            }
          }
        }
      }
    }
  }
}
