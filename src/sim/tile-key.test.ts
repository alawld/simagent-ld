import { describe, it, expect } from 'vitest';
import { makeTileKey } from './tile-key.js';
import { Zone } from './terrain.js';

describe('makeTileKey', () => {
  it('encodes (Surface, 0, 0) to 0', () => {
    expect(makeTileKey(Zone.Surface, 0, 0)).toBe(0);
  });

  it('encodes (Surface, x, y) deterministically', () => {
    expect(makeTileKey(Zone.Surface, 5, 7)).toBe(makeTileKey(Zone.Surface, 5, 7));
  });

  it('produces distinct keys for Surface (5,7) vs Underground (5,7)', () => {
    const a = makeTileKey(Zone.Surface, 5, 7);
    const b = makeTileKey(Zone.Underground, 5, 7);
    expect(a).not.toBe(b);
  });

  it('produces distinct keys for different tile positions within the same zone', () => {
    expect(makeTileKey(Zone.Surface, 0, 0)).not.toBe(makeTileKey(Zone.Surface, 1, 0));
    expect(makeTileKey(Zone.Surface, 0, 0)).not.toBe(makeTileKey(Zone.Surface, 0, 1));
  });

  it('returns a 32-bit integer (no float drift)', () => {
    const k = makeTileKey(Zone.Underground, 127, 63);
    expect(Number.isInteger(k)).toBe(true);
    expect(k | 0).toBe(k);
  });
});
