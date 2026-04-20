// ui-scene-logic.ts — Pure helpers extracted from UIScene for testability.
//
// These functions have no Phaser dependency and can be unit-tested under Node (Vitest).
// UIScene imports and uses these; Plan 07 covers Phaser-coupled integration via Playwright.

import { GameOutcome } from '../sim/game-over.js';

// ---------------------------------------------------------------------------
// formatOutcomeTitle — maps GameOutcome to display text + color
// ---------------------------------------------------------------------------

/**
 * Returns the overlay title text and hex color for a given GameOutcome.
 * Used by UIScene to configure the GameOver overlay text.
 */
export function formatOutcomeTitle(outcome: GameOutcome): { text: string; color: number } {
  switch (outcome) {
    case GameOutcome.Victory:           return { text: 'VICTORY',           color: 0x00ff00 };
    case GameOutcome.Defeat:            return { text: 'DEFEAT',             color: 0xff0000 };
    case GameOutcome.MutualDestruction: return { text: 'MUTUAL DESTRUCTION', color: 0xffaa00 };
    case GameOutcome.None:
    default:                            return { text: '',                   color: 0x000000 };
  }
}

// ---------------------------------------------------------------------------
// formatKillStatsSubtitle — singular/plural kill count text
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable kill stats string for the GameOver overlay subtitle.
 * Singular: "1 enemy"; plural: "0 enemies", "2+ enemies".
 */
export function formatKillStatsSubtitle(killCount: number): string {
  const noun = killCount === 1 ? 'enemy' : 'enemies';
  return `Your colony killed ${killCount} ${noun}`;
}
