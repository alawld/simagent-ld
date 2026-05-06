import { describe, it, expect } from 'vitest';
import { serializeWorldState } from '../platform/save.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import type { SimCommand } from '../sim/commands.js';
import {
  SimAgentHarness,
  buildSessionRecording,
} from './harness.js';
import { replaySessionRecording, buildTicksCommandLists } from './replay-input-log.js';
import {
  SIM_AGENT_SESSION_SCHEMA,
  parseSessionRecordingJson,
  serializeSessionRecordingJson,
  isSimAgentSessionRecording,
} from './session-recording.js';
import type { AgentSimCommand } from './types.js';

describe('session recording + replay (imitation pipeline)', () => {
  it('buildSessionRecording round-trips world state (opponent none)', () => {
    const seed = 7;
    const h = new SimAgentHarness({ seed, opponentMode: 'none', scenarioId: 'default', recordInputLog: true });
    for (let i = 0; i < 30; i++) {
      const commands: AgentSimCommand[] =
        i % 7 === 0
          ? [{ type: 'SetBehaviorRatio', colonyId: PLAYER_COLONY_ID as ColonyId, ratio: { forage: 6, fight: 4 } }]
          : [{ type: 'NoOp' }];
      h.step({ commands });
    }
    const ref = serializeWorldState(h.getWorld());
    const rec = buildSessionRecording(h);
    expect(rec.schema).toBe(SIM_AGENT_SESSION_SCHEMA);
    expect(rec.finalTick).toBe(30);
    expect(rec.seed).toBe(seed);
    expect(rec.scenarioId).toBe('default');
    expect(rec.opponentMode).toBe('none');

    const replayed = replaySessionRecording(rec);
    expect(serializeWorldState(replayed)).toEqual(ref);
  });

  it('JSON parse + serialize preserves replay parity', () => {
    const h = new SimAgentHarness({ seed: 11, opponentMode: 'none', scenarioId: 'default', recordInputLog: true });
    h.step({ repeatTicks: 12 });
    const rec = buildSessionRecording(h);
    const text = serializeSessionRecordingJson(rec);
    const parsed = parseSessionRecordingJson(text);
    expect(isSimAgentSessionRecording(parsed)).toBe(true);
    expect(serializeWorldState(replaySessionRecording(parsed))).toEqual(serializeWorldState(h.getWorld()));
  });

  it('replay matches harness with opponent ai (log includes AI commands)', () => {
    const h = new SimAgentHarness({ seed: 123, opponentMode: 'ai', scenarioId: 'default', recordInputLog: true });
    for (let i = 0; i < 40; i++) {
      h.step({ commands: [{ type: 'NoOp' }] });
    }
    const ref = serializeWorldState(h.getWorld());
    const replayed = replaySessionRecording(buildSessionRecording(h));
    expect(serializeWorldState(replayed)).toEqual(ref);
  });

  it('buildTicksCommandLists preserves order within a tick', () => {
    const cmds: SimCommand[] = [
      { type: 'NoOp', issuedAtTick: 0 },
      { type: 'NoOp', issuedAtTick: 1 },
      { type: 'SetBehaviorRatio', colonyId: 1 as ColonyId, ratio: { forage: 1, fight: 1 }, issuedAtTick: 2 },
      { type: 'NoOp', issuedAtTick: 2 },
    ];
    const lists = buildTicksCommandLists(cmds, 3);
    expect(lists[0]).toHaveLength(1);
    expect(lists[1]).toHaveLength(1);
    expect(lists[2]).toHaveLength(2);
    expect(lists[2]![0]!.type).toBe('SetBehaviorRatio');
    expect(lists[2]![1]!.type).toBe('NoOp');
  });

  it('parseSessionRecordingJson throws on garbage', () => {
    expect(() => parseSessionRecordingJson('not json')).toThrow();
    expect(() => parseSessionRecordingJson('{}')).toThrow();
  });
});
