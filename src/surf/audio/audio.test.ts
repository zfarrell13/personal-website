import { describe, expect, it } from 'vitest';
import { barrelDepth, fillImpulse, hootVoices, rumbleParams, sprayParams, tubeCutoffHz } from './synth';

describe('synth helpers', () => {
  it('maps tube depth to 20 kHz → 800 Hz', () => {
    expect(tubeCutoffHz(0)).toBeCloseTo(20000);
    expect(tubeCutoffHz(1)).toBeCloseTo(800);
    expect(tubeCutoffHz(0.5)).toBeLessThan(5000);
  });
  it('barrel depth: at least 0.25 in the tube while live, 0 out of it or once wiped out', () => {
    expect(barrelDepth({ inTube: true, tubeDepth: 0.1, mode: 'riding' })).toBe(0.25);
    expect(barrelDepth({ inTube: true, tubeDepth: 0.8, mode: 'airborne' })).toBe(0.8);
    expect(barrelDepth({ inTube: false, tubeDepth: 0.8, mode: 'riding' })).toBe(0);
    expect(barrelDepth({ inTube: true, tubeDepth: 0.8, mode: 'wipeout' })).toBe(0);
  });
  it('makes the crashing rumble louder and brighter near the impact zone and in a fast section', () => {
    const far = rumbleParams(40, 0);
    const near = rumbleParams(0, 0);
    const fast = rumbleParams(0, 1);
    expect(far.gain).toBeGreaterThan(0);
    expect(near.gain).toBeGreaterThan(far.gain * 3);
    expect(near.cutoff).toBeGreaterThan(far.cutoff);
    expect(fast.gain).toBeGreaterThan(near.gain * 1.5);
    expect(fast.cutoff).toBeGreaterThan(near.cutoff);
    expect(rumbleParams(-5, 3)).toEqual(rumbleParams(0, 1)); // clamped inputs
  });
  it('raises spray pitch and level with speed and carving', () => {
    const slow = sprayParams(3, 0);
    const fast = sprayParams(12, 1);
    expect(fast.freq).toBeGreaterThan(slow.freq);
    expect(fast.gain).toBeGreaterThan(slow.gain);
    expect(sprayParams(100, 5).gain).toBeLessThanOrEqual(0.4);
  });
  it('builds plausible hoot voices', () => {
    const v = hootVoices(7);
    expect(v).toHaveLength(6);
    for (const h of v) {
      expect(h.f0).toBeGreaterThan(150);
      expect(h.f1[1]).toBeGreaterThan(h.f1[0]);
      expect(Math.abs(h.pan)).toBeLessThanOrEqual(0.8);
    }
  });
  it('decays the impulse response by ~60 dB', () => {
    const n = 44100;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    fillImpulse(l, r, 44100, 1);
    const peak = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(l, 0, 1000)).toBeGreaterThan(0.5);
    expect(peak(l, n - 1000, n)).toBeLessThan(0.002);
  });
});
