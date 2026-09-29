import type { CurveKind } from '../../constants';
import { Biquad, biquadCoefs, BUTTERWORTH_Q, type BiquadCoefs } from '../dsp/biquad';

/** Isolator crossover points. */
export const ISO_LOW_HZ = 250;
export const ISO_HIGH_HZ = 3000;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));

/** TRIM knob 0..1 → gain. 0 = −∞, 0.5 = 0 dB, 1 = +9 dB. */
export function trimGain(knob: number): number {
  const x = clamp01(knob);
  return x < 0.5 ? (x / 0.5) ** 2 : dbToGain(18 * (x - 0.5));
}

/** Isolator band knob 0..1 → gain. 0 = kill (exactly 0), 0.5 = 0 dB, 1 = +6 dB. */
export function eqGain(knob: number): number {
  const x = clamp01(knob);
  if (x <= 0.005) return 0;
  return x < 0.5 ? (x / 0.5) ** 3 : dbToGain(12 * (x - 0.5));
}

/** MASTER LEVEL / HEADPHONES LEVEL knob 0..1 → gain (0 dB at 0.84, ≈ +3 dB at 1). */
export function levelGain(knob: number): number {
  const x = clamp01(knob);
  return 1.4125 * x * x;
}

/** Channel fader position 0..1 → gain for the three DJM-style curves. */
export function channelFaderGain(pos: number, curve: CurveKind): number {
  const x = clamp01(pos);
  switch (curve) {
    case 0:
      return x * x; // long, gradual
    case 1:
      return x; // linear
    case 2:
      return 1 - (1 - x) ** 8; // sharp rise at the bottom
  }
}

/** Crossfader 0 (full A) .. 1 (full B) → [gainA, gainB] for the three curves. */
export function crossfaderGains(pos: number, curve: CurveKind): [number, number] {
  const x = clamp01(pos);
  switch (curve) {
    case 0:
      return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)]; // constant power
    case 1:
      return [Math.min(1, 2 * (1 - x)), Math.min(1, 2 * x)]; // no dip in the middle
    case 2: {
      const cut = 1 / 32; // scratch cut
      return [clamp01((1 - x) / cut), clamp01(x / cut)];
    }
  }
}

/** CUE/MASTER MIX knob 0 (cue only) .. 1 (master only) → [cueGain, masterGain], constant power. */
export function cueMixGains(knob: number): [number, number] {
  const x = clamp01(knob);
  return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];
}

/**
 * The biquad sections per isolator band (LR4 = two cascaded Butterworth sections).
 * The low band also gets the 3 kHz LR4 all-pass so low + mid + high sums flat
 * (approximately flat; see the flat-sum test for the measured deviation). The native graph uses exactly these.
 */
export interface IsolatorSection {
  type: 'lowpass' | 'highpass' | 'allpass';
  freq: number;
  q: number;
}
export const ISOLATOR_BANDS: Record<'low' | 'mid' | 'high', IsolatorSection[]> = {
  low: [
    { type: 'lowpass', freq: ISO_LOW_HZ, q: BUTTERWORTH_Q },
    { type: 'lowpass', freq: ISO_LOW_HZ, q: BUTTERWORTH_Q },
    { type: 'allpass', freq: ISO_HIGH_HZ, q: BUTTERWORTH_Q },
  ],
  mid: [
    { type: 'highpass', freq: ISO_LOW_HZ, q: BUTTERWORTH_Q },
    { type: 'highpass', freq: ISO_LOW_HZ, q: BUTTERWORTH_Q },
    { type: 'lowpass', freq: ISO_HIGH_HZ, q: BUTTERWORTH_Q },
    { type: 'lowpass', freq: ISO_HIGH_HZ, q: BUTTERWORTH_Q },
  ],
  high: [
    { type: 'highpass', freq: ISO_HIGH_HZ, q: BUTTERWORTH_Q },
    { type: 'highpass', freq: ISO_HIGH_HZ, q: BUTTERWORTH_Q },
  ],
};

/**
 * Web Audio's BiquadFilterNode interprets Q for lowpass/highpass in dB (Q_lin = 10^(Q/20)),
 * but linearly for bandpass/allpass. Converts a linear Q for use on a native node.
 */
export function toNativeQ(type: IsolatorSection['type'] | 'bandpass', qLinear: number): number {
  return type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(qLinear) : qLinear;
}

/** Linear region of the soft clip (0.5 = −6 dBFS). */
export const SOFT_CLIP_KNEE = 0.5;

/**
 * Master soft clip transfer curve for a WaveShaperNode: odd, monotonic, |y| < 1.
 * Exactly unity (y = x) up to the knee, then a tanh shoulder with unity slope at the knee
 * (C1-continuous) that saturates towards ±1. Because the slope is 1 at the knee and the
 * shoulder is concave, it cannot reach 1 by |x| = 1: full scale maps to
 * knee + (1 − knee)·tanh(1) ≈ 0.88.
 */
export function softClipCurve(points = 4096): Float32Array {
  const out = new Float32Array(points);
  const k = SOFT_CLIP_KNEE;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= k ? a : k + (1 - k) * Math.tanh((a - k) / (1 - k));
    out[i] = Math.sign(x) * y;
  }
  return out;
}

/** Peak absolute sample in a buffer. */
export function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]!);
    if (v > p) p = v;
  }
  return p;
}

/** RMS of a buffer. */
export function rmsOf(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
  return Math.sqrt(s / Math.max(1, buf.length));
}

/** DJM-style 15-segment LED ladder: dB thresholds per segment (bottom → top). */
export const LADDER_DB = [-24, -21, -18, -15, -12, -10, -8, -6, -4, -2, 0, 1, 2, 4, 6] as const;
/** Number of lit segments for a peak value (linear), relative to −15 dBFS = 0 dB on the meter. */
export function ladderSegments(peak: number, headroomDb = 15): number {
  const db = gainToDb(peak) + headroomDb;
  let n = 0;
  for (const t of LADDER_DB) if (db >= t) n++;
  return n;
}

/** Offline/reference implementation of the isolator (mono). Used by tests; mirrors the native node graph. */
export class IsolatorCore {
  private readonly chains: Record<'low' | 'mid' | 'high', Biquad[]>;
  gains = { low: 1, mid: 1, high: 1 };

  constructor(sampleRate: number) {
    const build = (s: IsolatorSection[]) => s.map((x) => new Biquad().set(biquadCoefs(x.type, x.freq, sampleRate, x.q)));
    this.chains = { low: build(ISOLATOR_BANDS.low), mid: build(ISOLATOR_BANDS.mid), high: build(ISOLATOR_BANDS.high) };
  }

  process(x: number): number {
    let out = 0;
    for (const band of ['low', 'mid', 'high'] as const) {
      let v = x;
      for (const f of this.chains[band]) v = f.process(v);
      out += v * this.gains[band];
    }
    return out;
  }
}

export type { BiquadCoefs };
