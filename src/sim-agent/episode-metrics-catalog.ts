// Stable lists for experimentation sinks (LaunchDarkly custom metrics, warehouses).
// Keep in sync with `SimAgentEpisodeMetrics` / `SimAgentEpisodeResult` in `types.ts`.

import type { SimAgentEpisodeMetrics, SimAgentEpisodeResult } from './types.js';

/** Every numeric-friendly field path under `metrics` for `metricsVersion` ≥ 2 (dot notation). */
export const SIM_AGENT_METRICS_DOT_PATHS = [
  'metrics.outcome',
  'metrics.victory',
  'metrics.defeat',
  'metrics.mutualDestruction',
  'metrics.finalTick',
  'metrics.cappedAtMaxTicks',
  'metrics.playerFoodTotal',
  'metrics.playerWorkerCount',
  'metrics.playerChamberCount',
  'metrics.playerEggCount',
  'metrics.playerLarvaeCount',
  'metrics.playerQueenAlive',
  'metrics.enemyQueenAlive',
  'metrics.playerMarkedDigTileCount',
  'metrics.inputLogCommandCount',
] as const satisfies readonly `metrics.${keyof SimAgentEpisodeMetrics}`[];

/**
 * Known optional keys inside `metrics.scenarioExtras` (curriculum-specific).
 * Unknown scenarios may add more at runtime — register those in LD if you rely on them.
 */
export const SIM_AGENT_SCENARIO_EXTRA_KEYS_KNOWN = [
  'playerSurfaceWorkerCount',
  'playerEntranceFoodStored',
  'playerFightRatioTarget',
] as const;

/** Top-level episode envelope paths useful for attribution / joins (not all numeric). */
export const SIM_AGENT_EPISODE_ENVELOPE_DOT_PATHS = [
  'schema',
  'metricsVersion',
  'wallClockMs',
  'seed',
  'scenarioId',
  'opponentMode',
  'playerColonyId',
  'outcome',
  'terminalReached',
  'cappedAtMaxTicks',
  'launchDarkly.experimentKey',
  'launchDarkly.variationKey',
  'launchDarkly.iterationId',
] as const satisfies readonly (
  | keyof SimAgentEpisodeResult
  | 'launchDarkly.experimentKey'
  | 'launchDarkly.variationKey'
  | 'launchDarkly.iterationId'
)[];

/** JSON line shape identifier — filter rows in a mixed NDJSON stream. */
export const SIM_AGENT_EPISODE_SCHEMA_VALUE = 'sim-agent-episode/1' as const;
