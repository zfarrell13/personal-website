import { describe, expect, it, vi } from 'vitest';
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

const tone = (len: number, hz: number, amp = 0.5) => new Float32Array(len).map((_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const maxStep = (a: Float32Array, from: number, to: number) => {
  let m = 0;
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(a[i]! - a[i - 1]!));
  return m;
};
const dftMag = (a: Float32Array, hz: number) => {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    re += a[i]! * Math.cos((2 * Math.PI * hz * i) / SR);
    im += a[i]! * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return Math.hypot(re, im);
};

describe('Beat FX fix round 1', () => {
  it('ROLL held ON for 20 s still loops the anchored slice (no ring overwrite)', () => {
    const { fx, run } = setup('ROLL', 1, 120, 1);
    const ramp = new Float32Array(1_100_000).map((_, i) => i / 2e6);
    run(ramp.subarray(0, 96000)); // anchor = frame 96000 (a beat boundary)
    fx.on = true;
    const { outL } = run(ramp.subarray(96000));
    for (const k of [1, 10, 30, 40]) {
      const f = 96000 + 24000 * k + 100;
      expect(outL[f - 96000]! * 2e6).toBeCloseTo(96100, 0);
    }
  });

  it('HELIX held ON for 20 s still loops its slice', () => {
    const { fx, run } = setup('HELIX', 1, 120, 0.5);
    const ramp = new Float32Array(1_100_000).map((_, i) => i / 2e6);
    run(ramp.subarray(0, 96000));
    fx.on = true;
    const { outL } = run(ramp.subarray(96000));
    // last-beat slice = frames 72000..96000 at ratio 1 (wet 0.7, dry 0.3); 100 frames into a late pass
    const j = 24000 * 40 + 100;
    expect(outL[j]! * 2e6).toBeCloseTo(0.3 * (96000 + j) + 0.7 * 72101, 0);
  });

  it.each(['FLANGER', 'PHASER'] as const)('%s LFO is locked to the beat grid, not the frame counter', (type) => {
    const input = new Float32Array(20000).map((_, i) => Math.sin(i * 0.37) * Math.cos(i * 0.011) + Math.sin(i * 1.3));
    const a = setup(type, 1 / 2, 120, 1);
    a.fx.on = true;
    a.fx.clock.update(0, 0, 120);
    const oa = a.run(input).outL;
    // same music, but beat 0 sits at frame 5000 (everything shifted): identical output when processed at frame 5000+
    const b = setup(type, 1 / 2, 120, 1);
    b.fx.on = true;
    b.fx.clock.update(5000, 0, 120);
    const ob = new Float32Array(20000);
    const zero = new Float32Array(20000);
    for (let o = 0; o < 20000; o += 128) {
      const n = Math.min(128, 20000 - o);
      b.fx.process(input.subarray(o, o + n), input.subarray(o, o + n), ob.subarray(o, o + n), zero.subarray(o, o + n), n, 5000 + o);
    }
    expect(Math.max(...oa.map((v, i) => Math.abs(v - ob[i]!)))).toBeLessThan(1e-6);
  });

  it.each(['FLANGER', 'PHASER'] as const)('%s has no LFO jump when the BPM changes slightly (10 min in)', (type) => {
    const F0 = 48000 * 600;
    const input = new Float32Array(30000).map((_, i) => Math.sin(i * 0.05) + Math.sin(i * 0.11));
    const runFrom = (bumpAt: number | null) => {
      const fx = new BeatFxCore(SR);
      fx.setType(type);
      fx.setDivision(1);
      fx.depth = 1;
      fx.clock.update(F0, 1200, 120); // beat 1200 at 10 min @120 BPM
      fx.on = true;
      const out = new Float32Array(input.length);
      const outR = new Float32Array(input.length);
      for (let o = 0; o < input.length; o += 128) {
        const n = Math.min(128, input.length - o);
        const fr = F0 + o;
        if (bumpAt !== null && o === bumpAt) fx.clock.update(fr, fx.clock.beatAt(fr), 120 * 1.0001);
        fx.process(input.subarray(o, o + n), input, out.subarray(o, o + n), outR.subarray(o, o + n), n, fr);
      }
      return out;
    };
    const base = runFrom(null);
    const bumped = runFrom(15360); // multiple of 128
    let worst = 0;
    for (let i = 15000; i < 30000; i++) worst = Math.max(worst, Math.abs(base[i]! - bumped[i]!));
    expect(worst).toBeLessThan(0.02); // a ~0.75 ms delay jump would be several tenths
  });

  it('ROLL/HELIX loop seams are cross-faded (no click at the wrap)', () => {
    for (const type of ['ROLL', 'HELIX'] as const) {
      const { fx, run } = setup(type, 1 / 4, 120, type === 'ROLL' ? 1 : 0.5);
      const t = tone(60000, 333);
      run(t.subarray(0, 9000));
      fx.on = true;
      const { outL } = run(t.subarray(9000));
      // pass 3+ (well past the fade-in): a 333 Hz tone at 0.5 has a max natural step of ~0.022
      expect(maxStep(outL, 14000, 40000)).toBeLessThan(0.08);
    }
  });

  it('ROLL division change to a shorter length keeps the anchor; SLIP ROLL re-anchors to the grid', () => {
    const ramp = (from: number, len: number) => new Float32Array(len).map((_, i) => (from + i) / 1e5);
    // ROLL: 1/2 beat engaged at frame 15000 (anchor 12000), then 1/4 at frame 27000 -> loop [12000,18000)
    const r = setup('ROLL', 1 / 2, 120, 1);
    r.run(ramp(0, 15000));
    r.fx.on = true;
    r.run(ramp(15000, 12000));
    r.fx.setDivision(1 / 4);
    const ro = r.run(ramp(27000, 6000)).outL;
    expect(ro[3500]! * 1e5).toBeCloseTo(12500, 0); // frame 30500, 3000 into a 6000 loop from the old anchor
    // SLIP ROLL: 1/4 at 15000 then 1/2 at frame 15000 -> re-anchored at grid point 12000
    const s = setup('SLIP_ROLL', 1 / 4, 120, 1);
    s.run(ramp(0, 9000));
    s.fx.on = true;
    s.run(ramp(9000, 6000));
    s.fx.setDivision(1 / 2);
    const so = s.run(ramp(15000, 10000)).outL;
    expect(so[24500 - 15000]! * 1e5).toBeCloseTo(12500, 0);
  });

  it('SLIP ROLL re-anchor is de-clicked', () => {
    const ramp = (from: number, len: number) => new Float32Array(len).map((_, i) => (from + i) / 1e5);
    const { fx, run } = setup('SLIP_ROLL', 1 / 4, 120, 1);
    run(ramp(0, 9000));
    fx.on = true;
    const before = run(ramp(9000, 6144)).outL; // frames 9000..15144, looping the 6000..12000 slice
    fx.setDivision(1 / 2);
    const after = run(ramp(15144, 2000)).outL;
    // the re-anchor would step the output by ~0.06 (a ramp of 1e-5/frame); the click remover spreads it over 3 ms
    const joined = new Float32Array(2200);
    joined.set(before.subarray(before.length - 200));
    joined.set(after, 200);
    expect(maxStep(joined, 0, joined.length)).toBeLessThan(0.002);
  });

  it('PITCH at ratio 1 settles to a single clean tap after a depth excursion', () => {
    const { fx, run } = setup('PITCH', 1, 120, 0.7);
    fx.on = true;
    const t = tone(SR * 2, 440);
    const a = run(t.subarray(0, SR / 2)).outL;
    fx.depth = 0.5;
    const b = run(t.subarray(SR / 2)).outL;
    const lag = 1441; // 60 ms window * 0.5 + 1
    let err = 0;
    for (let i = SR; i < b.length; i++) err = Math.max(err, Math.abs(b[i]! - t[SR / 2 + i - lag]!));
    expect(a.length).toBe(SR / 2);
    expect(err).toBeLessThan(0.01);
  });

  it('ECHO and SPIRAL feedback is soft-clipped (no runaway build-up on steady input)', () => {
    for (const type of ['ECHO', 'SPIRAL'] as const) {
      const { fx, run } = setup(type, 1 / 4, 120, 1);
      fx.on = true;
      const { outL } = run(new Float32Array(SR * 3).fill(1));
      let peak = 0;
      for (let i = 0; i < outL.length; i++) peak = Math.max(peak, outL[i]!);
      expect(peak).toBeLessThan(3.1); // unclipped: 7.7 (ECHO) / 20 (SPIRAL)
    }
  });

  it('setType does not bulk-clear the multi-MB delay buffers on the audio thread', () => {
    const { fx } = setup('ECHO', 1, 120, 1);
    const spy = vi.spyOn(Float32Array.prototype, 'fill');
    fx.setType('REVERB');
    fx.setType('PING_PONG');
    const big = spy.mock.contexts.filter((c) => (c as Float32Array).length > 20000).length;
    spy.mockRestore();
    expect(big).toBe(0);
  });

  it('setType while ON fades out and back in instead of cutting in', () => {
    const { fx, run } = setup('TRANS', 1 / 4, 120, 1);
    fx.on = true;
    const dc = (n: number) => new Float32Array(n).fill(1);
    const a = run(dc(4000)).outL; // second half of the division: gated to ~0
    expect(a[3999]!).toBeLessThan(0.05);
    fx.setType('DELAY');
    const b = run(dc(4000)).outL;
    expect(Math.max(maxStep(b, 0, 4000), Math.abs(b[0]! - a[3999]!))).toBeLessThan(0.02);
    expect(fx.type).toBe('DELAY');
    expect(b[3999]!).toBeGreaterThan(0.95);
  });

  it('HELIX pitch ratio follows depth (0.5x / 1x / 2x)', () => {
    const measure = (depth: number) => {
      const { fx, run } = setup('HELIX', 1, 120, depth);
      const t = tone(SR + 12000, 200, 0.5);
      run(t.subarray(0, SR));
      fx.on = true;
      const o = run(t.subarray(SR)).outL.subarray(1000, 9000);
      return { m100: dftMag(o, 100), m200: dftMag(o, 200), m400: dftMag(o, 400) };
    };
    const up = measure(1);
    expect(up.m400).toBeGreaterThan(1.5 * up.m200);
    const down = measure(0);
    expect(down.m100).toBeGreaterThan(1.5 * down.m200);
    const same = measure(0.5);
    expect(same.m200).toBeGreaterThan(3 * same.m400);
    expect(same.m200).toBeGreaterThan(3 * same.m100);
  });

  it('SPIRAL glides its delay time over ~250 ms when the division changes', () => {
    const { fx, run } = setup('SPIRAL', 1, 120, 1);
    fx.on = true;
    run(new Float32Array(6000)); // delay time settles at 24000
    fx.setDivision(1 / 8); // target 3000 frames
    const x = new Float32Array(20000);
    x[0] = 1;
    const { outL } = run(x);
    let first = -1;
    for (let i = 200; i < outL.length; i++) {
      if (Math.abs(outL[i]!) > 0.05) {
        first = i;
        break;
      }
    }
    // an instant jump would echo at 3000; the 250 ms one-pole glide echoes near 11.2k
    expect(first).toBeGreaterThan(10000);
    expect(first).toBeLessThan(12500);
  });

  it('division 16 @ 60 BPM repeats after exactly 16 s (768000 frames)', () => {
    const { fx, run } = setup('DELAY', 16, 60, 1);
    fx.on = true;
    const { outL } = run(impulse(AT + 768000 + 10));
    expect(peaks(outL, 0.01)).toEqual([AT + 768000]);
  });

  it('division 1/8 @ 200 BPM repeats after exactly 1800 frames', () => {
    const { fx, run } = setup('DELAY', 1 / 8, 200, 1);
    fx.on = true;
    expect(peaks(run(impulse(6000)).outL, 0.01)).toEqual([AT + 1800]);
  });
});
