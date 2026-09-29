// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HIGH_SCORE_KEY } from '../scoring/highScores';
import { createSurfStore, type RunSummary } from '../state/store';
import { configVersion, SURF_CONFIG } from '../config';
import { DebugPanel } from './DebugPanel';
import { ActionState } from '@/shared/input/ActionState';
import { SURF_BINDINGS, type SurfAction } from '../physics/input';
import { Hud } from './Hud';
import { Results } from './Results';
import { TitleMenu } from './TitleMenu';
import { TouchControls } from './TouchControls';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const run: RunSummary = { score: 4200, side: 'right', end: 'wipeout', wipeoutReason: 'swallowed', bestCombo: 3000, longestTube: 2.4, tricks: 7, durationSec: 41 };
const key = (k: string) => fireEvent.keyDown(window, { key: k });

describe('TitleMenu', () => {
  it('selects a side with arrows and drops in with Enter', () => {
    const onStart = vi.fn();
    render(<TitleMenu initialSide="right" onStart={onStart} />);
    expect(screen.getByRole('button', { name: 'RIGHT' }).getAttribute('data-active')).toBe('true');
    key('ArrowLeft');
    expect(screen.getByRole('button', { name: 'LEFT' }).getAttribute('data-active')).toBe('true');
    key('Enter');
    expect(onStart).toHaveBeenCalledWith('left');
    fireEvent.click(screen.getByRole('button', { name: 'DROP IN' }));
    expect(onStart).toHaveBeenLastCalledWith('left');
  });
});

describe('Results', () => {
  it('takes 3-letter initials for a qualifying score, saves, then Enter goes again', () => {
    const onAgain = vi.fn();
    render(<Results run={run} onAgain={onAgain} onTitle={vi.fn()} />);
    expect(screen.getByText(/SWALLOWED BY THE BARREL/)).toBeTruthy();
    key('z');
    key('a');
    key('f');
    expect(screen.getByTestId('initials').textContent).toBe('ZAF');
    key('Enter');
    const saved = JSON.parse(localStorage.getItem(HIGH_SCORE_KEY)!);
    expect(saved[0]).toMatchObject({ initials: 'ZAF', score: 4200, side: 'right' });
    expect(onAgain).not.toHaveBeenCalled();
    key('Enter');
    expect(onAgain).toHaveBeenCalledTimes(1);
  });

  it('cycles letters with up/down and skips entry for a zero score', () => {
    const onTitle = vi.fn();
    render(<Results run={{ ...run, score: 0 }} onAgain={vi.fn()} onTitle={onTitle} />);
    expect(screen.queryByTestId('initials')).toBeNull();
    key('Escape');
    expect(onTitle).toHaveBeenCalled();
    cleanup();
    render(<Results run={run} onAgain={vi.fn()} onTitle={vi.fn()} />);
    key('ArrowDown');
    expect(screen.getByTestId('initials').textContent).toBe('ZAA');
  });
});

describe('Hud', () => {
  it('renders score, combo pot × multiplier, tube timer and ticker from the store', () => {
    const store = createSurfStore();
    render(<Hud store={store} />);
    act(() => store.setState({ score: 1234, pot: 800, multiplier: 2, tubeTime: 1.26, ticker: [{ id: 1, text: 'Air 360', points: 700 }] }));
    expect(screen.getByTestId('score').textContent).toBe('1,234');
    expect(screen.getByTestId('combo').textContent).toBe('800 × 2');
    expect(screen.getByText('TUBE 1.3s')).toBeTruthy();
    expect(screen.getByText('Air 360 +700')).toBeTruthy();
  });
});

describe('TouchControls', () => {
  it('presses and releases actions with a per-button touch source', () => {
    const actions = { press: vi.fn(), release: vi.fn() };
    render(<TouchControls actions={actions} onPause={vi.fn()} />);
    const ollie = screen.getByRole('button', { name: 'OLLIE' });
    fireEvent.pointerDown(ollie, { pointerId: 1 });
    expect(actions.press).toHaveBeenCalledWith('ollie', 'touch:ollie:1');
    fireEvent.pointerUp(ollie, { pointerId: 1 });
    expect(actions.release).toHaveBeenCalledWith('ollie', 'touch:ollie:1');
    fireEvent.pointerDown(screen.getByRole('button', { name: '◀' }), { pointerId: 2 });
    expect(actions.press).toHaveBeenCalledWith('carveLeft', 'touch:carveLeft:2');
  });
});

describe('TouchControls pause', () => {
  it('the pause button calls onPause', () => {
    const onPause = vi.fn();
    render(<TouchControls actions={{ press: vi.fn(), release: vi.fn() }} onPause={onPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

describe('TouchControls release paths', () => {
  it('releases on pointercancel and pointerleave', () => {
    const actions = { press: vi.fn(), release: vi.fn() };
    render(<TouchControls actions={actions} onPause={vi.fn()} />);
    const b = screen.getByRole('button', { name: 'METHOD' });
    fireEvent.pointerDown(b, { pointerId: 3 });
    fireEvent.pointerCancel(b, { pointerId: 3 });
    expect(actions.release).toHaveBeenCalledWith('grabW', 'touch:grabW:3');
    actions.release.mockClear();
    fireEvent.pointerDown(b, { pointerId: 4 });
    fireEvent.pointerLeave(b, { pointerId: 4 });
    expect(actions.release).toHaveBeenCalledWith('grabW', 'touch:grabW:4');
  });
});

describe('DebugPanel', () => {
  it('editing a slider mutates SURF_CONFIG, bumps the config version and notifies the game', () => {
    const game = { configChanged: vi.fn(), setGizmo: vi.fn() };
    render(<DebugPanel game={game} />);
    const before = configVersion();
    const orig = SURF_CONFIG.wave.height;
    const slider = screen.getByTestId('debug-panel').querySelector('input[type="range"]')!;
    fireEvent.change(slider, { target: { value: '3' } });
    expect(SURF_CONFIG.wave.height).toBe(3);
    expect(configVersion()).toBe(before + 1);
    expect(game.configChanged).toHaveBeenCalledTimes(1);
    SURF_CONFIG.wave.height = orig;
  });
});

describe('TouchControls multi-finger', () => {
  it('keeps the action held until the last finger on the button lifts', () => {
    const state = new ActionState<SurfAction>(SURF_BINDINGS);
    render(<TouchControls actions={state} onPause={vi.fn()} />);
    const ollie = screen.getByRole('button', { name: 'OLLIE' });
    fireEvent.pointerDown(ollie, { pointerId: 1 });
    fireEvent.pointerDown(ollie, { pointerId: 2 });
    state.tick();
    fireEvent.pointerUp(ollie, { pointerId: 1 });
    state.tick();
    expect(state.isDown('ollie')).toBe(true);
    fireEvent.pointerUp(ollie, { pointerId: 2 });
    state.tick();
    expect(state.isDown('ollie')).toBe(false);
  });
});

describe('menu keyboard behaviour', () => {
  it('ignores Enter auto-repeat in Results and TitleMenu', () => {
    const onStart = vi.fn();
    render(<TitleMenu initialSide="right" onStart={onStart} />);
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(onStart).not.toHaveBeenCalled();
    cleanup();
    const onAgain = vi.fn();
    render(<Results run={{ ...run, score: 0 }} onAgain={onAgain} onTitle={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(onAgain).not.toHaveBeenCalled();
  });

  it('leaves Enter to a focused non-primary button, and focuses the primary action', () => {
    const onStart = vi.fn();
    render(<TitleMenu initialSide="right" onStart={onStart} />);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'DROP IN' }));
    screen.getByRole('button', { name: 'LEFT' }).focus();
    key('Enter');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('labels the initials widget', () => {
    render(<Results run={run} onAgain={vi.fn()} onTitle={vi.fn()} />);
    expect(screen.getByLabelText(/initials/i)).toBeTruthy();
  });
});
