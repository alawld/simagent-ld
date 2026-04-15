// Phase 5 scope: outcome enum only. checkQueenDeath is Phase 9 scope — see Phase 4 PRD §5a.

export const GameOutcome = {
  None: 0,
  Victory: 1,
  Defeat: 2,
  MutualDestruction: 3,
} as const;
export type GameOutcome = typeof GameOutcome[keyof typeof GameOutcome];
