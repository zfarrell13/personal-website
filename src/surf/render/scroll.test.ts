import { describe, expect, it } from 'vitest';
import { scrollWrap } from './scroll';

describe('scrollWrap', () => {
  it('moves world objects toward −x as the frame travels, wrapping into the window', () => {
    expect(scrollWrap(50, 0, 400, -100)).toBe(50);
    expect(scrollWrap(50, 10, 400, -100)).toBe(40);
    expect(scrollWrap(50, 200, 400, -100)).toBe(250); // 50 − 200 = −150 → wraps to +250
    for (let travel = 0; travel < 5000; travel += 37) {
      const x = scrollWrap(123, travel, 400, -100);
      expect(x).toBeGreaterThanOrEqual(-100);
      expect(x).toBeLessThan(300);
    }
  });
  it('is continuous except at the wrap seam', () => {
    let prev = scrollWrap(0, 0, 400, -100);
    let jumps = 0;
    for (let travel = 0.5; travel < 800; travel += 0.5) {
      const x = scrollWrap(0, travel, 400, -100);
      if (Math.abs(x - prev) > 1) jumps++;
      prev = x;
    }
    expect(jumps).toBe(2);
  });
});
