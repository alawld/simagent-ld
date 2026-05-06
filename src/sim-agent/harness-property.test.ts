// Phase G — deterministic smoke / property tests (fuzz-lite): many seeds and scenarios, no throws.
import { describe, it, expect } from 'vitest';
import { GameOutcome } from '../sim/game-over.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import { TRAINING_SCENARIO_IDS } from '../sim/training-scenarios.js';
import { SimAgentHarness } from './harness.js';
import { SIM_AGENT_EPISODE_SCHEMA } from './types.js';

const VALID_OUTCOMES = new Set<GameOutcome>([
  GameOutcome.None,
  GameOutcome.Victory,
  GameOutcome.Defeat,
  GameOutcome.MutualDestruction,
]);

describe('SimAgentHarness property smoke (Phase G)', () => {
  it.each(Array.from({ length: 16 }, (_, i) => i))(
    'noop runEpisode seed %# completes 64 ticks',
    (seed) => {
      const h = new SimAgentHarness({ seed, opponentMode: 'none', recordInputLog: false });
      const ep = h.runEpisode({ maxTicks: 64 });
      expect(ep.schema).toBe(SIM_AGENT_EPISODE_SCHEMA);
      expect(VALID_OUTCOMES.has(ep.outcome)).toBe(true);
      expect(ep.metrics.finalTick).toBe(64);
      expect(h.getWorld().tick).toBe(64);
    },
  );

  const scenarioSeedCases = TRAINING_SCENARIO_IDS.flatMap((scenarioId) =>
    [1, 9, 42].map((seed) => ({ scenarioId, seed })),
  );

  it.each(scenarioSeedCases)(
    'noop short run scenario $scenarioId seed $seed',
    ({ scenarioId, seed }) => {
      const h = new SimAgentHarness({
        seed,
        scenarioId,
        opponentMode: 'none',
        recordInputLog: false,
      });
      const ep = h.runEpisode({ maxTicks: 32 });
      expect(VALID_OUTCOMES.has(ep.outcome)).toBe(true);
      expect(ep.metrics.finalTick).toBe(h.getWorld().tick);
      if (!ep.terminalReached) {
        expect(ep.metrics.finalTick).toBe(32);
      } else {
        expect(ep.metrics.finalTick).toBeLessThanOrEqual(32);
      }
    },
  );

  it('alternating NoOp and SetBehaviorRatio for many ticks', () => {
    const h = new SimAgentHarness({ seed: 2026, opponentMode: 'none', recordInputLog: false });
    for (let t = 0; t < 150; t++) {
      const forage = (t % 10) + 1;
      const fight = (t % 10) + 1;
      const cmds =
        t % 3 === 0
          ? [{ type: 'SetBehaviorRatio' as const, colonyId: PLAYER_COLONY_ID as ColonyId, ratio: { forage, fight } }]
          : [{ type: 'NoOp' as const }];
      h.step({ commands: cmds });
      expect(h.isTerminal()).toBe(false);
    }
    expect(h.getWorld().tick).toBe(150);
  });

  it('opponent ai + NoOp does not throw across ticks', () => {
    const h = new SimAgentHarness({ seed: 88, opponentMode: 'ai', recordInputLog: false });
    for (let i = 0; i < 80; i++) {
      h.step({ commands: [{ type: 'NoOp' }] });
    }
    expect(h.getWorld().tick).toBe(80);
    expect(h.isTerminal()).toBe(false);
  });
});
