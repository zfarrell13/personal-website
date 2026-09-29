import type { Vector3 } from 'three';
import type { Side } from '../config';

/** +1 for a RIGHT (canonical frame), −1 for a LEFT (x mirrored). */
export const sideSign = (side: Side): 1 | -1 => (side === 'right' ? 1 : -1);

/** Frame (canonical) → view coordinates for a side. The frame group uses scale.x = sideSign. */
export function frameToView(p: Vector3, side: Side, out: Vector3): Vector3 {
  return out.set(p.x * sideSign(side), p.y, p.z);
}
