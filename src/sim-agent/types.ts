// Headless agent harness — typed observation / step contract (SimAgentPlan Phase A + B1).
import type { SimCommand } from '../sim/commands.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import type { GameOutcome } from '../sim/game-over.js';
import type {
  SimAgentOpponentObservation,
  SimAgentSpatialPatches,
  SimAgentTaskZoneHistograms,
} from './observation-channels.js';

export type {
  SimAgentOpponentObservation,
  SimAgentSpatialPatches,
  SimAgentTaskZoneHistograms,
} from './observation-channels.js';

/** Commands accepted from JSON/agents — `issuedAtTick` is stamped by the harness. */
export type AgentSimCommand = SimCommand extends infer C
  ? C extends SimCommand
    ? Omit<C, 'issuedAtTick'>
    : never
  : never;

/** Bump when observation shape or semantics change (SimAgentPlan §3). */
export const SIM_AGENT_OBSERVATION_VERSION = 3 as const;

/** v2 — cheap counts for trainers (mirrors `computeAffordances` in `src/sim/command-applicability.ts`). */
export interface SimAgentAffordances {
  playerMarkedDigTileCount: number;
  foodPileCount: number;
  playerEntranceCount: number;
}

export type OpponentMode = 'none' | 'ai';

export interface SimAgentHarnessConfig {
  seed: number;
  /** Curriculum / scenario label for schedulers (default: `default`). */
  scenarioId?: string;
  /** Defaults to player colony in `createScenario`. */
  playerColonyId?: ColonyId;
  opponentMode?: OpponentMode;
  /** When true, drained commands each tick are appended (SCEN-06 replay shape). Default true. */
  recordInputLog?: boolean;
}

export interface SimAgentStepOptions {
  commands?: readonly AgentSimCommand[];
  /** Run this many ticks; only the first tick receives `commands` from this call. Default 1. */
  repeatTicks?: number;
}

/** Phase B1 scalar channel — player colony only. */
export interface SimAgentObservationScalars {
  foodTotal: number;
  workerCount: number;
  queenAlive: boolean;
  targetRatio: { forage: number; fight: number };
  rallyActive: boolean;
  entranceCount: number;
  defeated: boolean;
}

export interface SimAgentObservation {
  observationVersion: typeof SIM_AGENT_OBSERVATION_VERSION;
  scenarioId: string;
  tick: number;
  scalars: SimAgentObservationScalars;
  affordances: SimAgentAffordances;
  /** B2 — per-task / per-zone counts for alive player-colony ants. */
  taskZone: SimAgentTaskZoneHistograms;
  /** B4 — coarse multi-enemy summary (uses harness AI colony list). */
  opponent: SimAgentOpponentObservation;
  /** B3 — fixed 4×4 terrain windows around rally/entrance / queen or shaft focal. */
  spatial: SimAgentSpatialPatches;
}

export interface SimAgentStepResult {
  tick: number;
  outcome: GameOutcome;
  /** True when `outcome` is not `None`. */
  terminal: boolean;
  observation: SimAgentObservation;
  /** Commands passed to `tick` on the last simulated tick in this step (drain order). */
  lastDrainedCommands: readonly SimCommand[];
}

// ---------------------------------------------------------------------------
// Episode run — metrics for eval / experimentation (e.g. LaunchDarkly custom metrics)
// ---------------------------------------------------------------------------

/** Bump when `SimAgentEpisodeMetrics` fields or semantics change. */
export const SIM_AGENT_METRICS_VERSION = 2 as const;

/** JSON-serializable numeric summary (one row per episode for warehouses / LD). */
export interface SimAgentEpisodeMetrics {
  outcome: GameOutcome;
  victory: 0 | 1;
  defeat: 0 | 1;
  mutualDestruction: 0 | 1;
  finalTick: number;
  /** True if the run stopped because `maxTicks` was reached with `outcome === None`. */
  cappedAtMaxTicks: boolean;
  playerFoodTotal: number;
  playerWorkerCount: number;
  playerChamberCount: number;
  playerEggCount: number;
  playerLarvaeCount: number;
  playerQueenAlive: 0 | 1;
  /** First AI colony’s queen liveness; 0 if no enemy colony exists. */
  enemyQueenAlive: 0 | 1;
  playerMarkedDigTileCount: number;
  /** Total commands appended to the session input log during this episode. */
  inputLogCommandCount: number;
  /**
   * Curriculum-specific numeric signals (`metricsVersion` 2+).
   * Keys depend on `scenarioId` (see `src/sim/training-scenarios.ts`).
   */
  scenarioExtras: Record<string, number>;
}

/** Optional passthrough for experiment attribution (LaunchDarkly or other). */
export interface SimAgentLaunchDarklyContext {
  experimentKey?: string;
  variationKey?: string;
  iterationId?: string;
}

export interface SimAgentEpisodeTickContext {
  /** Result of the previous `step`, or `null` before the first tick of the episode. */
  lastStep: SimAgentStepResult | null;
  /** 0-based index within this `runEpisode` call. */
  tickIndex: number;
  /** World observation before this tick’s `step` (same shape as `SimAgentStepResult.observation`). */
  observation: SimAgentObservation;
}

export interface SimAgentRunEpisodeOptions {
  maxTicks: number;
  /** If set, `reset(seed)` runs before the first tick. */
  seed?: number;
  /**
   * Player commands each tick. Default: `[{ type: 'NoOp' }]`.
   * Receives pre-tick observation; safe to close over an external policy.
   */
  getCommands?: (ctx: SimAgentEpisodeTickContext) => readonly AgentSimCommand[];
  /** Echoed on `SimAgentEpisodeResult` for downstream metric attribution. */
  launchDarkly?: SimAgentLaunchDarklyContext;
}

/** Stable envelope for `scripts/run-agent-episode.ts` and CI / metric sinks. */
export const SIM_AGENT_EPISODE_SCHEMA = 'sim-agent-episode/1' as const;

export interface SimAgentEpisodeResult {
  schema: typeof SIM_AGENT_EPISODE_SCHEMA;
  metricsVersion: typeof SIM_AGENT_METRICS_VERSION;
  metrics: SimAgentEpisodeMetrics;
  /** Wall-clock duration of the episode loop in ms (harness layer only; not sim time). */
  wallClockMs: number;
  seed: number;
  scenarioId: string;
  opponentMode: OpponentMode;
  playerColonyId: ColonyId;
  /** Last step outcome after the loop (may be `None` if capped at maxTicks). */
  outcome: GameOutcome;
  /** True if a terminal game outcome was reached before `maxTicks`. */
  terminalReached: boolean;
  cappedAtMaxTicks: boolean;
  launchDarkly?: SimAgentLaunchDarklyContext;
}
