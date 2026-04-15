import { describe, it, expect } from 'vitest';
import { type SimCommand, type NoOpCommand, MAX_COMMANDS_PER_TICK } from './commands.js';

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
