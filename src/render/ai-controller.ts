// src/render/ai-controller.ts
// Phase 9 / CMBT-01, CMBT-02, CMBT-03, CLNY-08 — rule-based AI controller.
// Location rationale: AI is a UI/render-layer decision-maker, not sim logic.
// The simulation has ONE code path for all colonies; AI differentiates at the CALLER
// (GameScene's onBeforeTick calls runAIController only for non-player colonyIds).

import type { WorldState } from '../sim/types.js';
import type { ColonyId, ColonyRecord } from '../sim/colony/colony-store.js';
import type {
  MarkDigTileCommand,
  PlaceChamberCommand,
  DesignateEntranceCommand,
  SetBehaviorRatioCommand,
} from '../sim/commands.js';
import { ChamberType } from '../sim/enums.js';
import { UndergroundTileState, ugGet } from '../sim/terrain.js';
import { FP_SHIFT } from '../sim/fixed.js';

export const AI_DIG_INTERVAL = 40 as const;       // every 2 seconds @ 20Hz
export const AI_DIG_MARK_BUDGET = 5 as const;
export const AI_QUEEN_CHAMBER_DEPTH = 10 as const;
export const AI_FOOD_STORAGE_THRESHOLD = 8 as const;
export const AI_NURSERY_THRESHOLD = 12 as const;

/**
 * Fixed AI behavior ratio per RESEARCH.md (0–10 scale).
 * AI is forage-leaning with meaningful dig + fight allocation.
 */
export const AI_BEHAVIOR_RATIO = { forage: 5, dig: 3, fight: 2 } as const;

/** Entry point — called by GameScene per-tick (via GameLoopOpts.onBeforeTick). */
export function runAIController(world: WorldState, aiColonyId: ColonyId): void {
  const colony = world.colonies[aiColonyId];
  if (colony === undefined || colony.defeated) return;

  aiInitialSetup(world, colony);
  aiDigHeuristic(world, colony);
  aiChamberPlacement(world, colony);
  aiEntranceDesignation(world, colony);
}

/**
 * CMBT-02: one-shot initialization on tick 0.
 * - Pushes SetBehaviorRatio with the fixed AI ratio.
 * - Pushes DesignateEntrance at the queen's surface tile (derived from queen position).
 */
export function aiInitialSetup(world: WorldState, colony: ColonyRecord): void {
  if (world.tick !== 0) return;

  // 1. Set fixed behavior ratio for AI (CMBT-02).
  const setRatioCmd: SetBehaviorRatioCommand = {
    type: 'SetBehaviorRatio',
    colonyId: colony.colonyId,
    ratio: { ...AI_BEHAVIOR_RATIO },
    issuedAtTick: world.tick,
  };
  world.commandQueue.push(setRatioCmd);

  // 2. Designate entrance at queen's surface tile.
  const queenTileX = world.ants.posX[colony.queenEntityId]! >> FP_SHIFT;
  // Queen Y is underground; the entrance is on the surface row directly above her column.
  const designateCmd: DesignateEntranceCommand = {
    type: 'DesignateEntrance',
    colonyId: colony.colonyId,
    surfaceTileX: queenTileX,
    surfaceTileY: 0,   // surface row
    issuedAtTick: world.tick,
  };
  world.commandQueue.push(designateCmd);
}

export function aiDigHeuristic(world: WorldState, colony: ColonyRecord): void {
  if (world.tick % AI_DIG_INTERVAL !== 0) return;
  // Find up to AI_DIG_MARK_BUDGET diggable Solid tiles adjacent to the colony's chambers.
  // Strategy:
  //   - Iterate colony.chambers to get seed positions (convert posX/posY from fixed-point to tiles).
  //   - For each chamber, check its 4 cardinal neighbors; if tile is Solid (diggable), issue MarkDigTile.
  //   - Stop after AI_DIG_MARK_BUDGET commands.
  //   - Deterministic ordering: iterate chambers by ascending (tileY, tileX); iterate neighbors N,E,S,W.
  let budget = AI_DIG_MARK_BUDGET;
  const chambersSorted = [...colony.chambers].sort((a, b) => {
    const ay = a.posY >> FP_SHIFT;
    const by = b.posY >> FP_SHIFT;
    if (ay !== by) return ay - by;
    return (a.posX >> FP_SHIFT) - (b.posX >> FP_SHIFT);
  });
  for (const ch of chambersSorted) {
    if (budget <= 0) break;
    const chTileX = ch.posX >> FP_SHIFT;
    const chTileY = ch.posY >> FP_SHIFT;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      if (budget <= 0) break;
      const tx = chTileX + dx;
      const ty = chTileY + dy;
      if (!isDirtTileUnderground(world, colony.colonyId, tx, ty)) continue;
      const cmd: MarkDigTileCommand = {
        type: 'MarkDigTile',
        colonyId: colony.colonyId,
        tileX: tx,
        tileY: ty,
        issuedAtTick: world.tick,
      };
      world.commandQueue.push(cmd);
      budget -= 1;
    }
  }
}

export function aiChamberPlacement(world: WorldState, colony: ColonyRecord): void {
  // Queen chamber — if missing, try to place near AI_QUEEN_CHAMBER_DEPTH
  if (!colony.chambers.some((c) => c.chamberType === ChamberType.Queen)) {
    const placement = findOpenChamberSpot(world, colony, AI_QUEEN_CHAMBER_DEPTH);
    if (placement !== null) {
      const cmd: PlaceChamberCommand = {
        type: 'PlaceChamber',
        colonyId: colony.colonyId,
        chamberType: ChamberType.Queen,
        anchorTileX: placement.tileX,
        anchorTileY: placement.tileY,
        issuedAtTick: world.tick,
      };
      world.commandQueue.push(cmd);
    }
  }
  // Food storage — if food stockpile crossed threshold and no FoodStorage yet
  if (
    colony.foodStored >= AI_FOOD_STORAGE_THRESHOLD
    && !colony.chambers.some((c) => c.chamberType === ChamberType.FoodStorage)
  ) {
    const placement = findOpenChamberSpot(world, colony, 5);  // near-surface storage
    if (placement !== null) {
      const cmd: PlaceChamberCommand = {
        type: 'PlaceChamber',
        colonyId: colony.colonyId,
        chamberType: ChamberType.FoodStorage,
        anchorTileX: placement.tileX,
        anchorTileY: placement.tileY,
        issuedAtTick: world.tick,
      };
      world.commandQueue.push(cmd);
    }
  }
  // Nursery — if population pressure and no Nursery yet
  if (
    (colony.eggCount + colony.larvaeCount) >= AI_NURSERY_THRESHOLD
    && !colony.chambers.some((c) => c.chamberType === ChamberType.Nursery)
  ) {
    const placement = findOpenChamberSpot(world, colony, 7);
    if (placement !== null) {
      const cmd: PlaceChamberCommand = {
        type: 'PlaceChamber',
        colonyId: colony.colonyId,
        chamberType: ChamberType.Nursery,
        anchorTileX: placement.tileX,
        anchorTileY: placement.tileY,
        issuedAtTick: world.tick,
      };
      world.commandQueue.push(cmd);
    }
  }
}

export function aiEntranceDesignation(world: WorldState, colony: ColonyRecord): void {
  if (colony.entrances.length > 0) return;
  // Recovery path: if somehow the tick-0 entrance didn't stick or was destroyed,
  // find a chamber near the surface and designate the surface tile above it.
  const surfaceEdgeY = 1;
  for (const ch of colony.chambers) {
    const chTileY = ch.posY >> FP_SHIFT;
    if (chTileY <= surfaceEdgeY + 2) {
      const cmd: DesignateEntranceCommand = {
        type: 'DesignateEntrance',
        colonyId: colony.colonyId,
        surfaceTileX: ch.posX >> FP_SHIFT,
        surfaceTileY: 0,
        issuedAtTick: world.tick,
      };
      world.commandQueue.push(cmd);
      return;
    }
  }
}

// --- Helpers ---

/**
 * True when (tx, ty) is within the AI's underground grid AND the tile is Solid (diggable dirt).
 * Handles missing grid and out-of-bounds defensively.
 */
function isDirtTileUnderground(
  world: WorldState,
  colonyId: ColonyId,
  tx: number,
  ty: number,
): boolean {
  const grid = world.undergroundGrids[colonyId];
  if (grid === undefined) return false;
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return false;
  return ugGet(grid, tx, ty) === UndergroundTileState.Solid;
}

/**
 * Spiral BFS from the queen's tile outward; returns the first Open tile whose |tileY - preferredDepth|
 * is smallest. Deterministic tiebreaker: lowest (tileY, tileX). No PRNG. Excludes tiles already
 * occupied by existing chambers. Returns null if no suitable Open tile exists within radius (32).
 *
 * Implementation notes:
 *   - Read queen tile: `world.ants.posX[colony.queenEntityId] >> FP_SHIFT` (and posY).
 *   - BFS over a bounded radius (e.g., 32 tiles) using a visited Set keyed by `ty * grid.width + tx`.
 *   - Collect all Open tiles found; pick the one minimizing |tileY - preferredDepth|,
 *     ties broken by (tileY, tileX) ascending.
 *   - Occupied check: a tile (tx, ty) is occupied if any chamber in colony.chambers has
 *     (ch.posX >> FP_SHIFT) === tx && (ch.posY >> FP_SHIFT) === ty (or within its width/height extent).
 *   - Return `{ tileX, tileY }` (tile coords, NOT fixed-point).
 */
function findOpenChamberSpot(
  world: WorldState,
  colony: ColonyRecord,
  preferredDepth: number,
): { tileX: number; tileY: number } | null {
  const grid = world.undergroundGrids[colony.colonyId];
  if (grid === undefined) return null;
  const queenTileX = world.ants.posX[colony.queenEntityId]! >> FP_SHIFT;
  const queenTileY = world.ants.posY[colony.queenEntityId]! >> FP_SHIFT;

  const RADIUS = 32;
  const occupied = new Set<number>();
  for (const ch of colony.chambers) {
    const chTX = ch.posX >> FP_SHIFT;
    const chTY = ch.posY >> FP_SHIFT;
    for (let oy = 0; oy < ch.height; oy++) {
      for (let ox = 0; ox < ch.width; ox++) {
        occupied.add((chTY + oy) * grid.width + (chTX + ox));
      }
    }
  }

  // BFS
  const visited = new Set<number>();
  const queue: Array<[number, number]> = [[queenTileX, queenTileY]];
  visited.add(queenTileY * grid.width + queenTileX);
  const candidates: Array<{ tileX: number; tileY: number }> = [];

  while (queue.length > 0) {
    const [tx, ty] = queue.shift()!;
    if (Math.abs(tx - queenTileX) > RADIUS || Math.abs(ty - queenTileY) > RADIUS) continue;
    if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;

    const key = ty * grid.width + tx;
    if (ugGet(grid, tx, ty) === UndergroundTileState.Open && !occupied.has(key)) {
      candidates.push({ tileX: tx, tileY: ty });
    }

    // Expand N,E,S,W deterministically.
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      const nkey = ny * grid.width + nx;
      if (visited.has(nkey)) continue;
      visited.add(nkey);
      queue.push([nx, ny]);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const da = Math.abs(a.tileY - preferredDepth);
    const db = Math.abs(b.tileY - preferredDepth);
    if (da !== db) return da - db;
    if (a.tileY !== b.tileY) return a.tileY - b.tileY;
    return a.tileX - b.tileX;
  });
  return candidates[0]!;
}
