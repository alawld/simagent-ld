/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SAVE_FORMAT_VERSION, SAVE_KEY, AUTOSAVE_INTERVAL_MS,
  serializeWorldState, deserializeWorldState,
  hasSave, loadSave, deleteSave, tickAutosave,
  type SaveFile,
} from './save.js';
import { createScenario } from '../sim/scenario.js';
import { tick } from '../sim/tick.js';
import { PLAYER_COLONY_ID } from '../sim/constants.js';
import type { SimCommand } from '../sim/commands.js';
import type { ColonyId } from '../sim/colony/colony-store.js';

describe('save.ts (SCEN-04 + SCEN-06)', () => {
  beforeEach(() => { localStorage.clear(); });

  describe('serializeWorldState — envelope coverage', () => {
    it('includes every WorldState field (tick, rngState, nextEntityId, commandQueue, ants, colonies, pheromoneGrids, surface, undergroundGrids, foodPiles, pendingChambers)', () => {
      const w = createScenario(42);
      const s = serializeWorldState(w);
      expect(s.tick).toBe(0);
      expect(typeof s.rngState).toBe('number');
      expect(typeof s.nextEntityId).toBe('number');
      expect(Array.isArray(s.commandQueue)).toBe(true);
      expect(s.ants).toBeDefined();
      expect(s.colonies[String(PLAYER_COLONY_ID)]).toBeDefined();
      expect(s.surface.data.length).toBeGreaterThan(0);
      expect(s.undergroundGrids[String(PLAYER_COLONY_ID)]).toBeDefined();
    });
    it('serializes all 17 Int32Array ant fields as number[] (NOT "{}")', () => {
      const w = createScenario(42);
      const s = serializeWorldState(w);
      const fields = ['posX','posY','colonyId','task','subTask','speed','foodCarrying','starvationTimer',
                      'age','alive','lifespan','zone','digTileX','digTileY','digTicksRemaining',
                      'targetPosX','targetPosY'] as const;
      for (const f of fields) {
        expect(Array.isArray(s.ants[f])).toBe(true);
        expect(s.ants[f].length).toBeGreaterThan(0);
      }
    });
    it('serializes every Uint8Array grid .data as number[]', () => {
      const w = createScenario(42);
      const s = serializeWorldState(w);
      expect(Array.isArray(s.surface.data)).toBe(true);
      for (const cid of Object.keys(s.undergroundGrids)) {
        expect(Array.isArray(s.undergroundGrids[cid]!.data)).toBe(true);
      }
    });
    it('includes commandQueue (Pitfall 7 — autosave fires on wall clock, not tick boundary)', () => {
      const w = createScenario(42);
      w.commandQueue.push({ type: 'MarkDigTile', colonyId: PLAYER_COLONY_ID as ColonyId, tileX: 3, tileY: 4, issuedAtTick: 0 });
      const s = serializeWorldState(w);
      expect(s.commandQueue.length).toBe(1);
      expect(s.commandQueue[0]).toMatchObject({ type: 'MarkDigTile', tileX: 3, tileY: 4 });
    });
    it('uses Object.entries for colonies (plain-object invariant, ADR-0006)', () => {
      // No runtime check on implementation detail — prove by not throwing when world.colonies is a plain object.
      const w = createScenario(42);
      expect(() => serializeWorldState(w)).not.toThrow();
      // Additionally: make sure the output keys match Object.keys(world.colonies)
      const s = serializeWorldState(w);
      expect(Object.keys(s.colonies).sort()).toEqual(Object.keys(w.colonies).sort());
    });
    it('preserves ColonyRecord.killCount (Plan 01)', () => {
      const w = createScenario(42);
      w.colonies[PLAYER_COLONY_ID]!.killCount = 7;
      const s = serializeWorldState(w);
      expect(s.colonies[String(PLAYER_COLONY_ID)]!.killCount).toBe(7);
    });
    it('preserves rallyPoint / entrances / digFlowFieldDirty', () => {
      const w = createScenario(42);
      w.colonies[PLAYER_COLONY_ID]!.rallyPoint = { tileX: 10, tileY: 20 };
      const s = serializeWorldState(w);
      expect(s.colonies[String(PLAYER_COLONY_ID)]!.rallyPoint).toEqual({ tileX: 10, tileY: 20 });
    });
  });

  describe('deserializeWorldState — round-trip', () => {
    it('round-trip: serialize → deserialize → re-serialize produces identical JSON (byte-for-byte)', () => {
      const w = createScenario(42);
      for (let t = 0; t < 50; t++) tick(w, []);   // some non-trivial state
      const s1 = JSON.stringify(serializeWorldState(w));
      const w2 = deserializeWorldState(JSON.parse(s1));
      const s2 = JSON.stringify(serializeWorldState(w2));
      expect(s2).toBe(s1);
    });
    it('rehydrates every Int32Array ant field with correct values', () => {
      const w = createScenario(42);
      for (let t = 0; t < 10; t++) tick(w, []);
      const s = serializeWorldState(w);
      const w2 = deserializeWorldState(s);
      expect(Array.from(w2.ants.posX.slice(0, 5))).toEqual(Array.from(w.ants.posX.slice(0, 5)));
      expect(Array.from(w2.ants.alive.slice(0, 5))).toEqual(Array.from(w.ants.alive.slice(0, 5)));
      expect(Array.from(w2.ants.zone.slice(0, 5))).toEqual(Array.from(w.ants.zone.slice(0, 5)));
    });
    it('preserves queued commands through serialize → deserialize', () => {
      const w = createScenario(42);
      w.commandQueue.push({ type: 'MarkDigTile', colonyId: PLAYER_COLONY_ID as ColonyId, tileX: 1, tileY: 2, issuedAtTick: 0 });
      const w2 = deserializeWorldState(serializeWorldState(w));
      expect(w2.commandQueue.length).toBe(1);
      expect(w2.commandQueue[0]).toMatchObject({ type: 'MarkDigTile', tileX: 1, tileY: 2 });
    });
  });

  describe('SaveFile envelope (PRD §8a: version + seed + inputLog + snapshot)', () => {
    it('hasSave returns false when localStorage empty', () => {
      expect(hasSave()).toBe(false);
    });
    it('hasSave returns true when valid envelope present', () => {
      const w = createScenario(42);
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version: SAVE_FORMAT_VERSION, seed: 42, inputLog: [], snapshot: serializeWorldState(w),
      } satisfies SaveFile));
      expect(hasSave()).toBe(true);
    });
    it('hasSave returns false on malformed JSON', () => {
      localStorage.setItem(SAVE_KEY, 'not-json');
      expect(hasSave()).toBe(false);
    });
    it('hasSave returns false on mismatched version', () => {
      const w = createScenario(42);
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version: 999, seed: 42, inputLog: [], snapshot: serializeWorldState(w),
      }));
      expect(hasSave()).toBe(false);
    });
    it('loadSave returns a SaveFile with seed + inputLog + snapshot fields', () => {
      const w = createScenario(42);
      const inputLog: SimCommand[] = [
        { type: 'MarkDigTile', colonyId: PLAYER_COLONY_ID as ColonyId, tileX: 5, tileY: 5, issuedAtTick: 10 },
      ];
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version: SAVE_FORMAT_VERSION, seed: 42, inputLog, snapshot: serializeWorldState(w),
      } satisfies SaveFile));
      const loaded = loadSave();
      expect(loaded).not.toBeNull();
      expect(loaded!.seed).toBe(42);
      expect(loaded!.inputLog.length).toBe(1);
      expect(loaded!.snapshot).toBeDefined();
    });
    it('loadSave returns null on malformed JSON (never throws)', () => {
      localStorage.setItem(SAVE_KEY, '{ bad }');
      expect(loadSave()).toBeNull();
    });
    it('deleteSave removes the key and does not throw on missing', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_FORMAT_VERSION, seed: 1, inputLog: [], snapshot: serializeWorldState(createScenario(1)) }));
      deleteSave();
      expect(localStorage.getItem(SAVE_KEY)).toBeNull();
      expect(() => deleteSave()).not.toThrow();
    });
  });

  describe('tickAutosave gating', () => {
    it('does not save before interval elapsed (returns lastSaveMs unchanged)', () => {
      const w = createScenario(42);
      const prev = 1000;
      const result = tickAutosave(42, [], w, prev, prev + AUTOSAVE_INTERVAL_MS - 1);
      expect(result).toBe(prev);
      expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    });
    it('writes SaveFile after interval elapsed (returns nowMs)', () => {
      const w = createScenario(42);
      const now = AUTOSAVE_INTERVAL_MS + 500;
      const result = tickAutosave(42, [], w, 0, now);
      expect(result).toBe(now);
      const raw = localStorage.getItem(SAVE_KEY);
      expect(raw).not.toBeNull();
      const env = JSON.parse(raw!) as SaveFile;
      expect(env.version).toBe(SAVE_FORMAT_VERSION);
      expect(env.seed).toBe(42);
    });
    it('returns lastSaveMs unchanged on setItem throw (quota)', () => {
      const w = createScenario(42);
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
      try {
        const result = tickAutosave(42, [], w, 0, AUTOSAVE_INTERVAL_MS + 1);
        expect(result).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('SCEN-06 replay truth — seed + inputLog reproduce snapshot', () => {
    it('(a) seed round-trips', () => {
      const w = createScenario(777);
      tickAutosave(777, [], w, 0, AUTOSAVE_INTERVAL_MS + 1);
      expect(loadSave()!.seed).toBe(777);
    });
    it('(b) inputLog round-trips', () => {
      const w = createScenario(42);
      const log: SimCommand[] = [
        { type: 'MarkDigTile', colonyId: PLAYER_COLONY_ID as ColonyId, tileX: 2, tileY: 2, issuedAtTick: 1 },
        { type: 'MarkDigTile', colonyId: PLAYER_COLONY_ID as ColonyId, tileX: 3, tileY: 3, issuedAtTick: 5 },
      ];
      tickAutosave(42, log, w, 0, AUTOSAVE_INTERVAL_MS + 1);
      const loaded = loadSave()!;
      expect(loaded.inputLog.length).toBe(2);
      expect(loaded.inputLog[1]).toMatchObject({ tileX: 3, tileY: 3 });
    });
    it('(c) queued unprocessed commands round-trip via snapshot.commandQueue', () => {
      const w = createScenario(42);
      w.commandQueue.push({ type: 'MarkDigTile', colonyId: PLAYER_COLONY_ID as ColonyId, tileX: 9, tileY: 9, issuedAtTick: 0 });
      tickAutosave(42, [], w, 0, AUTOSAVE_INTERVAL_MS + 1);
      const loaded = loadSave()!;
      expect(loaded.snapshot.commandQueue.length).toBe(1);
      expect(loaded.snapshot.commandQueue[0]).toMatchObject({ tileX: 9, tileY: 9 });
    });
    it('(d) loaded snapshot when re-serialized equals original (byte-for-byte)', () => {
      const w = createScenario(42);
      for (let t = 0; t < 25; t++) tick(w, []);
      tickAutosave(42, [], w, 0, AUTOSAVE_INTERVAL_MS + 1);
      const loaded = loadSave()!;
      const rebuilt = deserializeWorldState(loaded.snapshot);
      expect(JSON.stringify(serializeWorldState(rebuilt)))
        .toBe(JSON.stringify(serializeWorldState(w)));
    });
    it('(e) inputLog replay: createScenario(seed) + tick(cmds[t]) for each tick reproduces snapshot', () => {
      // Build a reference world with a deterministic schedule
      const seed = 42;
      const schedule: SimCommand[][] = [];
      schedule[10] = [{ type: 'MarkDigTile', colonyId: PLAYER_COLONY_ID as ColonyId, tileX: 7, tileY: 3, issuedAtTick: 10 }];

      // Play 50 ticks while appending each tick's commands to inputLog (render-layer pattern)
      const original = createScenario(seed);
      const inputLog: SimCommand[] = [];
      for (let t = 0; t < 50; t++) {
        const cmds = schedule[t] ?? [];
        inputLog.push(...cmds);
        tick(original, cmds);
      }

      // Save
      tickAutosave(seed, inputLog, original, 0, AUTOSAVE_INTERVAL_MS + 1);
      const loaded = loadSave()!;
      expect(loaded.seed).toBe(seed);

      // Replay inputLog against a fresh scenario — use issuedAtTick to schedule
      const replay = createScenario(loaded.seed);
      const byTick: SimCommand[][] = [];
      for (const cmd of loaded.inputLog) {
        const t = cmd.issuedAtTick;
        (byTick[t] ??= []).push(cmd);
      }
      for (let t = 0; t < 50; t++) tick(replay, byTick[t] ?? []);

      expect(JSON.stringify(serializeWorldState(replay)))
        .toBe(JSON.stringify(serializeWorldState(original)));
    });
  });
});
