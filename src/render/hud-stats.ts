// hud-stats.ts — Pure helpers for HUD-02 stats bar.
//
// Extracted from UIScene so the computation can be unit-tested under Node
// without a Phaser scene. The UIScene feeds these results into a Text object
// and a Graphics bar in its update() pass.
//
// HUD-02 contract (v1.0 REQUIREMENTS.md line 84):
//   Colony stats display: ant count, food stored, queen health.
//
// Ant count is the TOTAL population — workers + eggs + larvae + queen-if-alive
// (not just workerCount). Queen health is a percentage derived from
// queenStarvationTimer vs. STARVATION_GRACE_TICKS, shown as a bar + label.

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

/**
 * Compute the HUD stats snapshot for a colony.
 *
 * antCount: workers + eggs + larvae + (queen alive ? 1 : 0). The queen is
 * counted separately because ColonyRecord.workerCount tracks only worker
 * castes; eggs/larvae/queen are siblings in the ECS and the HUD contract
 * reports the combined colony population.
 *
 * foodDisplay: colony.foodStored >> FP_SHIFT (convert from fixed-point units
 * to human-readable integer food).
 *
 * queenHealthPct: clamp(queenStarvationTimer / STARVATION_GRACE_TICKS, 0, 1)
 * × 100, rounded to nearest integer. If the queen is dead, returns 0.
 */
export function computeHudStats(world: WorldState, colony: ColonyRecord): HudStats {
  const queenAlive  = isAlive(world.ants, colony.queenEntityId);
  const queenBit    = queenAlive ? 1 : 0;
  const antCount    = colony.workerCount + colony.eggCount + colony.larvaeCount + queenBit;
  const foodDisplay = colony.foodStored >> FP_SHIFT;

  let queenHealthPct = 0;
  if (queenAlive) {
    const raw   = colony.queenStarvationTimer / STARVATION_GRACE_TICKS;
    const t     = raw < 0 ? 0 : (raw > 1 ? 1 : raw);
    queenHealthPct = Math.round(t * 100);
  }

  return { antCount, foodDisplay, queenHealthPct, queenAlive };
}

/**
 * Format the left half of the HUD stats line: "Ants: N  Food: F".
 * The queen health portion is a separate color-coded Text widget so it can
 * be tinted independently without multi-color spans.
 */
export function formatStatsPrefix(s: HudStats): string {
  return `Ants: ${s.antCount}  Food: ${s.foodDisplay}`;
}
