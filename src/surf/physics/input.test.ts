import { describe, expect, it, vi } from 'vitest';
import { ActionState } from '@/shared/input/ActionState';
import { EventBus, type SurfEvent } from './events';
import { carveFromKeys, readSurferInput, SURF_BINDINGS, type SurfAction } from './input';

describe('carveFromKeys (screen-relative)', () => {
  it('→ turns toward the lip on a LEFT and away on a RIGHT', () => {
    expect(carveFromKeys(false, true, 'left')).toBe(1);
    expect(carveFromKeys(false, true, 'right')).toBe(-1);
    expect(carveFromKeys(true, false, 'left')).toBe(-1);
    expect(carveFromKeys(true, true, 'left')).toBe(0);
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
    const i = readSurferInput(a, 'left');
    expect(i).toEqual({ carve: 1, spin: 1, pump: false, stall: true, ollie: true, grab: 'stalefish' });
    a.tick();
    expect(readSurferInput(a, 'right').ollie).toBe(false);
    expect(readSurferInput(a, 'right').carve).toBe(-1);
  });

  it('spin is screen-relative like carving: → spins the same way on screen on both sides', () => {
    const a = new ActionState<SurfAction>(SURF_BINDINGS);
    a.keyDown('ArrowRight');
    a.tick();
    expect(readSurferInput(a, 'left').spin).toBe(1);
    expect(readSurferInput(a, 'right').spin).toBe(-1);
    a.keyUp('ArrowRight');
    a.keyDown('ArrowLeft');
    a.tick();
    expect(readSurferInput(a, 'left').spin).toBe(-1);
    expect(readSurferInput(a, 'right').spin).toBe(1);
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
