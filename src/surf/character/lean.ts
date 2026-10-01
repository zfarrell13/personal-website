import { smoothstep } from '../math/scalar';

/**
 * Lip lean (playtest 5: "the steeper the face, the further he should be leaning back (away from the
 * wave)"). Riding, the body's up blends from the surface normal toward world up by
 * LEAN_BACK × smoothstep(LEAN_FROM, 1, steepness) (steepness = sin of the face angle, 1 vertical or
 * overhanging): on a near-vertical lip face the rider no longer sticks straight out from it but stands
 * leaned back, out over the flats. The lean back from the normal grows with steepness. Character draws
 * it (pivoting the body on its feet); the camera's framing guard (CameraRig.riderUp) models it.
 */
export const LEAN_BACK = 0.5;
export const LEAN_FROM = 0.35;

/** Share of the way from the surface normal to world up the riding body stands, for a face of this steepness. */
export function leanBlend(steepness: number): number {
  return LEAN_BACK * smoothstep(LEAN_FROM, 1, steepness);
}

/** Steepness (sin of the face angle; 1 vertical or overhanging) under a surface normal. */
export function faceSteepness(normalY: number): number {
  return normalY <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - normalY * normalY));
}
