import { describe, it, expect } from 'vitest';
import { GameOutcome } from '../sim/game-over.js';
import { SIM_AGENT_EPISODE_SCHEMA, SIM_AGENT_METRICS_VERSION, type SimAgentEpisodeMetrics, type SimAgentEpisodeResult } from './types.js';
import { evaluateScenarioPass } from './scenario-thresholds.js';

function baseEpisode(over: Partial<SimAgentEpisodeResult> = {}): SimAgentEpisodeResult {
  const { metrics: overMetrics, ...rest } = over;
  const defaultMetrics: SimAgentEpisodeMetrics = {
    outcome: GameOutcome.None,
    victory: 0,
    defeat: 0,
    mutualDestruction: 0,
    finalTick: 100,
    cappedAtMaxTicks: true,
    playerFoodTotal: 500,
    playerWorkerCount: 3,
    playerChamberCount: 0,
    playerEggCount: 0,
    playerLarvaeCount: 0,
    playerQueenAlive: 1,
    enemyQueenAlive: 1,
    playerMarkedDigTileCount: 0,
    inputLogCommandCount: 100,
    scenarioExtras: {},
  };
  const metrics: SimAgentEpisodeMetrics =
    overMetrics !== undefined
      ? {
          ...defaultMetrics,
          ...overMetrics,
          scenarioExtras: { ...defaultMetrics.scenarioExtras, ...overMetrics.scenarioExtras },
        }
      : defaultMetrics;
  const base: SimAgentEpisodeResult = {
    schema: SIM_AGENT_EPISODE_SCHEMA,
    metricsVersion: SIM_AGENT_METRICS_VERSION,
    metrics,
    wallClockMs: 10,
    seed: 1,
    scenarioId: 'default',
    opponentMode: 'none',
    playerColonyId: 1,
    outcome: GameOutcome.None,
    terminalReached: false,
    cappedAtMaxTicks: true,
  };
  return { ...base, ...rest };
}

describe('evaluateScenarioPass', () => {
  it('default passes when queen alive and no defeat', () => {
    const r = evaluateScenarioPass(baseEpisode());
    expect(r.pass).toBe(true);
  });

  it('default fails on defeat', () => {
    const r = evaluateScenarioPass(
      baseEpisode({
        outcome: GameOutcome.Defeat,
        metrics: {
          ...baseEpisode().metrics,
          outcome: GameOutcome.Defeat,
          defeat: 1,
        },
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.includes('Defeat'))).toBe(true);
  });

  it('invasion_probe requires surface worker extra', () => {
    const ok = evaluateScenarioPass(
      baseEpisode({
        scenarioId: 'invasion_probe',
        metrics: {
          ...baseEpisode().metrics,
          scenarioExtras: { playerSurfaceWorkerCount: 2 },
        },
      }),
    );
    expect(ok.pass).toBe(true);

    const bad = evaluateScenarioPass(
      baseEpisode({
        scenarioId: 'invasion_probe',
        metrics: {
          ...baseEpisode().metrics,
          scenarioExtras: { playerSurfaceWorkerCount: 0 },
        },
      }),
    );
    expect(bad.pass).toBe(false);
  });

  it('economy_stress fails when food total is 0', () => {
    const r = evaluateScenarioPass(
      baseEpisode({
        scenarioId: 'economy_stress',
        metrics: {
          ...baseEpisode().metrics,
          playerFoodTotal: 0,
          scenarioExtras: {},
        },
      }),
    );
    expect(r.pass).toBe(false);
  });
});
