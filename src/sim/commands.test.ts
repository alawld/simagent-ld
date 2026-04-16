import { describe, it, expect } from 'vitest';
import {
  type SimCommand,
  type NoOpCommand,
  type SetBehaviorRatioCommand,
  type MarkDigTileCommand,
  type MarkFoodPileCommand,
  MAX_COMMANDS_PER_TICK,
} from './commands.js';

describe('SimCommand', () => {
  describe('NoOpCommand assignability', () => {
    it('NoOpCommand literal is assignable to SimCommand', () => {
      const cmd: SimCommand = { type: 'NoOp', issuedAtTick: 0 };
      expect(cmd.type).toBe('NoOp');
      expect(cmd.issuedAtTick).toBe(0);
    });

    it('NoOpCommand has type discriminant "NoOp"', () => {
      const cmd: NoOpCommand = { type: 'NoOp', issuedAtTick: 42 };
      expect(cmd.type).toBe('NoOp');
      expect(cmd.issuedAtTick).toBe(42);
    });
  });

  describe('SetBehaviorRatioCommand', () => {
    it('can be constructed with correct type literal and fields', () => {
      const cmd: SetBehaviorRatioCommand = {
        type: 'SetBehaviorRatio',
        colonyId: 1,
        ratio: { forage: 7, dig: 2, fight: 1 },
        issuedAtTick: 10,
      };
      expect(cmd.type).toBe('SetBehaviorRatio');
      expect(cmd.colonyId).toBe(1);
      expect(cmd.ratio.forage).toBe(7);
      expect(cmd.ratio.dig).toBe(2);
      expect(cmd.ratio.fight).toBe(1);
      expect(cmd.issuedAtTick).toBe(10);
    });

    it('is assignable to SimCommand union', () => {
      const cmd: SimCommand = {
        type: 'SetBehaviorRatio',
        colonyId: 2,
        ratio: { forage: 10, dig: 0, fight: 0 },
        issuedAtTick: 5,
      };
      expect(cmd.type).toBe('SetBehaviorRatio');
    });
  });

  describe('MarkDigTileCommand', () => {
    it('can be constructed with correct type literal and fields', () => {
      const cmd: MarkDigTileCommand = {
        type: 'MarkDigTile',
        colonyId: 1,
        tileX: 10,
        tileY: 20,
        issuedAtTick: 15,
      };
      expect(cmd.type).toBe('MarkDigTile');
      expect(cmd.colonyId).toBe(1);
      expect(cmd.tileX).toBe(10);
      expect(cmd.tileY).toBe(20);
      expect(cmd.issuedAtTick).toBe(15);
    });

    it('is assignable to SimCommand union', () => {
      const cmd: SimCommand = {
        type: 'MarkDigTile',
        colonyId: 3,
        tileX: 5,
        tileY: 8,
        issuedAtTick: 3,
      };
      expect(cmd.type).toBe('MarkDigTile');
    });
  });

  describe('MarkFoodPileCommand', () => {
    it('can be constructed with correct type literal and fields', () => {
      const cmd: MarkFoodPileCommand = {
        type: 'MarkFoodPile',
        colonyId: 1,
        tileX: 32,
        tileY: 64,
        issuedAtTick: 7,
      };
      expect(cmd.type).toBe('MarkFoodPile');
      expect(cmd.colonyId).toBe(1);
      expect(cmd.tileX).toBe(32);
      expect(cmd.tileY).toBe(64);
      expect(cmd.issuedAtTick).toBe(7);
    });

    it('is assignable to SimCommand union', () => {
      const cmd: SimCommand = {
        type: 'MarkFoodPile',
        colonyId: 4,
        tileX: 15,
        tileY: 30,
        issuedAtTick: 9,
      };
      expect(cmd.type).toBe('MarkFoodPile');
    });
  });

  describe('discriminated union type narrowing', () => {
    it('switch-case on cmd.type narrows to each variant correctly', () => {
      // This function's type correctness is validated by TypeScript at compile time.
      // The runtime test verifies the discriminant values are correct.
      function handleCommand(cmd: SimCommand): string {
        switch (cmd.type) {
          case 'NoOp':
            return `noop@${cmd.issuedAtTick}`;
          case 'SetBehaviorRatio':
            return `ratio:${cmd.colonyId}`;
          case 'MarkDigTile':
            return `dig:${cmd.tileX},${cmd.tileY}`;
          case 'MarkFoodPile':
            return `food:${cmd.tileX},${cmd.tileY}`;
          default: {
            // Exhaustive check — TypeScript will error here if a variant is unhandled
            const _exhaustive: never = cmd;
            return _exhaustive;
          }
        }
      }

      expect(handleCommand({ type: 'NoOp', issuedAtTick: 0 })).toBe('noop@0');
      expect(handleCommand({ type: 'SetBehaviorRatio', colonyId: 1, ratio: { forage: 5, dig: 3, fight: 2 }, issuedAtTick: 1 })).toBe('ratio:1');
      expect(handleCommand({ type: 'MarkDigTile', colonyId: 1, tileX: 4, tileY: 8, issuedAtTick: 2 })).toBe('dig:4,8');
      expect(handleCommand({ type: 'MarkFoodPile', colonyId: 1, tileX: 12, tileY: 16, issuedAtTick: 3 })).toBe('food:12,16');
    });
  });

  describe('MAX_COMMANDS_PER_TICK', () => {
    it('MAX_COMMANDS_PER_TICK is exactly 64', () => {
      expect(MAX_COMMANDS_PER_TICK).toBe(64);
    });

    it('an array of 64 NoOpCommands has length 64', () => {
      const cmds: SimCommand[] = Array.from({ length: 64 }, (_, i) => ({
        type: 'NoOp' as const,
        issuedAtTick: i,
      }));
      expect(cmds.length).toBe(64);
    });
  });
});
