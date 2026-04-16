// lifecycle-system.ts — PRD §4b colony lifecycle pipeline
//
// Implements two exported tick-step functions:
//   1. tickQueenEggProduction  — CLNY-01: queen lays eggs on tick-modulo cadence
//   2. tickLifecycleTransitions — CLNY-02/03: egg→larva→worker transitions + aging
//
// Scope:
//   - No starvation logic (Plan 09)
//   - No ant movement (Plan 09)
//   - No task assignment beyond setting Idle at worker promotion (Plan 10)
//   - No per-tick allocation — swap-remove is O(1) via backwards iteration
//
// Swap-remove pattern (PRD §4b line 388):
//   array[i] = array[array.length - 1]!;
//   array.pop();
// The `!` non-null assertion is safe because we only iterate when i >= 0 and
// array.length > 0, so array[length-1] is always defined.

import type { WorldState } from '../types.js';
import { allocateEntityId } from '../types.js';
import { initAnt } from '../ant/ant-store.js';
import type { ColonyRecord } from './colony-store.js';
import { AntTask } from '../enums.js';
import {
  QUEEN_EGG_INTERVAL_TICKS,
  QUEEN_EGG_FOOD_THRESHOLD,
  EGG_HATCH_TICKS,
  LARVA_MATURE_TICKS,
  WORKER_BASE_SPEED,
  WORKER_LIFESPAN_TICKS,
} from '../constants.js';

// ---------------------------------------------------------------------------
// tickQueenEggProduction — CLNY-01
//
// Gating order (PRD §4b line 980):
//   1. Tick-modulo gate:  world.tick % QUEEN_EGG_INTERVAL_TICKS !== 0 → return
//   2. Food threshold:    colony.foodStored < QUEEN_EGG_FOOD_THRESHOLD → return
//   3. Queen alive:       world.ants.alive[colony.queenEntityId] !== 1 → return
//
// When all gates pass:
//   - Allocate new entity via allocateEntityId(world)
//   - initAnt with task=Idle, speed=0, lifespan=WORKER_LIFESPAN_TICKS, age=0
//   - Spawn at queen position (posX/posY from queen entity)
//   - Push to colony.eggs; increment colony.eggCount
//
// No RNG parameter — egg production is fully deterministic.
// ---------------------------------------------------------------------------

export function tickQueenEggProduction(world: WorldState, colony: ColonyRecord): void {
  // Gate 1: tick-modulo interval
  if ((world.tick % QUEEN_EGG_INTERVAL_TICKS) !== 0) return;

  // Gate 2: food threshold
  if (colony.foodStored < QUEEN_EGG_FOOD_THRESHOLD) return;

  // Gate 3: queen alive
  if (world.ants.alive[colony.queenEntityId] !== 1) return;

  // Allocate + init new egg entity
  const eggId = allocateEntityId(world);
  initAnt(world.ants, eggId, {
    colonyId: colony.colonyId,
    posX:     world.ants.posX[colony.queenEntityId]!,
    posY:     world.ants.posY[colony.queenEntityId]!,
    task:     AntTask.Idle,
    subTask:  0,
    speed:    0,                  // eggs don't move
    lifespan: WORKER_LIFESPAN_TICKS,
  });

  colony.eggs.push(eggId);
  colony.eggCount += 1;
}

// ---------------------------------------------------------------------------
// tickLifecycleTransitions — CLNY-02 (egg hatch) + CLNY-03 (larva mature)
//
// Three backwards-iteration loops (PRD §4b lines 889-923):
//   1. Eggs:    age++; on age >= EGG_HATCH_TICKS → swap-remove → push to larvae
//   2. Larvae:  age++; on age >= LARVA_MATURE_TICKS → swap-remove → push to workers
//   3. Workers: age++; check lifespan (effectively disabled: WORKER_LIFESPAN_TICKS = INT32_MAX)
//
// Dead entries (alive !== 1) are swap-removed in each loop.
// This is a defensive path for death cleanup by Plan 09; lifecycle transitions
// skip dead entries rather than aging or promoting them.
//
// Age resets to 0 on every bucket transition (egg→larva, larva→worker).
// Worker promotion sets task=Idle and speed=WORKER_BASE_SPEED.
// ---------------------------------------------------------------------------

export function tickLifecycleTransitions(world: WorldState, colony: ColonyRecord): void {
  const ants = world.ants;

  // Snapshot bucket lengths before each phase so newly-promoted entities are
  // not processed in the same tick they are promoted (PRD §4b: one phase-step
  // per tick per bucket; newly pushed IDs start participating next tick).
  const eggSnapLen     = colony.eggs.length;
  const larvaeSnapLen  = colony.larvae.length;
  const workersSnapLen = colony.workers.length;

  // ------------------------------------------------------------------
  // Loop 1: Eggs — age + transition to larva on EGG_HATCH_TICKS
  // Backwards iteration + swap-remove preserves O(1) per promotion.
  // Iterates only over eggs that existed at the start of this tick.
  // ------------------------------------------------------------------
  for (let i = eggSnapLen - 1; i >= 0; i--) {
    const id = colony.eggs[i]!;

    // Dead egg — defensive swap-remove (primary cleanup handled by Plan 09)
    if (ants.alive[id] !== 1) {
      colony.eggs[i] = colony.eggs[colony.eggs.length - 1]!;
      colony.eggs.pop();
      colony.eggCount -= 1;
      continue;
    }

    const eggAge = ants.age[id]! + 1;
    ants.age[id] = eggAge;

    if (eggAge >= EGG_HATCH_TICKS) {
      // Promote egg → larva: swap-remove from eggs, reset age, push to larvae
      colony.eggs[i] = colony.eggs[colony.eggs.length - 1]!;
      colony.eggs.pop();
      colony.eggCount -= 1;
      ants.age[id] = 0;         // reset age for larva phase
      colony.larvae.push(id);
      colony.larvaeCount += 1;
    }
  }

  // ------------------------------------------------------------------
  // Loop 2: Larvae — age + transition to worker on LARVA_MATURE_TICKS
  // Iterates only over larvae that existed at the start of this tick
  // (excludes larvae just promoted from eggs in Loop 1 above).
  // ------------------------------------------------------------------
  for (let i = larvaeSnapLen - 1; i >= 0; i--) {
    const id = colony.larvae[i]!;

    // Dead larva — defensive swap-remove
    if (ants.alive[id] !== 1) {
      colony.larvae[i] = colony.larvae[colony.larvae.length - 1]!;
      colony.larvae.pop();
      colony.larvaeCount -= 1;
      continue;
    }

    const larvaAge = ants.age[id]! + 1;
    ants.age[id] = larvaAge;

    if (larvaAge >= LARVA_MATURE_TICKS) {
      // Promote larva → worker: swap-remove from larvae, reset age, push to workers
      colony.larvae[i] = colony.larvae[colony.larvae.length - 1]!;
      colony.larvae.pop();
      colony.larvaeCount -= 1;
      ants.age[id] = 0;         // reset age for worker phase
      ants.task[id] = AntTask.Idle;
      ants.speed[id] = WORKER_BASE_SPEED;
      colony.workers.push(id);
      colony.workerCount += 1;
    }
  }

  // ------------------------------------------------------------------
  // Loop 3: Workers — age; lifespan check (disabled in Phase 6 via INT32_MAX)
  // ------------------------------------------------------------------
  for (let i = workersSnapLen - 1; i >= 0; i--) {
    const id = colony.workers[i]!;

    // Dead worker — defensive swap-remove
    if (ants.alive[id] !== 1) {
      colony.workers[i] = colony.workers[colony.workers.length - 1]!;
      colony.workers.pop();
      colony.workerCount -= 1;
      continue;
    }

    const workerAge = ants.age[id]! + 1;
    ants.age[id] = workerAge;

    // Lifespan check — effectively disabled in Phase 6 (WORKER_LIFESPAN_TICKS = 0x7FFFFFFF)
    if (workerAge >= ants.lifespan[id]!) {
      ants.alive[id] = 0;
      // Note: dead workers are removed on the NEXT tick's backwards iteration pass
      // (the worker remains in colony.workers until then — Plan 09 death cleanup
      // will handle immediate removal once implemented)
    }
  }
}
