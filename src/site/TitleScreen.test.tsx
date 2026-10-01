// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { site } from '@/content/site';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
// A plain anchor: next/link needs the app router's context, which jsdom tests don't mount.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const sfx = vi.hoisted(() => ({ menuMove: vi.fn(), menuSelect: vi.fn() }));
vi.mock('./sfx', () => sfx);

const { TitleScreen } = await import('./TitleScreen');
const { useBackToMenu } = await import('./useBackToMenu');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const key = (k: string) => fireEvent.keyDown(document.activeElement ?? window, { key: k, bubbles: true });
const item = (name: string) => screen.getByRole('link', { name });
const selected = () => screen.getAllByRole('link').filter((a) => a.getAttribute('data-selected') === 'true');

describe('TitleScreen', () => {
  it('shows the name, the tagline and the five items in menu order', () => {
    render(<TitleScreen />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ZACH FARRELL');
    expect(screen.getByText(site.profile.tagline)).toBeTruthy();
    expect(screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['FREE SURF', '/surf'],
      ['RIDER PROFILE', '/profile'],
      ['CAREER MODE', '/career'],
      ['TROPHY ROOM', '/trophies'],
      ['CREDITS', '/credits'],
    ]);
    expect(screen.getByText('↑↓ SELECT · ENTER START')).toBeTruthy();
  });

  it('starts with FREE SURF selected and focused', () => {
    render(<TitleScreen />);
    expect(selected()).toEqual([item('FREE SURF')]);
    expect(document.activeElement).toBe(item('FREE SURF'));
  });

  it('ArrowDown selects RIDER PROFILE (with the move blip) and Enter goes there', () => {
    render(<TitleScreen />);
    key('ArrowDown');
    expect(selected()).toEqual([item('RIDER PROFILE')]);
    expect(document.activeElement).toBe(item('RIDER PROFILE'));
    expect(sfx.menuMove).toHaveBeenCalledTimes(1);
    key('Enter');
    expect(sfx.menuSelect).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('/profile');
  });

  it('ArrowUp from FREE SURF wraps to CREDITS', () => {
    render(<TitleScreen />);
    key('ArrowUp');
    expect(selected()).toEqual([item('CREDITS')]);
    expect(document.activeElement).toBe(item('CREDITS'));
  });

  it('Space starts the selected item too', () => {
    render(<TitleScreen />);
    key(' ');
    expect(nav.push).toHaveBeenCalledWith('/surf');
  });

  it('hovering an item selects it', () => {
    render(<TitleScreen />);
    fireEvent.pointerEnter(item('TROPHY ROOM'));
    expect(selected()).toEqual([item('TROPHY ROOM')]);
    expect(sfx.menuMove).toHaveBeenCalledTimes(1);
  });

  it('leaves Enter alone when focus is on a button outside the menu (the music tag)', () => {
    render(
      <>
        <TitleScreen />
        <button type="button">PRESS ANY KEY</button>
      </>,
    );
    screen.getByRole('button', { name: 'PRESS ANY KEY' }).focus();
    key('Enter');
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('useBackToMenu', () => {
  it('Esc and Backspace go to the menu', () => {
    renderHook(() => useBackToMenu());
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(nav.push).toHaveBeenCalledTimes(2);
    expect(nav.push).toHaveBeenCalledWith('/');
  });

  it('ignores keys typed into an input', () => {
    renderHook(() => useBackToMenu());
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(input, { key: 'Escape' });
    input.remove();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('ignores a modified key, a held key and one a dialog already handled', () => {
    renderHook(() => useBackToMenu());
    fireEvent.keyDown(window, { key: 'Backspace', altKey: true });
    fireEvent.keyDown(window, { key: 'Escape', repeat: true });
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(nav.push).not.toHaveBeenCalled();
  });
});
