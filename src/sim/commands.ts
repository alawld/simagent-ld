// src/sim/commands.ts
// SimCommand discriminated union and command queue constants.
// Phase 5 union is NoOpCommand only; Phase 6+ adds SetBehaviorRatioCommand etc.

export interface SimCommandBase {
  readonly issuedAtTick: number; // tick-stamped per PRD §5
}

export interface NoOpCommand extends SimCommandBase {
  readonly type: 'NoOp';
}

export type SimCommand = NoOpCommand; // Phase 5 union is a single variant — kept as alias so later phases add | SetBehaviorRatioCommand | ...

export const MAX_COMMANDS_PER_TICK = 64; // PRD §5 line 680 — FIFO silent-drop beyond cap
