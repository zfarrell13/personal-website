import { Vector3 } from 'three';
import type { WaveParam, WaveShape } from '../wave/WaveShape';

const sx = new Vector3();
const st = new Vector3();
const n = new Vector3();
const e1 = new Vector3();
const eUp = new Vector3();

/**
 * The board's yaw in the face (rad): the angle of `heading` from along the wave (e1, +x) toward up
 * the face (eUp) at surface param `param`. Unlike the 3D heading, it does not move when the board
 * only follows the surface (a face steepening under it): a change in it is a turn. For tests and probes.
 */
export function faceYaw(wave: WaveShape, param: WaveParam, heading: Vector3): number {
  wave.tangents(param.x, param.t, sx, st);
  n.crossVectors(sx, st).normalize();
  e1.copy(sx).normalize();
  eUp.crossVectors(n, e1).normalize();
  return Math.atan2(heading.dot(eUp), heading.dot(e1));
}
