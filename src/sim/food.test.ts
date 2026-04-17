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
      isMarkedPriority: false,
    };
    expect(pile.foodPileId).toBe(1);
    expect(pile.tileX).toBe(24);
    expect(pile.tileY).toBe(10);
    expect(pile.isMarkedPriority).toBe(false);
  });

  it('isMarkedPriority can be true', () => {
    const pile: FoodPile = {
      foodPileId: 2 as FoodPileId,
      tileX: 64,
      tileY: 20,
      isMarkedPriority: true,
    };
    expect(pile.isMarkedPriority).toBe(true);
  });

  it('FoodPileId is a number type', () => {
    const id: FoodPileId = 42;
    expect(typeof id).toBe('number');
  });

  it('two FoodPile objects are independent', () => {
    const pile1: FoodPile = { foodPileId: 1, tileX: 10, tileY: 20, isMarkedPriority: false };
    const pile2: FoodPile = { foodPileId: 2, tileX: 30, tileY: 40, isMarkedPriority: true };
    expect(pile1.foodPileId).toBe(1);
    expect(pile2.foodPileId).toBe(2);
    expect(pile1.isMarkedPriority).toBe(false);
    expect(pile2.isMarkedPriority).toBe(true);
  });
});
