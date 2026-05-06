// Headless agent session — SimAgentPlan Phase A: reset, step, outcome, optional enemy AI hook.
//
// Mirrors GameScene ordering: runAIController for each AI colony → stamp player commands →
// drain world.commandQueue → tick(world, cmds). Respects MAX_COMMANDS_PER_TICK (64); throws
// if a single tick would exceed the cap after the opponent hook (split across ticks or trim).

import type { WorldState } from '../sim/types.js';
import { createTrainingWorld } from '../sim/training-scenarios.js';
import { tick, resetFlowFieldCaches } from '../sim/tick.js';
import { GameOutcome, checkQueenDeath } from '../sim/game-over.js';
import { deserializeWorldState, serializeWorldState, type SerializedWorldState } from '../platform/save.js';
import type { SimCommand } from '../sim/commands.js';
import { MAX_COMMANDS_PER_TICK } from '../sim/commands.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import { colonyFoodTotal } from '../sim/colony/colony-system.js';
import { runAIController } from '../render/ai-controller.js';
import { deriveAIColonyIds, appendInputLog } from '../render/game-scene-logic.js';
import { buildEpisodeMetrics } from './episode-metrics.js';
import {
  computeAffordances,
  evaluateCommandApplicability,
  type CommandApplicability,
} from '../sim/command-applicability.js';
import { buildObservationChannels } from './observation-channels.js';
import {
  SIM_AGENT_SESSION_SCHEMA,
  type SimAgentSessionRecording,
} from './session-recording.js';
import {
  SIM_AGENT_EPISODE_SCHEMA,
  SIM_AGENT_METRICS_VERSION,
  SIM_AGENT_OBSERVATION_VERSION,
  type AgentSimCommand,
  type OpponentMode,
  type SimAgentEpisodeResult,
  type SimAgentHarnessConfig,
  type SimAgentObservation,
  type SimAgentRunEpisodeOptions,
  type SimAgentStepOptions,
  type SimAgentStepResult,
} from './types.js';

type HarnessOutcome = SimAgentStepResult['outcome'];

const DEFAULT_SCENARIO_ID = 'default';

function stampCommands(world: WorldState, cmds: readonly AgentSimCommand[]): SimCommand[] {
  const issuedAtTick = world.tick;
  const out: SimCommand[] = [];
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i]!;
    out.push({ ...c, issuedAtTick } as SimCommand);
  }
  return out;
}

function buildObservation(
  world: WorldState,
  scenarioId: string,
  playerColonyId: ColonyId,
  aiColonyIds: readonly ColonyId[],
): SimAgentObservation {
  const colony = world.colonies[playerColonyId];
  const queenAlive =
    colony !== undefined && world.ants.alive[colony.queenEntityId] === 1;
  const scalars =
    colony === undefined
      ? {
          foodTotal: 0,
          workerCount: 0,
          queenAlive: false,
          targetRatio: { forage: 0, fight: 0 },
          rallyActive: false,
          entranceCount: 0,
          defeated: true,
        }
      : {
          foodTotal: colonyFoodTotal(colony),
          workerCount: colony.workerCount,
          queenAlive,
          targetRatio: { forage: colony.targetRatio.forage, fight: colony.targetRatio.fight },
          rallyActive: colony.rallyPoint !== null,
          entranceCount: colony.entrances.length,
          defeated: colony.defeated,
        };

  const { taskZone, opponent, spatial } = buildObservationChannels(world, playerColonyId, aiColonyIds);

  return {
    observationVersion: SIM_AGENT_OBSERVATION_VERSION,
    scenarioId,
    tick: world.tick,
    scalars,
    affordances: computeAffordances(world, playerColonyId),
    taskZone,
    opponent,
    spatial,
  };
}

export class SimAgentHarness {
  private world: WorldState;
  private readonly scenarioId: string;
  private readonly playerColonyId: ColonyId;
  private readonly opponentMode: OpponentMode;
  private readonly recordInputLog: boolean;
  private aiColonyIds: ColonyId[] = [];
  private readonly inputLog: SimCommand[] = [];
  private terminal = false;
  /** When true, `step` / `runEpisode` do not advance simulation (`step` returns frozen observation). */
  private paused = false;
  private lastDrainedCommands: readonly SimCommand[] = [];
  private currentSeed: number;

  constructor(config: SimAgentHarnessConfig) {
    this.scenarioId = config.scenarioId ?? DEFAULT_SCENARIO_ID;
    this.playerColonyId = config.playerColonyId ?? PLAYER_COLONY_ID;
    this.opponentMode = config.opponentMode ?? 'ai';
    this.recordInputLog = config.recordInputLog !== false;
    this.currentSeed = config.seed;
    resetFlowFieldCaches();
    this.world = createTrainingWorld(this.scenarioId, config.seed);
    this.aiColonyIds = deriveAIColonyIds(this.world, this.playerColonyId);
  }

  /** Seed used for the last `reset` / constructor `createScenario`. */
  getSeed(): number {
    return this.currentSeed;
  }

  /** Current world (read-only for agents — mutate only via `step` commands). */
  getWorld(): WorldState {
    return this.world;
  }

  getScenarioId(): string {
    return this.scenarioId;
  }

  getOpponentMode(): OpponentMode {
    return this.opponentMode;
  }

  getPlayerColonyId(): ColonyId {
    return this.playerColonyId;
  }

  /**
   * Read-only preview of whether **`tick`** step-1 would apply this command (same guards as
   * `evaluateCommandApplicability` in `src/sim/command-applicability.ts`). Stamps `issuedAtTick`
   * to the current `world.tick` for type parity only — applicability does not depend on it.
   */
  peekApplicability(cmd: AgentSimCommand): CommandApplicability {
    const stamped = { ...cmd, issuedAtTick: this.world.tick } as SimCommand;
    return evaluateCommandApplicability(this.world, stamped);
  }

  /** Current observation without advancing (same shape as `step` result). */
  getObservation(): SimAgentObservation {
    return buildObservation(this.world, this.scenarioId, this.playerColonyId, this.aiColonyIds);
  }

  /** SCEN-06-style log of all drained commands (AI + player), in tick drain order. */
  getInputLog(): readonly SimCommand[] {
    return this.inputLog;
  }

  isTerminal(): boolean {
    return this.terminal;
  }

  /** Replaces world with a fresh `createScenario(seed)` and clears flow caches + input log. */
  reset(seed: number): void {
    this.currentSeed = seed;
    resetFlowFieldCaches();
    this.world = createTrainingWorld(this.scenarioId, seed);
    this.aiColonyIds = deriveAIColonyIds(this.world, this.playerColonyId);
    this.inputLog.length = 0;
    this.terminal = false;
    this.paused = false;
    this.lastDrainedCommands = [];
  }

  /** Freeze simulation: `step` returns without calling `tick`; `runEpisode` throws until resumed. */
  setPaused(value: boolean): void {
    this.paused = value;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.setPaused(true);
  }

  resume(): void {
    this.setPaused(false);
  }

  /**
   * Replace the live world from a **`serializeWorldState`** snapshot (save/debug shape).
   * Clears input log, clears pause, refreshes AI colony ids, sets **`terminal`** from **`checkQueenDeath`**,
   * and sets **`getSeed()`** to **`world.terrainSeed`** (world identity).
   */
  loadSnapshot(snapshot: SerializedWorldState): void {
    resetFlowFieldCaches();
    this.world = deserializeWorldState(snapshot);
    this.aiColonyIds = deriveAIColonyIds(this.world, this.playerColonyId);
    this.inputLog.length = 0;
    this.lastDrainedCommands = [];
    this.paused = false;
    const outcome = checkQueenDeath(this.world, this.playerColonyId);
    this.terminal = outcome !== GameOutcome.None;
    this.currentSeed = this.world.terrainSeed;
  }

  /** Same JSON shape as autosave / replay (`platform/save.ts`). */
  getSerializedWorldState(): SerializedWorldState {
    return serializeWorldState(this.world);
  }

  /**
   * Run up to `maxTicks` ticks with an optional per-tick command provider.
   * Stops early on terminal `GameOutcome`. Builds **episode metrics** for experimentation / LD sinks.
   */
  runEpisode(options: SimAgentRunEpisodeOptions): SimAgentEpisodeResult {
    if (this.paused) {
      throw new Error(
        'sim-agent harness: runEpisode — session is paused. Call setPaused(false) before runEpisode.',
      );
    }
    const wallStart = Date.now();
    if (options.seed !== undefined) {
      this.reset(options.seed);
    } else if (this.terminal) {
      throw new Error(
        'sim-agent harness: runEpisode — session is terminal. Pass `seed` in runEpisode options or call reset(seed) first.',
      );
    }

    const logStart = this.inputLog.length;
    const getCommands = options.getCommands ?? (() => [{ type: 'NoOp' as const }]);
    const maxTicks = options.maxTicks;
    let lastStep: SimAgentStepResult | null = null;
    let stepsRun = 0;

    for (let i = 0; i < maxTicks; i++) {
      if (this.terminal) break;
      const observation =
        lastStep?.observation ??
        buildObservation(this.world, this.scenarioId, this.playerColonyId, this.aiColonyIds);
      const cmds = getCommands({ lastStep, tickIndex: i, observation });
      lastStep = this.step({ commands: cmds });
      stepsRun += 1;
      if (lastStep.terminal) break;
    }

    const wallClockMs = Date.now() - wallStart;
    const outcome = lastStep?.outcome ?? GameOutcome.None;
    const terminalReached = this.terminal;
    const cappedAtMaxTicks =
      maxTicks > 0 && stepsRun === maxTicks && !terminalReached;

    const metrics = buildEpisodeMetrics(this.world, {
      scenarioId: this.scenarioId,
      playerColonyId: this.playerColonyId,
      enemyColonyIds: this.aiColonyIds,
      outcome,
      cappedAtMaxTicks,
      inputLogCommandCount: this.inputLog.length - logStart,
    });

    const ld = options.launchDarkly;
    const result: SimAgentEpisodeResult = {
      schema: SIM_AGENT_EPISODE_SCHEMA,
      metricsVersion: SIM_AGENT_METRICS_VERSION,
      metrics,
      wallClockMs,
      seed: this.currentSeed,
      scenarioId: this.scenarioId,
      opponentMode: this.opponentMode,
      playerColonyId: this.playerColonyId,
      outcome,
      terminalReached,
      cappedAtMaxTicks,
    };
    if (ld !== undefined && (ld.experimentKey !== undefined || ld.variationKey !== undefined || ld.iterationId !== undefined)) {
      result.launchDarkly = { ...ld };
    }
    return result;
  }

  /**
   * Advance one or more ticks. Opponent AI runs first when `opponentMode === 'ai'`.
   * Player `commands` are stamped with `issuedAtTick: world.tick` and pushed before drain.
   *
   * **Command cap:** at most `MAX_COMMANDS_PER_TICK` (64) commands may be present in
   * `world.commandQueue` after the opponent hook and your stamped commands; split excess
   * across additional `step` calls (ticks).
   */
  step(options: SimAgentStepOptions = {}): SimAgentStepResult {
    const repeatTicks = options.repeatTicks ?? 1;
    const baseCommands = options.commands ?? [];
    let lastOutcome: HarnessOutcome = GameOutcome.None;
    this.lastDrainedCommands = [];

    if (this.terminal) {
      return {
        tick: this.world.tick,
        outcome: lastOutcome,
        terminal: true,
        observation: buildObservation(this.world, this.scenarioId, this.playerColonyId, this.aiColonyIds),
        lastDrainedCommands: [],
      };
    }

    if (this.paused) {
      return {
        tick: this.world.tick,
        outcome: GameOutcome.None,
        terminal: this.terminal,
        observation: buildObservation(this.world, this.scenarioId, this.playerColonyId, this.aiColonyIds),
        lastDrainedCommands: [],
      };
    }

    for (let r = 0; r < repeatTicks; r++) {
      if (this.opponentMode === 'ai') {
        for (let a = 0; a < this.aiColonyIds.length; a++) {
          runAIController(this.world, this.aiColonyIds[a]!);
        }
      }

      const stamped = r === 0 ? stampCommands(this.world, baseCommands) : [];
      for (let i = 0; i < stamped.length; i++) {
        this.world.commandQueue.push(stamped[i]!);
      }

      if (this.world.commandQueue.length > MAX_COMMANDS_PER_TICK) {
        throw new Error(
          `sim-agent harness: commandQueue length ${this.world.commandQueue.length} exceeds MAX_COMMANDS_PER_TICK (${MAX_COMMANDS_PER_TICK}). ` +
            'Split commands across ticks or reduce opponent emissions; see src/sim/commands.ts.',
        );
      }

      const drained = this.world.commandQueue.splice(0);
      this.lastDrainedCommands = drained;
      if (this.recordInputLog) {
        appendInputLog(this.inputLog, drained);
      }

      lastOutcome = tick(this.world, drained);

      if (lastOutcome !== GameOutcome.None) {
        this.terminal = true;
        break;
      }
    }

    return {
      tick: this.world.tick,
      outcome: lastOutcome,
      terminal: this.terminal,
      observation: buildObservation(this.world, this.scenarioId, this.playerColonyId, this.aiColonyIds),
      lastDrainedCommands: this.lastDrainedCommands,
    };
  }
}

/** Immutable snapshot for imitation / offline replay (`replaySessionRecording`). */
export function buildSessionRecording(harness: SimAgentHarness): SimAgentSessionRecording {
  return {
    schema: SIM_AGENT_SESSION_SCHEMA,
    seed: harness.getSeed(),
    scenarioId: harness.getScenarioId(),
    opponentMode: harness.getOpponentMode(),
    playerColonyId: harness.getPlayerColonyId(),
    finalTick: harness.getWorld().tick,
    inputLog: harness.getInputLog().slice(),
  };
}
