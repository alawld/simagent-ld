import { describe, it, expect } from 'vitest';
import { GameOutcome, checkQueenDeath } from './game-over.js';
import { createWorldState, allocateEntityId } from './types.js';
import { createColonyRecord } from './colony/colony-store.js';
import { initAnt } from './ant/ant-store.js';
import { AntTask } from './enums.js';
import type { ColonyId } from './colony/colony-store.js';
import type { WorldState } from './types.js';

function makeWorldWith2Colonies(): { world: WorldState; queen1: number; queen2: number } {
  const world = createWorldState(42);
  const queen1 = allocateEntityId(world);
  initAnt(world.ants, queen1, { colonyId: 1, posX: 0, posY: 0, task: AntTask.Idle, subTask: 0, speed: 0 });
  const c1 = createColonyRecord(1 as ColonyId, queen1);
  c1.entrances = []; c1.rallyPoint = null; c1.digFlowFieldDirty = false;
  world.colonies[1] = c1;

  const queen2 = allocateEntityId(world);
  initAnt(world.ants, queen2, { colonyId: 2, posX: 0, posY: 0, task: AntTask.Idle, subTask: 0, speed: 0 });
  const c2 = createColonyRecord(2 as ColonyId, queen2);
  c2.entrances = []; c2.rallyPoint = null; c2.digFlowFieldDirty = false;
  world.colonies[2] = c2;

  return { world, queen1, queen2 };
}

describe('game-over detection', () => {
  describe('checkQueenDeath', () => {
    it('is exported as a function', () => {
      expect(typeof checkQueenDeath).toBe('function');
    });

    it('returns None when both queens alive', () => {
      const { world } = makeWorldWith2Colonies();
      expect(checkQueenDeath(world)).toBe(GameOutcome.None);
    });

    it('returns Victory when enemy queen dead and player queen alive (CMBT-06)', () => {
      const { world, queen2 } = makeWorldWith2Colonies();
      world.ants.alive[queen2] = 0; // colony 2 queen dead
      expect(checkQueenDeath(world)).toBe(GameOutcome.Victory);
    });

    it('returns Defeat when player queen dead and enemy queen alive (CMBT-07)', () => {
      const { world, queen1 } = makeWorldWith2Colonies();
      world.ants.alive[queen1] = 0;
      expect(checkQueenDeath(world)).toBe(GameOutcome.Defeat);
    });

    it('returns MutualDestruction when all queens dead', () => {
      const { world, queen1, queen2 } = makeWorldWith2Colonies();
      world.ants.alive[queen1] = 0;
      world.ants.alive[queen2] = 0;
      expect(checkQueenDeath(world)).toBe(GameOutcome.MutualDestruction);
    });

    it('sets colony.defeated = true for dead-queen colonies (idempotent)', () => {
      const { world, queen2 } = makeWorldWith2Colonies();
      world.ants.alive[queen2] = 0;
      expect(world.colonies[2]!.defeated).toBe(false);
      const r1 = checkQueenDeath(world);
      expect(world.colonies[2]!.defeated).toBe(true);
      const r2 = checkQueenDeath(world);
      expect(r1).toBe(r2); // idempotent outcome
      expect(world.colonies[2]!.defeated).toBe(true);
    });

    it('single-colony world: returns None when queen alive', () => {
      const { world, queen2 } = makeWorldWith2Colonies();
      delete world.colonies[2];
      void queen2;
      expect(checkQueenDeath(world)).toBe(GameOutcome.None);
    });

    it('single-colony world: returns Defeat when queen dead', () => {
      const { world, queen1 } = makeWorldWith2Colonies();
      delete world.colonies[2];
      world.ants.alive[queen1] = 0;
      expect(checkQueenDeath(world)).toBe(GameOutcome.Defeat);
    });

    it('uses smallest colonyId as player when playerColonyId arg omitted (CLNY-08)', () => {
      const { world, queen1 } = makeWorldWith2Colonies();
      world.ants.alive[queen1] = 0;
      // Colony 1 is "player" by default (smallest id) → Defeat
      expect(checkQueenDeath(world)).toBe(GameOutcome.Defeat);
    });

    it('respects playerColonyId arg when provided', () => {
      const { world, queen1 } = makeWorldWith2Colonies();
      world.ants.alive[queen1] = 0;
      // Override: colony 2 is "player", colony 1 (now dead) is "enemy" → Victory
      expect(checkQueenDeath(world, 2 as ColonyId)).toBe(GameOutcome.Victory);
    });
  });

  describe('queen death causes', () => {
    it('queen slot alive=0 (regardless of cause) is detected as dead', () => {
      const { world, queen2 } = makeWorldWith2Colonies();
      // Simulate either combat (alive=0) or starvation (alive=0) — both look the same here.
      world.ants.alive[queen2] = 0;
      expect(checkQueenDeath(world)).toBe(GameOutcome.Victory);
    });
  });
});
