// Phase 5 scope: fixed 20Hz accumulator (MS_PER_TICK = 50 constant).
// Phase 8 wires onBeforeTick = copyWorldState; getMsPerTick/getIsPaused remain Phase 9 seams.
// Phase 9 scope: getMsPerTick/SpeedLevel + getIsPaused/pause wired at render/input entry points.
// Platform loop owns the only non-sim write path (world.commandQueue drain).
// FNDN-07 enforcement: ESLint nonSimMutationGuard + scripts/check-sim-boundary.sh (Plan 01).
// The Readonly<WorldState> Pattern 1b seam is Phase 8 scope (render/input entry points).
//
// GameLoopOpts contract:
//   onBeforeTick   - called before each tick fires; Phase 8 wires copyWorldState(world, prevWorld).
//   getMsPerTick   - queried once per frame for dynamic tick duration; Phase 9 wires SpeedLevel.
//   getIsPaused    - queried once per frame; Phase 9 wires pause state.
//   Spiral-of-death clamp = getMsPerTick() × MAX_CATCHUP_TICKS (dynamic, honors variable speed).
import type { WorldState } from '../sim/types.js';
import type { GameOutcome } from '../sim/game-over.js';
import type { SimCommand } from '../sim/commands.js';

export const MS_PER_TICK = 50;
export const MAX_CATCHUP_TICKS = 5;

export interface GameLoop {
  update(dtMs: number): void;
  readonly accumulatorMs: number;
}

/** Phase 8/9 extension seam for createGameLoop. All callbacks are optional for backward compat. */
export interface GameLoopOpts {
  /** Phase 8 seam: called before each tick fires. Phase 8 wires copyWorldState. */
  onBeforeTick?: (world: WorldState) => void;
  /** Phase 9 seam: dynamic tick duration for SpeedLevel. Default: () => MS_PER_TICK. */
  getMsPerTick?: () => number;
  /** Phase 9 seam: pause gate. Default: () => false. */
  getIsPaused?: () => boolean;
}

type TickFn = (world: WorldState, commands: readonly SimCommand[]) => GameOutcome;

export function createGameLoop(
  tickFn: TickFn,
  world: WorldState,
  opts?: GameLoopOpts,
): GameLoop {
  const getMsPerTick = opts?.getMsPerTick ?? (() => MS_PER_TICK);
  const getIsPaused  = opts?.getIsPaused  ?? (() => false);
  const onBeforeTick = opts?.onBeforeTick;

  let accumulatorMs = 0;

  return {
    update(dtMs: number): void {
      if (getIsPaused()) return;                        // Phase 9 pause seam
      const msPerTick = getMsPerTick();                 // queried once per frame
      accumulatorMs += dtMs;
      // PRD §3 spiral-of-death guard: dynamic clamp honors variable speed.
      const maxAcc = msPerTick * MAX_CATCHUP_TICKS;
      if (accumulatorMs > maxAcc) accumulatorMs = maxAcc;
      while (accumulatorMs >= msPerTick) {
        onBeforeTick?.(world);                          // Phase 8: copyWorldState seam
        const cmds = world.commandQueue.splice(0);
        tickFn(world, cmds);
        accumulatorMs -= msPerTick;
      }
    },
    get accumulatorMs() {
      return accumulatorMs;
    },
  };
}
