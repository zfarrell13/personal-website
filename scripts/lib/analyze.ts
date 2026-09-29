import type { WaveformData } from '../../src/shared/waveform';

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const DETAIL_BINS_PER_SEC = 150;
export const OVERVIEW_BINS = 1024;
const LOW_MID_HZ = 250;
const MID_HIGH_HZ = 3000;

// RBJ Audio EQ Cookbook, normalized by a0.
export function lowpass(freq: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function highpass(freq: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Transposed direct form II. */
export function applyBiquad(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    out[i] = y;
  }
  return out;
}

const cascade = (input: Float32Array, filters: Biquad[]) => filters.reduce((sig, f) => applyBiquad(sig, f), input);

/** Two cascaded Butterworth sections per edge (24 dB/oct, Linkwitz-Riley style). */
export function bandSplit(mono: Float32Array, sampleRate: number) {
  const lp1 = lowpass(LOW_MID_HZ, sampleRate);
  const hp1 = highpass(LOW_MID_HZ, sampleRate);
  const lp2 = lowpass(MID_HIGH_HZ, sampleRate);
  const hp2 = highpass(MID_HIGH_HZ, sampleRate);
  return {
    low: cascade(mono, [lp1, lp1]),
    mid: cascade(mono, [hp1, hp1, lp2, lp2]),
    high: cascade(mono, [hp2, hp2]),
  };
}

export function peakBins(signal: Float32Array, binCount: number): Float32Array {
  const out = new Float32Array(binCount);
  const n = signal.length;
  for (let b = 0; b < binCount; b++) {
    const start = Math.floor((b * n) / binCount);
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / binCount));
    let peak = 0;
    for (let i = start; i < end && i < n; i++) {
      const v = Math.abs(signal[i]!);
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

const toBytes = (peaks: Float32Array, scale: number) => {
  const out = new Uint8Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) out[i] = Math.min(255, Math.round(peaks[i]! * scale));
  return out;
};

export function analyzeWaveform(mono: Float32Array, sampleRate: number): { detail: WaveformData; overview: WaveformData } {
  const bands = bandSplit(mono, sampleRate);
  const detailCount = Math.max(1, Math.ceil((mono.length / sampleRate) * DETAIL_BINS_PER_SEC));
  const d = { low: peakBins(bands.low, detailCount), mid: peakBins(bands.mid, detailCount), high: peakBins(bands.high, detailCount) };
  const o = {
    low: peakBins(bands.low, OVERVIEW_BINS),
    mid: peakBins(bands.mid, OVERVIEW_BINS),
    high: peakBins(bands.high, OVERVIEW_BINS),
  };
  let max = 0;
  for (const arr of [d.low, d.mid, d.high]) for (const v of arr) if (v > max) max = v;
  // One shared scale keeps relative band energy honest (a quiet hi-hat stays small).
  const scale = max > 0 ? 255 / max : 0;
  return {
    detail: {
      binsPerSec: DETAIL_BINS_PER_SEC,
      binCount: detailCount,
      low: toBytes(d.low, scale),
      mid: toBytes(d.mid, scale),
      high: toBytes(d.high, scale),
    },
    overview: {
      binsPerSec: 0,
      binCount: OVERVIEW_BINS,
      low: toBytes(o.low, scale),
      mid: toBytes(o.mid, scale),
      high: toBytes(o.high, scale),
    },
  };
}
