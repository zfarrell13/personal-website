import { describe, expect, it } from 'vitest';
import type { BeatFxType } from '../../constants';
import { beatFxDelaySec, BeatFxCore } from './BeatFxCore';

const SR = 48000;

function setup(type: BeatFxType, division: number, bpm = 120, depth = 1) {
  const fx = new BeatFxCore(SR);
  fx.setType(type);
  fx.setDivision(division);
  fx.depth = depth;
  fx.clock.update(0, 0, bpm);
  let frame = 0;
  const run = (inL: Float32Array, inR: Float32Array = inL) => {
    const outL = new Float32Array(inL.length);
    const outR = new Float32Array(inL.length);
    for (let o = 0; o < inL.length; o += 128) {
      const n = Math.min(128, inL.length - o);
      fx.process(inL.subarray(o, o + n), inR.subarray(o, o + n), outL.subarray(o, o + n), outR.subarray(o, o + n), n, frame);
      frame += n;
    }
    return { outL, outR };
  };
  return { fx, run };
}
/** Impulse at frame 1000 (after the 5 ms ON fade-in has settled). */
const AT = 1000;
const impulse = (len: number) => {
  const a = new Float32Array(len);
  a[AT] = 1;
  return a;
};
const peaks = (a: Float32Array, threshold: number) => {
  const out: number[] = [];
  for (let i = AT + 1; i < a.length; i++) if (Math.abs(a[i]!) > threshold) out.push(i);
  return out;
};

describe('Beat FX timing', () => {
  it('beatFxDelaySec = division × 60 / BPM', () => {
    expect(beatFxDelaySec(120, 1)).toBe(0.5);
    expect(beatFxDelaySec(128, 0.5)).toBeCloseTo(0.234375, 12);
    expect(beatFxDelaySec(124, 3 / 4)).toBeCloseTo(0.3629, 4);
  });

  it('DELAY repeats once, exactly one division later', () => {
    const { fx, run } = setup('DELAY', 1, 120, 0.8);
    fx.on = true;
    const { outL } = run(impulse(SR * 2));
    expect(peaks(outL, 0.01)).toEqual([AT + 24000]);
  });

  it('ECHO at 1/2 beat and 128 BPM repeats every 11250 frames, decaying', () => {
    const { fx, run } = setup('ECHO', 1 / 2, 128, 0.5);
    fx.on = true;
    const { outL } = run(impulse(40000));
    const p = peaks(outL, 0.01);
    expect(p.slice(0, 3)).toEqual([AT + 11250, AT + 22500, AT + 33750]);
    expect(Math.abs(outL[AT + 22500]!)).toBeLessThan(Math.abs(outL[AT + 11250]!));
  });

  it('follows the master BPM', () => {
    const { fx, run } = setup('DELAY', 1, 100, 1);
    fx.on = true;
    expect(peaks(run(impulse(40000)).outL, 0.01)).toEqual([AT + 28800]);
  });

  it('ECHO keeps a decaying tail on the grid after OFF, and stops echoing new input', () => {
    const { fx, run } = setup('ECHO', 1 / 4, 120, 0.5);
    fx.on = true;
    run(impulse(AT + 256));
    fx.on = false;
    const T = 6000;
    const fb = 0.3 + 0.55 * 0.5;
    const tail = new Float32Array(T * 6 + 10);
    tail[T * 2 + 5] = 1; // new input while OFF must not be echoed
    const { outL } = run(tail);
    const at = (k: number) => outL[T * k - 256]!; // frame AT + kT lies (kT - 256) into the post-OFF run
    const a1 = Math.abs(at(1));
    expect(a1).toBeGreaterThan(0.45);
    for (let k = 2; k <= 4; k++) expect(Math.abs(at(k)) / Math.abs(at(k - 1))).toBeCloseTo(fb, 3);
    // the OFF-time input passes through dry only: nothing at +T after it
    expect(Math.abs(outL[T * 2 + 5 + T]!)).toBeLessThan(0.01);
  });

  it('switching type clears the old effect tail (no stale burst)', () => {
    const { fx, run } = setup('ECHO', 1 / 4, 120, 1);
    fx.on = true;
    run(impulse(AT + 256));
    fx.setType('DELAY');
    fx.on = true;
    const { outL } = run(new Float32Array(20000));
    expect(Math.max(...outL.map(Math.abs))).toBe(0);
  });

  it('depth changes are smoothed (no zipper step)', () => {
    const { fx, run } = setup('DELAY', 1 / 4, 120, 0.2);
    fx.on = true;
    const warm = run(new Float32Array(12000).fill(1)); // fill the delay line
    fx.depth = 1;
    const { outL } = run(new Float32Array(4000).fill(1));
    let maxStep = Math.abs(outL[0]! - warm.outL[11999]!);
    for (let i = 1; i < outL.length; i++) maxStep = Math.max(maxStep, Math.abs(outL[i]! - outL[i - 1]!));
    expect(outL[3999]!).toBeCloseTo(2, 1); // it does get there
    expect(maxStep).toBeLessThan(0.01);
  });

  it.each(['DELAY', 'ECHO', 'SPIRAL', 'TRANS', 'FILTER', 'FLANGER', 'PHASER', 'PITCH', 'ROLL', 'SLIP_ROLL', 'VINYL_BRAKE', 'HELIX'] as const)(
    '%s keeps the channels independent (silent right stays silent)',
    (type) => {
      const { fx, run } = setup(type, 1 / 2, 120, 0.7);
      const l = new Float32Array(SR).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 300 * i) / SR));
      run(l.subarray(0, 12000), new Float32Array(12000));
      fx.on = true;
      const { outR } = run(l, new Float32Array(SR));
      expect(Math.max(...outR.map(Math.abs))).toBe(0);
    },
  );

  it('PING PONG alternates left then right', () => {
    const { fx, run } = setup('PING_PONG', 1 / 4, 120, 0.5);
    fx.on = true;
    const { outL, outR } = run(impulse(AT + 15000));
    expect(Math.abs(outL[AT + 6000]!)).toBeGreaterThan(0.1);
    expect(Math.abs(outR[AT + 6000]!)).toBe(0);
    expect(Math.abs(outR[AT + 12000]!)).toBeGreaterThan(0.01);
    expect(Math.abs(outL[AT + 12000]!)).toBe(0);
  });

  it('is transparent when off with no tail', () => {
    const { run } = setup('DELAY', 1, 120, 1);
    const x = new Float32Array(1000).map((_, i) => Math.sin(i / 10));
    expect(run(x).outL).toEqual(x);
  });
});

describe('Beat FX types', () => {
  it('TRANS chops each division: open first half, cut second half', () => {
    const { fx, run } = setup('TRANS', 1 / 4, 120, 1);
    fx.on = true;
    const { outL } = run(new Float32Array(12000).fill(1));
    expect(outL[6000 + 1500]).toBeGreaterThan(0.95);
    expect(outL[6000 + 4500]).toBeLessThan(0.05);
  });

  it('ROLL repeats from the previous grid point', () => {
    const { fx, run } = setup('ROLL', 1 / 4, 120, 1);
    const ramp = (from: number, len: number) => new Float32Array(len).map((_, i) => (from + i) / 1e5);
    run(ramp(0, 9000)); // beat 0.375 — the previous 1/4-beat grid point is frame 6000
    fx.on = true;
    const { outL } = run(ramp(9000, 12000));
    // after the live pass reaches frame 12000, it wraps back to frame 6000
    expect(outL[3000 + 10]! * 1e5).toBeCloseTo(6010, 1);
    expect(outL[3000 + 6000 + 10]! * 1e5).toBeCloseTo(6010, 1);
  });

  it('VINYL BRAKE slows to silence within the division', () => {
    const { fx, run } = setup('VINYL_BRAKE', 1, 120, 1);
    const tone = new Float32Array(SR).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));
    run(tone);
    fx.on = true;
    const { outL } = run(tone);
    const tail = outL.subarray(26000);
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(1e-3);
  });

  it('PITCH at full depth shifts a tone up an octave', () => {
    const { fx, run } = setup('PITCH', 1, 120, 1);
    fx.on = true;
    const tone = new Float32Array(SR).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / SR));
    const { outL } = run(tone);
    const mag = (hz: number) => {
      let re = 0;
      let im = 0;
      for (let i = SR / 2; i < SR; i++) {
        re += outL[i]! * Math.cos((2 * Math.PI * hz * i) / SR);
        im += outL[i]! * Math.sin((2 * Math.PI * hz * i) / SR);
      }
      return Math.hypot(re, im);
    };
    expect(mag(880)).toBeGreaterThan(3 * mag(440));
  });

  it.each(['REVERB', 'SPIRAL', 'FILTER', 'FLANGER', 'PHASER', 'SLIP_ROLL', 'HELIX'] as const)('%s changes the signal when on and stays finite', (type) => {
    const { fx, run } = setup(type, 1 / 2, 124, 0.8);
    const tone = new Float32Array(SR).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 330 * i) / SR) + (i % 6000 === 0 ? 0.5 : 0));
    run(tone.subarray(0, SR / 4));
    fx.on = true;
    const { outL } = run(tone);
    let diff = 0;
    for (let i = 0; i < SR; i++) {
      expect(Number.isFinite(outL[i]!)).toBe(true);
      diff += Math.abs(outL[i]! - tone[i]!);
    }
    expect(diff / SR).toBeGreaterThan(0.01);
  });
});
