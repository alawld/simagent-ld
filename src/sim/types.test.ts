import { describe, it, expect } from 'vitest';
import {
  type WorldState,
  type EntityId,
  createWorldState,
  copyWorldState,
  allocateEntityId,
} from './types.js';

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

    it('has exactly four fields', () => {
      const world = createWorldState(0);
      const keys = Object.keys(world);
      expect(keys).toHaveLength(4);
      expect(keys).toContain('tick');
      expect(keys).toContain('rngState');
      expect(keys).toContain('nextEntityId');
      expect(keys).toContain('commandQueue');
    });
  });

  describe('copyWorldState', () => {
    it('copies all fields from src into dst', () => {
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

    it('dst changes do not affect src (no shared state)', () => {
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
