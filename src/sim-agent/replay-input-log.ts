// Deterministic replay of a harness session from `(seed, scenarioId, inputLog)` — no AI re-run;
// `tick` receives the same command batches as the original drains when grouped by `issuedAtTick`.

import type { WorldState } from '../sim/types.js';
import type { SimCommand } from '../sim/commands.js';
import { tick, resetFlowFieldCaches } from '../sim/tick.js';
import { createTrainingWorld } from '../sim/training-scenarios.js';
import type { SimAgentSessionRecording } from './session-recording.js';

/**
 * Buckets commands by `issuedAtTick`, preserving **FIFO order within each tick** (log scan order).
 * Drops commands with `issuedAtTick` outside `[0, finalTickExclusive)`.
 */
export function buildTicksCommandLists(
  inputLog: readonly SimCommand[],
  finalTickExclusive: number,
): SimCommand[][] {
  const out: SimCommand[][] = Array.from({ length: finalTickExclusive }, () => []);
  for (let i = 0; i < inputLog.length; i++) {
    const cmd = inputLog[i]!;
    const t = cmd.issuedAtTick;
    if (t >= 0 && t < finalTickExclusive) {
      out[t]!.push(cmd);
    }
  }
  return out;
}

/**
 * Replays a recorded harness session: fresh `createTrainingWorld`, flow-cache reset, then
 * `tick(world, cmds[t])` for `t = 0 .. recording.finalTick - 1`.
 *
 * **`opponentMode` is ignored** — AI behavior is already encoded in `inputLog` when applicable.
 */
export function replaySessionRecording(recording: SimAgentSessionRecording): WorldState {
  resetFlowFieldCaches();
  const world = createTrainingWorld(recording.scenarioId, recording.seed);
  const lists = buildTicksCommandLists(recording.inputLog, recording.finalTick);
  for (let t = 0; t < recording.finalTick; t++) {
    tick(world, lists[t]!);
  }
  return world;
}
