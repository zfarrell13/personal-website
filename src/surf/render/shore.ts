import { BufferGeometry, Color, DoubleSide, MeshLambertMaterial } from 'three';
import { clamp, smoothstep } from '../math/scalar';
import { LowPoly } from './lowpoly';

/**
 * The beach side of the break, modelled on Wrightsville Beach around Crystal Pier: shallows rising to a
 * wide pale beach, dunes with sea oats, fences and walkways, rows of stilted beach houses and a few
 * condos, then Banks Channel, the marsh and the low mainland fading into the haze. Landmarks: the
 * pier (X-braced pilings) with the green-roofed Oceanic and its pier house at its foot, a lifeguard
 * stand, the white water tower and a resort tower.
 *
 * Frame coordinates (+z toward shore, x along the beach). The strip is built along a strip coordinate
 * u ∈ [0, span) — periodic, so it wraps seamlessly — and cut into chunks that scroll like the reef
 * tiles (scrollWrap(worldX, travel, span, start)). The landmark set recurs every `landmarkEvery`
 * metres (the old pier's wrap), with different houses around each.
 */
export const SHORE = {
  /** Mean z of the waterline (m). The break (trough) is at z ≈ 0. */
  z: 110,
  /** Strip length (m): the scroll span. */
  span: 2600,
  /** Chunk length along x (m); each chunk is one near and one far mesh. */
  chunk: 200,
  /** Scroll window start: chunks cover [start + chunk/2, start + span − chunk/2] = ±1200 m, past full fog. */
  start: -1300,
  /**
   * Strip u of the landmark sets (pier, Oceanic, lifeguard stand, water tower, resort tower): at travel 0
   * the pier is 300 m down the line (in view from the title and the drop-in, not on top of the rider).
   */
  landmarkU: [300, 1600] as readonly number[],
  /** The pier's seaward end (m). Shoreward of the trough and the flats the rider uses, so no piling stands in the wave. */
  pierEndZ: 22,
  /** Near / far mesh split (m beyond the waterline) and the far edge of the land (z, m). */
  splitZr: 300,
  farZ: 1100,
} as const;

/**
 * Share of each vertex colour the scenery shows on its own: the low sun barely lights flat ground,
 * which left the pale sand and white houses a dull grey-beige instead of the sunny off-white of the
 * reference.
 */
export const SHORE_GLOW = 0.4;

/** The scenery's one material: vertex colours, lit, fogged, both sides, plus SHORE_GLOW of its colour. */
export function createShoreMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n  totalEmissiveRadiance += ${SHORE_GLOW.toFixed(2)} * vColor.rgb;`,
    );
  };
  m.customProgramCacheKey = () => 'shore-glow';
  return m;
}

/** One scrolling piece of the strip: geometries in chunk-local x (centred on worldX). */
export interface ShoreChunk {
  worldX: number;
  near: BufferGeometry;
  far: BufferGeometry;
}

export type LandmarkKind = 'pier' | 'oceanic' | 'lifeguard' | 'waterTower' | 'resort';
/** Where each landmark stands (strip u, frame z) — for placement checks. */
export interface Landmark {
  kind: LandmarkKind;
  u: number;
  z: number;
}

export interface ShoreOptions {
  /** Phones: fewer house rows, simpler pilings, fewer details. */
  lite?: boolean;
}

const TAU = Math.PI * 2;
/** Periodic in u (period = span) so the strip wraps without a seam. */
const wave = (u: number, k: number, phase = 0) => Math.sin((TAU * k * u) / SHORE.span + phase);

/** z of the waterline at strip u: a gently wandering shore. */
export function shoreZ(u: number): number {
  return SHORE.z + 3 * wave(u, 3, 0.4) + 1.5 * wave(u, 11, 2.1);
}

/** Cross-shore profile: [metres beyond the waterline, height]. */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-45, -4.6], // under the sea floor: the shallows rise out of it
  [-20, -1.6],
  [-6, -0.35],
  [0, 0.08], // waterline
  [12, 0.45], // wet sand ends
  [40, 1.2],
  [58, 1.7], // back of the beach
  [66, 3.2], // dunes
  [74, 3.8],
  [84, 3.0],
  [92, 2.6], // the town
  [200, 2.4],
  [210, 0.6],
  [218, -2.2], // Banks Channel
  [258, -2.2],
  [266, 0.15], // marsh
  [380, 0.2],
  [392, -1.6], // Intracoastal Waterway
  [440, -1.6],
  [452, 1.2], // mainland
  [600, 2.5],
  [900, 4],
];

function profile(zr: number): number {
  if (zr <= PROFILE[0]![0]) return PROFILE[0]![1];
  for (let i = 1; i < PROFILE.length; i++) {
    const [z1, y1] = PROFILE[i]!;
    if (zr <= z1) {
      const [z0, y0] = PROFILE[i - 1]!;
      return y0 + ((y1 - y0) * (zr - z0)) / (z1 - z0);
    }
  }
  return PROFILE[PROFILE.length - 1]![1];
}

/** Noise in [0, 1], periodic in u. */
function noise(u: number, zr: number, seed: number): number {
  return clamp(0.5 + 0.25 * wave(u, 37 + seed, zr * 0.21 + seed) + 0.25 * wave(u, 113 + seed * 3, zr * 0.47 + 2 * seed), 0, 1);
}

/** Ground height at strip u and frame z. */
export function groundY(u: number, z: number): number {
  const zr = z - shoreZ(u);
  let y = profile(zr);
  y += 1.1 * (noise(u, zr, 1) - 0.5) * smoothstep(58, 66, zr) * (1 - smoothstep(84, 92, zr)); // dune hummocks
  y += 1.3 * (noise(u, zr * 0.4, 2) - 0.5) * smoothstep(262, 272, zr) * (1 - smoothstep(372, 384, zr)); // marsh islands
  return y;
}

const COL = {
  deep: new Color('#2a8f8f'),
  shallow: new Color('#79cdb8'),
  wet: new Color('#c7b089'),
  sand: new Color('#fff6e0'),
  sandShade: new Color('#f6e8c8'),
  duneGrass: new Color('#8f9656'),
  lawn: new Color('#7f9a55'),
  lot: new Color('#d6c8a2'),
  road: new Color('#8d8c88'),
  marsh: new Color('#8a8a4c'),
  mud: new Color('#7a6646'),
  mainland: new Color('#56704a'),
  mainlandDry: new Color('#8c9468'),
  foam: new Color('#f6fbfb'),
  seaFoam: new Color('#bfe9e2'),
};
const tmp = new Color();

function groundColor(u: number, zr: number, y: number, out: Color): Color {
  const n = noise(u, zr, 4);
  if (y < -0.02) return out.copy(COL.deep).lerp(COL.shallow, smoothstep(-4.4, 0, y));
  if (zr < 14) return out.copy(COL.wet).lerp(COL.sand, smoothstep(6, 14, zr));
  if (zr < 60) return out.copy(COL.sand).lerp(COL.sandShade, smoothstep(0.3, 0.7, n));
  if (zr < 90) return out.copy(COL.sand).lerp(COL.duneGrass, smoothstep(0.35, 0.6, n) * smoothstep(60, 68, zr));
  if (zr < 205) {
    if ((zr > 111 && zr < 118) || (zr > 165 && zr < 171)) return out.copy(COL.road);
    return out.copy(COL.lot).lerp(COL.lawn, smoothstep(0.4, 0.65, n));
  }
  if (zr < 262) return out.copy(COL.sand);
  if (zr < 386) return out.copy(COL.marsh).lerp(COL.mud, smoothstep(0.45, 0.7, n));
  return out.copy(COL.mainland).lerp(COL.mainlandDry, smoothstep(0.4, 0.7, n));
}

/** Ground grid over strip [u0, u1] and the given waterline-relative rows; x is local to cx. */
function terrain(b: LowPoly, u0: number, u1: number, cx: number, zrs: readonly number[], step: number): void {
  const nx = Math.round((u1 - u0) / step);
  const pt = (i: number, j: number) => {
    const u = u0 + i * step;
    const z = shoreZ(u) + zrs[j]!;
    return [u - cx, groundY(u, z), z];
  };
  const cl = (i: number, j: number) => {
    const u = u0 + i * step;
    const p = pt(i, j);
    return groundColor(u, zrs[j]!, p[1]!, new Color());
  };
  for (let j = 0; j + 1 < zrs.length; j++) {
    for (let i = 0; i < nx; i++) {
      // Flat-coloured per triangle (retro look): average of the corner colours.
      const [a, bb, d, e] = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      const c1 = tmp.copy(cl(i, j)).add(cl(i + 1, j)).add(cl(i + 1, j + 1)).multiplyScalar(1 / 3).clone();
      const c2 = tmp.copy(cl(i, j)).add(cl(i + 1, j + 1)).add(cl(i, j + 1)).multiplyScalar(1 / 3).clone();
      // Wound to face up (+y): toward shore is +z, so a → e is +z and a → b is +x.
      b.tri(a, e, d, c1).tri(a, d, bb, c2);
    }
  }
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

const HOUSE_WALLS = ['#f3f1ea', '#f3f1ea', '#bfc4c7', '#a9d6cf', '#e5d6b2', '#d6e3ea', '#efe6cb', '#9fb8c8', '#c9d7cf'];
const HOUSE_ROOFS = ['#6b7075', '#6b7075', '#7d868d', '#5c6a77', '#8b9087', '#a13a30', '#2f5d8a', '#4f5a52'];
const WINDOW = '#3e5263';
const TRIM = '#f8f8f4';
const STILT = '#4b423a';
const DECK = '#b29d7e';

/** A stilted beach house facing the sea (−z); `detail` adds stilts and porches (the front rows). */
function house(b: LowPoly, r: () => number, x: number, z: number, ground: number, detail: boolean): void {
  const w = 8 + r() * 4;
  const d = 10 + r() * 3;
  const storeys = r() < 0.35 ? 3 : 2;
  const wall = pick(r, HOUSE_WALLS);
  const roof = pick(r, HOUSE_ROOFS);
  const stilts = detail ? 2.4 : 0;
  const base = ground + stilts;
  const top = base + storeys * 3;
  if (detail) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.box(x + sx * (w / 2 - 0.4), ground - 0.5, z + sz * (d / 2 - 0.4), 0.45, stilts + 0.5, 0.45, STILT);
  }
  b.box(x, detail ? base : ground - 0.5, z, w, top - (detail ? base : ground - 0.5), d, wall);
  for (let s = 0; s < storeys; s++) {
    const y = base + s * 3;
    b.box(x, y + 1, z - d / 2 - 0.06, w * 0.72, 1.3, 0.12, WINDOW);
    if (detail && s < 2) {
      // Porch across the sea side with a white rail.
      b.box(x, y - 0.2, z - d / 2 - 1.2, w * 0.9, 0.2, 2.4, DECK);
      b.box(x, y, z - d / 2 - 2.35, w * 0.9, 1.0, 0.12, TRIM);
    }
  }
  const rise = 2.2 + r() * 1.6;
  if (r() < 0.5) b.gable(x, top, z, w + 0.8, d + 0.8, rise, roof, true, wall);
  else b.gable(x, top, z, w + 0.8, d + 0.8, rise, roof, false, wall);
}

/** A mid-rise condo block: flat roof, a window band per storey. */
function condo(b: LowPoly, r: () => number, x: number, z: number, ground: number, w: number, d: number, storeys: number): void {
  const wall = pick(r, ['#f1efe8', '#e6dcc4', '#d9dfe2']);
  const h = storeys * 3.1;
  b.box(x, ground - 0.5, z, w, h + 0.5, d, wall, '#b8b6ae');
  for (let s = 0; s < storeys; s++) {
    b.box(x, ground + s * 3.1 + 0.9, z - d / 2 - 0.08, w * 0.9, 1.4, 0.16, WINDOW);
    b.box(x - w / 2 - 0.08, ground + s * 3.1 + 0.9, z, 0.16, 1.4, d * 0.8, WINDOW);
    b.box(x + w / 2 + 0.08, ground + s * 3.1 + 0.9, z, 0.16, 1.4, d * 0.8, WINDOW);
  }
}

const PIER = { deckY: 5.2, width: 5, bent: 7.5, half: 2.2 };
const PILING = '#3a3430';
const BRACE = '#4d4439';
const PIER_DECK = '#8e7b62';

/** Crystal Pier: deck on bents of two pilings, X-braced across and (desktop) along, railings both sides. */
function pier(b: LowPoly, x: number, z0: number, z1: number, lite: boolean): void {
  const { deckY, width, bent, half } = PIER;
  b.box(x, deckY - 0.45, (z0 + z1) / 2, width, 0.45, z1 - z0, '#6e604d', PIER_DECK);
  const bents: number[] = [];
  for (let z = z0 + 0.6; z <= z1; z += bent) bents.push(z);
  bents.forEach((z, i) => {
    for (const s of [-1, 1]) b.box(x + s * half, -4.6, z, 0.5, deckY + 4.2, 0.5, PILING);
    // Cross-bracing in the bent's plane (faces the camera looking down the beach) …
    b.strut([x - half, deckY - 0.6, z], [x + half, 0.3, z], 0.16, BRACE);
    b.strut([x + half, deckY - 0.6, z], [x - half, 0.3, z], 0.16, BRACE);
    // … and along the sides between bents (the lattice seen from the beach).
    const zn = bents[i + 1];
    if (!lite && zn !== undefined) {
      for (const s of [-1, 1]) {
        b.strut([x + s * half, deckY - 0.6, z], [x + s * half, 0.3, zn], 0.14, BRACE);
        b.strut([x + s * half, 0.3, z], [x + s * half, deckY - 0.6, zn], 0.14, BRACE);
      }
    }
  });
  // Railings: posts and a top rail along both edges.
  for (const s of [-1, 1]) {
    const rx = x + s * (width / 2 - 0.1);
    b.strut([rx, deckY + 1.05, z0], [rx, deckY + 1.05, z1], 0.12, '#cfc6b6');
    for (let z = z0; z <= z1; z += lite ? 7.5 : 3.75) b.box(rx, deckY, z, 0.12, 1.1, 0.12, '#cfc6b6');
  }
}

const GREEN_ROOF = '#2f7a55';
const OCEANIC_WALL = '#f2f0e8';

/** The Oceanic: two storeys under tiered green hip roofs, white trim, window bands; the low pier house joins the pier. */
function oceanic(b: LowPoly, x: number, zr0: number, u: number, lite: boolean): void {
  const g = (dx: number, z: number) => groundY(u + dx, z);
  const sz = shoreZ(u);
  // Pier house: long, low, flat light roof, on the deck level where the pier comes ashore.
  const ph = { z0: sz + zr0 - 26, z1: sz + zr0, w: 10 };
  const phY = PIER.deckY + 3.6;
  b.box(x - 1, g(0, ph.z0) - 0.5, (ph.z0 + ph.z1) / 2, ph.w, phY - g(0, ph.z0) + 0.5, ph.z1 - ph.z0, OCEANIC_WALL, '#e9e7df');
  b.box(x - 1, phY, (ph.z0 + ph.z1) / 2, ph.w + 0.8, 0.35, ph.z1 - ph.z0 + 0.8, TRIM, '#dedcd2');
  for (const s of [-1, 1]) b.box(x - 1 + s * (ph.w / 2 + 0.05), PIER.deckY + 0.9, (ph.z0 + ph.z1) / 2, 0.12, 1.8, ph.z1 - ph.z0 - 2, WINDOW);
  for (let z = ph.z0 + 2; z < ph.z1 - 1 && !lite; z += 4) b.box(x - 1, -4.6, z, ph.w - 1, PIER.deckY + 4.6, 0.4, PILING);
  // Main building: beside the pier house (−x), two storeys, windows all round.
  const mx = x - 19;
  const mz = sz + zr0 + 6;
  const ground = Math.min(g(-19, mz - 11), g(-19, mz + 11));
  const [w1, d1, h1] = [26, 22, PIER.deckY + 3.4];
  const [w2, d2, h2] = [20, 16, 3.4];
  b.box(mx, ground - 0.5, mz, w1, h1 - ground + 0.5, d1, OCEANIC_WALL);
  const band = (w: number, d: number, y: number) => {
    b.box(mx, y, mz - d / 2 - 0.06, w * 0.86, 1.6, 0.12, WINDOW);
    b.box(mx, y, mz + d / 2 + 0.06, w * 0.86, 1.6, 0.12, WINDOW);
    b.box(mx - w / 2 - 0.06, y, mz, 0.12, 1.6, d * 0.8, WINDOW);
    b.box(mx + w / 2 + 0.06, y, mz, 0.12, 1.6, d * 0.8, WINDOW);
  };
  band(w1, d1, PIER.deckY + 0.9);
  if (!lite) band(w1, d1, ground + 1.2);
  // Lower storey: white eave trim, then a green hip roof skirt the upper storey rises out of.
  b.box(mx, h1, mz, w1 + 2.4, 0.35, d1 + 2.4, TRIM);
  b.hip(mx, h1 + 0.35, mz, w1 + 2.4, d1 + 2.4, 2.6, GREEN_ROOF);
  b.box(mx, h1 + 0.35, mz, w2, h2 + 1.6, d2, OCEANIC_WALL);
  band(w2, d2, h1 + 2.4);
  const top = h1 + 0.35 + h2 + 1.6;
  b.box(mx, top, mz, w2 + 2, 0.3, d2 + 2, TRIM);
  b.hip(mx, top + 0.3, mz, w2 + 2, d2 + 2, 4.2, GREEN_ROOF);
  // A seaward wing with its own green hip roof (the restaurant's porch room).
  const wz = mz - d1 / 2 - 5;
  b.box(mx + 3, ground - 0.5, wz, 14, h1 - 2 - ground + 0.5, 10, OCEANIC_WALL);
  b.box(mx + 3, PIER.deckY + 0.4, wz - 5.06, 12, 1.6, 0.12, WINDOW);
  b.box(mx + 3, h1 - 2, wz, 15.6, 0.3, 11.6, TRIM);
  b.hip(mx + 3, h1 - 1.7, wz, 15.6, 11.6, 2.4, GREEN_ROOF);
}

/** Lifeguard stand: white legs, blue seat box, yellow sunshade. A bit oversized so it reads from the break. */
function lifeguard(b: LowPoly, x: number, z: number, ground: number): void {
  const s = 1.5;
  const [hw, hd, ph] = [0.9 * s, 0.9 * s, 2.2 * s];
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.strut([x + dx * hw * 1.25, ground - 0.3, z + dz * hd * 1.25], [x + dx * hw, ground + ph, z + dz * hd], 0.16, '#f6f6f2');
  }
  b.box(x, ground + ph, z, hw * 2.2, 0.18, hd * 2.2, '#f6f6f2');
  b.box(x, ground + ph + 0.18, z + hd * 0.4, hw * 1.6, 0.9 * s, hd * 1.0, '#2f6fd1');
  b.box(x, ground + ph + 0.18, z + hd * 0.95, hw * 1.6, 1.4 * s, 0.14, '#2f6fd1');
  for (const dx of [-1, 1]) b.box(x + dx * hw * 0.9, ground + ph + 0.18, z + hd * 0.9, 0.1, 2.5 * s, 0.1, '#f6f6f2');
  b.hip(x, ground + ph + 0.18 + 2.5 * s, z + hd * 0.4, hw * 2.6, hd * 2.6, 0.5 * s, '#f2c230');
}

/** The white Wrightsville Beach water tower: tall stem, flared neck, round tank. */
function waterTower(b: LowPoly, x: number, z: number, ground: number, lite: boolean): void {
  const n = lite ? 6 : 8;
  const stem = 36;
  b.prism(x, ground - 0.5, z, 2.0, 1.6, stem + 0.5, n, '#ecebe6');
  b.prism(x, ground + stem - 4, z, 1.6, 5, 4.5, n, '#f2f1ec');
  b.ball(x, ground + stem + 5.5, z, 7, n + 2, lite ? 4 : 6, '#f7f7f3');
  b.prism(x, ground + stem + 11.8, z, 0.6, 0, 1.6, 4, '#d9d8d2');
}

/** Everything in one strip chunk: terrain, houses, dunes and (when they fall in it) landmarks. */
export function buildShore(opts: ShoreOptions = {}): { chunks: ShoreChunk[]; landmarks: Landmark[] } {
  const lite = opts.lite ?? false;
  const { span, chunk: L } = SHORE;
  const n = Math.round(span / L);
  const near = Array.from({ length: n }, () => new LowPoly());
  const far = Array.from({ length: n }, () => new LowPoly());
  const landmarks: Landmark[] = [];
  const wrapU = (u: number) => ((u % span) + span) % span;
  const chunkOf = (u: number) => Math.floor(wrapU(u) / L) % n;
  const centreOf = (k: number) => k * L + L / 2;
  /** Builder and local x for an item at strip u (near or far mesh). */
  const at = (u: number, farSide = false): [LowPoly, number] => {
    const k = chunkOf(u);
    let x = wrapU(u) - centreOf(k);
    if (x > span / 2) x -= span;
    return [(farSide ? far : near)[k]!, x];
  };

  // Ground.
  const nearRows = [-45, -20, -10, -6, -3, 0, 4, 8, 14, 25, 40, 52, 58, 62, 66, 70, 74, 79, 84, 88, 92, 100, 111, 118, 140, 165, 171, 190, 200, 205, 210, 218, 240, 258, 266, 280, SHORE.splitZr];
  const farRows = [SHORE.splitZr, 320, 340, 360, 380, 392, 410, 440, 452, 480, 520, 600, 700, 800, SHORE.farZ - SHORE.z];
  for (let k = 0; k < n; k++) {
    const u0 = k * L;
    terrain(near[k]!, u0, u0 + L, centreOf(k), nearRows, lite ? 20 : 10);
    terrain(far[k]!, u0, u0 + L, centreOf(k), farRows, 25);
  }

  // Shore-break foam: a ragged white band where the water meets the sand, and a broken line of
  // whitewater a little offshore. Just above sea level (the water is flat there).
  for (let k = 0; k < n; k++) {
    const b = near[k]!;
    const step = lite ? 10 : 5;
    for (let u = k * L; u < (k + 1) * L - 1e-6; u += step) {
      const [, x0] = at(u + step / 2);
      const xa = x0 - step / 2;
      const xb = x0 + step / 2;
      const [za, zb] = [shoreZ(u), shoreZ(u + step)];
      const wa = 2.5 + 3.5 * noise(u, 0, 7);
      const wb = 2.5 + 3.5 * noise(u + step, 0, 7);
      b.quad([xa, 0.06, za - wa], [xa, 0.06, za - 0.4], [xb, 0.06, zb - 0.4], [xb, 0.06, zb - wb], COL.foam);
      // Shore break: a ragged line of whitewater rolling in, thick where it is breaking and thin between.
      const sa = noise(u, 3, 9);
      const sb = noise(u + step, 3, 9);
      const [oa, ob] = [12 + 4 * noise(u, 5, 11), 12 + 4 * noise(u + step, 5, 11)];
      b.quad([xa, 0.05, za - oa - 0.6 - 3 * sa], [xa, 0.05, za - oa], [xb, 0.05, zb - ob], [xb, 0.05, zb - ob - 0.6 - 3 * sb], sa + sb > 1 ? COL.foam : COL.seaFoam);
    }
  }

  // Landmark keep-outs (strip u ranges) for houses, condos and walkways.
  const sets = SHORE.landmarkU;
  const blocked = (u: number, zr: number, half: number) =>
    sets.some((U) => {
      const d = (((u - U) % span) + span * 1.5) % span - span / 2;
      if (zr < 105 && d > -45 - half && d < 14 + half) return true; // the Oceanic and the pier
      if (zr > 140 && zr < 200 && Math.abs(d + 140) < 12 + half) return true; // water tower
      if (zr > 90 && zr < 175 && Math.abs(d - 520) < 26 + half) return true; // resort tower
      return false;
    });

  // Dunes: sea-oat tufts, sand fences along the dune toe, walkways from the houses over the dunes.
  const r = rng(1337);
  for (let u = 0; u < span; u += lite ? 4 : 2) {
    if (r() < 0.35) continue;
    const zr = 60 + r() * 28;
    const z = shoreZ(u) + zr;
    const [b, x] = at(u);
    const h = 0.9 + r() * 0.9;
    b.prism(x, groundY(u, z) - 0.2, z, 0.9 + r() * 0.8, 0, h + 0.2, 3, pick(r, ['#6f8a3c', '#8c9a4a', '#a3a05a', '#5f7a3a']), r() * TAU);
  }
  for (let u = 0; u < span; u += 18) {
    if (r() < 0.4 || blocked(u, 60, 10)) continue;
    const len = 8 + r() * 10;
    const z = shoreZ(u) + 59.5;
    const [b, x] = at(u + len / 2);
    b.box(x, groundY(u + len / 2, z) - 0.3, z, len, 1.2, 0.12, '#a89474');
  }
  for (let u = 20; u < span; u += 45 + Math.floor(r() * 25)) {
    if (blocked(u, 60, 4)) continue;
    const [b, x] = at(u);
    const z0 = shoreZ(u) + 54;
    const z1 = shoreZ(u) + 93;
    const y = 4.6;
    b.box(x, y - 0.25, (z0 + z1) / 2, 1.8, 0.25, z1 - z0, DECK);
    if (!lite) for (const s of [-1, 1]) b.strut([x + s * 0.9, y + 0.9, z0 + 4], [x + s * 0.9, y + 0.9, z1], 0.1, '#bfb2a0');
    for (let z = z0 + 2; z < z1; z += 8) for (const s of [-1, 1]) b.box(x + s * 0.75, groundY(u, z) - 0.3, z, 0.25, y - 0.25 - groundY(u, z) + 0.3, 0.25, STILT);
    // Steps down to the beach.
    b.box(x, groundY(u, z0 - 2) - 0.2, z0 - 1.5, 1.8, y - groundY(u, z0 - 2) - 0.2, 3, DECK);
  }

  // Beach houses: the front rows on stilts with porches, the back rows simpler; a few condo blocks.
  const rows = lite ? [97, 130] : [97, 130, 152, 184];
  rows.forEach((zr, row) => {
    const rr = rng(100 + row);
    let u = rr() * 8;
    while (u < span) {
      const half = 6;
      const z = shoreZ(u) + zr + (rr() - 0.5) * 2;
      if (!blocked(u, zr, half)) {
        const [b, x] = at(u);
        if (row > 0 && rr() < 0.06) {
          const w = 26 + rr() * 10;
          condo(b, rr, x + w / 2 - 6, z, groundY(u, z), w, 15, 4 + Math.floor(rr() * 2));
          u += w + 4;
          continue;
        }
        house(b, rr, x, z, groundY(u, z), row < (lite ? 1 : 2));
      }
      u += 13 + rr() * 4 + (rr() < 0.08 ? 10 : 0);
    }
  });

  // Mainland: low, scattered buildings fading into the haze.
  const rm = rng(4242);
  for (let u = 0; u < span; u += 9 + rm() * 14) {
    const zr = 470 + rm() * 260;
    const z = shoreZ(u) + zr;
    const [b, x] = at(u, true);
    const tall = rm() < 0.06;
    b.box(x, groundY(u, z) - 0.5, z, 8 + rm() * 14, (tall ? 14 : 4) + rm() * 6, 8 + rm() * 10, pick(rm, ['#e9e6dc', '#c9ccc8', '#d8cdb4', '#aeb6b0']), '#9a9c98');
  }
  // Docks into Banks Channel behind the houses.
  if (!lite) {
    for (let u = 30; u < span; u += 55 + rm() * 40) {
      const [b, x] = at(u);
      const z = shoreZ(u) + 206;
      b.box(x, 0.3, z + 10, 1.6, 0.3, 22, DECK);
      if (rm() < 0.5) b.box(x + 4, 0.1, z + 18, 2.4, 1.1, 7, '#f4f4f2', '#dfe6ea');
    }
  }

  // The landmark sets.
  for (const U of sets) {
    const sz = shoreZ(U);
    // Pier: from the Oceanic's pier house out to just shoreward of the break.
    {
      const [b, x] = at(U);
      pier(b, x, SHORE.pierEndZ, sz + 32, lite);
      landmarks.push({ kind: 'pier', u: U, z: SHORE.pierEndZ });
      oceanic(b, x, 58, U, lite);
      landmarks.push({ kind: 'oceanic', u: U - 19, z: sz + 64 });
    }
    {
      const u = U + 34;
      const z = shoreZ(u) + 30;
      const [b, x] = at(u);
      lifeguard(b, x, z, groundY(u, z));
      landmarks.push({ kind: 'lifeguard', u, z });
    }
    {
      const u = U - 140;
      const z = shoreZ(u) + 178;
      const [b, x] = at(u);
      waterTower(b, x, z, groundY(u, z), lite);
      landmarks.push({ kind: 'waterTower', u, z });
    }
    {
      const u = U + 520;
      const z = shoreZ(u) + 132;
      const [b, x] = at(u);
      const g = groundY(u, z);
      // A Shell-Island-like resort tower: eleven storeys, a slimmer stair core on top.
      b.box(x, g - 0.5, z, 44, 11 * 3.2 + 0.5, 18, '#efe7d6', '#c9c3b6');
      for (let s = 0; s < 11; s++) {
        b.box(x, g + s * 3.2 + 1, z - 9.08, 40, 1.4, 0.16, WINDOW);
        if (!lite) for (const sx of [-1, 1]) b.box(x + sx * 22.08, g + s * 3.2 + 1, z, 0.16, 1.4, 14, WINDOW);
      }
      b.box(x - 12, g + 11 * 3.2, z, 8, 4, 8, '#e3dccb');
      landmarks.push({ kind: 'resort', u, z });
    }
  }

  return {
    chunks: near.map((b, k) => ({ worldX: centreOf(k), near: b.build(), far: far[k]!.build() })),
    landmarks,
  };
}
