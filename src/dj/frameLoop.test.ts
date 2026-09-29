import { describe, expect, it, vi } from 'vitest';
import { FrameLoop } from './frameLoop';

describe('FrameLoop', () => {
  it('passes dt and removes callbacks', () => {
    const loop = new FrameLoop();
    const fn = vi.fn();
    const off = loop.add(fn);
    loop.step(1000);
    loop.step(1016);
    expect(fn).toHaveBeenLastCalledWith(expect.closeTo(0.016, 6), 1.016);
    off();
    loop.step(1032);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(loop.frames).toBe(3);
  });
  it('clamps long gaps', () => {
    const loop = new FrameLoop();
    const fn = vi.fn();
    loop.add(fn);
    loop.step(0);
    loop.step(5000);
    expect(fn.mock.calls[1]![0]).toBe(0.1);
  });

  it('runs a single rAF loop across repeated start / StrictMode stop-start', () => {
    let nextId = 1;
    const pending = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pending.set(nextId, cb);
      return nextId++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => void pending.delete(id));
    try {
      const loop = new FrameLoop();
      loop.start();
      loop.start();
      expect(pending.size).toBe(1);
      loop.stop(); // StrictMode: effect cleanup...
      loop.start(); // ...then re-run
      expect(pending.size).toBe(1);
      const [[, cb]] = [...pending];
      pending.clear();
      cb!(16);
      expect(pending.size).toBe(1); // re-armed exactly once
      loop.stop();
      expect(pending.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('tolerates add/remove from inside a callback and double unsubscribe', () => {
    const loop = new FrameLoop();
    const late = vi.fn();
    const b = vi.fn();
    let offB = () => {};
    loop.add(() => {
      offB();
      loop.add(late);
    });
    offB = loop.add(b);
    loop.step(0);
    expect(b).toHaveBeenCalledTimes(1); // this frame still ran the snapshot
    expect(late).not.toHaveBeenCalled();
    loop.step(16);
    expect(b).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
    offB();
    offB();
  });
});
