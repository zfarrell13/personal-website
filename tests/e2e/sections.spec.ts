import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

const SECTIONS = [
  { path: '/profile', text: 'LOOKING FOR' },
  { path: '/career', text: 'Vantaca' },
  { path: '/trophies', text: 'Kelly-style Surf Game' },
  { path: '/credits', text: 'zachfarrell13@gmail.com' },
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
    await expect(page.getByRole('link', { name: /DOWNLOAD RESUME/ })).toHaveAttribute('href', '/site/Zach_Farrell_Resume.pdf');
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
    const card = page.getByRole('article').filter({ hasText: 'Kelly-style Surf Game' }).getByRole('button');
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
    expect((await ring(card)).hovered).toBe(true); // the premise: the card really is :hover
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
        await expect(async () => apart(tag, menu)).toPass(); // the MENU measurement may land a frame later
      }
    };
    await check();
    // A wider ◀ MENU (a fallback font, a user font-size setting): the tag makes room rather than assuming ~120 px.
    await page.addStyleTag({ content: 'header a[href="/"] { letter-spacing: 0.6em !important; }' });
    expect((await menu.boundingBox())!.width).toBeGreaterThan(150);
    await check();
  });
});

/** The track name's layout in the NOW PLAYING tag: the text area's width, and whether ♪ shares a line with the name. */
async function nameLayout(page: Page) {
  return page.getByTestId('now-playing-track').evaluate((t) => {
    const note = t.querySelector('[aria-hidden="true"]');
    const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
    let name: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.includes(' — ')) name = n as Text;
    if (!note || !name) return null;
    const first = document.createRange();
    first.setStart(name, 0);
    first.setEnd(name, 1);
    const [a, b] = [note.getBoundingClientRect(), first.getBoundingClientRect()];
    return { width: t.getBoundingClientRect().width, noteOnNameLine: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 4 };
  });
}

test.describe('phone portrait, 320 × 568', () => {
  test.use({ ...iphone, viewport: { width: 320, height: 568 } });

  for (const s of SECTIONS) {
    test(`${s.path}: NOW PLAYING gets its own full-width row under the bar, room for the name, clear of everything`, async ({ page }) => {
      await page.goto(`${s.path}?tracks=test`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.getByRole('button', { name: /FOR MUSIC/ }).tap();
      const tag = page.getByTestId('now-playing');
      const menu = page.getByRole('link', { name: 'MENU', exact: true });
      const heading = page.getByRole('heading', { level: 1 });
      const main = page.getByRole('main');
      const seen = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const name = page.getByTestId('now-playing-track');
        await expect(name).toContainText(' — ');
        const title = (await name.textContent())!;
        expect(seen.has(title), `${title} again`).toBe(false);
        seen.add(title);
        // Every test track's name gets the width a real one needs (≥ 18 characters shown), with ♪ on its line.
        await expect.poll(async () => (await nameLayout(page))?.width ?? 0, title).toBeGreaterThanOrEqual(180);
        expect((await nameLayout(page))?.noteOnNameLine, title).toBe(true);
        // Its own row: below ◀ MENU and the title, above the content, inside the 16 px gutters.
        await expect(async () => {
          const [t, m, h, c] = [await tag.boundingBox(), await menu.boundingBox(), await heading.boundingBox(), await main.boundingBox()];
          expect(t!.y).toBeGreaterThanOrEqual(m!.y + m!.height);
          expect(t!.y).toBeGreaterThanOrEqual(h!.y + h!.height);
          expect(c!.y, 'the content starts below the tag (pushed down, not covered)').toBeGreaterThanOrEqual(t!.y + t!.height);
          expect(t!.x).toBeGreaterThanOrEqual(15);
          expect(t!.x + t!.width).toBeLessThanOrEqual(305);
        }).toPass();
        await apart(tag, menu);
        await apart(tag, heading);
        await apart(tag, main);
        if (i < 2) {
          await page.getByRole('button', { name: 'Skip track' }).tap();
          await expect(name).not.toHaveText(title);
        }
      }
      expect(await main.evaluate((m) => m.scrollWidth <= m.clientWidth)).toBe(true);
    });
  }
});

test.describe('phone home and game', () => {
  test('portrait home: the NOW PLAYING tag uses the free top row for the track name, clear of the menu', async ({ browser }) => {
    const page = await (await browser.newContext(iphone)).newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /FOR MUSIC/ }).tap();
    const name = page.getByTestId('now-playing-track');
    await expect(name).toBeVisible();
    const shown = await name.evaluate((t) => [...t.querySelectorAll('span')].find((s) => s.textContent?.includes(' — '))?.getBoundingClientRect().width ?? 0);
    expect(shown).toBeGreaterThan(150);
    await apart(page.getByTestId('now-playing'), page.getByRole('heading', { level: 1 }));
    await apart(page.getByTestId('now-playing'), page.getByRole('navigation', { name: 'Main menu' }));
    await page.context().close();
  });

  test('landscape game: the OLLIE / grab pad hugs the right edge (clear of the rider in the middle)', async ({ browser }) => {
    const page = await (await browser.newContext(iphoneLandscape)).newPage();
    await page.goto('/surf');
    await page.getByRole('button', { name: 'DROP IN' }).tap();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    const vw = page.viewportSize()!.width;
    for (const label of ['METHOD', 'RAIL', 'STALE', 'INDY', 'OLLIE']) {
      expect((await page.getByRole('button', { name: label }).boundingBox())!.x, label).toBeGreaterThan(vw * 0.78);
    }
    await page.context().close();
  });
});
