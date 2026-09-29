import { expect, test, type Page } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

async function dropIn(page: Page) {
  await page.goto('/surf');
  const drop = page.getByRole('button', { name: 'DROP IN' });
  await expect(drop).toBeVisible();
  await drop.click();
  await page.waitForFunction(() => window.__surf?.phase === 'playing');
}

test.describe('surf game', () => {
  test('boots to the title menu and the break side is selectable', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/surf');
    const left = page.getByRole('button', { name: 'LEFT' });
    const right = page.getByRole('button', { name: 'RIGHT' });
    await expect(right).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(left).toHaveAttribute('data-active', 'true');
    await right.click();
    await expect(right).toHaveAttribute('data-active', 'true');
    await page.waitForFunction(() => (window.__surf?.frames ?? 0) > 10);
    expect(errors()).toEqual([]);
  });

  test('the run starts and simulated keys change the score without console errors', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await dropIn(page);
    const f0 = await page.evaluate(() => window.__surf!.frames);
    await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 30, f0);
    // Each clean ollie banks 100 after the 1.5 s combo window.
    await expect
      .poll(
        async () => {
          await page.keyboard.press('Space');
          await page.waitForTimeout(2500);
          return page.evaluate(() => window.__surf?.score ?? 0);
        },
        { timeout: 60_000, intervals: [0] },
      )
      .toBeGreaterThan(0);
    await expect(page.getByTestId('score')).not.toHaveText('0');
    expect(errors()).toEqual([]);
  });

  test('Esc pauses and resumes', async ({ page }) => {
    await dropIn(page);
    await page.keyboard.press('Escape');
    await expect(page.getByText('PAUSED')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
  });

  test('holding stall gets you swallowed and shows the results screen', async ({ page }) => {
    await dropIn(page);
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window.__surf?.phase === 'results', undefined, { timeout: 60_000 });
    await page.keyboard.up('ArrowDown');
    await expect(page.getByText(/SWALLOWED BY THE BARREL/)).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
  });

  test('stays inside the draw-call and triangle budget', async ({ page }) => {
    await dropIn(page);
    await page.waitForTimeout(1500);
    const { calls, triangles } = await page.evaluate(() => window.__surf!);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(80);
    expect(triangles).toBeLessThan(150_000);
  });

  test('?debug shows the live tuning panel', async ({ page }) => {
    await page.goto('/surf?debug');
    await expect(page.getByTestId('debug-panel')).toBeVisible();
    await expect(page.getByText('physics.drive')).toBeVisible();
  });
});
