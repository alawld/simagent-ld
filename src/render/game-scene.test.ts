// game-scene.test.ts — unit tests for pure-logic helpers extracted from GameScene.
//
// Scope: pure functions only (no Phaser scene booting).
// Phaser-coupled integration (boot flow, overlay triggers, keyboard) is covered by Plan 07 Playwright.
//
// Helpers under test (all exported from game-scene.ts):
//   - decideBootMode(hasSaveFn): 'prompt' | 'fresh'
//   - deriveAIColonyIds(world, playerColonyId): ColonyId[]
//   - appendInputLog(log, cmds): void
//   - generateFreshSeed(nowMs): number

import { describe, it, expect } from 'vitest';
import {
  decideBootMode,
  deriveAIColonyIds,
  appendInputLog,
  generateFreshSeed,
  GamePhase,
} from './game-scene-logic.js';
import type { WorldState } from '../sim/types.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import type { SimCommand } from '../sim/commands.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal WorldState-like object with a given colonies plain object. */
function makeWorldWithColonies(
  coloniesObj: Record<number, object>,
): WorldState {
  return {
    tick: 0,
    rngState: 0,
    nextEntityId: 0,
    commandQueue: [],
    ants: { posX: new Int32Array(0), posY: new Int32Array(0), colonyId: new Int32Array(0), task: new Int32Array(0), subTask: new Int32Array(0), speed: new Int32Array(0), foodCarrying: new Int32Array(0), starvationTimer: new Int32Array(0), age: new Int32Array(0), alive: new Int32Array(0), lifespan: new Int32Array(0), zone: new Int32Array(0), digTileX: new Int32Array(0), digTileY: new Int32Array(0), digTicksRemaining: new Int32Array(0), targetPosX: new Int32Array(0), targetPosY: new Int32Array(0) },
    colonies: coloniesObj as WorldState['colonies'],
    pheromoneGrids: {},
    surface: { data: new Uint8Array(0), width: 0, height: 0 },
    undergroundGrids: {},
    foodPiles: [],
    pendingChambers: {},
  } as unknown as WorldState;
}

// ---------------------------------------------------------------------------
// GamePhase object-const
// ---------------------------------------------------------------------------

describe('GamePhase object-const', () => {
  it('has exactly 4 states: Playing, Paused, GameOver, SavePrompt', () => {
    expect(GamePhase.Playing).toBeDefined();
    expect(GamePhase.Paused).toBeDefined();
    expect(GamePhase.GameOver).toBeDefined();
    expect(GamePhase.SavePrompt).toBeDefined();
  });

  it('values are all distinct numbers', () => {
    const values = Object.values(GamePhase);
    const unique = new Set(values);
    expect(unique.size).toBe(4);
    for (const v of values) {
      expect(typeof v).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// decideBootMode
// ---------------------------------------------------------------------------

describe('decideBootMode', () => {
  it("returns 'prompt' when hasSave returns true", () => {
    expect(decideBootMode(() => true)).toBe('prompt');
  });

  it("returns 'fresh' when hasSave returns false", () => {
    expect(decideBootMode(() => false)).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------
// deriveAIColonyIds
// ---------------------------------------------------------------------------

describe('deriveAIColonyIds', () => {
  it('returns all colony ids except the player colony', () => {
    const world = makeWorldWithColonies({ 1: {}, 2: {} });
    const result = deriveAIColonyIds(world, 1 as ColonyId);
    expect(result).toEqual([2]);
  });

  it('returns [] for a single-colony world (no AI)', () => {
    const world = makeWorldWithColonies({ 1: {} });
    const result = deriveAIColonyIds(world, 1 as ColonyId);
    expect(result).toEqual([]);
  });

  it('returns [2, 3] in ascending order for three colonies with player=1', () => {
    const world = makeWorldWithColonies({ 1: {}, 2: {}, 3: {} });
    const result = deriveAIColonyIds(world, 1 as ColonyId);
    expect(result).toEqual([2, 3]);
  });

  it('uses Object.keys on world.colonies (plain object, NOT Map API)', () => {
    // This test verifies deriveAIColonyIds does not call .keys()/.entries() on colonies.
    // If it did, Map-style access would throw because colonies is a plain object.
    // We verify by using a plain object — Map.prototype.keys would throw.
    const world = makeWorldWithColonies({ 1: {}, 2: {} });
    // Should not throw
    expect(() => deriveAIColonyIds(world, 1 as ColonyId)).not.toThrow();
    const result = deriveAIColonyIds(world, 1 as ColonyId);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// appendInputLog
// ---------------------------------------------------------------------------

describe('appendInputLog', () => {
  it('appends all commands to the log in order', () => {
    const log: SimCommand[] = [];
    const cmds: SimCommand[] = [
      { type: 'NoOp', issuedAtTick: 0 },
      { type: 'NoOp', issuedAtTick: 1 },
    ];
    appendInputLog(log, cmds);
    expect(log).toHaveLength(2);
    expect(log[0]!.issuedAtTick).toBe(0);
    expect(log[1]!.issuedAtTick).toBe(1);
  });

  it('never drops commands — no truncation at any size (SCEN-06 replay truth)', () => {
    const log: SimCommand[] = [];
    const bigBatch: SimCommand[] = Array.from({ length: 200 }, (_, i) => ({
      type: 'NoOp' as const,
      issuedAtTick: i,
    }));
    appendInputLog(log, bigBatch);
    expect(log).toHaveLength(200);
  });

  it('handles empty cmds array — log unchanged', () => {
    const log: SimCommand[] = [{ type: 'NoOp', issuedAtTick: 99 }];
    appendInputLog(log, []);
    expect(log).toHaveLength(1);
  });

  it('appends across multiple calls (cumulative)', () => {
    const log: SimCommand[] = [];
    appendInputLog(log, [{ type: 'NoOp', issuedAtTick: 0 }]);
    appendInputLog(log, [{ type: 'NoOp', issuedAtTick: 1 }]);
    appendInputLog(log, [{ type: 'NoOp', issuedAtTick: 2 }]);
    expect(log).toHaveLength(3);
    expect(log[2]!.issuedAtTick).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// generateFreshSeed
// ---------------------------------------------------------------------------

describe('generateFreshSeed', () => {
  it('returns a positive int32 for a typical wall-clock timestamp (0 ≤ seed ≤ 0x7fffffff)', () => {
    const nowMs = Date.now(); // ~1.7e12
    const seed = generateFreshSeed(nowMs);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0x7fffffff);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it('is pure — same nowMs always produces the same seed', () => {
    const nowMs = 1234567890;
    expect(generateFreshSeed(nowMs)).toBe(generateFreshSeed(nowMs));
  });

  it('computes (nowMs & 0x7fffffff) | 0 — positive int32 clamp', () => {
    const nowMs = 1234567890;
    expect(generateFreshSeed(nowMs)).toBe((nowMs & 0x7fffffff) | 0);
  });

  it('result is non-negative for very large timestamps (Date.now() range)', () => {
    // Date.now() is ~1.7e12 — exceeds int32; bitmask clamps correctly
    const bigNow = 1_700_000_000_000;
    const seed = generateFreshSeed(bigNow);
    expect(seed).toBeGreaterThanOrEqual(0);
  });
});
