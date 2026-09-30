import { expect, test } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

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
