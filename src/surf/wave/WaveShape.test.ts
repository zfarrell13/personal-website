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

/**
 * Face angle (deg from flat) at height fraction h of the crest at column x: on the face (below the crest), at the
 * point y = h · crest height.
 */
function faceAngle(w: WaveShape, x: number, h: number): number {
  let lo = 0;
  let hi = w.crestT(x);
  const target = h * w.crestY(x);
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (w.profile(x, mid).y < target) lo = mid;
    else hi = mid;
  }
  return Math.asin(Math.min(1, w.steepness(x, lo))) / (Math.PI / 180);
}

describe('WaveShape: a concave face (playtest 7: "like a half pipe", not a flat 45° ramp)', () => {
  const POCKET = [-2, 2]; // the barrel and the pocket: the lip pitches over a vertical wall
  const OPEN = [8, 20, 35]; // the open face down the line
  const x60 = 60;
  const HS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

  it.each([...POCKET, ...OPEN, 60])('x = %d: gentle at the bottom (< 25° up to a quarter of the height)', (x) => {
    const w = shape();
    for (const h of [0.05, 0.1, 0.15, 0.2, 0.25]) expect(faceAngle(w, x, h), `h ${h}`).toBeLessThan(25);
  });

  it.each([...POCKET, ...OPEN])('x = %d: ≈ 40–50° at half height', (x) => {
    const w = shape();
    expect(faceAngle(w, x, 0.5)).toBeGreaterThanOrEqual(40);
    expect(faceAngle(w, x, 0.5)).toBeLessThanOrEqual(50);
  });

  it.each(POCKET)('x = %d (pocket): ≥ 70° from three quarters of the height, near vertical (≥ 80°) just under the lip', (x) => {
    const w = shape();
    for (const h of [0.75, 0.8, 0.85, 0.9]) expect(faceAngle(w, x, h), `h ${h}`).toBeGreaterThanOrEqual(70);
    expect(faceAngle(w, x, 0.88)).toBeGreaterThanOrEqual(80);
  });

  it.each(OPEN)('x = %d (open face): ≥ 65° at three quarters of the height and above, rideable to the crest (never past ≈ 78°)', (x) => {
    const w = shape();
    for (const h of [0.75, 0.8, 0.85]) expect(faceAngle(w, x, h), `h ${h}`).toBeGreaterThanOrEqual(65);
    if (x >= 12) {
      // The Surfer's face end is n.y < 0.2 (≈ 78.5°): the open face's lip is its crest. (x = 8 still feels the pitching lip.)
      const tc = w.crestT(x);
      for (let t = 0; t < tc; t += 0.002) expect(w.normal(x, t).y, `t ${t}`).toBeGreaterThanOrEqual(0.2);
    }
  });

  // Every 5% of the height: steeper and steeper (the open face is steepest at ≈ 0.82, then rounds over the crest; the pocket
  // wall is vertical from ≈ 0.85 up to the lip).
  it.each([...POCKET, ...OPEN])('x = %d: the face steepens all the way up (concave) to 0.8 of the height', (x) => {
    const w = shape();
    let prev = 0;
    for (const h of [...HS, ...(POCKET.includes(x) ? [0.85] : [])]) {
      const a = faceAngle(w, x, h);
      expect(a, `h ${h}`).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it('x = 60 (the shoulder easing out): still concave, gentler', () => {
    const w = shape();
    let prev = 0;
    for (const h of [0.1, 0.25, 0.5, 0.75, 0.85]) {
      const a = faceAngle(w, x60, h);
      expect(a, `h ${h}`).toBeGreaterThan(prev + 5);
      prev = a;
    }
  });

  it('eases into a gentle swell where the shoulder fades out', () => {
    const w = shape();
    // Steepest at three quarters of the height: tapering down the shoulder past shoulderLength.
    const at = (x: number) => faceAngle(w, x, 0.75);
    expect(at(60)).toBeLessThan(at(35) - 10);
    expect(at(75)).toBeLessThan(at(60) - 10);
    for (const h of HS) expect(faceAngle(w, 85, h), `h ${h}`).toBeLessThan(25);
    expect(w.rollerBlend(SURF_CONFIG.wave.shoulderLength)).toBe(0);
    expect(w.rollerBlend(SURF_CONFIG.wave.taperEnd)).toBe(1);
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
 * Re-captured for playtest 7 (the concave face): new face points (1–3) in SWELL, BARREL_OPEN and BARREL_CLOSED and a crest a little
 * further shoreward on the open face (lip points unchanged), so every face row moved; the mound (x = −12) and the barrel's lip
 * rows (t = 0.77 / 1 at x ≤ 0) did not (its crest moved < 2 mm). At x = 60 the shoulder has begun to ease into the ROLLER
 * (the old SWELL).
 */
const GOLDEN_PROFILE: ReadonlyArray<readonly [number, number, number, number]> = [
  [-12, 0, 0, 7.2],
  [-12, 0.13, 0.177356928522, 5.43491304],
  [-12, 0.5, 0.907808237826, 2.145],
  [-12, 0.77, 1.052246746329, 0.280548],
  [-12, 1, 0.397943337129, -1.92],
  [-5, 0, 0, 7.2],
  [-5, 0.13, 0.072156084, 5.016],
  [-5, 0.5, 1.95, 0.717],
  [-5, 0.77, 2.61323286, 2.6211012],
  [-5, 1, 0.12, 6.24],
  [-2.5, 0, 0, 7.2],
  [-2.5, 0.13, 0.072156084, 5.016],
  [-2.5, 0.5, 1.95, 0.6945],
  [-2.5, 0.77, 2.685171714, 2.21174961],
  [-2.5, 1, 1.116, 4.98],
  [0, 0, 0, 7.2],
  [0, 0.13, 0.072156084, 5.016],
  [0, 0.5, 1.95, 0.672],
  [0, 0.77, 2.757110568, 1.80239802],
  [0, 1, 2.112, 3.72],
  [3, 0, 0, 7.2],
  [3, 0.13, 0.073360272359, 5.003538336725],
  [3, 0.5, 1.942546666667, 0.673930222222],
  [3, 0.77, 2.756681436865, 1.694186400871],
  [3, 1, 2.228238339278, 3.198702578266],
  [20, 0, 0, 7.2],
  [20, 0.13, 0.111569656477, 4.608124716247],
  [20, 0.5, 1.706049382716, 0.735176954733],
  [20, 0.77, 2.633517350074, 0.892693754337],
  [20, 1, 2.46587654321, 1.117596707819],
  [60, 0, 0, 7.2],
  [60, 0.13, 0.130398225758, 4.402410457778],
  [60, 0.5, 1.226555555556, 0.996944444444],
  [60, 0.77, 2.016237704593, -0.506277131111],
  [60, 1, 0.810666666667, -3.964444444444],
];
const GOLDEN_CREST: ReadonlyArray<readonly [number, number, number]> = [
  [-12, 0.699021374653, 1.096941015239],
  [-5, 0.69681624301, 2.770786340303],
  [-2.5, 0.709001996124, 2.760663314786],
  [0, 0.739589137786, 2.769364665194],
  [3, 0.742003508465, 2.766856435214],
  [20, 0.752433805641, 2.637988848954],
  [60, 0.73718878552, 2.037273351149],
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
    const xs = [-2.5, 3, 60];
    xs.forEach((x) => {
      w.crestT(x);
      w.profile(x, 0.9, p);
    });
    w.params.tubeDepth = 7;
    w.params.shoulderLength = 30;
    w.params.hollowLength = 20;
    w.params.height = 3;
    w.params.taperEnd = 80;
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
