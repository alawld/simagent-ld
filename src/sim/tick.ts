// src/sim/tick.ts
// tick() entry point — the simulation's single advance function.
// Phase 5 scope per PRD §1/§5: drain command queue (FIFO cap), dispatch,
// increment world.tick, return GameOutcome.None.
// No gameplay logic — Phases 6–9 add systems through this entry point.
import type { WorldState } from './types.js';
import { MAX_COMMANDS_PER_TICK, type SimCommand } from './commands.js';
import { GameOutcome } from './game-over.js';

/**
 * Advance the simulation by one tick.
 *
 * @param world   - Mutable world state; tick is incremented in place.
 * @param commands - Point-in-time snapshot of commands for this tick.
 *                   Commands beyond MAX_COMMANDS_PER_TICK are silently
 *                   dropped FIFO (PRD §5). The array is NOT mutated.
 * @returns GameOutcome (always GameOutcome.None in Phase 5;
 *          checkQueenDeath is Phase 9 scope).
 */
export function tick(world: WorldState, commands: readonly SimCommand[]): GameOutcome {
  // PRD §5 FIFO silent-drop + PRD §tick "No allocation" contract (line 708):
  // bounded indexed iteration — no slice, no new array, no Array.prototype.values
  // iterator object. Pure numeric loop counter.
  const limit = commands.length < MAX_COMMANDS_PER_TICK ? commands.length : MAX_COMMANDS_PER_TICK;

  for (let i = 0; i < limit; i++) {
    const cmd = commands[i]!;
    switch (cmd.type) {
      case 'NoOp':
        // No state change — by definition a no-op.
        break;
      default: {
        // Exhaustive-switch guard. In Phase 5 SimCommand is a single-variant
        // alias (= NoOpCommand), so TypeScript does not narrow the default to
        // `never` yet. Cast via `unknown` to satisfy the pattern without a
        // type error. When Phase 6 expands the union the cast disappears and
        // the narrowing becomes genuine. Silent-drop unknowns — do NOT throw
        // (PRD §5) and do NOT log (wall-clock-adjacent, SCEN-06).
        const _exhaustive: never = cmd as unknown as never;
        void _exhaustive;
        break;
      }
    }
  }

  // Advance the tick counter — the ONLY function that should mutate world.tick
  // in Phase 5.
  world.tick += 1;

  return GameOutcome.None;
}
