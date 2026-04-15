// Phase 5 scope: fixed 20Hz accumulator (MS_PER_TICK = 50 constant).
// Variable msPerTick + SpeedLevel + pause are Phase 8 render-layer scope per Phase 4 PRD §9a/§9b.
// This accumulator uses a constant MS_PER_TICK; Phase 8 reshapes it to read msPerTick from render state.
// Platform loop owns the only non-sim write path (world.commandQueue drain).
// FNDN-07 enforcement: ESLint nonSimMutationGuard + scripts/check-sim-boundary.sh (Plan 01).
// The Readonly<WorldState> Pattern 1b seam is Phase 8 scope (render/input entry points).
import type { WorldState } from '../sim/types.js';
import type { GameOutcome } from '../sim/game-over.js';
import type { SimCommand } from '../sim/commands.js';

export const MS_PER_TICK = 50;
export const MAX_CATCHUP_TICKS = 5;
const MAX_ACCUMULATOR_MS = MS_PER_TICK * MAX_CATCHUP_TICKS; // 250

export interface GameLoop {
  update(dtMs: number): void;
  readonly accumulatorMs: number;
}

type TickFn = (world: WorldState, commands: readonly SimCommand[]) => GameOutcome;

export function createGameLoop(tickFn: TickFn, world: WorldState): GameLoop {
  let accumulatorMs = 0;

  return {
    update(dtMs: number): void {
      accumulatorMs += dtMs; // No speed multiplier — Phase 8 scope per PRD §9a.
      // PRD §3 spiral-of-death guard: clamp BEFORE the while loop.
      if (accumulatorMs > MAX_ACCUMULATOR_MS) {
        accumulatorMs = MAX_ACCUMULATOR_MS;
      }
      while (accumulatorMs >= MS_PER_TICK) {
        const cmds = world.commandQueue.splice(0);
        tickFn(world, cmds);
        accumulatorMs -= MS_PER_TICK;
      }
    },
    get accumulatorMs() {
      return accumulatorMs;
    },
  };
}
