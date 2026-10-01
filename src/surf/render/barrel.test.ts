import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { CameraRig } from '../camera/CameraRig';
import type { SurferState } from '../physics/Surfer';
import { SURF_CONFIG } from '../config';
import { applyPeakToVertex } from '../wave/peak';
import { WaveShape } from '../wave/WaveShape';
import { buildWaveGeometry, columnsX } from './waveGeometry';
import { LIP_LIFT, LIP_THROW, lipOffset } from './waveMaterial';

/** 5.5°: the worst pose (x −4, 0.55 of the crest) stays clear to ≈ 5.6–5.7° at rest and through the lip animation (above the 5° floor). */
const EYE_UP = (5.5 * Math.PI) / 180;
/** Desktop and phone (coarse-pointer) wave meshes. */
const MESHES = [
  ['desktop', SURF_CONFIG.mesh.columns, SURF_CONFIG.mesh.rows],
  ['phone', 112, 44],
] as const;
/**
 * The lip animation (waveMaterial's lipOffset) at rest, at several water-clock times, and with every
 * lip vertex thrown fully up and out at once ('max', the most OPEN state: the animation only moves the
 * lip up and away from the face). The binding cases are the lip at rest (null) and mid-throw, ≈ 5.6–5.7°
 * clear against 6.1° at 'max'. The eye stays open in every state.
 */
const LIP_TIMES = [null, 0.21, 0.8, 1.52, 'max'] as const;
/**
 * Playtest 5: a section peak pitches at the curl and blends back into the wave from there. The most it
 * has left when the surge ends (the shortest surge, minSurge, then the ramp down) is
 * height × (1 − smoothstep(minSurge / (minSurge + ramp))): the barrel at the curl that much taller.
 */
const PEAK_AT_CURL = (() => {
  const s = SURF_CONFIG.peak.minSurge / (SURF_CONFIG.peak.minSurge + SURF_CONFIG.sections.ramp);
  return SURF_CONFIG.peak.height * (1 - s * s * (3 - 2 * s));
})();
const CASES = [...MESHES.flatMap((m) => LIP_TIMES.map((time) => [...m, time] as const)), [...MESHES[0], 'peak'] as const];

/**
 * The barrel as the tube camera sees it: an open tunnel. From the real tube-camera pose, with the
 * rider anywhere in the tube's height band, a ray straight down the line 5.5° up reaches
 * clear air within 15 m — the eye is open, no curtain — while rays up and over the rider hit the lip
 * (it IS a barrel).
 */
// Raycasting two full ocean meshes × 5 lip states is heavy: room for a loaded parallel run.
describe.each(CASES)('open barrel from the tube camera (%s mesh %i × %i, lip animated at t = %s)', { timeout: 20_000 }, (_name, columns, rows, lipTime) => {
  const params = structuredClone(SURF_CONFIG.wave);
  const shape = new WaveShape(params);
  const geo = buildWaveGeometry(shape, columnsX(columns, params.xMin, params.xMax), rows);
  if (lipTime === 'peak') {
    // The shader's peak on the CPU (applyPeakToVertex, the same formula), and in the shape the camera reads.
    shape.setPeak(0, PEAK_AT_CURL, SURF_CONFIG.peak.width);
    const pos = geo.getAttribute('position');
    const v = { x: 0, y: 0 };
    for (let i = 0; i < pos.count; i++) {
      v.x = pos.getX(i);
      v.y = pos.getY(i);
      applyPeakToVertex(shape.peak, v);
      pos.setY(i, v.y);
    }
    geo.computeBoundingSphere();
  } else if (lipTime !== null) {
    // Apply the vertex shader's lip animation on the CPU (same formula, lipOffset).
    const pos = geo.getAttribute('position');
    const lip = geo.getAttribute('aLip');
    const d = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      if (lipTime === 'max') d.set(0, LIP_LIFT, LIP_THROW).multiplyScalar(lip.getX(i));
      else lipOffset(pos.getX(i), lip.getX(i), lipTime, d);
      pos.setXYZ(i, pos.getX(i) + d.x, pos.getY(i) + d.y, pos.getZ(i) + d.z);
    }
    geo.computeBoundingSphere();
  }
  const mesh = new Mesh(geo, new MeshBasicMaterial({ side: DoubleSide }));
  mesh.updateMatrixWorld();
  const ray = new Raycaster();

  /** Distance to the first wave hit along dir (Infinity if none within `far`). */
  const hitDistance = (from: Vector3, dir: Vector3, far: number): number => {
    ray.set(from, dir.clone().normalize());
    ray.far = far;
    return ray.intersectObject(mesh)[0]?.distance ?? Infinity;
  };

  /**
   * The tube camera's actual pose (the rig's, settled: the goal moved in / lifted into the barrel's air
   * as it finds its spot) for a rider held on the face at column x, at `frac` of the crest height.
   */
  const tubePose = (x: number, frac: number) => {
    let t = 0;
    while (shape.profile(x, t).y < frac * shape.crestY(x)) t += 0.001;
    const p = shape.profile(x, t);
    const normal = shape.normal(x, t);
    const s = { p, normal, heading: new Vector3(1, 0, 0), v: new Vector3(), turnRate: 0, stanceFlipped: false, mode: 'riding', launchKind: null, inTube: true } as unknown as SurferState;
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, shape);
    rig.snap(s, 'left');
    for (let i = 0; i < 60; i++) rig.update(s, p, 'left', false, 1 / 60);
    expect(rig.shot).toBe('tube');
    return { pos: rig.pos.clone(), look: rig.look.clone() };
  };

  // Rider heights up to 0.55 of the crest (the tube counts up to tubeHeightFrac 0.6).
  const cases = [-4, -3, -2, -1].flatMap((x) => [0.2, 0.4, 0.5, 0.55].map((frac) => [x, frac] as const));

  it.each(cases)('rider at x = %d, %d of the crest: the eye ahead is open for 15 m at 5.5° up', (x, frac) => {
    const pose = tubePose(x, frac);
    expect(hitDistance(pose.pos, new Vector3(1, Math.tan(EYE_UP), 0), 15)).toBe(Infinity);
  });

  it.each(cases)('rider at x = %d, %d of the crest: the lip arcs overhead', (x, frac) => {
    const pose = tubePose(x, frac);
    expect(hitDistance(pose.pos, new Vector3(0, 1, 0), 4)).toBeLessThan(4);
    expect(hitDistance(pose.pos, new Vector3(0, 1, 0.8), 5)).toBeLessThan(5);
  });
});
