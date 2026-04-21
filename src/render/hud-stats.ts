// hud-stats.ts — Pure helpers for HUD-02 stats bar.
//
// Extracted from UIScene so the computation + layout can be unit-tested under
// Node without a Phaser scene. UIScene feeds these results into Text widgets
// and a Graphics bar in its update() pass.
//
// HUD-02 contract — PRD §6c (04-PRD-playable-game-loop.md:908):
//   - 200×24 rect at (8, 8) with semi-transparent dark background (0x000000, α=0.6)
//   - Ant count = workerCount + (queen alive ? 1 : 0)
//     Phase 9 fix: eggs + larvae are deliberately excluded. The player's mental
//     model of "how many ants do I have" is "how many can act right now" — brood
//     are incapable until they hatch and promote. Folding them in made the
//     headline number confidently wrong (e.g. "Ants: 20" while only 5 workers
//     could forage or dig). A separate brood indicator can be added later if
//     the information is worth restoring.
//   - Food stored = foodStored >> FP_SHIFT, green-tinted indicator
//   - Queen health = visual bar derived from queenStarvationTimer / STARVATION_GRACE_TICKS
//     * green  when pct > 50  (healthy)
//     * yellow when 25 ≤ pct ≤ 50 (moderate)
//     * red    when pct < 25  (critical)
//     * dead queen renders empty bar in the critical color

import type { WorldState } from '../sim/types.js';
import type { ColonyRecord } from '../sim/colony/colony-store.js';
import { isAlive } from '../sim/ant/ant-store.js';
import { FP_SHIFT } from '../sim/fixed.js';
import { STARVATION_GRACE_TICKS } from '../sim/constants.js';

export interface HudStats {
  antCount:       number;
  foodDisplay:    number;
  queenHealthPct: number;
  queenAlive:     boolean;
}

export type QueenHealthState = 'dead' | 'critical' | 'moderate' | 'healthy';

export const HUD_STATS_COLORS = {
  background:      0x000000,
  backgroundAlpha: 0.6,
  barTrack:        0x333333,
  barHealthy:      0x22bb44,
  barModerate:     0xddaa22,
  barCritical:     0xcc3322,
  antsTextCss:     '#ffffff',
  foodTextCss:     '#22bb44',
} as const;

export const HUD_STATS_LAYOUT = {
  textRowYOffset: 6,
  queenBar: {
    w:          48,
    h:          6,
    yOffset:    9,
    rightInset: 6,
  },
} as const;

export function computeHudStats(world: WorldState, colony: ColonyRecord): HudStats {
  const queenAlive  = isAlive(world.ants, colony.queenEntityId);
  const queenBit    = queenAlive ? 1 : 0;
  // Phase 9 fix: count capable ants only (workers + living queen). Eggs and
  // larvae are excluded because they cannot execute any task; folding them in
  // produced a "total headcount" the player read as "usable headcount".
  const antCount    = colony.workerCount + queenBit;
  const foodDisplay = colony.foodStored >> FP_SHIFT;

  let queenHealthPct = 0;
  if (queenAlive) {
    const raw = colony.queenStarvationTimer / STARVATION_GRACE_TICKS;
    const t   = raw < 0 ? 0 : (raw > 1 ? 1 : raw);
    queenHealthPct = Math.round(t * 100);
  }

  return { antCount, foodDisplay, queenHealthPct, queenAlive };
}

export function formatAntsLabel(s: HudStats): string {
  return `Ants: ${s.antCount}`;
}

export function formatFoodLabel(s: HudStats): string {
  return `Food: ${s.foodDisplay}`;
}

export function queenHealthState(s: HudStats): QueenHealthState {
  if (!s.queenAlive)       return 'dead';
  if (s.queenHealthPct > 50)  return 'healthy';
  if (s.queenHealthPct >= 25) return 'moderate';
  return 'critical';
}

export function queenHealthBarColor(s: HudStats): number {
  switch (queenHealthState(s)) {
    case 'healthy':  return HUD_STATS_COLORS.barHealthy;
    case 'moderate': return HUD_STATS_COLORS.barModerate;
    case 'dead':
    case 'critical': return HUD_STATS_COLORS.barCritical;
  }
}

export function queenHealthBarFillWidth(s: HudStats, totalW: number): number {
  if (!s.queenAlive) return 0;
  const w = Math.round((totalW * s.queenHealthPct) / 100);
  if (w < 0)      return 0;
  if (w > totalW) return totalW;
  return w;
}

export interface QueenBarRect { x: number; y: number; w: number; h: number; }

export function queenBarRect(statsRect: { x: number; y: number; w: number; h: number }): QueenBarRect {
  const { w, h, yOffset, rightInset } = HUD_STATS_LAYOUT.queenBar;
  return {
    x: statsRect.x + statsRect.w - rightInset - w,
    y: statsRect.y + yOffset,
    w,
    h,
  };
}

/**
 * formatStatsPrefix — legacy helper retained for back-compat with any
 * test or caller that expected the combined "Ants: N  Food: N" string.
 * Prefer formatAntsLabel + formatFoodLabel, which are color-split per
 * PRD §6c (food gets its own green-tinted indicator).
 */
export function formatStatsPrefix(s: HudStats): string {
  return `${formatAntsLabel(s)}  ${formatFoodLabel(s)}`;
}
