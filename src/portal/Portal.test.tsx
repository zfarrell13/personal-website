// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import Portal from './Portal';

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
});
afterEach(cleanup);

const ready = async () => {
  const main = screen.getByRole('main');
  await waitFor(() => expect(main.getAttribute('data-ready')).toBe('true'));
  return main;
};

describe('Portal', () => {
  it('defaults to light and starts the surf game', async () => {
    render(<Portal />);
    await ready();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('mode-caption').textContent).toContain('SURF');
    fireEvent.click(screen.getByText('PRESS START'));
    expect(push).toHaveBeenCalledWith('/surf');
  });

  it('toggles to dark, persists, and starts the DJ booth', async () => {
    render(<Portal />);
    await ready();
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('zf-mode')).toBe('dark');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/dj');
  });

  it('restores the stored mode and toggles with arrow keys', async () => {
    localStorage.setItem('zf-mode', 'dark');
    render(<Portal />);
    await ready();
    expect(screen.getByTestId('mode-caption').textContent).toContain('DJ');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('mode-caption').textContent).toContain('SURF');
  });
});
