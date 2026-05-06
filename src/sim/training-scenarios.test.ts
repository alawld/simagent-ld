import { describe, it, expect } from 'vitest';
import { Zone } from './terrain.js';
import { ENEMY_COLONY_ID, ENEMY_START_X, ENEMY_START_Y, PLAYER_COLONY_ID } from './constants.js';
import {
  createTrainingWorld,
  createTrainingWorldCombatStance,
  createTrainingWorldEconomyStress,
  createTrainingWorldInvasionProbe,
  isTrainingScenarioId,
  TRAINING_SCENARIO_IDS,
} from './training-scenarios.js';

describe('training-scenarios', () => {
  it('lists known scenario ids', () => {
    expect(TRAINING_SCENARIO_IDS.length).toBeGreaterThanOrEqual(4);
    expect(isTrainingScenarioId('default')).toBe(true);
    expect(isTrainingScenarioId('unknown')).toBe(false);
  });

  it('createTrainingWorld unknown id falls back to createScenario shape', () => {
    const w = createTrainingWorld('custom-ld-label', 7);
    expect(w.colonies[PLAYER_COLONY_ID]).toBeDefined();
    expect(w.colonies[PLAYER_COLONY_ID]!.workerCount).toBe(3);
  });

  it('invasion_probe adds one surface worker at enemy entrance', () => {
    const w = createTrainingWorldInvasionProbe(42);
    expect(w.colonies[PLAYER_COLONY_ID]!.workerCount).toBe(4);
    const workers = w.colonies[PLAYER_COLONY_ID]!.workers;
    let surfaceOnEnemyEnt = 0;
    for (const id of workers) {
      if (w.ants.alive[id] !== 1) continue;
      if (w.ants.zone[id] !== Zone.Surface) continue;
      const tx = w.ants.posX[id]! >> 8;
      const ty = w.ants.posY[id]! >> 8;
      if (tx === ENEMY_START_X && ty === ENEMY_START_Y) surfaceOnEnemyEnt += 1;
    }
    expect(surfaceOnEnemyEnt).toBe(1);
  });

  it('economy_stress lowers player entrance food pool', () => {
    const w = createTrainingWorldEconomyStress(1);
    expect(w.colonies[PLAYER_COLONY_ID]!.foodStored).toBe(200);
  });

  it('combat_stance sets aggressive fight ratios', () => {
    const w = createTrainingWorldCombatStance(2);
    expect(w.colonies[PLAYER_COLONY_ID]!.targetRatio.fight).toBe(8);
    expect(w.colonies[PLAYER_COLONY_ID]!.targetRatio.forage).toBe(2);
    expect(w.colonies[ENEMY_COLONY_ID]!.targetRatio.fight).toBe(7);
  });

  it('createTrainingWorld dispatches by id', () => {
    expect(createTrainingWorld('invasion_probe', 0).colonies[PLAYER_COLONY_ID]!.workerCount).toBe(4);
    expect(createTrainingWorld('default', 0).colonies[PLAYER_COLONY_ID]!.workerCount).toBe(3);
  });
});
