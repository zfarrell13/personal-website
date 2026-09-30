// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MusicState } from './MusicPlayer';

const fake = vi.hoisted(() => {
  let state: MusicState = { track: null, playing: false, muted: false, trackKey: 0 };
  const listeners = new Set<(s: MusicState) => void>();
  return {
    set(patch: Partial<MusicState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state));
    },
    reset() {
      state = { track: null, playing: false, muted: false, trackKey: 0 };
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
});

const TRACK = { id: 'x', title: 'One Day At A Time', artist: 'Sudley' };

describe('NowPlaying', () => {
  it('invites a key press before the music starts, and clicking it starts the player', () => {
    render(<NowPlaying />);
    const prompt = screen.getByRole('button', { name: /press any key for music/i });
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
});
