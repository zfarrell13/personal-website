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
  await expect(page.getByTestId('trim-0')).toBeInViewport(); // top of the mixer panel (the panel scrolls vertically)
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
  const errors = trackConsoleErrors(page);
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
  expect(errors()).toEqual([]);
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

test('mixer panel: meters, isolator, colour FX, beat FX, headphones and output settings', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page);
  const mixer = page.getByTestId('mixer');
  // every control sits inside the mixer panel (nothing overflows the 420 × 900 layout)
  const box = (await mixer.boundingBox())!;
  for (const el of await mixer.locator('[data-testid], [role="slider"], button').all()) {
    const b = (await el.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(b.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }

  await load(page, 0, 'test-tidal');
  await page.getByTestId('play-0').click();
  const fader = (await page.getByRole('slider', { name: 'CH 1' }).boundingBox())!;
  await page.mouse.move(fader.x + fader.width / 2, fader.y + fader.height - 2);
  await page.mouse.down();
  await page.mouse.move(fader.x + fader.width / 2, fader.y + 2, { steps: 5 });
  await page.mouse.up();
  const lit = (label: string) => page.getByRole('img', { name: label }).locator('[data-on="true"]').count();
  await expect.poll(() => lit('Channel 1 level')).toBeGreaterThan(3);
  await expect.poll(() => lit('Master level')).toBeGreaterThan(3);
  expect(await lit('Channel 2 level')).toBe(0);

  // LOW kill: drag the knob all the way down
  const low = (await page.getByTestId('low-0').boundingBox())!;
  await page.mouse.move(low.x + low.width / 2, low.y + 20);
  await page.mouse.down();
  await page.mouse.move(low.x + low.width / 2, low.y + 400, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__dj!.state().mixer.ch[0].low)).toBe(0);

  await page.getByTestId('colorfx-SPACE').click();
  await expect(page.getByTestId('colorfx-SPACE')).toHaveAttribute('data-lit', 'true');
  await expect(page.getByTestId('colorfx-FILTER')).toHaveAttribute('data-lit', 'false');

  const lcd = page.getByTestId('beat-fx-lcd');
  await expect(lcd).toHaveText('ECHO 1');
  await page.getByTestId('beat-fx-next').click();
  await page.getByTestId('beat-up').click();
  await expect(lcd).toHaveText('PING PONG 2');
  for (let i = 0; i < 8; i++) await page.getByTestId('beat-down').click();
  await expect(lcd).toHaveText('PING PONG 1/8');
  await page.getByTestId('beat-fx-channel').click(); // MASTER → 1
  await expect(page.getByTestId('beat-fx-channel')).toHaveText('1');
  await page.getByTestId('beat-fx-on').click();
  await expect(page.getByTestId('beat-fx-on')).toHaveAttribute('data-blink', 'slow');

  await page.getByTestId('xf-assign-0').click();
  await expect(page.getByTestId('xf-assign-0')).toHaveText('B');
  await page.getByTestId('chcue-0').click();
  await page.getByTestId('hp-mode').click();
  const mx = await page.evaluate(() => window.__dj!.state().mixer);
  expect(mx.colorFxType).toBe('SPACE');
  expect(mx.beatFx).toMatchObject({ type: 'PING_PONG', divisionIndex: 0, channel: '1', on: true });
  expect(mx.ch[0]).toMatchObject({ xf: 'B', cue: true });
  expect(mx.hpMode).toBe('SPLIT');

  await mixer.screenshot({ path: test.info().outputPath('mixer.png') });

  await page.getByTestId('settings-toggle').click();
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();
  // Chromium supports setSinkId: the output picker is offered (Off = SPLIT on the main output)
  await expect(settings.getByRole('combobox', { name: 'Headphones output device' })).toHaveValue('');
  await page.screenshot({ path: test.info().outputPath('settings.png') });
  await settings.getByRole('button', { name: 'CLOSE' }).click();
  await expect(settings).toHaveCount(0);
  expect(errors()).toEqual([]);
});

test('Tab switches to the room view, the club renders, and back', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('view-toggle')).toHaveText(/ROOM/);
  const f0 = await page.evaluate(() => window.__dj!.clubFrames);
  await page.waitForFunction((f) => window.__dj!.clubFrames > f + 30, f0);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('view-toggle')).toHaveText(/BOOTH/);
  expect(errors()).toEqual([]);
});
