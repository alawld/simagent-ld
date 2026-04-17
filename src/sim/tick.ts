// src/sim/tick.ts — Phase 6 13-step tick dispatcher per PRD §8a. Phase 5 shell removed.
import type { WorldState } from './types.js';
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
import { PHEROMONE_DECAY_FP, DANGER_DECAY_FP } from './constants.js';
import { allocateWorkers } from './behavior/allocation-system.js';
import {
  tickReconcile,
  tickFoodConsumption,
  tickStarvationCheck,
  tickDeathCleanup,
} from './colony/colony-system.js';
import {
  tickQueenEggProduction,
  tickLifecycleTransitions,
} from './colony/lifecycle-system.js';
import {
  tickPheromoneDeposit,
  tickAntMovement,
} from './ant/ant-system.js';
import { tickPheromoneDecay } from './pheromone/pheromone-system.js';
import { createDigFlowFields } from './dig-system.js';

// Temporary stub DigFlowFields for Plan 06 — Plan 08 (scenario setup) will wire the proper
// scenario-level instance so that tickDigExecution and tickAntMovement share the same cache.
// Created once at module load; fields/queues populated lazily by ensureDigFlowField in step 9.
const _stubDigFlowFields = createDigFlowFields();

/**
 * Advance the simulation by one tick — 13-step PRD §8a dispatcher.
 *
 * Step order:
 *  1. Process commands (FIFO cap: MAX_COMMANDS_PER_TICK; unknown variants silently dropped)
 *  2. Reconcile colony stats
 *  3. Food consumption
 *  4. Starvation check
 *  5. Death cleanup
 *  6. Queen egg production
 *  7. Lifecycle transitions
 *  8. Behavior allocation (re-run per colony after lifecycle changes)
 *  9. Task assignment (PRD §8a + §7c, Errata E-01)
 * 10. Pheromone deposit
 * 11. Pheromone decay
 * 12. Movement
 * 13. rngState writeback + world.tick increment
 *
 * Rng is reconstructed at the start of each tick from `world.rngState`.
 * `world.rngState = rng.getState()` is written back BEFORE `world.tick += 1`.
 *
 * Returns `GameOutcome.None` always in Phase 6. Win/lose checks (queen death
 * cascade, colony defeated) are Phase 9 scope (CMBT-06). `colony.defeated` is
 * set by step 5 but not acted upon in Phase 6.
 *
 * @param world    - Mutable world state; mutated in place across all 13 steps.
 * @param commands - Point-in-time snapshot of commands for this tick. Not mutated.
 *                   Commands beyond MAX_COMMANDS_PER_TICK are silently dropped FIFO (PRD §5).
 * @returns GameOutcome.None (always in Phase 6).
 */
export function tick(world: WorldState, commands: readonly SimCommand[]): GameOutcome {
  // Reconstruct Rng from saved state at tick start (PRD §4 contract).
  const rng = new Rng(world.rngState);

  // ---------------------------------------------------------------------------
  // Step 1: Process commands (FIFO cap — PRD §5; indexed loop, no allocation)
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
      case 'MarkDigTile':
        // Phase 6 silent no-op per PRD §9a (Phase 3 scope).
        break;
      case 'MarkFoodPile':
        // Phase 6 silent no-op per PRD §9a (Phase 3 scope).
        break;
      default: {
        // Exhaustive narrowing — SimCommand is a 4-variant union; this default is genuine never.
        // Silent-drop unknowns per PRD §5. Do NOT throw, do NOT log (wall-clock-adjacent).
        const _exhaustive: never = cmd;
        void _exhaustive;
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Steps 2-9: Per-colony loop
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

    // Step 9: Task assignment (PRD §8a step 9 + §7c as revised by Errata E-01)
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

  // ---------------------------------------------------------------------------
  // Step 10: Pheromone deposit (per-ant — carry-only rule enforced inside tickPheromoneDeposit)
  // ---------------------------------------------------------------------------
  tickPheromoneDeposit(world);

  // ---------------------------------------------------------------------------
  // Step 11: Pheromone decay (per-grid; select decay rate from grid key)
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
  // Step 12: Movement (passes the reconstructed rng for deterministic forager gradient sampling)
  // ---------------------------------------------------------------------------
  tickAntMovement(world, rng, _stubDigFlowFields);

  // ---------------------------------------------------------------------------
  // Step 13: rngState writeback (BEFORE tick increment per PRD §4 serialization contract)
  //          then tick counter increment.
  // ---------------------------------------------------------------------------
  world.rngState = rng.getState();
  world.tick += 1;

  return GameOutcome.None;
}
