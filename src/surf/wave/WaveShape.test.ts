import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { WaveShape } from './WaveShape';

const shape = () => new WaveShape(structuredClone(SURF_CONFIG.wave));
const H = SURF_CONFIG.wave.height;
const D = SURF_CONFIG.wave.tubeDepth;

describe('WaveShape.profile', () => {
  it('starts in the flat trough and reaches about H at the crest on the shoulder', () => {
    const w = shape();
    const p = w.profile(20, 0);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(3 * H, 6);
    expect(w.crestY(20)).toBeGreaterThan(0.9 * H);
    expect(w.crestY(20)).toBeLessThan(1.2 * H);
  });

  it('is continuous in x (no jumps across zone boundaries)', () => {
    const w = shape();
    const a = new Vector3();
    const b = new Vector3();
    for (let x = -29; x < 89; x += 0.37) {
      for (let t = 0; t <= 1; t += 0.05) {
        w.profile(x, t, a);
        w.profile(x + 0.001, t, b);
        expect(a.distanceTo(b)).toBeLessThan(0.02);
      }
    }
  });

  it('is continuous in t (including across Catmull-Rom segment joins)', () => {
    const w = shape();
    const a = new Vector3();
    const b = new Vector3();
    for (const x of [-20, -D, -2.5, 0, 10, 45, 80]) {
      for (let t = 0; t < 1; t += 0.001) {
        w.profile(x, t, a);
        w.profile(x, t + 0.0001, b);
        expect(a.distanceTo(b)).toBeLessThan(0.01);
      }
    }
  });

  it('has the crest as the max-y point for every x >= 0', () => {
    const w = shape();
    const p = new Vector3();
    for (let x = 0; x <= 90; x += 1.5) {
      const top = w.crestY(x);
      for (let i = 0; i <= 400; i++) {
        expect(w.profile(x, i / 400, p).y).toBeLessThanOrEqual(top + 1e-6);
      }
    }
  });

  it('tapers the swell to 40% height at 90 m', () => {
    const w = shape();
    expect(w.crestY(90) / w.crestY(40)).toBeCloseTo(0.4, 1);
  });

  it('overhangs in the tube: the lip tip is shoreward of the face at the same height', () => {
    const w = shape();
    const tip = new Vector3();
    const face = new Vector3();
    for (const x of [0, -1, -2.5, -4, -D]) {
      w.profile(x, 1, tip);
      const tc = w.crestT(x);
      // find the face point (t < crestT) at the lip tip's height
      let lo = 0;
      let hi = tc;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (w.profile(x, mid, face).y < tip.y) lo = mid;
        else hi = mid;
      }
      w.profile(x, lo, face);
      expect(tip.z).toBeGreaterThan(face.z + 1);
    }
  });

  it('lands the lip in the trough at x = -D', () => {
    const w = shape();
    expect(w.profile(-D, 1).y).toBeLessThan(0.1 * H);
    expect(w.profile(0, 1).y).toBeGreaterThan(0.6 * H);
  });

  it('reports zones and hollowness', () => {
    const w = shape();
    expect(w.zone(-6)).toBe('broken');
    expect(w.zone(-2)).toBe('tube');
    expect(w.zone(10)).toBe('shoulder');
    expect(w.zone(60)).toBe('swell');
    expect(w.hollowness(0)).toBe(1);
    expect(w.hollowness(45)).toBe(0);
  });
});

describe('WaveShape queries', () => {
  it('closestParam round-trips surfacePoint to within 1 mm', () => {
    const w = shape();
    const p = new Vector3();
    let worst = 0;
    for (let x = -25; x <= 85; x += 2.7) {
      for (let t = 0.03; t <= 0.97; t += 0.047) {
        w.surfacePoint(x, t, p);
        const q = w.closestParam(p, { x: x + 0.2, t: t + 0.01 });
        const back = w.surfacePoint(q.x, q.t);
        worst = Math.max(worst, back.distanceTo(p));
      }
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('points the face normal toward shore and up, and the lip underside into the tube', () => {
    const w = shape();
    const n = w.normal(20, 0.35);
    expect(n.y).toBeGreaterThan(0);
    expect(n.z).toBeGreaterThan(0);
    const under = w.normal(-2, 0.93);
    expect(under.y).toBeLessThan(0);
    expect(w.steepness(-2, 0.93)).toBe(1);
  });

  it('is steeper in the pocket than on the shoulder', () => {
    const w = shape();
    expect(w.steepness(2, 0.4)).toBeGreaterThan(w.steepness(40, 0.4));
  });
});
