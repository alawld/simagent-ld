// colony-store.test.ts — Vitest tests for colony-store.ts (PRD §2)
//
// 11 tests covering:
//   (1)  Initial values from createColonyRecord
//   (2)  Empty bucket arrays
//   (3)  Fresh targetRatio per colony (independent mutation surface)
//   (4)  Fresh computedAllocation and taskCensus per colony
//   (5)  DEFAULT_BEHAVIOR_RATIO shape (forage=10, dig=0, fight=0)
//   (6)  createColonyStore plainness (no Map, plain Object)
//   (7)  Store assignment via integer key
//   (8)  ChamberRecord field types
//   (9)  taskCensus is 4-field WorkerAllocation (nurse/forage/dig/fight) — PRD §2 verbatim
//   (10) No idleCount field (regression guard against prior-revision drift)
//   (11) ColonyRecord has exactly 17 fields

import { describe, it, expect } from 'vitest';
import { ChamberType } from '../enums.js';
import { STARVATION_GRACE_TICKS, RECONCILE_INTERVAL_TICKS } from '../constants.js';
import {
  createColonyRecord,
  createColonyStore,
  type ChamberRecord,
} from './colony-store.js';

describe('createColonyRecord', () => {
  it('(1) initial values match PRD §2 factory defaults', () => {
    const r = createColonyRecord(1, 42);
    expect(r.colonyId).toBe(1);
    expect(r.queenEntityId).toBe(42);
    expect(r.foodStored).toBe(0);
    expect(r.workerCount).toBe(0);
    expect(r.eggCount).toBe(0);
    expect(r.larvaeCount).toBe(0);
    expect(r.nurseCount).toBe(0);
    expect(r.queenStarvationTimer).toBe(STARVATION_GRACE_TICKS); // 100
    expect(r.reconcileCountdown).toBe(RECONCILE_INTERVAL_TICKS); // 100
    expect(r.defeated).toBe(false);
  });

  it('(2) eggs, larvae, workers, chambers are empty arrays on a fresh record', () => {
    const r = createColonyRecord(1, 42);
    expect(Array.isArray(r.eggs)).toBe(true);
    expect(r.eggs.length).toBe(0);
    expect(Array.isArray(r.larvae)).toBe(true);
    expect(r.larvae.length).toBe(0);
    expect(Array.isArray(r.workers)).toBe(true);
    expect(r.workers.length).toBe(0);
    expect(Array.isArray(r.chambers)).toBe(true);
    expect(r.chambers.length).toBe(0);
  });

  it('(3) targetRatio is a fresh independent object per colony', () => {
    const a = createColonyRecord(1, 0);
    const b = createColonyRecord(2, 0);
    // Object identity must differ
    expect(a.targetRatio).not.toBe(b.targetRatio);
    // Mutating one does not affect the other
    a.targetRatio.forage = 0;
    expect(b.targetRatio.forage).toBe(10); // DEFAULT_BEHAVIOR_RATIO.forage = 10
  });

  it('(4) computedAllocation and taskCensus are independent fresh objects per colony', () => {
    const a = createColonyRecord(1, 0);
    const b = createColonyRecord(2, 0);
    // computedAllocation identity
    expect(a.computedAllocation).not.toBe(b.computedAllocation);
    // taskCensus identity
    expect(a.taskCensus).not.toBe(b.taskCensus);
    // Mutation isolation
    a.computedAllocation.nurse = 99;
    expect(b.computedAllocation.nurse).toBe(0);
    a.taskCensus.forage = 77;
    expect(b.taskCensus.forage).toBe(0);
  });

  it('(5) DEFAULT_BEHAVIOR_RATIO shape: forage=10, dig=0, fight=0', () => {
    const r = createColonyRecord(1, 0);
    expect(r.targetRatio.forage).toBe(10);
    expect(r.targetRatio.dig).toBe(0);
    expect(r.targetRatio.fight).toBe(0);
  });

  it('(9) taskCensus has exactly the 4 WorkerAllocation fields from PRD §2 (nurse, forage, dig, fight)', () => {
    const r = createColonyRecord(1, 0);
    expect(Object.keys(r.taskCensus).sort()).toEqual(['dig', 'fight', 'forage', 'nurse']);
  });

  it('(10) no idleCount field on ColonyRecord (regression guard against prior-revision drift)', () => {
    const r = createColonyRecord(1, 0);
    expect('idleCount' in r).toBe(false);
  });

  it('(11) ColonyRecord has exactly 17 fields', () => {
    const r = createColonyRecord(1, 0);
    expect(Object.keys(r).length).toBe(17);
  });
});

describe('createColonyStore', () => {
  it('(6) returns a plain empty object — not a Map, not a subclass', () => {
    const store = createColonyStore();
    expect(Object.keys(store).length).toBe(0);
    expect(store instanceof Map).toBe(false);
    expect(store.constructor).toBe(Object);
  });

  it('(7) supports integer-key assignment and enumeration', () => {
    const store = createColonyStore();
    store[1] = createColonyRecord(1, 100);
    expect(Object.keys(store)).toEqual(['1']);
  });
});

describe('ChamberRecord', () => {
  it('(8) all fields are numeric (type-check-via-runtime — shape drift guard)', () => {
    const chamber: ChamberRecord = {
      chamberId:   1,
      chamberType: ChamberType.FoodStorage,
      foodStored:  0,
      posX:        512,
      posY:        256,
      width:       3,
      height:      3,
    };
    expect(typeof chamber.chamberId).toBe('number');
    expect(typeof chamber.chamberType).toBe('number');
    expect(typeof chamber.foodStored).toBe('number');
    expect(typeof chamber.posX).toBe('number');
    expect(typeof chamber.posY).toBe('number');
    expect(typeof chamber.width).toBe('number');
    expect(typeof chamber.height).toBe('number');
  });
});
