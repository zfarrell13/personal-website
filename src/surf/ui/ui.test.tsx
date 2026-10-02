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

describe('TitleMenu — back to the site menu', () => {
  it('shows ◀ MENU only when there is a menu to go back to', () => {
    render(<TitleMenu initialSide="right" onStart={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '◀ MENU' })).toBeNull();
  });

  it('◀ MENU, Esc and Backspace call onMenu; a held Esc (repeat) does not', () => {
    const onMenu = vi.fn();
    render(<TitleMenu initialSide="right" onStart={vi.fn()} onMenu={onMenu} />);
    fireEvent.click(screen.getByRole('button', { name: '◀ MENU' }));
    expect(onMenu).toHaveBeenCalledTimes(1);
    key('Escape');
    key('Backspace');
    expect(onMenu).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: 'Escape', repeat: true });
    fireEvent.keyDown(window, { key: 'Backspace', altKey: true });
    expect(onMenu).toHaveBeenCalledTimes(3);
  });

  it('Backspace typed into a field (the ?debug panel inputs) stays in the field', () => {
    const onMenu = vi.fn();
    render(<TitleMenu initialSide="right" onStart={vi.fn()} onMenu={onMenu} />);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Backspace' });
    input.remove();
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('Enter on a focused ◀ MENU goes back rather than dropping in', () => {
    const onMenu = vi.fn();
    const onStart = vi.fn();
    render(<TitleMenu initialSide="right" onStart={onStart} onMenu={onMenu} />);
    screen.getByRole('button', { name: '◀ MENU' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', bubbles: true });
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('TitleMenu — GUIDE option', () => {
  it('shows ON by default; mouse clicks and the G key toggle it', () => {
    const onGuide = vi.fn();
    const { rerender } = render(<TitleMenu initialSide="right" onStart={vi.fn()} guide onGuide={onGuide} />);
    const on = screen.getByRole('button', { name: 'GUIDE ON' });
    const off = screen.getByRole('button', { name: 'GUIDE OFF' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(off);
    expect(onGuide).toHaveBeenLastCalledWith(false);
    key('g');
    expect(onGuide).toHaveBeenLastCalledWith(false);
    rerender(<TitleMenu initialSide="right" onStart={vi.fn()} guide={false} onGuide={onGuide} />);
    expect(screen.getByRole('button', { name: 'GUIDE OFF' }).getAttribute('aria-pressed')).toBe('true');
    key('G');
    expect(onGuide).toHaveBeenLastCalledWith(true);
  });

  it('the GUIDE buttons are in the Tab order, between the break buttons and DROP IN', () => {
    render(<TitleMenu initialSide="right" onStart={vi.fn()} guide onGuide={vi.fn()} />);
    const tabbable = screen
      .getAllByRole('button')
      .filter((b) => !(b as HTMLButtonElement).disabled && b.tabIndex >= 0)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(tabbable).toEqual(['LEFT', 'RIGHT', 'GUIDE ON', 'GUIDE OFF', 'DROP IN']);
  });

  it('Enter on a focused GUIDE button does not drop in', () => {
    const onStart = vi.fn();
    render(<TitleMenu initialSide="right" onStart={onStart} guide onGuide={vi.fn()} />);
    screen.getByRole('button', { name: 'GUIDE OFF' }).focus();
    key('Enter');
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('Results', () => {
  it('a closeout reads CLOSED OUT', () => {
    render(<Results run={{ ...run, wipeoutReason: 'closedOut' }} onAgain={vi.fn()} onTitle={vi.fn()} />);
    expect(screen.getByText(/WIPEOUT — CLOSED OUT/)).toBeTruthy();
  });
  it("running into the pier reads PIER'D", () => {
    render(<Results run={{ ...run, wipeoutReason: 'pierd' }} onAgain={vi.fn()} onTitle={vi.fn()} />);
    expect(screen.getByText(/WIPEOUT — PIER'D/)).toBeTruthy();
  });

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
  it('pops ▲ PUMP! (keyboard and touch wording) while the coach prompts, re-popping on each pump', () => {
    const store = createSurfStore();
    render(<Hud store={store} />);
    expect(screen.queryByTestId('coach-pump')).toBeNull();
    act(() => store.setState({ pumpPrompt: true, pumpCount: 3 }));
    const el = screen.getByTestId('coach-pump');
    expect(el.textContent).toContain('▲ PUMP! Press ↑');
    expect(el.textContent).toContain('Tap ▲');
    expect(el.getAttribute('data-paused')).toBe('false');
    act(() => store.setState({ pumpCount: 4 }));
    expect(screen.getByTestId('coach-pump')).not.toBe(el);
    act(() => store.setState({ phase: 'paused' }));
    expect(screen.getByTestId('coach-pump').getAttribute('data-paused')).toBe('true');
    act(() => store.setState({ pumpTube: true }));
    expect(screen.getByTestId('coach-pump').textContent).toContain('▲ PUMP OUT! Press ↑');
    act(() => store.setState({ pumpPrompt: false }));
    expect(screen.queryByTestId('coach-pump')).toBeNull();
  });
  it('flashes ⚡ FAST SECTION while a fast section is on', () => {
    const store = createSurfStore();
    render(<Hud store={store} />);
    expect(screen.queryByTestId('fast-section')).toBeNull();
    act(() => store.setState({ fastSection: true }));
    expect(screen.getByTestId('fast-section').textContent).toBe('⚡ FAST SECTION');
    act(() => store.setState({ fastSection: false }));
    expect(screen.queryByTestId('fast-section')).toBeNull();
  });
  it('shows PIER AHEAD while the pier is close down the line', () => {
    const store = createSurfStore();
    render(<Hud store={store} />);
    expect(screen.queryByTestId('pier-ahead')).toBeNull();
    act(() => store.setState({ pierAhead: true }));
    expect(screen.getByTestId('pier-ahead').textContent).toBe('PIER AHEAD');
    act(() => store.setState({ pierAhead: false }));
    expect(screen.queryByTestId('pier-ahead')).toBeNull();
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

describe('TouchControls: a held OLLIE taken by the OS is cancelled, not popped', () => {
  it('pointercancel / lost capture while held calls onCancel before the release; a normal lift does not', () => {
    for (const how of ['cancel', 'capture'] as const) {
      const order: string[] = [];
      const actions = { press: vi.fn(), release: vi.fn(() => order.push('release')) };
      const onCancel = vi.fn((a: string) => order.push(`cancel:${a}`));
      const { unmount } = render(<TouchControls actions={actions} onPause={vi.fn()} onCancel={onCancel} />);
      const ollie = screen.getByRole('button', { name: 'OLLIE' });
      fireEvent.pointerDown(ollie, { pointerId: 1 });
      if (how === 'cancel') fireEvent.pointerCancel(ollie, { pointerId: 1 });
      else fireEvent.lostPointerCapture(ollie, { pointerId: 1 });
      expect(order).toEqual(['cancel:ollie', 'release']);
      // A normal lift: the capture is lost after the pointer is up — no cancel.
      fireEvent.pointerDown(ollie, { pointerId: 2 });
      fireEvent.pointerUp(ollie, { pointerId: 2 });
      fireEvent.lostPointerCapture(ollie, { pointerId: 2 });
      expect(onCancel).toHaveBeenCalledTimes(1);
      unmount();
    }
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

  it('ignores held arrow auto-repeat on Results until a fresh keydown', () => {
    render(<Results run={run} onAgain={vi.fn()} onTitle={vi.fn()} />);
    const initials = () => screen.getByTestId('initials').textContent;
    expect(initials()).toBe('AAA');
    fireEvent.keyDown(window, { key: 'ArrowUp', repeat: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
    expect(initials()).toBe('AAA');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(initials()).toBe('BAA');
    fireEvent.keyDown(window, { key: 'ArrowUp', repeat: true });
    expect(initials()).toBe('CAA');
  });

  it('labels the initials widget', () => {
    render(<Results run={run} onAgain={vi.fn()} onTitle={vi.fn()} />);
    expect(screen.getByLabelText(/initials/i)).toBeTruthy();
  });
});
