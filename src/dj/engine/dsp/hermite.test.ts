import { describe, expect, it } from 'vitest';
import { hermite4, readHermite } from './hermite';

describe('hermite4', () => {
  it('passes through the inner points', () => {
    expect(hermite4(1, 2, 3, 4, 0)).toBe(2);
    expect(hermite4(1, 2, 3, 4, 1)).toBeCloseTo(3, 12);
  });
  it('is exact for straight lines', () => {
    expect(hermite4(0, 1, 2, 3, 0.25)).toBeCloseTo(1.25, 12);
  });
});

describe('readHermite', () => {
  it('reconstructs a band-limited sine at fractional positions within 1e-4', () => {
    const sr = 48000;
    const hz = 440;
    const data = new Float32Array(4800).map((_, i) => Math.sin((2 * Math.PI * hz * i) / sr));
    let maxErr = 0;
    for (let k = 0; k < 2000; k++) {
      const pos = 100 + k * 0.37;
      const err = Math.abs(readHermite(data, pos) - Math.sin((2 * Math.PI * hz * pos) / sr));
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(1e-4);
  });
  it('treats samples outside the buffer as silence', () => {
    const data = new Float32Array([1, 1, 1, 1]);
    expect(readHermite(data, -5)).toBe(0);
    expect(readHermite(data, 10)).toBe(0);
  });
});
