// context-menu-layout.ts — Pure geometry + labels for the underground chamber
// context menu. Centralizes constants previously inlined in UIScene so the
// layout, hit-testing, and item labels all stay in sync and can be unit-tested.
//
// The menu presents three choices in a fixed order, one per ChamberType:
//   0: Queen
//   1: Nursery
//   2: Food Storage
//
// UIScene:
//   - calls drawContextMenuGeometry per frame (issues Graphics fillRect calls)
//   - creates three Phaser.Text labels once, positions them via itemLabelPos
//   - calls contextMenuItemAt for pointer hit-testing
//   - calls isInsideContextMenu to decide whether a click lands on the menu

import { ChamberType } from '../sim/enums.js';
import type { GfxLike } from './draw-surface.js';

export const CONTEXT_MENU = {
  WIDTH:       120,
  ITEM_HEIGHT: 24,
  ITEM_COUNT:  3,
} as const;

export const CONTEXT_MENU_HEIGHT = CONTEXT_MENU.ITEM_HEIGHT * CONTEXT_MENU.ITEM_COUNT;

export interface ContextMenuItem {
  chamberType: ChamberType;
  label:       string;
  stripeColor: number;
}

/**
 * Ordered menu items. Index corresponds to row offset from the top of the menu.
 * Order is part of the contract with contextMenuItemAt — do not reorder without
 * updating callers and tests.
 */
export const CONTEXT_MENU_ITEMS: readonly ContextMenuItem[] = [
  { chamberType: ChamberType.Queen,       label: 'Queen',        stripeColor: 0x4a1a4a },
  { chamberType: ChamberType.Nursery,     label: 'Nursery',      stripeColor: 0x1a4a1a },
  { chamberType: ChamberType.FoodStorage, label: 'Food Storage', stripeColor: 0x4a3a1a },
];

/**
 * Return the ChamberType under a screen point, or null if outside any item.
 * anchorX / anchorY are the top-left of the menu (contextMenuState.screenX/Y).
 */
export function contextMenuItemAt(
  px:      number,
  py:      number,
  anchorX: number,
  anchorY: number,
): ChamberType | null {
  const relX = px - anchorX;
  const relY = py - anchorY;
  if (relX < 0 || relX >= CONTEXT_MENU.WIDTH)              return null;
  if (relY < 0 || relY >= CONTEXT_MENU_HEIGHT)             return null;
  const idx = Math.floor(relY / CONTEXT_MENU.ITEM_HEIGHT);
  const item = CONTEXT_MENU_ITEMS[idx];
  return item ? item.chamberType : null;
}

/**
 * True if the screen point is inside the menu's outer rectangle.
 */
export function isInsideContextMenu(
  px:      number,
  py:      number,
  anchorX: number,
  anchorY: number,
): boolean {
  return (
    px >= anchorX && px < anchorX + CONTEXT_MENU.WIDTH &&
    py >= anchorY && py < anchorY + CONTEXT_MENU_HEIGHT
  );
}

/**
 * Pixel position for item i's text label (top-left). Callers set Phaser Text
 * objects to these coordinates; padding is 6px right, vertically centered.
 */
export function itemLabelPos(
  i:       number,
  anchorX: number,
  anchorY: number,
): { x: number; y: number } {
  return {
    x: anchorX + 6,
    y: anchorY + i * CONTEXT_MENU.ITEM_HEIGHT + 5,
  };
}

/**
 * Draw the menu background + stripes. Pure Graphics calls, compatible with
 * MockGfx in tests. Does NOT draw text — UIScene renders labels via
 * Phaser.GameObjects.Text children since GfxLike has no text API.
 */
export function drawContextMenuGeometry(
  gfx:     GfxLike,
  anchorX: number,
  anchorY: number,
): void {
  gfx.fillStyle(0x222222, 0.95);
  gfx.fillRect(anchorX, anchorY, CONTEXT_MENU.WIDTH, CONTEXT_MENU_HEIGHT);
  for (let i = 0; i < CONTEXT_MENU.ITEM_COUNT; i++) {
    const item = CONTEXT_MENU_ITEMS[i]!;
    gfx.fillStyle(item.stripeColor, 1);
    gfx.fillRect(
      anchorX + 2,
      anchorY + i * CONTEXT_MENU.ITEM_HEIGHT + 2,
      CONTEXT_MENU.WIDTH - 4,
      CONTEXT_MENU.ITEM_HEIGHT - 4,
    );
  }
}
