import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_RETRO } from '../../src/retro/RetroRenderer';
import type { MusicPlayer } from '../../src/site/music/MusicPlayer';
import { FOG_CONFIG } from '../../src/surf/config';
import { trackConsoleErrors } from './helpers';

/** The site player's debug handle (see getMusicPlayer). */
const musicPlaying = () => (window as { __zfMusic?: MusicPlayer }).__zfMusic?.getState().playing === true;

async function dropIn(page: Page) {
  await page.goto('/surf');
  const drop = page.getByRole('button', { name: 'DROP IN' });
  await expect(drop).toBeVisible();
  await drop.click();
  await page.waitForFunction(() => window.__surf?.phase === 'playing');
}

test.describe('surf game', () => {
  test('title and share card name the page from the content file', async ({ page }) => {
    await page.goto('/surf');
    await expect(page).toHaveTitle('Free Surf — Zach Farrell');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Free Surf — Zach Farrell');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/opengraph-image/);
  });

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

  test('the charged ollie: holding Space crouches without popping, letting go pops, and it scores', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await dropIn(page);
    await page.keyboard.down('Space');
    // Crouched (the load pose), still riding: pressing is not the ollie.
    await page.waitForFunction(() => window.__surf?.pose === 'load', undefined, { timeout: 5_000 });
    expect(await page.evaluate(() => window.__surf!.mode)).toBe('riding');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__surf!.mode)).toBe('riding');
    await page.keyboard.up('Space');
    // Letting go is the pop.
    await page.waitForFunction(() => window.__surf?.mode === 'airborne', undefined, { timeout: 2_000 });
    // A clean landing banks the Ollie after the combo window.
    await page.waitForFunction(() => (window.__surf?.score ?? 0) > 0 || window.__surf?.mode === 'wipeout', undefined, { timeout: 8_000 });
    expect(await page.evaluate(() => window.__surf!.score)).toBeGreaterThan(0);
    expect(errors()).toEqual([]);
  });

  test('Esc pauses and resumes', async ({ page }) => {
    await dropIn(page);
    await page.keyboard.press('Escape');
    await expect(page.getByText('PAUSED')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
  });

  test('DROP IN plays the site music: the NOW PLAYING tag shows a track and stays through a pause', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await dropIn(page);
    const track = page.getByTestId('now-playing-track');
    await expect(track).toContainText('NOW PLAYING');
    await page.waitForFunction(musicPlaying);
    await page.keyboard.press('Escape');
    await expect(page.getByText('PAUSED')).toBeVisible();
    await expect(track).toContainText('NOW PLAYING');
    expect(await page.evaluate(musicPlaying)).toBe(true); // ducked, not stopped
    expect(errors()).toEqual([]);
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

  test('coach: with no input the ▲ PUMP prompt pops up before the curl catches the rider', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await dropIn(page);
    const prompt = page.getByTestId('coach-pump');
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await expect(prompt).toContainText('▲ PUMP! Press ↑');
    const hook = await page.evaluate(() => ({ show: window.__surf!.coach.show, mode: window.__surf!.mode }));
    expect(hook).toEqual({ show: true, mode: 'riding' });
    expect(errors()).toEqual([]);
  });

  test('coach: GUIDE OFF in the title menu (persisted) means no prompt for the whole ride', async ({ page }) => {
    await page.goto('/surf');
    const off = page.getByRole('button', { name: 'GUIDE OFF' });
    await expect(page.getByRole('button', { name: 'GUIDE ON' })).toHaveAttribute('aria-pressed', 'true');
    await off.click();
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: 'GUIDE OFF' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'DROP IN' }).click();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    // Ride with no input until the curl catches the rider, watching every frame for the prompt.
    const everShown = await page.evaluate(async () => {
      let shown = false;
      while (window.__surf?.phase === 'playing') {
        shown ||= window.__surf.coach.show || document.querySelector('[data-testid="coach-pump"]') !== null;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return shown;
    });
    expect(everShown).toBe(false);
    await expect(page.getByText(/SWALLOWED BY THE BARREL/)).toBeVisible();
  });

  test('coach: the GUIDE buttons are reachable with Tab and toggle with Space / Enter', async ({ page }) => {
    await page.goto('/surf');
    const on = page.getByRole('button', { name: 'GUIDE ON' });
    const off = page.getByRole('button', { name: 'GUIDE OFF' });
    const drop = page.getByRole('button', { name: 'DROP IN' });
    await expect(drop).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(off).toBeFocused();
    await page.keyboard.press('Space');
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(on).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    // Enter on a GUIDE button toggled it without dropping in.
    expect(await page.evaluate(() => window.__surf?.phase)).toBe('title');
    await page.keyboard.press('Tab');
    await expect(off).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(drop).toBeFocused();
  });

  test('with no input the curl catches the rider in a few seconds (never under 2 s)', async ({ page }) => {
    await dropIn(page);
    const t0 = Date.now();
    await page.waitForFunction(() => window.__surf?.mode === 'wipeout', undefined, { timeout: 15_000 });
    expect(Date.now() - t0).toBeGreaterThan(2000);
    await page.waitForFunction(() => window.__surf?.phase === 'results', undefined, { timeout: 15_000 });
    await expect(page.getByText(/SWALLOWED BY THE BARREL/)).toBeVisible();
  });

  test('rides on the chase camera, and stalling into the curl cuts to the tube view', async ({ page }) => {
    await dropIn(page);
    await expect.poll(() => page.evaluate(() => window.__surf?.shot)).toBe('chase');
    expect(await page.evaluate(() => window.__surf?.peel)).toBe(8);
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window.__surf?.shot === 'tube', undefined, { timeout: 15_000 });
    await page.keyboard.up('ArrowDown');
  });

  test('stays inside the draw-call and triangle budget', async ({ page }) => {
    await dropIn(page);
    const f0 = await page.evaluate(() => window.__surf!.frames);
    await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 30, f0);
    // Sample 20 distinct rendered frames while riding and keep the worst.
    const samples = await page.evaluate(async () => {
      const out: { calls: number; triangles: number; mode: string }[] = [];
      let last = -1;
      while (out.length < 20) {
        await new Promise((r) => requestAnimationFrame(r));
        const h = window.__surf!;
        if (h.frames === last) continue;
        last = h.frames;
        out.push({ calls: h.calls, triangles: h.triangles, mode: h.mode });
      }
      return out;
    });
    expect(samples.every((s) => s.mode === 'riding')).toBe(true);
    expect(Math.min(...samples.map((s) => s.calls))).toBeGreaterThan(0);
    expect(Math.max(...samples.map((s) => s.calls))).toBeLessThan(80);
    expect(Math.max(...samples.map((s) => s.triangles))).toBeLessThan(150_000);
  });

  test('stays inside the budget with the heaviest scenery, the pier set, in view', async ({ page }) => {
    await page.goto('/surf?debug');
    await page.getByRole('button', { name: 'DROP IN' }).click();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    await page.getByTestId('debug-panel').evaluate((el) => ((el as HTMLElement).style.display = 'none'));
    // The pier set (pier, Oceanic, houses) starts 300 m down the line (SHORE.landmarkU) and nears at
    // the peel speed: look at it from rider height down the line, and from above over the whole beach.
    const views = [
      { pos: [0, 5, 5], look: [280, 4, 80] },
      { pos: [150, 70, -30], look: [280, 0, 160] },
      { pos: [-60, 40, 0], look: [300, 0, 140] },
    ];
    const worst = { calls: 0, triangles: 0 };
    for (const cam of views) {
      await page.evaluate((c) => {
        window.__surfCam = c as never;
      }, cam);
      const f0 = await page.evaluate(() => window.__surf!.frames);
      await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 5, f0);
      const s = await page.evaluate(async () => {
        const out = { calls: 0, triangles: 0 };
        let last = -1;
        for (let n = 0; n < 10; ) {
          await new Promise((r) => requestAnimationFrame(r));
          const h = window.__surf!;
          if (h.frames === last) continue;
          last = h.frames;
          n++;
          out.calls = Math.max(out.calls, h.calls);
          out.triangles = Math.max(out.triangles, h.triangles);
        }
        return out;
      });
      worst.calls = Math.max(worst.calls, s.calls);
      worst.triangles = Math.max(worst.triangles, s.triangles);
    }
    expect(worst.calls).toBeGreaterThan(0);
    expect(worst.calls).toBeLessThan(80);
    expect(worst.triangles).toBeLessThan(150_000);
  });

  test('the horizon is seamless: sea fades into the fog-coloured haze with no step, band or dip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/surf?debug');
    await page.getByRole('button', { name: 'DROP IN' }).click();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    await page.getByTestId('debug-panel').evaluate((el) => ((el as HTMLElement).style.display = 'none'));
    // Low, level free camera behind the wave looking straight out to sea: the horizon is at mid-frame (row ≈ 360).
    await page.evaluate(() => {
      window.__surfCam = { pos: [40, 3, -15], look: [40, 2.6, -300] };
    });
    // Let the retro trail (blend with the previous frames) settle on the new view.
    const f0 = await page.evaluate(() => window.__surf!.frames);
    await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 20, f0);
    const png = (await page.screenshot()).toString('base64');
    // Mean colour of each row over the middle of the frame (clear of the HUD), rows 150–600.
    const rows = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data, width } = ctx.getImageData(0, 0, img.width, img.height);
      const out: [number, number, number][] = [];
      for (let y = 150; y < 600; y++) {
        const m: [number, number, number] = [0, 0, 0];
        for (let x = 100; x < 900; x++) for (let k = 0; k < 3; k++) m[k] += data[(y * width + x) * 4 + k]! / 800;
        out.push(m);
      }
      return out;
    }, png);
    const Y0 = 150;
    const lum = rows.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
    // Smoothed over the 4-row Bayer dither period.
    const sm = lum.map((_, i) => (lum[Math.max(0, i - 2)]! + lum[Math.max(0, i - 1)]! + lum[i]! + lum[Math.min(lum.length - 1, i + 1)]!) / 4);

    // Sanity (a blank or wrong frame fails): real contrast; sky-blue at the top; the brightest row near
    // mid-frame is the haze, which is the fog colour as the retro output pass shows it.
    expect(Math.max(...sm) - Math.min(...sm)).toBeGreaterThan(60);
    const [tr, tg, tb] = rows[0]!;
    expect(tb).toBeGreaterThan(tr + 60);
    let h = 340 - Y0;
    for (let i = 340 - Y0; i <= 380 - Y0; i++) if (sm[i]! > sm[h]!) h = i;
    const fog = FOG_CONFIG.color.match(/[0-9a-f]{2}/gi)!.map((x) => {
      const c = parseInt(x, 16) / 255;
      const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      return 255 * linear ** (1 / (2.2 * DEFAULT_RETRO.gammaLift));
    });
    rows[h]!.forEach((v, k) => expect(Math.abs(v - fog[k]!)).toBeLessThan(20));

    // Below the horizon the sea only darkens toward the camera …
    let min = sm[h]!;
    let rise = 0;
    for (let i = h + 1; i < sm.length; i++) {
      rise = Math.max(rise, sm[i]! - min);
      min = Math.min(min, sm[i]!);
    }
    expect(rise).toBeLessThan(2);
    // … gradually (the old hard horizon stepped ≈ 40 across 4 rows) …
    let step = 0;
    for (let i = h + 4; i < sm.length; i++) step = Math.max(step, sm[i - 4]! - sm[i]!);
    expect(step).toBeLessThan(20);
    // … and without a band: a plateau where the darkening stalls and then resumes (slope over 6 rows
    // dropping below 35 % of the slopes on both sides of it).
    const S = 6;
    const slope: number[] = [];
    for (let i = h; i + S < sm.length; i++) slope.push(sm[i]! - sm[i + S]!);
    const before = slope.map((_, j) => Math.max(...slope.slice(0, j + 1)));
    const after = slope.map((_, j) => Math.max(...slope.slice(j)));
    let band = 0;
    for (let j = 1; j < slope.length - 1; j++) {
      const around = Math.min(before[j - 1]!, after[j + 1]!);
      if (around > 4 && slope[j]! < 0.35 * around) band = Math.max(band, around - slope[j]!);
    }
    expect(band).toBeLessThan(3);
  });

  test('a fast section raises a section peak down the line (hook.peak), and the run still ends on the results screen', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/surf?debug');
    await expect(page.getByTestId('debug-panel')).toBeVisible();
    // The first section 2 s after the drop-in (the slider floor), while a no-input rider is still up.
    for (const path of ['sections.minGap', 'sections.maxGap']) await page.locator('label', { hasText: path }).locator('input').fill('2');
    await page.getByRole('button', { name: 'DROP IN' }).click();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    const rising = await page.waitForFunction(
      () => {
        const s = window.__surf!;
        return s.peak.phase === 'rising' && s.peak.amp > 0.05 ? { x: s.peak.x, rider: s.x, xPitch: s.peak.xPitch, fast: s.fast } : null;
      },
      undefined,
      { timeout: 20_000 },
    );
    const peak = (await rising.jsonValue())!;
    expect(peak.fast).toBe(true);
    expect(peak.x).toBeGreaterThan(peak.rider); // down the line, ahead of the rider
    await expect(page.getByTestId('fast-section')).toBeVisible();
    // No input: the rider is caught (by the curl or the closing section) and the run ends normally.
    await page.waitForFunction(() => window.__surf?.phase === 'results', undefined, { timeout: 30_000 });
    await expect(page.getByText(/SWALLOWED BY THE BARREL|CLOSED OUT/)).toBeVisible();
    expect(errors()).toEqual([]);
  });

  test('Crystal Pier: hook.pierX comes down the line; ?pierSoon brings it near, PIER AHEAD shows, and a no-input rider slides into its pilings (PIER\'D)', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    // A normal run: the pier starts ≈ 300 m down the line and comes at the peel speed.
    await dropIn(page);
    const far = await page.evaluate(() => window.__surf!.pierX - window.__surf!.x);
    expect(far).toBeGreaterThan(250);
    expect(far).toBeLessThan(310);
    // ?pierSoon (dev only): it starts ≈ 20 m away.
    await page.goto('/surf?pierSoon');
    await page.getByRole('button', { name: 'DROP IN' }).click();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    const near = await page.evaluate(() => window.__surf!.pierX - window.__surf!.x);
    expect(near).toBeGreaterThan(5);
    expect(near).toBeLessThan(21);
    await expect(page.getByTestId('pier-ahead')).toBeVisible();
    // No input: the board slides down to the flats, where the pilings stand — not a lane: PIER'D.
    await page.waitForFunction(() => window.__surf?.phase === 'results', undefined, { timeout: 15_000 });
    await expect(page.getByText(/WIPEOUT — PIER'D/)).toBeVisible();
    expect(errors()).toEqual([]);
  });

  test('?debug shows the live tuning panel', async ({ page }) => {
    await page.goto('/surf?debug');
    await expect(page.getByTestId('debug-panel')).toBeVisible();
    await expect(page.getByText('physics.drive')).toBeVisible();
  });
});
