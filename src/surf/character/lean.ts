import { Vector3 } from 'three';
import { DEG, smoothstep } from '../math/scalar';

/**
 * Lip lean (playtest 5: "the steeper the face, the further he should be leaning back (away from the
 * wave)"; asked which way: "Out, away from the wave"). On a steep face the riding body lays back off
 * the face toward the open air and the shore — the upper body tipped back past the surface normal,
 * away from world up, weight on the back foot, like a big top turn — by LEAN_MAX × smoothstep(LEAN_FROM,
 * 1, steepness): ≈ 0 on gentle faces, 35° extra on a vertical (or overhanging) one, continuous from zero.
 * It applies in every heading (along the wave it tips the body off the face; running up the face, back
 * over the tail and off it) and comes on top of the rail bank. Character draws it (pivoting on planted,
 * flat feet); the camera's framing guard (CameraRig.riderUp) models it.
 */
export const LEAN_MAX = 35 * DEG;
export const LEAN_FROM = 0.2;

const UP = new Vector3(0, 1, 0);

/** Steepness (sin of the face angle; 1 vertical or overhanging) under a surface normal. */
export function faceSteepness(normalY: number): number {
  return normalY <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - normalY * normalY));
}

/** The lay-back (rad) on a face of this steepness. */
export function layBackAngle(steepness: number): number {
  return LEAN_MAX * smoothstep(LEAN_FROM, 1, steepness);
}

/**
 * The axis (unit, frame coordinates) the body lays back about: rotating by +layBackAngle about it turns
 * the surface normal further from world up (up × normal). null on a flat face (no lean there anyway).
 */
export function layBackAxis(normal: Vector3, out: Vector3): Vector3 | null {
  out.crossVectors(UP, normal);
  const len = out.length();
  return len < 1e-6 ? null : out.multiplyScalar(1 / len);
}
