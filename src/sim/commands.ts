// src/sim/commands.ts
// SimCommand discriminated union and command queue constants.
// Phase 5 union is NoOpCommand only; Phase 6 expands to 4-variant union.

import type { ColonyId, BehaviorRatio } from './colony/colony-store.js';

export interface SimCommandBase {
  readonly issuedAtTick: number; // tick-stamped per PRD §5
}

export interface NoOpCommand extends SimCommandBase {
  readonly type: 'NoOp';
}

/** PRD §7g — player-issued behavior ratio change for a colony. */
export interface SetBehaviorRatioCommand extends SimCommandBase {
  readonly type: 'SetBehaviorRatio';
  readonly colonyId: ColonyId;
  readonly ratio: BehaviorRatio;
}

/** PRD §7g — player marks a tile for digging. Tile coordinates are integer, not fixed-point. */
export interface MarkDigTileCommand extends SimCommandBase {
  readonly type: 'MarkDigTile';
  readonly colonyId: ColonyId;
  readonly tileX: number;
  readonly tileY: number;
}

/** PRD §7g — player marks a food pile location. Tile coordinates are integer, not fixed-point. */
export interface MarkFoodPileCommand extends SimCommandBase {
  readonly type: 'MarkFoodPile';
  readonly colonyId: ColonyId;
  readonly tileX: number;
  readonly tileY: number;
}

export type SimCommand =
  | NoOpCommand
  | SetBehaviorRatioCommand
  | MarkDigTileCommand
  | MarkFoodPileCommand;

export const MAX_COMMANDS_PER_TICK = 64; // PRD §5 line 680 — FIFO silent-drop beyond cap
