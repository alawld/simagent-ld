// src/sim/tick.ts — Phase 7 17-step tick dispatcher per PRD §9a.
import type { WorldState } from './types.js';
import { allocateEntityId } from './types.js';
import { MAX_COMMANDS_PER_TICK, type SimCommand } from './commands.js';
import { GameOutcome } from './game-over.js';
import { Rng } from './rng.js';
import {
  AntTask,
  ForagingSubState,
  DiggingSubState,
  NursingSubState,
  FightingSubState,
  PheromoneType,
} from './enums.js';
import {
  PHEROMONE_DECAY_FP,
  DANGER_DECAY_FP,
  MAX_ENTRANCES_PER_COLONY,
  ENTRANCE_SHAFT_DEPTH,
  UNDERGROUND_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
} from './constants.js';
import { FP_SHIFT } from './fixed.js';
import { allocateWorkers } from './behavior/allocation-system.js';
import {
  tickReconcile,
  tickFoodConsumption,
  tickStarvationCheck,
  tickDeathCleanup,
  tickDeadDiggerCleanup,
  checkPendingChambers,
  checkEntranceCompletion,
} from './colony/colony-system.js';
import {
  tickQueenEggProduction,
  tickLifecycleTransitions,
} from './colony/lifecycle-system.js';
import {
  tickPheromoneDeposit,
  tickAntMovement,
  tickDigExecution,
  routeForagerPriority,
} from './ant/ant-system.js';
import { tickPheromoneDecay } from './pheromone/pheromone-system.js';
import {
  computeDigFlowField,
  ensureDigFlowField,
  createDigFlowFields,
} from './dig-system.js';
import type { DigFlowFields } from './dig-system.js';
import { ugGet, ugSet, UndergroundTileState } from './terrain.js';
import { CHAMBER_DIMENSIONS } from './colony/chamber.js';
import type { PendingChamber } from './colony/chamber.js';
import type { ColonyId } from './colony/colony-store.js';

// ---------------------------------------------------------------------------
// Module-level scratch state — persists across ticks, not part of WorldState.
// Created once at module load. Per Open Question 1 in RESEARCH.md.
// Plan 08 replaces the Phase 06 _stubDigFlowFields with this properly-populated instance.
// ---------------------------------------------------------------------------
const digFlowFields: DigFlowFields = createDigFlowFields();

// Suppress unused-import TS error for PendingChamber (used in PlaceChamber case shape)
void (undefined as unknown as PendingChamber);

/**
 * Advance the simulation by one tick — 17-step PRD §9a dispatcher.
 *
 * Step order:
 *  1.  Process commands (FIFO cap: MAX_COMMANDS_PER_TICK; unknown variants silently dropped)
 *       Extended in Phase 7: real MarkDigTile, MarkFoodPile handlers;
 *       new CancelDigMark, PlaceChamber, DesignateEntrance handlers.
 *  2.  Reconcile colony stats
 *  3.  Food consumption
 *  4.  Starvation check
 *  5.  Death cleanup (per-colony) + dead-digger tile reversion (global post-pass, NEW in Phase 7)
 *  6.  Queen egg production
 *  7.  Lifecycle transitions
 *  8.  Behavior allocation (re-run per colony after lifecycle changes)
 *  9.  Recompute dig flow-fields for colonies with dirty flag (NEW in Phase 7)
 * 10.  Task assignment:
 *       10a. existing Phase 6 idle-reassignment
 *       10b. tickDigExecution — dig-worker state machine (Marked→BeingDug→Open) (NEW in Phase 7)
 * 11.  checkPendingChambers — promote fully-excavated pending chambers (NEW in Phase 7)
 * 12.  checkEntranceCompletion — enable completed entrance shafts (NEW in Phase 7)
 * 13.  routeForagerPriority — route SearchingFood foragers to marked piles (NEW in Phase 7)
 * 14.  Pheromone deposit
 * 15.  Pheromone decay
 * 16.  Movement (zone-aware, extended in Phase 7 with DigFlowFields for pure direction reads)
 * 17.  rngState writeback + world.tick increment
 *
 * tick() retains its accepted Phase 4 2-arg signature.
 * DigFlowFields is module-level scratch state, invisible to callers.
 *
 * @param world    - Mutable world state; mutated in place across all 17 steps.
 * @param commands - Point-in-time snapshot of commands for this tick. Not mutated.
 *                   Commands beyond MAX_COMMANDS_PER_TICK are silently dropped FIFO (PRD §5).
 * @returns GameOutcome.None (always in Phase 7; win/lose checks are Phase 9 scope).
 */
export function tick(world: WorldState, commands: readonly SimCommand[]): GameOutcome {
  // Reconstruct Rng from saved state at tick start (PRD §4 contract).
  const rng = new Rng(world.rngState);

  // ---------------------------------------------------------------------------
  // Step 1: Process commands (FIFO cap — PRD §5; indexed loop, no allocation)
  //         Extended in Phase 7 with real handlers for all 7 SimCommand variants.
  // ---------------------------------------------------------------------------
  const limit = commands.length < MAX_COMMANDS_PER_TICK ? commands.length : MAX_COMMANDS_PER_TICK;

  for (let i = 0; i < limit; i++) {
    const cmd = commands[i]!;
    switch (cmd.type) {
      case 'NoOp':
        // No state change — by definition a no-op.
        break;
      case 'SetBehaviorRatio': {
        // Colony lookup; silently skip if colony does not exist (PRD §5 T-01-02).
        const colony = world.colonies[cmd.colonyId];
        if (colony === undefined) break;
        // Validate ratio fields: any negative weight rejects the command.
        if (cmd.ratio.forage < 0 || cmd.ratio.dig < 0 || cmd.ratio.fight < 0) break;
        // Field-by-field copy to preserve object identity for copyWorldState determinism.
        colony.targetRatio.forage = cmd.ratio.forage;
        colony.targetRatio.dig    = cmd.ratio.dig;
        colony.targetRatio.fight  = cmd.ratio.fight;
        // CTRL-04: run allocateWorkers immediately in the same tick the command is issued.
        const brood0 = colony.eggCount + colony.larvaeCount;
        const alloc0 = allocateWorkers(colony.workerCount, brood0, colony.targetRatio);
        colony.computedAllocation.nurse  = alloc0.nurse;
        colony.computedAllocation.forage = alloc0.forage;
        colony.computedAllocation.dig    = alloc0.dig;
        colony.computedAllocation.fight  = alloc0.fight;
        colony.nurseCount = alloc0.nurse;
        break;
      }
      case 'MarkDigTile': {
        // PRD §3a — mark a Solid tile for excavation; silently drop non-Solid or out-of-bounds.
        const underground = world.undergroundGrids[cmd.colonyId];
        if (!underground) break;
        // T-07-10: bounds check (mitigate tamper — reject out-of-range silently)
        if (cmd.tileX < 0 || cmd.tileX >= UNDERGROUND_GRID_WIDTH || cmd.tileY < 0 || cmd.tileY >= UNDERGROUND_GRID_HEIGHT) break;
        if (ugGet(underground, cmd.tileX, cmd.tileY) !== UndergroundTileState.Solid) break;
        ugSet(underground, cmd.tileX, cmd.tileY, UndergroundTileState.Marked);
        const colony1 = world.colonies[cmd.colonyId];
        if (colony1) colony1.digFlowFieldDirty = true;   // typed field (Plan 03 Task 1)
        break;
      }
      case 'MarkFoodPile': {
        // PRD §3d — toggle isMarkedPriority on the matching food pile.
        for (const pile of world.foodPiles) {
          if (pile.tileX === cmd.tileX && pile.tileY === cmd.tileY) {
            pile.isMarkedPriority = !pile.isMarkedPriority;
            break;
          }
        }
        break;
      }
      case 'CancelDigMark': {
        // PRD §3b — cancel a Marked tile (only Marked — NOT BeingDug; finish-then-switch rule per CTRL-04).
        const underground = world.undergroundGrids[cmd.colonyId];
        if (!underground) break;
        if (cmd.tileX < 0 || cmd.tileX >= UNDERGROUND_GRID_WIDTH || cmd.tileY < 0 || cmd.tileY >= UNDERGROUND_GRID_HEIGHT) break;
        if (ugGet(underground, cmd.tileX, cmd.tileY) !== UndergroundTileState.Marked) break;
        ugSet(underground, cmd.tileX, cmd.tileY, UndergroundTileState.Solid);
        const colony2 = world.colonies[cmd.colonyId];
        if (colony2) colony2.digFlowFieldDirty = true;   // typed field (Plan 03 Task 1)
        break;
      }
      case 'PlaceChamber': {
        // PRD §3c — place a chamber footprint at a tunnel end; marks Solid tiles; creates PendingChamber.
        const underground = world.undergroundGrids[cmd.colonyId];
        if (!underground) break;
        const dims = CHAMBER_DIMENSIONS[cmd.chamberType];
        if (!dims) break;
        // (a)(b) Bounds check (T-07-11 first guard)
        if (cmd.anchorTileX < 0 || cmd.anchorTileX + dims.width > UNDERGROUND_GRID_WIDTH) break;
        if (cmd.anchorTileY < 0 || cmd.anchorTileY + dims.height > UNDERGROUND_GRID_HEIGHT) break;
        const colony3 = world.colonies[cmd.colonyId];
        if (!colony3) break;
        // (c) Anchor tile must be Open (tunnel-end check, UNDR-04)
        if (ugGet(underground, cmd.anchorTileX, cmd.anchorTileY) !== UndergroundTileState.Open) break;
        // (d) At least one 4-connected neighbor of the anchor must be Solid (tunnel-end check)
        {
          let hasAdjacentSolid = false;
          const ax = cmd.anchorTileX;
          const ay = cmd.anchorTileY;
          if (ax - 1 >= 0                        && ugGet(underground, ax - 1, ay) === UndergroundTileState.Solid) hasAdjacentSolid = true;
          if (!hasAdjacentSolid && ax + 1 < UNDERGROUND_GRID_WIDTH  && ugGet(underground, ax + 1, ay) === UndergroundTileState.Solid) hasAdjacentSolid = true;
          if (!hasAdjacentSolid && ay - 1 >= 0                      && ugGet(underground, ax,     ay - 1) === UndergroundTileState.Solid) hasAdjacentSolid = true;
          if (!hasAdjacentSolid && ay + 1 < UNDERGROUND_GRID_HEIGHT && ugGet(underground, ax,     ay + 1) === UndergroundTileState.Solid) hasAdjacentSolid = true;
          if (!hasAdjacentSolid) break;
        }
        // (e) No footprint tile may be BeingDug (conflict with active excavation)
        {
          let conflictsBeingDug = false;
          for (let dy = 0; dy < dims.height && !conflictsBeingDug; dy++) {
            for (let dx = 0; dx < dims.width; dx++) {
              if (ugGet(underground, cmd.anchorTileX + dx, cmd.anchorTileY + dy) === UndergroundTileState.BeingDug) {
                conflictsBeingDug = true;
                break;
              }
            }
          }
          if (conflictsBeingDug) break;
        }
        // (h) pendingChambers key at this anchor must not already exist
        const newPcKey = `${cmd.colonyId}:${cmd.anchorTileX}:${cmd.anchorTileY}`;
        if (Object.hasOwn(world.pendingChambers, newPcKey)) break;
        // (g) Overlap with existing ChamberRecord footprint
        let overlaps = false;
        for (const ch of colony3.chambers) {
          const chTileX = ch.posX >> FP_SHIFT;
          const chTileY = ch.posY >> FP_SHIFT;
          if (cmd.anchorTileX < chTileX + ch.width && cmd.anchorTileX + dims.width > chTileX &&
              cmd.anchorTileY < chTileY + ch.height && cmd.anchorTileY + dims.height > chTileY) {
            overlaps = true; break;
          }
        }
        if (overlaps) break;
        // (f) Overlap with same-colony PendingChamber footprint
        for (const pcKey in world.pendingChambers) {
          if (!Object.hasOwn(world.pendingChambers, pcKey)) continue;
          const pc = world.pendingChambers[pcKey]!;
          if (pc.colonyId !== cmd.colonyId) continue;
          if (cmd.anchorTileX < pc.anchorTileX + pc.width && cmd.anchorTileX + dims.width > pc.anchorTileX &&
              cmd.anchorTileY < pc.anchorTileY + pc.height && cmd.anchorTileY + dims.height > pc.anchorTileY) {
            overlaps = true; break;
          }
        }
        if (overlaps) break;
        // All checks passed — mark footprint Solid tiles and create PendingChamber
        for (let dy = 0; dy < dims.height; dy++) {
          for (let dx = 0; dx < dims.width; dx++) {
            const tx = cmd.anchorTileX + dx;
            const ty = cmd.anchorTileY + dy;
            if (ugGet(underground, tx, ty) === UndergroundTileState.Solid) {
              ugSet(underground, tx, ty, UndergroundTileState.Marked);
            }
          }
        }
        world.pendingChambers[newPcKey] = {
          colonyId:    cmd.colonyId,
          chamberType: cmd.chamberType,
          anchorTileX: cmd.anchorTileX,
          anchorTileY: cmd.anchorTileY,
          width:       dims.width,
          height:      dims.height,
        };
        colony3.digFlowFieldDirty = true;   // typed field (Plan 03 Task 1)
        break;
      }
      case 'DesignateEntrance': {
        // PRD §3g — designate a new nest entrance; auto-marks shaft tiles.
        const colony4 = world.colonies[cmd.colonyId];
        if (!colony4) break;
        const underground = world.undergroundGrids[cmd.colonyId];
        if (!underground) break;
        // Surface-coord bounds (PRD §3g silent-drop first bullet)
        if (cmd.surfaceTileX < 0 || cmd.surfaceTileX >= SURFACE_GRID_WIDTH) break;
        if (cmd.surfaceTileY < 0 || cmd.surfaceTileY >= SURFACE_GRID_HEIGHT) break;
        // T-07-12: cap check (mitigate tamper — prevent unbounded entrance creation)
        if (colony4.entrances.length >= MAX_ENTRANCES_PER_COLONY) break;
        // Column uniqueness — same surfaceTileX collapses in underground view (PRD §3g)
        {
          let duplicateColumn = false;
          for (let e = 0; e < colony4.entrances.length; e++) {
            if (colony4.entrances[e]!.surfaceTileX === cmd.surfaceTileX) {
              duplicateColumn = true;
              break;
            }
          }
          if (duplicateColumn) break;
        }
        // Food-pile collision (PRD §3g — commands are authoritative)
        {
          let onFoodPile = false;
          for (let p = 0; p < world.foodPiles.length; p++) {
            const pile = world.foodPiles[p]!;
            if (pile.tileX === cmd.surfaceTileX && pile.tileY === cmd.surfaceTileY) {
              onFoodPile = true;
              break;
            }
          }
          if (onFoodPile) break;
        }
        // Colony rally-point collision
        if (colony4.rallyPoint !== null &&
            colony4.rallyPoint.tileX === cmd.surfaceTileX &&
            colony4.rallyPoint.tileY === cmd.surfaceTileY) break;
        // Another colony's entrance already occupies this surface tile
        {
          let occupiedByOther = false;
          for (const otherKey in world.colonies) {
            if (!Object.hasOwn(world.colonies, otherKey)) continue;
            const other = world.colonies[otherKey as unknown as ColonyId]!;
            if (other.colonyId === cmd.colonyId) continue;
            if (!other.entrances) continue;
            for (let e = 0; e < other.entrances.length; e++) {
              const oe = other.entrances[e]!;
              if (oe.surfaceTileX === cmd.surfaceTileX && oe.surfaceTileY === cmd.surfaceTileY) {
                occupiedByOther = true;
                break;
              }
            }
            if (occupiedByOther) break;
          }
          if (occupiedByOther) break;
        }
        // Create entrance (not yet open)
        colony4.entrances.push({
          entranceId:   allocateEntityId(world),
          surfaceTileX: cmd.surfaceTileX,
          surfaceTileY: cmd.surfaceTileY,
          isOpen:       false,
        });
        // Auto-mark shaft tiles (tileY=0 .. ENTRANCE_SHAFT_DEPTH-1 at surfaceTileX) for excavation
        for (let sy = 0; sy < ENTRANCE_SHAFT_DEPTH; sy++) {
          if (ugGet(underground, cmd.surfaceTileX, sy) === UndergroundTileState.Solid) {
            ugSet(underground, cmd.surfaceTileX, sy, UndergroundTileState.Marked);
          }
        }
        colony4.digFlowFieldDirty = true;   // typed field (Plan 03 Task 1)
        break;
      }
      default: {
        // Exhaustive narrowing — SimCommand is a 7-variant union; this arm is genuine never.
        // Silent-drop unknowns per PRD §5. Do NOT throw, do NOT log (wall-clock-adjacent).
        const _exhaustive: never = cmd;
        void _exhaustive;
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Steps 2-8: Per-colony loop
  // ---------------------------------------------------------------------------
  for (const colonyId in world.colonies) {
    if (!Object.hasOwn(world.colonies, colonyId)) continue;
    const colony = world.colonies[colonyId]!;

    // Step 2: Reconcile colony stats (drift-correction recount)
    tickReconcile(world, colony);

    // Step 3: Food consumption (feeds queen and larvae from colony pool)
    tickFoodConsumption(world, colony);

    // Step 4: Starvation check (Phase 6 no-op slot — decrement-on-fail is inline in step 3)
    tickStarvationCheck(world, colony);

    // Step 5: Death cleanup (swap-remove dead entities; sets colony.defeated if queen dead)
    tickDeathCleanup(world, colony);

    // Step 6: Queen egg production (tick-modulo + food threshold gate)
    tickQueenEggProduction(world, colony);

    // Step 7: Lifecycle transitions (egg→larva→worker aging + promotion)
    tickLifecycleTransitions(world, colony);

    // Step 8: Behavior allocation (re-run after lifecycle; handles new matures + deaths from step 7)
    const brood8 = colony.eggCount + colony.larvaeCount;
    const alloc8 = allocateWorkers(colony.workerCount, brood8, colony.targetRatio);
    colony.computedAllocation.nurse  = alloc8.nurse;
    colony.computedAllocation.forage = alloc8.forage;
    colony.computedAllocation.dig    = alloc8.dig;
    colony.computedAllocation.fight  = alloc8.fight;
    colony.nurseCount = alloc8.nurse;
  }

  // Step 5 extension: dead-digger tile reversion (global pass, after per-colony death cleanup)
  // Reverts BeingDug tiles claimed by dead diggers back to Marked (Phase 7 Plan 05).
  tickDeadDiggerCleanup(world);

  // ---------------------------------------------------------------------------
  // Step 9: Recompute dig flow-fields for colonies with dirty flag (NEW in Phase 7)
  // ---------------------------------------------------------------------------
  for (const key in world.colonies) {
    if (!Object.hasOwn(world.colonies, key)) continue;
    const colony = world.colonies[key as unknown as ColonyId]!;
    if (!colony.digFlowFieldDirty) continue;   // typed field (Plan 03 Task 1)
    const underground = world.undergroundGrids[colony.colonyId];
    if (!underground) continue;
    const gridSize = underground.width * underground.height;
    const out = ensureDigFlowField(digFlowFields, colony.colonyId, gridSize);
    const queue = digFlowFields.queues[colony.colonyId]!;
    computeDigFlowField(underground, out, queue);
    colony.digFlowFieldDirty = false;
  }

  // ---------------------------------------------------------------------------
  // Step 10: assignWorkerTasks
  //   10a: existing Phase 6 idle-reassignment (unchanged body from Phase 6 tick.ts step 9)
  //   10b: Phase 7 dig-worker state machine (claim + excavation countdown)
  // ---------------------------------------------------------------------------
  for (const colonyId in world.colonies) {
    if (!Object.hasOwn(world.colonies, colonyId)) continue;
    const colony = world.colonies[colonyId]!;

    // Step 10a: Task assignment (PRD §8a step 9 + §7c as revised by Errata E-01)
    //
    // PRD §8a step 9 + §7c (revised by Errata E-01): reassign AntTask.Idle ants toward
    // computedAllocation, then write taskCensus. Mid-cycle ants (any non-Idle task) are not
    // interrupted; they become eligible on the cycle-completion tick when their action system
    // writes task=Idle (Plan 09 antDepositFood owns Foraging→Idle in Phase 6).

    // (a) Count current per-task totals by iterating colony.workers (skip dead).
    //     Only the 4 target categories; idle is a transient eligibility state, not a census slot.
    let actualForage = 0, actualDig = 0, actualFight = 0, actualNurse = 0, actualIdle = 0;
    for (let i = 0; i < colony.workers.length; i++) {
      const id = colony.workers[i]!;
      if (world.ants.alive[id] !== 1) continue;
      const t = world.ants.task[id]!;
      if      (t === AntTask.Foraging) actualForage += 1;
      else if (t === AntTask.Digging)  actualDig    += 1;
      else if (t === AntTask.Fighting) actualFight  += 1;
      else if (t === AntTask.Nursing)  actualNurse  += 1;
      else                             actualIdle   += 1;
    }

    // (b) Collect ants at PRD §7c idle checkpoints, sorted ascending by EntityId (SCEN-06 determinism).
    //     The eligibility predicate is `task === AntTask.Idle` — the single, uniform rule per §7c
    //     as revised by Errata E-01. The per-task rows of the §7c table (post-deposit for Foraging,
    //     post-excavation for Digging, post-feed for Nursing) describe the action-system transitions
    //     that PUT an ant into AntTask.Idle — NOT sub-state predicates against the current task.
    //     AntTask.Fighting not eligible in Phase 6 — no combat resolution yet (Phase 9 scope).
    const eligible: number[] = [];
    for (let i = 0; i < colony.workers.length; i++) {
      const id = colony.workers[i]!;
      if (world.ants.alive[id] !== 1) continue;
      if (world.ants.task[id] === AntTask.Idle) eligible.push(id);
    }
    // Sort ascending by EntityId — "lowest-EntityId first" per PRD §7c (deterministic per SCEN-06).
    eligible.sort((a, b) => a - b);

    // (c) Walk the sorted eligibles and reassign into under-represented targets.
    //     Canonical target iteration order: forage → dig → fight → nurse (matches PRD §7a result shape).
    //     This deterministic if/else chain is the ONLY selection strategy.
    const need = {
      forage: colony.computedAllocation.forage - actualForage,
      dig:    colony.computedAllocation.dig    - actualDig,
      fight:  colony.computedAllocation.fight  - actualFight,
      nurse:  colony.computedAllocation.nurse  - actualNurse,
    };

    for (let i = 0; i < eligible.length; i++) {
      const id = eligible[i]!;
      let newTask = -1;
      let newSubTask = 0;

      if      (need.forage > 0) { newTask = AntTask.Foraging; newSubTask = ForagingSubState.SearchingFood; need.forage -= 1; }
      else if (need.dig    > 0) { newTask = AntTask.Digging;  newSubTask = DiggingSubState.MovingToTile;   need.dig    -= 1; }
      else if (need.fight  > 0) { newTask = AntTask.Fighting; newSubTask = FightingSubState.MovingToRally; need.fight  -= 1; }
      else if (need.nurse  > 0) { newTask = AntTask.Nursing;  newSubTask = NursingSubState.MovingToBrood;  need.nurse  -= 1; }
      else break; // no remaining under-represented targets; leave rest of eligibles in their current state

      // Decrement actual for the OLD task (so counts stay consistent), increment for new.
      const oldTask = world.ants.task[id]!;
      if      (oldTask === AntTask.Foraging) actualForage -= 1;
      else if (oldTask === AntTask.Digging)  actualDig    -= 1;
      else if (oldTask === AntTask.Fighting) actualFight  -= 1;
      else if (oldTask === AntTask.Nursing)  actualNurse  -= 1;
      else                                   actualIdle   -= 1;

      world.ants.task[id]    = newTask;
      world.ants.subTask[id] = newSubTask;

      if      (newTask === AntTask.Foraging) actualForage += 1;
      else if (newTask === AntTask.Digging)  actualDig    += 1;
      else if (newTask === AntTask.Fighting) actualFight  += 1;
      else if (newTask === AntTask.Nursing)  actualNurse  += 1;
    }

    void actualIdle; // tracked for internal consistency; not exposed on ColonyRecord (Plan 03 removed idleCount)

    // (d) Final census write — true post-reassignment distribution (4 fields: PRD §2 WorkerAllocation).
    colony.taskCensus.forage = actualForage;
    colony.taskCensus.dig    = actualDig;
    colony.taskCensus.fight  = actualFight;
    colony.taskCensus.nurse  = actualNurse;
  }

  // Step 10b: Phase 7 dig-worker state machine (Marked→BeingDug claim, BeingDug→Open countdown).
  // MUST run AFTER idle-reassignment (10a) so newly-assigned dig workers are eligible.
  // MUST run BEFORE checkPendingChambers (step 11) and checkEntranceCompletion (step 12)
  // so same-tick BeingDug→Open transitions are visible to those steps (PRD §9a/§9b).
  tickDigExecution(world, digFlowFields);

  // ---------------------------------------------------------------------------
  // Step 11: checkPendingChambers (NEW in Phase 7)
  //   Promote fully-excavated PendingChambers to ChamberRecords.
  //   Depends on step 10b tickDigExecution having already run this tick.
  // ---------------------------------------------------------------------------
  checkPendingChambers(world);

  // ---------------------------------------------------------------------------
  // Step 12: checkEntranceCompletion (NEW in Phase 7)
  //   Enable entrances whose shaft tiles are now Open.
  //   Depends on step 10b tickDigExecution having already run this tick.
  // ---------------------------------------------------------------------------
  checkEntranceCompletion(world);

  // ---------------------------------------------------------------------------
  // Step 13: routeForagerPriority (NEW in Phase 7)
  //   Route SearchingFood foragers to marked food piles (priority targeting).
  // ---------------------------------------------------------------------------
  routeForagerPriority(world);

  // ---------------------------------------------------------------------------
  // Step 14: Pheromone deposit (per-ant — carry-only rule enforced inside tickPheromoneDeposit)
  // ---------------------------------------------------------------------------
  tickPheromoneDeposit(world);

  // ---------------------------------------------------------------------------
  // Step 15: Pheromone decay (per-grid; select decay rate from grid key)
  // ---------------------------------------------------------------------------
  for (const gridKey in world.pheromoneGrids) {
    if (!Object.hasOwn(world.pheromoneGrids, gridKey)) continue;
    const grid = world.pheromoneGrids[gridKey]!;
    // Key format: "${colonyId}:${pheromoneType}:${zone}"
    // PheromoneType: 0 = FoodTrail, 1 = DangerTrail (per enums.ts)
    const parts = gridKey.split(':');
    const pheromoneType = (parts[1] as unknown as number) | 0;
    const decayRate = pheromoneType === PheromoneType.DangerTrail
      ? DANGER_DECAY_FP
      : PHEROMONE_DECAY_FP;
    tickPheromoneDecay(grid, decayRate);
  }

  // ---------------------------------------------------------------------------
  // Step 16: Movement (zone-aware; DigFlowFields passed for pure direction reads only).
  //          Pure movement — no dig state transitions here (those ran at step 10b).
  // ---------------------------------------------------------------------------
  tickAntMovement(world, rng, digFlowFields);

  // ---------------------------------------------------------------------------
  // Step 17: rngState writeback (BEFORE tick increment per PRD §4 serialization contract)
  //          then tick counter increment.
  // ---------------------------------------------------------------------------
  world.rngState = rng.getState();
  world.tick += 1;

  return GameOutcome.None;
}
