// colony-store.ts — PRD §2 ColonyRecord schema and factories
//
// Canonical per-colony record shape: every downstream system (reconcile, lifecycle,
// food economy, HUD) reads and writes fields defined here.
//
// Data-only module: no tick logic, no mutation helpers, no lifecycle transitions.
// Reconcile pass lives in Plan 09; lifecycle transitions in Plan 08.
//
// ADR-0006: plain object invariant — no Map/Set anywhere.
// Node --experimental-strip-types compatible: no const enum.

import type { EntityId } from '../types.js';
import type { ChamberType } from '../enums.js';
import {
  DEFAULT_BEHAVIOR_RATIO,
  STARVATION_GRACE_TICKS,
  RECONCILE_INTERVAL_TICKS,
} from '../constants.js';

// ---------------------------------------------------------------------------
// ColonyId — controller-agnostic integer alias (PRD §2 line 234)
// Never branched on; purely a readability tag on numeric IDs.
// ---------------------------------------------------------------------------

export type ColonyId = number;

// ---------------------------------------------------------------------------
// WorkerAllocation — per-task worker counts (PRD §2)
//
// Used for both computedAllocation (target per-task counts, derived by
// the reconcile pass from targetRatio × workerCount) and taskCensus
// (actual per-task counts written at the end of PRD §8a step 9).
//
// 4 fields exactly: nurse, forage, dig, fight.
// There is no idle-count field — PRD §8a step 9 reassigns every surviving
// idle worker into one of these 4 target tasks before writing taskCensus;
// idle is a transient step-9-internal state, never a cached colony-level count.
// ---------------------------------------------------------------------------

export interface WorkerAllocation {
  nurse:  number;
  forage: number;
  dig:    number;
  fight:  number;
}

// ---------------------------------------------------------------------------
// BehaviorRatio — player-controlled task distribution triangle (PRD §2)
//
// Three fields: forage, dig, fight. Values are percentages on an internal
// scale of 0–10 (10 = 100%). The nurse task is computed from workerCount
// and is not directly player-controlled.
// ---------------------------------------------------------------------------

export interface BehaviorRatio {
  forage: number;
  dig:    number;
  fight:  number;
}

// ---------------------------------------------------------------------------
// ChamberRecord — single underground chamber (PRD §2)
//
// All fields are integers (no floats — fixed-point architecture principle).
// chamberType is a ChamberType object-const value (0 | 1 | 2).
// ---------------------------------------------------------------------------

export interface ChamberRecord {
  chamberId:   EntityId;
  chamberType: ChamberType;
  foodStored:  number;
  posX:        number;
  posY:        number;
  width:       number;
  height:      number;
}

// ---------------------------------------------------------------------------
// ColonyRecord — canonical per-colony state (PRD §2)
//
// Exactly 17 fields — verbatim from PRD §2. No additions.
//
// Field inventory:
//   colonyId, queenEntityId, queenStarvationTimer, foodStored,
//   workerCount, eggCount, larvaeCount, nurseCount,
//   eggs, larvae, workers, chambers,
//   targetRatio, computedAllocation, taskCensus,
//   defeated, reconcileCountdown
// ---------------------------------------------------------------------------

export interface ColonyRecord {
  colonyId:              ColonyId;
  queenEntityId:         EntityId;
  queenStarvationTimer:  number;
  foodStored:            number;
  workerCount:           number;
  eggCount:              number;
  larvaeCount:           number;
  nurseCount:            number;
  eggs:                  EntityId[];
  larvae:                EntityId[];
  workers:               EntityId[];
  chambers:              ChamberRecord[];
  targetRatio:           BehaviorRatio;
  computedAllocation:    WorkerAllocation;
  /**
   * Per-task worker counts written at the end of PRD §8a step 9 (Plan 10). Invariants:
   *   (1) Every field is non-negative: `taskCensus.{nurse,forage,dig,fight} >= 0`.
   *   (2) Sum is bounded by workerCount: `nurse + forage + dig + fight === workerCount - (ants whose task is AntTask.Idle post-step-9)`. In Phase 6 steady state step 9 reassigns every idle-checkpoint ant, so the sum equals `workerCount` once all eligible idle ants have been rehomed.
   * Step 9 writes this field after reconciling actual-per-task counters against `computedAllocation`; see Plan 10 Test 14b for the regression guard.
   */
  taskCensus:            WorkerAllocation;
  defeated:              boolean;
  reconcileCountdown:    number;
}

// ---------------------------------------------------------------------------
// createColonyRecord — factory producing a fresh ColonyRecord (PRD §2 line 455)
//
// Default values:
//   - foodStored=0, workerCount=0, eggCount=0, larvaeCount=0, nurseCount=0
//   - eggs/larvae/workers/chambers: empty arrays (fresh per call)
//   - targetRatio: spread of DEFAULT_BEHAVIOR_RATIO (independent object per colony)
//   - computedAllocation: {nurse:0, forage:0, dig:0, fight:0} (fresh object)
//   - taskCensus:         {nurse:0, forage:0, dig:0, fight:0} (fresh object)
//   - defeated: false
//   - queenStarvationTimer: STARVATION_GRACE_TICKS (100)
//   - reconcileCountdown:   RECONCILE_INTERVAL_TICKS (100)
//
// Each call returns independent objects — mutations on one colony do not
// leak to another through shared references.
// ---------------------------------------------------------------------------

export function createColonyRecord(colonyId: ColonyId, queenEntityId: EntityId): ColonyRecord {
  return {
    colonyId,
    queenEntityId,
    queenStarvationTimer:  STARVATION_GRACE_TICKS,
    foodStored:            0,
    workerCount:           0,
    eggCount:              0,
    larvaeCount:           0,
    nurseCount:            0,
    eggs:                  [],
    larvae:                [],
    workers:               [],
    chambers:              [],
    targetRatio:           { ...DEFAULT_BEHAVIOR_RATIO },
    computedAllocation:    { nurse: 0, forage: 0, dig: 0, fight: 0 },
    taskCensus:            { nurse: 0, forage: 0, dig: 0, fight: 0 },
    defeated:              false,
    reconcileCountdown:    RECONCILE_INTERVAL_TICKS,
  };
}

// ---------------------------------------------------------------------------
// createColonyStore — produce an empty colony registry (ADR-0006)
//
// Returns a plain object (Record<ColonyId, ColonyRecord>) — JSON-serializable,
// never a Map. Assign colony records by integer key: store[colonyId] = record.
// ---------------------------------------------------------------------------

export function createColonyStore(): Record<ColonyId, ColonyRecord> {
  return {};
}
