/** RBJ Audio-EQ-Cookbook biquads (the same formulas the Web Audio BiquadFilterNode uses), normalised by a0. */
export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'allpass';

export const BUTTERWORTH_Q = Math.SQRT1_2;

export function biquadCoefs(kind: BiquadKind, freq: number, sampleRate: number, q = BUTTERWORTH_Q): BiquadCoefs {
  const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      break;
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      break;
    case 'allpass':
      b0 = 1 - alpha;
      b1 = -2 * cos;
      b2 = 1 + alpha;
      break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** One biquad section, transposed direct form II. Allocation-free after construction. */
export class Biquad {
  private c: BiquadCoefs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  private z1 = 0;
  private z2 = 0;

  set(c: BiquadCoefs): this {
    this.c = { ...c };
    return this;
  }

  /** Recomputes coefficients in place (allocation-free; safe in the audio thread). */
  design(kind: BiquadKind, freq: number, sampleRate: number, q = BUTTERWORTH_Q): this {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const c = this.c;
    switch (kind) {
      case 'lowpass':
        c.b0 = (1 - cos) / 2 / a0;
        c.b1 = (1 - cos) / a0;
        c.b2 = c.b0;
        break;
      case 'highpass':
        c.b0 = (1 + cos) / 2 / a0;
        c.b1 = -(1 + cos) / a0;
        c.b2 = c.b0;
        break;
      case 'bandpass':
        c.b0 = alpha / a0;
        c.b1 = 0;
        c.b2 = -alpha / a0;
        break;
      case 'allpass':
        c.b0 = (1 - alpha) / a0;
        c.b1 = (-2 * cos) / a0;
        c.b2 = (1 + alpha) / a0;
        break;
    }
    c.a1 = (-2 * cos) / a0;
    c.a2 = (1 - alpha) / a0;
    return this;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  process(x: number): number {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
}

/** Magnitude response |H(e^jw)| of a section at `freq`. */
export function biquadMagnitude(c: BiquadCoefs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}
