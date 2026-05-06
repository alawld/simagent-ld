// Bidirectional JSONL session dispatch for stdin/stdout trainers (SimAgentPlan Phase G transport).
// Each line is one JSON object; responses are one JSON object per request.

import type { ColonyId } from '../sim/colony/colony-store.js';
import type { SimCommand } from '../sim/commands.js';
import { GameOutcome } from '../sim/game-over.js';
import type { SerializedWorldState } from '../platform/save.js';
import { SimAgentHarness } from './harness.js';
import type {
  AgentSimCommand,
  OpponentMode,
  SimAgentObservation,
  SimAgentStepResult,
} from './types.js';

/** Mutable cell so `session` can replace the harness instance. */
export interface JsonlHarnessCell {
  harness: SimAgentHarness;
}

export type JsonlRequest =
  | {
      op: 'session';
      seed: number;
      scenarioId?: string;
      opponentMode?: OpponentMode;
      playerColonyId?: ColonyId;
      recordInputLog?: boolean;
    }
  | { op: 'reset'; seed: number }
  | { op: 'step'; commands?: readonly AgentSimCommand[]; repeatTicks?: number }
  | { op: 'observe' }
  | { op: 'ping' }
  | { op: 'pause' }
  | { op: 'resume' }
  | { op: 'loadSnapshot'; snapshot: SerializedWorldState }
  | { op: 'exportSnapshot' };

export type JsonlOkResponse =
  | {
      ok: true;
      op: 'session';
      seed: number;
      scenarioId: string;
      opponentMode: OpponentMode;
      tick: number;
      terminal: boolean;
    }
  | {
      ok: true;
      op: 'reset';
      seed: number;
      tick: number;
      terminal: boolean;
    }
  | {
      ok: true;
      op: 'step';
      tick: number;
      outcome: GameOutcome;
      terminal: boolean;
      observation: SimAgentObservation;
      lastDrainedCommands: readonly SimCommand[];
    }
  | {
      ok: true;
      op: 'observe';
      tick: number;
      terminal: boolean;
      observation: SimAgentObservation;
    }
  | { ok: true; op: 'ping'; tick: number }
  | { ok: true; op: 'pause'; paused: true; tick: number; terminal: boolean }
  | { ok: true; op: 'resume'; paused: false; tick: number; terminal: boolean }
  | { ok: true; op: 'loadSnapshot'; tick: number; terminal: boolean; seed: number }
  | { ok: true; op: 'exportSnapshot'; snapshot: SerializedWorldState };

export type JsonlErrorResponse = { ok: false; error: string };

export type JsonlResponse = JsonlOkResponse | JsonlErrorResponse;

function err(message: string): JsonlErrorResponse {
  return { ok: false, error: message };
}

const JSONL_OPS = new Set([
  'session',
  'reset',
  'step',
  'observe',
  'ping',
  'pause',
  'resume',
  'loadSnapshot',
  'exportSnapshot',
]);

export function parseJsonlRequest(raw: unknown): JsonlRequest | JsonlErrorResponse {
  if (raw === null || typeof raw !== 'object') return err('request must be a JSON object');
  const o = raw as Record<string, unknown>;
  const op = o.op;
  if (typeof op !== 'string' || !JSONL_OPS.has(op)) return err('unknown op');

  if (op === 'ping') return { op: 'ping' };
  if (op === 'observe') return { op: 'observe' };
  if (op === 'pause') return { op: 'pause' };
  if (op === 'resume') return { op: 'resume' };
  if (op === 'exportSnapshot') return { op: 'exportSnapshot' };

  if (op === 'session') {
    const seed = o.seed;
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return err('session.seed must be a finite number');
    return {
      op: 'session',
      seed,
      ...(typeof o.scenarioId === 'string' ? { scenarioId: o.scenarioId } : {}),
      ...(o.opponentMode === 'none' || o.opponentMode === 'ai' ? { opponentMode: o.opponentMode } : {}),
      ...(typeof o.playerColonyId === 'number' ? { playerColonyId: o.playerColonyId as ColonyId } : {}),
      ...(typeof o.recordInputLog === 'boolean' ? { recordInputLog: o.recordInputLog } : {}),
    };
  }
  if (op === 'reset') {
    const seed = o.seed;
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return err('reset.seed must be a finite number');
    return { op: 'reset', seed };
  }
  if (op === 'loadSnapshot') {
    const snapshot = o.snapshot;
    if (snapshot === null || typeof snapshot !== 'object') return err('loadSnapshot.snapshot must be an object');
    return { op: 'loadSnapshot', snapshot: snapshot as SerializedWorldState };
  }
  if (op === 'step') {
    const commands = o.commands;
    const repeatTicks = o.repeatTicks;
    if (commands !== undefined && !Array.isArray(commands)) return err('step.commands must be an array');
    if (
      repeatTicks !== undefined &&
      (typeof repeatTicks !== 'number' || !Number.isFinite(repeatTicks) || repeatTicks < 1)
    ) {
      return err('step.repeatTicks must be a finite number >= 1');
    }
    return {
      op: 'step',
      ...(commands !== undefined ? { commands: commands as AgentSimCommand[] } : {}),
      ...(repeatTicks !== undefined ? { repeatTicks: Math.trunc(repeatTicks) } : {}),
    };
  }
  return err('internal parse failure');
}

export function dispatchJsonlRequest(cell: JsonlHarnessCell, raw: unknown): JsonlResponse {
  const parsed = parseJsonlRequest(raw);
  if ('ok' in parsed && parsed.ok === false) return parsed;

  const req = parsed as JsonlRequest;
  const h = cell.harness;

  if (req.op === 'ping') {
    return { ok: true, op: 'ping', tick: h.getWorld().tick };
  }

  if (req.op === 'session') {
    cell.harness = new SimAgentHarness({
      seed: req.seed,
      scenarioId: req.scenarioId,
      opponentMode: req.opponentMode,
      playerColonyId: req.playerColonyId,
      recordInputLog: req.recordInputLog,
    });
    const nh = cell.harness;
    return {
      ok: true,
      op: 'session',
      seed: nh.getSeed(),
      scenarioId: nh.getScenarioId(),
      opponentMode: nh.getOpponentMode(),
      tick: nh.getWorld().tick,
      terminal: nh.isTerminal(),
    };
  }

  if (req.op === 'reset') {
    h.reset(req.seed);
    return {
      ok: true,
      op: 'reset',
      seed: h.getSeed(),
      tick: h.getWorld().tick,
      terminal: h.isTerminal(),
    };
  }

  if (req.op === 'observe') {
    return {
      ok: true,
      op: 'observe',
      tick: h.getWorld().tick,
      terminal: h.isTerminal(),
      observation: h.getObservation(),
    };
  }

  if (req.op === 'pause') {
    h.pause();
    return {
      ok: true,
      op: 'pause',
      paused: true,
      tick: h.getWorld().tick,
      terminal: h.isTerminal(),
    };
  }

  if (req.op === 'resume') {
    h.resume();
    return {
      ok: true,
      op: 'resume',
      paused: false,
      tick: h.getWorld().tick,
      terminal: h.isTerminal(),
    };
  }

  if (req.op === 'exportSnapshot') {
    return {
      ok: true,
      op: 'exportSnapshot',
      snapshot: h.getSerializedWorldState(),
    };
  }

  if (req.op === 'loadSnapshot') {
    try {
      h.loadSnapshot(req.snapshot);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(`loadSnapshot: ${msg}`);
    }
    return {
      ok: true,
      op: 'loadSnapshot',
      tick: h.getWorld().tick,
      terminal: h.isTerminal(),
      seed: h.getSeed(),
    };
  }

  if (req.op !== 'step') return err('internal: expected step');
  const stepResult: SimAgentStepResult = h.step({
    commands: req.commands ?? [],
    repeatTicks: req.repeatTicks,
  });
  return {
    ok: true,
    op: 'step',
    tick: stepResult.tick,
    outcome: stepResult.outcome,
    terminal: stepResult.terminal,
    observation: stepResult.observation,
    lastDrainedCommands: stepResult.lastDrainedCommands,
  };
}
