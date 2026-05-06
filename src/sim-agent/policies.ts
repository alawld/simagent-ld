// Built-in command policies for headless runs (SimAgentPlan — agent loop without gameplay changes).
import { readFileSync } from 'node:fs';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import type { AgentSimCommand, SimAgentEpisodeTickContext } from './types.js';

export type CommandPolicy = (ctx: SimAgentEpisodeTickContext) => readonly AgentSimCommand[];

export function createNoOpPolicy(): CommandPolicy {
  return () => [{ type: 'NoOp' as const }];
}

/**
 * Periodically toggles player behavior ratio — useful as a non-trivial baseline for metrics / LD smoke.
 */
export function createHeuristicRatioPolicy(colonyId: ColonyId = PLAYER_COLONY_ID): CommandPolicy {
  return (ctx) => {
    if (ctx.tickIndex % 80 === 0) {
      const phase = (ctx.tickIndex / 80) & 1;
      return [
        {
          type: 'SetBehaviorRatio' as const,
          colonyId,
          ratio: phase === 0 ? { forage: 8, fight: 2 } : { forage: 4, fight: 6 },
        },
      ];
    }
    return [{ type: 'NoOp' as const }];
  };
}

/**
 * Each non-empty line must be a JSON array of `AgentSimCommand` objects (no `issuedAtTick`; harness stamps).
 * For tick `t` with `L` lines, line `min(t, L - 1)` is used so the last line repeats after the file ends.
 */
export function createCommandsFilePolicy(filePath: string): CommandPolicy {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error(`commands-file is empty: ${filePath}`);
  }
  const batches: AgentSimCommand[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed: unknown = JSON.parse(lines[i]!);
    if (!Array.isArray(parsed)) {
      throw new Error(`commands-file line ${i + 1}: expected JSON array, got ${typeof parsed}`);
    }
    batches.push(parsed as AgentSimCommand[]);
  }
  return (ctx) => {
    const idx = Math.min(ctx.tickIndex, batches.length - 1);
    return batches[idx]!;
  };
}
