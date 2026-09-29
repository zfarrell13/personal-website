import { describe, expect, it } from 'vitest';
import { REEF_TILES, scrollWrap } from './scroll';

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

describe('reef tiling', () => {
  const { tile, count, start } = REEF_TILES;
  const span = tile * count;
  const centres = (travel: number) => Array.from({ length: count }, (_, k) => scrollWrap(k * tile + tile / 2, travel, span, start));
  const LO = -200;
  const HI = 450;
  it('always covers the visible range with no gaps', () => {
    for (let travel = 0; travel < span * 3; travel += 3) {
      const cs = centres(travel).sort((a, b) => a - b);
      expect(cs[0] - tile / 2).toBeLessThanOrEqual(LO);
      expect(cs[count - 1] + tile / 2).toBeGreaterThanOrEqual(HI);
      for (let i = 1; i < count; i++) expect(cs[i] - cs[i - 1]).toBeCloseTo(tile, 6);
    }
  });
  it('only wraps while the tile is outside the visible range', () => {
    for (let k = 0; k < count; k++) {
      let prev = scrollWrap(k * tile + tile / 2, 0, span, start);
      for (let travel = 1; travel < span * 3; travel += 1) {
        const x = scrollWrap(k * tile + tile / 2, travel, span, start);
        if (Math.abs(x - prev) > span / 2) {
          expect(prev + tile / 2).toBeLessThan(LO); // vanishes entirely behind the curl range
          expect(x - tile / 2).toBeGreaterThan(HI); // reappears beyond the visible range
        }
        prev = x;
      }
    }
  });
});
