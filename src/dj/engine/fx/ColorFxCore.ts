import type { ColorFxType } from '../../constants';
import { Biquad } from '../dsp/biquad';

/** Colour FX handled in the per-channel worklet. SPACE, DUB ECHO and FILTER are native nodes (see graph/ColorFx.ts). */
export const WORKLET_COLOR_FX: readonly ColorFxType[] = ['SWEEP', 'NOISE', 'CRUSH'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * SWEEP (right = band-pass sweep, left = gate), NOISE (filtered white noise:
 * left = LPF, right = HPF) and CRUSH (bit + sample-rate reduction, left = LPF
 * after, right = HPF after). Knob −1..1 with 0 = bypass (bit-exact); PARAMETER 0..1.
 */
export class ColorFxCore {
  type: ColorFxType = 'FILTER';
  knob = 0;
  param = 0.5;

  private readonly bpL = new Biquad();
  private readonly bpR = new Biquad();
  private readonly nf = new Biquad();
  private readonly postL = new Biquad();
  private readonly postR = new Biquad();
  private env = 0;
  private gateGain = 1;
  private holdL = 0;
  private holdR = 0;
  private holdCount = 0;
  private seed = 22222;
  private lastType: ColorFxType | null = null;
  private lastKnob = NaN;
  private lastParam = NaN;

  constructor(readonly sampleRate: number) {}

  set(type: ColorFxType, knob: number, param: number): void {
    this.type = type;
    this.knob = clamp(knob, -1, 1);
    this.param = clamp(param, 0, 1);
  }

  private noise(): number {
    // xorshift32, allocation-free
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed / 4294967296) * 2 - 1;
  }

  private updateCoefs(): void {
    if (this.type === this.lastType && this.knob === this.lastKnob && this.param === this.lastParam) return;
    this.lastType = this.type;
    this.lastKnob = this.knob;
    this.lastParam = this.param;
    const a = Math.abs(this.knob);
    const sr = this.sampleRate;
    if (this.type === 'SWEEP' && this.knob > 0) {
      const f = 200 * 2 ** (a * 5.6);
      this.bpL.design('bandpass', f, sr, 0.7 + this.param * 6);
      this.bpR.design('bandpass', f, sr, 0.7 + this.param * 6);
    } else if (this.type === 'NOISE') {
      const f = this.knob < 0 ? 12000 * 2 ** (-a * 6) : 150 * 2 ** (a * 6);
      this.nf.design(this.knob < 0 ? 'lowpass' : 'highpass', f, sr, 0.9);
    } else if (this.type === 'CRUSH') {
      const f = this.knob < 0 ? 16000 * 2 ** (-a * 5) : 60 * 2 ** (a * 5);
      const kind = this.knob < 0 ? 'lowpass' : 'highpass';
      this.postL.design(kind, f, sr, 0.8);
      this.postR.design(kind, f, sr, 0.8);
    }
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const a = Math.abs(this.knob);
    if (a < 0.02 || (this.type !== 'SWEEP' && this.type !== 'NOISE' && this.type !== 'CRUSH')) {
      if (outL !== inL) outL.set(inL.subarray(0, n));
      if (outR !== inR) outR.set(inR.subarray(0, n));
      return;
    }
    this.updateCoefs();
    const sr = this.sampleRate;
    switch (this.type) {
      case 'SWEEP': {
        if (this.knob > 0) {
          for (let i = 0; i < n; i++) {
            const l = inL[i]!;
            const r = inR[i]!;
            outL[i] = l * (1 - a) + this.bpL.process(l) * a * 1.4;
            outR[i] = r * (1 - a) + this.bpR.process(r) * a * 1.4;
          }
        } else {
          // gate: duck everything below a threshold that rises with the knob
          const threshold = 0.02 + a * 0.4;
          const envA = 1 - Math.exp(-1 / (0.002 * sr));
          const envR = 1 - Math.exp(-1 / (0.05 * sr));
          const gA = 1 - Math.exp(-1 / (0.001 * sr));
          const gR = 1 - Math.exp(-1 / ((0.005 + (1 - this.param) * 0.1) * sr));
          for (let i = 0; i < n; i++) {
            const l = inL[i]!;
            const r = inR[i]!;
            const lvl = Math.max(Math.abs(l), Math.abs(r));
            this.env += (lvl - this.env) * (lvl > this.env ? envA : envR);
            const target = this.env > threshold ? 1 : 0;
            this.gateGain += (target - this.gateGain) * (target > this.gateGain ? gA : gR);
            outL[i] = l * this.gateGain;
            outR[i] = r * this.gateGain;
          }
        }
        break;
      }
      case 'NOISE': {
        const level = a * (0.1 + 0.3 * this.param);
        for (let i = 0; i < n; i++) {
          const z = this.nf.process(this.noise()) * level;
          outL[i] = inL[i]! + z;
          outR[i] = inR[i]! + z;
        }
        break;
      }
      case 'CRUSH': {
        const bits = 16 - a * 13 * (0.5 + 0.5 * this.param); // → 3.5 bits at full
        const steps = 2 ** bits / 2;
        const hold = Math.max(1, Math.round(1 + a * 31 * (0.5 + 0.5 * this.param)));
        for (let i = 0; i < n; i++) {
          if (this.holdCount <= 0) {
            this.holdL = Math.round(inL[i]! * steps) / steps;
            this.holdR = Math.round(inR[i]! * steps) / steps;
            this.holdCount = hold;
          }
          this.holdCount--;
          outL[i] = this.postL.process(this.holdL);
          outR[i] = this.postR.process(this.holdR);
        }
        break;
      }
    }
  }
}
