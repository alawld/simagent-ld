// context-menu-state.test.ts — Vitest tests for the shared context-menu
// singleton and deferred-hide helpers.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  contextMenuState,
  hideContextMenu,
  requestHideContextMenu,
  applyPendingContextMenuHide,
} from './context-menu-state.js';

beforeEach(() => {
  contextMenuState.visible     = false;
  contextMenuState.pendingHide = false;
  contextMenuState.screenX     = 0;
  contextMenuState.screenY     = 0;
  contextMenuState.anchorTileX = 0;
  contextMenuState.anchorTileY = 0;
});

describe('hideContextMenu (immediate)', () => {
  it('sets visible=false synchronously and clears pendingHide', () => {
    contextMenuState.visible = true;
    contextMenuState.pendingHide = true;
    hideContextMenu();
    expect(contextMenuState.visible).toBe(false);
    expect(contextMenuState.pendingHide).toBe(false);
  });
});

describe('requestHideContextMenu (deferred)', () => {
  it('sets pendingHide but leaves visible=true until applyPendingContextMenuHide runs', () => {
    contextMenuState.visible = true;
    requestHideContextMenu();
    expect(contextMenuState.visible).toBe(true);
    expect(contextMenuState.pendingHide).toBe(true);
  });

  it('applyPendingContextMenuHide flips visible to false and clears pendingHide', () => {
    contextMenuState.visible = true;
    requestHideContextMenu();
    applyPendingContextMenuHide();
    expect(contextMenuState.visible).toBe(false);
    expect(contextMenuState.pendingHide).toBe(false);
  });

  it('applyPendingContextMenuHide is a no-op when no hide is pending', () => {
    contextMenuState.visible = true;
    applyPendingContextMenuHide();
    expect(contextMenuState.visible).toBe(true);
  });
});

describe('race-free semantics for pointerdown dispatch', () => {
  it('two consecutive handlers in the same frame both observe visible=true after requestHideContextMenu', () => {
    contextMenuState.visible = true;

    // Handler A (e.g., UIScene): processes menu selection and requests hide.
    const handlerAObservedVisible = contextMenuState.visible;
    requestHideContextMenu();

    // Handler B (e.g., underground-input) runs on the same pointerdown event,
    // still in the same JS event-loop turn. It must also see visible=true.
    const handlerBObservedVisible = contextMenuState.visible;

    expect(handlerAObservedVisible).toBe(true);
    expect(handlerBObservedVisible).toBe(true);

    // Only at the start of the NEXT frame does the hide apply.
    applyPendingContextMenuHide();
    expect(contextMenuState.visible).toBe(false);
  });
});
