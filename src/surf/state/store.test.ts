import { describe, expect, it, vi } from 'vitest';
import { createSurfStore, pushTicker, ThrottledWriter } from './store';

describe('ThrottledWriter', () => {
  it('writes at most 15 times per second and merges patches', () => {
    const store = createSurfStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const w = new ThrottledWriter(store, 15);
    let writes = 0;
    for (let frame = 0; frame < 120; frame++) {
      const now = frame * (1000 / 120); // one second at 120 fps
      w.push({ score: frame });
      w.push({ speedKmh: frame * 2 });
      if (w.tick(now)) writes++;
    }
    expect(writes).toBeLessThanOrEqual(15);
    expect(writes).toBeGreaterThanOrEqual(14);
    expect(listener).toHaveBeenCalledTimes(writes);
    w.flush(1000);
    expect(store.getState().score).toBe(119);
    expect(store.getState().speedKmh).toBe(238);
  });

  it('does nothing without pending changes', () => {
    const store = createSurfStore();
    const w = new ThrottledWriter(store);
    expect(w.tick(0)).toBe(false);
  });
});

describe('pushTicker', () => {
  it('keeps the last five items', () => {
    let list = [] as ReturnType<typeof pushTicker>;
    for (let i = 0; i < 8; i++) list = pushTicker(list, { id: i, text: `T${i}`, points: i });
    expect(list.map((t) => t.id)).toEqual([3, 4, 5, 6, 7]);
  });
});
