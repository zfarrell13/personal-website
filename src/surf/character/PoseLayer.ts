import { Quaternion, Vector3 } from 'three';
import { clamp, DEG, smoothstep } from '../math/scalar';
import { springStep, type Spring1 } from '../math/spring';
import type { SurferState } from '../physics/Surfer';
import { POSE_NAMES, POSES, type BodyAngles, type PoseName, type PoseWeights } from './poses';
import { DRIVEN_BONES, type BoneName, type SurferRig } from './rig';

const FWD = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);
const LEFT = new Vector3(0, 0, -1);

const QY = new Quaternion();
const QP = new Quaternion();
const QR = new Quaternion();

/** Character-space rotation from body angles (degrees): yaw · pitch · roll. */
export function bodyQuat(a: BodyAngles, out = new Quaternion()): Quaternion {
  return bodyQuatPYR(a[0], a[1], a[2], out);
}

/** Non-allocating `bodyQuat` taking the three angles (degrees) directly. */
export function bodyQuatPYR(pitch: number, yaw: number, roll: number, out: Quaternion): Quaternion {
  QY.setFromAxisAngle(UP, yaw * DEG);
  QP.setFromAxisAngle(LEFT, pitch * DEG);
  QR.setFromAxisAngle(FWD, roll * DEG);
  return out.copy(QY).multiply(QP).multiply(QR);
}

const GRAB_POSE = { method: 'grabMethod', rail: 'grabRail', stalefish: 'grabStalefish', indy: 'grabIndy' } as const;

/** Blend `name` in at weight k, scaling every existing weight by 1 − k. */
function mixIn(w: PoseWeights, name: PoseName, k: number): void {
  if (k <= 0) return;
  for (let i = 0; i < POSE_NAMES.length; i++) {
    const n = POSE_NAMES[i]!;
    const v = w[n];
    if (v !== undefined) w[n] = v * (1 - k);
  }
  w[name] = (w[name] ?? 0) + k;
}

const TMP = new Vector3();

/**
 * Which way the turn swings the board's line on the face: +1 straight up the face (climbing out of a
 * bottom turn), −1 back down it (off the top, round a cutback), 0 with no turn, on the flats, or with
 * the line pointing straight up / down the face. It is d(heading · up-the-face)/dt per unit |turnRate|:
 * a yaw about the normal at rate ω moves the heading at ω (n × heading), and n × heading has no part
 * along n, so its up-face part is (n × heading).y / |ŷ − n·n_y| = (n × heading).y / √(1 − n_y²).
 */
export function turnPhase(s: SurferState): number {
  if (s.turnRate === 0) return 0;
  const n = s.normal;
  const along = TMP.crossVectors(n, s.heading).y;
  // The floor keeps it continuous (and small) as the face flattens out.
  return clamp((Math.sign(s.turnRate) * along) / Math.max(Math.sqrt(Math.max(0, 1 - n.y * n.y)), 0.15), -1, 1);
}

/**
 * Where a turn sits between a bottom turn (score ≤ BOTTOM_TURN_END) and a top turn / cutback
 * (≥ TOP_TURN_START), with the plain carve between. The score is the height up the face, raised while
 * the turn swings the line back down and while the board runs back toward the curl (−x).
 */
const PHASE_SHIFT = 0.25;
const CURL_SHIFT = 0.45;
const BOTTOM_TURN_END = 0.3;
const CARVE_MID = 0.5;
const TOP_TURN_START = 0.7;
/** The turn poses are fully in once the carve lean reaches this. */
const TURN_FULL_LEAN = 0.6;

/**
 * Which poses to blend for the current surfer state. Weights sum to 1.
 * `sinceLand` = seconds since the last clean landing.
 * Trick-air poses are keyed on `launchKind !== null`: silent floater mount /
 * dismount / drop airs are mode 'airborne' with launchKind null and keep the
 * riding / floater pose.
 * `faceHeight` = how far up the face the rider is, 0 at the trough … 1 at the crest. A turn low on the
 * face swinging up it is a bottom turn (crouched, forward); high up, swinging back down or cutting back
 * toward the curl, a top turn (tall, back on the tail); the plain carve pose sits between.
 */
export function poseWeights(s: SurferState, sinceLand: number, out: PoseWeights = {}, backside = false, faceHeight = 0.5): PoseWeights {
  const w = out;
  // A reused `out` may hold last frame's weights: zero them so no stale pose leaks through.
  for (let i = 0; i < POSE_NAMES.length; i++) if (w[POSE_NAMES[i]!] !== undefined) w[POSE_NAMES[i]!] = 0;
  if (s.mode === 'wipeout') {
    w.wipeout = 1;
    return w;
  }
  if (s.mode === 'airborne' && s.launchKind !== null) {
    if (s.grab) w[GRAB_POSE[s.grab]] = 1;
    else if (Math.abs(s.turnRate) > 0.1) w.spinTuck = 1;
    else if (s.airTime < 0.25) w.ollie = 1;
    else {
      w.spinTuck = 0.5;
      w.stance = 0.5;
    }
    return w;
  }
  const speed = s.v.length();
  const lean = clamp((Math.abs(s.turnRate) / 2.5) * clamp(speed / 8, 0.3, 1.2), 0, 1);
  // The rail is the way the board is actually yawing: +turnRate swings the nose toward the board's
  // left, the rider's chest (toe) side when riding forward. Not the carve key: through a rebound, a
  // released turn or a key pressed while running back toward the curl, the key and the yaw disagree
  // (and Character's tilt bank follows turnRate). The backside body is mirrored, so it flips there.
  // lean ∝ |turnRate|, so the rail only changes where the turn poses have no weight.
  const toeSide = s.turnRate > 0 !== s.stanceFlipped !== backside;
  // The turn poses ramp in faster than the lean itself, so they own the blend in an ordinary S-turn.
  const turn = smoothstep(0, TURN_FULL_LEAN, lean);
  w.stance = 1 - turn;
  if (turn > 0) {
    const score = clamp(faceHeight, 0, 1) - PHASE_SHIFT * turnPhase(s) + CURL_SHIFT * smoothstep(0.1, 0.6, -s.heading.x);
    const bottom = 1 - smoothstep(BOTTOM_TURN_END, CARVE_MID, score);
    const top = smoothstep(CARVE_MID, TOP_TURN_START, score);
    w[toeSide ? 'bottomTurnToe' : 'bottomTurnHeel'] = turn * bottom;
    w[toeSide ? 'carveToe' : 'carveHeel'] = turn * (1 - bottom - top);
    w[toeSide ? 'topTurnToe' : 'topTurnHeel'] = turn * top;
  }
  if (s.inTube) mixIn(w, 'crouch', 0.85);
  if (s.sincePump < 0.35) mixIn(w, 'pump', 1 - s.sincePump / 0.35);
  if (s.stalling) mixIn(w, 'stall', 1);
  if (sinceLand < 0.3) mixIn(w, 'land', 1 - sinceLand / 0.3);
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

  /** `leanScale` scales only the carve poses' departure from stance (carve lean grows with speed). */
  private blend(weights: PoseWeights, leanScale = 1): void {
    let total = 0;
    for (let i = 0; i < POSE_NAMES.length; i++) total += weights[POSE_NAMES[i]!] ?? 0;
    for (const b of DRIVEN_BONES) this.target[b].fill(0);
    if (total <= 0) return;
    for (let i = 0; i < POSE_NAMES.length; i++) {
      const name = POSE_NAMES[i]!;
      const w = (weights[name] ?? 0) / total;
      if (w <= 0) continue;
      const pose = POSES[name];
      const carve = name === 'carveToe' || name === 'carveHeel';
      for (const b of DRIVEN_BONES) {
        const a = pose.bones[b];
        if (!a) continue;
        const t = this.target[b];
        if (carve) {
          const base = POSES.stance.bones[b] ?? a;
          for (let k = 0; k < 3; k++) t[k]! += (base[k]! + (a[k]! - base[k]!) * leanScale) * w;
        } else {
          t[0] += a[0] * w;
          t[1] += a[1] * w;
          t[2] += a[2] * w;
        }
      }
    }
  }

  update(weights: PoseWeights, dt: number, leanScale = 1): void {
    this.blend(weights, leanScale);
    for (const b of DRIVEN_BONES) {
      const s = this.springs[b];
      const t = this.target[b];
      springStep(s.p, t[0], this.omega, dt);
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
      bodyQuatPYR(s.p.x, s.y.x, s.r.x, this.dq);
      this.tmp.copy(restChar[b]).invert().multiply(this.dq).multiply(restChar[b]);
      bones[b].quaternion.copy(restLocal[b]).multiply(this.tmp);
    }
  }
}
