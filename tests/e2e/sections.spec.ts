import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

const SECTIONS = [
  { path: '/profile', text: 'LOOKING FOR' },
  { path: '/career', text: 'SAMPLE Company A' },
  { path: '/trophies', text: 'Kelly-style Surf Game' },
  { path: '/credits', text: 'I Can Be Your Future' },
] as const;

const TITLES: Record<string, string> = { '/profile': 'RIDER PROFILE', '/career': 'CAREER MODE', '/trophies': 'TROPHY ROOM', '/credits': 'CREDITS' };

/** Rendered size of a text element, and whether it has an opaque background somewhere behind it. */
async function readable(el: Locator) {
  await expect(el).toBeVisible();
  return el.evaluate((node) => {
    let opaque = false;
    for (let n: Element | null = node; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' || /rgb\(|rgba\([^)]*, 1\)/.test(cs.backgroundColor)) {
        opaque = true;
        break;
      }
    }
    return { px: parseFloat(getComputedStyle(node).fontSize), opaque };
  });
}

/** No overlap between two boxes. */
async function apart(a: Locator, b: Locator) {
  const [ra, rb] = [await a.boundingBox(), await b.boundingBox()];
  expect(ra && rb).toBeTruthy();
  const overlap = ra!.x < rb!.x + rb!.width && rb!.x < ra!.x + ra!.width && ra!.y < rb!.y + rb!.height && rb!.y < ra!.y + ra!.height;
  expect(overlap, `${JSON.stringify(ra)} overlaps ${JSON.stringify(rb)}`).toBe(false);
}

/** Start the music (the tag's own prompt) so the NOW PLAYING tag shows a track, its widest state. */
async function startMusic(page: Page) {
  await page.getByRole('button', { name: /PRESS ANY KEY/ }).click();
  await expect(page.getByTestId('now-playing-track')).toBeVisible();
}

test.describe('section screens', () => {
  for (const s of SECTIONS) {
    test(`${s.path}: heading, readable text on a panel, ◀ MENU and Esc back to /`, async ({ page }) => {
      const errors = trackConsoleErrors(page);
      await page.goto(s.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLES[s.path]!);
      await expect(page.getByText(s.text, { exact: true }).first()).toBeVisible();
      const body = page.getByRole('main').locator('p, li, a').first();
      const r = await readable(body);
      expect(r.px).toBeGreaterThanOrEqual(16);
      expect(r.opaque).toBe(true);

      await page.getByRole('link', { name: 'MENU', exact: true }).click();
      await page.waitForURL((u) => u.pathname === '/');
      await expect(page.getByRole('link', { name: 'FREE SURF' })).toBeFocused();

      await page.goto(s.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.waitForURL((u) => u.pathname === '/');
      expect(errors()).toEqual([]);
    });
  }

  test('home menu → CAREER MODE by keyboard; ↓ focuses the resume, ↓ the newest season, Enter toggles it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'FREE SURF' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/career');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('CAREER MODE');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('link', { name: /DOWNLOAD RESUME/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const newest = page.getByRole('button').first();
    await expect(newest).toBeFocused();
    await expect(newest).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(newest).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    const second = page.getByRole('button').nth(1);
    await expect(second).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: /DOWNLOAD RESUME/ })).toHaveAttribute('href', '/site/resume-sample.pdf');
  });

  test('RIDER PROFILE has nothing to select, so ↓ scrolls it (and ↑ back)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/profile');
    const main = page.getByRole('main');
    await expect(main).toBeFocused();
    const top = () => main.evaluate((m) => m.scrollTop);
    expect(await top()).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(top).toBeGreaterThan(0);
    const down = await top();
    await page.keyboard.press('ArrowUp');
    await expect.poll(top).toBeLessThan(down);
    // With focus parked outside the content (the body), the arrows still scroll it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(top).toBeGreaterThan(0);
  });

  test('TROPHY ROOM: a card opens its detail; the first Esc closes it, the second goes to the menu', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/trophies');
    const card = page.getByRole('article').first().getByRole('button');
    await card.click();
    const dialog = page.getByRole('dialog', { name: 'Kelly-style Surf Game' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'CLOSE' })).toBeFocused();
    await expect(dialog.getByRole('link', { name: /PLAY/ })).toHaveAttribute('href', '/surf');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/trophies');
    await expect(card).toBeFocused();
    await page.keyboard.press('Escape');
    await page.waitForURL((u) => u.pathname === '/');
    expect(errors()).toEqual([]);
  });

  test('CREDITS rolls in, and holds still under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/credits');
    const email = page.getByRole('link', { name: /@/ });
    await expect(email).toHaveAttribute('href', /^mailto:/);
    const y0 = (await email.boundingBox())!.y;
    await page.waitForTimeout(300);
    expect((await email.boundingBox())!.y).toBe(y0);
  });

  test('desktop: the NOW PLAYING tag sits in the hint strip, clear of the content', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/career');
    await startMusic(page);
    await apart(page.getByTestId('now-playing'), page.getByRole('main'));
  });
});

test.describe('section screens without WebGL', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/.test(type)) return null;
        return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof original;
    });
  });

  for (const s of SECTIONS) {
    test(`${s.path} still renders readable text`, async ({ page }) => {
      await page.goto(s.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLES[s.path]!);
      await expect(page.getByText(s.text, { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId('surf-canvas')).toHaveCount(0);
      expect((await readable(page.getByRole('main').locator('p, li, a').first())).px).toBeGreaterThanOrEqual(16);
    });
  }
});

// Chromium with the phone's viewport, touch and user agent (the device's default browser is WebKit).
const { defaultBrowserType: _p, ...iphone } = devices['iPhone 13'];
const { defaultBrowserType: _l, ...iphoneLandscape } = devices['iPhone 13 landscape'];

for (const [name, device] of [
  ['phone portrait', iphone],
  ['phone landscape', iphoneLandscape],
] as const) {
  test.describe(name, () => {
    test.use(device);
    for (const s of SECTIONS) {
      test(`${s.path}: the NOW PLAYING tag clears ◀ MENU, the title and the content; no sideways scroll`, async ({ page }) => {
        await page.goto(s.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.getByRole('button', { name: /FOR MUSIC/ }).tap(); // the tag's own prompt: SKIP appears under the finger
        await expect(page.getByTestId('now-playing-track')).toBeVisible();
        const tag = page.getByTestId('now-playing');
        // The phone tag shows ♪ and the track's name (up to two lines), not a clipped "NOW PLAYING" label.
        const shownName = await page.getByTestId('now-playing-track').evaluate((t) => {
          const title = [...t.querySelectorAll('span')].find((s) => s.textContent?.includes(' — '));
          return title ? title.getBoundingClientRect().width : 0;
        });
        expect(shownName).toBeGreaterThan(100);
        // A tap started it: no ring on SKIP (neither a keyboard focus handoff nor a stuck touch :hover).
        expect(await page.getByRole('button', { name: 'Skip track' }).evaluate((b) => getComputedStyle(b).boxShadow)).toBe('none');
        await apart(tag, page.getByRole('main'));
        await apart(tag, page.getByRole('heading', { level: 1 }));
        await apart(tag, page.getByRole('link', { name: 'MENU', exact: true }));
        const main = page.getByRole('main');
        expect(await main.evaluate((m) => m.scrollWidth <= m.clientWidth)).toBe(true);
        expect((await readable(main.locator('p, li, a').first())).px).toBeGreaterThanOrEqual(16);
      });
    }
  });
}

test.describe('phone taps', () => {
  test.use(iphone);

  /** The ring (box-shadow) an element shows, and whether the browser still reports it hovered. */
  const ring = (el: Locator) => el.evaluate((n) => ({ shadow: getComputedStyle(n).boxShadow, hovered: n.matches(':hover') }));

  test('a tapped season row or trophy card keeps no hover ring (touch leaves :hover stuck)', async ({ page }) => {
    await page.goto('/career');
    const row = page.getByRole('button').nth(1);
    await row.tap();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    expect((await ring(row)).hovered).toBe(true); // the premise: the tapped element is still :hover
    await expect.poll(async () => (await ring(row)).shadow).toBe('none');

    await page.goto('/trophies');
    const card = page.getByRole('article').first().getByRole('button');
    await card.tap();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'CLOSE' }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeFocused(); // focus came back to the card, without a keyboard ring
    await card.hover(); // and :hover parks on it, as the opening tap left it
    await expect.poll(async () => (await ring(card.locator('img'))).shadow).toBe('none');
  });

  test('a tapped surf title button keeps no hover ring unless it is the active choice', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/surf');
    const off = page.getByRole('button', { name: 'GUIDE OFF' });
    const on = page.getByRole('button', { name: 'GUIDE ON' });
    await off.tap();
    await on.tap();
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    // OFF is no longer the choice; park :hover on it, as the tap that picked it would have left it.
    await off.hover();
    expect((await ring(off)).hovered).toBe(true);
    await expect.poll(async () => (await ring(off)).shadow).toBe('none');
  });
});

test.describe('phone portrait widths', () => {
  test.use(iphone);

  test('320–430 px: the NOW PLAYING tag never overlaps ◀ MENU and stays on screen', async ({ page }) => {
    await page.goto('/credits');
    await page.getByRole('button', { name: /FOR MUSIC/ }).tap();
    await expect(page.getByTestId('now-playing-track')).toBeVisible();
    const tag = page.getByTestId('now-playing');
    const menu = page.getByRole('link', { name: 'MENU', exact: true });
    const check = async () => {
      for (const width of [320, 360, 375, 390, 414, 430]) {
        await page.setViewportSize({ width, height: 740 });
        await expect.poll(async () => (await tag.boundingBox())!.x + (await tag.boundingBox())!.width).toBeLessThanOrEqual(width - 15);
        await apart(tag, menu);
      }
    };
    await check();
    // A wider ◀ MENU (a fallback font, a user font-size setting): the tag makes room rather than assuming ~120 px.
    await page.addStyleTag({ content: 'header a[href="/"] { letter-spacing: 0.6em !important; }' });
    expect((await menu.boundingBox())!.width).toBeGreaterThan(150);
    await check();
  });
});
