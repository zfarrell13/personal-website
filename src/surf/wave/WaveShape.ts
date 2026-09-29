import { Vector3 } from 'three';
import type { WaveParams } from '../config';
import { clamp, smoothstep } from '../math/scalar';
import { BARREL_CLOSED, BARREL_OPEN, MOUND, SECTION_POINTS, SWELL, type Section } from './sections';

/** Surface parameters: x along the wave (m), t ∈ [0, 1] across the profile. */
export interface WaveParam {
  x: number;
  t: number;
}

export type WaveZone = 'broken' | 'tube' | 'shoulder' | 'swell';

const SEGMENTS = SECTION_POINTS - 1;
const HX = 0.01; // central-difference step in x (m)
const HT = 1e-4; // central-difference step in t

function blendInto(out: Float64Array, a: Section, b: Section, w: number): void {
  for (let i = 0; i < SECTION_POINTS; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    out[i * 2] = pa[0] + (pb[0] - pa[0]) * w;
    out[i * 2 + 1] = pa[1] + (pb[1] - pa[1]) * w;
  }
}

/**
 * The one wave shape. `profile(x, t)` is used by BOTH the render mesh and the
 * surfer physics — what you see is what you ride. Coordinates are the wave
 * frame: +x toward the shoulder (curl at x = 0), +y up, +z toward shore.
 * The shape reads `params` live, so debug-panel edits apply immediately.
 */
export class WaveShape {
  private readonly pts = new Float64Array(SECTION_POINTS * 2);
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly sx = new Vector3();
  private readonly st = new Vector3();
  private readonly r = new Vector3();

  constructor(readonly params: WaveParams) {}

  /** 1 in the barrel, fading to 0 across the shoulder. */
  hollowness(x: number): number {
    return x >= 0 ? 1 - smoothstep(0, this.params.shoulderLength, x) : 1;
  }

  zone(x: number): WaveZone {
    const p = this.params;
    if (x < -p.tubeDepth) return 'broken';
    if (x <= 0) return 'tube';
    if (x < p.shoulderLength) return 'shoulder';
    return 'swell';
  }

  /** Multiplier on y: taper past the shoulder, foam decay behind the tube. */
  heightScale(x: number): number {
    const p = this.params;
    if (x > p.shoulderLength) return 1 - (1 - p.taperMin) * smoothstep(p.shoulderLength, p.taperEnd, x);
    const behind = -x - p.tubeDepth;
    if (behind > 0) return p.moundMinScale + (1 - p.moundMinScale) * Math.exp(-behind / p.moundDecay);
    return 1;
  }

  /** Blended control points for column x (normalized by H), written to `out` as [z0,y0,z1,y1,…]. */
  sectionAt(x: number, out: Float64Array = this.pts): Float64Array {
    const p = this.params;
    if (x >= 0) blendInto(out, SWELL, BARREL_OPEN, this.hollowness(x));
    else if (x >= -p.tubeDepth) blendInto(out, BARREL_OPEN, BARREL_CLOSED, smoothstep(0, p.tubeDepth, -x));
    else blendInto(out, BARREL_CLOSED, MOUND, smoothstep(0, p.collapseLength, -x - p.tubeDepth));
    return out;
  }

  /** profile(x, t) → point on the wave surface in frame coordinates. */
  profile(x: number, t: number, out: Vector3 = new Vector3()): Vector3 {
    const c = this.sectionAt(x);
    const s = clamp(t, 0, 1) * SEGMENTS;
    const i = Math.min(Math.floor(s), SEGMENTS - 1);
    const u = s - i;
    const px = (k: number, comp: 0 | 1): number => {
      if (k < 0) return 2 * c[comp]! - c[2 + comp]!; // reflected ghost point
      if (k > SEGMENTS) return 2 * c[SEGMENTS * 2 + comp]! - c[(SEGMENTS - 1) * 2 + comp]!;
      return c[k * 2 + comp]!;
    };
    const u2 = u * u;
    const u3 = u2 * u;
    const cr = (comp: 0 | 1): number => {
      const p0 = px(i - 1, comp);
      const p1 = px(i, comp);
      const p2 = px(i + 1, comp);
      const p3 = px(i + 2, comp);
      return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    };
    const H = this.params.height;
    return out.set(x, cr(1) * H * this.heightScale(x), cr(0) * H);
  }

  surfacePoint(x: number, t: number, out: Vector3 = new Vector3()): Vector3 {
    return this.profile(x, t, out);
  }

  /** ∂S/∂x and ∂S/∂t by central differences. */
  tangents(x: number, t: number, dSdx: Vector3, dSdt: Vector3): void {
    this.profile(x + HX, t, this.a);
    this.profile(x - HX, t, this.b);
    dSdx.subVectors(this.a, this.b).multiplyScalar(1 / (2 * HX));
    const t0 = Math.max(0, t - HT);
    const t1 = Math.min(1, t + HT);
    this.profile(x, t1, this.a);
    this.profile(x, t0, this.b);
    dSdt.subVectors(this.a, this.b).multiplyScalar(1 / (t1 - t0));
  }

  /** Unit normal pointing out of the water (toward shore/up on the face, into the tube under the lip). */
  normal(x: number, t: number, out: Vector3 = new Vector3()): Vector3 {
    this.tangents(x, t, this.sx, this.st);
    return out.crossVectors(this.sx, this.st).normalize();
  }

  /** Local steepness in [0, 1]: sin of the face angle (1 = vertical or overhanging). */
  steepness(x: number, t: number): number {
    const ny = this.normal(x, t, this.r).y;
    return ny <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - ny * ny));
  }

  /** t of the highest point of the profile at x (the crest / top of the curl). */
  crestT(x: number): number {
    const N = 48;
    let best = 0;
    let bestY = -Infinity;
    for (let i = 0; i <= N; i++) {
      const t = 0.3 + (0.7 * i) / N;
      const y = this.profile(x, t, this.a).y;
      if (y > bestY) {
        bestY = y;
        best = t;
      }
    }
    // Golden-section refine inside the bracketing samples.
    let lo = Math.max(0, best - 0.7 / N);
    let hi = Math.min(1, best + 0.7 / N);
    const g = 0.6180339887498949;
    let c = hi - g * (hi - lo);
    let d = lo + g * (hi - lo);
    for (let k = 0; k < 24; k++) {
      if (this.profile(x, c, this.a).y > this.profile(x, d, this.b).y) hi = d;
      else lo = c;
      c = hi - g * (hi - lo);
      d = lo + g * (hi - lo);
    }
    return (lo + hi) / 2;
  }

  crestY(x: number): number {
    return this.profile(x, this.crestT(x), this.a).y;
  }

  /**
   * Nearest surface parameters to world point p, by Gauss-Newton iteration
   * from `guess` (normally last tick's params). At most 4 iterations.
   */
  closestParam(p: Vector3, guess: WaveParam, out: WaveParam = { x: 0, t: 0 }): WaveParam {
    const { xMin, xMax } = this.params;
    let x = clamp(guess.x, xMin, xMax);
    let t = clamp(guess.t, 0, 1);
    for (let it = 0; it < 4; it++) {
      this.profile(x, t, this.r);
      this.tangents(x, t, this.sx, this.st);
      this.r.sub(p); // residual S − p
      const a11 = this.sx.dot(this.sx);
      const a12 = this.sx.dot(this.st);
      const a22 = this.st.dot(this.st);
      const g1 = this.r.dot(this.sx);
      const g2 = this.r.dot(this.st);
      const det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-12) break;
      const dx = clamp(-(a22 * g1 - a12 * g2) / det, -2, 2);
      const dt = clamp(-(-a12 * g1 + a11 * g2) / det, -0.08, 0.08);
      x = clamp(x + dx, xMin, xMax);
      t = clamp(t + dt, 0, 1);
      if (Math.abs(dx) < 1e-5 && Math.abs(dt) < 1e-7) break;
    }
    out.x = x;
    out.t = t;
    return out;
  }
}
