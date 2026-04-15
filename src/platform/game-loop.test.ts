import { describe, it, expect } from 'vitest';
import { createGameLoop, MS_PER_TICK, MAX_CATCHUP_TICKS } from './game-loop.js';
import { createWorldState } from '../sim/types.js';
import { GameOutcome } from '../sim/game-over.js';
import type { SimCommand } from '../sim/commands.js';

// Helper: create a spy tick function that records calls without advancing rngState etc.
function makeSpyTick(): {
  fn: (world: ReturnType<typeof createWorldState>, cmds: readonly SimCommand[]) => typeof GameOutcome[keyof typeof GameOutcome];
  calls: Array<{ cmdCount: number }>;
} {
  const calls: Array<{ cmdCount: number }> = [];
  const fn = (
    _world: ReturnType<typeof createWorldState>,
    cmds: readonly SimCommand[],
  ): typeof GameOutcome[keyof typeof GameOutcome] => {
    calls.push({ cmdCount: cmds.length });
    return GameOutcome.None;
  };
  return { fn, calls };
}

// Helper: create a NoOp command
function makeNoOp(tick: number): SimCommand {
  return { type: 'NoOp', issuedAtTick: tick };
}

describe('accumulator — within-budget regime', () => {
  it('three update(16.67) calls fire exactly 1 tick (RESEARCH.md Pattern 4)', () => {
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(16.67); // acc=16.67, ticks=0
    expect(calls.length).toBe(0);
    loop.update(16.67); // acc=33.34, ticks=0
    expect(calls.length).toBe(0);
    loop.update(16.67); // acc=50.01, ticks=1
    expect(calls.length).toBe(1);
  });

  it('update(50) fires exactly 1 tick', () => {
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(MS_PER_TICK);
    expect(calls.length).toBe(1);
  });

  it('update(49) then update(1) fires exactly 1 tick (50ms accumulated)', () => {
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(49);
    expect(calls.length).toBe(0);
    loop.update(1);
    expect(calls.length).toBe(1);
  });

  it('update(49) then update(2) fires exactly 1 tick (51ms, 1ms residual)', () => {
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(49);
    expect(calls.length).toBe(0);
    loop.update(2);
    expect(calls.length).toBe(1);
    expect(loop.accumulatorMs).toBeCloseTo(1, 5);
  });

  it('update(100) fires exactly 2 ticks (floor(100/50)=2)', () => {
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(100);
    expect(calls.length).toBe(2);
  });
});

describe('accumulator — over-budget regime', () => {
  it('update(1000) fires exactly MAX_CATCHUP_TICKS (5) ticks — spiral-of-death guard (PRD §3)', () => {
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(1000); // would be 20 ticks without clamp
    expect(calls.length).toBe(MAX_CATCHUP_TICKS);
    expect(calls.length).toBe(5);
  });

  it('update(10000) still fires exactly MAX_CATCHUP_TICKS (5) ticks — clamp is magnitude-independent', () => {
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(10000);
    expect(calls.length).toBe(MAX_CATCHUP_TICKS);
  });

  it('after update(1000), accumulatorMs === 0 (clamp=250; 5 ticks drain 250; residual=0)', () => {
    const { fn } = makeSpyTick();
    const loop = createGameLoop(fn, createWorldState(42));

    loop.update(1000); // clamp to 250; 5*50=250 drained; residual = 0
    expect(loop.accumulatorMs).toBe(0);
  });
});

describe('commandQueue drain', () => {
  it('drains commandQueue before tick call (3 commands → tickSpy called with cmdCount=3)', () => {
    const world = createWorldState(42);
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, world);

    world.commandQueue.push(makeNoOp(0), makeNoOp(0), makeNoOp(0));
    loop.update(MS_PER_TICK);

    expect(world.commandQueue.length).toBe(0); // drained before tick
    expect(calls.length).toBe(1);
    expect(calls[0]!.cmdCount).toBe(3);
  });

  it('100 commands passed through intact to tickSpy (cap enforcement is inside tick(), not accumulator)', () => {
    const world = createWorldState(42);
    const { fn, calls } = makeSpyTick();
    const loop = createGameLoop(fn, world);

    for (let i = 0; i < 100; i++) {
      world.commandQueue.push(makeNoOp(0));
    }
    loop.update(MS_PER_TICK);

    expect(calls.length).toBe(1);
    expect(calls[0]!.cmdCount).toBe(100);
  });
});

describe('determinism — accumulator + tick composition', () => {
  it('two loops with same seed and same update schedule produce identical world state (SCEN-06)', async () => {
    // Use the real tick from src/sim/tick.ts to verify end-to-end determinism.
    const { tick } = await import('../sim/tick.js');

    const worldA = createWorldState(12345);
    const worldB = createWorldState(12345);

    const loopA = createGameLoop(tick, worldA);
    const loopB = createGameLoop(tick, worldB);

    // Same update schedule applied to both loops.
    const schedule = [16, 17, 50, 33, 1000, 25, 50];
    for (const dt of schedule) {
      loopA.update(dt);
      loopB.update(dt);
    }

    // Sim-state fields must be bit-identical.
    expect({ tick: worldA.tick, rngState: worldA.rngState, nextEntityId: worldA.nextEntityId }).toEqual({
      tick: worldB.tick,
      rngState: worldB.rngState,
      nextEntityId: worldB.nextEntityId,
    });
  });
});
