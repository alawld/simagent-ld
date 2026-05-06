// Phase G — seeded RNG walks random AgentSimCommand shapes; peekApplicability gates illegal cmds → NoOp.
import { describe, it, expect } from 'vitest';
import { Rng } from '../sim/rng.js';
import { ChamberType } from '../sim/enums.js';
import {
  PLAYER_COLONY_ID,
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
  UNDERGROUND_CEILING_ROW_Y,
} from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import type { AgentSimCommand } from './types.js';
import { SimAgentHarness } from './harness.js';

const PID = PLAYER_COLONY_ID as ColonyId;

/** Uniform random command shape; callers should gate with `peekApplicability` before stepping. */
function sampleRandomAgentCommand(harness: SimAgentHarness, rng: Rng): AgentSimCommand {
  const world = harness.getWorld();
  const roll = rng.nextRange(0, 14);
  if (roll <= 3) return { type: 'NoOp' };
  if (roll <= 7) {
    return {
      type: 'SetBehaviorRatio',
      colonyId: PID,
      ratio: { forage: rng.nextRange(0, 10), fight: rng.nextRange(0, 10) },
    };
  }
  if (roll === 8) {
    return {
      type: 'MarkDigTile',
      colonyId: PID,
      tileX: rng.nextInt(UNDERGROUND_GRID_WIDTH),
      tileY: rng.nextRange(UNDERGROUND_CEILING_ROW_Y + 1, UNDERGROUND_GRID_HEIGHT - 1),
    };
  }
  if (roll === 9 && world.foodPiles.length > 0) {
    const pile = world.foodPiles[rng.nextInt(world.foodPiles.length)]!;
    return {
      type: 'MarkFoodPile',
      colonyId: PID,
      tileX: pile.tileX,
      tileY: pile.tileY,
    };
  }
  if (roll === 10) {
    return {
      type: 'CancelDigMark',
      colonyId: PID,
      tileX: rng.nextInt(UNDERGROUND_GRID_WIDTH),
      tileY: rng.nextRange(UNDERGROUND_CEILING_ROW_Y + 1, UNDERGROUND_GRID_HEIGHT - 1),
    };
  }
  if (roll === 11) {
    const ct =
      rng.nextInt(3) === 0 ? ChamberType.Queen : rng.nextInt(2) === 0 ? ChamberType.Nursery : ChamberType.FoodStorage;
    return {
      type: 'PlaceChamber',
      colonyId: PID,
      chamberType: ct,
      anchorTileX: rng.nextInt(Math.max(1, UNDERGROUND_GRID_WIDTH - 8)),
      anchorTileY: rng.nextRange(UNDERGROUND_CEILING_ROW_Y + 1, UNDERGROUND_GRID_HEIGHT - 4),
    };
  }
  if (roll === 12) {
    return {
      type: 'DesignateEntrance',
      colonyId: PID,
      surfaceTileX: rng.nextInt(SURFACE_GRID_WIDTH),
      surfaceTileY: rng.nextInt(SURFACE_GRID_HEIGHT),
    };
  }
  if (roll === 13) {
    return {
      type: 'SetRallyPoint',
      colonyId: PID,
      tileX: rng.nextInt(SURFACE_GRID_WIDTH),
      tileY: rng.nextInt(SURFACE_GRID_HEIGHT),
    };
  }
  return { type: 'ClearRallyPoint', colonyId: PID };
}

function legalOrNoOp(harness: SimAgentHarness, cmd: AgentSimCommand): AgentSimCommand {
  const a = harness.peekApplicability(cmd);
  return a.applicable ? cmd : { type: 'NoOp' };
}

describe('SimAgentHarness RNG fuzz (Phase G)', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('seed lane %# — 200 random-command ticks without throw', (lane) => {
    const h = new SimAgentHarness({ seed: 4242 + lane, opponentMode: 'none', recordInputLog: false });
    const rng = new Rng(999 + lane * 17);
    for (let t = 0; t < 200; t++) {
      const raw = sampleRandomAgentCommand(h, rng);
      const cmds = [legalOrNoOp(h, raw)];
      expect(() => h.step({ commands: cmds })).not.toThrow();
      if (h.isTerminal()) break;
    }
    expect(h.getWorld().tick).toBeGreaterThan(0);
  });

  it('RNG fuzz with opponent ai — mixed commands', () => {
    const h = new SimAgentHarness({ seed: 77, opponentMode: 'ai', recordInputLog: false });
    const rng = new Rng(12345);
    for (let t = 0; t < 120; t++) {
      const raw = sampleRandomAgentCommand(h, rng);
      h.step({ commands: [legalOrNoOp(h, raw)] });
      if (h.isTerminal()) break;
    }
    expect(h.getWorld().tick).toBeGreaterThan(0);
  });
});
