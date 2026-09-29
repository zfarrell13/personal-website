import { describe, expect, it } from 'vitest';
import { analyzeWaveform, bandSplit, OVERVIEW_BINS, peakBins } from './analyze';

const SR = 44100;
const sine = (hz: number, sec: number, amp = 0.8) => {
  const out = new Float32Array(Math.round(SR * sec));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
};
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const mean = (a: Uint8Array) => a.reduce((s, v) => s + v, 0) / a.length;

describe('bandSplit', () => {
  it.each([
    [80, 'low'],
    [1000, 'mid'],
    [8000, 'high'],
  ] as const)('routes %d Hz to %s', (hz, band) => {
    const bands = bandSplit(sine(hz, 1), SR);
    const levels = { low: rms(bands.low), mid: rms(bands.mid), high: rms(bands.high) };
    for (const other of ['low', 'mid', 'high'] as const) {
      if (other !== band) expect(levels[band]).toBeGreaterThan(5 * levels[other]);
    }
  });
});

describe('peakBins', () => {
  it('takes the max absolute value per bin', () => {
    const bins = peakBins(new Float32Array([0.1, -0.5, 0.2, 0.3, -0.9, 0]), 3);
    expect([...bins].map((v) => +v.toFixed(2))).toEqual([0.5, 0.3, 0.9]);
  });
});

describe('analyzeWaveform', () => {
  it('produces 150 bins/sec detail and a 1024-bin overview', () => {
    const { detail, overview } = analyzeWaveform(sine(80, 2), SR);
    expect(detail.binsPerSec).toBe(150);
    expect(detail.binCount).toBe(300);
    expect(overview.binsPerSec).toBe(0);
    expect(overview.binCount).toBe(OVERVIEW_BINS);
    expect(mean(detail.low)).toBeGreaterThan(5 * mean(detail.high));
    expect(Math.max(...detail.low)).toBe(255);
  });
  it('handles silence without NaN', () => {
    const { detail } = analyzeWaveform(new Float32Array(SR), SR);
    expect(Math.max(...detail.low, ...detail.mid, ...detail.high)).toBe(0);
  });
});
