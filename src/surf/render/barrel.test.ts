import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { cameraGoal } from '../camera/CameraRig';
import { SURF_CONFIG } from '../config';
import { WaveShape } from '../wave/WaveShape';
import { buildWaveGeometry, columnsX } from './waveGeometry';

const EYE_UP = (5 * Math.PI) / 180;
/** Desktop and phone (coarse-pointer) wave meshes. */
const MESHES = [
  ['desktop', SURF_CONFIG.mesh.columns, SURF_CONFIG.mesh.rows],
  ['phone', 112, 44],
] as const;

/**
 * The barrel as the tube camera sees it: an open tunnel. From the real tube-camera pose, with the
 * rider anywhere in the tube's height band, a ray straight down the line 5° up reaches
 * clear air within 15 m — the eye is open, no curtain — while rays up and over the rider hit the lip
 * (it IS a barrel).
 */
describe.each(MESHES)('open barrel from the tube camera (%s mesh)', (_name, columns, rows) => {
  const params = structuredClone(SURF_CONFIG.wave);
  const shape = new WaveShape(params);
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

  // Rider heights up to 0.55 of the crest (the tube counts up to tubeHeightFrac 0.6).
  const cases = [-4, -3, -2, -1].flatMap((x) => [0.2, 0.4, 0.5, 0.55].map((frac) => [x, frac] as const));

  it.each(cases)('rider at x = %d, %d of the crest: the eye ahead is open for 15 m at 5° up', (x, frac) => {
    const pose = tubePose(x, frac);
    expect(hitDistance(pose.pos, new Vector3(1, Math.tan(EYE_UP), 0), 15)).toBe(Infinity);
  });

  it.each(cases)('rider at x = %d, %d of the crest: the lip arcs overhead', (x, frac) => {
    const pose = tubePose(x, frac);
    expect(hitDistance(pose.pos, new Vector3(0, 1, 0), 4)).toBeLessThan(4);
    expect(hitDistance(pose.pos, new Vector3(0, 1, 0.8), 5)).toBeLessThan(5);
  });
});
