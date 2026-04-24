// fighter-rally-hold.test.ts — regression tests for the rally hold-radius fix.
//
// Bug: in debug snapshot subterrans-debug-seed1019075463-tick10204.json,
// four Fighting ants (ids 39, 41, 55, 61) clustered around colony 1's
// rallyPoint={tileX:99, tileY:58} visibly stutter ABAB between tiles every
// tick. Root cause: updateFightAntTargets (ant-system.ts tick step 10c)
// unconditionally writes the EXACT tile-center of the rally tile as
// targetPosX/targetPosY for every surface Fighting ant every tick. The
// occupancy resolver (resolveSameColonyOccupancy, post-movement pass) then
// bumps collided same-colony ants one tile N/E/S/W — and on the NEXT tick
// updateFightAntTargets re-writes the same rally target, so the fighter
// walks back, collides again, gets bumped again. Visible ABAB oscillation.
//
// Fix: updateFightAntTargets clears the target to -1 when the fighter is
// already within Manhattan RALLY_HOLD_RADIUS_TILES of the rally. The
// Fighting branch in tickAntMovement treats targetPosX/Y === -1 as "no
// target → dx=dy=0 hold in place". The occupancy resolver then sees
// distinct starting tiles, bumps nothing, ants stay put. No oscillation.
//
// Radius is 2 (Manhattan): the 13-tile hold zone (center + 12 M2 tiles)
// comfortably absorbs the occupancy resolver's single-step bump footprint
// for any realistic rally-gathering group, and still feels "at the rally"
// to the player visually.

import { describe, it, expect } from 'vitest';
import { tick } from './tick.js';
import { updateFightAntTargets } from './ant/ant-system.js';
import { createWorldState, allocateEntityId } from './types.js';
import { createColonyRecord } from './colony/colony-store.js';
import { initAnt } from './ant/ant-store.js';
import { AntTask, FightingSubState } from './enums.js';
import { Zone } from './terrain.js';
import { FP_SHIFT, FP_ONE } from './fixed.js';
import { WORKER_BASE_SPEED, WORKER_LIFESPAN_TICKS } from './constants.js';
import type { WorldState } from './types.js';
import type { ColonyId } from './colony/colony-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLONY_ID = 1 as ColonyId;

interface RallyWorld {
  world:       WorldState;
  fighterIds:  number[];
  rallyTileX:  number;
  rallyTileY:  number;
}

/**
 * Build a single-colony world with a queen far from the rally + N Fighting
 * ants placed at the given starting tiles. Rally is set to (rallyTileX,
 * rallyTileY). No entrances, no underground grid — surface-only scenario.
 */
function buildRallyWorld(
  rallyTileX: number,
  rallyTileY: number,
  startTiles: Array<readonly [number, number]>,
): RallyWorld {
  const world = createWorldState(42);

  // Queen at a distant tile — she must exist so checkQueenDeath doesn't fire
  // Defeat (queenEntityId defaults to 0, and ants.alive[0] would be 0 without
  // a real queen allocation). Place her far from the rally so she isn't in
  // any fighter's hold zone or bump path.
  const queenId = allocateEntityId(world);
  initAnt(world.ants, queenId, {
    colonyId: COLONY_ID,
    posX:     (5 << FP_SHIFT) + (FP_ONE >> 1),
    posY:     (5 << FP_SHIFT) + (FP_ONE >> 1),
    task:     AntTask.Idle,
    subTask:  0,
    speed:    0,
    lifespan: WORKER_LIFESPAN_TICKS,
    zone:     Zone.Surface,
  });

  const colony = createColonyRecord(COLONY_ID, queenId);
  colony.entrances         = [];
  colony.rallyPoint        = { tileX: rallyTileX, tileY: rallyTileY };
  colony.digFlowFieldDirty = false;
  colony.foodStored        = 100000; // ample — no starvation during the run
  world.colonies[COLONY_ID] = colony;

  const fighterIds: number[] = [];
  for (const [tx, ty] of startTiles) {
    const id = allocateEntityId(world);
    initAnt(world.ants, id, {
      colonyId: COLONY_ID,
      posX:     (tx << FP_SHIFT) + (FP_ONE >> 1),
      posY:     (ty << FP_SHIFT) + (FP_ONE >> 1),
      task:     AntTask.Fighting,
      subTask:  FightingSubState.MovingToRally,
      speed:    WORKER_BASE_SPEED,
      lifespan: WORKER_LIFESPAN_TICKS,
      zone:     Zone.Surface,
    });
    colony.workers.push(id);
    colony.workerCount += 1;
    fighterIds.push(id);
  }

  return { world, fighterIds, rallyTileX, rallyTileY };
}

function tileXOf(world: WorldState, id: number): number {
  return world.ants.posX[id]! >> FP_SHIFT;
}
function tileYOf(world: WorldState, id: number): number {
  return world.ants.posY[id]! >> FP_SHIFT;
}
function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Run N ticks (drain command queue each tick; there are no commands). */
function tickN(world: WorldState, n: number): void {
  for (let t = 0; t < n; t++) {
    const cmds = world.commandQueue.splice(0);
    tick(world, cmds);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fighter rally hold — anti-oscillation (snapshot-reproduction bug)', () => {
  // Tile coords taken directly from the reporting debug snapshot
  // subterrans-debug-seed1019075463-tick10204.json: colony 1 rallyPoint
  // {tileX:99, tileY:58}, 4 fighters observed at (99,58), (99,57), (99,56),
  // (100,58) — a 4-tile cross around the rally, the classic single-step
  // occupancy-bump footprint.
  const RALLY_X = 99;
  const RALLY_Y = 58;

  it('Test 1: six clustered fighters stabilize within the hold radius without oscillating ABAB', () => {
    // Six fighters placed at 6 distinct tiles: rally center + 4 cardinals
    // (radius 1) + a radius-2 tile. All within the target radius-2 hold
    // zone. With the hold-radius fix each fighter sees target=-1 and holds
    // (dx=dy=0). Without the fix each fighter re-targets the rally center
    // every tick, walks toward it, collides, gets bumped — visible ABAB.
    const startTiles: Array<readonly [number, number]> = [
      [RALLY_X,     RALLY_Y    ], // center
      [RALLY_X,     RALLY_Y - 1], // N
      [RALLY_X + 1, RALLY_Y    ], // E
      [RALLY_X,     RALLY_Y + 1], // S
      [RALLY_X - 1, RALLY_Y    ], // W
      [RALLY_X,     RALLY_Y - 2], // N2 (radius 2)
    ];
    const { world, fighterIds } = buildRallyWorld(RALLY_X, RALLY_Y, startTiles);

    // MANDATORY t=0 preconditions — confirm harness staged the scenario.
    expect(fighterIds.length).toBe(6);
    for (const id of fighterIds) {
      expect(world.ants.alive[id]).toBe(1);
      expect(world.ants.task[id]).toBe(AntTask.Fighting);
      expect(world.ants.zone[id]).toBe(Zone.Surface);
    }
    // No two fighters share a starting tile (precondition for the
    // "tile-end distinct" invariant assertion below — if setup broke and
    // two fighters started on the same tile, the resolver would move
    // one on tick 1 and the assertion would be meaningless).
    const startKeys = new Set<string>();
    for (const id of fighterIds) {
      startKeys.add(`${tileXOf(world, id)},${tileYOf(world, id)}`);
    }
    expect(startKeys.size).toBe(6);

    // Act — record each fighter's tile AND fixed-point position at every
    // tick. The tile coord is what the player "sees" in the debugger — but
    // occupancy-bump oscillation can be invisible at tile resolution if
    // the ant's movement in a tick undershoots the bump distance (e.g.
    // speed=0.5 tile/tick leaves the ant at half-tile fp positions that
    // floor to the same tile). The fp position is what the render layer
    // interpolates between (prev → current frame), so fp-level ABAB shows
    // up visually as jitter even when tile coords look stable across
    // end-of-tick snapshots.
    const TICKS = 30;
    interface Snap { tileX: number; tileY: number; posX: number; posY: number }
    const trace: Snap[][] = [];
    for (let t = 0; t < TICKS; t++) {
      const cmds = world.commandQueue.splice(0);
      tick(world, cmds);
      const snap: Snap[] = [];
      for (const id of fighterIds) {
        snap.push({
          tileX: tileXOf(world, id),
          tileY: tileYOf(world, id),
          posX:  world.ants.posX[id]!,
          posY:  world.ants.posY[id]!,
        });
      }
      trace.push(snap);
    }

    // Assertion A: no two fighters ever share a tile at tick-end (sanity —
    // the occupancy resolver already enforces this; confirms the resolver
    // is functioning and no fighter was accidentally teleported).
    for (let t = 0; t < TICKS; t++) {
      const perTickKeys = new Set<string>();
      for (const s of trace[t]!) {
        perTickKeys.add(`${s.tileX},${s.tileY}`);
      }
      expect(perTickKeys.size).toBe(6);
    }

    // Assertion B: after TICKS ticks, every fighter is within Manhattan
    // radius 3 of the rally — fighters stayed gathered. Radius 3 (not 2)
    // tolerates a single occupancy-bump step outside the hold zone, which
    // is legal transient state but should NOT repeat.
    for (const id of fighterIds) {
      const d = manhattan(tileXOf(world, id), tileYOf(world, id), RALLY_X, RALLY_Y);
      expect(d).toBeLessThanOrEqual(3);
    }

    // Assertion C (the RED discriminator): over the last 10 ticks each
    // fighter's fixed-point (posX, posY) MUST be stable — exactly one
    // unique fp coordinate per ant. Oscillating at fp-resolution makes
    // this set size ≥ 2; holding in place (target=-1 → dx=dy=0) makes
    // it 1. The unfixed code fails here because the occupancy resolver
    // snaps a bumped ant to `tile << FP_SHIFT` while the next tick's
    // "walk toward rally tile center" target is `(tile << FP_SHIFT) +
    // (FP_ONE >> 1)` — the ant moves +128 fp each tick and gets bumped
    // back the next tick, producing a two-state fp cycle that the
    // renderer interpolates as visible jitter.
    const TAIL = 10;
    const startIdx = TICKS - TAIL;
    for (let fi = 0; fi < fighterIds.length; fi++) {
      const positions = new Set<string>();
      for (let t = startIdx; t < TICKS; t++) {
        const s = trace[t]![fi]!;
        positions.add(`${s.posX},${s.posY}`);
      }
      expect(positions.size).toBe(1);
    }
  });

  it('Test 2: far-away fighter still travels toward rally (hold-radius must not strand distant fighters)', () => {
    const { world, fighterIds } = buildRallyWorld(RALLY_X, RALLY_Y, [[5, 5]]);
    const id = fighterIds[0]!;

    // MANDATORY t=0 preconditions.
    const d0 = manhattan(tileXOf(world, id), tileYOf(world, id), RALLY_X, RALLY_Y);
    expect(d0).toBe(Math.abs(5 - RALLY_X) + Math.abs(5 - RALLY_Y));
    expect(world.ants.task[id]).toBe(AntTask.Fighting);

    tickN(world, 50);

    // Outcome — the fighter moved strictly closer to the rally.
    const dN = manhattan(tileXOf(world, id), tileYOf(world, id), RALLY_X, RALLY_Y);
    expect(dN).toBeLessThan(d0);
  });

  it('Test 3: fighter exactly at rally → updateFightAntTargets clears target to -1', () => {
    const { world, fighterIds } = buildRallyWorld(RALLY_X, RALLY_Y, [[RALLY_X, RALLY_Y]]);
    const id = fighterIds[0]!;

    // MANDATORY t=0 preconditions.
    expect(tileXOf(world, id)).toBe(RALLY_X);
    expect(tileYOf(world, id)).toBe(RALLY_Y);
    expect(world.ants.task[id]).toBe(AntTask.Fighting);
    expect(world.ants.zone[id]).toBe(Zone.Surface);

    updateFightAntTargets(world);

    // Outcome — target cleared (hold in place).
    expect(world.ants.targetPosX[id]).toBe(-1);
    expect(world.ants.targetPosY[id]).toBe(-1);
  });

  it('Test 4: fighter one tile east of rally (Manhattan=1, inside radius 2) → target cleared to -1', () => {
    const { world, fighterIds } = buildRallyWorld(RALLY_X, RALLY_Y, [[RALLY_X + 1, RALLY_Y]]);
    const id = fighterIds[0]!;

    // MANDATORY t=0 preconditions.
    expect(manhattan(tileXOf(world, id), tileYOf(world, id), RALLY_X, RALLY_Y)).toBe(1);
    expect(world.ants.task[id]).toBe(AntTask.Fighting);
    expect(world.ants.zone[id]).toBe(Zone.Surface);

    updateFightAntTargets(world);

    // Outcome — inside radius → target cleared.
    expect(world.ants.targetPosX[id]).toBe(-1);
    expect(world.ants.targetPosY[id]).toBe(-1);
  });

  it('Test 5: fighter three tiles west of rally (Manhattan=3, OUTSIDE radius 2) → target is rally tile center', () => {
    const { world, fighterIds } = buildRallyWorld(RALLY_X, RALLY_Y, [[RALLY_X - 3, RALLY_Y]]);
    const id = fighterIds[0]!;

    // MANDATORY t=0 preconditions.
    expect(manhattan(tileXOf(world, id), tileYOf(world, id), RALLY_X, RALLY_Y)).toBe(3);
    expect(world.ants.task[id]).toBe(AntTask.Fighting);
    expect(world.ants.zone[id]).toBe(Zone.Surface);

    updateFightAntTargets(world);

    // Outcome — outside radius → target is the rally tile center fp.
    expect(world.ants.targetPosX[id]).toBe((RALLY_X << FP_SHIFT) + (FP_ONE >> 1));
    expect(world.ants.targetPosY[id]).toBe((RALLY_Y << FP_SHIFT) + (FP_ONE >> 1));
  });
});
