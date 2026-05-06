// Episode-level metrics for eval / experimentation (SimAgentPlan §3 B5) — reads WorldState only.
import type { WorldState } from '../sim/types.js';
import type { ColonyId } from '../sim/colony/colony-store.js';
import { colonyFoodTotal } from '../sim/colony/colony-system.js';
import { GameOutcome } from '../sim/game-over.js';
import { UndergroundTileState, Zone } from '../sim/terrain.js';
import type { SimAgentEpisodeMetrics } from './types.js';

function countPlayerSurfaceWorkers(world: WorldState, playerColonyId: ColonyId): number {
  const colony = world.colonies[playerColonyId];
  if (colony === undefined) return 0;
  let n = 0;
  for (let i = 0; i < colony.workers.length; i++) {
    const id = colony.workers[i]!;
    if (world.ants.alive[id] !== 1) continue;
    if (world.ants.zone[id] === Zone.Surface) n += 1;
  }
  return n;
}

function buildScenarioExtras(
  world: WorldState,
  scenarioId: string,
  playerColonyId: ColonyId,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (scenarioId === 'invasion_probe') {
    out.playerSurfaceWorkerCount = countPlayerSurfaceWorkers(world, playerColonyId);
  }
  if (scenarioId === 'economy_stress') {
    const c = world.colonies[playerColonyId];
    if (c !== undefined) out.playerEntranceFoodStored = c.foodStored;
  }
  if (scenarioId === 'combat_stance') {
    const c = world.colonies[playerColonyId];
    if (c !== undefined) out.playerFightRatioTarget = c.targetRatio.fight;
  }
  return out;
}

function countMarkedTiles(world: WorldState, colonyId: ColonyId): number {
  const grid = world.undergroundGrids[colonyId];
  if (grid === undefined) return 0;
  let n = 0;
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] === UndergroundTileState.Marked) n += 1;
  }
  return n;
}

/**
 * Snapshot numeric metrics after an episode (terminal or max-tick cap).
 * Safe to call from Node; no wall-clock in sim — callers add `wallClockMs` on the envelope.
 */
export function buildEpisodeMetrics(
  world: WorldState,
  args: {
    scenarioId: string;
    playerColonyId: ColonyId;
    enemyColonyIds: readonly ColonyId[];
    outcome: GameOutcome;
    cappedAtMaxTicks: boolean;
    inputLogCommandCount: number;
  },
): SimAgentEpisodeMetrics {
  const player = world.colonies[args.playerColonyId];
  const primaryEnemyId = args.enemyColonyIds[0];
  const enemy = primaryEnemyId !== undefined ? world.colonies[primaryEnemyId] : undefined;

  const playerQueenAlive =
    player !== undefined && world.ants.alive[player.queenEntityId] === 1 ? 1 : 0;
  const enemyQueenAlive =
    enemy !== undefined && world.ants.alive[enemy.queenEntityId] === 1 ? 1 : 0;

  const o = args.outcome;
  const scenarioExtras = buildScenarioExtras(world, args.scenarioId, args.playerColonyId);

  return {
    outcome: o,
    victory: o === GameOutcome.Victory ? 1 : 0,
    defeat: o === GameOutcome.Defeat ? 1 : 0,
    mutualDestruction: o === GameOutcome.MutualDestruction ? 1 : 0,
    finalTick: world.tick,
    cappedAtMaxTicks: args.cappedAtMaxTicks,
    playerFoodTotal: player !== undefined ? colonyFoodTotal(player) : 0,
    playerWorkerCount: player?.workerCount ?? 0,
    playerChamberCount: player?.chambers.length ?? 0,
    playerEggCount: player?.eggCount ?? 0,
    playerLarvaeCount: player?.larvaeCount ?? 0,
    playerQueenAlive,
    enemyQueenAlive: primaryEnemyId !== undefined ? enemyQueenAlive : 0,
    playerMarkedDigTileCount: player !== undefined ? countMarkedTiles(world, args.playerColonyId) : 0,
    inputLogCommandCount: args.inputLogCommandCount,
    scenarioExtras,
  };
}
