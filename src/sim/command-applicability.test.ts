import { describe, it, expect } from 'vitest';
import { createScenario } from './scenario.js';
import { tick } from './tick.js';
import { GameOutcome } from './game-over.js';
import { PLAYER_COLONY_ID } from './constants.js';
import type { ColonyId } from './colony/colony-store.js';
import { UndergroundTileState, ugGet } from './terrain.js';
import { UNDERGROUND_GRID_WIDTH, UNDERGROUND_CEILING_ROW_Y } from './constants.js';
import { evaluateCommandApplicability, computeAffordances } from './command-applicability.js';

describe('evaluateCommandApplicability', () => {
  it('NoOp is always applicable', () => {
    const world = createScenario(1);
    expect(evaluateCommandApplicability(world, { type: 'NoOp', issuedAtTick: 0 })).toEqual({
      applicable: true,
    });
  });

  it('rejects MarkDigTile out of bounds', () => {
    const world = createScenario(2);
    const r = evaluateCommandApplicability(world, {
      type: 'MarkDigTile',
      colonyId: PLAYER_COLONY_ID as ColonyId,
      tileX: -1,
      tileY: 1,
      issuedAtTick: 0,
    });
    expect(r).toEqual({ applicable: false, code: 'dig_out_of_bounds' });
  });

  it('rejects MarkDigTile on ceiling strip', () => {
    const world = createScenario(3);
    const r = evaluateCommandApplicability(world, {
      type: 'MarkDigTile',
      colonyId: PLAYER_COLONY_ID as ColonyId,
      tileX: 0,
      tileY: UNDERGROUND_CEILING_ROW_Y,
      issuedAtTick: 0,
    });
    expect(r).toEqual({ applicable: false, code: 'dig_ceiling_strip' });
  });

  it('rejects SetBehaviorRatio for missing colony', () => {
    const world = createScenario(4);
    const badId = 99999 as ColonyId;
    expect(evaluateCommandApplicability(world, {
      type: 'SetBehaviorRatio',
      colonyId: badId,
      ratio: { forage: 1, fight: 1 },
      issuedAtTick: 0,
    })).toEqual({ applicable: false, code: 'colony_missing' });
  });

  it('matches tick silent-drop for invalid MarkDigTile (tile unchanged)', () => {
    const world = createScenario(5);
    const tx = UNDERGROUND_GRID_WIDTH;
    const ty = 2;
    const before = ugGet(world.undergroundGrids[PLAYER_COLONY_ID as ColonyId]!, tx - 1, ty);
    const cmd = {
      type: 'MarkDigTile' as const,
      colonyId: PLAYER_COLONY_ID as ColonyId,
      tileX: tx,
      tileY: ty,
      issuedAtTick: 0,
    };
    expect(evaluateCommandApplicability(world, cmd).applicable).toBe(false);
    expect(tick(world, [cmd])).toBe(GameOutcome.None);
    expect(ugGet(world.undergroundGrids[PLAYER_COLONY_ID as ColonyId]!, tx - 1, ty)).toBe(before);
  });
});

describe('computeAffordances', () => {
  it('returns non-negative counts for default scenario', () => {
    const world = createScenario(6);
    const a = computeAffordances(world, PLAYER_COLONY_ID as ColonyId);
    expect(a.foodPileCount).toBeGreaterThanOrEqual(0);
    expect(a.playerEntranceCount).toBeGreaterThanOrEqual(0);
    expect(a.playerMarkedDigTileCount).toBeGreaterThanOrEqual(0);
  });

  it('counts Marked underground tiles for player colony', () => {
    const world = createScenario(7);
    const ug = world.undergroundGrids[PLAYER_COLONY_ID as ColonyId]!;
    let marked = 0;
    for (let i = 0; i < ug.data.length; i++) {
      if (ug.data[i] === UndergroundTileState.Marked) marked += 1;
    }
    expect(computeAffordances(world, PLAYER_COLONY_ID as ColonyId).playerMarkedDigTileCount).toBe(marked);
  });
});
