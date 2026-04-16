// ant-store.ts — PRD §1 Structure-of-Arrays (SoA) ant component storage.
//
// 11 parallel Int32Array fields indexed by EntityId — one slot per entity.
// All arrays are allocated once in createAntComponents and NEVER reallocated
// during the simulation tick loop (zero per-tick allocation in the ant subsystem).
//
// Field layout (PRD §1 verbatim):
//   posX, posY           — fixed-point tile position (FP_ONE = 256)
//   colonyId             — owning colony entity ID
//   task                 — AntTask discriminant (raw int; caller may write AntTask.Foraging etc.)
//   subTask              — sub-state discriminant (ForagingSubState, NursingSubState, etc.)
//   speed                — movement speed in fixed-point units per tick
//   foodCarrying         — food units currently carried (fixed-point)
//   starvationTimer      — ticks since last fed (0 = not starving)
//   age                  — ticks alive
//   alive                — 1 = alive, 0 = dead/unused slot
//   lifespan             — ticks until natural death (WORKER_LIFESPAN_TICKS = INT32_MAX)
//
// Entity IDs are increment-only per PRD §1/§3 — no recycling, no swap-remove here.
// Swap-remove / colony-bucket management is Plan 03.

import type { EntityId } from '../types.js';
import { AntTask } from '../enums.js';
import {
  MAX_ENTITIES,
  WORKER_BASE_SPEED,
  WORKER_LIFESPAN_TICKS,
} from '../constants.js';

// ---------------------------------------------------------------------------
// AntComponents SoA interface (PRD §1 verbatim)
// ---------------------------------------------------------------------------

export interface AntComponents {
  readonly posX:            Int32Array;
  readonly posY:            Int32Array;
  readonly colonyId:        Int32Array;
  readonly task:            Int32Array;
  readonly subTask:         Int32Array;
  readonly speed:           Int32Array;
  readonly foodCarrying:    Int32Array;
  readonly starvationTimer: Int32Array;
  readonly age:             Int32Array;
  readonly alive:           Int32Array;
  readonly lifespan:        Int32Array;
}

// ---------------------------------------------------------------------------
// Factory — allocates all 11 arrays once; zero per-tick allocation guaranteed
// ---------------------------------------------------------------------------

/**
 * Allocate 11 parallel Int32Arrays of length `maxEntities`.
 * All slots are zero-initialized by the TypedArray spec.
 * Call once at world creation — do NOT call again per tick.
 *
 * @param maxEntities - Number of entity slots to allocate. Defaults to MAX_ENTITIES (8192).
 */
export function createAntComponents(maxEntities: number = MAX_ENTITIES): AntComponents {
  return {
    posX:            new Int32Array(maxEntities),
    posY:            new Int32Array(maxEntities),
    colonyId:        new Int32Array(maxEntities),
    task:            new Int32Array(maxEntities),
    subTask:         new Int32Array(maxEntities),
    speed:           new Int32Array(maxEntities),
    foodCarrying:    new Int32Array(maxEntities),
    starvationTimer: new Int32Array(maxEntities),
    age:             new Int32Array(maxEntities),
    alive:           new Int32Array(maxEntities),
    lifespan:        new Int32Array(maxEntities),
  };
}

// ---------------------------------------------------------------------------
// InitAntSpec — initialization spec for a single ant entity
// ---------------------------------------------------------------------------

/**
 * Spec passed to initAnt. Required fields: colonyId, posX, posY.
 * Optional fields default to simulation baseline values if omitted.
 */
export interface InitAntSpec {
  colonyId: number;
  posX:     number;
  posY:     number;
  /** Raw task discriminant. Defaults to AntTask.Idle (0). */
  task?:    number;
  /** Raw sub-task discriminant. Defaults to 0. */
  subTask?: number;
  /** Fixed-point speed. Defaults to WORKER_BASE_SPEED (128 = 0.5 × FP_ONE). */
  speed?:   number;
  /** Fixed-point lifespan ticks. Defaults to WORKER_LIFESPAN_TICKS (INT32_MAX). */
  lifespan?: number;
}

// ---------------------------------------------------------------------------
// Lifecycle helpers — O(1), no allocation
// ---------------------------------------------------------------------------

/**
 * Initialize entity slot `id` with the given spec.
 * Sets alive=1, age=0, foodCarrying=0, starvationTimer=0.
 * Calling twice on the same id overwrites (no accumulation).
 */
export function initAnt(ants: AntComponents, id: EntityId, spec: InitAntSpec): void {
  ants.colonyId[id]        = spec.colonyId;
  ants.posX[id]            = spec.posX;
  ants.posY[id]            = spec.posY;
  ants.task[id]            = spec.task     !== undefined ? spec.task     : AntTask.Idle;
  ants.subTask[id]         = spec.subTask  !== undefined ? spec.subTask  : 0;
  ants.speed[id]           = spec.speed    !== undefined ? spec.speed    : WORKER_BASE_SPEED;
  ants.lifespan[id]        = spec.lifespan !== undefined ? spec.lifespan : WORKER_LIFESPAN_TICKS;
  ants.alive[id]           = 1;
  ants.age[id]             = 0;
  ants.foodCarrying[id]    = 0;
  ants.starvationTimer[id] = 0;
}

/**
 * Mark entity `id` as dead. O(1) — no array mutation, no swap-remove.
 * The colony-bucket system (Plan 03) handles slot reuse.
 */
export function killAnt(ants: AntComponents, id: EntityId): void {
  ants.alive[id] = 0;
}

/**
 * Returns true if the entity at `id` is currently alive.
 * Returns false for never-initialized slots (alive[id] === 0 by default).
 */
export function isAlive(ants: AntComponents, id: EntityId): boolean {
  return ants.alive[id] === 1;
}
