import { describe, expect, it } from 'vitest';
import { mulberry32, shuffle } from './random';

describe('random', () => {
  it('mulberry32 is seeded and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('shuffles deterministically without losing items', () => {
    const a = shuffle([1, 2, 3, 4, 5], mulberry32(1));
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(shuffle([1, 2, 3, 4, 5], mulberry32(1))).toEqual(a);
  });
});
