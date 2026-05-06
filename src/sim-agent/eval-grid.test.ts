import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EVAL_SEEDS,
  runEvalGrid,
  SIM_AGENT_EVAL_GRID_SCHEMA,
} from './eval-grid.js';

describe('runEvalGrid', () => {
  it('runs a tiny grid and returns summary', () => {
    const r = runEvalGrid({
      seeds: [7],
      scenarioIds: ['default', 'invasion_probe'],
      policies: ['noop'],
      maxTicks: 20,
      opponentMode: 'none',
    });
    expect(r.schema).toBe(SIM_AGENT_EVAL_GRID_SCHEMA);
    expect(r.summary.total).toBe(2);
    expect(r.summary.passed + r.summary.failed).toBe(2);
    expect(r.cells.every((c) => c.seed === 7)).toBe(true);
    expect(r.cells[0]!.policy).toBe('noop');
  });

  it('default product size for shipped defaults', () => {
    const n =
      DEFAULT_EVAL_SEEDS.length * 4 * 2; // 4 scenarios × 2 policies
    const r = runEvalGrid({
      seeds: DEFAULT_EVAL_SEEDS,
      scenarioIds: ['default', 'invasion_probe', 'economy_stress', 'combat_stance'],
      policies: ['noop', 'heuristic'],
      maxTicks: 15,
      opponentMode: 'none',
    });
    expect(r.summary.total).toBe(n);
  });
});
