import { expect, test, type Page } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

async function boot(page: Page) {
  await page.goto('/dj');
  await page.getByTestId('dj-start').click();
  await page.waitForFunction(() => window.__dj?.ready === true, null, { timeout: 60_000 });
}

async function load(page: Page, deck: 0 | 1, trackId: string) {
  await page.getByTestId(`browse-${deck}`).click();
  await page.getByTestId(`track-row-${trackId}`).click();
  await page.waitForFunction(([d, id]) => window.__dj!.deck(d as 0 | 1).loaded && window.__dj!.deck(d as 0 | 1).trackId === id, [deck, trackId] as const, {
    timeout: 60_000,
  });
}

test('loads a track via BROWSE and PLAY advances the position', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page);
  await load(page, 0, 'test-tidal');
  const start = await page.evaluate(() => window.__dj!.deck(0).posSec);
  await page.getByTestId('play-0').click();
  await page.waitForTimeout(1500);
  const d = await page.evaluate(() => window.__dj!.deck(0));
  expect(d.state).toBe('PLAYING');
  expect(d.posSec - start).toBeGreaterThan(1);
  expect(d.bpm).toBeCloseTo(124, 1);
  expect(errors()).toEqual([]);
});

test('SYNC matches the follower BPM to the master', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page);
  await load(page, 0, 'test-tidal'); // 124 BPM
  await load(page, 1, 'test-sunrise'); // 120 BPM
  await page.getByTestId('play-0').click();
  await page.waitForTimeout(300);
  await page.getByTestId('sync-1').click();
  await page.getByTestId('play-1').click();
  await page.waitForTimeout(1500);
  const [master, follower] = await page.evaluate(() => [window.__dj!.deck(0), window.__dj!.deck(1)]);
  expect(await page.evaluate(() => window.__dj!.master())).toBe(0);
  expect(follower.synced).toBe(true);
  expect(Math.abs(follower.bpm - master.bpm)).toBeLessThan(0.63); // ≤ 0.5 % PLL trim
  expect(errors()).toEqual([]);
});

test('loading onto a playing, on-air deck needs a second tap', async ({ page }) => {
  await boot(page);
  await load(page, 0, 'test-tidal');
  await page.getByTestId('play-0').click();
  const fader = await page.getByRole('slider', { name: 'CH 1' }).boundingBox();
  if (!fader) throw new Error('channel fader not found');
  await page.mouse.move(fader.x + fader.width / 2, fader.y + fader.height - 2);
  await page.mouse.down();
  await page.mouse.move(fader.x + fader.width / 2, fader.y + 2, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('browse-0').click();
  await page.getByTestId('track-row-test-midnight').click();
  await expect(page.getByText('DECK ON AIR — TAP AGAIN TO LOAD')).toBeVisible();
  expect(await page.evaluate(() => window.__dj!.deck(0).trackId)).toBe('test-tidal');
  await page.getByTestId('track-row-test-midnight').click();
  await page.waitForFunction(() => window.__dj!.deck(0).trackId === 'test-midnight');
});

test('phone landscape: three swipeable full-size panels, playable by touch', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await boot(page);
  // starts on the mixer panel
  expect(await page.evaluate(() => window.__dj!.state().ui.mobilePanel)).toBe(1);
  await expect(page.getByTestId('fader-ch-0')).toBeInViewport();
  await page.getByRole('button', { name: 'Deck 1' }).click();
  await expect.poll(() => page.evaluate(() => window.__dj!.state().ui.mobilePanel)).toBe(0);
  const play = await page.getByTestId('play-0').boundingBox();
  expect(play?.width).toBeGreaterThanOrEqual(60); // native 64 px round button, not shrunk to fit
  await load(page, 0, 'test-tidal');
  const start = await page.evaluate(() => window.__dj!.deck(0).posSec);
  await page.getByTestId('play-0').click();
  await page.waitForTimeout(1000);
  expect((await page.evaluate(() => window.__dj!.deck(0).posSec)) - start).toBeGreaterThan(0.5);
  expect(errors()).toEqual([]);
});
