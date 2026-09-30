// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { SurfStore } from './state/store';

// A stand-in SurfGame: no WebGL. load() shows the title, like the real one.
const fake = vi.hoisted(() => ({ games: [] as Array<{ store: SurfStore; opts: { attract?: boolean }; setAttract: ReturnType<typeof vi.fn>; setFrozen: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> }));
vi.mock('./game/SurfGame', async () => {
  const { vi } = await import('vitest');
  class SurfGame {
    actions = { press: vi.fn(), release: vi.fn() };
    load = vi.fn(async () => this.store.setState({ phase: 'title' }));
    start = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    quitToTitle = vi.fn();
    setAttract = vi.fn();
    setFrozen = vi.fn();
    dispose = vi.fn();
    constructor(
      _canvas: HTMLCanvasElement,
      readonly store: SurfStore,
      readonly opts: { attract?: boolean } = {},
    ) {
      fake.games.push(this);
    }
  }
  return { SurfGame };
});

const { default: SurfApp } = await import('./SurfApp');

beforeEach(() => {
  fake.games.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

const titleMenu = () => screen.queryByRole('button', { name: 'DROP IN' });

describe('SurfApp modes', () => {
  it('attract shows no menus or HUD; the canvas is hidden from AT and from the pointer', async () => {
    await act(async () => void render(<SurfApp mode="attract" />));
    const game = fake.games[0]!;
    expect(game.opts.attract).toBe(true); // born in attract: no play-mode moment
    expect(game.setAttract).toHaveBeenLastCalledWith(true);
    expect(titleMenu()).toBeNull();
    act(() => game.store.setState({ phase: 'playing' }));
    expect(screen.queryByTestId('score')).toBeNull();
    expect(screen.queryByTestId('touch-controls')).toBeNull();
    const canvas = screen.getByTestId('surf-canvas');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.closest('[data-mode]')?.getAttribute('data-mode')).toBe('attract');
  });

  it('switching to play shows the title menu, on the same game', async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => void (view = render(<SurfApp mode="attract" />)));
    expect(titleMenu()).toBeNull();
    const canvas = screen.getByTestId('surf-canvas');
    await act(async () => void view.rerender(<SurfApp mode="play" />));
    expect(screen.getByTestId('surf-canvas')).toBe(canvas); // the game's canvas is kept
    expect(titleMenu()).not.toBeNull();
    expect(fake.games).toHaveLength(1);
    const game = fake.games[0]!;
    expect(game.setAttract).toHaveBeenLastCalledWith(false);
    expect(game.dispose).not.toHaveBeenCalled();
    expect(screen.getByTestId('surf-canvas').getAttribute('aria-hidden')).toBeNull();
    await act(async () => void view.rerender(<SurfApp mode="attract" />));
    expect(titleMenu()).toBeNull();
    expect(game.setAttract).toHaveBeenLastCalledWith(true);
    expect(fake.games).toHaveLength(1);
  });

  it('play mode shows the title menu and the HUD as before', async () => {
    await act(async () => void render(<SurfApp mode="play" />));
    expect(fake.games[0]!.opts.attract).toBe(false);
    expect(titleMenu()).not.toBeNull();
    act(() => fake.games[0]!.store.setState({ phase: 'playing' }));
    expect(screen.getByTestId('score')).not.toBeNull();
  });

  it('passes reduced motion to the game as a freeze', async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => void (view = render(<SurfApp mode="attract" reducedMotion />)));
    const game = fake.games[0]!;
    expect(game.setFrozen).toHaveBeenLastCalledWith(true);
    await act(async () => void view.rerender(<SurfApp mode="attract" reducedMotion={false} />));
    expect(game.setFrozen).toHaveBeenLastCalledWith(false);
  });
});
