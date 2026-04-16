// constants.test.ts — PRD §9c regression guard
//
// Each assertion pins the constant to its PRD §9c specification value.
// If a refactor changes a constant, the diff is immediately visible in
// the failure message alongside the PRD section reference.
//
// Run: npx vitest run src/sim/constants.test.ts

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BEHAVIOR_RATIO,
  DANGER_DECAY_FP,
  EGG_HATCH_TICKS,
  EXPLORE_RATE_PERCENT,
  FOOD_CHAMBER_CAPACITY,
  FOOD_PICKUP_AMOUNT,
  FOOD_TRAIL_DEPOSIT,
  FORAGER_ROUND_TRIP_TICKS,
  LARVA_FOOD_PER_TICK,
  LARVA_MATURE_TICKS,
  MAX_ENTITIES,
  NURSE_RATIO,
  PHEROMONE_CAP,
  PHEROMONE_DECAY_FP,
  PHEROMONE_FLOOR,
  QUEEN_EGG_FOOD_THRESHOLD,
  QUEEN_EGG_INTERVAL_TICKS,
  QUEEN_FOOD_PER_TICK,
  RECONCILE_INTERVAL_TICKS,
  STARVATION_GRACE_TICKS,
  SURFACE_GRID_HEIGHT,
  SURFACE_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH,
  WORKER_BASE_SPEED,
  WORKER_CARRY_CAPACITY,
  WORKER_FOOD_PER_TICK,
  WORKER_LIFESPAN_TICKS,
} from './constants';

describe('PRD §9c lifecycle tick constants', () => {
  it('EGG_HATCH_TICKS === 1200', () => {
    expect(EGG_HATCH_TICKS).toBe(1200);
  });

  it('LARVA_MATURE_TICKS === 2400', () => {
    expect(LARVA_MATURE_TICKS).toBe(2400);
  });

  it('WORKER_LIFESPAN_TICKS === 0x7FFFFFFF (INT32_MAX)', () => {
    expect(WORKER_LIFESPAN_TICKS).toBe(0x7FFFFFFF);
  });

  it('QUEEN_EGG_INTERVAL_TICKS === 300', () => {
    expect(QUEEN_EGG_INTERVAL_TICKS).toBe(300);
  });

  it('QUEEN_EGG_FOOD_THRESHOLD === 768', () => {
    expect(QUEEN_EGG_FOOD_THRESHOLD).toBe(768);
  });

  it('STARVATION_GRACE_TICKS === 100', () => {
    expect(STARVATION_GRACE_TICKS).toBe(100);
  });

  it('RECONCILE_INTERVAL_TICKS === 100', () => {
    expect(RECONCILE_INTERVAL_TICKS).toBe(100);
  });

  it('FORAGER_ROUND_TRIP_TICKS === 200', () => {
    expect(FORAGER_ROUND_TRIP_TICKS).toBe(200);
  });
});

describe('PRD §9c food economy constants', () => {
  it('QUEEN_FOOD_PER_TICK === 2', () => {
    expect(QUEEN_FOOD_PER_TICK).toBe(2);
  });

  it('LARVA_FOOD_PER_TICK === 1', () => {
    expect(LARVA_FOOD_PER_TICK).toBe(1);
  });

  it('WORKER_FOOD_PER_TICK === 0', () => {
    expect(WORKER_FOOD_PER_TICK).toBe(0);
  });

  it('WORKER_CARRY_CAPACITY === 1024 (4 × FP_ONE)', () => {
    expect(WORKER_CARRY_CAPACITY).toBe(1024);
  });

  it('FOOD_PICKUP_AMOUNT === 512 (2 × FP_ONE)', () => {
    expect(FOOD_PICKUP_AMOUNT).toBe(512);
  });

  it('FOOD_CHAMBER_CAPACITY === 5120 (20 × FP_ONE)', () => {
    expect(FOOD_CHAMBER_CAPACITY).toBe(5120);
  });

  it('WORKER_BASE_SPEED === 128 (0.5 × FP_ONE)', () => {
    expect(WORKER_BASE_SPEED).toBe(128);
  });
});

describe('PRD §9c pheromone constants', () => {
  it('PHEROMONE_DECAY_FP === 5', () => {
    expect(PHEROMONE_DECAY_FP).toBe(5);
  });

  it('DANGER_DECAY_FP === 10', () => {
    expect(DANGER_DECAY_FP).toBe(10);
  });

  it('PHEROMONE_FLOOR === 64', () => {
    expect(PHEROMONE_FLOOR).toBe(64);
  });

  it('PHEROMONE_CAP === 65280', () => {
    expect(PHEROMONE_CAP).toBe(65280);
  });

  it('FOOD_TRAIL_DEPOSIT === 512 (2 × FP_ONE)', () => {
    expect(FOOD_TRAIL_DEPOSIT).toBe(512);
  });

  it('EXPLORE_RATE_PERCENT === 10', () => {
    expect(EXPLORE_RATE_PERCENT).toBe(10);
  });
});

describe('PRD §9c allocation and budget constants', () => {
  it('NURSE_RATIO === 3', () => {
    expect(NURSE_RATIO).toBe(3);
  });

  it('MAX_ENTITIES === 8192', () => {
    expect(MAX_ENTITIES).toBe(8192);
  });
});

describe('PRD §9c grid dimension constants', () => {
  it('SURFACE_GRID_WIDTH === 128', () => {
    expect(SURFACE_GRID_WIDTH).toBe(128);
  });

  it('SURFACE_GRID_HEIGHT === 128', () => {
    expect(SURFACE_GRID_HEIGHT).toBe(128);
  });

  it('UNDERGROUND_GRID_WIDTH === 128', () => {
    expect(UNDERGROUND_GRID_WIDTH).toBe(128);
  });

  it('UNDERGROUND_GRID_HEIGHT === 64', () => {
    expect(UNDERGROUND_GRID_HEIGHT).toBe(64);
  });
});

describe('PRD §7 §2 DEFAULT_BEHAVIOR_RATIO', () => {
  it('forage === 10', () => {
    expect(DEFAULT_BEHAVIOR_RATIO.forage).toBe(10);
  });

  it('dig === 0', () => {
    expect(DEFAULT_BEHAVIOR_RATIO.dig).toBe(0);
  });

  it('fight === 0', () => {
    expect(DEFAULT_BEHAVIOR_RATIO.fight).toBe(0);
  });

  it('has exactly forage, dig, fight keys', () => {
    expect(Object.keys(DEFAULT_BEHAVIOR_RATIO).sort()).toStrictEqual(['dig', 'fight', 'forage']);
  });
});
