// scenario.test.ts — tests for createScenario (PRD §6a)
//
// Requirements covered:
//   SCEN-02 — Symmetric colony placement
//   SCEN-03 — Food pile scatter with separation constraints
//   SURF-01 — Surface grid dimensions
//   SURF-02 — Food piles are static/infinite (no quantity field)
//   UNDR-08 — Independent underground grids
//   SCEN-06 — Determinism (same seed → identical output)

import { describe, it, expect } from 'vitest';
import { createScenario } from './scenario.js';
import { isAlive } from './ant/ant-store.js';
import { AntTask, PheromoneType } from './enums.js';
import { pheromoneGridKey } from './pheromone/pheromone-store.js';
import { FP_SHIFT } from './fixed.js';
import {
  PLAYER_COLONY_ID,
  ENEMY_COLONY_ID,
  PLAYER_START_X,
  PLAYER_START_Y,
  ENEMY_START_X,
  ENEMY_START_Y,
  STARTING_FOOD,
  STARTING_WORKERS,
  FOOD_PILE_COUNT,
  FOOD_PILE_MIN_COLONY_DISTANCE,
  FOOD_PILE_MIN_SEPARATION,
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
} from './constants.js';

describe('createScenario', () => {

  // -------------------------------------------------------------------------
  // SCEN-02 — Symmetric colony placement
  // -------------------------------------------------------------------------

  describe('SCEN-02: colony placement', () => {
    it('creates both player and enemy colonies', () => {
      const world = createScenario(42);
      expect(world.colonies[PLAYER_COLONY_ID]).toBeDefined();
      expect(world.colonies[ENEMY_COLONY_ID]).toBeDefined();
    });

    it('player queen is at PLAYER_START_X/Y in fixed-point, task=Idle', () => {
      const world = createScenario(42);
      const colony = world.colonies[PLAYER_COLONY_ID]!;
      const qId = colony.queenEntityId;
      expect(world.ants.posX[qId]).toBe(PLAYER_START_X << FP_SHIFT);
      expect(world.ants.posY[qId]).toBe(PLAYER_START_Y << FP_SHIFT);
      expect(world.ants.task[qId]).toBe(AntTask.Idle);
    });

    it('enemy queen is at ENEMY_START_X/Y in fixed-point, task=Idle', () => {
      const world = createScenario(42);
      const colony = world.colonies[ENEMY_COLONY_ID]!;
      const qId = colony.queenEntityId;
      expect(world.ants.posX[qId]).toBe(ENEMY_START_X << FP_SHIFT);
      expect(world.ants.posY[qId]).toBe(ENEMY_START_Y << FP_SHIFT);
      expect(world.ants.task[qId]).toBe(AntTask.Idle);
    });

    it('all player workers start at same tile as player queen', () => {
      const world = createScenario(42);
      const colony = world.colonies[PLAYER_COLONY_ID]!;
      const expectedX = PLAYER_START_X << FP_SHIFT;
      const expectedY = PLAYER_START_Y << FP_SHIFT;
      for (const wId of colony.workers) {
        expect(world.ants.posX[wId]).toBe(expectedX);
        expect(world.ants.posY[wId]).toBe(expectedY);
        expect(world.ants.task[wId]).toBe(AntTask.Idle);
      }
    });

    it('all enemy workers start at same tile as enemy queen', () => {
      const world = createScenario(42);
      const colony = world.colonies[ENEMY_COLONY_ID]!;
      const expectedX = ENEMY_START_X << FP_SHIFT;
      const expectedY = ENEMY_START_Y << FP_SHIFT;
      for (const wId of colony.workers) {
        expect(world.ants.posX[wId]).toBe(expectedX);
        expect(world.ants.posY[wId]).toBe(expectedY);
        expect(world.ants.task[wId]).toBe(AntTask.Idle);
      }
    });

    it('each colony has workerCount === STARTING_WORKERS (3)', () => {
      const world = createScenario(42);
      expect(world.colonies[PLAYER_COLONY_ID]!.workerCount).toBe(STARTING_WORKERS);
      expect(world.colonies[ENEMY_COLONY_ID]!.workerCount).toBe(STARTING_WORKERS);
    });

    it('each colony workers array has exactly STARTING_WORKERS entries', () => {
      const world = createScenario(42);
      expect(world.colonies[PLAYER_COLONY_ID]!.workers.length).toBe(STARTING_WORKERS);
      expect(world.colonies[ENEMY_COLONY_ID]!.workers.length).toBe(STARTING_WORKERS);
    });

    it('each colony queen is alive', () => {
      const world = createScenario(42);
      const playerQueenId = world.colonies[PLAYER_COLONY_ID]!.queenEntityId;
      const enemyQueenId  = world.colonies[ENEMY_COLONY_ID]!.queenEntityId;
      expect(isAlive(world.ants, playerQueenId)).toBe(true);
      expect(isAlive(world.ants, enemyQueenId)).toBe(true);
    });

    it('each colony has foodStored === STARTING_FOOD', () => {
      const world = createScenario(42);
      expect(world.colonies[PLAYER_COLONY_ID]!.foodStored).toBe(STARTING_FOOD);
      expect(world.colonies[ENEMY_COLONY_ID]!.foodStored).toBe(STARTING_FOOD);
    });
  });

  // -------------------------------------------------------------------------
  // SCEN-03 — Food pile scatter
  // -------------------------------------------------------------------------

  describe('SCEN-03: food pile scatter', () => {
    it('places FOOD_PILE_COUNT food piles (or fewer if rejection exhausted)', () => {
      const world = createScenario(42);
      // With 1000 attempts and 15 piles on 128×128 grid, seed 42 should reach 15
      expect(world.foodPiles.length).toBeLessThanOrEqual(FOOD_PILE_COUNT);
      expect(world.foodPiles.length).toBeGreaterThan(0);
    });

    it('places exactly FOOD_PILE_COUNT piles for seed 42', () => {
      const world = createScenario(42);
      expect(world.foodPiles.length).toBe(FOOD_PILE_COUNT);
    });

    it('no two food piles are within FOOD_PILE_MIN_SEPARATION of each other', () => {
      const world = createScenario(42);
      const piles = world.foodPiles;
      for (let i = 0; i < piles.length; i++) {
        for (let j = i + 1; j < piles.length; j++) {
          const dist =
            Math.abs(piles[i]!.tileX - piles[j]!.tileX) +
            Math.abs(piles[i]!.tileY - piles[j]!.tileY);
          expect(dist).toBeGreaterThanOrEqual(FOOD_PILE_MIN_SEPARATION);
        }
      }
    });

    it('no food pile is within FOOD_PILE_MIN_COLONY_DISTANCE of player start', () => {
      const world = createScenario(42);
      for (const pile of world.foodPiles) {
        const dist =
          Math.abs(pile.tileX - PLAYER_START_X) +
          Math.abs(pile.tileY - PLAYER_START_Y);
        expect(dist).toBeGreaterThanOrEqual(FOOD_PILE_MIN_COLONY_DISTANCE);
      }
    });

    it('no food pile is within FOOD_PILE_MIN_COLONY_DISTANCE of enemy start', () => {
      const world = createScenario(42);
      for (const pile of world.foodPiles) {
        const dist =
          Math.abs(pile.tileX - ENEMY_START_X) +
          Math.abs(pile.tileY - ENEMY_START_Y);
        expect(dist).toBeGreaterThanOrEqual(FOOD_PILE_MIN_COLONY_DISTANCE);
      }
    });

    it('all food piles have isMarkedPriority === false', () => {
      const world = createScenario(42);
      for (const pile of world.foodPiles) {
        expect(pile.isMarkedPriority).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // SURF-01 — Surface grid dimensions
  // -------------------------------------------------------------------------

  describe('SURF-01: surface grid', () => {
    it('surface grid has correct width', () => {
      const world = createScenario(42);
      expect(world.surface.width).toBe(128);
    });

    it('surface grid has correct height', () => {
      const world = createScenario(42);
      expect(world.surface.height).toBe(128);
    });

    it('surface grid data length === 128 × 128 = 16384', () => {
      const world = createScenario(42);
      expect(world.surface.data.length).toBe(SURFACE_GRID_WIDTH * SURFACE_GRID_HEIGHT);
    });

    it('surface grid has some dirt tiles (dirt scatter not all grass)', () => {
      const world = createScenario(42);
      let dirtCount = 0;
      for (let i = 0; i < world.surface.data.length; i++) {
        if (world.surface.data[i] === 1) dirtCount++; // SurfaceTileState.Dirt = 1
      }
      // ~15% dirt expected (~2450); allow very wide tolerance for PRNG variance
      expect(dirtCount).toBeGreaterThan(1000);
      expect(dirtCount).toBeLessThan(5000);
    });
  });

  // -------------------------------------------------------------------------
  // SURF-02 — Food piles are static/infinite (no quantity field)
  // -------------------------------------------------------------------------

  describe('SURF-02: food piles are static/infinite', () => {
    it('FoodPile has no quantity field — existence means infinite food', () => {
      const world = createScenario(42);
      expect(world.foodPiles.length).toBeGreaterThan(0);
      const pile = world.foodPiles[0]!;
      // Should have exactly the four canonical fields; no quantity
      expect(Object.prototype.hasOwnProperty.call(pile, 'foodPileId')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(pile, 'tileX')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(pile, 'tileY')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(pile, 'isMarkedPriority')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(pile, 'quantity')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // UNDR-08 — Independent underground grids
  // -------------------------------------------------------------------------

  describe('UNDR-08: independent underground grids', () => {
    it('player underground grid data length === 128 × 64 = 8192', () => {
      const world = createScenario(42);
      expect(world.undergroundGrids[PLAYER_COLONY_ID]!.data.length).toBe(
        UNDERGROUND_GRID_WIDTH * UNDERGROUND_GRID_HEIGHT,
      );
    });

    it('enemy underground grid data length === 128 × 64 = 8192', () => {
      const world = createScenario(42);
      expect(world.undergroundGrids[ENEMY_COLONY_ID]!.data.length).toBe(
        UNDERGROUND_GRID_WIDTH * UNDERGROUND_GRID_HEIGHT,
      );
    });

    it('player underground grid starts all-Solid (all zeros)', () => {
      const world = createScenario(42);
      const data = world.undergroundGrids[PLAYER_COLONY_ID]!.data;
      let allSolid = true;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) { allSolid = false; break; }
      }
      expect(allSolid).toBe(true);
    });

    it('enemy underground grid starts all-Solid (all zeros)', () => {
      const world = createScenario(42);
      const data = world.undergroundGrids[ENEMY_COLONY_ID]!.data;
      let allSolid = true;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) { allSolid = false; break; }
      }
      expect(allSolid).toBe(true);
    });

    it('mutating player underground tile does not affect enemy underground tile', () => {
      const world = createScenario(42);
      world.undergroundGrids[PLAYER_COLONY_ID]!.data[0] = 3; // Open
      expect(world.undergroundGrids[ENEMY_COLONY_ID]!.data[0]).toBe(0); // still Solid
    });
  });

  // -------------------------------------------------------------------------
  // Phase 3 colony extensions — caller-initialized per PRD §2a
  // -------------------------------------------------------------------------

  describe('Phase 3 colony extensions', () => {
    it('player colony entrances is an empty array', () => {
      const world = createScenario(42);
      expect(world.colonies[PLAYER_COLONY_ID]!.entrances).toEqual([]);
    });

    it('enemy colony entrances is an empty array', () => {
      const world = createScenario(42);
      expect(world.colonies[ENEMY_COLONY_ID]!.entrances).toEqual([]);
    });

    it('player colony digFlowFieldDirty === false', () => {
      const world = createScenario(42);
      expect(world.colonies[PLAYER_COLONY_ID]!.digFlowFieldDirty).toBe(false);
    });

    it('enemy colony digFlowFieldDirty === false', () => {
      const world = createScenario(42);
      expect(world.colonies[ENEMY_COLONY_ID]!.digFlowFieldDirty).toBe(false);
    });

    it('player colony rallyPoint === null', () => {
      const world = createScenario(42);
      expect(world.colonies[PLAYER_COLONY_ID]!.rallyPoint).toBeNull();
    });

    it('enemy colony rallyPoint === null', () => {
      const world = createScenario(42);
      expect(world.colonies[ENEMY_COLONY_ID]!.rallyPoint).toBeNull();
    });

    it('entrances arrays of both colonies are independent references', () => {
      const world = createScenario(42);
      const player = world.colonies[PLAYER_COLONY_ID]!;
      const enemy  = world.colonies[ENEMY_COLONY_ID]!;
      // Push into player entrances; enemy must remain empty
      player.entrances.push({ entranceId: 99, tileX: 0, tileY: 0 } as any);
      expect(enemy.entrances.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Determinism (SCEN-06) — same seed produces identical result
  // -------------------------------------------------------------------------

  describe('SCEN-06: determinism', () => {
    it('two calls with seed 42 produce identical food pile coordinates', () => {
      const world1 = createScenario(42);
      const world2 = createScenario(42);
      expect(world1.foodPiles.length).toBe(world2.foodPiles.length);
      for (let i = 0; i < world1.foodPiles.length; i++) {
        expect(world1.foodPiles[i]!.tileX).toBe(world2.foodPiles[i]!.tileX);
        expect(world1.foodPiles[i]!.tileY).toBe(world2.foodPiles[i]!.tileY);
      }
    });

    it('two calls with seed 42 produce identical surface grids', () => {
      const world1 = createScenario(42);
      const world2 = createScenario(42);
      for (let i = 0; i < world1.surface.data.length; i++) {
        expect(world1.surface.data[i]).toBe(world2.surface.data[i]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Pheromone grids — all 8 must exist at scenario creation
  // -------------------------------------------------------------------------

  describe('Pheromone grids', () => {
    it('all 8 pheromone grids exist (2 colonies × 2 types × 2 zones)', () => {
      const world = createScenario(42);
      for (const cid of [PLAYER_COLONY_ID, ENEMY_COLONY_ID]) {
        for (const pType of [PheromoneType.FoodTrail, PheromoneType.DangerTrail]) {
          const surfaceKey     = pheromoneGridKey(cid, pType, 'surface');
          const undergroundKey = pheromoneGridKey(cid, pType, 'underground');
          expect(world.pheromoneGrids[surfaceKey]).toBeDefined();
          expect(world.pheromoneGrids[undergroundKey]).toBeDefined();
        }
      }
    });

    it('surface pheromone grids are 128×128', () => {
      const world = createScenario(42);
      for (const cid of [PLAYER_COLONY_ID, ENEMY_COLONY_ID]) {
        for (const pType of [PheromoneType.FoodTrail, PheromoneType.DangerTrail]) {
          const grid = world.pheromoneGrids[pheromoneGridKey(cid, pType, 'surface')]!;
          expect(grid.width).toBe(SURFACE_GRID_WIDTH);
          expect(grid.height).toBe(SURFACE_GRID_HEIGHT);
        }
      }
    });

    it('underground pheromone grids are 128×64', () => {
      const world = createScenario(42);
      for (const cid of [PLAYER_COLONY_ID, ENEMY_COLONY_ID]) {
        for (const pType of [PheromoneType.FoodTrail, PheromoneType.DangerTrail]) {
          const grid = world.pheromoneGrids[pheromoneGridKey(cid, pType, 'underground')]!;
          expect(grid.width).toBe(UNDERGROUND_GRID_WIDTH);
          expect(grid.height).toBe(UNDERGROUND_GRID_HEIGHT);
        }
      }
    });
  });

});
