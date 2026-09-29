import type { Page } from '@playwright/test';

/** Collects console errors and uncaught exceptions for the page's lifetime. */
export function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return () => errors.filter((e) => !e.includes('Download the React DevTools'));
}
