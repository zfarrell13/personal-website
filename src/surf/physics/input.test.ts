import { describe, expect, it, vi } from 'vitest';
import { ActionState } from '@/shared/input/ActionState';
import { EventBus, type SurfEvent } from './events';
import { carveFromKeys, readSurferInput, SURF_BINDINGS, type SurfAction } from './input';

describe('carveFromKeys (screen-relative)', () => {
  it('→ turns toward the lip on a RIGHT and away on a LEFT', () => {
    expect(carveFromKeys(false, true, 'right')).toBe(1);
    expect(carveFromKeys(false, true, 'left')).toBe(-1);
    expect(carveFromKeys(true, false, 'right')).toBe(-1);
    expect(carveFromKeys(true, true, 'right')).toBe(0);
  });
  it('flips when the camera faces back toward the curl (keyFacing −1)', () => {
    expect(carveFromKeys(false, true, 'right', -1)).toBe(-1);
    expect(carveFromKeys(false, true, 'left', -1)).toBe(1);
  });
});

describe('readSurferInput', () => {
  it('maps actions to a physics input with edges and the first held grab', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.keyDown('ArrowRight');
    a.keyDown('Space');
    a.keyDown('KeyS');
    a.keyDown('KeyD');
    a.keyDown('ArrowDown');
    a.tick();
    const i = readSurferInput(a, 'right');
    // Space down is the crouch (held), not the pop: the pop is the release (playtest 5).
    expect(i).toEqual({ carve: 1, spin: 1, pump: false, stall: true, ollieDown: true, ollie: false, grab: 'stalefish' });
    a.tick();
    expect(readSurferInput(a, 'left').ollie).toBe(false);
    expect(readSurferInput(a, 'left').ollieDown).toBe(true);
    expect(readSurferInput(a, 'left').carve).toBe(-1);
    expect(readSurferInput(a, 'left', undefined, -1).carve).toBe(1);
    expect(readSurferInput(a, 'left', undefined, -1).spin).toBe(1);
  });

  it('spin is screen-relative like carving: → spins the same way on screen on both sides', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.keyDown('ArrowRight');
    a.tick();
    expect(readSurferInput(a, 'right').spin).toBe(1);
    expect(readSurferInput(a, 'left').spin).toBe(-1);
    a.keyUp('ArrowRight');
    a.keyDown('ArrowLeft');
    a.tick();
    expect(readSurferInput(a, 'right').spin).toBe(-1);
    expect(readSurferInput(a, 'left').spin).toBe(1);
  });
});

describe('EventBus', () => {
  it('delivers typed events to type and wildcard subscribers, and unsubscribes', () => {
    const bus = new EventBus<SurfEvent>();
    const snap = vi.fn();
    const any = vi.fn();
    const off = bus.on('snap', snap);
    bus.onAny(any);
    bus.emit({ type: 'snap', time: 1 });
    bus.emit({ type: 'tubeEnter', time: 2 });
    expect(snap).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(2);
    off();
    bus.emit({ type: 'snap', time: 3 });
    expect(snap).toHaveBeenCalledTimes(1);
  });
});

describe('the charged ollie on touch (playtest 5)', () => {
  it('the OLLIE button behaves as Space: pressing it is the crouch, letting go the pop', () => {
    for (const [down, up] of [
      [(a: ActionState<SurfAction>) => a.press('ollie', 'touch:ollie:1'), (a: ActionState<SurfAction>) => a.release('ollie', 'touch:ollie:1')],
      [(a: ActionState<SurfAction>) => a.keyDown('Space'), (a: ActionState<SurfAction>) => a.keyUp('Space')],
    ] as const) {
      const a = new ActionState<SurfAction>(SURF_BINDINGS);
      down(a);
      a.tick();
      expect(readSurferInput(a, 'right')).toMatchObject({ ollieDown: true, ollie: false });
      a.tick();
      expect(readSurferInput(a, 'right')).toMatchObject({ ollieDown: true, ollie: false });
      up(a);
      a.tick();
      expect(readSurferInput(a, 'right')).toMatchObject({ ollieDown: false, ollie: true });
      a.tick();
      expect(readSurferInput(a, 'right')).toMatchObject({ ollieDown: false, ollie: false });
    }
  });

  it('a quick tap (down and up between two ticks) is held and let go on the same tick: a tap', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.press('ollie', 'touch:ollie:1');
    a.release('ollie', 'touch:ollie:1');
    a.tick();
    expect(readSurferInput(a, 'right')).toMatchObject({ ollieDown: true, ollie: true });
  });
});
