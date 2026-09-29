import type { Vector3 } from 'three';
import type { Side } from '../config';

/**
 * +1 for a LEFT (canonical frame), −1 for a RIGHT (x mirrored). The canonical wave peels toward +x;
 * a surfer facing the beach (+z) with +y up has their right hand toward −x, so a RIGHT (peeling to
 * the surfer's right) is the mirrored frame.
 */
export const sideSign = (side: Side): 1 | -1 => (side === 'left' ? 1 : -1);

/** Frame (canonical) → view coordinates for a side. The frame group uses scale.x = sideSign. */
export function frameToView(p: Vector3, side: Side, out: Vector3): Vector3 {
  return out.set(p.x * sideSign(side), p.y, p.z);
}
