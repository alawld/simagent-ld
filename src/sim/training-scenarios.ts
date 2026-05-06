// Named training / curriculum worlds (SimAgentPlan Phase D) — deterministic, same rules as createScenario.
// All builders start from createScenario(seed) and apply small, documented mutations.

import type { WorldState } from './types.js';
import { allocateEntityId } from './types.js';
import { createScenario } from './scenario.js';
import { initAnt } from './ant/ant-store.js';
import { AntTask } from './enums.js';
import { Zone } from './terrain.js';
import { FP_SHIFT, FP_ONE } from './fixed.js';
import {
  PLAYER_COLONY_ID,
  ENEMY_COLONY_ID,
  ENEMY_START_X,
  ENEMY_START_Y,
  WORKER_BASE_SPEED,
} from './constants.js';

/** Registry keys accepted by `createTrainingWorld` (extend when adding factories). */
export const TRAINING_SCENARIO_IDS = [
  'default',
  'invasion_probe',
  'economy_stress',
  'combat_stance',
] as const;
export type TrainingScenarioId = (typeof TRAINING_SCENARIO_IDS)[number];

export function isTrainingScenarioId(id: string): id is TrainingScenarioId {
  return (TRAINING_SCENARIO_IDS as readonly string[]).includes(id);
}

/**
 * Vanilla two-colony match (PRD §6a).
 */
export function createTrainingWorldDefault(seed: number): WorldState {
  return createScenario(seed);
}

/**
 * Invasion-routing curriculum: one extra player worker on the enemy entrance surface tile
 * (pattern from `invasion-routing.test.ts` `buildInvasionWorld`).
 */
export function createTrainingWorldInvasionProbe(seed: number): WorldState {
  const world = createScenario(seed);
  const playerAntId = allocateEntityId(world);
  initAnt(world.ants, playerAntId, {
    colonyId: PLAYER_COLONY_ID,
    posX:     (ENEMY_START_X << FP_SHIFT) + (FP_ONE >> 1),
    posY:     (ENEMY_START_Y << FP_SHIFT) + (FP_ONE >> 1),
    task:     AntTask.Idle,
    subTask:  0,
    speed:    WORKER_BASE_SPEED,
    zone:     Zone.Surface,
  });
  const colony = world.colonies[PLAYER_COLONY_ID]!;
  colony.workers.push(playerAntId);
  colony.workerCount += 1;
  return world;
}

/** Low entrance-pool food to stress queen feeding / economy loops. */
export function createTrainingWorldEconomyStress(seed: number): WorldState {
  const world = createScenario(seed);
  const colony = world.colonies[PLAYER_COLONY_ID]!;
  colony.foodStored = 200;
  return world;
}

/** Both colonies biased toward fight allocation (macro combat prep). */
export function createTrainingWorldCombatStance(seed: number): WorldState {
  const world = createScenario(seed);
  const p = world.colonies[PLAYER_COLONY_ID]!;
  const e = world.colonies[ENEMY_COLONY_ID]!;
  p.targetRatio = { forage: 2, fight: 8 };
  e.targetRatio = { forage: 3, fight: 7 };
  return world;
}

/**
 * Dispatch named curriculum world. Unknown `scenarioId` falls back to `createScenario`
 * so custom harness labels keep working.
 */
export function createTrainingWorld(scenarioId: string, seed: number): WorldState {
  switch (scenarioId) {
    case 'default':
      return createTrainingWorldDefault(seed);
    case 'invasion_probe':
      return createTrainingWorldInvasionProbe(seed);
    case 'economy_stress':
      return createTrainingWorldEconomyStress(seed);
    case 'combat_stance':
      return createTrainingWorldCombatStance(seed);
    default:
      return createScenario(seed);
  }
}
