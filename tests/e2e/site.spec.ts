import { expect, test, type Page } from '@playwright/test';
import { trackConsoleErrors } from './helpers';

/** Client-side (soft) navigation through the app router: the root layout, and so the stage, persists. */
async function softNavigate(page: Page, href: string) {
  await page.waitForFunction(() => !!(window as { next?: { router?: unknown } }).next?.router);
  await page.evaluate((h) => (window as unknown as { next: { router: { push: (h: string) => void } } }).next.router.push(h), href);
  await page.waitForURL(`**${href}`);
}

const frames = (page: Page) => page.evaluate(() => window.__surf?.frames ?? -1);

test.describe('site stage', () => {
  // /dev/retro: a plain page with no menu of its own, so only the stage is under test.
  test('a non-surf page shows the wave in attract mode: no menus, canvas hidden and click-through', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/dev/retro');
    await page.waitForFunction(() => (window.__surf?.frames ?? 0) > 10);
    expect(await page.evaluate(() => window.__surf?.phase)).toBe('title');
    await expect(page.getByRole('button', { name: 'DROP IN' })).toHaveCount(0);
    const canvas = page.getByTestId('surf-canvas');
    await expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(await canvas.evaluate((c) => getComputedStyle(c).pointerEvents)).toBe('none');
    expect(await canvas.evaluate((c) => getComputedStyle(c).filter)).toContain('brightness(0.55)');
    // The music tag stays on top of the stage: the topmost element at its centre is the tag itself.
    const onTop = await page.getByRole('button', { name: /PRESS ANY KEY/ }).evaluate((b) => {
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(onTop).toBe(true);
    expect(errors()).toEqual([]);
  });

  test('the stage survives client-side navigation: attract → /surf (title menu) → attract, one game throughout', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/dev/retro');
    await page.waitForFunction(() => (window.__surf?.frames ?? 0) > 10);
    // Tag the stage's canvas: a re-created game would bring a new canvas.
    await page.getByTestId('surf-canvas').evaluate((c) => c.setAttribute('data-e2e-tag', 'first'));
    let last = await frames(page);

    await softNavigate(page, '/surf');
    await expect(page.getByRole('button', { name: 'DROP IN' })).toBeVisible();
    await expect(page.getByTestId('surf-canvas')).toHaveAttribute('data-e2e-tag', 'first');
    await expect(page.getByTestId('surf-canvas')).not.toHaveAttribute('aria-hidden', 'true');
    await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 10, last);
    const onSurf = await frames(page);
    expect(onSurf).toBeGreaterThan(last);
    last = onSurf;

    await softNavigate(page, '/dev/retro');
    await expect(page.getByRole('button', { name: 'DROP IN' })).toHaveCount(0);
    await expect(page.getByTestId('surf-canvas')).toHaveAttribute('data-e2e-tag', 'first');
    await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 10, last);
    expect(errors()).toEqual([]);
  });

  test('a run in progress quits to the title when you leave /surf', async ({ page }) => {
    await page.goto('/surf');
    await page.getByRole('button', { name: 'DROP IN' }).click();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    await softNavigate(page, '/dev/retro');
    await page.waitForFunction(() => window.__surf?.phase === 'title');
    await expect(page.getByTestId('score')).toHaveCount(0);
  });

  test('reduced motion freezes the attract stage', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/retro');
    await page.waitForFunction(() => (window.__surf?.phase ?? 'loading') === 'title');
    await page.waitForTimeout(500);
    const f0 = await frames(page);
    await page.waitForTimeout(1000);
    expect(await frames(page)).toBe(f0);
  });
});

const MENU_LABELS = ['FREE SURF', 'RIDER PROFILE', 'CAREER MODE', 'TROPHY ROOM', 'CREDITS'];

test.describe('title menu', () => {
  test('/ lists the five items in order with FREE SURF selected; Enter drops into the game; ◀ MENU comes back', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ZACH FARRELL');
    const items = page.getByRole('navigation', { name: 'Main menu' }).getByRole('link');
    await expect(items).toHaveText(MENU_LABELS);
    await expect(items.first()).toHaveAttribute('data-selected', 'true');
    await expect(items.first()).toBeFocused();
    await expect(page.locator('[data-selected="true"]')).toHaveCount(1);

    // ↑↓ move the one cursor (wrapping), then back to FREE SURF.
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(4)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(items.first()).toBeFocused();

    await page.keyboard.press('Enter');
    await page.waitForURL('**/surf');
    await expect(page.getByRole('button', { name: 'DROP IN' })).toBeVisible();
    await page.getByRole('button', { name: '◀ MENU' }).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(items.first()).toHaveAttribute('data-selected', 'true');
    expect(errors()).toEqual([]);
  });

  test('attract → FREE SURF → ◀ MENU → attract: one canvas, frames keep counting', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => (window.__surf?.frames ?? 0) > 10);
    await page.getByTestId('surf-canvas').evaluate((c) => c.setAttribute('data-e2e-tag', 'first'));
    let last = await frames(page);

    await page.getByRole('link', { name: 'FREE SURF' }).click();
    await page.waitForURL('**/surf');
    await expect(page.getByRole('button', { name: 'DROP IN' })).toBeVisible();
    await expect(page.getByTestId('surf-canvas')).toHaveAttribute('data-e2e-tag', 'first');
    await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 10, last);
    last = await frames(page);

    await page.getByRole('button', { name: '◀ MENU' }).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByRole('link', { name: 'FREE SURF' })).toBeVisible();
    await expect(page.getByTestId('surf-canvas')).toHaveAttribute('data-e2e-tag', 'first');
    await expect(page.getByTestId('surf-canvas')).toHaveAttribute('aria-hidden', 'true');
    await page.waitForFunction((f) => (window.__surf?.frames ?? 0) > f + 10, last);
    expect(errors()).toEqual([]);
  });

  test('on /surf, Esc on the game title goes to the menu; during a run Esc pauses instead', async ({ page }) => {
    await page.goto('/surf');
    await page.getByRole('button', { name: 'DROP IN' }).click();
    await page.waitForFunction(() => window.__surf?.phase === 'playing');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__surf?.phase === 'paused');
    expect(new URL(page.url()).pathname).toBe('/surf');
    await page.getByRole('button', { name: /QUIT/i }).click();
    await expect(page.getByRole('button', { name: 'DROP IN' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByRole('link', { name: 'FREE SURF' })).toBeFocused();
  });
});
