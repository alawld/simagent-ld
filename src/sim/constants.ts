// constants.ts — Phase 2 PRD §9c balance parameters for src/sim/
//
// All values are numeric literals or plain object literals — no imports, no computed values,
// no float division, no Math.* calls. FP unit comments reference FP_ONE=256 (FP_SHIFT=8)
// from fixed.ts for documentation purposes only; this file is a pure leaf dependency.
//
// To update a balance constant, change the literal here — the test in constants.test.ts
// will catch any drift from the PRD §9c table.

// ---------------------------------------------------------------------------
// Lifecycle ticks (PRD §9c)
// ---------------------------------------------------------------------------

/** PRD §9c — Ticks for an egg to hatch into a larva. */
export const EGG_HATCH_TICKS = 1200;

/** PRD §9c — Ticks for a larva to mature into a worker. */
export const LARVA_MATURE_TICKS = 2400;

/** PRD §9c — Worker lifespan: effectively immortal (INT32_MAX ticks). */
export const WORKER_LIFESPAN_TICKS = 0x7FFFFFFF;

/** PRD §9c — Ticks between queen egg-laying events. */
export const QUEEN_EGG_INTERVAL_TICKS = 300;

/** PRD §9c — Minimum food units (fp) the colony must hold for queen to lay. */
export const QUEEN_EGG_FOOD_THRESHOLD = 768; // 3 × FP_ONE

/** PRD §9c — Ticks an ant can survive with no food before dying. */
export const STARVATION_GRACE_TICKS = 100;

/** PRD §9c — Ticks between colony-level food reconcile sweeps. */
export const RECONCILE_INTERVAL_TICKS = 100;

/** PRD §9c — Expected ticks for a forager round-trip (used for ratio calc). */
export const FORAGER_ROUND_TRIP_TICKS = 200;

// ---------------------------------------------------------------------------
// Food economy — fixed-point units (PRD §9c)
// FP_ONE = 256; values in comments show the human-readable quantity.
// ---------------------------------------------------------------------------

/** PRD §9c — Food units consumed by the queen per tick. */
export const QUEEN_FOOD_PER_TICK = 2;

/** PRD §9c — Food units consumed by a larva per tick. */
export const LARVA_FOOD_PER_TICK = 1;

/** PRD §9c — Food units consumed by a worker per tick (workers self-forage). */
export const WORKER_FOOD_PER_TICK = 0;

/** PRD §9c — Maximum food units (fp) a worker can carry. 1024 = 4 × FP_ONE. */
export const WORKER_CARRY_CAPACITY = 1024; // 4 × FP_ONE

/** PRD §9c — Food units (fp) picked up per forager visit to a food source. 512 = 2 × FP_ONE. */
export const FOOD_PICKUP_AMOUNT = 512; // 2 × FP_ONE

/** PRD §9c — Maximum food units (fp) in the colony food chamber. 5120 = 20 × FP_ONE. */
export const FOOD_CHAMBER_CAPACITY = 5120; // 20 × FP_ONE

/** PRD §9c — Base movement speed of a worker in fixed-point units per tick. 128 = 0.5 × FP_ONE. */
export const WORKER_BASE_SPEED = 128; // 0.5 × FP_ONE

// ---------------------------------------------------------------------------
// Pheromone parameters (PRD §9c / §5)
// ---------------------------------------------------------------------------

/** PRD §9c — Fixed-point decay rate applied to food-trail pheromone per tick. */
export const PHEROMONE_DECAY_FP = 5;

/** PRD §9c — Fixed-point decay rate applied to danger-trail pheromone per tick. */
export const DANGER_DECAY_FP = 10;

/** PRD §9c — Minimum pheromone value before cell resets to 0 (floor). */
export const PHEROMONE_FLOOR = 64;

/** PRD §9c — Maximum pheromone value a cell can hold (cap). */
export const PHEROMONE_CAP = 65280;

/** PRD §9c — Food-trail pheromone deposited per forager step. 512 = 2 × FP_ONE. */
export const FOOD_TRAIL_DEPOSIT = 512; // 2 × FP_ONE

/** PRD §9c — Percentage of ants that choose random explore over pheromone gradient. */
export const EXPLORE_RATE_PERCENT = 10;

// ---------------------------------------------------------------------------
// Allocation ratios (PRD §9c / §7)
// ---------------------------------------------------------------------------

/** PRD §9c — Ratio of foragers assigned as nurses: 1 nurse per NURSE_RATIO foragers. */
export const NURSE_RATIO = 3;

// ---------------------------------------------------------------------------
// Entity budget (PRD §9c)
// ---------------------------------------------------------------------------

/** PRD §9c — Maximum active entity count in the simulation. */
export const MAX_ENTITIES = 8192;

// ---------------------------------------------------------------------------
// Grid dimensions (PRD §9c)
// ---------------------------------------------------------------------------

/** PRD §9c — Width of the surface pheromone grid in tiles. */
export const SURFACE_GRID_WIDTH = 128;

/** PRD §9c — Height of the surface pheromone grid in tiles. */
export const SURFACE_GRID_HEIGHT = 128;

/** PRD §9c — Width of the underground pheromone grid in tiles. */
export const UNDERGROUND_GRID_WIDTH = 128;

/** PRD §9c — Height of the underground pheromone grid in tiles. */
export const UNDERGROUND_GRID_HEIGHT = 64;

// ---------------------------------------------------------------------------
// Default behavior ratio (PRD §7, §2)
// ---------------------------------------------------------------------------

/**
 * PRD §7 §2 — Default task distribution triangle: forage 100%, dig 0%, fight 0%.
 * Values are percentages summing to 10 (internal scale: 10 = 100%).
 */
export const DEFAULT_BEHAVIOR_RATIO = {
  forage: 10,
  dig:    0,
  fight:  0,
} as const;
