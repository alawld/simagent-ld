import { describe, it, expect } from 'vitest';
import { SimAgentHarness } from './harness.js';
import { dispatchJsonlRequest, parseJsonlRequest } from './jsonl-session.js';

describe('jsonl-session dispatch', () => {
  it('session replaces harness', () => {
    const cell = { harness: new SimAgentHarness({ seed: 1, opponentMode: 'none', recordInputLog: false }) };
    const r = dispatchJsonlRequest(cell, {
      op: 'session',
      seed: 42,
      scenarioId: 'default',
      opponentMode: 'ai',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.op).toBe('session');
    if (r.op === 'session') {
      expect(r.seed).toBe(42);
    }
    expect(cell.harness.getOpponentMode()).toBe('ai');
  });

  it('step advances tick', () => {
    const cell = { harness: new SimAgentHarness({ seed: 2, opponentMode: 'none', recordInputLog: false }) };
    const r = dispatchJsonlRequest(cell, { op: 'step', commands: [{ type: 'NoOp' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.op).toBe('step');
    if (r.op === 'step') {
      expect(r.tick).toBe(1);
      expect(r.observation.tick).toBe(1);
    }
  });

  it('observe returns observation without advancing tick', () => {
    const cell = { harness: new SimAgentHarness({ seed: 3, opponentMode: 'none', recordInputLog: false }) };
    expect(cell.harness.getWorld().tick).toBe(0);
    const r = dispatchJsonlRequest(cell, { op: 'observe' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.op === 'observe') {
      expect(r.tick).toBe(0);
    }
    expect(cell.harness.getWorld().tick).toBe(0);
  });

  it('repeatTicks batches steps', () => {
    const cell = { harness: new SimAgentHarness({ seed: 4, opponentMode: 'none', recordInputLog: false }) };
    const r = dispatchJsonlRequest(cell, { op: 'step', commands: [{ type: 'NoOp' }], repeatTicks: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.op === 'step') {
      expect(r.tick).toBe(5);
    }
  });

  it('parse rejects invalid op', () => {
    const p = parseJsonlRequest({ op: 'nope' });
    expect('ok' in p && p.ok === false).toBe(true);
  });

  it('exportSnapshot + loadSnapshot round-trip', () => {
    const cell = { harness: new SimAgentHarness({ seed: 5, opponentMode: 'none', recordInputLog: false }) };
    dispatchJsonlRequest(cell, { op: 'step', commands: [{ type: 'NoOp' }] });
    const ex = dispatchJsonlRequest(cell, { op: 'exportSnapshot' });
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    expect(ex.op).toBe('exportSnapshot');
    if (ex.op !== 'exportSnapshot') return;

    const cell2 = {
      harness: new SimAgentHarness({ seed: 0, opponentMode: 'none', recordInputLog: false }),
    };
    const ld = dispatchJsonlRequest(cell2, { op: 'loadSnapshot', snapshot: ex.snapshot });
    expect(ld.ok).toBe(true);
    if (!ld.ok) return;
    expect(ld.op).toBe('loadSnapshot');
    if (ld.op === 'loadSnapshot') {
      expect(ld.tick).toBe(1);
    }
  });

  it('pause prevents tick advance on step', () => {
    const cell = { harness: new SimAgentHarness({ seed: 6, opponentMode: 'none', recordInputLog: false }) };
    dispatchJsonlRequest(cell, { op: 'pause' });
    const st = dispatchJsonlRequest(cell, { op: 'step', commands: [{ type: 'NoOp' }] });
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    expect(st.op).toBe('step');
    if (st.op === 'step') {
      expect(st.tick).toBe(0);
    }
  });
});
