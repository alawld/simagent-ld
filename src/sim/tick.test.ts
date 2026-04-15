// src/sim/tick.test.ts
// Unit tests for tick() entry point + SCEN-06 determinism test.
import { describe, it, expect } from 'vitest';
import { tick } from './tick.js';
import { createWorldState } from './types.js';
import { GameOutcome } from './game-over.js';
import type { SimCommand } from './commands.js';

// Helper: run sim for N ticks from a seed and return observable state.
function runSim(seed: number, ticks: number) {
  const world = createWorldState(seed);
  for (let i = 0; i < ticks; i++) {
    const cmds = world.commandQueue.splice(0);
    tick(world, cmds);
  }
  return { tick: world.tick, rngState: world.rngState, nextEntityId: world.nextEntityId };
}

describe('tick() basic', () => {
  it('increments world.tick from 0 to 1 on a fresh world with no commands', () => {
    const world = createWorldState(42);
    tick(world, []);
    expect(world.tick).toBe(1);
  });

  it('returns GameOutcome.None', () => {
    const world = createWorldState(42);
    const result = tick(world, []);
    expect(result).toBe(GameOutcome.None);
  });

  it('increments world.tick to 2 after two consecutive calls', () => {
    const world = createWorldState(42);
    tick(world, []);
    tick(world, []);
    expect(world.tick).toBe(2);
  });
});

describe('command dispatch', () => {
  it('NoOp command does not change state beyond world.tick increment', () => {
    const world = createWorldState(42);
    const rngBefore = world.rngState;
    const nextIdBefore = world.nextEntityId;
    const noOp: SimCommand = { type: 'NoOp', issuedAtTick: 0 };
    tick(world, [noOp]);
    expect(world.tick).toBe(1);
    expect(world.rngState).toBe(rngBefore);
    expect(world.nextEntityId).toBe(nextIdBefore);
  });

  it('caps command list at MAX_COMMANDS_PER_TICK (64) — tick still increments by 1', () => {
    const world = createWorldState(42);
    // Pass 100 NoOp commands; only first 64 should be processed (behavior-observable: tick still +1).
    const cmds = Array.from({ length: 100 }, (_, i): SimCommand => ({
      type: 'NoOp',
      issuedAtTick: i,
    }));
    tick(world, cmds);
    expect(world.tick).toBe(1);
  });

  it('does not throw on unknown command shape and world.tick still increments', () => {
    const world = createWorldState(42);
    const unknown = { type: 'Unknown', issuedAtTick: 0 } as unknown as SimCommand;
    expect(() => tick(world, [unknown])).not.toThrow();
    expect(world.tick).toBe(1);
  });

  it('does not allocate via .slice() or the array iterator — enforces PRD line 708 "No allocation" contract', () => {
    const world = createWorldState(42);
    const cmds: SimCommand[] = Array.from({ length: 100 }, (_, i): SimCommand => ({
      type: 'NoOp',
      issuedAtTick: i,
    }));
    // Proxy throws if tick() reaches for slice() or for...of's iterator factory.
    // Indexed access (commands[i]) and .length are permitted and flow through.
    const guarded = new Proxy(cmds, {
      get(target, prop, receiver) {
        if (prop === 'slice') {
          throw new Error('PRD-708 violation: tick() must not call .slice()');
        }
        if (prop === Symbol.iterator) {
          throw new Error('PRD-708 violation: tick() must not use for...of on commands (allocates iterator object)');
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(() => tick(world, guarded)).not.toThrow();
    expect(world.tick).toBe(1);
  });
});

describe('SCEN-06 determinism', () => {
  // Phase 5 tick() is a stub; tick does not advance PRNG state. This test still locks the contract
  // and will catch non-determinism the moment Phase 6 adds PRNG usage.
  it('same seed produces identical { tick, rngState, nextEntityId } across two independent runs', () => {
    const run1 = runSim(42, 100);
    const run2 = runSim(42, 100);
    expect(run1).toEqual(run2);
  });

  it('100 ticks with seed 42 yields tick === 100', () => {
    const result = runSim(42, 100);
    expect(result.tick).toBe(100);
  });
});
