import { describe, expect, it } from 'vitest';
import {
  channelFaderGain,
  crossfaderGains,
  cueMixGains,
  eqGain,
  gainToDb,
  IsolatorCore,
  ladderSegments,
  peakOf,
  softClipCurve,
  toNativeQ,
  trimGain,
} from './MixerCore';

const SR = 48000;
const rmsOut = (hz: number, gains: { low: number; mid: number; high: number }) => {
  const iso = new IsolatorCore(SR);
  iso.gains = gains;
  const n = SR; // 1 s
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const y = iso.process(Math.sin((2 * Math.PI * hz * i) / SR));
    if (i > SR / 2) {
      sum += y * y;
      count++;
    }
  }
  return Math.sqrt(sum / count);
};
const ref = Math.SQRT1_2;
const open = { low: 1, mid: 1, high: 1 };

describe('isolator', () => {
  it('sums flat when all bands are at 0 dB', () => {
    for (const hz of [50, 250, 1000, 3000, 10000]) {
      expect(Math.abs(gainToDb(rmsOut(hz, open) / ref))).toBeLessThan(0.1);
    }
  });
  it('LOW kill removes a 40 Hz sine by more than 60 dB', () => {
    expect(gainToDb(rmsOut(40, { ...open, low: 0 }) / ref)).toBeLessThan(-60);
  });
  it('HIGH kill removes a 16 kHz sine by more than 60 dB', () => {
    expect(gainToDb(rmsOut(16000, { ...open, high: 0 }) / ref)).toBeLessThan(-60);
  });
  it('killing all three bands is total silence', () => {
    expect(rmsOut(1000, { low: 0, mid: 0, high: 0 })).toBe(0);
  });
  it('MID kill attenuates a 1 kHz sine by more than 35 dB (LR4 neighbour leakage)', () => {
    expect(gainToDb(rmsOut(1000, { ...open, mid: 0 }) / ref)).toBeLessThan(-35);
  });
});

describe('gain laws', () => {
  it('trim: −∞ .. 0 dB .. +9 dB', () => {
    expect(trimGain(0)).toBe(0);
    expect(trimGain(0.5)).toBeCloseTo(1, 9);
    expect(gainToDb(trimGain(1))).toBeCloseTo(9, 6);
  });
  it('eq: kill .. 0 dB .. +6 dB', () => {
    expect(eqGain(0)).toBe(0);
    expect(eqGain(0.5)).toBeCloseTo(1, 9);
    expect(gainToDb(eqGain(1))).toBeCloseTo(6, 6);
  });
});

describe('fader curves', () => {
  it('channel fader curves are monotonic with fixed ends', () => {
    for (const c of [0, 1, 2] as const) {
      expect(channelFaderGain(0, c)).toBe(0);
      expect(channelFaderGain(1, c)).toBe(1);
      let prev = -1;
      for (let x = 0; x <= 1; x += 0.01) {
        const g = channelFaderGain(x, c);
        expect(g).toBeGreaterThanOrEqual(prev);
        prev = g;
      }
    }
    expect(channelFaderGain(0.5, 0)).toBeLessThan(channelFaderGain(0.5, 1));
    expect(channelFaderGain(0.5, 2)).toBeGreaterThan(0.99);
  });
  it('crossfader: constant power, full-both-middle and scratch cut', () => {
    const [a0, b0] = crossfaderGains(0.5, 0);
    expect(a0 * a0 + b0 * b0).toBeCloseTo(1, 9);
    expect(crossfaderGains(0.5, 1)).toEqual([1, 1]);
    expect(crossfaderGains(0, 2)).toEqual([1, 0]);
    expect(crossfaderGains(0.1, 2)).toEqual([1, 1]);
    expect(crossfaderGains(1, 2)).toEqual([0, 1]);
    for (const c of [0, 1, 2] as const) {
      expect(crossfaderGains(0, c)[1]).toBe(0);
      expect(crossfaderGains(1, c)[0]).toBeCloseTo(0, 12);
    }
  });
  it('cue/master mix is constant power', () => {
    const [c, m] = cueMixGains(0.3);
    expect(c * c + m * m).toBeCloseTo(1, 9);
    expect(cueMixGains(0)).toEqual([1, 0]);
  });
});

describe('native helpers', () => {
  it('converts a linear Q to Web Audio dB Q for lowpass/highpass only', () => {
    expect(toNativeQ('lowpass', Math.SQRT1_2)).toBeCloseTo(-3.0103, 4);
    expect(toNativeQ('allpass', Math.SQRT1_2)).toBe(Math.SQRT1_2);
  });
  it('soft clip curve is odd, bounded and monotonic', () => {
    const c = softClipCurve(1025);
    expect(c[512]).toBeCloseTo(0, 9);
    expect(c[0]).toBeCloseTo(-1, 9);
    expect(c[1024]).toBeCloseTo(1, 9);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThan(c[i - 1]!);
  });
  it('meters: peak and LED ladder', () => {
    expect(peakOf(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7, 6);
    expect(ladderSegments(0)).toBe(0);
    expect(ladderSegments(10 ** (-15 / 20))).toBe(11); // −15 dBFS = meter 0 dB → segments up to "0"
    expect(ladderSegments(1)).toBe(15);
  });
});
