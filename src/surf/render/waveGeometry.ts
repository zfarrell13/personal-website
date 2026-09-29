import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { clamp, smoothstep } from '../math/scalar';
import type { WaveShape } from '../wave/WaveShape';

/** Flat sea strip in front of the trough (m toward shore). */
export const FRONT_SKIRT = 60;
/** Back-of-wave rows: [z offset in H, y as a fraction of crest height]. */
const BACK_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [-0.6, 0.75],
  [-1.4, 0.35],
  [-3, 0],
  [-40, 0],
];

export const WAVE_COLORS = {
  trough: new Color('#0b4f5c'),
  face: new Color('#1f9e8f'),
  light: new Color('#86e3c3'),
  crest: new Color('#e6fff6'),
  foam: new Color('#f4fbff'),
  back: new Color('#0e5a66'),
};

/**
 * Column x positions spanning [xMin, xMax], denser near the curl (x = 0):
 * inverse CDF of density 1 + 5·exp(−(x/10)²).
 */
export function columnsX(n: number, xMin: number, xMax: number): Float32Array {
  const STEPS = 2000;
  const cdf = new Float64Array(STEPS + 1);
  const dx = (xMax - xMin) / STEPS;
  for (let i = 1; i <= STEPS; i++) {
    const x = xMin + (i - 0.5) * dx;
    cdf[i] = cdf[i - 1]! + (1 + 5 * Math.exp(-((x / 10) ** 2))) * dx;
  }
  const total = cdf[STEPS]!;
  const out = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (j < STEPS && cdf[j + 1]! < target) j++;
    const seg = cdf[j + 1]! - cdf[j]!;
    const f = seg > 0 ? (target - cdf[j]!) / seg : 0;
    out[k] = xMin + (j + clamp(f, 0, 1)) * dx;
  }
  out[0] = xMin;
  out[n - 1] = xMax;
  return out;
}

/** Foam amount at (x, t): 1 in the broken whitewater, some on the lip and crest. */
export function foamAt(shape: WaveShape, x: number, t: number, tc: number): number {
  const D = shape.params.tubeDepth;
  let foam = smoothstep(0, 2, -x - D);
  if (t > tc) foam = Math.max(foam, 0.35 * shape.hollowness(x));
  foam = Math.max(foam, 0.25 * smoothstep(tc - 0.03, tc, t) * (1 - smoothstep(tc, tc + 0.02, t)));
  return clamp(foam, 0, 1);
}

/** Vertex color + alpha for the wave: teal trough → green face → white crest/foam. */
export function waveVertexColor(y: number, crestY: number, t: number, tc: number, foam: number, out: Color): number {
  const h = clamp(y / Math.max(crestY, 0.01), 0, 1);
  out.copy(WAVE_COLORS.trough).lerp(WAVE_COLORS.face, smoothstep(0, 0.5, h));
  out.lerp(WAVE_COLORS.light, smoothstep(0.5, 0.95, h));
  out.lerp(WAVE_COLORS.crest, 0.8 * smoothstep(tc - 0.03, tc + 0.02, t));
  out.lerp(WAVE_COLORS.foam, foam);
  return t < 0.05 ? 0.78 : 1;
}

export interface WaveGeometryInfo {
  columns: number;
  rows: number;
}

/**
 * Builds the front surface: `rows` samples of t ∈ [0, 1] plus one flat skirt
 * row toward shore, for each column x. Winding faces the normal (Sx × St).
 * Attributes: position, normal, color (RGBA), uv (x, t), aFoam, aFace.
 */
export function buildWaveGeometry(shape: WaveShape, xs: Float32Array, rows: number, geo = new BufferGeometry()): BufferGeometry {
  const cols = xs.length;
  const R = rows + 1;
  const count = cols * R;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const uv = new Float32Array(count * 2);
  const foamA = new Float32Array(count);
  const faceA = new Float32Array(count);
  const p = new Vector3();
  const n = new Vector3();
  const c = new Color();
  for (let i = 0; i < cols; i++) {
    const x = xs[i]!;
    const tc = shape.crestT(x);
    const cy = shape.crestY(x);
    for (let r = 0; r < R; r++) {
      const v = i * R + r;
      const t = r === 0 ? 0 : (r - 1) / (rows - 1);
      shape.profile(x, t, p);
      if (r === 0) {
        p.z += FRONT_SKIRT;
        n.set(0, 1, 0);
      } else {
        shape.normal(x, t, n);
      }
      const foam = r === 0 ? 0 : foamAt(shape, x, t, tc);
      const alpha = waveVertexColor(p.y, cy, t, tc, foam, c);
      pos.set([p.x, p.y, p.z], v * 3);
      nor.set([n.x, n.y, n.z], v * 3);
      col.set([c.r, c.g, c.b, r === 0 ? 0.72 : alpha], v * 4);
      uv.set([x, t], v * 2);
      foamA[v] = foam;
      faceA[v] = smoothstep(0.15, 0.6, clamp(p.y / Math.max(cy, 0.01), 0, 1)) * (1 - foam) * (t <= tc ? 1 : 0.4);
    }
  }
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('color', new BufferAttribute(col, 4));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('aFoam', new BufferAttribute(foamA, 1));
  geo.setAttribute('aFace', new BufferAttribute(faceA, 1));
  geo.setIndex(gridIndex(cols, R));
  geo.computeBoundingSphere();
  return geo;
}

/** Back of the wave (render-only): from the crest down to flat sea behind. */
export function buildBackGeometry(shape: WaveShape, xs: Float32Array, geo = new BufferGeometry()): BufferGeometry {
  const cols = xs.length;
  const R = BACK_PROFILE.length;
  const H = shape.params.height;
  const pos = new Float32Array(cols * R * 3);
  const col = new Float32Array(cols * R * 3);
  const p = new Vector3();
  for (let i = 0; i < cols; i++) {
    const x = xs[i]!;
    shape.profile(x, shape.crestT(x), p);
    for (let r = 0; r < R; r++) {
      const [dz, fy] = BACK_PROFILE[r]!;
      const v = i * R + r;
      pos.set([x, p.y * fy - (r === 0 ? 0.02 : 0), p.z + dz * H], v * 3);
      const k = 0.7 + 0.3 * fy;
      col.set([WAVE_COLORS.back.r * k, WAVE_COLORS.back.g * k, WAVE_COLORS.back.b * k], v * 3);
    }
  }
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(gridIndex(cols, R));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Two CCW triangles per quad for a (cols × rows) grid laid out column-major. */
export function gridIndex(cols: number, rows: number): BufferAttribute {
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let i = 0; i < cols - 1; i++) {
    for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r;
      const b = (i + 1) * rows + r;
      const c = a + 1;
      const d = b + 1;
      idx.set([a, b, c, b, d, c], k);
      k += 6;
    }
  }
  return new BufferAttribute(idx, 1);
}
