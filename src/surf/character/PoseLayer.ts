import { Quaternion, Vector3 } from 'three';
import { clamp, DEG } from '../math/scalar';
import { springStep, type Spring1 } from '../math/spring';
import type { SurferState } from '../physics/Surfer';
import { POSES, type BodyAngles, type PoseName, type PoseWeights } from './poses';
import { DRIVEN_BONES, type BoneName, type SurferRig } from './rig';

const FWD = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);
const LEFT = new Vector3(0, 0, -1);

/** Character-space rotation from body angles (degrees): yaw · pitch · roll. */
export function bodyQuat(a: BodyAngles, out = new Quaternion()): Quaternion {
  const qy = new Quaternion().setFromAxisAngle(UP, a[1] * DEG);
  const qp = new Quaternion().setFromAxisAngle(LEFT, a[0] * DEG);
  const qr = new Quaternion().setFromAxisAngle(FWD, a[2] * DEG);
  return out.copy(qy).multiply(qp).multiply(qr);
}

/**
 * Which poses to blend for the current surfer state. Weights sum to 1.
 * `sinceLand` = seconds since the last clean landing.
 * Trick-air poses are keyed on `launchKind !== null`: silent floater mount /
 * dismount / drop airs are mode 'airborne' with launchKind null and keep the
 * riding / floater pose.
 */
export function poseWeights(s: SurferState, sinceLand: number): PoseWeights {
  const w: PoseWeights = {};
  if (s.mode === 'wipeout') return { wipeout: 1 };
  if (s.mode === 'airborne' && s.launchKind !== null) {
    if (s.grab) {
      const key = ({ method: 'grabMethod', rail: 'grabRail', stalefish: 'grabStalefish', indy: 'grabIndy' } as const)[s.grab];
      return { [key]: 1 };
    }
    if (Math.abs(s.turnRate) > 0.1) return { spinTuck: 1 };
    if (s.airTime < 0.25) return { ollie: 1 };
    return { spinTuck: 0.5, stance: 0.5 };
  }
  const speed = s.v.length();
  const lean = clamp((Math.abs(s.turnRate) / 2.5) * clamp(speed / 8, 0.3, 1.2), 0, 1);
  const toeSide = s.carve > 0 !== s.stanceFlipped;
  w.stance = 1 - lean;
  if (lean > 0) w[toeSide ? 'carveToe' : 'carveHeel'] = lean;
  const add = (name: PoseName, k: number) => {
    if (k <= 0) return;
    for (const key of Object.keys(w) as PoseName[]) w[key]! *= 1 - k;
    w[name] = (w[name] ?? 0) + k;
  };
  if (s.inTube) add('crouch', 0.85);
  if (s.sincePump < 0.35) add('pump', 1 - s.sincePump / 0.35);
  if (s.stalling) add('stall', 1);
  if (sinceLand < 0.3) add('land', 1 - sinceLand / 0.3);
  return w;
}

interface BoneSprings {
  p: Spring1;
  y: Spring1;
  r: Spring1;
}

/**
 * Procedural animation: every pose defines per-bone body-angle targets; the
 * blended target is chased with critically damped springs (no baked clips).
 */
export class PoseLayer {
  private readonly springs = {} as Record<BoneName, BoneSprings>;
  private readonly target = {} as Record<BoneName, [number, number, number]>;
  private readonly dq = new Quaternion();
  private readonly tmp = new Quaternion();

  constructor(
    readonly rig: SurferRig,
    readonly omega = 16,
  ) {
    for (const b of DRIVEN_BONES) {
      this.springs[b] = { p: { x: 0, v: 0 }, y: { x: 0, v: 0 }, r: { x: 0, v: 0 } };
      this.target[b] = [0, 0, 0];
    }
  }

  /** Current (sprung) body angles of a bone, degrees [pitch, yaw, roll]. */
  angles(bone: BoneName): [number, number, number] {
    const s = this.springs[bone];
    return [s.p.x, s.y.x, s.r.x];
  }

  private blend(weights: PoseWeights): void {
    let total = 0;
    for (const k in weights) total += weights[k as PoseName] ?? 0;
    for (const b of DRIVEN_BONES) this.target[b].fill(0);
    if (total <= 0) return;
    for (const [name, wRaw] of Object.entries(weights) as [PoseName, number][]) {
      const w = wRaw / total;
      if (w <= 0) continue;
      const pose = POSES[name];
      for (const b of DRIVEN_BONES) {
        const a = pose.bones[b];
        if (!a) continue;
        const t = this.target[b];
        t[0] += a[0] * w;
        t[1] += a[1] * w;
        t[2] += a[2] * w;
      }
    }
  }

  update(weights: PoseWeights, dt: number, leanScale = 1): void {
    this.blend(weights);
    for (const b of DRIVEN_BONES) {
      const s = this.springs[b];
      const t = this.target[b];
      springStep(s.p, t[0] * leanScale, this.omega, dt);
      springStep(s.y, t[1], this.omega, dt);
      springStep(s.r, t[2], this.omega, dt);
    }
    this.apply();
  }

  /** Jump straight to a blend (used on reset and in tests). */
  snap(weights: PoseWeights): void {
    this.blend(weights);
    for (const b of DRIVEN_BONES) {
      const s = this.springs[b];
      [s.p.x, s.y.x, s.r.x] = this.target[b];
      s.p.v = s.y.v = s.r.v = 0;
    }
    this.apply();
  }

  /** local = restLocal · (restChar⁻¹ · D · restChar), so D acts in character space. */
  private apply(): void {
    const { bones, restLocal, restChar } = this.rig;
    for (const b of DRIVEN_BONES) {
      const s = this.springs[b];
      bodyQuat([s.p.x, s.y.x, s.r.x], this.dq);
      this.tmp.copy(restChar[b]).invert().multiply(this.dq).multiply(restChar[b]);
      bones[b].quaternion.copy(restLocal[b]).multiply(this.tmp);
    }
  }
}
