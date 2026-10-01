import { BufferAttribute, BufferGeometry, Color, DataTexture, MeshLambertMaterial, RepeatWrapping, RGBAFormat, type Texture } from 'three';
import { retroTexture } from '@/retro/retroMaterial';
import { SURF_CONFIG } from '../config';
import { clamp, smoothstep } from '../math/scalar';
import { SWELL } from '../wave/sections';
import { seaReflection } from './sky';

/**
 * z of the trough, fixed at import from the configured wave height: the ?debug height slider moves the
 * trough but not the clear band or the sandbar (debug only; make it a uniform if H ever changes in play).
 */
const TROUGH_Z = SWELL[0]![0] * SURF_CONFIG.wave.height;

/**
 * The shallows in front of the breaking wave (frame z, +z toward shore): the water is shallowest just
 * shoreward of the trough — the sandbar the wave breaks on — and clear there, so the rider sees the
 * sand (and the sea life on it) right under and ahead of them. Toward the beach and out behind the
 * wave the water is as before.
 */
export const SHALLOWS = {
  /** z of the trough (every section starts at 3 H). */
  troughZ: TROUGH_Z,
  /** Clarity rises from 0 at clearFrom to full at clearFull, and fades out again from fadeFrom to fadeTo (z, m). */
  clearFrom: TROUGH_Z - 6,
  clearFull: TROUGH_Z + 3,
  fadeFrom: TROUGH_Z + 22,
  fadeTo: TROUGH_Z + 55,
  /** Up the face, clarity is gone by this height (m above sea level): the face keeps its colour. */
  faceRise: 0.6,
  /** Opacity of the shallows seen from above (the open sea's is SEA.alpha = 0.7): a little see-through. */
  alpha: 0.5,
  /** Shallow water turns opaque with view distance over [near, far] (m) instead of the deep water's [8, 35]. */
  opaqueNear: 12,
  opaqueFar: 45,
  /** Share of the near-water Fresnel opacity / sky reflection the clear shallows lose. */
  fresnelCut: 0.4,
  reflectCut: 0.35,
  /** The sand ripple texture's tile (m). */
  rippleTile: 6,
} as const;

/** How clear the water is at frame z and rest height y (0 = as the open sea, 1 = clear shallows). */
export function shallowClarity(z: number, y: number): number {
  const s = SHALLOWS;
  return smoothstep(s.clearFrom, s.clearFull, z) * (1 - smoothstep(s.fadeFrom, s.fadeTo, z)) * (1 - smoothstep(0, s.faceRise, y));
}

/**
 * Opacity of clean (foam-free) water: its vertex alpha, lowered to SHALLOWS.alpha by clarity, then
 * opaque at grazing angles (Schlick `fres`) and with view distance `dist`. Clarity pushes the distance
 * ramp out and softens the near-water Fresnel; grazing water stays opaque. The CPU twin of the
 * opacity lines in the wave shader (waveMaterial), which reads the same constants.
 */
export function waterOpacity(alpha: number, fres: number, dist: number, clarity: number): number {
  const s = SHALLOWS;
  const a = alpha + (s.alpha - alpha) * clarity;
  const near = smoothstep(8 + (s.opaqueNear - 8) * clarity, 35 + (s.opaqueFar - 35) * clarity, dist);
  const f = fres * (1 - s.fresnelCut * clarity * (1 - fres));
  return a + (1 - a) * Math.max(f, near);
}

const f = (v: number) => v.toFixed(3);
/** GLSL twins of shallowClarity / waterOpacity's constants (fragment shader). */
export const SHALLOWS_GLSL = /* glsl */ `
float shallowClarity(float z, float y) {
  return smoothstep(${f(SHALLOWS.clearFrom)}, ${f(SHALLOWS.clearFull)}, z) * (1.0 - smoothstep(${f(SHALLOWS.fadeFrom)}, ${f(SHALLOWS.fadeTo)}, z)) * (1.0 - smoothstep(0.0, ${f(SHALLOWS.faceRise)}, y));
}
`;

/**
 * Cross-shore profile of the sand bed under the shallows: [z, y]. The sandbar crests a few metres
 * shoreward of the trough and sinks to the sea floor (−4.35) seaward under the wave and shoreward
 * toward the reef. Its ends sit just above the floor, in the floor's colour (no edge to see).
 */
export const SAND_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-24, -4.3],
  [-10, -3.55],
  [0, -2.45],
  [5, -1.85],
  [11, -1.55],
  [18, -1.75],
  [28, -2.4],
  [40, -3.25],
  [54, -3.95],
  [72, -4.3],
];

/** Height of the sand bed at frame z (linear between the profile rows, like the mesh). */
export function sandY(z: number): number {
  const P = SAND_PROFILE;
  if (z <= P[0]![0]) return P[0]![1];
  for (let i = 1; i < P.length; i++) {
    const [z1, y1] = P[i]!;
    if (z <= z1) {
      const [z0, y0] = P[i - 1]!;
      return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
    }
  }
  return P[P.length - 1]![1];
}

/** Along-shore extent of the sand bed (frame x, m): far past where the water is clear (≤ ~55 m). */
const BED_X = [-320, -120, -40, 0, 40, 120, 220, 450];
/** Sunlit sand under clear water reads brighter than the low sun lights it (colours > 1 are fine: linear). */
// Cool and dim: warm, bright sand under the teal reads as a dry flat, not water.
const SAND = { shallow: new Color('#d6d0a8'), deep: new Color('#9fbfae') };
/** Sunlight through clear shallow water: the sand's own glow (share of its colour) and the caustics' strength. */
const SAND_GLOW = 0.15;
const CAUSTIC = 0.14;

/**
 * The sand bed: one strip along the break, lit pale sand on the bar, cooling to the floor's colour with
 * depth. uv = (x, z) / rippleTile for the ripple map (scrolled by Environment with the frame travel).
 */
export function buildSandbedGeometry(floorColor: Color): BufferGeometry {
  const rows = SAND_PROFILE.length;
  const cols = BED_X.length;
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const c = new Color();
  for (let i = 0; i < cols; i++) {
    for (let r = 0; r < rows; r++) {
      const v = i * rows + r;
      const [z, y] = SAND_PROFILE[r]!;
      const x = BED_X[i]!;
      pos.set([x, y, z], v * 3);
      const depth = smoothstep(-1.6, -3.6, y);
      c.copy(SAND.shallow).lerp(SAND.deep, depth).lerp(floorColor, smoothstep(-3.6, -4.25, y));
      col.set([c.r, c.g, c.b], v * 3);
      uv.set([x / SHALLOWS.rippleTile, z / SHALLOWS.rippleTile], v * 2);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < cols - 1; i++) {
    for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r;
      const b = (i + 1) * rows + r;
      // Facing up (+y): (b − a) along +x, (a+1 − a) along +z → winding a, a+1, b.
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 64×64 sand ripples (greyscale, multiplies the sand colour): eight wavy, sharp-crested ripples per
 * tile running along the break (crests along x), plus a little grain. Periodic in both directions.
 */
export function makeRippleTexture(): DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  const TAU = Math.PI * 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const wob = 0.35 * Math.sin((TAU * x) / N) + 0.18 * Math.sin((TAU * 3 * x) / N + 1.3);
      const phase = (8 * y) / N + wob;
      // Ripples stronger and fainter across the tile (both periods divide it: still seamless).
      const amp = 0.55 + 0.45 * Math.sin((TAU * x) / N + (TAU * 2 * y) / N + 0.7);
      const ripple = amp * Math.pow(0.5 + 0.5 * Math.sin(TAU * phase), 3);
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const grain = h - Math.floor(h);
      const v = clamp(0.84 + 0.16 * ripple - 0.05 * (1 - ripple) + 0.06 * (grain - 0.5), 0, 1);
      const b = Math.round(v * 255);
      data.set([b, b, b, 255], (y * N + x) * 4);
    }
  }
  const tex = new DataTexture(data, N, N, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  retroTexture(tex);
  tex.needsUpdate = true;
  return tex;
}

/**
 * The caustics repeat along the beach every this many metres (their x frequencies, 1.5 and 1.8 rad/m,
 * are multiples of 0.3): the travel fed to them wraps there, so the shader's numbers stay small on
 * a long ride (phones' mediump floats).
 */
export const CAUSTIC_REPEAT = (2 * Math.PI) / 0.3;

export interface SandUniforms {
  /** Frame travel (m, wrapped at CAUSTIC_REPEAT): the caustics are fixed to the reef like the ripples. */
  uTravel: { value: number };
  /** Caustics clock (s, the water clock: still on pause); their rates (0.9, 0.7 rad/s) repeat every 20π s, so it may wrap there. */
  uTime: { value: number };
}

/**
 * The sand's material: vertex colours × the ripple map, lit, plus sunlight through clear shallow water
 * — a glow of its own colour and moving caustics (two warped sine fields; bright where they cancel),
 * both fading out with depth (by the vertex height), and off in the underwater cut.
 */
export function createSandMaterial(ripples: Texture): { material: MeshLambertMaterial; uniforms: SandUniforms } {
  const uniforms: SandUniforms = { uTravel: { value: 0 }, uTime: { value: 0 } };
  const material = new MeshLambertMaterial({ vertexColors: true, map: ripples });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, seaReflection);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSand;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSand = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTravel;\nuniform float uTime;\nuniform float uReflect;\nvarying vec3 vSand;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    float lit = smoothstep(-3.6, -1.6, vSand.y);
    vec2 q = vec2(vSand.x + uTravel, vSand.z) * 1.5;
    float ca = sin(q.x + 1.1 * sin(q.y * 1.7 + uTime * 0.9));
    float cb = sin(q.y * 1.3 + 1.2 * sin(q.x * 1.2 - uTime * 0.7));
    float caustic = pow(clamp(1.0 - 0.5 * abs(ca + cb), 0.0, 1.0), 8.0);
    // Sunlight through the surface: none in the underwater cut (uReflect = 0), like the foam's glow.
    totalEmissiveRadiance += uReflect * lit * (${f(SAND_GLOW)} * diffuseColor.rgb + ${f(CAUSTIC)} * caustic * vec3(0.95, 1.0, 0.9));
  }`,
      );
  };
  material.customProgramCacheKey = () => 'shallows-sand';
  return { material, uniforms };
}
