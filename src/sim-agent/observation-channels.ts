// B2/B3/B4 observation channels (SimAgentPlan §3) — read-only scans of `WorldState`.
// Lives in `src/sim-agent/` so trainers stay decoupled from Phaser; imports `src/sim/` read-only types/helpers.

import type { WorldState } from '../sim/types.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import { AntTask } from '../sim/enums.js';
import { Zone, sgGet, ugGet } from '../sim/terrain.js';
import { FP_SHIFT } from '../sim/fixed.js';
import {
  MAX_ENTITIES,
  PLAYER_START_X,
  PLAYER_START_Y,
  SURFACE_GRID_HEIGHT,
  SURFACE_GRID_WIDTH,
  UNDERGROUND_GRID_HEIGHT,
  UNDERGROUND_GRID_WIDTH,
} from '../sim/constants.js';

/** Matches `AntTask` discriminant order (Idle..Nursing). */
export const SIM_AGENT_ANT_TASK_KINDS = 5 as const;

/** Indexed by `Zone`: 0 = Surface, 1 = Underground. */
export const SIM_AGENT_ZONE_KINDS = 2 as const;

export interface SimAgentTaskZoneHistograms {
  /** Counts per `AntTask` 0..4 for **alive** ants with `ants.colonyId === playerColonyId`. */
  taskByKind: [number, number, number, number, number];
  /** Counts per `Zone` 0..1 for the same ant set. */
  zoneByKind: [number, number];
}

export interface SimAgentOpponentObservation {
  /** `deriveAIColonyIds` length. */
  enemyColonyCount: number;
  /** True if any AI colony’s queen entity is alive. */
  anyEnemyQueenAlive: boolean;
  /** Sum of `colony.workerCount` across enemy colonies (coarse presence). */
  totalEnemyWorkers: number;
  /** Alive ants with `AntTask.Fighting` on any enemy colony. */
  totalEnemyFightingAnts: number;
}

export interface SimAgentSpatialPatches {
  /** Focal tile used for the surface 4×4 (rally → first entrance → PRD start). */
  surfaceFocalTileX: number;
  surfaceFocalTileY: number;
  /** Row-major 4×4 window of `SurfaceTileState` bytes (clamped to map edges). */
  surfaceTiles4x4: number[];
  /** Focal tile used for the underground 4×4 (queen when underground → else shaft mid). */
  undergroundFocalTileX: number;
  undergroundFocalTileY: number;
  /** Row-major 4×4 window of `UndergroundTileState` bytes on the **player** underground grid. */
  undergroundTiles4x4: number[];
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Top-left of a 4-wide window centered near `center` but clamped inside `[0, width-4]`. */
function patch4TopLeft(center: number, width: number): number {
  const ideal = center - 2;
  return clamp(ideal, 0, width - 4);
}

function fillPatch4x4(
  out: number[],
  width: number,
  height: number,
  topLeftX: number,
  topLeftY: number,
  get: (x: number, y: number) => number,
): void {
  let i = 0;
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++) {
      const x = topLeftX + dx;
      const y = topLeftY + dy;
      out[i++] = x >= 0 && x < width && y >= 0 && y < height ? get(x, y) : 0;
    }
  }
}

export function buildPlayerTaskZoneHistograms(
  world: WorldState,
  playerColonyId: ColonyId,
): SimAgentTaskZoneHistograms {
  const taskByKind: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const zoneByKind: [number, number] = [0, 0];
  const ants = world.ants;
  const limit = world.nextEntityId < MAX_ENTITIES ? world.nextEntityId : MAX_ENTITIES;
  for (let id = 0; id < limit; id++) {
    if (ants.alive[id] !== 1) continue;
    if (ants.colonyId[id] !== playerColonyId) continue;
    const t = ants.task[id];
    if (t === undefined) continue;
    if (t >= 0 && t < SIM_AGENT_ANT_TASK_KINDS) {
      const row = taskByKind as number[];
      row[t] = (row[t] ?? 0) + 1;
    }
    const z = ants.zone[id];
    if (z === Zone.Surface) zoneByKind[0] += 1;
    else if (z === Zone.Underground) zoneByKind[1] += 1;
  }
  return { taskByKind, zoneByKind };
}

export function buildOpponentObservation(
  world: WorldState,
  playerColonyId: ColonyId,
  aiColonyIds: readonly ColonyId[],
): SimAgentOpponentObservation {
  let anyEnemyQueenAlive = false;
  let totalEnemyWorkers = 0;
  let totalEnemyFightingAnts = 0;
  const enemySet = new Set<ColonyId>(aiColonyIds);
  for (let c = 0; c < aiColonyIds.length; c++) {
    const cid = aiColonyIds[c]!;
    const colony = world.colonies[cid];
    if (!colony) continue;
    totalEnemyWorkers += colony.workerCount;
    if (world.ants.alive[colony.queenEntityId] === 1) anyEnemyQueenAlive = true;
  }
  const ants = world.ants;
  const limit = world.nextEntityId < MAX_ENTITIES ? world.nextEntityId : MAX_ENTITIES;
  for (let id = 0; id < limit; id++) {
    if (ants.alive[id] !== 1) continue;
    const cid = ants.colonyId[id];
    if (cid === undefined || cid === playerColonyId) continue;
    if (enemySet.has(cid) && ants.task[id] === AntTask.Fighting) {
      totalEnemyFightingAnts += 1;
    }
  }
  return {
    enemyColonyCount: aiColonyIds.length,
    anyEnemyQueenAlive,
    totalEnemyWorkers,
    totalEnemyFightingAnts,
  };
}

function surfaceFocalTile(world: WorldState, playerColonyId: ColonyId): { x: number; y: number } {
  const colony = world.colonies[playerColonyId];
  if (colony !== undefined && colony.rallyPoint !== null) {
    const rp = colony.rallyPoint;
    return { x: rp.tileX, y: rp.tileY };
  }
  if (colony !== undefined && colony.entrances.length > 0) {
    const e0 = colony.entrances[0]!;
    return { x: e0.surfaceTileX, y: e0.surfaceTileY };
  }
  return { x: PLAYER_START_X, y: PLAYER_START_Y };
}

function undergroundFocalTile(world: WorldState, playerColonyId: ColonyId): { x: number; y: number } {
  const colony = world.colonies[playerColonyId];
  const ug = world.undergroundGrids[playerColonyId];
  if (colony !== undefined && ug !== undefined) {
    const q = colony.queenEntityId;
    if (world.ants.alive[q] === 1 && world.ants.zone[q] === Zone.Underground) {
      const px = world.ants.posX[q];
      const py = world.ants.posY[q];
      return {
        x: (px ?? 0) >> FP_SHIFT,
        y: (py ?? 0) >> FP_SHIFT,
      };
    }
    if (colony.entrances.length > 0) {
      const ex = colony.entrances[0]!.surfaceTileX;
      const midY = clamp(2, 0, UNDERGROUND_GRID_HEIGHT - 1);
      return { x: ex, y: midY };
    }
  }
  return { x: clamp(PLAYER_START_X, 0, UNDERGROUND_GRID_WIDTH - 1), y: 2 };
}

export function buildSpatialPatches(world: WorldState, playerColonyId: ColonyId): SimAgentSpatialPatches {
  const sf = surfaceFocalTile(world, playerColonyId);
  const uf = undergroundFocalTile(world, playerColonyId);

  const surfaceTiles4x4: number[] = new Array(16);
  const stx = patch4TopLeft(sf.x, SURFACE_GRID_WIDTH);
  const sty = patch4TopLeft(sf.y, SURFACE_GRID_HEIGHT);
  fillPatch4x4(surfaceTiles4x4, SURFACE_GRID_WIDTH, SURFACE_GRID_HEIGHT, stx, sty, (x, y) =>
    sgGet(world.surface, x, y),
  );

  const ug = world.undergroundGrids[playerColonyId];
  const undergroundTiles4x4: number[] = new Array(16);
  if (ug !== undefined) {
    const utx = patch4TopLeft(uf.x, UNDERGROUND_GRID_WIDTH);
    const uty = patch4TopLeft(uf.y, UNDERGROUND_GRID_HEIGHT);
    fillPatch4x4(undergroundTiles4x4, UNDERGROUND_GRID_WIDTH, UNDERGROUND_GRID_HEIGHT, utx, uty, (x, y) =>
      ugGet(ug, x, y),
    );
  } else {
    for (let i = 0; i < 16; i++) undergroundTiles4x4[i] = 0;
  }

  return {
    surfaceFocalTileX: sf.x,
    surfaceFocalTileY: sf.y,
    surfaceTiles4x4,
    undergroundFocalTileX: uf.x,
    undergroundFocalTileY: uf.y,
    undergroundTiles4x4,
  };
}

export function buildObservationChannels(
  world: WorldState,
  playerColonyId: ColonyId,
  aiColonyIds: readonly ColonyId[],
): {
  taskZone: SimAgentTaskZoneHistograms;
  opponent: SimAgentOpponentObservation;
  spatial: SimAgentSpatialPatches;
} {
  return {
    taskZone: buildPlayerTaskZoneHistograms(world, playerColonyId),
    opponent: buildOpponentObservation(world, playerColonyId, aiColonyIds),
    spatial: buildSpatialPatches(world, playerColonyId),
  };
}
