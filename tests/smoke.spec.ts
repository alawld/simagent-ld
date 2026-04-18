import { test, expect, type ConsoleMessage } from '@playwright/test';

const errorFilter = (msg: ConsoleMessage) => msg.type() === 'error';

test.describe('Phase 8 smoke — boot, toggle, pan', () => {
  test('boot shows 800×592 canvas at :5173', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (errorFilter(msg)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/');
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'attached', timeout: 10_000 });

    // Fixed canvas size per HUD/VIEW spec (Phaser.Scale.NONE)
    await expect(canvas).toHaveAttribute('width', '800');
    await expect(canvas).toHaveAttribute('height', '592');

    // No pageerror or console error during boot
    expect(consoleErrors, consoleErrors.join('\n')).toHaveLength(0);
  });

  test('Tab toggles view without error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (errorFilter(msg)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/');
    await page.locator('canvas').first().waitFor({ state: 'attached' });

    // Give Phaser a few frames to settle before keyboard events.
    await page.waitForTimeout(200);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);

    expect(consoleErrors, consoleErrors.join('\n')).toHaveLength(0);
  });

  test('ArrowRight produces camera pan without error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (errorFilter(msg)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/');
    await page.locator('canvas').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(200);

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(150);

    // Canvas still mounted (no crash)
    await expect(page.locator('canvas').first()).toBeAttached();

    expect(consoleErrors, consoleErrors.join('\n')).toHaveLength(0);
  });

  test('screenshot artifact produced for human review', async ({ page }) => {
    await page.goto('/');
    await page.locator('canvas').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/phase-08-smoke.png',
      fullPage: false,
    });
  });
});
