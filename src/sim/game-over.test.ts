import { describe, it } from 'vitest';

describe('game-over detection', () => {
  describe('checkQueenDeath', () => {
    it.todo('returns None when both queens alive');
    it.todo('returns Victory when enemy queen dead and player queen alive (CMBT-06)');
    it.todo('returns Defeat when player queen dead and enemy queen alive (CMBT-07)');
    it.todo('returns MutualDestruction when both queens dead in same tick');
    it.todo('sets colony.defeated = true when queen alive = 0');
  });

  describe('queen death causes', () => {
    it.todo('queen killed by combat at step 17 detected at step 18');
    it.todo('queen killed by starvation at step 4/5 detected at step 18');
    it.todo('queen starvation + combat death in same tick produces MutualDestruction');
  });

  describe('GameOutcome propagation (CMBT-08)', () => {
    it.todo('tick() returns GameOutcome from checkQueenDeath');
  });
});
