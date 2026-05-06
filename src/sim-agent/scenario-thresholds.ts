// Pass/fail gates for named training scenarios (SimAgentPlan — eval grid).
//
// Rules (all use episode-end `SimAgentEpisodeResult` only):
//   - **default** / **unknown**: player queen alive; outcome not Defeat / MutualDestruction.
//   - **invasion_probe**: same + `metrics.scenarioExtras.playerSurfaceWorkerCount >= 1`.
//   - **economy_stress**: same as default + `metrics.playerFoodTotal > 0`.
//   - **combat_stance**: same as default (initial fight bias is not asserted after ticks — policies may retarget).
import { GameOutcome } from '../sim/game-over.js';
import type { SimAgentEpisodeResult } from './types.js';

export interface PassFailEvaluation {
  pass: boolean;
  /** Human-readable failure explanations (empty when `pass` is true). */
  reasons: string[];
}

function queenSurvivalOk(episode: SimAgentEpisodeResult): PassFailEvaluation {
  if (episode.metrics.playerQueenAlive !== 1) {
    return { pass: false, reasons: ['player queen not alive at episode end'] };
  }
  if (episode.outcome === GameOutcome.Defeat) {
    return { pass: false, reasons: ['game outcome Defeat'] };
  }
  if (episode.outcome === GameOutcome.MutualDestruction) {
    return { pass: false, reasons: ['game outcome MutualDestruction'] };
  }
  return { pass: true, reasons: [] };
}

/**
 * Deterministic pass/fail for **`scenarioId`** using only `SimAgentEpisodeResult`
 * (metrics + outcome). Unknown scenarios use the **default** gate (queen survival + no hard loss).
 */
export function evaluateScenarioPass(episode: SimAgentEpisodeResult): PassFailEvaluation {
  const id = episode.scenarioId;

  if (id === 'invasion_probe') {
    const n = episode.metrics.scenarioExtras.playerSurfaceWorkerCount;
    if (n === undefined || n < 1) {
      return {
        pass: false,
        reasons: [`invasion_probe: expected scenarioExtras.playerSurfaceWorkerCount >= 1, got ${String(n)}`],
      };
    }
    return queenSurvivalOk(episode);
  }

  if (id === 'economy_stress') {
    const q = queenSurvivalOk(episode);
    if (!q.pass) return q;
    if (episode.metrics.playerFoodTotal <= 0) {
      return { pass: false, reasons: ['economy_stress: colonyFoodTotal depleted to 0'] };
    }
    return { pass: true, reasons: [] };
  }

  if (id === 'combat_stance') {
    return queenSurvivalOk(episode);
  }

  // `default` and any unknown curriculum label
  return queenSurvivalOk(episode);
}
