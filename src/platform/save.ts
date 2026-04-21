// src/platform/save.ts
// Phase 9 / SCEN-04 + SCEN-06 — browser-localStorage session persistence.
// Envelope shape (PRD §8a, 04-PRD-playable-game-loop.md):
//   SaveFile = { version, seed, inputLog, snapshot }
// Strict rules:
//   1. ALL TypedArrays serialized via Array.from (JSON.stringify emits "{}" for TAs — Pitfall 2)
//   2. commandQueue IS preserved in snapshot (Pitfall 7 — autosave fires wall-clock, not tick boundary)
//   3. seed + inputLog preserved at envelope top-level (SCEN-06 replay truth)
//   4. ViewState (PRD §8e) is OUT OF SCOPE — only pure WorldState fields
//   5. colonies / undergroundGrids / pendingChambers / pheromoneGrids are PLAIN OBJECTS (ADR-0006)
//      Iterate via Object.entries — NEVER Array.from(world.colonies.entries()) [there is no .entries()]
//   6. Version-gated: bumping SAVE_FORMAT_VERSION invalidates old saves (intentional for beta)

import type { WorldState, EntityId } from '../sim/types.js';
import type { AntComponents } from '../sim/ant/ant-store.js';
import { createAntComponents } from '../sim/ant/ant-store.js';
import type {
  ColonyId, ColonyRecord, WorkerAllocation, BehaviorRatio, ChamberRecord,
} from '../sim/colony/colony-store.js';
import { createColonyRecord } from '../sim/colony/colony-store.js';
import type { NestEntrance } from '../sim/colony/entrance.js';
import type { PendingChamber } from '../sim/colony/chamber.js';
import type { SimCommand } from '../sim/commands.js';
import type { SurfaceGrid, UndergroundGrid } from '../sim/terrain.js';
import { createSurfaceGrid, createUndergroundGrid } from '../sim/terrain.js';
import type { PheromoneGrid } from '../sim/pheromone/pheromone-store.js';
import { createPheromoneGrid } from '../sim/pheromone/pheromone-store.js';
import type { FoodPile, FoodPileId } from '../sim/food.js';
import { MAX_ENTITIES } from '../sim/constants.js';

export const SAVE_FORMAT_VERSION = 1 as const;
export const SAVE_KEY = 'subterrans:save:v1' as const;
export const AUTOSAVE_INTERVAL_MS = 30_000 as const;

export class SaveVersionMismatchError extends Error {
  constructor(public expected: number, public got: number) {
    super(`Save format version mismatch: expected ${expected}, got ${got}`);
    this.name = 'SaveVersionMismatchError';
  }
}

// ---------------------------------------------------------------------------
// SerializedWorldState — JSON-safe shape of WorldState.
// Mirrors WorldState exactly; typed arrays become number[]; plain-object
// Records become { [stringKey]: ... } and are iterated with Object.entries.
// ---------------------------------------------------------------------------

interface SerializedAnts {
  count: number;   // we persist capacity = MAX_ENTITIES; no separate count field exists on AntComponents
  // All 18 Int32Array fields as plain number[]:
  posX: number[]; posY: number[]; colonyId: number[];
  task: number[]; subTask: number[]; speed: number[];
  foodCarrying: number[]; starvationTimer: number[];
  age: number[]; alive: number[]; lifespan: number[];
  zone: number[];
  digTileX: number[]; digTileY: number[]; digTicksRemaining: number[];
  targetPosX: number[]; targetPosY: number[];
  // Phase 9 / 09 digger-reassignment memo — per-ant SearchingFood leash wave.
  // Optional for backward compatibility with pre-Phase-9 saves; deserializer
  // treats absent as zero-init (base wave).
  searchWave?: number[];
}

interface SerializedColony {
  colonyId: ColonyId; queenEntityId: EntityId; queenStarvationTimer: number;
  foodStored: number; workerCount: number; eggCount: number; larvaeCount: number; nurseCount: number;
  eggs: EntityId[]; larvae: EntityId[]; workers: EntityId[];
  chambers: ChamberRecord[];
  targetRatio: BehaviorRatio;
  computedAllocation: WorkerAllocation;
  taskCensus: WorkerAllocation;
  defeated: boolean; reconcileCountdown: number;
  entrances: NestEntrance[];
  rallyPoint: { tileX: number; tileY: number } | null;
  digFlowFieldDirty: boolean;
  killCount: number;   // Plan 09-01
  priorityFoodPileId: FoodPileId | null;  // Phase 9 / PRD §3d — per-colony priority food target
}

interface SerializedGrid { width: number; height: number; data: number[] }

export interface SerializedWorldState {
  tick: number;
  rngState: number;
  nextEntityId: number;
  commandQueue: SimCommand[];  // plain-object spread is sufficient (ADR-0006)
  ants: SerializedAnts;
  colonies: Record<string, SerializedColony>;       // keys are ColonyId.toString()
  pheromoneGrids: Record<string, SerializedGrid>;
  surface: SerializedGrid;
  undergroundGrids: Record<string, SerializedGrid>; // keys are ColonyId.toString()
  foodPiles: FoodPile[];
  pendingChambers: Record<string, PendingChamber>;
}

// ---------------------------------------------------------------------------
// SaveFile envelope — PRD §8a normative shape
// ---------------------------------------------------------------------------

export interface SaveFile {
  readonly version: number;
  readonly seed: number;
  readonly inputLog: SimCommand[];
  readonly snapshot: SerializedWorldState;
}

// ---------------------------------------------------------------------------
// Serialize helpers
// ---------------------------------------------------------------------------

function serializeAnts(a: AntComponents): SerializedAnts {
  // Persist the full array (MAX_ENTITIES length). The deserializer allocates the
  // same size, so unused slots (alive=0) round-trip faithfully.
  return {
    count: a.alive.length,
    posX:              Array.from(a.posX),
    posY:              Array.from(a.posY),
    colonyId:          Array.from(a.colonyId),
    task:              Array.from(a.task),
    subTask:           Array.from(a.subTask),
    speed:             Array.from(a.speed),
    foodCarrying:      Array.from(a.foodCarrying),
    starvationTimer:   Array.from(a.starvationTimer),
    age:               Array.from(a.age),
    alive:             Array.from(a.alive),
    lifespan:          Array.from(a.lifespan),
    zone:              Array.from(a.zone),
    digTileX:          Array.from(a.digTileX),
    digTileY:          Array.from(a.digTileY),
    digTicksRemaining: Array.from(a.digTicksRemaining),
    targetPosX:        Array.from(a.targetPosX),
    targetPosY:        Array.from(a.targetPosY),
    searchWave:        Array.from(a.searchWave),
  };
}

function serializeColony(c: ColonyRecord): SerializedColony {
  return {
    colonyId:             c.colonyId,
    queenEntityId:        c.queenEntityId,
    queenStarvationTimer: c.queenStarvationTimer,
    foodStored:           c.foodStored,
    workerCount:          c.workerCount,
    eggCount:             c.eggCount,
    larvaeCount:          c.larvaeCount,
    nurseCount:           c.nurseCount,
    eggs:                 [...c.eggs],
    larvae:               [...c.larvae],
    workers:              [...c.workers],
    chambers:             c.chambers.map((ch) => ({ ...ch })),
    targetRatio:          { ...c.targetRatio },
    computedAllocation:   { ...c.computedAllocation },
    taskCensus:           { ...c.taskCensus },
    defeated:             c.defeated,
    reconcileCountdown:   c.reconcileCountdown,
    entrances:            c.entrances.map((e) => ({ ...e })),
    rallyPoint:           c.rallyPoint === null ? null : { ...c.rallyPoint },
    digFlowFieldDirty:    c.digFlowFieldDirty,
    killCount:            c.killCount,
    priorityFoodPileId:   c.priorityFoodPileId,
  };
}

function serializeSurfaceGrid(g: SurfaceGrid): SerializedGrid {
  return { width: g.width, height: g.height, data: Array.from(g.data) };
}
function serializeUndergroundGrid(g: UndergroundGrid): SerializedGrid {
  return { width: g.width, height: g.height, data: Array.from(g.data) };
}
function serializePheromoneGrid(g: PheromoneGrid): SerializedGrid {
  return { width: g.width, height: g.height, data: Array.from(g.data) };
}

export function serializeWorldState(world: WorldState): SerializedWorldState {
  // ADR-0006: colonies is a PLAIN OBJECT. Use Object.entries — NOT Array.from(world.colonies.entries())
  const coloniesOut: Record<string, SerializedColony> = {};
  for (const [cidStr, rec] of Object.entries(world.colonies)) {
    coloniesOut[cidStr] = serializeColony(rec);
  }
  const undergroundOut: Record<string, SerializedGrid> = {};
  for (const [cidStr, grid] of Object.entries(world.undergroundGrids)) {
    undergroundOut[cidStr] = serializeUndergroundGrid(grid);
  }
  const pheromoneOut: Record<string, SerializedGrid> = {};
  for (const [key, grid] of Object.entries(world.pheromoneGrids)) {
    pheromoneOut[key] = serializePheromoneGrid(grid);
  }
  const pendingOut: Record<string, PendingChamber> = {};
  for (const [key, pc] of Object.entries(world.pendingChambers)) {
    pendingOut[key] = { ...pc };
  }

  return {
    tick: world.tick,
    rngState: world.rngState,
    nextEntityId: world.nextEntityId,
    commandQueue: world.commandQueue.map((c) => ({ ...c })),  // Pitfall 7 — preserve
    ants: serializeAnts(world.ants),
    colonies: coloniesOut,
    pheromoneGrids: pheromoneOut,
    surface: serializeSurfaceGrid(world.surface),
    undergroundGrids: undergroundOut,
    foodPiles: world.foodPiles.map((p) => ({ ...p })),
    pendingChambers: pendingOut,
  };
}

// ---------------------------------------------------------------------------
// Deserialize helpers
// ---------------------------------------------------------------------------

function copyIntoInt32(dst: Int32Array, src: readonly number[]): void {
  const n = src.length < dst.length ? src.length : dst.length;
  for (let i = 0; i < n; i++) dst[i] = src[i]!;
}

function deserializeAnts(saved: SerializedAnts, capacity: number): AntComponents {
  const a = createAntComponents(capacity);
  // createAntComponents pre-fills digTileX/digTileY/targetPosX/targetPosY with -1.
  // Overwrite with saved values (including -1 sentinels where appropriate).
  copyIntoInt32(a.posX, saved.posX);
  copyIntoInt32(a.posY, saved.posY);
  copyIntoInt32(a.colonyId, saved.colonyId);
  copyIntoInt32(a.task, saved.task);
  copyIntoInt32(a.subTask, saved.subTask);
  copyIntoInt32(a.speed, saved.speed);
  copyIntoInt32(a.foodCarrying, saved.foodCarrying);
  copyIntoInt32(a.starvationTimer, saved.starvationTimer);
  copyIntoInt32(a.age, saved.age);
  copyIntoInt32(a.alive, saved.alive);
  copyIntoInt32(a.lifespan, saved.lifespan);
  copyIntoInt32(a.zone, saved.zone);
  copyIntoInt32(a.digTileX, saved.digTileX);
  copyIntoInt32(a.digTileY, saved.digTileY);
  copyIntoInt32(a.digTicksRemaining, saved.digTicksRemaining);
  copyIntoInt32(a.targetPosX, saved.targetPosX);
  copyIntoInt32(a.targetPosY, saved.targetPosY);
  // Phase 9: pre-Phase-9 saves omit searchWave — createAntComponents already
  // zero-initialized the field (base wave), so skip the copy when absent.
  if (saved.searchWave !== undefined) {
    copyIntoInt32(a.searchWave, saved.searchWave);
  }
  return a;
}

function deserializeColony(s: SerializedColony): ColonyRecord {
  const c = createColonyRecord(s.colonyId, s.queenEntityId);
  // createColonyRecord does NOT set the 3 Phase 3 extension fields — caller-side contract
  // (colony-store.ts comment). Set them explicitly alongside scalar fields.
  c.queenStarvationTimer = s.queenStarvationTimer;
  c.foodStored           = s.foodStored;
  c.workerCount          = s.workerCount;
  c.eggCount             = s.eggCount;
  c.larvaeCount          = s.larvaeCount;
  c.nurseCount           = s.nurseCount;
  c.eggs                 = [...s.eggs];
  c.larvae               = [...s.larvae];
  c.workers              = [...s.workers];
  c.chambers             = s.chambers.map((ch) => ({ ...ch }));
  c.targetRatio          = { ...s.targetRatio };
  c.computedAllocation   = { ...s.computedAllocation };
  c.taskCensus           = { ...s.taskCensus };
  c.defeated             = s.defeated;
  c.reconcileCountdown   = s.reconcileCountdown;
  c.entrances            = s.entrances.map((e) => ({ ...e }));
  c.rallyPoint           = s.rallyPoint === null ? null : { ...s.rallyPoint };
  c.digFlowFieldDirty    = s.digFlowFieldDirty;
  c.killCount            = s.killCount;
  c.priorityFoodPileId   = s.priorityFoodPileId ?? null;
  return c;
}

function deserializeSurfaceGrid(s: SerializedGrid): SurfaceGrid {
  const g = createSurfaceGrid(s.width, s.height);
  g.data.set(s.data);
  return g;
}
function deserializeUndergroundGrid(s: SerializedGrid): UndergroundGrid {
  const g = createUndergroundGrid(s.width, s.height);
  g.data.set(s.data);
  return g;
}
function deserializePheromoneGrid(s: SerializedGrid): PheromoneGrid {
  const g = createPheromoneGrid(s.width, s.height);
  g.data.set(s.data);
  return g;
}

export function deserializeWorldState(s: SerializedWorldState): WorldState {
  const capacity = s.ants.count > 0 ? s.ants.count : MAX_ENTITIES;
  const colonies: Record<ColonyId, ColonyRecord> = {};
  for (const [cidStr, sc] of Object.entries(s.colonies)) {
    colonies[Number(cidStr) as ColonyId] = deserializeColony(sc);
  }
  const undergroundGrids: Record<ColonyId, UndergroundGrid> = {};
  for (const [cidStr, sg] of Object.entries(s.undergroundGrids)) {
    undergroundGrids[Number(cidStr) as ColonyId] = deserializeUndergroundGrid(sg);
  }
  const pheromoneGrids: Record<string, PheromoneGrid> = {};
  for (const [key, sg] of Object.entries(s.pheromoneGrids)) {
    pheromoneGrids[key] = deserializePheromoneGrid(sg);
  }
  const pendingChambers: Record<string, PendingChamber> = {};
  for (const [key, pc] of Object.entries(s.pendingChambers)) {
    pendingChambers[key] = { ...pc };
  }

  return {
    tick: s.tick,
    rngState: s.rngState,
    nextEntityId: s.nextEntityId,
    commandQueue: s.commandQueue.map((c) => ({ ...c })),  // preserve unprocessed commands
    ants: deserializeAnts(s.ants, capacity),
    colonies,
    pheromoneGrids,
    surface: deserializeSurfaceGrid(s.surface),
    undergroundGrids,
    foodPiles: s.foodPiles.map((p) => ({ ...p })),
    pendingChambers,
  };
}

// ---------------------------------------------------------------------------
// Envelope + localStorage API
// ---------------------------------------------------------------------------

function buildSaveFile(seed: number, inputLog: readonly SimCommand[], world: WorldState): SaveFile {
  return {
    version: SAVE_FORMAT_VERSION,
    seed: seed | 0,
    inputLog: inputLog.map((c) => ({ ...c })),
    snapshot: serializeWorldState(world),
  };
}

function parseSaveFile(raw: string): SaveFile {
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'number') {
    throw new SaveVersionMismatchError(SAVE_FORMAT_VERSION, NaN);
  }
  if (parsed.version !== SAVE_FORMAT_VERSION) {
    throw new SaveVersionMismatchError(SAVE_FORMAT_VERSION, parsed.version);
  }
  return parsed as SaveFile;
}

export function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw === null) return false;
    parseSaveFile(raw);
    return true;
  } catch {
    return false;
  }
}

export function loadSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw === null) return null;
    return parseSaveFile(raw);
  } catch {
    return null;
  }
}

export function deleteSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // swallow — quota / private-mode errors are non-fatal for delete
  }
}

/**
 * Autosave gate. Returns the new lastSaveMs value:
 *   - interval not elapsed → returns lastSaveMs unchanged, no write
 *   - elapsed + setItem success → returns nowMs
 *   - elapsed + setItem throw (quota) → returns lastSaveMs unchanged (retry next interval)
 *
 * Caller reassigns: `lastSaveMs = tickAutosave(seed, inputLog, world, lastSaveMs, now);`
 */
export function tickAutosave(
  seed: number,
  inputLog: readonly SimCommand[],
  world: WorldState,
  lastSaveMs: number,
  nowMs: number,
): number {
  if (nowMs - lastSaveMs < AUTOSAVE_INTERVAL_MS) return lastSaveMs;
  try {
    const envelope = buildSaveFile(seed, inputLog, world);
    localStorage.setItem(SAVE_KEY, JSON.stringify(envelope));
    return nowMs;
  } catch {
    return lastSaveMs;
  }
}
