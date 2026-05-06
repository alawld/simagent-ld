import { describe, it, expect } from 'vitest';
import { serializeWorldState } from '../platform/save.js';
import { GameOutcome } from '../sim/game-over.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import { SimAgentHarness } from './harness.js';

describe('SimAgentHarness pause + loadSnapshot', () => {
  it('pause freezes tick; resume allows advance', () => {
    const h = new SimAgentHarness({ seed: 1, opponentMode: 'none', recordInputLog: false });
    h.pause();
    const t0 = h.getWorld().tick;
    const r1 = h.step({ commands: [{ type: 'NoOp' }] });
    expect(h.getWorld().tick).toBe(t0);
    expect(r1.tick).toBe(t0);
    h.resume();
    h.step({ commands: [{ type: 'NoOp' }] });
    expect(h.getWorld().tick).toBe(t0 + 1);
  });

  it('runEpisode throws while paused', () => {
    const h = new SimAgentHarness({ seed: 2, opponentMode: 'none', recordInputLog: false });
    h.pause();
    expect(() => h.runEpisode({ maxTicks: 3 })).toThrow(/paused/);
  });

  it('loadSnapshot round-trips serializeWorldState', () => {
    const h = new SimAgentHarness({ seed: 99, opponentMode: 'none', recordInputLog: false });
    h.step({ repeatTicks: 5 });
    const snap = serializeWorldState(h.getWorld());
    const h2 = new SimAgentHarness({ seed: 0, opponentMode: 'none', recordInputLog: false });
    h2.loadSnapshot(snap);
    expect(serializeWorldState(h2.getWorld())).toEqual(snap);
    expect(h2.getWorld().tick).toBe(h.getWorld().tick);
  });

  it('terminal flag follows snapshot queen outcome', () => {
    const h = new SimAgentHarness({ seed: 3, opponentMode: 'none', recordInputLog: false });
    const colony = h.getWorld().colonies[PLAYER_COLONY_ID as ColonyId]!;
    h.getWorld().ants.alive[colony.queenEntityId] = 0;
    const snap = serializeWorldState(h.getWorld());
    const h2 = new SimAgentHarness({ seed: 1, opponentMode: 'none', recordInputLog: false });
    expect(h2.isTerminal()).toBe(false);
    h2.loadSnapshot(snap);
    expect(h2.isTerminal()).toBe(true);
    const r = h2.step({ commands: [{ type: 'NoOp' }] });
    expect(r.terminal).toBe(true);
    expect(r.outcome).toBe(GameOutcome.None);
  });
});
