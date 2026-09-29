import type { Vector3 } from 'three';

/** Scalar state for a critically damped spring. */
export interface Spring1 {
  x: number;
  v: number;
}

/**
 * Exact critically damped spring step (Game Programming Gems 4, "Critically
 * Damped Ease-In/Out Smoothing"). `omega` ≈ 2 / settle-time. Never overshoots
 * a fixed target, stable for any dt.
 */
export function springStep(s: Spring1, target: number, omega: number, dt: number): void {
  const e = Math.exp(-omega * dt);
  const change = s.x - target;
  const temp = (s.v + omega * change) * dt;
  s.v = (s.v - omega * temp) * e;
  s.x = target + (change + temp) * e;
}

const tmp: Spring1 = { x: 0, v: 0 };
const AXES = ['x', 'y', 'z'] as const;

/** Component-wise critically damped spring on a Vector3 (pos/vel mutated). */
export function springStepVec3(pos: Vector3, vel: Vector3, target: Vector3, omega: number, dt: number): void {
  for (const k of AXES) {
    tmp.x = pos[k];
    tmp.v = vel[k];
    springStep(tmp, target[k], omega, dt);
    pos[k] = tmp.x;
    vel[k] = tmp.v;
  }
}
