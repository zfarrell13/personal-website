import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { cameraGoal } from '../camera/CameraRig';
import { SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { buildWaveGeometry, columnsX } from './waveGeometry';

/**
 * The barrel as the tube camera sees it: an open tunnel. Rays from the tube-camera pose toward
 * the exit (down the line, level to slightly up, across the mouth) reach clear air — the eye is
 * open, no curtain — while rays up and over the rider hit the lip (it IS a barrel).
 */
describe('open barrel from the tube camera', () => {
  const params = structuredClone(SURF_CONFIG.wave);
  const shape = new WaveShape(params);
  const { columns, rows } = SURF_CONFIG.mesh;
  const mesh = new Mesh(buildWaveGeometry(shape, columnsX(columns, params.xMin, params.xMax), rows), new MeshBasicMaterial({ side: DoubleSide }));
  mesh.updateMatrixWorld();
  const ray = new Raycaster();

  /** Distance to the first wave hit along dir (Infinity if none within `far`). */
  const hitDistance = (from: Vector3, dir: Vector3, far: number): number => {
    ray.set(from, dir.clone().normalize());
    ray.far = far;
    return ray.intersectObject(mesh)[0]?.distance ?? Infinity;
  };

  /** The tube-camera goal for a rider on the face at column x, at `frac` of the crest height. */
  const tubePose = (x: number, frac: number) => {
    let t = 0;
    while (shape.profile(x, t).y < frac * shape.crestY(x)) t += 0.001;
    const p = shape.profile(x, t);
    const normal = shape.normal(x, t);
    return cameraGoal({ p, normal, heading: new Vector3(1, 0, 0), mode: 'riding', launchKind: null }, 'left', 'tube', shape, { pos: new Vector3(), look: new Vector3() });
  };

  const cases = [-1, -2, -3].flatMap((x) => [0.2, 0.4].map((frac) => [x, frac] as const));

  it.each(cases)('rider at x = %d, %d of the crest: the eye ahead is open for 15 m', (x, frac) => {
    const pose = tubePose(x, frac);
    // Straight down the line and 6° toward shore, level and 3° up: the middle of the eye.
    const dirs: Vector3[] = [];
    for (const yaw of [0, 0.1]) for (const up of [0, 0.05]) dirs.push(new Vector3(Math.cos(yaw), up, Math.sin(yaw)));
    for (const d of dirs) expect(hitDistance(pose.pos, d, 15), `dir ${d.toArray().map((v) => v.toFixed(2))}`).toBe(Infinity);
  });

  it.each(cases)('rider at x = %d, %d of the crest: the lip arcs overhead', (x, frac) => {
    const pose = tubePose(x, frac);
    expect(hitDistance(pose.pos, new Vector3(0, 1, 0), 4)).toBeLessThan(4);
    expect(hitDistance(pose.pos, new Vector3(0, 1, 0.8), 5)).toBeLessThan(5);
  });
});
