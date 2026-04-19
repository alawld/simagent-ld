// hud-stats.test.ts — Vitest unit tests for computeHudStats and formatters.

import { describe, it, expect } from 'vitest';
import {
  computeHudStats,
  formatStatsPrefix,
  formatQueenLabel,
} from './hud-stats.js';
import { createWorldState } from '../sim/types.js';
import type { WorldState } from '../sim/types.js';
import { allocateEntityId } from '../sim/types.js';
import { initAnt, killAnt } from '../sim/ant/ant-store.js';
import { createColonyRecord } from '../sim/colony/colony-store.js';
import type { ColonyRecord } from '../sim/colony/colony-store.js';
import { AntTask } from '../sim/enums.js';
import { STARVATION_GRACE_TICKS } from '../sim/constants.js';
import { FP_SHIFT } from '../sim/fixed.js';

function setupWorld(): { world: WorldState; colony: ColonyRecord; queenId: number } {
  const world = createWorldState(64);
  const queenId = allocateEntityId(world);
  initAnt(world.ants, queenId, { colonyId: 1, posX: 0, posY: 0, task: AntTask.Idle });
  const colony = createColonyRecord(1, queenId);
  colony.entrances = [];
  colony.rallyPoint = null;
  colony.digFlowFieldDirty = false;
  world.colonies[1] = colony;
  return { world, colony, queenId };
}

describe('computeHudStats', () => {
  it('antCount = workers + eggs + larvae + 1 when queen alive', () => {
    const { world, colony } = setupWorld();
    colony.workerCount = 5;
    colony.eggCount    = 3;
    colony.larvaeCount = 2;
    const s = computeHudStats(world, colony);
    expect(s.antCount).toBe(5 + 3 + 2 + 1);
    expect(s.queenAlive).toBe(true);
  });

  it('antCount excludes queen when queen dead', () => {
    const { world, colony, queenId } = setupWorld();
    colony.workerCount = 4;
    colony.eggCount    = 1;
    colony.larvaeCount = 0;
    killAnt(world.ants, queenId);
    const s = computeHudStats(world, colony);
    expect(s.antCount).toBe(5);
    expect(s.queenAlive).toBe(false);
  });

  it('foodDisplay converts from fixed-point to human units', () => {
    const { world, colony } = setupWorld();
    // 10 FP units per human unit → 2560 FP == 10 food
    colony.foodStored = 10 << FP_SHIFT;
    const s = computeHudStats(world, colony);
    expect(s.foodDisplay).toBe(10);
  });

  it('queenHealthPct = 100 at full grace', () => {
    const { world, colony } = setupWorld();
    colony.queenStarvationTimer = STARVATION_GRACE_TICKS;
    expect(computeHudStats(world, colony).queenHealthPct).toBe(100);
  });

  it('queenHealthPct scales linearly', () => {
    const { world, colony } = setupWorld();
    colony.queenStarvationTimer = Math.floor(STARVATION_GRACE_TICKS / 2);
    expect(computeHudStats(world, colony).queenHealthPct).toBe(50);
  });

  it('queenHealthPct = 0 when timer at or below 0', () => {
    const { world, colony } = setupWorld();
    colony.queenStarvationTimer = 0;
    expect(computeHudStats(world, colony).queenHealthPct).toBe(0);
    colony.queenStarvationTimer = -50;
    expect(computeHudStats(world, colony).queenHealthPct).toBe(0);
  });

  it('queenHealthPct clamps to 100 when timer above grace', () => {
    const { world, colony } = setupWorld();
    colony.queenStarvationTimer = STARVATION_GRACE_TICKS * 5;
    expect(computeHudStats(world, colony).queenHealthPct).toBe(100);
  });

  it('queenHealthPct = 0 when queen is dead, even if timer > 0', () => {
    const { world, colony, queenId } = setupWorld();
    colony.queenStarvationTimer = STARVATION_GRACE_TICKS;
    killAnt(world.ants, queenId);
    expect(computeHudStats(world, colony).queenHealthPct).toBe(0);
  });
});

describe('formatStatsPrefix', () => {
  it('renders ants + food with two-space separator', () => {
    expect(formatStatsPrefix({
      antCount: 11, foodDisplay: 4, queenHealthPct: 100, queenAlive: true,
    })).toBe('Ants: 11  Food: 4');
  });
});

describe('formatQueenLabel', () => {
  it('renders percentage when queen alive', () => {
    expect(formatQueenLabel({
      antCount: 1, foodDisplay: 0, queenHealthPct: 72, queenAlive: true,
    })).toBe('Queen: 72%');
  });

  it('renders DEAD when queen dead', () => {
    expect(formatQueenLabel({
      antCount: 0, foodDisplay: 0, queenHealthPct: 0, queenAlive: false,
    })).toBe('Queen: DEAD');
  });
});
