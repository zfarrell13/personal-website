import { expect, test } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

test.describe('portal', () => {
  test('light by default, toggles to dark and starts the DJ booth', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const errors = trackConsoleErrors(page);
    await page.goto('/');
    const toggle = page.getByRole('switch');
    await expect(page.getByTestId('mode-caption')).toHaveText(/SURF/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.getByText('PRESS START').click();
    await expect(page).toHaveURL(/\/dj$/);
    expect(errors()).toEqual([]);
  });

  test('follows the OS dark preference and Enter starts', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.getByTestId('mode-caption')).toHaveText(/DJ/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mode-caption')).toHaveText(/SURF/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/surf$/);
  });
});

test('mode switch jumps between experiences and persists', async ({ page }) => {
  await page.goto('/surf');
  await page.getByTestId('mode-switch').click();
  await expect(page).toHaveURL(/\/dj$/);
  expect(await page.evaluate(() => localStorage.getItem('zf-mode'))).toBe('dark');
  await page.getByTestId('mode-switch').click();
  await expect(page).toHaveURL(/\/surf$/);
});

test('retro renderer draws frames without errors', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/dev/retro');
  await page.waitForFunction(() => (window.__retroFrames ?? 0) > 30);
  expect(errors()).toEqual([]);
});

test('track manifest is served', async ({ request }) => {
  const res = await request.get('/tracks/manifest.json');
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.version).toBe(1);
  expect(json.tracks.length).toBeGreaterThan(0);
});
