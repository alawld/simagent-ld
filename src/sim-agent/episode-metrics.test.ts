import { describe, it, expect } from 'vitest';
import { createScenario } from '../sim/scenario.js';
import { createTrainingWorldInvasionProbe } from '../sim/training-scenarios.js';
import { GameOutcome } from '../sim/game-over.js';
import { PLAYER_COLONY_ID, ENEMY_COLONY_ID } from '../sim/constants.js';
import { deriveAIColonyIds } from '../render/game-scene-logic.js';
import { buildEpisodeMetrics } from './episode-metrics.js';

describe('buildEpisodeMetrics', () => {
  it('returns numeric flags for a fresh scenario', () => {
    const world = createScenario(99);
    const enemyIds = deriveAIColonyIds(world, PLAYER_COLONY_ID);
    const m = buildEpisodeMetrics(world, {
      scenarioId: 'default',
      playerColonyId: PLAYER_COLONY_ID,
      enemyColonyIds: enemyIds,
      outcome: GameOutcome.None,
      cappedAtMaxTicks: true,
      inputLogCommandCount: 0,
    });
    expect(m.finalTick).toBe(0);
    expect(m.victory).toBe(0);
    expect(m.defeat).toBe(0);
    expect(m.playerQueenAlive).toBe(1);
    expect(m.enemyQueenAlive).toBe(1);
    expect(enemyIds).toContain(ENEMY_COLONY_ID);
    expect(m.scenarioExtras).toEqual({});
  });

  it('adds scenarioExtras for invasion_probe', () => {
    const world = createTrainingWorldInvasionProbe(1);
    const enemyIds = deriveAIColonyIds(world, PLAYER_COLONY_ID);
    const m = buildEpisodeMetrics(world, {
      scenarioId: 'invasion_probe',
      playerColonyId: PLAYER_COLONY_ID,
      enemyColonyIds: enemyIds,
      outcome: GameOutcome.None,
      cappedAtMaxTicks: false,
      inputLogCommandCount: 0,
    });
    expect(m.scenarioExtras.playerSurfaceWorkerCount).toBeGreaterThanOrEqual(1);
  });
});
