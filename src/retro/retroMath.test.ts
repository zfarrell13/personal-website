import { describe, expect, it } from 'vitest';
import { bayer4, internalSize, levelsFromBits } from './retroMath';

describe('internalSize', () => {
  it('keeps 448 lines and the viewport aspect', () => {
    expect(internalSize(1920, 1080, 448)).toEqual({ width: 796, height: 448 });
    expect(internalSize(1440, 900, 448)).toEqual({ width: 717, height: 448 });
  });
  it('never renders above the viewport size', () => {
    expect(internalSize(300, 200, 448)).toEqual({ width: 300, height: 200 });
  });
  it('is safe for zero sizes', () => {
    expect(internalSize(0, 0, 448)).toEqual({ width: 1, height: 1 });
  });
});

describe('bayer4', () => {
  it('produces each of the 16 thresholds exactly once per 4x4 tile', () => {
    const values: number[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) values.push(bayer4(x, y) * 16);
    expect(values.map((v) => Math.round(v)).sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
  });
  it('tiles with period 4', () => {
    expect(bayer4(5, 6)).toBeCloseTo(bayer4(1, 2));
  });
});

describe('levelsFromBits', () => {
  it('converts bit depths to max levels', () => {
    expect(levelsFromBits([5, 6, 5])).toEqual([31, 63, 31]);
  });
});
