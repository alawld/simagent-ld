// SCEN-06-style session bundle for imitation / offline replay (SimAgentPlan §9 #6).
// `inputLog` is the drained FIFO per tick (AI + player); replay groups by `issuedAtTick` and calls `tick` only.

import type { SimCommand } from '../sim/commands.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import type { OpponentMode } from './types.js';

export const SIM_AGENT_SESSION_SCHEMA = 'sim-agent-session/1' as const;

export interface SimAgentSessionRecording {
  schema: typeof SIM_AGENT_SESSION_SCHEMA;
  seed: number;
  scenarioId: string;
  opponentMode: OpponentMode;
  playerColonyId: ColonyId;
  /** `world.tick` after the recorded session (replay runs ticks `0 .. finalTick - 1`). */
  finalTick: number;
  /** Full drained stream in harness order — same shape as `SimAgentHarness.getInputLog()`. */
  inputLog: SimCommand[];
}

export function isSimAgentSessionRecording(x: unknown): x is SimAgentSessionRecording {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.schema === SIM_AGENT_SESSION_SCHEMA &&
    typeof o.seed === 'number' &&
    Number.isFinite(o.seed) &&
    typeof o.scenarioId === 'string' &&
    (o.opponentMode === 'none' || o.opponentMode === 'ai') &&
    typeof o.playerColonyId === 'number' &&
    Number.isInteger(o.playerColonyId) &&
    typeof o.finalTick === 'number' &&
    Number.isFinite(o.finalTick) &&
    o.finalTick >= 0 &&
    Array.isArray(o.inputLog)
  );
}

/** Parse and validate a JSON string into a recording (throws on invalid shape). */
export function parseSessionRecordingJson(text: string): SimAgentSessionRecording {
  const raw: unknown = JSON.parse(text);
  if (!isSimAgentSessionRecording(raw)) {
    throw new Error('session-recording: invalid SimAgentSessionRecording JSON');
  }
  return raw;
}

export function serializeSessionRecordingJson(recording: SimAgentSessionRecording): string {
  return JSON.stringify(recording);
}
