// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MusicState } from './MusicPlayer';

const fake = vi.hoisted(() => {
  let state: MusicState = { track: null, playing: false, muted: false, trackKey: 0, unavailable: false };
  const listeners = new Set<(s: MusicState) => void>();
  return {
    set(patch: Partial<MusicState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state));
    },
    reset() {
      state = { track: null, playing: false, muted: false, trackKey: 0, unavailable: false };
      listeners.clear();
    },
    player: {
      getState: () => state,
      subscribe: (l: (s: MusicState) => void) => {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      start: vi.fn(() => Promise.resolve()),
      skip: vi.fn(),
      setMuted: vi.fn((muted: boolean) => fake.set({ muted })),
    },
  };
});

vi.mock('./MusicPlayer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./MusicPlayer')>()),
  getMusicPlayer: () => fake.player,
}));

const { NowPlaying } = await import('./NowPlaying');

afterEach(() => {
  cleanup();
  fake.reset();
  vi.clearAllMocks();
  vi.restoreAllMocks(); // focusVisible spies
});

const TRACK = { id: 'x', title: 'One Day At A Time', artist: 'Sudley' };

/** jsdom has no focus-visible heuristics: say whether focus came from the keyboard (true) or a tap (false). */
function focusVisible(visible: boolean) {
  return vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, sel: string) {
    return sel === ':focus-visible' ? visible : Element.prototype.matches.call(this, sel);
  });
}

describe('NowPlaying', () => {
  it('invites a key press before the music starts, and clicking it starts the player', () => {
    render(<NowPlaying />);
    const prompt = screen.getByRole('button', { name: /press any key.*for music/i });
    fireEvent.click(prompt);
    expect(fake.player.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  });

  it('shows the track once one starts', () => {
    render(<NowPlaying />);
    act(() => fake.set({ track: TRACK, playing: true, trackKey: 1 }));
    expect(screen.queryByText(/press any key/i)).toBeNull();
    expect(screen.getByText(/now playing/i)).toBeTruthy();
    expect(screen.getByText('Sudley — One Day At A Time')).toBeTruthy();
  });

  it('SKIP skips the track', () => {
    fake.set({ track: TRACK, playing: true, trackKey: 1 });
    render(<NowPlaying />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(fake.player.skip).toHaveBeenCalledTimes(1);
  });

  it('MUTE toggles the player and reflects it in aria-pressed', () => {
    fake.set({ track: TRACK, playing: true, trackKey: 1 });
    render(<NowPlaying />);
    const mute = screen.getByRole('button', { name: /mute/i });
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mute);
    expect(fake.player.setMuted).toHaveBeenLastCalledWith(true);
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(mute);
    expect(fake.player.setMuted).toHaveBeenLastCalledWith(false);
    expect(mute.getAttribute('aria-pressed')).toBe('false');
  });

  it('a muted visitor sees the mute toggle instead of the prompt', () => {
    fake.set({ muted: true });
    render(<NowPlaying />);
    expect(screen.queryByText(/press any key/i)).toBeNull();
    expect(screen.getByRole('button', { name: /mute/i }).getAttribute('aria-pressed')).toBe('true');
  });

  it('re-pops the tag when a new track starts', () => {
    fake.set({ track: TRACK, playing: true, trackKey: 1 });
    render(<NowPlaying />);
    const skip = screen.getByRole('button', { name: /skip/i });
    const first = screen.getByTestId('now-playing-track');
    act(() => fake.set({ track: { ...TRACK, id: 'y', title: 'On And On' }, trackKey: 2 }));
    const second = screen.getByTestId('now-playing-track');
    expect(second).not.toBe(first); // remounted, so the CSS pop animation replays
    expect(second.textContent).toContain('On And On');
    expect(screen.getByRole('button', { name: /skip/i })).toBe(skip); // controls keep focus
  });

  it('announces track changes through a live region that persists across tracks', () => {
    fake.set({ track: TRACK, playing: true, trackKey: 1 });
    render(<NowPlaying />);
    const live = screen.getByTestId('now-playing-track').parentElement!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    act(() => fake.set({ track: { ...TRACK, id: 'y', title: 'On And On' }, trackKey: 2 }));
    expect(screen.getByTestId('now-playing-track').parentElement).toBe(live);
  });

  it('keeps keyboard focus: activating the prompt moves focus to SKIP once a track starts', () => {
    focusVisible(true);
    render(<NowPlaying />);
    const prompt = screen.getByRole('button', { name: /for music/i });
    prompt.focus();
    fireEvent.click(prompt);
    act(() => fake.set({ track: TRACK, playing: true, trackKey: 1 }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /skip/i }));
  });

  it('keeps keyboard focus when the window keydown listener starts the music first', () => {
    focusVisible(true);
    render(<NowPlaying />);
    screen.getByRole('button', { name: /for music/i }).focus();
    act(() => fake.set({ track: TRACK, playing: true, trackKey: 1 })); // the prompt never sees a click
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /skip/i }));
  });

  it('a tap on the prompt (focus without a ring) leaves focus alone: no stray ring on SKIP', () => {
    focusVisible(false);
    render(<NowPlaying />);
    const prompt = screen.getByRole('button', { name: /for music/i });
    prompt.focus();
    fireEvent.click(prompt);
    act(() => fake.set({ track: TRACK, playing: true, trackKey: 1 }));
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: /skip/i }));
  });

  it('keeps the NOW PLAYING label for screen readers beside the phone ♪', () => {
    render(<NowPlaying />);
    act(() => fake.set({ track: TRACK, playing: true, trackKey: 1 }));
    const track = screen.getByTestId('now-playing-track');
    expect(track.textContent).toContain('NOW PLAYING');
    expect(track.querySelector('[aria-hidden="true"]')?.textContent).toContain('♪');
  });

  it('does not steal focus when music starts from a gesture elsewhere', () => {
    render(<NowPlaying />);
    act(() => fake.set({ track: TRACK, playing: true, trackKey: 1 }));
    expect(document.activeElement).toBe(document.body);
  });

  it('the prompt has touch wording for phones', () => {
    render(<NowPlaying />);
    expect(screen.getByText('TAP')).toBeTruthy();
    expect(screen.getByText('PRESS ANY KEY')).toBeTruthy();
  });

  it('hides the prompt when the music is unavailable (no manifest)', () => {
    fake.set({ unavailable: true });
    const { container } = render(<NowPlaying />);
    expect(container.textContent).toBe('');
  });
});
