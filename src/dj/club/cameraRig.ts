import * as THREE from 'three';

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

export type PoseName = 'closeup' | 'room' | 'browse0' | 'browse1';

/** DJ's-eye view (behind the booth, looking at the crowd) vs. the crowd's view of the booth. */
export const POSES: Record<PoseName, Pose> = {
  closeup: { position: [0, 1.75, 0.9], target: [0, 1.35, -6] },
  room: { position: [0, 2.2, -1.6], target: [0, 1.0, 0.25] },
  browse0: { position: [-0.36, 1.55, -1.1], target: [-0.36, 1.02, -0.05] },
  browse1: { position: [0.36, 1.55, -1.1], target: [0.36, 1.02, -0.05] },
};

export const DOLLY_SEC = 0.8;

export const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const clonePose = (p: Pose): Pose => ({ position: [...p.position], target: [...p.target] });

/** Writes the eased blend of `a` → `b` into `out` (no allocation). At t ≥ 1 it is exactly `b`. */
export function lerpPoseInto(out: Pose, a: Pose, b: Pose, t: number): Pose {
  const k = smoothstep(t);
  for (let i = 0; i < 3; i++) {
    out.position[i] = k >= 1 ? b.position[i]! : a.position[i]! + (b.position[i]! - a.position[i]!) * k;
    out.target[i] = k >= 1 ? b.target[i]! : a.target[i]! + (b.target[i]! - a.target[i]!) * k;
  }
  return out;
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return lerpPoseInto(clonePose(a), a, b, t);
}

/** Dollies the camera between poses over 0.8 s (restarts from the current pose if retargeted mid-move). */
export class CameraRig {
  private readonly from: Pose = clonePose(POSES.closeup);
  private to: Pose = POSES.closeup;
  private t = 1;
  private readonly current: Pose = clonePose(POSES.closeup);
  private name: PoseName = 'closeup';

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.apply();
  }

  get pose(): PoseName {
    return this.name;
  }

  setTarget(name: PoseName): void {
    if (name === this.name) return;
    this.name = name;
    lerpPoseInto(this.from, this.current, this.current, 1);
    this.to = POSES[name];
    this.t = 0;
  }

  /** Advances the dolly; returns the (reused) current pose. */
  update(dt: number): Pose {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + Math.max(0, dt) / DOLLY_SEC);
      lerpPoseInto(this.current, this.from, this.to, this.t);
      this.apply();
    }
    return this.current;
  }

  private apply(): void {
    const { position: p, target: q } = this.current;
    this.camera.position.set(p[0], p[1], p[2]);
    this.camera.lookAt(q[0], q[1], q[2]);
  }
}
