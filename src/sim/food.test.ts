// food.test.ts — PRD §6a FoodPile interface unit tests
//
// Run: npx vitest run src/sim/food.test.ts

import { describe, expect, it } from 'vitest';
import type { FoodPile, FoodPileId } from './food.js';

describe('FoodPile interface', () => {
  it('can be constructed with expected fields', () => {
    const pile: FoodPile = {
      foodPileId: 1 as FoodPileId,
      tileX: 24,
      tileY: 10,
    };
    expect(pile.foodPileId).toBe(1);
    expect(pile.tileX).toBe(24);
    expect(pile.tileY).toBe(10);
  });

  it('FoodPileId is a number type', () => {
    const id: FoodPileId = 42;
    expect(typeof id).toBe('number');
  });

  it('two FoodPile objects are independent', () => {
    const pile1: FoodPile = { foodPileId: 1, tileX: 10, tileY: 20 };
    const pile2: FoodPile = { foodPileId: 2, tileX: 30, tileY: 40 };
    expect(pile1.foodPileId).toBe(1);
    expect(pile2.foodPileId).toBe(2);
    expect(pile1.tileX).toBe(10);
    expect(pile2.tileX).toBe(30);
  });

  it('pile objects do not carry a priority flag (priority lives on ColonyRecord per Phase 9)', () => {
    const pile: FoodPile = { foodPileId: 5, tileX: 0, tileY: 0 };
    expect(Object.prototype.hasOwnProperty.call(pile, 'isMarkedPriority')).toBe(false);
  });
});
