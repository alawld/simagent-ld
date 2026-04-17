// lifecycle-system.test.ts — CLNY-01, CLNY-02, CLNY-03 + Phase 6 SC 1 integration
//
// Test coverage:
//   CLNY-01: tickQueenEggProduction gates (tick-modulo, food threshold, queen alive)
//   CLNY-02: egg→larva transition at EGG_HATCH_TICKS
//   CLNY-03: larva→worker transition at LARVA_MATURE_TICKS
//   Integration: full queen→egg→larva→worker pipeline over 3700 ticks

import { describe, it, expect } from 'vitest';
import { tickQueenEggProduction, tickLifecycleTransitions } from './lifecycle-system.js';
import { createWorldState } from '../types.js';
import { createColonyRecord } from './colony-store.js';
import { initAnt } from '../ant/ant-store.js';
import { AntTask } from '../enums.js';
import {
  QUEEN_EGG_INTERVAL_TICKS,
  QUEEN_EGG_FOOD_THRESHOLD,
  EGG_HATCH_TICKS,
  LARVA_MATURE_TICKS,
  WORKER_BASE_SPEED,
  STARVATION_GRACE_TICKS,
} from '../constants.js';
import type { WorldState } from '../types.js';
import type { ColonyRecord } from './colony-store.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const COLONY_ID = 1;
const MAX_TEST_ENTITIES = 512;

/**
 * Create a fresh world + colony with a live queen at position (queenX, queenY).
 * The queen entity is allocated as entity 0; the colony record references it.
 * foodStored defaults to 10_000 (well above QUEEN_EGG_FOOD_THRESHOLD).
 */
function setupWorldWithQueen(
  foodStored: number = 10_000,
  queenX = 1024,
  queenY = 512,
): { world: WorldState; colony: ColonyRecord } {
  const world = createWorldState(42, MAX_TEST_ENTITIES);
  const queenId = world.nextEntityId; // 0
  world.nextEntityId += 1;

  initAnt(world.ants, queenId, {
    colonyId: COLONY_ID,
    posX:     queenX,
    posY:     queenY,
    task:     AntTask.Idle,
    speed:    0,
  });

  const colony = createColonyRecord(COLONY_ID, queenId);
  colony.foodStored = foodStored;
  world.colonies[COLONY_ID] = colony;

  return { world, colony };
}

// ---------------------------------------------------------------------------
// CLNY-01: tickQueenEggProduction gates
// ---------------------------------------------------------------------------

describe('tickQueenEggProduction — CLNY-01', () => {
  it('1. produces one egg at tick 0 when all gates pass', () => {
    const { world, colony } = setupWorldWithQueen(QUEEN_EGG_FOOD_THRESHOLD);
    world.tick = 0; // 0 % 300 === 0

    tickQueenEggProduction(world, colony);

    expect(colony.eggs.length).toBe(1);
    expect(colony.eggCount).toBe(1);

    const eggId = colony.eggs[0]!;
    expect(world.ants.age[eggId]).toBe(0);
    expect(world.ants.alive[eggId]).toBe(1);
  });

  it('2. does NOT produce an egg when foodStored is below threshold', () => {
    const { world, colony } = setupWorldWithQueen(QUEEN_EGG_FOOD_THRESHOLD - 1);
    world.tick = 0;

    tickQueenEggProduction(world, colony);

    expect(colony.eggs.length).toBe(0);
    expect(colony.eggCount).toBe(0);
  });

  it('3. does NOT produce an egg when queen is dead', () => {
    const { world, colony } = setupWorldWithQueen();
    world.tick = 0;
    world.ants.alive[colony.queenEntityId] = 0; // kill the queen

    tickQueenEggProduction(world, colony);

    expect(colony.eggs.length).toBe(0);
    expect(colony.eggCount).toBe(0);
  });

  it('4. does NOT produce an egg when tick is off-cycle (tick=1)', () => {
    const { world, colony } = setupWorldWithQueen();
    world.tick = 1; // 1 % 300 !== 0

    tickQueenEggProduction(world, colony);

    expect(colony.eggs.length).toBe(0);
    expect(colony.eggCount).toBe(0);
  });

  it('5. produces an egg at tick 300 (second interval)', () => {
    const { world, colony } = setupWorldWithQueen();
    world.tick = QUEEN_EGG_INTERVAL_TICKS; // 300 % 300 === 0

    tickQueenEggProduction(world, colony);

    expect(colony.eggs.length).toBe(1);
    expect(colony.eggCount).toBe(1);
  });

  it('6. new egg spawns at queen position', () => {
    const QUEEN_X = 1024;
    const QUEEN_Y = 512;
    const { world, colony } = setupWorldWithQueen(10_000, QUEEN_X, QUEEN_Y);
    world.tick = 0;

    tickQueenEggProduction(world, colony);

    const eggId = colony.eggs[0]!;
    expect(world.ants.posX[eggId]).toBe(QUEEN_X);
    expect(world.ants.posY[eggId]).toBe(QUEEN_Y);
  });
});

// ---------------------------------------------------------------------------
// CLNY-02: Egg hatch transitions
// ---------------------------------------------------------------------------

describe('tickLifecycleTransitions — CLNY-02 egg hatch', () => {
  it('7. egg hatches into larva after EGG_HATCH_TICKS transitions', () => {
    const { world, colony } = setupWorldWithQueen();

    // Manually add one egg entity
    const eggId = world.nextEntityId++;
    initAnt(world.ants, eggId, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    world.ants.age[eggId] = 0;
    colony.eggs.push(eggId);
    colony.eggCount = 1;

    // Run exactly EGG_HATCH_TICKS transitions
    for (let t = 0; t < EGG_HATCH_TICKS; t++) {
      tickLifecycleTransitions(world, colony);
    }

    expect(colony.eggs.length).toBe(0);
    expect(colony.eggCount).toBe(0);
    expect(colony.larvae.length).toBe(1);
    expect(colony.larvaeCount).toBe(1);
    expect(world.ants.age[eggId]).toBe(0); // age reset on transition
  });

  it('8. egg does NOT hatch at 1199 ticks (one tick short)', () => {
    const { world, colony } = setupWorldWithQueen();

    const eggId = world.nextEntityId++;
    initAnt(world.ants, eggId, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    colony.eggs.push(eggId);
    colony.eggCount = 1;

    for (let t = 0; t < EGG_HATCH_TICKS - 1; t++) {
      tickLifecycleTransitions(world, colony);
    }

    expect(colony.eggs.length).toBe(1);
    expect(colony.larvae.length).toBe(0);
    expect(world.ants.age[eggId]).toBe(EGG_HATCH_TICKS - 1);
  });

  it('9. two eggs both hatch in the same tick when both reach EGG_HATCH_TICKS', () => {
    const { world, colony } = setupWorldWithQueen();

    const e1 = world.nextEntityId++;
    const e2 = world.nextEntityId++;
    initAnt(world.ants, e1, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    initAnt(world.ants, e2, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    colony.eggs.push(e1, e2);
    colony.eggCount = 2;

    for (let t = 0; t < EGG_HATCH_TICKS; t++) {
      tickLifecycleTransitions(world, colony);
    }

    expect(colony.eggs.length).toBe(0);
    expect(colony.eggCount).toBe(0);
    expect(colony.larvae.length).toBe(2);
    expect(colony.larvaeCount).toBe(2);
  });

  it('10. swap-remove preserves remaining eggs (set, not order)', () => {
    const { world, colony } = setupWorldWithQueen();

    // e1 at age 1200 (will hatch), e2 and e3 at age 500 (will NOT hatch)
    const e1 = world.nextEntityId++;
    const e2 = world.nextEntityId++;
    const e3 = world.nextEntityId++;
    initAnt(world.ants, e1, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    initAnt(world.ants, e2, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    initAnt(world.ants, e3, { colonyId: COLONY_ID, posX: 0, posY: 0 });

    // Pre-age: run e1 to hatch point, e2/e3 to mid-point
    world.ants.age[e1] = EGG_HATCH_TICKS - 1; // one more tick to hatch
    world.ants.age[e2] = 500;
    world.ants.age[e3] = 500;
    colony.eggs.push(e1, e2, e3);
    colony.eggCount = 3;

    // One transition call: e1 hatches (age 1200), e2 and e3 stay (age 501)
    tickLifecycleTransitions(world, colony);

    expect(colony.eggs.length).toBe(2);
    expect(colony.eggCount).toBe(2);
    // Both e2 and e3 must be in eggs (order may differ after swap-remove)
    expect(colony.eggs).toContain(e2);
    expect(colony.eggs).toContain(e3);
    expect(colony.eggs).not.toContain(e1);

    expect(colony.larvae.length).toBe(1);
    expect(colony.larvae[0]).toBe(e1);
  });
});

// ---------------------------------------------------------------------------
// CLNY-03: Larva mature transitions
// ---------------------------------------------------------------------------

describe('tickLifecycleTransitions — CLNY-03 larva mature', () => {
  it('11. larva matures into worker after LARVA_MATURE_TICKS transitions', () => {
    const { world, colony } = setupWorldWithQueen();

    const larvaId = world.nextEntityId++;
    initAnt(world.ants, larvaId, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    world.ants.age[larvaId] = 0;
    colony.larvae.push(larvaId);
    colony.larvaeCount = 1;

    for (let t = 0; t < LARVA_MATURE_TICKS; t++) {
      tickLifecycleTransitions(world, colony);
    }

    expect(colony.larvae.length).toBe(0);
    expect(colony.larvaeCount).toBe(0);
    expect(colony.workers.length).toBe(1);
    expect(colony.workerCount).toBe(1);
    expect(world.ants.age[larvaId]).toBe(0);               // age reset on transition
    expect(world.ants.task[larvaId]).toBe(AntTask.Idle);
    expect(world.ants.speed[larvaId]).toBe(WORKER_BASE_SPEED);
  });
});

// ---------------------------------------------------------------------------
// Starvation timer reset on promotion (PRD §4b)
// ---------------------------------------------------------------------------

describe('tickLifecycleTransitions — starvation timer reset on promotion', () => {
  it('15. egg→larva promotion resets starvationTimer to STARVATION_GRACE_TICKS', () => {
    const { world, colony } = setupWorldWithQueen();

    const eggId = world.nextEntityId++;
    initAnt(world.ants, eggId, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    world.ants.age[eggId] = EGG_HATCH_TICKS - 1; // one tick to hatch
    world.ants.starvationTimer[eggId] = 0; // worst case — should be reset
    colony.eggs.push(eggId);
    colony.eggCount = 1;

    tickLifecycleTransitions(world, colony);

    expect(colony.larvae).toContain(eggId);
    expect(world.ants.starvationTimer[eggId]).toBe(STARVATION_GRACE_TICKS);
  });

  it('16. larva→worker promotion resets starvationTimer to STARVATION_GRACE_TICKS', () => {
    const { world, colony } = setupWorldWithQueen();

    const larvaId = world.nextEntityId++;
    initAnt(world.ants, larvaId, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    world.ants.age[larvaId] = LARVA_MATURE_TICKS - 1; // one tick to mature
    world.ants.starvationTimer[larvaId] = 5; // low timer — should be reset
    colony.larvae.push(larvaId);
    colony.larvaeCount = 1;

    tickLifecycleTransitions(world, colony);

    expect(colony.workers).toContain(larvaId);
    expect(world.ants.starvationTimer[larvaId]).toBe(STARVATION_GRACE_TICKS);
  });
});

// ---------------------------------------------------------------------------
// Dead entity cleanup in lifecycle pass
// ---------------------------------------------------------------------------

describe('tickLifecycleTransitions — dead entity cleanup', () => {
  it('12. dead egg is swap-removed and eggCount decremented', () => {
    const { world, colony } = setupWorldWithQueen();

    const eggId = world.nextEntityId++;
    initAnt(world.ants, eggId, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    world.ants.alive[eggId] = 0; // mark dead before entering lifecycle
    colony.eggs.push(eggId);
    colony.eggCount = 1;

    tickLifecycleTransitions(world, colony);

    expect(colony.eggs.length).toBe(0);
    expect(colony.eggCount).toBe(0);
  });

  it('13. dead larva is swap-removed and larvaeCount decremented', () => {
    const { world, colony } = setupWorldWithQueen();

    const larvaId = world.nextEntityId++;
    initAnt(world.ants, larvaId, { colonyId: COLONY_ID, posX: 0, posY: 0 });
    world.ants.alive[larvaId] = 0; // mark dead
    colony.larvae.push(larvaId);
    colony.larvaeCount = 1;

    tickLifecycleTransitions(world, colony);

    expect(colony.larvae.length).toBe(0);
    expect(colony.larvaeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline integration — Phase 6 SC 1
// ---------------------------------------------------------------------------

describe('Full pipeline integration — Phase 6 SC 1', () => {
  it('14. queen→egg→larva→worker pipeline completes within 3700 ticks', () => {
    // Setup: queen + abundant food
    // EGG_HATCH_TICKS=1200 + LARVA_MATURE_TICKS=2400 = 3600 ticks for first egg to
    // become a worker. First egg laid at tick 0, matures at tick 3600.
    // With 3700 ticks (+100 margin), colony.workerCount >= 1.
    const { world, colony } = setupWorldWithQueen(10_000);
    world.tick = 0;

    for (let t = 0; t < 3700; t++) {
      tickQueenEggProduction(world, colony);
      tickLifecycleTransitions(world, colony);
      world.tick += 1;
    }

    // At tick 3700:
    //   - First egg laid at tick 0: hatches at tick 1200, matures at tick 3600 → 1 worker
    //   - Second egg laid at tick 300: hatches at tick 1500, matures at tick 3900 → still larva
    //   - Third egg laid at tick 600: hatches at tick 1800, matures at tick 4200 → still larva
    //   - Eggs laid at ticks 600..3600 are still in eggs or larvae buckets
    expect(colony.workerCount).toBeGreaterThanOrEqual(1);
    expect(colony.larvaeCount).toBeGreaterThan(0);
    expect(colony.eggCount).toBeGreaterThan(0);

    // Total eggs produced: ticks 0, 300, 600, ..., 3600 = 13 eggs (0-indexed intervals)
    // 1 should be a worker, several larvae, several eggs
    expect(colony.workerCount).toBe(1);
  });
});
