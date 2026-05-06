// Fixed-seed × scenario × policy matrix for CI / regression (SimAgentPlan §9 #7).
import type { GameOutcome } from '../sim/game-over.js';
import { TRAINING_SCENARIO_IDS } from '../sim/training-scenarios.js';
import { SimAgentHarness } from './harness.js';
import { createHeuristicRatioPolicy, createNoOpPolicy } from './policies.js';
import { evaluateScenarioPass } from './scenario-thresholds.js';
import type { OpponentMode, SimAgentEpisodeMetrics } from './types.js';

export const SIM_AGENT_EVAL_GRID_SCHEMA = 'sim-agent-eval-grid/1' as const;

export type EvalPolicyId = 'noop' | 'heuristic';

export interface EvalGridCell {
  seed: number;
  scenarioId: string;
  policy: EvalPolicyId;
  pass: boolean;
  reasons: readonly string[];
  outcome: GameOutcome;
  terminalReached: boolean;
  cappedAtMaxTicks: boolean;
  wallClockMs: number;
  metrics: SimAgentEpisodeMetrics;
}

export interface EvalGridResult {
  schema: typeof SIM_AGENT_EVAL_GRID_SCHEMA;
  maxTicks: number;
  opponentMode: OpponentMode;
  cells: EvalGridCell[];
  summary: { total: number; passed: number; failed: number };
}

function getCommandsForPolicy(policy: EvalPolicyId) {
  return policy === 'heuristic' ? createHeuristicRatioPolicy() : createNoOpPolicy();
}

/**
 * Cartesian product of seeds × scenarioIds × policies. Each cell is one **`runEpisode`**.
 * Default **`opponentMode: 'none'`** keeps the grid deterministic and avoids AI command-queue pressure.
 */
export function runEvalGrid(opts: {
  seeds: readonly number[];
  scenarioIds: readonly string[];
  policies: readonly EvalPolicyId[];
  maxTicks: number;
  opponentMode?: OpponentMode;
}): EvalGridResult {
  const opponentMode = opts.opponentMode ?? 'none';
  const cells: EvalGridCell[] = [];

  for (let s = 0; s < opts.seeds.length; s++) {
    const seed = opts.seeds[s]!;
    for (let i = 0; i < opts.scenarioIds.length; i++) {
      const scenarioId = opts.scenarioIds[i]!;
      for (let p = 0; p < opts.policies.length; p++) {
        const policy = opts.policies[p]!;
        const harness = new SimAgentHarness({
          seed,
          scenarioId,
          opponentMode,
          recordInputLog: false,
        });
        const episode = harness.runEpisode({
          maxTicks: opts.maxTicks,
          getCommands: getCommandsForPolicy(policy),
        });
        const { pass, reasons } = evaluateScenarioPass(episode);
        cells.push({
          seed,
          scenarioId,
          policy,
          pass,
          reasons,
          outcome: episode.outcome,
          terminalReached: episode.terminalReached,
          cappedAtMaxTicks: episode.cappedAtMaxTicks,
          wallClockMs: episode.wallClockMs,
          metrics: episode.metrics,
        });
      }
    }
  }

  let passed = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]!.pass) passed += 1;
  }
  const total = cells.length;

  return {
    schema: SIM_AGENT_EVAL_GRID_SCHEMA,
    maxTicks: opts.maxTicks,
    opponentMode,
    cells,
    summary: { total, passed, failed: total - passed },
  };
}

/** Default seeds for smoke / CI (small, stable). */
export const DEFAULT_EVAL_SEEDS: readonly number[] = [1, 2, 3];

/** Default policies shipped with the repo. */
export const DEFAULT_EVAL_POLICIES: readonly EvalPolicyId[] = ['noop', 'heuristic'];

/** All registered training scenario ids (same order as `TRAINING_SCENARIO_IDS`). */
export const DEFAULT_EVAL_SCENARIOS: readonly string[] = [...TRAINING_SCENARIO_IDS];
