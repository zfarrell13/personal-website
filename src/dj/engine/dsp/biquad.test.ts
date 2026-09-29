import { describe, expect, it } from 'vitest';
import { Biquad, biquadCoefs, biquadMagnitude } from './biquad';

const SR = 48000;

describe('biquad', () => {
  it('lowpass/highpass are −3 dB at the corner (Butterworth Q)', () => {
    for (const kind of ['lowpass', 'highpass'] as const) {
      expect(20 * Math.log10(biquadMagnitude(biquadCoefs(kind, 1000, SR), 1000, SR))).toBeCloseTo(-3.01, 1);
    }
  });
  it('allpass has unity magnitude everywhere', () => {
    const c = biquadCoefs('allpass', 3000, SR);
    for (const f of [20, 300, 3000, 15000]) expect(biquadMagnitude(c, f, SR)).toBeCloseTo(1, 9);
  });
  it('design() matches biquadCoefs() and processes a DC step to unity for lowpass', () => {
    const b = new Biquad().design('lowpass', 500, SR);
    const ref = new Biquad().set(biquadCoefs('lowpass', 500, SR));
    let y = 0;
    let r = 0;
    for (let i = 0; i < 4800; i++) {
      y = b.process(1);
      r = ref.process(1);
    }
    expect(y).toBeCloseTo(1, 6);
    expect(y).toBe(r);
  });
});
