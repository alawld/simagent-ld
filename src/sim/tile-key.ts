// src/sim/tile-key.ts — shared per-tile key encoding (Phase 9).
//
// Used by combat.ts (detect same-tile same-zone collisions) and any future
// subsystem that needs a single integer identifying a (zone, tileX, tileY) triple.
//
// Encoding (32-bit int, little-endian semantics):
//   bits 24-31 : zone (0 = Surface, 1 = Underground)
//   bits 0-23  : tileY * GRID_WIDTH + tileX
//
// GRID_WIDTH = 128 for BOTH surface and underground (constants.ts:115, 121).
// If that invariant ever changes, THIS module must switch to per-zone strides
// and every call site becomes a single-file audit.
//
// Pure-sim: no Phaser, no DOM, no Math.*, zero allocation.

import { Zone } from './terrain.js';
import { SURFACE_GRID_WIDTH } from './constants.js';

/** Tile-key stride. See module header re: surface/underground parity. */
const TILE_KEY_STRIDE = SURFACE_GRID_WIDTH;

/**
 * Encode (zone, tileX, tileY) as a single int32 key.
 *
 * Callers MUST pass in-range coordinates; this module does not clamp.
 *
 * @param zone  - Zone.Surface (0) or Zone.Underground (1)
 * @param tileX - integer tile X (0 .. GRID_WIDTH-1)
 * @param tileY - integer tile Y (0 .. GRID_HEIGHT-1)
 */
export function makeTileKey(zone: Zone, tileX: number, tileY: number): number {
  return (((zone & 0xff) << 24) | (tileY * TILE_KEY_STRIDE + tileX)) | 0;
}
