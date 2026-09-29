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
  const errors = trackConsoleErrors(page);
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
  // the engine has the new track (not just the store)
  await page.waitForFunction(() => window.__dj!.deck(0).loaded && window.__dj!.deck(0).trackId === 'test-midnight', null, { timeout: 60_000 });
  expect(errors()).toEqual([]);
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

test('phone landscape: a horizontal touch swipe changes the visible panel', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await boot(page);
  expect(await page.evaluate(() => window.__dj!.state().ui.mobilePanel)).toBe(1);
  // A real touch drag (compositor scrolling), starting on the empty panel area right of the mixer.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 200 }] });
  await touch('touchStart', 800);
  for (let x = 760; x >= 120; x -= 40) await touch('touchMove', x);
  await touch('touchEnd', 120);
  await expect.poll(() => page.evaluate(() => window.__dj!.state().ui.mobilePanel)).toBe(2);
  await expect(page.getByTestId('browse-1')).toBeInViewport(); // top of the deck 2 panel (the panel scrolls vertically)
});

test('jog scratch moves a paused deck by ~1.8 s per revolution', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page);
  await load(page, 1, 'test-sunrise');
  const before = await page.evaluate(() => window.__dj!.deck(1).posSec);
  const jog = await page.getByTestId('jog-1').boundingBox();
  if (!jog) throw new Error('jog not found');
  const cx = jog.x + jog.width / 2;
  const cy = jog.y + jog.height / 2;
  const r = jog.width * 0.3;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = (await page.evaluate(() => window.__dj!.deck(1).posSec)) - before;
  expect(moved).toBeGreaterThan(1.2);
  expect(moved).toBeLessThan(2.6);
  // released: the platter stays put (a final zero-velocity jog message was sent)
  const after = await page.evaluate(() => window.__dj!.deck(1).posSec);
  await page.waitForTimeout(300);
  expect(Math.abs((await page.evaluate(() => window.__dj!.deck(1).posSec)) - after)).toBeLessThan(0.01);
  expect(errors()).toEqual([]);
});

test('hot cue pad lights in its colour, loops light RELOOP/EXIT, and hot cues persist per track', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page);
  await load(page, 0, 'test-tidal');
  await page.getByTestId('play-0').click();
  await page.waitForTimeout(500);
  const pad = page.getByTestId('hotcue-0-A');
  await expect(pad).toHaveAttribute('data-lit', 'false');
  await pad.click();
  await expect(pad).toHaveAttribute('data-lit', 'true');
  await page.getByTestId('loop4-0').click();
  await expect(page.getByTestId('reloop-0')).toHaveAttribute('data-blink', 'slow');
  await page.getByTestId('reloop-0').click(); // exit: still defined → lit, not blinking
  await expect(page.getByTestId('reloop-0')).toHaveAttribute('data-lit', 'true');
  await expect(page.getByTestId('reloop-0')).not.toHaveAttribute('data-blink', 'slow');
  const stored = await page.evaluate(() => window.__dj!.state().decks[0].hotCues[0]);
  expect(stored?.color).toBe('#28e214');
  // reload and load the same track: the hot cue is still there
  await page.reload();
  await page.getByTestId('dj-start').click();
  await page.waitForFunction(() => window.__dj?.ready === true, null, { timeout: 60_000 });
  await load(page, 0, 'test-tidal');
  await expect(page.getByTestId('hotcue-0-A')).toHaveAttribute('data-lit', 'true');
  expect(await page.evaluate(() => window.__dj!.state().decks[0].hotCues[0])).toEqual(stored);
  expect(errors()).toEqual([]);
});
