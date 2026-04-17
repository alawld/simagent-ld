// food.ts — PRD §6a FoodPile data interface
//
// FoodPiles are static surface entities — they never deplete (SURF-02).
// This module is data-only: no mutation helpers, no tick logic.
//
// Compatible with Node --experimental-strip-types (no const enum, no enums).

// ---------------------------------------------------------------------------
// FoodPileId — integer alias for readability (PRD §6a)
// ---------------------------------------------------------------------------

export type FoodPileId = number;

// ---------------------------------------------------------------------------
// FoodPile — static surface food source (PRD §6a, SURF-02)
//
// Food piles are placed at world-generation time and never removed.
// isMarkedPriority: true when the player has marked this pile for priority
// foraging, causing forager ants to prefer it over unmarked piles.
// ---------------------------------------------------------------------------

export interface FoodPile {
  foodPileId: FoodPileId;
  tileX: number;
  tileY: number;
  isMarkedPriority: boolean;
}
