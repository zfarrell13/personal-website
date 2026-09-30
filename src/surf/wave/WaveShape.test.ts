import { describe, expect, it, vi } from 'vitest';
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

  it('ahead of the curl the lip recedes up and out: it never folds back against the face (open eye)', () => {
    const w = shape();
    const tip = new Vector3();
    const face = new Vector3();
    const tipAtCurl = w.profile(0, 1).y;
    let lastY = -Infinity;
    for (let x = 0; x <= 8; x += 0.25) {
      w.profile(x, 1, tip);
      let lo = 0;
      let hi = w.crestT(x);
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (w.profile(x, mid, face).y < tip.y) lo = mid;
        else hi = mid;
      }
      w.profile(x, lo, face);
      // Either thrown well clear of the face, or only a short feathering rim up at the crest — never a sheet hanging down the face.
      expect(tip.z - face.z > 0.4 || tip.y > 0.85 * w.crestY(x), `x ${x}`).toBe(true);
      // Never below the tip at the curl; rising through the throw (the first ~1.5 m), then it rides with the crest.
      expect(tip.y, `x ${x}`).toBeGreaterThanOrEqual(tipAtCurl);
      if (x <= 1.5) expect(tip.y, `x ${x}`).toBeGreaterThanOrEqual(lastY - 1e-9);
      lastY = tip.y;
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
    expect(w.hollowness(SURF_CONFIG.wave.hollowLength)).toBe(0);
    expect(w.hollowness(6)).toBeCloseTo(0.5, 9);
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

/**
 * Reference surface (hot-path refactors must not move it). Captured from the closure-based implementation (task 17);
 * re-captured in surf-rework task 5a (and its fix round 1) for the intentional lip changes: open barrel eye (higher BARREL_OPEN tip,
 * a lip that throws out only right at the curl, a crest-hung feathering lip ahead of it) and the closed barrel's lip landing further out.
 */
const GOLDEN_PROFILE: ReadonlyArray<readonly [number, number, number, number]> = [
  [-12, 0, 0, 7.2],
  [-12, 0.13, 0.177356928522, 5.43491304],
  [-12, 0.5, 0.907808237826, 2.145],
  [-12, 0.77, 1.052246746329, 0.280548],
  [-12, 1, 0.397943337129, -1.92],
  [-5, 0, 0, 7.2],
  [-5, 0.13, 0.09131304, 4.08873912],
  [-5, 0.5, 2.0775, 0.6525],
  [-5, 0.77, 2.61323286, 2.6211012],
  [-5, 1, 0.12, 6.24],
  [-2.5, 0, 0, 7.2],
  [-2.5, 0.13, 0.09131304, 4.08873912],
  [-2.5, 0.5, 2.0775, 0.63],
  [-2.5, 0.77, 2.685171714, 2.21174961],
  [-2.5, 1, 1.116, 4.98],
  [0, 0, 0, 7.2],
  [0, 0.13, 0.09131304, 4.08873912],
  [0, 0.5, 2.0775, 0.6075],
  [0, 0.77, 2.757110568, 1.80239802],
  [0, 1, 2.112, 3.72],
  [3, 0, 0, 7.2],
  [3, 0.13, 0.09167106037, 4.106004319467],
  [3, 0.5, 2.072722222222, 0.618775555556],
  [3, 0.77, 2.756359724167, 1.68541525659],
  [3, 1, 2.228238339278, 3.190752356043],
  [20, 0, 0, 7.2],
  [20, 0.13, 0.103031191638, 4.653836087901],
  [20, 0.5, 1.921121399177, 0.976553497942],
  [20, 0.77, 2.62298756321, 0.605610651259],
  [20, 1, 2.46587654321, 0.857382716049],
  [60, 0, 0, 7.2],
  [60, 0.13, 0.1008380464, 5.44385652],
  [60, 0.5, 1.437666666667, 1.4925],
  [60, 0.77, 1.938859154667, -1.08681114],
  [60, 1, 0.810666666667, -4.32],
];
const GOLDEN_CREST: ReadonlyArray<readonly [number, number, number]> = [
  [-12, 0.699021374653, 1.096941015239],
  [-5, 0.699021374653, 2.769396933091],
  [-2.5, 0.710016472099, 2.760535039895],
  [0, 0.739589137786, 2.769364665194],
  [3, 0.741814005793, 2.766577519184],
  [20, 0.749357748174, 2.627694109561],
  [60, 0.707622640668, 2.027837960246],
];

describe('WaveShape hot paths', () => {
  it('profile, crestT and crestY match the reference surface', () => {
    const w = shape();
    w.params.hollowLength = 45; // the reference was captured when hollowness faded over Ls = 45 m
    const p = new Vector3();
    for (const [x, t, y, z] of GOLDEN_PROFILE) {
      w.profile(x, t, p);
      expect(p.x).toBe(x);
      expect(p.y).toBeCloseTo(y, 9);
      expect(p.z).toBeCloseTo(z, 9);
    }
    for (const [x, tc, cy] of GOLDEN_CREST) {
      expect(w.crestT(x)).toBeCloseTo(tc, 9);
      expect(w.crestY(x)).toBeCloseTo(cy, 9);
    }
  });

  it('memoizes crestT per column: repeat queries and crestY do no profile sweeps', () => {
    const w = shape();
    w.crestT(3);
    const spy = vi.spyOn(w, 'profile');
    w.crestT(3);
    w.crestY(3);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('caches follow live parameter edits without a config bump', () => {
    const w = shape();
    const p = new Vector3();
    const xs = [-2.5, 3];
    xs.forEach((x) => {
      w.crestT(x);
      w.profile(x, 0.9, p);
    });
    w.params.tubeDepth = 7;
    w.params.shoulderLength = 30;
    w.params.hollowLength = 20;
    w.params.height = 3;
    const fresh = new WaveShape({ ...w.params });
    for (const x of xs) {
      expect(w.crestT(x)).toBe(fresh.crestT(x));
      expect(w.crestY(x)).toBe(fresh.crestY(x));
      expect(w.profile(x, 0.9, p).equals(fresh.profile(x, 0.9))).toBe(true);
    }
    w.params.collapseLength = 8;
    const fresh2 = new WaveShape({ ...w.params });
    expect(w.crestT(-8)).toBe(fresh2.crestT(-8));
    expect(w.profile(-8, 0.5, p).equals(fresh2.profile(-8, 0.5))).toBe(true);
  });
});
