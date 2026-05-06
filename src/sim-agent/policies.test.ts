import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import { createCommandsFilePolicy, createHeuristicRatioPolicy, createNoOpPolicy } from './policies.js';
import { SIM_AGENT_OBSERVATION_VERSION, type SimAgentEpisodeTickContext } from './types.js';

function ctx(partial: Partial<SimAgentEpisodeTickContext> = {}): SimAgentEpisodeTickContext {
  return {
    lastStep: null,
    tickIndex: 0,
    observation: {
      observationVersion: SIM_AGENT_OBSERVATION_VERSION,
      scenarioId: 'test',
      tick: 0,
      scalars: {
        foodTotal: 0,
        workerCount: 0,
        queenAlive: true,
        targetRatio: { forage: 10, fight: 0 },
        rallyActive: false,
        entranceCount: 1,
        defeated: false,
      },
      affordances: {
        playerMarkedDigTileCount: 0,
        foodPileCount: 0,
        playerEntranceCount: 1,
      },
      taskZone: {
        taskByKind: [0, 0, 0, 0, 0],
        zoneByKind: [0, 0],
      },
      opponent: {
        enemyColonyCount: 0,
        anyEnemyQueenAlive: false,
        totalEnemyWorkers: 0,
        totalEnemyFightingAnts: 0,
      },
      spatial: {
        surfaceFocalTileX: 0,
        surfaceFocalTileY: 0,
        surfaceTiles4x4: Array.from({ length: 16 }, () => 0),
        undergroundFocalTileX: 0,
        undergroundFocalTileY: 2,
        undergroundTiles4x4: Array.from({ length: 16 }, () => 0),
      },
    },
    ...partial,
  };
}

describe('policies', () => {
  it('createNoOpPolicy returns NoOp', () => {
    const p = createNoOpPolicy();
    expect(p(ctx())).toEqual([{ type: 'NoOp' }]);
  });

  it('createHeuristicRatioPolicy issues SetBehaviorRatio on cadence', () => {
    const p = createHeuristicRatioPolicy(PLAYER_COLONY_ID as ColonyId);
    expect(p(ctx({ tickIndex: 0 }))[0]!.type).toBe('SetBehaviorRatio');
    expect(p(ctx({ tickIndex: 1 }))[0]!.type).toBe('NoOp');
  });

  let tmpPath = '';
  beforeEach(() => {
    tmpPath = join(tmpdir(), `subterrans-cmd-${Date.now()}-${process.pid}.jsonl`);
  });
  afterEach(() => {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  });

  it('createCommandsFilePolicy reads JSON command arrays per line', () => {
    writeFileSync(
      tmpPath,
      `[{"type":"NoOp"}]\n[{"type":"SetBehaviorRatio","colonyId":${PLAYER_COLONY_ID},"ratio":{"forage":5,"fight":5}}]\n`,
      'utf8',
    );
    const p = createCommandsFilePolicy(tmpPath);
    expect(p(ctx({ tickIndex: 0 }))).toEqual([{ type: 'NoOp' }]);
    expect(p(ctx({ tickIndex: 1 }))[0]!.type).toBe('SetBehaviorRatio');
    expect(p(ctx({ tickIndex: 99 }))[0]!.type).toBe('SetBehaviorRatio');
  });
});
