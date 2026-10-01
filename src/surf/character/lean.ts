import { Vector3 } from 'three';
import { DEG, smoothstep } from '../math/scalar';

/**
 * Lip lean (playtest 5: "the steeper the face, the further he should be leaning back (away from the
 * wave)"; asked which way: "Out, away from the wave" — the head ending farther from it). The riding
 * body lays back about layBackAxis (turning the surface normal further from world up), on top of the
 * rail bank, until its line reaches layBackTarget past the normal — never the other way. Measured from
 * the body's own unleaned, unbanked tilt: a frontside stance (leaning in toward the face) lays back out
 * to the normal on an open face, a backside one (already out) is left there; in the curling pocket both
 * lay further out, past the normal, up to LEAN_MAX on a vertical face. On an open face the head is
 * farthest from the water along the normal; only where the face curls over (steep, near the curl) does
 * laying further out keep taking it away from the water. layBackWeight fades it all in from gentle
 * faces (continuous from zero). Character draws it (pivoting on planted, flat feet); the camera's
 * framing guard (CameraRig.riderUp) models it.
 */
export const LEAN_MAX = 35 * DEG;
/** The target goes past the normal from this steepness (the pocket's curling face), all the way at LEAN_PAST_FULL … */
export const LEAN_PAST_FROM = 0.5;
export const LEAN_PAST_FULL = 0.95;
/** … and the lean fades in over these steepnesses. */
export const LEAN_FROM = 0.2;
export const LEAN_FULL = 0.55;

const UP = new Vector3(0, 1, 0);

/** Steepness (sin of the face angle; 1 vertical or overhanging) under a surface normal. */
export function faceSteepness(normalY: number): number {
  return normalY <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - normalY * normalY));
}

/** How far past the normal (rad, away from up) the body is laid back to on a face of this steepness. */
export function layBackTarget(steepness: number): number {
  return LEAN_MAX * smoothstep(LEAN_PAST_FROM, LEAN_PAST_FULL, steepness);
}

/** 0 … 1: how much of the lay-back applies on a face of this steepness (none on gentle faces). */
export function layBackWeight(steepness: number): number {
  return smoothstep(LEAN_FROM, LEAN_FULL, steepness);
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
