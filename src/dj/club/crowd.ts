import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { retroMaterial } from '@/retro/retroMaterial';

export interface CrowdBounds {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}
export const CROWD_BOUNDS: CrowdBounds = { xMin: -6.5, xMax: 6.5, zMin: -9, zMax: -2 };
export const CROWD_COUNT = 150;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Dancer {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  /** beat phase offset 0..0.25, bounce amplitude 0.6..1.4, colour index. */
  phase: number;
  amp: number;
  hue: number;
}

/** Deterministic jittered-grid placement, facing the booth (+z). */
export function crowdLayout(count = CROWD_COUNT, seed = 7, b: CrowdBounds = CROWD_BOUNDS): Dancer[] {
  const rnd = mulberry32(seed);
  const cols = Math.ceil(Math.sqrt((count * (b.xMax - b.xMin)) / (b.zMax - b.zMin)));
  const rows = Math.ceil(count / cols);
  const dx = (b.xMax - b.xMin) / cols;
  const dz = (b.zMax - b.zMin) / rows;
  const out: Dancer[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({
      x: b.xMin + (c + 0.2 + rnd() * 0.6) * dx,
      z: b.zMin + (r + 0.2 + rnd() * 0.6) * dz,
      rotY: (rnd() - 0.5) * 0.8,
      scale: 0.9 + rnd() * 0.25,
      phase: rnd() * 0.25,
      amp: 0.6 + rnd() * 0.8,
      hue: rnd(),
    });
  }
  return out;
}

/** One merged low-poly dancer; arm vertices carry aArm = 1. */
export function dancerGeometry(): THREE.BufferGeometry {
  const part = (w: number, h: number, d: number, x: number, y: number, arm: number) => {
    const box = new THREE.BoxGeometry(w, h, d);
    const g = box.toNonIndexed();
    box.dispose();
    g.translate(x, y, 0);
    g.setAttribute('aArm', new THREE.Float32BufferAttribute(new Array<number>(g.attributes.position!.count).fill(arm), 1));
    g.deleteAttribute('uv');
    return g;
  };
  const parts = [
    part(0.16, 0.8, 0.18, -0.11, 0.4, 0), // legs
    part(0.16, 0.8, 0.18, 0.11, 0.4, 0),
    part(0.44, 0.62, 0.24, 0, 1.12, 0), // torso
    part(0.24, 0.26, 0.24, 0, 1.58, 0), // head
    part(0.12, 0.6, 0.14, -0.3, 1.15, 1), // arms
    part(0.12, 0.6, 0.14, 0.3, 1.15, 1),
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('dancer geometry merge failed');
  return merged;
}

export interface CrowdUniforms {
  uBeatPhase: { value: number };
  uEnergy: { value: number };
  uDrop: { value: number };
  uTime: { value: number };
}

const CROWD_DECLS_GLSL = /* glsl */ `uniform float uBeatPhase;
uniform float uEnergy;
uniform float uDrop;
uniform float uTime;
attribute vec3 aOffset;
attribute float aArm;
`;

/** Runs after <begin_vertex> in object space; aOffset = (phase, amp, hue). */
const BOUNCE_GLSL = /* glsl */ `
float ph = uBeatPhase + aOffset.x;
float bounce = abs(sin(3.14159265 * ph)) * (0.04 + 0.22 * uEnergy) * aOffset.y;
float idle = sin(uTime * 1.3 + aOffset.x * 25.0) * 0.025;
float live = smoothstep(0.0, 0.12, uEnergy + uDrop); // eased: no snap between sway and bounce
transformed.y += mix(idle, bounce, live) + uDrop * 0.3 * aOffset.y;
transformed.y += aArm * (uDrop * 0.55 + uEnergy * 0.18 * abs(sin(6.2831853 * ph)));
transformed.x += aArm * sign(position.x) * uDrop * 0.08;
`;

export interface Crowd {
  mesh: THREE.InstancedMesh;
  /** Write these every frame from the ClubDirector state (beatPhase, energy, drop) and scene time. */
  uniforms: CrowdUniforms;
  dispose(): void;
}

/**
 * Instanced dancers (one draw call). The vertex shader bounces them on the master
 * beat with per-dancer phase/amplitude, sways them when idle and raises hands on
 * the drop. The material chains onto retroMaterial so dancers get PS2 vertex snap.
 */
export function createCrowd(count = CROWD_COUNT): Crowd {
  const geo = dancerGeometry();
  const dancers = crowdLayout(count);
  const offsets = new Float32Array(count * 3);
  dancers.forEach((d, i) => offsets.set([d.phase, d.amp, d.hue], i * 3));
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  const uniforms: CrowdUniforms = { uBeatPhase: { value: 0 }, uEnergy: { value: 0 }, uDrop: { value: 0 }, uTime: { value: 0 } };
  const mat = retroMaterial(new THREE.MeshLambertMaterial({ flatShading: true }));
  const retroHook = mat.onBeforeCompile;
  const retroKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    retroHook.call(mat, shader, renderer); // adds the snap after <project_vertex>
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      CROWD_DECLS_GLSL + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${BOUNCE_GLSL}`);
  };
  mat.customProgramCacheKey = () => `${retroKey()}|crowd`;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'crowd';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  dancers.forEach((d, i) => {
    q.setFromAxisAngle(up, d.rotY);
    m.compose(p.set(d.x, 0, d.z), q, s.setScalar(d.scale));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHSL(d.hue, 0.45, 0.35));
  });
  // the shader moves vertices beyond the static bounds, so skip frustum culling
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms,
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
