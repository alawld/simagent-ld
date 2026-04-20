// src/sim/commands.ts
// SimCommand discriminated union and command queue constants.
// Phase 5 union is NoOpCommand only; Phase 6 expands to 4-variant union.
// Phase 7 adds 3 variants: CancelDigMark, PlaceChamber, DesignateEntrance.

import type { ColonyId, BehaviorRatio } from './colony/colony-store.js';
import type { ChamberType } from './enums.js';

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

/** PRD §3b — player cancels a previously-marked dig tile. */
export interface CancelDigMarkCommand extends SimCommandBase {
  readonly type: 'CancelDigMark';
  readonly colonyId: ColonyId;
  readonly tileX: number;
  readonly tileY: number;
}

/** PRD §3e — player places a chamber at a tunnel end. */
export interface PlaceChamberCommand extends SimCommandBase {
  readonly type: 'PlaceChamber';
  readonly colonyId: ColonyId;
  readonly chamberType: ChamberType;
  readonly anchorTileX: number;  // top-left tile X (accepted Phase 3 PRD command shape)
  readonly anchorTileY: number;  // top-left tile Y
}

/** PRD §3g — player designates a new nest entrance from the surface. */
export interface DesignateEntranceCommand extends SimCommandBase {
  readonly type: 'DesignateEntrance';
  readonly colonyId: ColonyId;
  readonly surfaceTileX: number;
  readonly surfaceTileY: number;
}

/** PRD §4 / SURF-04 — player sets a rally point at a surface tile for fight-assigned ants. */
export interface SetRallyPointCommand extends SimCommandBase {
  readonly type: 'SetRallyPoint';
  readonly colonyId: ColonyId;
  readonly tileX: number;
  readonly tileY: number;
}

/** PRD §4 / SURF-04 — player clears the existing rally point for a colony. */
export interface ClearRallyPointCommand extends SimCommandBase {
  readonly type: 'ClearRallyPoint';
  readonly colonyId: ColonyId;
}

export type SimCommand =
  | NoOpCommand
  | SetBehaviorRatioCommand
  | MarkDigTileCommand
  | MarkFoodPileCommand
  | CancelDigMarkCommand
  | PlaceChamberCommand
  | DesignateEntranceCommand
  | SetRallyPointCommand
  | ClearRallyPointCommand;

export const MAX_COMMANDS_PER_TICK = 64; // PRD §5 line 680 — FIFO silent-drop beyond cap
