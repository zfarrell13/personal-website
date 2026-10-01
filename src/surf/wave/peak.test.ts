import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { buildWaveGeometry, columnsX, type OceanLayout } from '../render/waveGeometry';
import { PeelController } from './PeelController';
import { applyPeakToVertex, PEAK_GLSL_HEADER, PEAK_NORMAL_GLSL, PEAK_POSITION_GLSL, peakBell, peakBellSlope } from './peak';
import { WaveShape } from './WaveShape';

const shape = () => new WaveShape(structuredClone(SURF_CONFIG.wave));
const { height: FULL, width: W } = SURF_CONFIG.peak;

describe('section peak shape (playtest 5)', () => {
  it('the bell is 1 at the top, 0 from its edges out, and C1 there (no kink at the edge)', () => {
    expect(peakBell(0)).toBe(1);
    expect(peakBell(1)).toBe(0);
    expect(peakBell(-1.5)).toBe(0);
    expect(Math.abs(peakBellSlope(0))).toBe(0);
    expect(Math.abs(peakBellSlope(0.999))).toBeLessThan(1e-4);
    // The slope is the derivative.
    for (const u of [-0.7, -0.2, 0.3, 0.8]) expect(peakBellSlope(u)).toBeCloseTo((peakBell(u + 1e-6) - peakBell(u - 1e-6)) / 2e-6, 5);
  });

  it('makes the wave taller (+35% at the top) and steeper on its face, only within ±width', () => {
    const w = shape();
    const x = 25;
    const crest0 = w.crestY(x);
    const t = 0.35;
    const steep0 = w.steepness(x, t);
    const away = w.profile(x + 1.5 * W, t).y;
    w.setPeak(x, FULL, W);
    expect(w.crestY(x) / crest0).toBeCloseTo(1 + FULL, 6);
    expect(w.steepness(x, t)).toBeGreaterThan(steep0 + 0.05);
    expect(w.profile(x + 1.5 * W, t).y).toBe(away);
  });

  it('leaves the crest where it was (crestT is cached and the bump scales y only)', () => {
    const w = shape();
    const xs = [-3, 0, 8, 25, 50];
    const before = xs.map((x) => w.crestT(x));
    for (const x of xs) {
      w.setPeak(x, FULL, W);
      expect(w.crestT(x)).toBeCloseTo(before[xs.indexOf(x)]!, 9);
    }
  });

  it('is continuous along the wave: no height or normal jump between columns 5 cm apart', () => {
    const w = shape();
    w.setPeak(30, FULL, W);
    const n0 = new Vector3();
    const n1 = new Vector3();
    for (const t of [0.15, 0.35, 0.55]) {
      let maxDy = 0;
      let maxDn = 0;
      for (let x = 20; x < 40; x += 0.05) {
        maxDy = Math.max(maxDy, Math.abs(w.profile(x + 0.05, t).y - w.profile(x, t).y));
        maxDn = Math.max(maxDn, w.normal(x, t, n0).angleTo(w.normal(x + 0.05, t, n1)));
      }
      expect(maxDy).toBeLessThan(0.02);
      expect(maxDn).toBeLessThan((1 * Math.PI) / 180);
    }
  });

  it('changes the wave smoothly frame to frame through a whole section (no jumps at the pitch, surge or blend back)', () => {
    const w = shape();
    const peel = new PeelController({ peelSpeed: SURF_CONFIG.wave.peelSpeed }, SURF_CONFIG.sections, SURF_CONFIG.peak);
    peel.reset(11);
    const xs = Array.from({ length: 80 }, (_, i) => -4 + i);
    const ts = [0.2, 0.4, 0.6];
    let prev: number[] | null = null;
    let maxDy = 0;
    let saw = false;
    for (let i = 1; i <= 40 * 120; i++) {
      peel.update(i / 120, 12);
      const pk = peel.peak;
      w.setPeak(pk.x, pk.amp, pk.width);
      if (pk.phase === 'none' && !prev) continue;
      saw ||= pk.phase === 'fading';
      const ys = xs.flatMap((x) => ts.map((t) => w.profile(x, t).y));
      if (prev) for (let k = 0; k < ys.length; k++) maxDy = Math.max(maxDy, Math.abs(ys[k]! - prev[k]!));
      prev = pk.phase === 'none' ? null : ys;
    }
    expect(saw).toBe(true);
    // At 120 Hz the surface under any fixed point moves at most a few centimetres a tick (the surge,
    // the fastest part, carries the bump at ~30 m/s).
    expect(maxDy).toBeLessThan(0.08);
  });

  it('render and physics agree: the shader formula (its CPU twin) on the rest mesh lands on the peaked profile, normals within 2°', () => {
    const w = shape();
    const { xMin, xMax } = w.params;
    const geo = buildWaveGeometry(w, columnsX(160, xMin, xMax), 64);
    const L = geo.userData as OceanLayout;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    w.setPeak(28, FULL, W);
    const v = { x: 0, y: 0 };
    const n = { x: 0, y: 0, z: 0 };
    const p = new Vector3();
    const want = new Vector3();
    let checked = 0;
    let maxDy = 0;
    let maxAngle = 0;
    for (let i = L.firstSimColumn; i < L.firstSimColumn + L.simColumns; i++) {
      const x = L.xs[i]!;
      if (Math.abs(x - 28) > W) continue;
      for (let r = L.profileRow; r < L.profileRow + L.profileSamples; r++) {
        const k = i * L.rows + r;
        const t = L.t[k]!;
        if (!(t > 0.1 && t < w.crestT(x) - 0.02)) continue;
        v.x = pos.getX(k);
        v.y = pos.getY(k);
        n.x = nor.getX(k);
        n.y = nor.getY(k);
        n.z = nor.getZ(k);
        applyPeakToVertex(w.peak, v, n);
        w.profile(x, t, p);
        maxDy = Math.max(maxDy, Math.abs(v.y - p.y));
        maxAngle = Math.max(maxAngle, new Vector3(n.x, n.y, n.z).angleTo(w.normal(x, t, want)));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(maxDy).toBeLessThan(1e-4);
    expect(maxAngle).toBeLessThan((2 * Math.PI) / 180);
  });

  it('the GLSL is the same formula: (1 − u²)³ height, its slope for the normal, scaled before the ripple', () => {
    expect(PEAK_GLSL_HEADER).toContain('a * a * a');
    expect(PEAK_GLSL_HEADER).toContain('-6.0 * u * a * a');
    expect(PEAK_NORMAL_GLSL).toContain('objectNormal.y / pk');
    expect(PEAK_POSITION_GLSL).toContain('transformed.y *= peakScale()');
  });
});
