import { Vector3, type PerspectiveCamera } from 'three';
import { SURF_CONFIG, type Side, type SurfConfig } from '../config';
import { springStepVec3 } from '../math/spring';
import { clamp, DEG } from '../math/scalar';
import type { SurferState } from '../physics/Surfer';
import { impactDistance } from '../wave/impact';
import { frameToView } from '../wave/mirror';

/**
 * Fixed shot geometry in the canonical frame (+x = down the line toward the shoulder, +z shore).
 * The chase geometry (behind / height / look-ahead) is tunable in `SURF_CONFIG.camera`.
 */
export const CAMERA_OFFSETS = {
  /** Chase camera floor above the crest height under the camera and under the rider (m). */
  crestClearance: 1.2,
  /** Tube: inside the barrel behind the rider (along the rider's normal = into the tube), looking out the mouth. */
  tube: { back: 2.2, lift: 0.8, look: new Vector3(4, 0.5, 0) },
  underwater: { pos: new Vector3(2, -1.4, 3), look: new Vector3(0, -0.6, 0) },
  /** Trick air: the chase's behind/height offsets × this, plus `airLift` up (a modest pull back and up). */
  airScale: 1.25,
  airLift: 1,
} as const;

/** Camera far plane (m): must clear the sky dome (600 m) and sun sprite (500 m). */
export const CAMERA_FAR = 650;

export interface CameraGoal {
  pos: Vector3;
  look: Vector3;
}

export type CameraShot = 'chase' | 'tube' | 'underwater';

/** What the goal needs from the wave: the crest height of a column (frame x). */
export interface CrestProbe {
  crestY(x: number): number;
}

type Subject = Pick<SurferState, 'p' | 'normal' | 'heading' | 'mode' | 'launchKind'>;
type CameraParams = SurfConfig['camera'];

/**
 * The chase's travel yaw (rad, 0 = down the line +x, positive toward shore +z) for a heading: the
 * board's heading is its world direction of travel; the yaw is clamped to ±chaseMaxYaw so the chase
 * stays behind the rider on the curl side (and the screen-relative keys keep their meaning).
 */
export function travelYaw(heading: Vector3, cfg: CameraParams): number {
  const max = cfg.chaseMaxYaw * DEG;
  return heading.x === 0 && heading.z === 0 ? 0 : clamp(Math.atan2(heading.z, heading.x), -max, max);
}

/**
 * Where the camera wants to be (VIEW coordinates, i.e. already mirrored) for a shot.
 * Chase: a close bird's-eye view from behind — `chaseBack` m behind the rider along their travel,
 * `chaseHeight` m above them (floored above the local crest so it never clips the lip), looking down
 * at the point `chaseAhead` m ahead of them along their travel.
 * Only a TRICK air (launchKind set) pulls back; silent floater mount/dismount/drop airs do not.
 * The tube camera never goes behind `cfg.tubeMinX` (frame x): the barrel is closed there.
 */
export function cameraGoal(s: Subject, side: Side, shot: CameraShot, wave: CrestProbe | null, out: CameraGoal, cfg: CameraParams = SURF_CONFIG.camera): CameraGoal {
  const O = CAMERA_OFFSETS;
  if (shot === 'underwater') {
    out.pos.copy(s.p).add(O.underwater.pos);
    out.look.copy(s.p).add(O.underwater.look);
  } else if (shot === 'tube') {
    out.pos.copy(s.p).addScaledVector(s.normal, O.tube.lift);
    out.pos.x = Math.max(out.pos.x - O.tube.back, cfg.tubeMinX);
    out.look.copy(s.p).add(O.tube.look);
  } else {
    const yaw = travelYaw(s.heading, cfg);
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    const air = s.mode === 'airborne' && s.launchKind !== null;
    const back = cfg.chaseBack * (air ? O.airScale : 1);
    const up = cfg.chaseHeight * (air ? O.airScale : 1) + (air ? O.airLift : 0);
    out.pos.set(s.p.x - dx * back, s.p.y + up, s.p.z - dz * back);
    if (wave) out.pos.y = Math.max(out.pos.y, wave.crestY(out.pos.x) + O.crestClearance, wave.crestY(s.p.x) + O.crestClearance);
    out.look.set(s.p.x + dx * cfg.chaseAhead, s.p.y, s.p.z + dz * cfg.chaseAhead);
  }
  frameToView(out.pos, side, out.pos);
  frameToView(out.look, side, out.look);
  return out;
}

/** Deterministic camera shake (m) at sim time `t`: a sum of incommensurate sines, |offset| ≤ amp·√3. */
export function shakeOffset(t: number, amp: number, out: Vector3): Vector3 {
  return out.set(
    amp * (0.6 * Math.sin(t * 37.1) + 0.4 * Math.sin(t * 61.7 + 1.3)),
    amp * (0.6 * Math.sin(t * 43.3 + 2.1) + 0.4 * Math.sin(t * 71.9)),
    amp * (0.6 * Math.sin(t * 29.3 + 0.7) + 0.4 * Math.sin(t * 53.9 + 2.9)),
  );
}

/**
 * Shake amplitude for a camera at frame x: full within the impact zone x ∈ [−D, 0] (where the lip
 * lands), fading to zero `fade` metres outside it.
 */
export function shakeAmplitude(x: number, tubeDepth: number, maxAmp: number, fade = 8): number {
  return maxAmp * Math.max(0, 1 - impactDistance(x, tubeDepth) / fade);
}

/**
 * Critically damped springs on the camera's position and look target RELATIVE to the rider (so the
 * rider's own motion never drags them out of frame; the springs smooth changes of the shot: the eased
 * travel direction, the crest floor, the air pull-back), plus an eased travel direction for the chase
 * (so carves don't whip it round). The tube view is a CUT (the chase camera sits above the
 * lip; any glide into the barrel would pass through it), entered after the rider has been in the tube
 * for `tubeCutIn` s and left after `tubeCutOut` s out of it; the underwater wipeout is also a cut.
 */
export class CameraRig {
  readonly pos = new Vector3();
  readonly look = new Vector3();
  shot: CameraShot = 'chase';
  /** Spring state: position and look target relative to the rider (view coordinates). */
  private readonly offPos = new Vector3();
  private readonly offLook = new Vector3();
  private readonly offPosGoal = new Vector3();
  private readonly offLookGoal = new Vector3();
  private readonly vPos = new Vector3();
  private readonly vLook = new Vector3();
  private readonly viewP = new Vector3();
  private readonly shake = new Vector3();
  private yaw = 0;
  private inFor = 0;
  private outFor = 0;
  private readonly goal: CameraGoal = { pos: new Vector3(), look: new Vector3() };
  private readonly subject: Subject = { p: new Vector3(), normal: new Vector3(0, 1, 0), heading: new Vector3(1, 0, 0), mode: 'riding', launchKind: null };

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly cfg: CameraParams,
    private readonly wave: CrestProbe & { params: { tubeDepth: number } },
  ) {
    if (camera.far < CAMERA_FAR) {
      camera.far = CAMERA_FAR;
      camera.updateProjectionMatrix();
    }
  }

  snap(s: SurferState, side: Side): void {
    this.shot = 'chase';
    this.inFor = 0;
    this.outFor = 0;
    this.yaw = travelYaw(s.heading, this.cfg);
    this.track(s, s.p, side);
    cameraGoal(this.subject, side, 'chase', this.wave, this.goal, this.cfg);
    this.cut();
    this.apply(0);
  }

  /** `renderP` = the interpolated surfer position being drawn; `time` = sim clock (drives the shake). */
  update(s: SurferState, renderP: Vector3, side: Side, underwater: boolean, dt: number, time = 0): void {
    const c = this.cfg;
    // The tube view also covers riding low in the pocket, under the pitching lip: from above the
    // crest the lip hides the rider there.
    const tubed = s.mode === 'riding' && (s.inTube || (s.p.x <= c.pocketX && s.p.x >= -this.wave.params.tubeDepth && s.p.y < c.pocketHeightFrac * this.wave.crestY(s.p.x)));
    this.inFor = tubed ? this.inFor + dt : 0;
    this.outFor = tubed ? 0 : this.outFor + dt;
    const shot: CameraShot = underwater ? 'underwater' : this.shot === 'tube' ? (this.outFor >= c.tubeCutOut ? 'chase' : 'tube') : this.inFor >= c.tubeCutIn ? 'tube' : 'chase';
    this.yaw += (travelYaw(s.heading, c) - this.yaw) * (1 - Math.exp(-c.chaseYawRate * dt));
    this.track(s, renderP, side);
    cameraGoal(this.subject, side, shot, this.wave, this.goal, c);
    if (shot !== this.shot || shot === 'underwater') this.cut();
    else {
      this.offPosGoal.subVectors(this.goal.pos, this.viewP);
      this.offLookGoal.subVectors(this.goal.look, this.viewP);
      springStepVec3(this.offPos, this.vPos, this.offPosGoal, shot === 'tube' ? c.tubeStiffness : c.stiffness, dt);
      springStepVec3(this.offLook, this.vLook, this.offLookGoal, shot === 'tube' ? c.tubeStiffness : c.lookStiffness, dt);
      this.pos.addVectors(this.viewP, this.offPos);
      this.look.addVectors(this.viewP, this.offLook);
    }
    this.shot = shot;
    const x = side === 'right' ? -this.pos.x : this.pos.x;
    this.apply(shot === 'underwater' ? 0 : shakeAmplitude(x, this.wave.params.tubeDepth, c.shake), time);
  }

  private track(s: SurferState, p: Vector3, side: Side): void {
    this.subject.p.copy(p);
    frameToView(p, side, this.viewP);
    this.subject.normal.copy(s.normal);
    // The chase follows the eased travel direction, not the raw heading.
    this.subject.heading.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.subject.mode = s.mode;
    this.subject.launchKind = s.launchKind;
  }

  /** Hard cut to the goal: no spring velocity carries over into the new shot. */
  private cut(): void {
    this.pos.copy(this.goal.pos);
    this.look.copy(this.goal.look);
    this.offPos.subVectors(this.goal.pos, this.viewP);
    this.offLook.subVectors(this.goal.look, this.viewP);
    this.vPos.set(0, 0, 0);
    this.vLook.set(0, 0, 0);
  }

  private apply(amp: number, time = 0): void {
    shakeOffset(time, amp, this.shake);
    this.camera.position.copy(this.pos).add(this.shake);
    this.camera.lookAt(this.look);
  }
}
