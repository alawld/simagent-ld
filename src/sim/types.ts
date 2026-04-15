// src/sim/types.ts
// WorldState snapshot interface, factory, copy, and entity ID allocator.
// PRD §1/§3 authoritative shape — Phase 5 scope: four fields only.
// Phase 6 adds ants, colonies, pheromoneGrids. Phase 7 adds terrain.
import type { SimCommand } from './commands.js';

export type EntityId = number; // incrementing counter from 0, no recycling per PRD §1/§3

export interface WorldState {
  tick: number;             // 0 at creation; incremented once per tick
  rngState: number;         // Mulberry32 state (uint32); initialized from seed
  nextEntityId: EntityId;   // starts at 0 (PRD §3); allocateEntityId returns current and post-increments
  commandQueue: SimCommand[]; // staging seam — drained by platform accumulator between ticks
}

export function createWorldState(seed: number): WorldState {
  return {
    tick: 0,
    rngState: seed >>> 0, // coerce to uint32
    nextEntityId: 0,      // PRD §3 line 130: starts at 0, no recycling
    commandQueue: [],
  };
}

/** Copy src into dst in place — buffer swap for render interpolation (PRD §1/§3). */
export function copyWorldState(src: WorldState, dst: WorldState): void {
  dst.tick = src.tick;
  dst.rngState = src.rngState;
  dst.nextEntityId = src.nextEntityId;
  dst.commandQueue = src.commandQueue.slice(); // small in practice (user-input rate) — PRD §3 accepts this as the only Phase 1 allocation
}

/** Allocate a fresh entity ID. No recycling (PRD §1/§3 incrementing counter). */
export function allocateEntityId(world: WorldState): EntityId {
  const id = world.nextEntityId;
  world.nextEntityId = id + 1;
  return id;
}
