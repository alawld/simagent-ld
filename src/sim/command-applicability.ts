// Read-only "would tick step-1 accept this command?" checks (PRD §5 silent-drop preview).
// Intended for agent legality hints — keep aligned with `tick.ts` command dispatcher; add tests when tick gates change.

import type { WorldState } from './types.js';
import { SIM_VERSION_V5_CHAMBER_ON_MARKED } from './types.js';
import type { SimCommand } from './commands.js';
import type { ColonyId } from './colony/colony-store.js';
import { CHAMBER_DIMENSIONS } from './colony/chamber.js';
import { ChamberType } from './enums.js';
import { UndergroundTileState, ugGet } from './terrain.js';
import { FP_SHIFT } from './fixed.js';
import {
  UNDERGROUND_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
  UNDERGROUND_CEILING_ROW_Y,
  SURFACE_GRID_WIDTH,
  SURFACE_GRID_HEIGHT,
  MAX_ENTRANCES_PER_COLONY,
  MAX_ENTITIES,
} from './constants.js';
import { isFootprintReachableAfterDigs } from './tick.js';

export type CommandApplicability =
  | { applicable: true }
  | { applicable: false; code: string };

function reject(code: string): CommandApplicability {
  return { applicable: false, code };
}

/**
 * Returns whether **`tick(world, [cmd])`** would apply **step-1** effects for this command,
 * using the same **read-only** guards as the dispatcher (no mutation, no `allocateEntityId` side effects).
 */
export function evaluateCommandApplicability(world: WorldState, cmd: SimCommand): CommandApplicability {
  switch (cmd.type) {
    case 'NoOp':
      return { applicable: true };

    case 'SetBehaviorRatio': {
      const colony = world.colonies[cmd.colonyId];
      if (colony === undefined) return reject('colony_missing');
      const ratioRaw: unknown = cmd.ratio;
      if (ratioRaw === null || typeof ratioRaw !== 'object') return reject('ratio_not_object');
      const ratioObj = ratioRaw as { forage?: unknown; fight?: unknown; dig?: unknown };
      let nextForage = ratioObj.forage as number;
      let nextFight = ratioObj.fight as number;
      if ('dig' in ratioObj) {
        if (!Number.isFinite(nextForage)) nextForage = 0;
        if (!Number.isFinite(nextFight)) nextFight = 0;
        if (nextForage === 0 && nextFight === 0) {
          nextForage = 10;
          nextFight = 0;
        }
      }
      if (!Number.isFinite(nextForage) || !Number.isFinite(nextFight)) return reject('ratio_non_finite');
      if (nextForage < 0 || nextFight < 0) return reject('ratio_negative');
      return { applicable: true };
    }

    case 'MarkDigTile': {
      const underground = world.undergroundGrids[cmd.colonyId];
      if (!underground) return reject('no_underground');
      if (cmd.tileX < 0 || cmd.tileX >= UNDERGROUND_GRID_WIDTH || cmd.tileY < 0 || cmd.tileY >= UNDERGROUND_GRID_HEIGHT) {
        return reject('dig_out_of_bounds');
      }
      if (cmd.tileY === UNDERGROUND_CEILING_ROW_Y) return reject('dig_ceiling_strip');
      if (ugGet(underground, cmd.tileX, cmd.tileY) !== UndergroundTileState.Solid) return reject('dig_not_solid');
      return { applicable: true };
    }

    case 'MarkFoodPile': {
      if (!world.colonies[cmd.colonyId]) return reject('colony_missing');
      let matched: number | null = null;
      for (let i = 0; i < world.foodPiles.length; i++) {
        const pile = world.foodPiles[i]!;
        if (pile.tileX === cmd.tileX && pile.tileY === cmd.tileY) {
          matched = pile.foodPileId;
          break;
        }
      }
      if (matched === null) return reject('food_pile_not_found');
      return { applicable: true };
    }

    case 'CancelDigMark': {
      const underground = world.undergroundGrids[cmd.colonyId];
      if (!underground) return reject('no_underground');
      if (cmd.tileX < 0 || cmd.tileX >= UNDERGROUND_GRID_WIDTH || cmd.tileY < 0 || cmd.tileY >= UNDERGROUND_GRID_HEIGHT) {
        return reject('cancel_out_of_bounds');
      }
      if (ugGet(underground, cmd.tileX, cmd.tileY) !== UndergroundTileState.Marked) return reject('cancel_not_marked');
      return { applicable: true };
    }

    case 'PlaceChamber': {
      const underground = world.undergroundGrids[cmd.colonyId];
      if (!underground) return reject('no_underground');
      const dims = CHAMBER_DIMENSIONS[cmd.chamberType];
      if (!dims) return reject('chamber_type_unknown');
      if (cmd.anchorTileX < 0 || cmd.anchorTileX + dims.width > UNDERGROUND_GRID_WIDTH) return reject('chamber_bounds_x');
      if (cmd.anchorTileY < 0 || cmd.anchorTileY + dims.height > UNDERGROUND_GRID_HEIGHT) return reject('chamber_bounds_y');
      if (cmd.anchorTileY === UNDERGROUND_CEILING_ROW_Y) return reject('chamber_ceiling_overlap');
      const colony3 = world.colonies[cmd.colonyId];
      if (!colony3) return reject('colony_missing');
      if (cmd.chamberType === ChamberType.Queen) {
        let hasQueen = false;
        for (let qi = 0; qi < colony3.chambers.length; qi++) {
          if (colony3.chambers[qi]!.chamberType === ChamberType.Queen) {
            hasQueen = true;
            break;
          }
        }
        if (!hasQueen) {
          for (const pcKey in world.pendingChambers) {
            if (!Object.hasOwn(world.pendingChambers, pcKey)) continue;
            const pc = world.pendingChambers[pcKey]!;
            if (pc.colonyId === cmd.colonyId && pc.chamberType === ChamberType.Queen) {
              hasQueen = true;
              break;
            }
          }
        }
        if (hasQueen) return reject('queen_already_exists');
      }
      if (world.simVersion < SIM_VERSION_V5_CHAMBER_ON_MARKED) {
        if (ugGet(underground, cmd.anchorTileX, cmd.anchorTileY) !== UndergroundTileState.Open) {
          return reject('chamber_anchor_not_open_pre_v5');
        }
        let hasAdjacentSolid = false;
        const ax = cmd.anchorTileX;
        const ay = cmd.anchorTileY;
        if (ax - 1 >= 0 && ugGet(underground, ax - 1, ay) === UndergroundTileState.Solid) hasAdjacentSolid = true;
        if (!hasAdjacentSolid && ax + 1 < UNDERGROUND_GRID_WIDTH && ugGet(underground, ax + 1, ay) === UndergroundTileState.Solid) {
          hasAdjacentSolid = true;
        }
        if (!hasAdjacentSolid && ay - 1 >= 0 && ugGet(underground, ax, ay - 1) === UndergroundTileState.Solid) {
          hasAdjacentSolid = true;
        }
        if (!hasAdjacentSolid && ay + 1 < UNDERGROUND_GRID_HEIGHT && ugGet(underground, ax, ay + 1) === UndergroundTileState.Solid) {
          hasAdjacentSolid = true;
        }
        if (!hasAdjacentSolid) return reject('chamber_no_adjacent_solid_pre_v5');
      }
      {
        let conflictsBeingDug = false;
        for (let dy = 0; dy < dims.height && !conflictsBeingDug; dy++) {
          for (let dx = 0; dx < dims.width; dx++) {
            if (ugGet(underground, cmd.anchorTileX + dx, cmd.anchorTileY + dy) === UndergroundTileState.BeingDug) {
              conflictsBeingDug = true;
              break;
            }
          }
        }
        if (conflictsBeingDug) return reject('chamber_footprint_being_dug');
      }
      const newPcKey = `${cmd.colonyId}:${cmd.anchorTileX}:${cmd.anchorTileY}`;
      if (Object.hasOwn(world.pendingChambers, newPcKey)) return reject('chamber_pending_anchor_exists');
      let overlaps = false;
      for (const ch of colony3.chambers) {
        const chTileX = ch.posX >> FP_SHIFT;
        const chTileY = ch.posY >> FP_SHIFT;
        if (
          cmd.anchorTileX < chTileX + ch.width &&
          cmd.anchorTileX + dims.width > chTileX &&
          cmd.anchorTileY < chTileY + ch.height &&
          cmd.anchorTileY + dims.height > chTileY
        ) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) return reject('chamber_overlaps_completed');
      for (const pcKey in world.pendingChambers) {
        if (!Object.hasOwn(world.pendingChambers, pcKey)) continue;
        const pc = world.pendingChambers[pcKey]!;
        if (pc.colonyId !== cmd.colonyId) continue;
        if (
          cmd.anchorTileX < pc.anchorTileX + pc.width &&
          cmd.anchorTileX + dims.width > pc.anchorTileX &&
          cmd.anchorTileY < pc.anchorTileY + pc.height &&
          cmd.anchorTileY + dims.height > pc.anchorTileY
        ) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) return reject('chamber_overlaps_pending');
      if (world.simVersion >= SIM_VERSION_V5_CHAMBER_ON_MARKED) {
        if (!isFootprintReachableAfterDigs(world, colony3, cmd.anchorTileX, cmd.anchorTileY, dims.width, dims.height)) {
          return reject('chamber_unreachable');
        }
      }
      return { applicable: true };
    }

    case 'DesignateEntrance': {
      const colony4 = world.colonies[cmd.colonyId];
      if (!colony4) return reject('colony_missing');
      const underground = world.undergroundGrids[cmd.colonyId];
      if (!underground) return reject('no_underground');
      if (cmd.surfaceTileX < 0 || cmd.surfaceTileX >= SURFACE_GRID_WIDTH) return reject('entrance_surface_x');
      if (cmd.surfaceTileY < 0 || cmd.surfaceTileY >= SURFACE_GRID_HEIGHT) return reject('entrance_surface_y');
      if (colony4.entrances.length >= MAX_ENTRANCES_PER_COLONY) return reject('entrance_cap');
      for (let e = 0; e < colony4.entrances.length; e++) {
        if (colony4.entrances[e]!.surfaceTileX === cmd.surfaceTileX) return reject('entrance_duplicate_column');
      }
      for (let p = 0; p < world.foodPiles.length; p++) {
        const pile = world.foodPiles[p]!;
        if (pile.tileX === cmd.surfaceTileX && pile.tileY === cmd.surfaceTileY) return reject('entrance_on_food_pile');
      }
      if (
        colony4.rallyPoint !== null &&
        colony4.rallyPoint.tileX === cmd.surfaceTileX &&
        colony4.rallyPoint.tileY === cmd.surfaceTileY
      ) {
        return reject('entrance_on_rally');
      }
      for (const otherKey in world.colonies) {
        if (!Object.hasOwn(world.colonies, otherKey)) continue;
        const other = world.colonies[otherKey as unknown as ColonyId]!;
        if (other.colonyId === cmd.colonyId) continue;
        for (let e = 0; e < other.entrances.length; e++) {
          const oe = other.entrances[e]!;
          if (oe.surfaceTileX === cmd.surfaceTileX && oe.surfaceTileY === cmd.surfaceTileY) {
            return reject('entrance_occupied_by_other_colony');
          }
        }
      }
      if (world.nextEntityId >= MAX_ENTITIES) return reject('entity_id_exhausted');
      return { applicable: true };
    }

    case 'SetRallyPoint': {
      const colony = world.colonies[cmd.colonyId];
      if (colony === undefined) return reject('colony_missing');
      if (cmd.tileX < 0 || cmd.tileX >= SURFACE_GRID_WIDTH) return reject('rally_x');
      if (cmd.tileY < 0 || cmd.tileY >= SURFACE_GRID_HEIGHT) return reject('rally_y');
      return { applicable: true };
    }

    case 'ClearRallyPoint': {
      const colony = world.colonies[cmd.colonyId];
      if (colony === undefined) return reject('colony_missing');
      return { applicable: true };
    }

    default: {
      const _e: never = cmd;
      void _e;
      return reject('unknown_command_type');
    }
  }
}

/** Cheap world affordances for observation (counts only). */
export function computeAffordances(world: WorldState, playerColonyId: ColonyId): {
  playerMarkedDigTileCount: number;
  foodPileCount: number;
  playerEntranceCount: number;
} {
  const colony = world.colonies[playerColonyId];
  let playerMarkedDigTileCount = 0;
  const ug = world.undergroundGrids[playerColonyId];
  if (ug !== undefined) {
    for (let i = 0; i < ug.data.length; i++) {
      if (ug.data[i] === UndergroundTileState.Marked) playerMarkedDigTileCount += 1;
    }
  }
  return {
    playerMarkedDigTileCount,
    foodPileCount: world.foodPiles.length,
    playerEntranceCount: colony?.entrances.length ?? 0,
  };
}
