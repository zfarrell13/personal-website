import { expect, test, type Page } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

/** Boots the booth. The step-by-step guide stays closed unless a test asks for it (it auto-opens on a first visit). */
async function boot(page: Page, url = '/dj?tracks=test&guide=off') {
  await page.goto(url);
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

test('StrictMode (next dev): exactly one club canvas, rendering in the close-up at half rate', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page);
  await expect(page.getByTestId('club-canvas')).toHaveCount(1);
  expect(await page.locator('canvas.retro-canvas').count()).toBe(1);
  const f0 = await page.evaluate(() => [window.__dj!.frames(), window.__dj!.clubFrames] as const);
  await page.waitForFunction((f) => window.__dj!.clubFrames > f + 10, f0[1]);
  const f1 = await page.evaluate(() => [window.__dj!.frames(), window.__dj!.clubFrames] as const);
  // settled close-up: the club renders every 2nd loop frame (CLOSEUP_RENDER_EVERY)
  const ratio = (f1[1] - f0[1]) / (f1[0] - f0[0]);
  expect(ratio).toBeGreaterThan(0.35);
  expect(ratio).toBeLessThan(0.65);
  expect(errors()).toEqual([]);
});

/** Drags a slider's cap to the top (vertical fader) or right end (crossfader) of its track. */
async function dragSlider(page: Page, name: string, to: 'top' | 'right') {
  const slider = page.getByRole('slider', { name, exact: true });
  // wait out a smooth scroll (the guide's phone reveal) so the drag starts on the cap's final position
  let b = (await slider.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = (await slider.boundingBox())!;
    if (next.x === b.x && next.y === b.y) break;
    b = next;
  }
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const [from, dest] = to === 'top' ? [[cx, b.y + b.height - 2], [cx, b.y + 1]] : [[b.x + 2, cy], [b.x + b.width - 1, cy]];
  await page.mouse.move(from[0]!, from[1]!);
  await page.mouse.down();
  await page.mouse.move(dest[0]!, dest[1]!, { steps: 6 });
  await page.mouse.up();
}

test('guide: opens on the first visit and advances as each step is done, through to "Mix complete!"', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page, '/dj?tracks=test');
  const guide = page.getByTestId('guide');
  const step = (n: number) => expect(guide).toHaveAttribute('data-step', String(n));
  const lit = (id: string) => expect(page.getByTestId(id)).toHaveAttribute('data-guide-hl', '');

  // 1. BROWSE on deck 1 glows; loading a song moves on
  await step(1);
  await lit('browse-0');
  await load(page, 0, 'test-tidal'); // 124 BPM
  // 2. PLAY on deck 1, and CH 1's fader up: step 2 is done only once deck 1 is heard on the master
  await step(2);
  await lit('play-0');
  await lit('fader-ch-0');
  // the pulsing ring shows on the blinking PLAY button (drawn by ::after, so the LED blink keeps running)
  const ring = await page.getByTestId('play-0').evaluate((el) => {
    const a = getComputedStyle(el, '::after');
    return { anim: a.animationName, border: a.borderTopColor, blink: getComputedStyle(el).animationName, pe: a.pointerEvents };
  });
  expect(ring).toMatchObject({ anim: 'dj-guide-pulse', border: 'rgb(255, 194, 26)', pe: 'none' });
  expect(ring.blink).not.toBe('dj-guide-pulse');
  await page.getByTestId('play-0').click();
  await step(2); // playing but silent: PLAY alone is not enough
  await expect(page.getByTestId('guide-hint')).toContainText('not on the air yet');
  await lit('fader-ch-0');
  await dragSlider(page, 'CH 1', 'top');
  // 3. load deck 2
  await step(3);
  await lit('browse-1');
  await load(page, 1, 'test-sunrise'); // 120 BPM
  // 4. match the BPM with deck 2's tempo fader (fine keyboard steps: 0.1 % each)
  await step(4);
  await lit('tempo-fader-1');
  await expect(page.getByTestId('guide-bpm')).toHaveText(/124\.0.*120\.0.*DOWN/);
  const tempo = page.getByTestId('tempo-fader-1').getByRole('slider');
  await tempo.focus();
  for (let i = 0; i < 33; i++) await tempo.press('Shift+ArrowDown');
  // 5. beatmatch: SYNC is the accepted shortcut; the hold takes 2 s
  await step(5);
  await lit('play-1');
  await page.getByTestId('sync-1').click();
  await page.getByTestId('play-1').click();
  await expect(page.getByTestId('guide-offset')).toBeVisible();
  await expect(guide).toHaveAttribute('data-step', '6', { timeout: 15_000 });
  // 6. a real fade: deck 1 is on the air, CH 2 comes up while it plays (overlap), then the crossfader takes deck 1 out
  await expect(page.getByTestId('guide-hint')).toContainText('while deck 1 keeps playing');
  await lit('fader-ch-1');
  await dragSlider(page, 'CH 2', 'top');
  await step(6); // both up together is not a mix yet
  await lit('xf-assign-0');
  await page.getByTestId('xf-assign-0').click(); // THRU → B
  await page.getByTestId('xf-assign-0').click(); // B → A
  await page.getByTestId('xf-assign-1').click(); // THRU → B
  await lit('crossfader');
  await dragSlider(page, 'CROSSFADER', 'right');
  await step(7);
  await expect(guide).toContainText('MIX COMPLETE!');
  expect(await page.evaluate(() => localStorage.getItem('dj.guide'))).toBe('done');
  await expect(page.locator('[data-guide-hl]')).toHaveCount(0);

  // hidden in the room view, back in the booth view; ✕ closes, GUIDE reopens
  await page.getByTestId('view-toggle').click();
  await expect(guide).toHaveCount(0);
  await page.getByTestId('view-toggle').click();
  await expect(guide).toBeVisible();
  await page.getByTestId('guide-close').click();
  await expect(guide).toHaveCount(0);
  await page.getByTestId('guide-toggle').click();
  await expect(guide).toBeVisible();
  expect(errors()).toEqual([]);
});

test('guide: Back / Skip navigate by hand, and a dismissed guide stays closed on the next visit', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page, '/dj?tracks=test');
  const guide = page.getByTestId('guide');
  await expect(guide).toHaveAttribute('data-step', '1');
  await page.getByTestId('guide-skip').click();
  await expect(guide).toHaveAttribute('data-step', '2');
  await page.getByTestId('guide-back').click();
  await expect(guide).toHaveAttribute('data-step', '1');
  await page.getByTestId('guide-close').click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await page.getByTestId('dj-start').click();
  await page.waitForFunction(() => window.__dj?.ready === true, null, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await expect(guide).toHaveCount(0);
  expect(errors()).toEqual([]);
});

test('guide on a phone: brings the panel and the control for the next step into view', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await boot(page, '/dj?tracks=test');
  const guide = page.getByTestId('guide');
  const panel = () => page.evaluate(() => window.__dj!.state().ui.mobilePanel);
  await expect(guide).toHaveAttribute('data-step', '1');
  await expect.poll(panel).toBe(0);
  await expect(page.getByTestId('browse-0')).toBeInViewport();
  await load(page, 0, 'test-tidal');
  // PLAY sits below the fold of the deck 1 panel: the guide scrolls it up (toBeInViewport never scrolls)
  await expect(guide).toHaveAttribute('data-step', '2');
  await expect(page.getByTestId('play-0')).toBeInViewport({ ratio: 1 });
  await page.getByTestId('play-0').click();
  // deck 1 plays but is silent: the guide moves to the mixer and brings CH 1's fader into view
  await expect.poll(panel).toBe(1);
  await expect(page.getByTestId('fader-ch-0').getByRole('slider')).toBeInViewport({ ratio: 1 });
  await dragSlider(page, 'CH 1', 'top');
  await expect(guide).toHaveAttribute('data-step', '3');
  await expect.poll(panel).toBe(2);
  await expect(page.getByTestId('browse-1')).toBeInViewport();
  // the docked guide never covers the control it points at
  const g = (await guide.boundingBox())!;
  const b = (await page.getByTestId('browse-1').boundingBox())!;
  expect(g.y + g.height).toBeLessThanOrEqual(b.y);
  await load(page, 1, 'test-sunrise');
  await expect(guide).toHaveAttribute('data-step', '4');
  await expect(page.getByTestId('tempo-fader-1').getByRole('slider')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('guide-phone-step4.png') });
  expect(errors()).toEqual([]);
});
