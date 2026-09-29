import { describe, expect, it } from 'vitest';
import { ColorFxCore } from './ColorFxCore';

const SR = 48000;
const N = 4800;
const sine = (hz: number, amp = 0.5) => new Float32Array(N).map((_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (a: Float32Array, from = N / 2) => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / (a.length - from));
};
function run(fx: ColorFxCore, input: Float32Array): Float32Array {
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  for (let o = 0; o < N; o += 128) {
    fx.process(input.subarray(o, o + 128), input.subarray(o, o + 128), outL.subarray(o, o + 128), outR.subarray(o, o + 128), 128);
  }
  return outL;
}

describe('ColorFxCore', () => {
  it('is bit-exact bypass at the knob centre', () => {
    const fx = new ColorFxCore(SR);
    fx.set('CRUSH', 0, 0.5);
    const x = sine(440);
    expect(run(fx, x)).toEqual(x);
  });

  it('SWEEP right is a band-pass that removes low frequencies', () => {
    const fx = new ColorFxCore(SR);
    fx.set('SWEEP', 1, 0.5);
    expect(rms(run(fx, sine(60)))).toBeLessThan(0.05 * rms(sine(60)));
  });

  it('SWEEP left gates quiet material', () => {
    const fx = new ColorFxCore(SR);
    fx.set('SWEEP', -1, 0.5);
    expect(rms(run(fx, sine(440, 0.05)))).toBeLessThan(0.01);
    const fx2 = new ColorFxCore(SR);
    fx2.set('SWEEP', -1, 0.5);
    expect(rms(run(fx2, sine(440, 0.9)))).toBeGreaterThan(0.5);
  });

  it('NOISE adds noise even to silence', () => {
    const fx = new ColorFxCore(SR);
    fx.set('NOISE', 0.7, 0.5);
    expect(rms(run(fx, new Float32Array(N)))).toBeGreaterThan(0.005);
  });

  it('CRUSH (sample-rate reduction) creates aliases that the input does not contain', () => {
    const goertzel = (a: Float32Array, hz: number) => {
      const k = (2 * Math.cos((2 * Math.PI * hz) / SR));
      let s1 = 0;
      let s2 = 0;
      for (let i = N / 2; i < N; i++) {
        const s0 = a[i]! + k * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / (N / 2);
    };
    const fx = new ColorFxCore(SR);
    fx.set('CRUSH', 0.6, 1); // hold 20 samples → 2.4 kHz effective rate, 1 kHz aliases to 1.4 kHz
    const x = sine(1000);
    expect(goertzel(x, 1400)).toBeLessThan(0.001);
    expect(goertzel(run(fx, x), 1400)).toBeGreaterThan(0.02);
  });
});
