// hud-stats.test.ts — Vitest unit tests for computeHudStats, queen bar helpers,
// and label formatters.

import { describe, it, expect } from 'vitest';
import {
  computeHudStats,
  formatAntsLabel,
  formatFoodLabel,
  formatStatsPrefix,
  queenBarRect,
  queenHealthBarColor,
  queenHealthBarFillWidth,
  queenHealthState,
  HUD_STATS_COLORS,
  HUD_STATS_LAYOUT,
} from './hud-stats.js';
import type { HudStats } from './hud-stats.js';
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

function makeStats(overrides: Partial<HudStats> = {}): HudStats {
  return {
    antCount:       1,
    foodDisplay:    0,
    queenHealthPct: 100,
    queenAlive:     true,
    ...overrides,
  };
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

describe('label formatters', () => {
  it('formatAntsLabel reports total ant count', () => {
    expect(formatAntsLabel(makeStats({ antCount: 42 }))).toBe('Ants: 42');
  });

  it('formatFoodLabel reports integer food', () => {
    expect(formatFoodLabel(makeStats({ foodDisplay: 7 }))).toBe('Food: 7');
  });

  it('formatStatsPrefix combines both with two-space separator', () => {
    expect(formatStatsPrefix(makeStats({ antCount: 11, foodDisplay: 4 })))
      .toBe('Ants: 11  Food: 4');
  });
});

describe('queenHealthState (PRD §6c thresholds)', () => {
  it('returns "dead" when queen is dead regardless of pct', () => {
    expect(queenHealthState(makeStats({ queenAlive: false, queenHealthPct: 100 })))
      .toBe('dead');
  });

  it('returns "healthy" when pct > 50', () => {
    expect(queenHealthState(makeStats({ queenHealthPct: 51 }))).toBe('healthy');
    expect(queenHealthState(makeStats({ queenHealthPct: 100 }))).toBe('healthy');
  });

  it('returns "moderate" when 25 <= pct <= 50', () => {
    expect(queenHealthState(makeStats({ queenHealthPct: 50 }))).toBe('moderate');
    expect(queenHealthState(makeStats({ queenHealthPct: 37 }))).toBe('moderate');
    expect(queenHealthState(makeStats({ queenHealthPct: 25 }))).toBe('moderate');
  });

  it('returns "critical" when pct < 25', () => {
    expect(queenHealthState(makeStats({ queenHealthPct: 24 }))).toBe('critical');
    expect(queenHealthState(makeStats({ queenHealthPct: 0 }))).toBe('critical');
  });
});

describe('queenHealthBarColor', () => {
  it('maps each health state to its PRD color', () => {
    expect(queenHealthBarColor(makeStats({ queenHealthPct: 100 })))
      .toBe(HUD_STATS_COLORS.barHealthy);
    expect(queenHealthBarColor(makeStats({ queenHealthPct: 40 })))
      .toBe(HUD_STATS_COLORS.barModerate);
    expect(queenHealthBarColor(makeStats({ queenHealthPct: 10 })))
      .toBe(HUD_STATS_COLORS.barCritical);
    expect(queenHealthBarColor(makeStats({ queenAlive: false })))
      .toBe(HUD_STATS_COLORS.barCritical);
  });
});

describe('queenHealthBarFillWidth', () => {
  it('scales proportionally to pct', () => {
    expect(queenHealthBarFillWidth(makeStats({ queenHealthPct: 100 }), 48)).toBe(48);
    expect(queenHealthBarFillWidth(makeStats({ queenHealthPct: 50 }),  48)).toBe(24);
    expect(queenHealthBarFillWidth(makeStats({ queenHealthPct: 25 }),  48)).toBe(12);
  });

  it('returns 0 when queen is dead', () => {
    expect(queenHealthBarFillWidth(makeStats({ queenAlive: false, queenHealthPct: 99 }), 48))
      .toBe(0);
  });

  it('clamps within [0, totalW]', () => {
    expect(queenHealthBarFillWidth(makeStats({ queenHealthPct: 200 }), 48)).toBeLessThanOrEqual(48);
    expect(queenHealthBarFillWidth(makeStats({ queenHealthPct: -10 }), 48)).toBeGreaterThanOrEqual(0);
  });
});

describe('queenBarRect', () => {
  it('right-anchors the bar inside the 200x24 HUD.STATS rect', () => {
    const rect = queenBarRect({ x: 8, y: 8, w: 200, h: 24 });
    const { w, h, yOffset, rightInset } = HUD_STATS_LAYOUT.queenBar;
    expect(rect.w).toBe(w);
    expect(rect.h).toBe(h);
    expect(rect.y).toBe(8 + yOffset);
    expect(rect.x).toBe(8 + 200 - rightInset - w);
    // stays inside HUD.STATS horizontally
    expect(rect.x).toBeGreaterThanOrEqual(8);
    expect(rect.x + rect.w).toBeLessThanOrEqual(8 + 200);
    // stays inside HUD.STATS vertically
    expect(rect.y).toBeGreaterThanOrEqual(8);
    expect(rect.y + rect.h).toBeLessThanOrEqual(8 + 24);
  });
});
