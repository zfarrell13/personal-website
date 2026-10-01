import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { clamp, smoothstep } from '../math/scalar';
import { PITCH_AT } from '../wave/sections';
import type { WaveShape } from '../wave/WaveShape';

/** The open sea: colour and opacity of flat water. The wave's trough, the flats and the far sea all use it. */
export const SEA = { color: new Color('#1d979d'), alpha: 0.7 };
/**
 * Half-size of the ocean surface (m). Fog is depth-based, so an edge seen near the corner of a wide
 * frustum is nearer in depth than in distance: this is far enough that the edge is past full fog
 * (and the camera far plane) in every view in play (see the horizon test in Environment.test).
 */
export const OCEAN_EXTENT = 1500;
/** Flat rows toward shore, metres beyond the trough (t = 0); the outermost row sits at +OCEAN_EXTENT. */
const FRONT_FLATS = [400, 150, 48, 24, 10, 4];
/** How much of the trough's whitewater reaches each front flat row (it spreads a few metres and breaks up). */
const FRONT_FOAM = [0, 0, 0, 0, 0.05, 0.3];
/** Back of the wave from the top of the lip: [z offset in H, y as a fraction of the top]. Close to SWELL's own back. */
const BACK_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-0.35, 0.93],
  [-0.8, 0.78],
  [-1.4, 0.55],
  [-2.1, 0.28],
  [-2.8, 0.08],
  [-3.5, 0],
];
/** Flat rows seaward of the back (m beyond its foot); the outermost row sits at −OCEAN_EXTENT. */
const BACK_FLATS = [8, 25, 150, 400];
/** Hollowness below which the lip no longer animates (just ahead of where it pitches, PITCH_AT). */
const LIP_ANIM_FROM = PITCH_AT - 0.04;
/** Largest share of the profile rows given to the lip (past the crest) where it is fully drawn. */
const LIP_ROW_SHARE = 0.42;
/** Samples along the lip top, from the tip back over the crest. */
const LIP_SAMPLES = 9;
/** Lip thickness (m) at its thickest; it thins to nothing at the tip. */
const LIP_THICKNESS = 0.35;
const LIP_MIN_THICKNESS = 0.12;
/** Columns past the ridden x range where the wave eases down to flat sea (m beyond xMin / xMax). */
const EASE_BEHIND = [45, 25, 12, 5];
const EASE_AHEAD = [6, 16, 32, 55];
/**
 * Far-sea columns (m beyond the eased ends) and the far flat rows above: the open sea out to
 * ±OCEAN_EXTENT is split into a few bands instead of single enormous triangles, which the
 * rasterizer clips against the far plane with pinholes along their shared edges (dark specks on the
 * horizon where the reef or floor showed through).
 */
const FAR_COLUMNS = [400, 150];

export const WAVE_COLORS = {
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

/**
 * How far thick foam whitens the vertex colour. Thin foam (spreading, ageing whitewater) keeps the
 * water's colour: the shader breaks it into white patches and streaks (a vertex tint would smear it
 * into a grey haze across the flats).
 */
function foamTint(foam: number): number {
  return smoothstep(0.4, 1, foam);
}

/** Foam amount at (x, t): 1 in the broken whitewater, some on the lip and crest. */
export function foamAt(shape: WaveShape, x: number, t: number, tc: number): number {
  const D = shape.params.tubeDepth;
  // The broken wave's whitewater, thinning as it ages behind the impact (the shader breaks thin foam
  // into patches and streaks of aerated water).
  const behind = -x - D;
  let foam = smoothstep(0, 2, behind) * (1 - 0.65 * smoothstep(3, 22, behind));
  // The lip underside is clean water; spray only along its thin edge.
  if (t > tc) foam = Math.max(foam, 0.35 * shape.hollowness(x) * smoothstep(0.75, 1, (t - tc) / Math.max(1e-6, 1 - tc)));
  foam = Math.max(foam, 0.25 * smoothstep(tc - 0.03, tc, t) * (1 - smoothstep(tc, tc + 0.02, t)));
  return clamp(foam, 0, 1);
}

/**
 * How much of the lip animation a vertex gets (the `aLip` attribute): 0 on the rideable face and at
 * the crest (the physics surface — what you see is what you ride), rising past the crest toward the
 * lip tip, where the lip pitches: the whole barrel and the curl, fading out just ahead of it (by
 * hollowness LIP_ANIM_FROM, ≈ 2 m ahead). The short feathering lip beyond hangs right over the line
 * the tube camera looks out along, so it stays still (the feathering spray animates the shoulder).
 */
export function lipWeight(shape: WaveShape, x: number, t: number, tc: number): number {
  return t <= tc ? 0 : smoothstep(tc, Math.min(1, tc + 0.12), t) * smoothstep(LIP_ANIM_FROM, 1, shape.hollowness(x));
}

/**
 * Vertex colour + alpha for the water: sea colour and opacity at sea level, green on the face, light
 * near the top, a thin bright crest band (unless `crestBand: false`), white foam. `lipS` ∈ [0, 1] runs along the lip underside
 * from the crest to the tip: the thin edge is lighter and slightly translucent.
 */
export function waveVertexColor(y: number, crestY: number, t: number, tc: number, foam: number, out: Color, opts: { lipS?: number; crestBand?: boolean } = {}): number {
  const { lipS = 0, crestBand = true } = opts;
  const h = clamp(y / Math.max(crestY, 0.01), 0, 1);
  out.copy(SEA.color).lerp(WAVE_COLORS.face, smoothstep(0, 0.5, h));
  out.lerp(WAVE_COLORS.light, smoothstep(0.5, 0.95, h));
  if (crestBand) out.lerp(WAVE_COLORS.crest, 0.7 * smoothstep(tc - 0.03, tc, t) * (1 - smoothstep(tc, tc + 0.05, t)));
  if (lipS > 0) out.lerp(WAVE_COLORS.light, 0.5 * lipS);
  out.lerp(WAVE_COLORS.foam, foamTint(foam));
  const alpha = (SEA.alpha + (1 - SEA.alpha) * smoothstep(0, 0.12, h)) * (1 - 0.2 * smoothstep(0.7, 1, lipS));
  return alpha + (1 - alpha) * foam; // whitewater is opaque
}

/**
 * How far up the wave a profile vertex is (the `aRise` attribute): its height as a share of the crest
 * height, 0 in the trough … 1 at the crest (and on the lip around it). The shader shades the face
 * concave with it: darker down in the trough curve, lighter up the wall, a bright rim along the lip.
 * 0 off the profile (flats, lip top, back).
 */
export function faceRise(y: number, crestY: number): number {
  return crestY > 0.01 ? clamp(y / crestY, 0, 1) : 0;
}

/** Row/column layout of the ocean grid (stored on `geometry.userData`). */
export interface OceanLayout {
  columns: number;
  rows: number;
  /** x of every column (the ridden columns plus the eased ends and the far sea). */
  xs: Float32Array;
  /** Profile parameter t of each vertex on the wave profile rows (NaN elsewhere). */
  t: Float32Array;
  /** Index of the first column of the ridden range (`xs` passed in). */
  firstSimColumn: number;
  /** Number of ridden columns (the `xs` passed in). */
  simColumns: number;
  /** First row of the profile (t = 0 … the drawn tip), the lip top (tip → over the crest) and the back (→ its foot at sea level). */
  profileRow: number;
  profileSamples: number;
  lipRow: number;
  lipSamples: number;
  backRow: number;
  backSamples: number;
}

/** Eases the wave to flat water beyond the ridden range: 1 inside [xMin, xMax], 0 at the outer eased columns. */
function endEase(x: number, xMin: number, xMax: number): number {
  if (x < xMin) return smoothstep(xMin - EASE_BEHIND[0]!, xMin, x);
  if (x > xMax) return 1 - smoothstep(xMax, xMax + EASE_AHEAD[EASE_AHEAD.length - 1]!, x);
  return 1;
}

/**
 * The whole ocean as ONE surface (one material, one draw call): for each column x, a strip from
 * the far sea toward shore, over the flats into the trough, up the face (the physics profile),
 * along the underside of the lip to its tip, back over the lip top (the lip has thickness), down
 * the back of the wave and out to the far sea behind. Columns continue past the ridden range,
 * easing the wave down to flat sea, out to the far sea at ±OCEAN_EXTENT. Flat water everywhere is
 * exactly sea level, faces up and has the sea colour and opacity — there is no seam to see.
 * Winding faces the normal (Sx × St). Attributes: position, normal, color (RGBA), uv (x, t), aFoam, aFace, aLip, aRise.
 */
export function buildWaveGeometry(shape: WaveShape, xs: Float32Array, rows: number, geo = new BufferGeometry()): BufferGeometry {
  const { xMin, xMax, tubeDepth: D, height: H } = shape.params;
  const behindEnd = xMin - EASE_BEHIND[0]!;
  const aheadEnd = xMax + EASE_AHEAD[EASE_AHEAD.length - 1]!;
  const colX = [
    -OCEAN_EXTENT,
    ...FAR_COLUMNS.map((d) => behindEnd - d),
    ...EASE_BEHIND.map((d) => xMin - d),
    ...xs,
    ...EASE_AHEAD.map((d) => xMax + d),
    ...[...FAR_COLUMNS].reverse().map((d) => aheadEnd + d),
    OCEAN_EXTENT,
  ];
  const firstSim = 1 + FAR_COLUMNS.length + EASE_BEHIND.length;
  const F = 1 + FRONT_FLATS.length;
  const P = rows;
  const K = LIP_SAMPLES;
  const B = BACK_PROFILE.length;
  const R = F + P + K + B + BACK_FLATS.length + 1;
  const cols = colX.length;
  const count = cols * R;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const uv = new Float32Array(count * 2);
  const foamA = new Float32Array(count);
  const faceA = new Float32Array(count);
  const lipA = new Float32Array(count);
  const riseA = new Float32Array(count);
  const tA = new Float32Array(count).fill(NaN);
  const p = new Vector3();
  const n = new Vector3();
  const c = new Color();
  const up = new Vector3(0, 1, 0);
  const crest = new Vector3();
  const tip = new Vector3();
  const put = (v: number, x: number, y: number, z: number, foam: number, face: number, uvy: number, alpha: number, lip = 0) => {
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    col[v * 4] = c.r;
    col[v * 4 + 1] = c.g;
    col[v * 4 + 2] = c.b;
    col[v * 4 + 3] = alpha;
    uv[v * 2] = x;
    uv[v * 2 + 1] = uvy;
    foamA[v] = foam;
    faceA[v] = face;
    lipA[v] = lip;
  };
  const sea = (v: number, x: number, z: number, foam = 0) => {
    c.copy(SEA.color).lerp(WAVE_COLORS.foam, foamTint(foam));
    put(v, x, 0, z, foam, 0, 0, SEA.alpha + (1 - SEA.alpha) * foam);
    nor.set([0, 1, 0], v * 3);
  };

  for (let i = 1; i < cols - 1; i++) {
    const x = colX[i]!;
    const xc = clamp(x, xMin, xMax);
    const e = endEase(x, xMin, xMax);
    const tc = shape.crestT(xc);
    const cy = shape.crestY(xc) * e;
    const hollow = shape.hollowness(xc);
    shape.profile(xc, tc, crest);
    shape.profile(xc, 1, tip);
    // The lip is drawn (and has a top) only while it is thrown out in front of the crest: ahead of the
    // curl that follows the hollowness (a smooth fade as the feathering lip turns into the swell's
    // back); behind it, where the lip tip is (it collapses into the whitewater mound).
    const lipOut = xc >= 0 ? smoothstep(0.12, 0.3, hollow) : smoothstep(0.05 * H, 0.5 * H, tip.z - crest.z);
    // The lip thickens as it pitches: a feathering crest is thin, the barrel's lip a real slab.
    // Never thinner than LIP_MIN_THICKNESS where drawn, so the lip top never coincides with the underside (z-fighting).
    const slab = lipOut * (LIP_MIN_THICKNESS + (LIP_THICKNESS - LIP_MIN_THICKNESS) * smoothstep(0.25, 0.8, hollow));
    const tEnd = tc + (1 - tc) * lipOut;
    const base = i * R;
    const z0 = shape.profile(xc, 0, p).z;
    const troughFoam = foamAt(shape, xc, 0, tc) * e;

    // Flats toward shore.
    sea(base, x, OCEAN_EXTENT);
    FRONT_FLATS.forEach((dz, k) => sea(base + 1 + k, x, z0 + dz, troughFoam * FRONT_FOAM[k]!));

    // The face and the lip underside: the physics profile. Rows split at the crest: the drawn lip gets
    // up to LIP_ROW_SHARE of them (it curls tightly), and where it is fully drawn the crest sits at the
    // same row in every column, so rows follow the lip instead of cutting across it (no stair-steps).
    const knot = 1 - LIP_ROW_SHARE * lipOut;
    for (let r = 0; r < P; r++) {
      const v = base + F + r;
      const s = r / (P - 1);
      const t = s <= knot ? (tc * s) / knot : tc + ((tEnd - tc) * (s - knot)) / (1 - knot);
      shape.profile(xc, t, p);
      p.y *= e;
      shape.normal(xc, t, n);
      n.lerp(up, 1 - e * smoothstep(0, 0.08, t)).normalize();
      const lipS = t > tc ? (t - tc) / (1 - tc) : 0;
      const foam = foamAt(shape, xc, t, tc) * e;
      const alpha = waveVertexColor(p.y, cy, t, tc, foam, c, { lipS });
      const face = smoothstep(0.15, 0.6, clamp(p.y / Math.max(cy, 0.01), 0, 1)) * (1 - foam) * (t <= tc ? 1 : 0.4 + 0.5 * lipS);
      put(v, x, p.y, p.z, foam, face, t, alpha, lipWeight(shape, xc, t, tc) * e);
      nor.set([n.x, n.y, n.z], v * 3);
      tA[v] = t;
      riseA[v] = faceRise(p.y, cy);
    }

    // The lip top: from the drawn tip back over the crest, a slab LIP_THICKNESS thick at most.
    for (let k = 0; k < K; k++) {
      const v = base + F + P + k;
      const t = tEnd - ((tEnd - tc) * k) / (K - 1);
      const s = (t - tc) / Math.max(1e-6, tEnd - tc);
      const thick = slab * (0.3 + 0.7 * smoothstep(0, 0.35, s)) * (1 - s) ** 0.6;
      shape.profile(xc, t, p);
      shape.normal(xc, t, n);
      p.addScaledVector(n, -thick);
      p.y *= e;
      // Coloured like the face at the same height (no crest band), a little whitewater on top.
      const foam = 0.15 * hollow * lipOut * e;
      const alpha = waveVertexColor(p.y, cy, t, tc, foam, c, { crestBand: false }) * (1 - 0.2 * smoothstep(0.7, 1, s) * lipOut);
      // The lip top moves with the underside (same weight): the slab throws as one piece.
      put(v, x, p.y, p.z, foam, 0, t, alpha, lipWeight(shape, xc, t, tc) * e);
    }

    // Down the back of the wave to sea level, then flats out to the far sea.
    const top = base + F + P + K - 1;
    const sy = pos[top * 3 + 1]!;
    const sz = pos[top * 3 + 2]!;
    const whitewater = troughFoam;
    BACK_PROFILE.forEach(([dz, fy], j) => {
      const y = sy * fy;
      const h = clamp(y / Math.max(cy, 0.01), 0, 1);
      const foam = whitewater * smoothstep(0, 0.4, h);
      c.copy(SEA.color)
        .lerp(WAVE_COLORS.back, smoothstep(0, 0.6, h))
        .lerp(WAVE_COLORS.foam, foamTint(foam));
      const alpha = SEA.alpha + (1 - SEA.alpha) * smoothstep(0, 0.12, h);
      put(base + F + P + K + j, x, y, sz + dz * H, foam, 0, 1 + 0.1 * (j + 1), alpha + (1 - alpha) * foam);
    });
    const foot = sz + BACK_PROFILE[B - 1]![0] * H;
    BACK_FLATS.forEach((dz, k) => sea(base + F + P + K + B + k, x, foot - dz));
    sea(base + R - 1, x, -OCEAN_EXTENT);
  }

  // The far sea at both ends: flat copies of the neighbouring (already flat) column.
  for (const [i, from] of [
    [0, 1],
    [cols - 1, cols - 2],
  ] as const) {
    for (let r = 0; r < R; r++) sea(i * R + r, colX[i]!, pos[(from * R + r) * 3 + 2]!);
  }

  columnNormals(pos, nor, cols, R, F, F + P);
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('color', new BufferAttribute(col, 4));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('aFoam', new BufferAttribute(foamA, 1));
  geo.setAttribute('aFace', new BufferAttribute(faceA, 1));
  geo.setAttribute('aLip', new BufferAttribute(lipA, 1));
  geo.setAttribute('aRise', new BufferAttribute(riseA, 1));
  geo.setIndex(gridIndex(cols, R));
  geo.computeBoundingSphere();
  const layout: OceanLayout = {
    columns: cols,
    rows: R,
    xs: Float32Array.from(colX),
    t: tA,
    firstSimColumn: firstSim,
    simColumns: xs.length,
    profileRow: F,
    profileSamples: P,
    lipRow: F + P,
    lipSamples: K,
    backRow: F + P + K,
    backSamples: B,
  };
  geo.userData = layout;
  return geo;
}

/**
 * Normals for every row outside the profile rows [p0, p1) (those carry the physics normal):
 * perpendicular to the column's polyline in the z-y plane, same orientation as the profile
 * (up on the flats, up/out on the lip top and the back). Sea-level vertices face straight up.
 */
function columnNormals(pos: Float32Array, nor: Float32Array, cols: number, R: number, p0: number, p1: number): void {
  const at = (v: number, k: number) => pos[v * 3 + k]!;
  for (let i = 0; i < cols; i++) {
    for (let r = 0; r < R; r++) {
      if (r >= p0 && r < p1) continue;
      const v = i * R + r;
      if (Math.abs(at(v, 1)) < 1e-9) {
        nor.set([0, 1, 0], v * 3);
        continue;
      }
      // Nearest distinct neighbours along the column (collapsed lip rows share one point).
      let a = r;
      let b = r;
      while (a > 0 && Math.hypot(at(i * R + a, 1) - at(v, 1), at(i * R + a, 2) - at(v, 2)) < 1e-4) a--;
      while (b < R - 1 && Math.hypot(at(i * R + b, 1) - at(v, 1), at(i * R + b, 2) - at(v, 2)) < 1e-4) b++;
      const dy = at(i * R + b, 1) - at(i * R + a, 1);
      const dz = at(i * R + b, 2) - at(i * R + a, 2);
      const len = Math.hypot(dy, dz) || 1;
      nor.set([0, -dz / len, dy / len], v * 3);
    }
  }
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
