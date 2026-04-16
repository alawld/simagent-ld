import { describe, it, expect, beforeEach } from 'vitest';
import {
  type EntityId,
  createWorldState,
  copyWorldState,
  allocateEntityId,
} from './types.js';
import { createColonyRecord } from './colony/colony-store.js';
import { createPheromoneGrid, phGet, phSet } from './pheromone/pheromone-store.js';
import { MAX_ENTITIES } from './constants.js';

describe('WorldState', () => {
  describe('createWorldState', () => {
    it('returns tick=0, rngState=seed, nextEntityId=0, commandQueue=[] for seed 42', () => {
      const world = createWorldState(42);
      expect(world.tick).toBe(0);
      expect(world.rngState).toBe(42);
      expect(world.nextEntityId).toBe(0);
      expect(world.commandQueue).toEqual([]);
      expect(world.commandQueue.length).toBe(0);
    });

    it('coerces negative seed to uint32 via seed >>> 0 (PRD §3)', () => {
      // -1 >>> 0 === 4294967295 (max uint32)
      const world = createWorldState(-1);
      expect(world.rngState).toBe(4294967295);
    });

    it('has exactly seven fields (4 Phase 5 + 3 Phase 6)', () => {
      const world = createWorldState(0);
      const keys = Object.keys(world);
      expect(keys).toHaveLength(7);
      expect(keys).toContain('tick');
      expect(keys).toContain('rngState');
      expect(keys).toContain('nextEntityId');
      expect(keys).toContain('commandQueue');
      expect(keys).toContain('ants');
      expect(keys).toContain('colonies');
      expect(keys).toContain('pheromoneGrids');
    });

    it('Phase 6 init: ants has 11 Int32Arrays of length MAX_ENTITIES', () => {
      const world = createWorldState(42);
      const antFields = [
        'posX', 'posY', 'colonyId', 'task', 'subTask',
        'speed', 'foodCarrying', 'starvationTimer', 'age', 'alive', 'lifespan',
      ] as const;
      expect(antFields.length).toBe(11);
      for (const field of antFields) {
        expect(world.ants[field]).toBeInstanceOf(Int32Array);
        expect(world.ants[field].length).toBe(MAX_ENTITIES);
      }
    });

    it('Phase 6 init: colonies is empty object {}', () => {
      const world = createWorldState(42);
      expect(world.colonies).toEqual({});
      expect(Object.keys(world.colonies).length).toBe(0);
    });

    it('Phase 6 init: pheromoneGrids is empty object {}', () => {
      const world = createWorldState(42);
      expect(world.pheromoneGrids).toEqual({});
      expect(Object.keys(world.pheromoneGrids).length).toBe(0);
    });

    it('custom maxEntities: createWorldState(42, 256) yields ants.posX.length === 256', () => {
      const world = createWorldState(42, 256);
      expect(world.ants.posX.length).toBe(256);
      expect(world.ants.lifespan.length).toBe(256);
    });
  });

  describe('copyWorldState', () => {
    it('copies all Phase 5 scalar fields from src into dst', () => {
      const src = createWorldState(99);
      const dst = createWorldState(0);
      src.tick = 5;
      src.rngState = 12345;
      src.nextEntityId = 7;
      copyWorldState(src, dst);
      expect(dst.tick).toBe(5);
      expect(dst.rngState).toBe(12345);
      expect(dst.nextEntityId).toBe(7);
    });

    it('dst scalar changes do not affect src (no shared state)', () => {
      const src = createWorldState(1);
      const dst = createWorldState(2);
      src.tick = 10;
      copyWorldState(src, dst);
      dst.tick = 99;
      expect(src.tick).toBe(10);
    });

    it('commandQueue is independent after copy — push to src does not affect dst', () => {
      const src = createWorldState(1);
      const dst = createWorldState(2);
      copyWorldState(src, dst);
      // Push to src.commandQueue AFTER the copy
      src.commandQueue.push({ type: 'NoOp', issuedAtTick: 0 });
      expect(dst.commandQueue.length).toBe(0);
    });

    describe('AntComponents', () => {
      let src: ReturnType<typeof createWorldState>;
      let dst: ReturnType<typeof createWorldState>;

      beforeEach(() => {
        src = createWorldState(1, 64);
        dst = createWorldState(2, 64);
      });

      it('ant field round trip: posX and alive values are copied correctly', () => {
        src.ants.posX[0] = 100;
        src.ants.alive[0] = 1;
        copyWorldState(src, dst);
        expect(dst.ants.posX[0]).toBe(100);
        expect(dst.ants.alive[0]).toBe(1);
      });

      it('ant array independence: mutating src after copy does not affect dst', () => {
        src.ants.posX[0] = 100;
        copyWorldState(src, dst);
        expect(dst.ants.posX[0]).toBe(100);
        // Mutate src AFTER copy — dst must remain unchanged
        src.ants.posX[0] = 999;
        expect(dst.ants.posX[0]).toBe(100);
      });
    });

    describe('colonies', () => {
      let src: ReturnType<typeof createWorldState>;
      let dst: ReturnType<typeof createWorldState>;

      beforeEach(() => {
        src = createWorldState(1, 64);
        dst = createWorldState(2, 64);
      });

      it('colony creation: dst gains colony with correct scalar fields after copy', () => {
        src.colonies[1] = createColonyRecord(1, 42);
        src.colonies[1]!.foodStored = 500;
        copyWorldState(src, dst);
        expect(dst.colonies[1]).toBeDefined();
        expect(dst.colonies[1]!.foodStored).toBe(500);
        expect(dst.colonies[1]!.queenEntityId).toBe(42);
      });

      it('colony deletion propagation: colony removed from src is removed from dst on next copy', () => {
        src.colonies[2] = createColonyRecord(2, 50);
        copyWorldState(src, dst);
        expect(dst.colonies[2]).toBeDefined();
        delete src.colonies[2];
        copyWorldState(src, dst);
        expect(dst.colonies[2]).toBeUndefined();
      });

      it('colony bucket arrays independence: workers array values copied but not same reference', () => {
        src.colonies[1] = createColonyRecord(1, 10);
        src.colonies[1]!.workers = [10, 20, 30];
        copyWorldState(src, dst);
        expect(dst.colonies[1]!.workers).toEqual([10, 20, 30]);
        expect(dst.colonies[1]!.workers).not.toBe(src.colonies[1]!.workers);
      });

      it('nested plain-object reuse: targetRatio object identity preserved through copy (zero-alloc steady state)', () => {
        src.colonies[1] = createColonyRecord(1, 10);
        copyWorldState(src, dst);
        const beforeRatio = dst.colonies[1]!.targetRatio;
        // Mutate src ratio, then copy again
        src.colonies[1]!.targetRatio.forage = 5;
        copyWorldState(src, dst);
        // Same object reference — field-by-field copy, not spread
        expect(dst.colonies[1]!.targetRatio).toBe(beforeRatio);
        // Values updated
        expect(dst.colonies[1]!.targetRatio.forage).toBe(5);
      });

      it('taskCensus shape preserved through copy: 4 fields (nurse, forage, dig, fight) — no idle', () => {
        src.colonies[1] = createColonyRecord(1, 10);
        src.colonies[1]!.taskCensus = { nurse: 2, forage: 3, dig: 1, fight: 0 };
        copyWorldState(src, dst);
        const keys = Object.keys(dst.colonies[1]!.taskCensus).sort();
        expect(keys).toEqual(['dig', 'fight', 'forage', 'nurse']);
        expect(dst.colonies[1]!.taskCensus.nurse).toBe(2);
        expect(dst.colonies[1]!.taskCensus.forage).toBe(3);
        expect(dst.colonies[1]!.taskCensus.dig).toBe(1);
        expect(dst.colonies[1]!.taskCensus.fight).toBe(0);
      });
    });

    describe('pheromoneGrids', () => {
      let src: ReturnType<typeof createWorldState>;
      let dst: ReturnType<typeof createWorldState>;

      beforeEach(() => {
        src = createWorldState(1, 64);
        dst = createWorldState(2, 64);
      });

      it('pheromone grid round trip: cell value copied correctly', () => {
        src.pheromoneGrids['1:0:surface'] = createPheromoneGrid(16, 16);
        phSet(src.pheromoneGrids['1:0:surface']!, 3, 3, 77);
        copyWorldState(src, dst);
        expect(phGet(dst.pheromoneGrids['1:0:surface']!, 3, 3)).toBe(77);
      });

      it('pheromone grid data independence: mutating src after copy does not affect dst', () => {
        src.pheromoneGrids['1:0:surface'] = createPheromoneGrid(16, 16);
        phSet(src.pheromoneGrids['1:0:surface']!, 3, 3, 77);
        copyWorldState(src, dst);
        // Mutate src AFTER copy — dst must remain unchanged
        phSet(src.pheromoneGrids['1:0:surface']!, 3, 3, 999);
        expect(phGet(dst.pheromoneGrids['1:0:surface']!, 3, 3)).toBe(77);
      });

      it('pheromone grid deletion propagation: grid removed from src is removed from dst on next copy', () => {
        src.pheromoneGrids['1:0:surface'] = createPheromoneGrid(16, 16);
        copyWorldState(src, dst);
        expect(dst.pheromoneGrids['1:0:surface']).toBeDefined();
        delete src.pheromoneGrids['1:0:surface'];
        copyWorldState(src, dst);
        expect(dst.pheromoneGrids['1:0:surface']).toBeUndefined();
      });
    });
  });

  describe('allocateEntityId', () => {
    it('three sequential calls on a fresh WorldState return 0, 1, 2', () => {
      const world = createWorldState(0);
      const id0: EntityId = allocateEntityId(world);
      const id1: EntityId = allocateEntityId(world);
      const id2: EntityId = allocateEntityId(world);
      expect(id0).toBe(0);
      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });

    it('nextEntityId === 3 after three allocations', () => {
      const world = createWorldState(0);
      allocateEntityId(world);
      allocateEntityId(world);
      allocateEntityId(world);
      expect(world.nextEntityId).toBe(3);
    });
  });
});
