// colony-system.test.ts — CLNY-04, CLNY-05, CLNY-07 + supporting helpers
//
// Test coverage:
//   withdrawFood:          success, insufficient, exact-amount
//   tickFoodConsumption:   queen fed/unfed, larva fed/unfed, queen-priority ordering
//   CLNY-04:               queen starvation cascade (SC 2) + stay-alive-when-fed
//   tickStarvationCheck:   Phase 6 no-op isolation (regression guard — test 10)
//   CLNY-05:               larva starvation + stay-alive-when-fed
//   tickDeathCleanup:      dead worker swap-remove, queen death sets defeated, all-bucket cleanup
//   tickReconcile:         countdown decrement, recount on zero, drift-correction (CLNY-07 SC 7)
//   CLNY-07 integration:   steady-state foodStored decrement per tick

import { describe, it, expect } from 'vitest';
import {
  withdrawFood,
  tickFoodConsumption,
  tickStarvationCheck,
  tickDeathCleanup,
  tickReconcile,
} from './colony-system.js';
import { createWorldState } from '../types.js';
import { createColonyRecord } from './colony-store.js';
import { initAnt } from '../ant/ant-store.js';
import { AntTask } from '../enums.js';
import {
  STARVATION_GRACE_TICKS,
  RECONCILE_INTERVAL_TICKS,
  QUEEN_FOOD_PER_TICK,
  LARVA_FOOD_PER_TICK,
} from '../constants.js';
import type { WorldState } from '../types.js';
import type { ColonyRecord } from './colony-store.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const COLONY_ID = 1;
const MAX_TEST_ENTITIES = 128;

/**
 * Create a fresh world + colony with a live queen at entity 0.
 * The queen entity is allocated as entity 0; colony.queenEntityId = 0.
 */
function setupWorldWithQueen(foodStored = 1000): { world: WorldState; colony: ColonyRecord } {
  const world = createWorldState(42, MAX_TEST_ENTITIES);

  const queenId = world.nextEntityId; // 0
  world.nextEntityId += 1;

  initAnt(world.ants, queenId, {
    colonyId: COLONY_ID,
    posX: 256,
    posY: 256,
    task: AntTask.Idle,
  });

  const colony = createColonyRecord(COLONY_ID, queenId);
  colony.foodStored = foodStored;
  world.colonies[COLONY_ID] = colony;

  return { world, colony };
}

/**
 * Add a live larva to the colony. Allocates next entity ID.
 * Returns the larva's entityId.
 */
function addLarva(world: WorldState, colony: ColonyRecord): number {
  const id = world.nextEntityId;
  world.nextEntityId += 1;

  initAnt(world.ants, id, {
    colonyId: COLONY_ID,
    posX: 256,
    posY: 256,
    task: AntTask.Idle,
  });
  // Initialize starvation timer to GRACE value (same as queen default)
  world.ants.starvationTimer[id] = STARVATION_GRACE_TICKS;

  colony.larvae.push(id);
  colony.larvaeCount += 1;

  return id;
}

/**
 * Add a live worker to the colony. Allocates next entity ID.
 * Returns the worker's entityId.
 */
function addWorker(world: WorldState, colony: ColonyRecord): number {
  const id = world.nextEntityId;
  world.nextEntityId += 1;

  initAnt(world.ants, id, {
    colonyId: COLONY_ID,
    posX: 256,
    posY: 256,
    task: AntTask.Idle,
  });

  colony.workers.push(id);
  colony.workerCount += 1;

  return id;
}

/**
 * Add an egg entity to the colony. Allocates next entity ID.
 * Returns the egg's entityId.
 */
function addEgg(world: WorldState, colony: ColonyRecord): number {
  const id = world.nextEntityId;
  world.nextEntityId += 1;

  initAnt(world.ants, id, {
    colonyId: COLONY_ID,
    posX: 256,
    posY: 256,
    task: AntTask.Idle,
  });

  colony.eggs.push(id);
  colony.eggCount += 1;

  return id;
}

// ---------------------------------------------------------------------------
// withdrawFood
// ---------------------------------------------------------------------------

describe('withdrawFood', () => {
  it('1. success — returns true and decrements foodStored', () => {
    const { colony } = setupWorldWithQueen(100);
    const result = withdrawFood(colony, 50);
    expect(result).toBe(true);
    expect(colony.foodStored).toBe(50);
  });

  it('2. insufficient — returns false, foodStored unchanged', () => {
    const { colony } = setupWorldWithQueen(10);
    const result = withdrawFood(colony, 50);
    expect(result).toBe(false);
    expect(colony.foodStored).toBe(10);
  });

  it('3. exact amount — returns true, foodStored reaches 0', () => {
    const { colony } = setupWorldWithQueen(50);
    const result = withdrawFood(colony, 50);
    expect(result).toBe(true);
    expect(colony.foodStored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tickFoodConsumption — basic per-entity contract
// ---------------------------------------------------------------------------

describe('tickFoodConsumption', () => {
  it('4. queen fed — decrements foodStored by QUEEN_FOOD_PER_TICK, resets timer to GRACE', () => {
    const { world, colony } = setupWorldWithQueen(1000);
    colony.queenStarvationTimer = 50; // below grace — should be reset on feed

    tickFoodConsumption(world, colony);

    expect(colony.foodStored).toBe(1000 - QUEEN_FOOD_PER_TICK);
    expect(colony.queenStarvationTimer).toBe(STARVATION_GRACE_TICKS);
    expect(world.ants.alive[colony.queenEntityId]).toBe(1); // still alive
  });

  it('5. queen not fed (empty pool) — foodStored stays 0, timer NOT reset', () => {
    const { world, colony } = setupWorldWithQueen(0);
    colony.queenStarvationTimer = 50;

    tickFoodConsumption(world, colony);

    expect(colony.foodStored).toBe(0);
    expect(colony.queenStarvationTimer).toBe(49); // decremented by 1, not reset
    expect(world.ants.alive[colony.queenEntityId]).toBe(1); // still alive (50 > 0)
  });

  it('6. larva fed — resets starvationTimer to GRACE', () => {
    const { world, colony } = setupWorldWithQueen(1000);
    const larvaId = addLarva(world, colony);
    world.ants.starvationTimer[larvaId] = 50; // below grace

    tickFoodConsumption(world, colony);

    // Queen consumed QUEEN_FOOD_PER_TICK first, then larva consumed LARVA_FOOD_PER_TICK
    expect(colony.foodStored).toBe(1000 - QUEEN_FOOD_PER_TICK - LARVA_FOOD_PER_TICK);
    expect(world.ants.starvationTimer[larvaId]).toBe(STARVATION_GRACE_TICKS); // reset on feed
    expect(world.ants.alive[larvaId]).toBe(1);
  });

  it('7. queen-priority — queen fed first; larvae starve when pool exactly covers queen only', () => {
    // foodStored = 2 = exactly one queen meal; QUEEN_FOOD_PER_TICK=2, LARVA_FOOD_PER_TICK=1
    const { world, colony } = setupWorldWithQueen(QUEEN_FOOD_PER_TICK);
    const larvaId1 = addLarva(world, colony);
    const larvaId2 = addLarva(world, colony);
    const larvaId3 = addLarva(world, colony);

    // Give larvae high timers so they survive one unfed tick
    world.ants.starvationTimer[larvaId1] = 50;
    world.ants.starvationTimer[larvaId2] = 50;
    world.ants.starvationTimer[larvaId3] = 50;

    tickFoodConsumption(world, colony);

    // Queen was fed — timer reset
    expect(colony.queenStarvationTimer).toBe(STARVATION_GRACE_TICKS);
    expect(colony.foodStored).toBe(0); // pool exhausted by queen
    // All larvae unfed — timers decremented by 1
    expect(world.ants.starvationTimer[larvaId1]).toBe(49);
    expect(world.ants.starvationTimer[larvaId2]).toBe(49);
    expect(world.ants.starvationTimer[larvaId3]).toBe(49);
    // Larvae not yet dead (timers still > 0)
    expect(world.ants.alive[larvaId1]).toBe(1);
    expect(world.ants.alive[larvaId2]).toBe(1);
    expect(world.ants.alive[larvaId3]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CLNY-04: queen starvation cascade (Phase 6 SC 2)
// ---------------------------------------------------------------------------

describe('tickFoodConsumption — CLNY-04 queen starvation cascade', () => {
  it('8. queen dies after exactly STARVATION_GRACE_TICKS unfed ticks', () => {
    const { world, colony } = setupWorldWithQueen(0); // empty pool
    colony.queenStarvationTimer = STARVATION_GRACE_TICKS;

    // STARVATION_GRACE_TICKS - 1 calls should not kill the queen
    for (let i = 0; i < STARVATION_GRACE_TICKS - 1; i++) {
      tickFoodConsumption(world, colony);
      // Also call the no-op for realistic dispatch order (verifies it doesn't affect state)
      tickStarvationCheck(world, colony);
      expect(world.ants.alive[colony.queenEntityId]).toBe(1);
    }

    // The STARVATION_GRACE_TICKS-th tick: timer reaches 0 → queen dies
    tickFoodConsumption(world, colony);
    expect(world.ants.alive[colony.queenEntityId]).toBe(0);
    expect(colony.queenStarvationTimer).toBeLessThanOrEqual(0);
  });

  it('9. queen stays alive when fed — timer pinned at GRACE (no separate decrement)', () => {
    const { world, colony } = setupWorldWithQueen(10_000); // ample food

    for (let i = 0; i < 200; i++) {
      tickFoodConsumption(world, colony);
      // Timer must always be reset to STARVATION_GRACE_TICKS (not drifting downward)
      expect(colony.queenStarvationTimer).toBe(STARVATION_GRACE_TICKS);
    }
    expect(world.ants.alive[colony.queenEntityId]).toBe(1);
  });

  it('10. tickStarvationCheck is a no-op — isolation test (regression guard)', () => {
    // Regression guard: if an unconditional decrement were ever added to
    // tickStarvationCheck, timers would drift even without consumption.
    const { world, colony } = setupWorldWithQueen(0);
    const larvaId = addLarva(world, colony);

    colony.queenStarvationTimer = 50;
    world.ants.starvationTimer[larvaId] = 50;

    // Call tickStarvationCheck 1000 times in isolation (no consumption calls)
    for (let i = 0; i < 1000; i++) {
      tickStarvationCheck(world, colony);
    }

    // Timers must be unchanged — the function must be a true no-op
    expect(colony.queenStarvationTimer).toBe(50);
    expect(world.ants.starvationTimer[larvaId]).toBe(50);
    expect(world.ants.alive[colony.queenEntityId]).toBe(1);
    expect(world.ants.alive[larvaId]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CLNY-05: larva starvation
// ---------------------------------------------------------------------------

describe('tickFoodConsumption — CLNY-05 larva starvation', () => {
  it('11. larva dies after 100 unfed ticks (STARVATION_GRACE_TICKS)', () => {
    const { world, colony } = setupWorldWithQueen(0); // empty pool
    const larvaId = addLarva(world, colony);
    world.ants.starvationTimer[larvaId] = STARVATION_GRACE_TICKS;

    // STARVATION_GRACE_TICKS - 1 iterations — still alive
    for (let i = 0; i < STARVATION_GRACE_TICKS - 1; i++) {
      tickFoodConsumption(world, colony);
      expect(world.ants.alive[larvaId]).toBe(1);
    }

    // Final tick — timer reaches 0 → larva dies
    tickFoodConsumption(world, colony);
    expect(world.ants.alive[larvaId]).toBe(0);
  });

  it('12. larva stays alive when fed — timer stays at GRACE', () => {
    const { world, colony } = setupWorldWithQueen(10_000);
    const larvaId = addLarva(world, colony);

    for (let i = 0; i < 100; i++) {
      tickFoodConsumption(world, colony);
    }

    expect(world.ants.alive[larvaId]).toBe(1);
    expect(world.ants.starvationTimer[larvaId]).toBe(STARVATION_GRACE_TICKS);
  });
});

// ---------------------------------------------------------------------------
// tickDeathCleanup
// ---------------------------------------------------------------------------

describe('tickDeathCleanup', () => {
  it('13. dead worker is swap-removed from workers bucket; workerCount decremented', () => {
    const { world, colony } = setupWorldWithQueen();
    const id1 = addWorker(world, colony);
    const id2 = addWorker(world, colony);
    const id3 = addWorker(world, colony);
    expect(colony.workerCount).toBe(3);

    world.ants.alive[id2] = 0; // kill middle worker

    tickDeathCleanup(world, colony);

    expect(colony.workers).toHaveLength(2);
    expect(colony.workers).not.toContain(id2); // removed
    expect(colony.workers).toContain(id1);     // still present
    expect(colony.workers).toContain(id3);     // still present
    expect(colony.workerCount).toBe(2);
  });

  it('14. queen death sets colony.defeated = true', () => {
    const { world, colony } = setupWorldWithQueen();
    world.ants.alive[colony.queenEntityId] = 0; // kill queen

    tickDeathCleanup(world, colony);

    expect(colony.defeated).toBe(true);
  });

  it('15. all-bucket cleanup — dead eggs/larvae/workers removed in one pass', () => {
    const { world, colony } = setupWorldWithQueen();

    // Add entities to all three buckets
    const egg1  = addEgg(world, colony);
    const egg2  = addEgg(world, colony);
    const lar1  = addLarva(world, colony);
    const lar2  = addLarva(world, colony);
    const wrk1  = addWorker(world, colony);
    const wrk2  = addWorker(world, colony);

    // Kill one from each bucket
    world.ants.alive[egg1]  = 0;
    world.ants.alive[lar1]  = 0;
    world.ants.alive[wrk1]  = 0;

    tickDeathCleanup(world, colony);

    expect(colony.eggs).toHaveLength(1);
    expect(colony.eggs).toContain(egg2);
    expect(colony.eggCount).toBe(1);

    expect(colony.larvae).toHaveLength(1);
    expect(colony.larvae).toContain(lar2);
    expect(colony.larvaeCount).toBe(1);

    expect(colony.workers).toHaveLength(1);
    expect(colony.workers).toContain(wrk2);
    expect(colony.workerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// tickReconcile
// ---------------------------------------------------------------------------

describe('tickReconcile', () => {
  it('16. countdown decrement — recount does NOT run when countdown > 0 after decrement', () => {
    const { world, colony } = setupWorldWithQueen();
    colony.reconcileCountdown = 100;

    tickReconcile(world, colony);

    expect(colony.reconcileCountdown).toBe(99); // decremented
    // workerCount unchanged (no recount ran)
    expect(colony.workerCount).toBe(0);
    expect(colony.eggCount).toBe(0);
    expect(colony.larvaeCount).toBe(0);
  });

  it('17. recount runs when countdown reaches 0; countdown resets to RECONCILE_INTERVAL_TICKS', () => {
    const { world, colony } = setupWorldWithQueen();
    colony.reconcileCountdown = 1; // one decrement will hit 0

    tickReconcile(world, colony);

    // Recount ran; countdown reset
    expect(colony.reconcileCountdown).toBe(RECONCILE_INTERVAL_TICKS);
  });

  it('18. recount fixes drift — CLNY-07 Phase 6 SC 7', () => {
    const { world, colony } = setupWorldWithQueen();
    const id1 = addWorker(world, colony);
    const id2 = addWorker(world, colony);
    const id3 = addWorker(world, colony);

    // Manually introduce drift: claim 5 workers but only 3 are in the array
    colony.workerCount = 5;

    // Kill one of the three workers to make recount non-trivial
    world.ants.alive[id2] = 0;

    // Force reconcile to run immediately
    colony.reconcileCountdown = 1;
    tickReconcile(world, colony);

    // Recount should find 2 alive workers (id1 and id3); id2 cleaned out
    expect(colony.workerCount).toBe(2);
    expect(colony.workers).toHaveLength(2);
    expect(colony.workers).not.toContain(id2);
  });
});

// ---------------------------------------------------------------------------
// CLNY-07 cached fields update — integration
// ---------------------------------------------------------------------------

describe('CLNY-07 cached fields — integration', () => {
  it('19. steady-state foodStored decrements by QUEEN_FOOD_PER_TICK + larvaeCount * LARVA_FOOD_PER_TICK per tick', () => {
    const { world, colony } = setupWorldWithQueen(10_000);
    const larvaCount = 3;
    for (let i = 0; i < larvaCount; i++) {
      addLarva(world, colony);
    }

    const expectedDecrement = QUEEN_FOOD_PER_TICK + larvaCount * LARVA_FOOD_PER_TICK;
    const initialFood = colony.foodStored;

    for (let tick = 1; tick <= 10; tick++) {
      tickFoodConsumption(world, colony);
      expect(colony.foodStored).toBe(initialFood - tick * expectedDecrement);
    }

    // All entities still alive (ample food)
    expect(world.ants.alive[colony.queenEntityId]).toBe(1);
    for (const larvaId of colony.larvae) {
      expect(world.ants.alive[larvaId]).toBe(1);
    }
  });
});
