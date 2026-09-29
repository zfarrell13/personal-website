import { describe, expect, it } from 'vitest';
import { meterSegments, PeakHold } from './peakHold';

describe('PeakHold', () => {
  it('holds the peak for 1 s then falls', () => {
    const p = new PeakHold(1, 0.1);
    expect(p.update(12, 0.016)).toBe(12);
    expect(p.update(3, 0.5)).toBe(12);
    expect(p.update(3, 0.6)).toBe(11);
    expect(p.update(3, 0.1)).toBe(10);
    expect(p.update(14, 0.016)).toBe(14);
  });
});

describe('meterSegments', () => {
  it('lights segments from the ladder for a finite peak', () => {
    expect(meterSegments(0)).toBe(0);
    expect(meterSegments(1)).toBe(15); // 0 dBFS = +15 on the meter: every segment
  });

  it('treats non-finite peaks (NaN, ±Infinity) as silence', () => {
    expect(meterSegments(Number.NaN)).toBe(0);
    expect(meterSegments(Number.POSITIVE_INFINITY)).toBe(0);
    expect(meterSegments(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
