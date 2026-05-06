import { describe, it, expect } from 'vitest';
import { createScenario } from '../sim/scenario.js';
import { createTrainingWorldInvasionProbe } from '../sim/training-scenarios.js';
import { AntTask } from '../sim/enums.js';
import { Zone } from '../sim/terrain.js';
import { PLAYER_COLONY_ID, ENEMY_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import { deriveAIColonyIds } from '../render/game-scene-logic.js';
import {
  buildObservationChannels,
  buildPlayerTaskZoneHistograms,
  SIM_AGENT_ANT_TASK_KINDS,
} from './observation-channels.js';

describe('observation-channels (B2/B3/B4)', () => {
  it('tick-0 default scenario: player ants are Idle on Surface (golden task/zone)', () => {
    const world = createScenario(0);
    const ai = deriveAIColonyIds(world, PLAYER_COLONY_ID as ColonyId);
    const { taskZone, opponent, spatial } = buildObservationChannels(world, PLAYER_COLONY_ID as ColonyId, ai);

    expect(taskZone.taskByKind).toEqual([4, 0, 0, 0, 0]);
    expect(taskZone.zoneByKind).toEqual([4, 0]);

    expect(opponent.enemyColonyCount).toBe(1);
    expect(opponent.anyEnemyQueenAlive).toBe(true);
    expect(opponent.totalEnemyWorkers).toBe(3);
    expect(opponent.totalEnemyFightingAnts).toBe(0);

    expect(spatial.surfaceFocalTileX).toBe(24);
    expect(spatial.surfaceFocalTileY).toBe(64);
    expect(spatial.surfaceTiles4x4).toHaveLength(16);
    expect(spatial.undergroundTiles4x4).toHaveLength(16);
    expect(spatial.undergroundTiles4x4).toContain(3);
  });

  it('invasion_probe adds one Idle player worker on surface', () => {
    const world = createTrainingWorldInvasionProbe(1);
    const ai = deriveAIColonyIds(world, PLAYER_COLONY_ID as ColonyId);
    const hz = buildPlayerTaskZoneHistograms(world, PLAYER_COLONY_ID as ColonyId);
    expect(hz.taskByKind[AntTask.Idle]).toBe(5);
    expect(hz.zoneByKind[Zone.Surface]).toBe(5);
    expect(ai).toEqual([ENEMY_COLONY_ID as ColonyId]);
  });

  it('task histogram sums to alive player-colony ants', () => {
    const world = createScenario(42);
    const hz = buildPlayerTaskZoneHistograms(world, PLAYER_COLONY_ID as ColonyId);
    let sumT = 0;
    for (let i = 0; i < SIM_AGENT_ANT_TASK_KINDS; i++) sumT += hz.taskByKind[i]!;
    let sumZ = 0;
    sumZ += hz.zoneByKind[0]! + hz.zoneByKind[1]!;
    expect(sumT).toBe(sumZ);
    expect(sumT).toBeGreaterThan(0);
  });

  it('enemy queen dead drops anyEnemyQueenAlive', () => {
    const world = createScenario(99);
    const ai = deriveAIColonyIds(world, PLAYER_COLONY_ID as ColonyId);
    const colony = world.colonies[ENEMY_COLONY_ID]!;
    world.ants.alive[colony.queenEntityId] = 0;
    const { opponent } = buildObservationChannels(world, PLAYER_COLONY_ID as ColonyId, ai);
    expect(opponent.anyEnemyQueenAlive).toBe(false);
  });
});
