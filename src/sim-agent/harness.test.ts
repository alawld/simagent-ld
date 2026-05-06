import { describe, it, expect } from 'vitest';
import { createScenario } from '../sim/scenario.js';
import { tick } from '../sim/tick.js';
import { GameOutcome } from '../sim/game-over.js';
import { serializeWorldState } from '../platform/save.js';
import { ENEMY_COLONY_ID, PLAYER_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import type { SimCommand } from '../sim/commands.js';
import { MAX_COMMANDS_PER_TICK } from '../sim/commands.js';
import { SimAgentHarness } from './harness.js';
import {
  SIM_AGENT_EPISODE_SCHEMA,
  SIM_AGENT_METRICS_VERSION,
  SIM_AGENT_OBSERVATION_VERSION,
  type AgentSimCommand,
} from './types.js';

describe('SimAgentHarness (Phase A headless session)', () => {
  it('advances tick via step with empty commands', () => {
    const h = new SimAgentHarness({ seed: 99, opponentMode: 'none', recordInputLog: false });
    const r = h.step({ commands: [{ type: 'NoOp' }] });
    expect(r.tick).toBe(1);
    expect(r.outcome).toBe(GameOutcome.None);
    expect(r.terminal).toBe(false);
    expect(r.observation.tick).toBe(1);
    expect(r.observation.observationVersion).toBe(SIM_AGENT_OBSERVATION_VERSION);
    expect(r.observation.scenarioId).toBe('default');
    expect(r.observation.affordances).toMatchObject({
      playerMarkedDigTileCount: expect.any(Number),
      foodPileCount: expect.any(Number),
      playerEntranceCount: expect.any(Number),
    });
    expect(r.observation.taskZone.taskByKind.length).toBe(5);
    expect(r.observation.spatial.surfaceTiles4x4).toHaveLength(16);
    expect(r.observation.opponent.enemyColonyCount).toBeGreaterThanOrEqual(0);
  });

  it('peekApplicability mirrors silent-drop for invalid dig tile', () => {
    const h = new SimAgentHarness({ seed: 11, opponentMode: 'none', recordInputLog: false });
    const p = h.peekApplicability({
      type: 'MarkDigTile',
      colonyId: PLAYER_COLONY_ID as ColonyId,
      tileX: -5,
      tileY: 1,
    });
    expect(p).toEqual({ applicable: false, code: 'dig_out_of_bounds' });
  });

  it('stamps issuedAtTick to world.tick before each tick', () => {
    const h = new SimAgentHarness({ seed: 1, opponentMode: 'none', recordInputLog: true });
    h.step({ commands: [{ type: 'NoOp' }] });
    h.step({ commands: [{ type: 'NoOp' }] });
    const log = h.getInputLog();
    expect(log.length).toBe(2);
    expect(log[0]!.issuedAtTick).toBe(0);
    expect(log[1]!.issuedAtTick).toBe(1);
  });

  it('repeatTicks runs multiple waits; only first tick gets commands', () => {
    const h = new SimAgentHarness({ seed: 2, opponentMode: 'none', recordInputLog: false });
    const r = h.step({ commands: [{ type: 'NoOp' }], repeatTicks: 5 });
    expect(r.tick).toBe(5);
    expect(r.observation.tick).toBe(5);
  });

  it('reset replaces world deterministically', () => {
    const h = new SimAgentHarness({ seed: 42, opponentMode: 'none', recordInputLog: false });
    h.step({ repeatTicks: 10 });
    const mid = serializeWorldState(h.getWorld());
    h.reset(42);
    expect(h.getWorld().tick).toBe(0);
    h.step({ repeatTicks: 10 });
    expect(serializeWorldState(h.getWorld())).toEqual(mid);
  });

  it('throws when a tick would exceed MAX_COMMANDS_PER_TICK', () => {
    const h = new SimAgentHarness({ seed: 3, opponentMode: 'none', recordInputLog: false });
    const commands = Array.from({ length: MAX_COMMANDS_PER_TICK + 1 }, () => ({ type: 'NoOp' as const }));
    expect(() => h.step({ commands })).toThrow(/MAX_COMMANDS_PER_TICK/);
  });

  it('inputLog + replay matches direct harness stepping (opponent none)', () => {
    const seed = 7;
    const h = new SimAgentHarness({ seed, opponentMode: 'none', scenarioId: 'default', recordInputLog: true });
    for (let i = 0; i < 30; i++) {
      const commands: AgentSimCommand[] =
        i % 7 === 0
          ? [{ type: 'SetBehaviorRatio', colonyId: PLAYER_COLONY_ID as ColonyId, ratio: { forage: 6, fight: 4 } }]
          : [{ type: 'NoOp' }];
      h.step({ commands });
    }
    const refJson = serializeWorldState(h.getWorld());
    const log = [...h.getInputLog()];

    const replay = createScenario(seed);
    const byTick: SimCommand[][] = [];
    for (const cmd of log) {
      const t = cmd.issuedAtTick;
      (byTick[t] ??= []).push(cmd);
    }
    for (let t = 0; t < h.getWorld().tick; t++) {
      tick(replay, byTick[t] ?? []);
    }
    expect(serializeWorldState(replay)).toEqual(refJson);
  });

  it('opponent AI changes world vs none after many ticks', () => {
    const steps = 80;
    const none = new SimAgentHarness({ seed: 123, opponentMode: 'none', recordInputLog: false });
    for (let i = 0; i < steps; i++) none.step({ commands: [{ type: 'NoOp' }] });
    const ai = new SimAgentHarness({ seed: 123, opponentMode: 'ai', recordInputLog: false });
    for (let i = 0; i < steps; i++) ai.step({ commands: [{ type: 'NoOp' }] });
    expect(serializeWorldState(none.getWorld())).not.toEqual(serializeWorldState(ai.getWorld()));
  });

  it('getSeed matches constructor seed', () => {
    const h = new SimAgentHarness({ seed: 424242, opponentMode: 'none', recordInputLog: false });
    expect(h.getSeed()).toBe(424242);
    h.reset(100);
    expect(h.getSeed()).toBe(100);
  });

  it('runEpisode returns schema, metrics, and advances ticks (no-op policy)', () => {
    const h = new SimAgentHarness({ seed: 11, opponentMode: 'none', scenarioId: 'eval-smoke', recordInputLog: true });
    const ep = h.runEpisode({ maxTicks: 25 });
    expect(ep.schema).toBe(SIM_AGENT_EPISODE_SCHEMA);
    expect(ep.metricsVersion).toBe(SIM_AGENT_METRICS_VERSION);
    expect(ep.metrics.scenarioExtras).toEqual({});
    expect(ep.seed).toBe(11);
    expect(ep.scenarioId).toBe('eval-smoke');
    expect(ep.metrics.finalTick).toBe(25);
    expect(ep.metrics.cappedAtMaxTicks).toBe(true);
    expect(ep.terminalReached).toBe(false);
    expect(ep.metrics.inputLogCommandCount).toBe(25);
    expect(ep.wallClockMs).toBeGreaterThanOrEqual(0);
  });

  it('runEpisode passes launchDarkly context when provided', () => {
    const h = new SimAgentHarness({ seed: 12, opponentMode: 'none', recordInputLog: false });
    const ep = h.runEpisode({
      maxTicks: 1,
      launchDarkly: { experimentKey: 'exp', variationKey: 'var-a', iterationId: 'i1' },
    });
    expect(ep.launchDarkly).toEqual({ experimentKey: 'exp', variationKey: 'var-a', iterationId: 'i1' });
  });

  it('runEpisode getCommands receives monotonic tickIndex', () => {
    const h = new SimAgentHarness({ seed: 13, opponentMode: 'none', recordInputLog: false });
    const seen: number[] = [];
    h.runEpisode({
      maxTicks: 4,
      getCommands: (ctx) => {
        seen.push(ctx.tickIndex);
        return [{ type: 'NoOp' }];
      },
    });
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('runEpisode can chain without seed while session is not terminal', () => {
    const h = new SimAgentHarness({ seed: 14, opponentMode: 'none', recordInputLog: false });
    const a = h.runEpisode({ maxTicks: 3 });
    expect(a.metrics.finalTick).toBe(3);
    const b = h.runEpisode({ maxTicks: 2 });
    expect(b.metrics.finalTick).toBe(5);
  });

  it('scenario-id invasion_probe uses training world (+1 worker)', () => {
    const h = new SimAgentHarness({
      seed: 20,
      scenarioId: 'invasion_probe',
      opponentMode: 'none',
      recordInputLog: false,
    });
    expect(h.getWorld().colonies[PLAYER_COLONY_ID]!.workerCount).toBe(4);
    const ep = h.runEpisode({ maxTicks: 1 });
    expect(ep.metrics.scenarioExtras.playerSurfaceWorkerCount).toBeGreaterThanOrEqual(1);
  });

  it('runEpisode after terminal requires seed; reset via seed clears terminal', () => {
    const h = new SimAgentHarness({ seed: 15, opponentMode: 'none', recordInputLog: false });
    const w = h.getWorld();
    const enemy = w.colonies[ENEMY_COLONY_ID];
    expect(enemy).toBeDefined();
    w.ants.alive[enemy!.queenEntityId] = 0;
    const ep = h.runEpisode({ maxTicks: 1 });
    expect(ep.terminalReached).toBe(true);
    expect(ep.outcome).toBe(GameOutcome.Victory);
    expect(() => h.runEpisode({ maxTicks: 1 })).toThrow(/terminal/);
    const ep2 = h.runEpisode({ seed: 15, maxTicks: 1 });
    expect(ep2.metrics.finalTick).toBe(1);
    expect(ep2.terminalReached).toBe(false);
  });
});

