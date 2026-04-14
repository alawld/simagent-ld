import { describe, it } from 'vitest';

describe('combat system', () => {
  describe('detectAndResolveCombat', () => {
    it.todo('groups ants by tile key (zone, tileX, tileY) for combat detection');
    it.todo('skips tiles with ants from only one colony');
    it.todo('sorts each colony group by EntityId ascending for deterministic pairing');
    it.todo('resolves multi-round 1v1 using rng.nextInt(2) coin flip (CMBT-05)');
    it.todo('advances only the loser index after each round');
    it.todo('surviving ants from the larger group remain alive after all rounds');
  });

  describe('killAnt', () => {
    it.todo('sets ants.alive[id] = 0');
    it.todo('drops carried food at death tile (surface creates FoodPile)');
    it.todo('deposits DANGER_PHEROMONE_BURST_AMOUNT to dead ant own colony danger grid');
  });

  describe('zone separation', () => {
    it.todo('surface ant and underground ant at same tileX/tileY do NOT fight');
  });

  describe('coin flip distribution (CMBT-05)', () => {
    it.todo('over 1000 fights with known seed, win rate approaches 50%');
  });
});
