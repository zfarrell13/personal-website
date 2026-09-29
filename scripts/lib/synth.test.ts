import { describe, expect, it } from 'vitest';
import { synthTestTrack } from './synth';

const opts = { bpm: 120, rootHz: 55, bars: 12, sampleRate: 22050, leadInSec: 0.25, seed: 7 };
const rmsWindow = (a: Float32Array, start: number, len: number) => {
  let s = 0;
  for (let i = start; i < start + len; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / len);
};

describe('synthTestTrack', () => {
  it('has the exact expected length', () => {
    const { left, right } = synthTestTrack(opts);
    const expected = Math.round(0.25 * 22050) + Math.round(12 * 4 * 0.5 * 22050);
    expect(left.length).toBe(expected);
    expect(right.length).toBe(expected);
  });
  it('stays within [-1, 1]', () => {
    const { left } = synthTestTrack(opts);
    expect(left.every((v) => v >= -1 && v <= 1)).toBe(true);
  });
  it('is deterministic', () => {
    const a = synthTestTrack(opts).left;
    const b = synthTestTrack(opts).left;
    expect(a).toEqual(b);
  });
  it('puts kicks on the beat grid', () => {
    const { left } = synthTestTrack(opts);
    const sr = opts.sampleRate;
    const win = Math.round(0.03 * sr);
    const beat4 = Math.round((0.25 + 4 * 0.5) * sr);
    expect(rmsWindow(left, beat4, win)).toBeGreaterThan(3 * rmsWindow(left, beat4 - win - Math.round(0.1 * sr), win));
  });
});
