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

test('security headers on every route: nosniff, referrer policy, no framing by other sites, no camera/mic/location', async ({ request }) => {
  for (const path of ['/', '/career', '/tracks/manifest.json']) {
    const h = (await request.get(path)).headers();
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['content-security-policy'], path).toBe("frame-ancestors 'self'");
    expect(h['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=()');
  }
});
