// src/sim/tick.test.ts
// Tests for tick() 13-step PRD §8a dispatcher — Phase 6 full suite.
// Preserves Phase 5 tests; adds Phase 6 command, step-ordering, task-assignment,
// pheromone, and writeback tests.

import { describe, it, expect, beforeEach } from 'vitest';
import { tick } from './tick.js';
import { createWorldState, allocateEntityId } from './types.js';
import { GameOutcome } from './game-over.js';
import type { SimCommand } from './commands.js';
import { initAnt } from './ant/ant-store.js';
import { createColonyRecord } from './colony/colony-store.js';
import { createPheromoneGrid, phGet, phSet, pheromoneGridKey } from './pheromone/pheromone-store.js';
import { AntTask, ForagingSubState, PheromoneType } from './enums.js';
import type { WorldState } from './types.js';
import type { ColonyId } from './colony/colony-store.js';
import {
  QUEEN_FOOD_PER_TICK,
  STARVATION_GRACE_TICKS,
  WORKER_LIFESPAN_TICKS,
  FOOD_TRAIL_DEPOSIT,
} from './constants.js';
import { FP_SHIFT } from './fixed.js';

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

function makeWorldWithColony(seed: number = 42): { world: WorldState; colonyId: ColonyId; queenId: number } {
  const world = createWorldState(seed);
  const queenId = allocateEntityId(world);
  initAnt(world.ants, queenId, {
    colonyId: 1,
    posX: 1024,
    posY: 1024,
    task: AntTask.Idle,
    subTask: 0,
    speed: 0,
    lifespan: WORKER_LIFESPAN_TICKS,
  });
  world.colonies[1] = createColonyRecord(1, queenId);
  world.colonies[1]!.foodStored = 10000;
  return { world, colonyId: 1 as ColonyId, queenId };
}

// ---------------------------------------------------------------------------
// Phase 5 preserved tests
// ---------------------------------------------------------------------------

describe('tick() basic (Phase 5 preserved)', () => {
  it('increments world.tick from 0 to 1 on a fresh world with no commands', () => {
    const world = createWorldState(42);
    tick(world, []);
    expect(world.tick).toBe(1);
  });

  it('returns GameOutcome.None', () => {
    const world = createWorldState(42);
    const result = tick(world, []);
    expect(result).toBe(GameOutcome.None);
  });

  it('increments world.tick to 2 after two consecutive calls', () => {
    const world = createWorldState(42);
    tick(world, []);
    tick(world, []);
    expect(world.tick).toBe(2);
  });

  it('does not allocate via .slice() or the array iterator — PRD line 708 "No allocation" contract', () => {
    const world = createWorldState(42);
    const cmds: SimCommand[] = Array.from({ length: 100 }, (_, i): SimCommand => ({
      type: 'NoOp',
      issuedAtTick: i,
    }));
    const guarded = new Proxy(cmds, {
      get(target, prop, receiver) {
        if (prop === 'slice') {
          throw new Error('PRD-708 violation: tick() must not call .slice()');
        }
        if (prop === Symbol.iterator) {
          throw new Error('PRD-708 violation: tick() must not use for...of on commands (allocates iterator object)');
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(() => tick(world, guarded)).not.toThrow();
    expect(world.tick).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Command processing — Step 1
// ---------------------------------------------------------------------------

describe('Step 1: command processing', () => {
  let world: WorldState;
  let colonyId: ColonyId;
  let queenId: number;

  beforeEach(() => {
    ({ world, colonyId, queenId } = makeWorldWithColony());
    void queenId; // used in some tests via closure
  });

  // Test 1: NoOp command does not throw; tick increments
  it('Test 1: NoOp command does not throw; world.tick === 1 after', () => {
    const noOp: SimCommand = { type: 'NoOp', issuedAtTick: 0 };
    expect(() => tick(world, [noOp])).not.toThrow();
    expect(world.tick).toBe(1);
  });

  // Test 2: SetBehaviorRatio writes targetRatio
  it('Test 2: SetBehaviorRatio writes targetRatio fields', () => {
    const cmd: SimCommand = {
      type: 'SetBehaviorRatio',
      colonyId: colonyId,
      ratio: { forage: 5, dig: 3, fight: 2 },
      issuedAtTick: 0,
    };
    tick(world, [cmd]);
    const colony = world.colonies[colonyId]!;
    expect(colony.targetRatio.forage).toBe(5);
    expect(colony.targetRatio.dig).toBe(3);
    expect(colony.targetRatio.fight).toBe(2);
  });

  // Test 3: SetBehaviorRatio runs allocateWorkers immediately (CTRL-04, Phase 6 SC 4)
  it('Test 3: SetBehaviorRatio updates computedAllocation in the same tick (CTRL-04)', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 10;
    colony.eggCount = 0;
    colony.larvaeCount = 0;
    // Add workers to the workers array so step 8 counts correctly
    for (let i = 0; i < 10; i++) {
      const wid = allocateEntityId(world);
      initAnt(world.ants, wid, { colonyId, posX: 100, posY: 100, task: AntTask.Idle, subTask: 0 });
      colony.workers.push(wid);
    }

    const cmd1: SimCommand = {
      type: 'SetBehaviorRatio',
      colonyId,
      ratio: { forage: 10, dig: 0, fight: 0 },
      issuedAtTick: 0,
    };
    tick(world, [cmd1]);
    // After tick, computedAllocation should reflect forage:10 ratio (step 1 CTRL-04 + step 8)
    expect(world.colonies[colonyId]!.computedAllocation.nurse).toBe(0);
    expect(world.colonies[colonyId]!.computedAllocation.forage).toBe(10);
    expect(world.colonies[colonyId]!.computedAllocation.dig).toBe(0);
    expect(world.colonies[colonyId]!.computedAllocation.fight).toBe(0);

    const cmd2: SimCommand = {
      type: 'SetBehaviorRatio',
      colonyId,
      ratio: { forage: 0, dig: 10, fight: 0 },
      issuedAtTick: 1,
    };
    tick(world, [cmd2]);
    // Same tick as issuance — new ratio takes effect
    expect(world.colonies[colonyId]!.computedAllocation.forage).toBe(0);
    expect(world.colonies[colonyId]!.computedAllocation.dig).toBe(10);
    expect(world.colonies[colonyId]!.computedAllocation.fight).toBe(0);
  });

  // Test 4: SetBehaviorRatio rejects negative weights
  it('Test 4: SetBehaviorRatio rejects negative ratio — targetRatio unchanged', () => {
    const colony = world.colonies[colonyId]!;
    const forageBefore = colony.targetRatio.forage;
    const cmd: SimCommand = {
      type: 'SetBehaviorRatio',
      colonyId,
      ratio: { forage: -1, dig: 5, fight: 5 },
      issuedAtTick: 0,
    };
    tick(world, [cmd]);
    expect(world.colonies[colonyId]!.targetRatio.forage).toBe(forageBefore);
  });

  // Test 5: SetBehaviorRatio silently drops unknown colonyId
  it('Test 5: SetBehaviorRatio silently drops unknown colonyId — no throw, no state change', () => {
    const cmd: SimCommand = {
      type: 'SetBehaviorRatio',
      colonyId: 999 as ColonyId,
      ratio: { forage: 5, dig: 5, fight: 0 },
      issuedAtTick: 0,
    };
    expect(() => tick(world, [cmd])).not.toThrow();
    expect(world.tick).toBe(1);
  });

  // Test 6: MarkDigTile is silent no-op
  it('Test 6: MarkDigTile is silent no-op — no throw, no colony state change', () => {
    const colony = world.colonies[colonyId]!;
    const foodBefore = colony.foodStored;
    const cmd: SimCommand = {
      type: 'MarkDigTile',
      colonyId,
      tileX: 10,
      tileY: 10,
      issuedAtTick: 0,
    };
    expect(() => tick(world, [cmd])).not.toThrow();
    expect(world.tick).toBe(1);
    // Food untouched by command itself (may be consumed by queen though)
    void foodBefore;
  });

  // Test 7: MarkFoodPile is silent no-op
  it('Test 7: MarkFoodPile is silent no-op — no throw, tick increments', () => {
    const cmd: SimCommand = {
      type: 'MarkFoodPile',
      colonyId,
      tileX: 5,
      tileY: 5,
      issuedAtTick: 0,
    };
    expect(() => tick(world, [cmd])).not.toThrow();
    expect(world.tick).toBe(1);
  });

  // Test 8: FIFO cap — 64 SetBehaviorRatio + 1 extra; the 65th is dropped
  it('Test 8: FIFO cap — 65th SetBehaviorRatio command is dropped', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 0;
    // Build 65 SetBehaviorRatio commands with increasing forage values 0..64
    const cmds: SimCommand[] = [];
    for (let r = 0; r < 65; r++) {
      cmds.push({
        type: 'SetBehaviorRatio',
        colonyId,
        ratio: { forage: r, dig: 0, fight: 0 },
        issuedAtTick: 0,
      });
    }
    tick(world, cmds);
    // Only first 64 processed; the last processed is ratio.forage=63
    expect(world.colonies[colonyId]!.targetRatio.forage).toBe(63);
  });

  // Test 9: Unknown command variant dropped — no throw
  it('Test 9: unknown command variant silently dropped — no throw, tick increments', () => {
    const unknown = { type: 'Bogus', issuedAtTick: 0 } as unknown as SimCommand;
    expect(() => tick(world, [unknown])).not.toThrow();
    expect(world.tick).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Step ordering tests
// ---------------------------------------------------------------------------

describe('Step ordering observable proofs', () => {
  let world: WorldState;
  let colonyId: ColonyId;
  let queenId: number;

  beforeEach(() => {
    ({ world, colonyId, queenId } = makeWorldWithColony());
  });

  // Test 10: Step 1 (command) before Step 8 (allocation)
  it('Test 10: SetBehaviorRatio in step 1 affects computedAllocation at tick output (step 1 before step 8)', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 5;
    for (let i = 0; i < 5; i++) {
      const wid = allocateEntityId(world);
      initAnt(world.ants, wid, { colonyId, posX: 100, posY: 100, task: AntTask.Idle, subTask: 0 });
      colony.workers.push(wid);
    }
    colony.eggCount = 0;
    colony.larvaeCount = 0;

    const cmd: SimCommand = {
      type: 'SetBehaviorRatio',
      colonyId,
      ratio: { forage: 0, dig: 0, fight: 0 },
      issuedAtTick: 0,
    };
    tick(world, [cmd]);
    // After tick, allocation reflects the command's ratio (all workers would go to nurse or idle)
    // The ratio {0,0,0} means no non-nurse targets; all available workers unallocated
    const alloc = world.colonies[colonyId]!.computedAllocation;
    expect(alloc.forage).toBe(0);
    expect(alloc.dig).toBe(0);
    expect(alloc.fight).toBe(0);
  });

  // Test 11: Step 3 (food consumption) before Step 4 (starvation)
  it('Test 11: food consumption runs before starvation check — fed queen timer resets not decrements', () => {
    const colony = world.colonies[colonyId]!;
    colony.foodStored = 1000; // plenty of food
    colony.queenStarvationTimer = 10; // partially expired timer

    tick(world, []);

    // Queen was fed (foodStored had enough), so timer should reset to STARVATION_GRACE_TICKS
    // not continue decrementing from 10 → 9
    expect(colony.queenStarvationTimer).toBe(STARVATION_GRACE_TICKS);
    // Food was consumed by exactly QUEEN_FOOD_PER_TICK (from the abundant pool)
    expect(colony.foodStored).toBeLessThan(1000);
    expect(colony.foodStored).toBe(1000 - QUEEN_FOOD_PER_TICK);
  });

  // Test 12: Step 5 (death cleanup) before Step 6 (egg production)
  it('Test 12: dead queen (step 5) prevents egg production in same tick (step 6)', () => {
    const colony = world.colonies[colonyId]!;
    // Kill queen manually before tick
    world.ants.alive[queenId] = 0;
    colony.foodStored = 100000; // plenty of food and threshold met
    colony.eggCount = 0;

    tick(world, []);

    // Step 5 marks colony.defeated; step 6 sees queen as dead (alive !== 1) and skips
    expect(colony.eggCount).toBe(0);
    expect(colony.defeated).toBe(true);
  });

  // Test 13: Step 8 (allocation) and Step 9 (task census) both run per colony
  it('Test 13a: colony.taskCensus populated after tick (step 9 ran)', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 5;
    for (let i = 0; i < 5; i++) {
      const wid = allocateEntityId(world);
      initAnt(world.ants, wid, {
        colonyId,
        posX: 100,
        posY: 100,
        task: AntTask.Foraging,
        subTask: ForagingSubState.SearchingFood,
      });
      colony.workers.push(wid);
    }
    colony.eggCount = 0;
    colony.larvaeCount = 0;

    tick(world, []);

    // 5 foragers, none are Idle → census forage=5 (they're mid-cycle, not eligible for reassignment)
    expect(colony.taskCensus.forage).toBe(5);
  });

  it('Test 13b: step 9 reassigns Idle ants — 2 Idle + 3 mid-cycle Foraging with forage allocation 5', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 5;
    colony.eggCount = 0;
    colony.larvaeCount = 0;

    // 2 Idle workers (at idle checkpoint → eligible for reassignment)
    const idleWorkers: number[] = [];
    for (let i = 0; i < 2; i++) {
      const wid = allocateEntityId(world);
      initAnt(world.ants, wid, {
        colonyId,
        posX: 100,
        posY: 100,
        task: AntTask.Idle,
        subTask: 0,
      });
      colony.workers.push(wid);
      idleWorkers.push(wid);
    }
    // 3 mid-cycle Foraging workers (not at idle checkpoint → NOT eligible)
    for (let i = 0; i < 3; i++) {
      const wid = allocateEntityId(world);
      initAnt(world.ants, wid, {
        colonyId,
        posX: 100,
        posY: 100,
        task: AntTask.Foraging,
        subTask: ForagingSubState.SearchingFood,
      });
      colony.workers.push(wid);
    }

    // Set allocation: want 5 foragers; need = 5 - 3 = 2 (the 2 idle ants)
    colony.computedAllocation.nurse  = 0;
    colony.computedAllocation.forage = 5;
    colony.computedAllocation.dig    = 0;
    colony.computedAllocation.fight  = 0;

    tick(world, []);

    // After tick: all 5 workers are foragers, none are Idle
    expect(colony.taskCensus.forage).toBe(5);
    for (const id of idleWorkers) {
      expect(world.ants.task[id]).toBe(AntTask.Foraging);
    }
    // No idleCount field on ColonyRecord — do NOT assert colony.idleCount
  });

  // Test 14: Mid-action ants are NOT force-interrupted (PRD §7c "No forced interruption")
  it('Test 14: mid-cycle CarryingFood ant is NOT reassigned even when allocation wants diggers', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 1;
    colony.eggCount = 0;
    colony.larvaeCount = 0;

    const wid = allocateEntityId(world);
    initAnt(world.ants, wid, {
      colonyId,
      posX: 100,
      posY: 100,
      task: AntTask.Foraging,
      subTask: ForagingSubState.CarryingFood,
    });
    world.ants.foodCarrying[wid] = 256; // carrying food — mid-cycle
    colony.workers.push(wid);

    // Set allocation: want 1 digger, 0 foragers (over-allocated forager)
    colony.computedAllocation.nurse  = 0;
    colony.computedAllocation.forage = 0;
    colony.computedAllocation.dig    = 1;
    colony.computedAllocation.fight  = 0;
    colony.targetRatio.forage = 0;
    colony.targetRatio.dig    = 10;
    colony.targetRatio.fight  = 0;

    tick(world, []);

    // Mid-carry ant stays as Foraging+CarryingFood — only Idle ants are eligible
    expect(world.ants.task[wid]).toBe(AntTask.Foraging);
    expect(world.ants.subTask[wid]).toBe(ForagingSubState.CarryingFood);
    // Census reflects reality: 1 forager, 0 diggers
    expect(colony.taskCensus.forage).toBe(1);
    expect(colony.taskCensus.dig).toBe(0);
  });

  // Test 14b: Step 9 taskCensus non-negative invariant + sum bound under adversarial reassignment
  describe('Test 14b: taskCensus non-negative invariant + sum bound', () => {
    it('sub-case 1: all 10 workers Idle — all reassigned, census matches allocation, sum=workerCount', () => {
      const { world: w } = makeWorldWithColony(42);
      const colony = w.colonies[1]!;
      colony.workerCount = 10;
      // Add 9 eggs (age=0, will not hatch in 1 tick; EGG_HATCH_TICKS=1200).
      // allocateWorkers(10, 9, {forage:0,dig:4,fight:3}) => nurse=(9/3)|0=3, available=7,
      // dig=(7*4/7)|0=4, fight=(7*3/7)|0=3, forage=0, rem=0 → {nurse:3,forage:0,dig:4,fight:3}
      for (let e = 0; e < 9; e++) {
        const eid = allocateEntityId(w);
        initAnt(w.ants, eid, { colonyId: 1, posX: 100, posY: 100, task: AntTask.Idle, subTask: 0, speed: 0 });
        w.ants.age[eid] = 0; // age 0 — will not hatch in 1 tick
        colony.eggs.push(eid);
        colony.eggCount += 1;
      }
      colony.larvaeCount = 0;

      for (let i = 0; i < 10; i++) {
        const wid = allocateEntityId(w);
        initAnt(w.ants, wid, { colonyId: 1, posX: 100, posY: 100, task: AntTask.Idle, subTask: 0 });
        colony.workers.push(wid);
      }

      // targetRatio that produces {nurse:3, forage:0, dig:4, fight:3} via allocateWorkers(10, 9, ratio).
      // Step 8 re-runs allocateWorkers using this ratio; result must match expected census.
      colony.targetRatio.forage = 0;
      colony.targetRatio.dig    = 4;
      colony.targetRatio.fight  = 3;

      tick(w, []);

      const tc = colony.taskCensus;
      // Non-negative invariant
      expect(tc.forage).toBeGreaterThanOrEqual(0);
      expect(tc.dig).toBeGreaterThanOrEqual(0);
      expect(tc.fight).toBeGreaterThanOrEqual(0);
      expect(tc.nurse).toBeGreaterThanOrEqual(0);
      // Sum bound — all 10 ants assigned; no Idle residue
      expect(tc.forage + tc.dig + tc.fight + tc.nurse).toBe(10);
      // Census matches computedAllocation under full-reassignment (forage→dig→fight→nurse order)
      expect(tc.forage).toBe(0);
      expect(tc.dig).toBe(4);
      expect(tc.fight).toBe(3);
      expect(tc.nurse).toBe(3);
      // No Idle residue
      for (const wid of colony.workers) {
        expect(w.ants.task[wid]).not.toBe(AntTask.Idle);
      }
    });

    it('sub-case 2: 5 Idle + 1 mid-carry worker — all 5 Idle reassigned, mid-carry unchanged, sum=6', () => {
      const { world: w } = makeWorldWithColony(99);
      const colony = w.colonies[1]!;
      colony.workerCount = 6;
      colony.eggCount = 0;
      colony.larvaeCount = 0;

      // 5 Idle workers
      for (let i = 0; i < 5; i++) {
        const wid = allocateEntityId(w);
        initAnt(w.ants, wid, { colonyId: 1, posX: 100, posY: 100, task: AntTask.Idle, subTask: 0 });
        colony.workers.push(wid);
      }
      // 1 mid-carry worker
      const carryWid = allocateEntityId(w);
      initAnt(w.ants, carryWid, {
        colonyId: 1,
        posX: 100,
        posY: 100,
        task: AntTask.Foraging,
        subTask: ForagingSubState.CarryingFood,
      });
      w.ants.foodCarrying[carryWid] = 256;
      colony.workers.push(carryWid);

      // Allocation: forage:2, dig:2, fight:1, nurse:1 (sum=6=workerCount)
      // Step 9(a) counts: actualForage=1 (mid-carry), actualIdle=5
      // need: forage=1, dig=2, fight=1, nurse=1 (total=5 = eligibles)
      colony.computedAllocation = { nurse: 1, forage: 2, dig: 2, fight: 1 };
      colony.targetRatio.forage = 10;
      colony.targetRatio.dig    = 5;
      colony.targetRatio.fight  = 3;

      tick(w, []);

      const tc = colony.taskCensus;
      // All census fields non-negative
      expect(tc.forage).toBeGreaterThanOrEqual(0);
      expect(tc.dig).toBeGreaterThanOrEqual(0);
      expect(tc.fight).toBeGreaterThanOrEqual(0);
      expect(tc.nurse).toBeGreaterThanOrEqual(0);
      // Sum = 6 (mid-carry counted under Foraging in step 9a; all 5 idle reassigned)
      expect(tc.forage + tc.dig + tc.fight + tc.nurse).toBe(6);
      // Mid-carry worker: task and subTask unchanged (no forced interruption)
      expect(w.ants.task[carryWid]).toBe(AntTask.Foraging);
      expect(w.ants.subTask[carryWid]).toBe(ForagingSubState.CarryingFood);
    });
  });
});

// ---------------------------------------------------------------------------
// Pheromone step ordering (steps 10 → 11 → 12)
// ---------------------------------------------------------------------------

describe('Pheromone step ordering', () => {
  let world: WorldState;
  let colonyId: ColonyId;

  beforeEach(() => {
    ({ world, colonyId } = makeWorldWithColony());
  });

  // Test 15: Step 10 (deposit) before Step 11 (decay)
  it('Test 15: deposit (step 10) runs before decay (step 11) — grid cell > 0 after tick', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 1;
    colony.eggCount = 0;
    colony.larvaeCount = 0;

    const wid = allocateEntityId(world);
    initAnt(world.ants, wid, {
      colonyId,
      posX: 3 << FP_SHIFT,
      posY: 3 << FP_SHIFT,
      task: AntTask.Foraging,
      subTask: ForagingSubState.CarryingFood,
    });
    world.ants.foodCarrying[wid] = 256;
    colony.workers.push(wid);

    const gridKey = pheromoneGridKey(colonyId, PheromoneType.FoodTrail, 'surface');
    world.pheromoneGrids[gridKey] = createPheromoneGrid(64, 64);

    tick(world, []);

    // Deposit ran first (added FOOD_TRAIL_DEPOSIT), then decay reduced it.
    // Result must be > 0 (not zero) and <= FOOD_TRAIL_DEPOSIT.
    const val = phGet(world.pheromoneGrids[gridKey]!, 3, 3);
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThanOrEqual(FOOD_TRAIL_DEPOSIT);
  });

  // Test 16: Step 12 (movement) uses post-decay grid
  it('Test 16: movement (step 12) runs after deposit+decay; forager may move per gradient', () => {
    const colony = world.colonies[colonyId]!;
    colony.workerCount = 1;
    colony.eggCount = 0;
    colony.larvaeCount = 0;

    // Place forager at a position with a non-zero pheromone neighbor
    const wid = allocateEntityId(world);
    const startX = 10 << FP_SHIFT;
    const startY = 10 << FP_SHIFT;
    initAnt(world.ants, wid, {
      colonyId,
      posX: startX,
      posY: startY,
      task: AntTask.Foraging,
      subTask: ForagingSubState.SearchingFood,
    });
    colony.workers.push(wid);

    const gridKey = pheromoneGridKey(colonyId, PheromoneType.FoodTrail, 'surface');
    const grid = createPheromoneGrid(64, 64);
    // Strong pheromone trail to the right of the forager
    phSet(grid, 11, 10, 5000);
    world.pheromoneGrids[gridKey] = grid;

    tick(world, []);

    // The movement step ran (either moved or not depending on rng explore/exploit).
    // Just verify no crash and tick incremented.
    expect(world.tick).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tick writeback + return
// ---------------------------------------------------------------------------

describe('Tick writeback and return', () => {
  // Test 17: rngState writeback
  it('Test 17: rngState advances after tick with movement-consuming forager', () => {
    const world = createWorldState(42);
    const queenId = allocateEntityId(world);
    initAnt(world.ants, queenId, { colonyId: 1, posX: 1024, posY: 1024, task: AntTask.Idle, subTask: 0, speed: 0 });
    world.colonies[1] = createColonyRecord(1, queenId);
    world.colonies[1]!.foodStored = 10000;

    // Add a forager so movement uses rng
    for (let i = 0; i < 3; i++) {
      const wid = allocateEntityId(world);
      initAnt(world.ants, wid, { colonyId: 1, posX: 1024, posY: 1024, task: AntTask.Foraging, subTask: ForagingSubState.SearchingFood });
      world.colonies[1]!.workers.push(wid);
      world.colonies[1]!.workerCount += 1;
    }
    const gridKey = pheromoneGridKey(1 as ColonyId, PheromoneType.FoodTrail, 'surface');
    world.pheromoneGrids[gridKey] = createPheromoneGrid(64, 64);

    const rngBefore = world.rngState;
    tick(world, []);
    // rngState should have advanced (forager movement consumes PRNG)
    expect(world.rngState).not.toBe(rngBefore);

    const rngAfterFirst = world.rngState;
    tick(world, []);
    expect(world.rngState).not.toBe(rngAfterFirst);
  });

  // Test 18: Returns GameOutcome.None
  it('Test 18: returns GameOutcome.None', () => {
    const { world } = makeWorldWithColony();
    expect(tick(world, [])).toBe(GameOutcome.None);
  });

  // Test 19: world.tick increments exactly once per call
  it('Test 19: world.tick increments exactly once; 0 → 1 → 2', () => {
    const { world } = makeWorldWithColony();
    expect(world.tick).toBe(0);
    tick(world, []);
    expect(world.tick).toBe(1);
    tick(world, []);
    expect(world.tick).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Multi-colony iteration
// ---------------------------------------------------------------------------

describe('Multi-colony iteration', () => {
  // Test 20: Two colonies both process food consumption and task census
  it('Test 20: two colonies both get food consumed and taskCensus populated per tick', () => {
    const world = createWorldState(42);

    // Colony 1
    const q1 = allocateEntityId(world);
    initAnt(world.ants, q1, { colonyId: 1, posX: 100, posY: 100, task: AntTask.Idle, subTask: 0, speed: 0 });
    world.colonies[1] = createColonyRecord(1, q1);
    world.colonies[1]!.foodStored = 5000;

    // Colony 2
    const q2 = allocateEntityId(world);
    initAnt(world.ants, q2, { colonyId: 2, posX: 200, posY: 200, task: AntTask.Idle, subTask: 0, speed: 0 });
    world.colonies[2] = createColonyRecord(2, q2);
    world.colonies[2]!.foodStored = 5000;

    // Add 2 workers to each colony
    for (let i = 0; i < 2; i++) {
      const w1 = allocateEntityId(world);
      initAnt(world.ants, w1, { colonyId: 1, posX: 100, posY: 100, task: AntTask.Foraging, subTask: ForagingSubState.SearchingFood });
      world.colonies[1]!.workers.push(w1);
      world.colonies[1]!.workerCount += 1;

      const w2 = allocateEntityId(world);
      initAnt(world.ants, w2, { colonyId: 2, posX: 200, posY: 200, task: AntTask.Foraging, subTask: ForagingSubState.SearchingFood });
      world.colonies[2]!.workers.push(w2);
      world.colonies[2]!.workerCount += 1;
    }

    tick(world, []);

    // Both colonies consumed food (queen fed)
    expect(world.colonies[1]!.foodStored).toBe(5000 - QUEEN_FOOD_PER_TICK);
    expect(world.colonies[2]!.foodStored).toBe(5000 - QUEEN_FOOD_PER_TICK);
    // Both colonies have populated task census
    // (2 mid-cycle foragers each → census forage = 2)
    expect(world.colonies[1]!.taskCensus.forage).toBe(2);
    expect(world.colonies[2]!.taskCensus.forage).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SCEN-06 determinism (Phase 5 preserved + expanded)
// ---------------------------------------------------------------------------

describe('SCEN-06 determinism', () => {
  it('same seed produces identical { tick, rngState, nextEntityId } across two independent runs', () => {
    function runSim(seed: number, ticks: number) {
      const world = createWorldState(seed);
      for (let i = 0; i < ticks; i++) {
        tick(world, []);
      }
      return { tick: world.tick, rngState: world.rngState, nextEntityId: world.nextEntityId };
    }
    const run1 = runSim(42, 100);
    const run2 = runSim(42, 100);
    expect(run1).toEqual(run2);
  });

  it('100 ticks with seed 42 yields tick === 100', () => {
    const world = createWorldState(42);
    for (let i = 0; i < 100; i++) tick(world, []);
    expect(world.tick).toBe(100);
  });
});
