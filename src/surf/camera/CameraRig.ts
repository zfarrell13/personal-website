import { Vector3, type PerspectiveCamera } from 'three';
import { SURF_CONFIG, type Side, type SurfConfig } from '../config';
import { springStepVec3 } from '../math/spring';
import { wrapAngle } from '../math/scalar';
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
  /**
   * Tube: inside the barrel behind the rider, `lift` m off the face along the rider's normal and `out` m
   * further toward shore (toward the middle of the tube, clear of the crest leaning over the face), looking
   * out the mouth: the eye stays open in the view.
   */
  tube: { back: 2.2, lift: 0.5, out: 0.3, look: new Vector3(4, 0.5, 0), minDistance: 1.6 },
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

/** The wave's cross-section (frame coordinates), for keeping the tube camera in the barrel's air. */
export interface ProfileProbe {
  profile(x: number, t: number, out: Vector3): Vector3;
  params: { xMin: number; xMax: number };
}

/**
 * Least distance (m) the tube camera keeps from the wave's profile, in the barrel's air: the near
 * plane (0.1 m), the shake (≤ 0.1 m, added afterwards) and the drawn mesh's facets between columns.
 * (The lip's drawn thickness lies on the far side of its underside, away from the tube.)
 */
export const TUBE_CLEARANCE = 0.4;
const CLEAR_SAMPLES = 64;
/** The pocket (tube) view is off with the rider from this far inside the lip tip to this far in front of it (m): under the falling curtain. */
const CURTAIN_MARGIN = [0.3, 1.0] as const;

/**
 * Is frame point p in the air of its column's cross-section, at least `clearance` from the water
 * surface? The profile runs trough → face → crest → lip with the water on one side: below it where it
 * runs seaward (−z: the flats and the face), above it where it runs back toward shore (+z: the lip's
 * underside). So p is under water exactly when the first stretch of profile straight above it runs
 * seaward; nothing above, or the lip's underside first, is air.
 */
export function inAir(wave: ProfileProbe, p: Vector3, clearance: number, tmp = new Vector3(), prev = new Vector3()): boolean {
  const x = Math.min(wave.params.xMax, Math.max(wave.params.xMin, p.x));
  let firstAbove = Infinity;
  let wetAbove = false;
  let nearest = Infinity;
  wave.profile(x, 0, prev);
  for (let i = 1; i <= CLEAR_SAMPLES; i++) {
    wave.profile(x, i / CLEAR_SAMPLES, tmp);
    const dz = tmp.z - prev.z;
    const dy = tmp.y - prev.y;
    // Crossing of the vertical line through p above it.
    if ((prev.z - p.z) * (tmp.z - p.z) < 0) {
      const y = prev.y + (dy * (p.z - prev.z)) / dz;
      if (y > p.y && y < firstAbove) {
        firstAbove = y;
        wetAbove = dz < 0;
      }
    }
    const len2 = dz * dz + dy * dy;
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((p.z - prev.z) * dz + (p.y - prev.y) * dy) / len2)) : 0;
    nearest = Math.min(nearest, Math.hypot(p.z - (prev.z + u * dz), p.y - (prev.y + u * dy)));
    prev.copy(tmp);
  }
  // Off the ends of the profile the flat sea lies at y = 0.
  return !wetAbove && nearest >= clearance && p.y > clearance;
}

type Subject = Pick<SurferState, 'p' | 'normal' | 'heading' | 'mode' | 'launchKind'>;
type CameraParams = SurfConfig['camera'];

/**
 * The travel yaw (rad, 0 = down the line +x, positive toward shore +z) of a heading: the board's
 * heading is its world direction of travel.
 */
export function travelYaw(heading: Vector3): number {
  return heading.x === 0 && heading.z === 0 ? 0 : Math.atan2(heading.z, heading.x);
}

/** |cos(camera yaw)| past which the carve keys' screen meaning follows the camera (hysteresis around side-on). */
const FACING_SWITCH = 0.3;

/**
 * Where the camera wants to be (VIEW coordinates, i.e. already mirrored) for a shot.
 * Chase: a close bird's-eye view from behind — `chaseBack` m behind the rider along their travel,
 * `chaseHeight` m above them (floored above the local crest so it never clips the lip), looking down
 * at the point `chaseAhead` m ahead of them along their travel.
 * Only a TRICK air (launchKind set) pulls back; silent floater mount/dismount/drop airs do not.
 * Tube: behind the rider inside the barrel, looking along their line; it never goes behind
 * `cfg.tubeMinX` (frame x): the barrel is closed there.
 */
export function cameraGoal(s: Subject, side: Side, shot: CameraShot, wave: CrestProbe | null, out: CameraGoal, cfg: CameraParams = SURF_CONFIG.camera): CameraGoal {
  const O = CAMERA_OFFSETS;
  if (shot === 'underwater') {
    out.pos.copy(s.p).add(O.underwater.pos);
    out.look.copy(s.p).add(O.underwater.look);
  } else if (shot === 'tube') {
    // Behind the rider along their line through the barrel: normally deeper in, looking out the
    // mouth; heading deeper toward the curl, on the mouth side looking in.
    const dir = s.heading.x < 0 ? -1 : 1;
    const x = dir > 0 ? Math.max(s.p.x - O.tube.back, cfg.tubeMinX) : s.p.x + O.tube.back;
    // Where tubeMinX pulls the camera in close behind the rider, it lifts further off the face instead.
    const dx = Math.abs(x - s.p.x);
    const lift = Math.max(O.tube.lift, Math.sqrt(Math.max(0, O.tube.minDistance ** 2 - dx * dx)));
    out.pos.copy(s.p).addScaledVector(s.normal, lift);
    out.pos.x = x;
    out.pos.z += O.tube.out;
    out.look.copy(s.p).add(O.tube.look);
    out.look.x = s.p.x + dir * O.tube.look.x;
  } else {
    const yaw = travelYaw(s.heading);
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
 * The camera = a follow point + an offset. The follow point is a stiff spring on the rider
 * (`followStiffness`: it keeps up with the rider's own motion, so they never leave the frame, but
 * smooths pump kicks and landings). The offset (position and look target relative to the follow
 * point) is on the weighty shot springs, which smooth changes of the shot: the eased travel
 * direction, the crest floor, the air pull-back. The chase's travel direction eases toward the
 * board's heading along the shortest arc (`chaseYawRate`), so carves don't whip it round and a
 * cutback swings it round behind the new line. The tube view is a CUT (the chase camera sits above the
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
  private readonly follow = new Vector3();
  private readonly vFollow = new Vector3();
  private facing: 1 | -1 = 1;
  private readonly shake = new Vector3();
  private yaw = 0;
  private inFor = 0;
  private outFor = 0;
  private readonly goal: CameraGoal = { pos: new Vector3(), look: new Vector3() };
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly tmpD = new Vector3();
  private readonly tmpE = new Vector3();
  private readonly tmpF = new Vector3();
  private readonly tmpG = new Vector3();
  private readonly tmpH = new Vector3();
  private readonly subject: Subject = { p: new Vector3(), normal: new Vector3(0, 1, 0), heading: new Vector3(1, 0, 0), mode: 'riding', launchKind: null };

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly cfg: CameraParams,
    private readonly wave: CrestProbe & { params: { tubeDepth: number } } & Partial<ProfileProbe>,
  ) {
    if (camera.far < CAMERA_FAR) {
      camera.far = CAMERA_FAR;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * +1 while the camera looks down the line, −1 once it has swung round to look back toward the
   * curl (the lip is then on the other side of the screen): what the screen-relative carve keys mean.
   * From the eased travel yaw with hysteresis; it also picks the tube camera's side of the rider.
   */
  get keyFacing(): 1 | -1 {
    return this.facing;
  }

  snap(s: SurferState, side: Side): void {
    this.shot = 'chase';
    this.inFor = 0;
    this.outFor = 0;
    this.yaw = travelYaw(s.heading);
    this.facing = Math.cos(this.yaw) < -FACING_SWITCH ? -1 : 1;
    this.track(s, s.p, side, 'chase');
    cameraGoal(this.subject, side, 'chase', this.wave, this.goal, this.cfg);
    this.cut();
    this.apply(0);
  }

  /** `renderP` = the interpolated surfer position being drawn; `time` = sim clock (drives the shake). */
  update(s: SurferState, renderP: Vector3, side: Side, underwater: boolean, dt: number, time = 0): void {
    const c = this.cfg;
    // Shortest arc toward the heading, in continuous angle: no sign-picking at ±180°.
    this.yaw = wrapAngle(this.yaw + wrapAngle(travelYaw(s.heading) - this.yaw) * (1 - Math.exp(-c.chaseYawRate * dt)));
    const wasFacing = this.facing;
    const cos = Math.cos(this.yaw);
    if (cos > FACING_SWITCH) this.facing = 1;
    else if (cos < -FACING_SWITCH) this.facing = -1;
    // The tube view also covers riding low in the pocket (either way along the line), under the
    // pitching lip: from above the crest the lip hides the rider there.
    // Not with the rider right where the lip comes down (between just inside its tip and a little in
    // front of it): the tube camera would look at them through the falling curtain; the chase, shoreward
    // and above, sees them clear. Under the lip, or well out on the flats in front of it, is fine.
    const tipZ = this.wave.profile ? this.wave.profile(s.p.x, 1, this.tmpA).z : 0;
    const clearOfCurtain = !this.wave.profile || s.p.z < tipZ - CURTAIN_MARGIN[0] || s.p.z > tipZ + CURTAIN_MARGIN[1];
    const tubed = s.mode === 'riding' && (s.inTube || (s.p.x <= c.pocketX && s.p.x >= -this.wave.params.tubeDepth && s.p.y < c.pocketHeightFrac * this.wave.crestY(s.p.x) && clearOfCurtain));
    this.inFor = tubed ? this.inFor + dt : 0;
    this.outFor = tubed ? 0 : this.outFor + dt;
    const shot: CameraShot = underwater ? 'underwater' : this.shot === 'tube' ? (this.outFor >= c.tubeCutOut ? 'chase' : 'tube') : this.inFor >= c.tubeCutIn ? 'tube' : 'chase';
    this.track(s, renderP, side, shot);
    cameraGoal(this.subject, side, shot, this.wave, this.goal, c);
    // A new shot, the wipeout, or the tube camera changing sides of the rider (a glide would pass
    // through them) is a cut.
    if (shot !== this.shot || shot === 'underwater' || (shot === 'tube' && this.facing !== wasFacing)) this.cut();
    else {
      // In the (small) barrel the camera moves rigidly with the rider: any lag would close the gap.
      if (shot === 'tube') {
        this.follow.copy(this.viewP);
        this.vFollow.set(0, 0, 0);
      } else springStepVec3(this.follow, this.vFollow, this.viewP, c.followStiffness, dt);
      this.offPosGoal.subVectors(this.goal.pos, this.viewP);
      this.offLookGoal.subVectors(this.goal.look, this.viewP);
      springStepVec3(this.offPos, this.vPos, this.offPosGoal, shot === 'tube' ? c.tubeStiffness : c.stiffness, dt);
      springStepVec3(this.offLook, this.vLook, this.offLookGoal, shot === 'tube' ? c.tubeStiffness : c.lookStiffness, dt);
      this.pos.addVectors(this.follow, this.offPos);
      this.look.addVectors(this.follow, this.offLook);
    }
    this.shot = shot;
    if (shot === 'tube') this.keepInTubeAir(side);
    const x = side === 'right' ? -this.pos.x : this.pos.x;
    this.apply(shot === 'underwater' ? 0 : shakeAmplitude(x, this.wave.params.tubeDepth, c.shake), time);
  }

  /**
   * The tube camera never sits in the water or inside the lip: where its spot is not in the barrel's
   * air (clamped deep behind the rider near the closeout, low in the trough under the falling lip, or
   * lagging a fast carve) it slides toward the rider until it is.
   */
  private keepInTubeAir(side: Side): void {
    const w = this.wave;
    if (!w.profile || w.params.xMin === undefined) return;
    const probe = w as ProfileProbe;
    const start = frameToView(this.pos, side, this.tmpA);
    const cam = this.tmpE.copy(start);
    // The springs can carry it a little past the closeout the goal is clamped to.
    if (cam.x < this.cfg.tubeMinX) {
      cam.x = this.cfg.tubeMinX;
      // Pulled in closer behind the rider: lift off the face instead of crowding them (as the goal does).
      const minD = CAMERA_OFFSETS.tube.minDistance;
      for (let i = 0; i < 8; i++) {
        const d = cam.distanceTo(this.subject.p);
        if (d >= minD) break;
        cam.addScaledVector(this.subject.normal, minD - d + 0.01);
      }
    }
    const clear = (p: Vector3) => {
      // Its own column and the neighbouring ones (the surface changes fast along x near the closeout).
      for (const dx of [0, -0.5, 0.5]) {
        this.tmpF.set(p.x + dx, p.y, p.z);
        if (!inAir(probe, this.tmpF, TUBE_CLEARANCE, this.tmpB, this.tmpC)) return false;
      }
      return true;
    };
    if (!clear(cam)) this.findTubeAir(cam, clear);
    frameToView(cam, side, this.pos);
    // Moved off its line (over the rider as the barrel closes): turn to keep the rider in view.
    const moved = cam.distanceTo(start);
    if (moved > 0.05) {
      const chest = this.tmpF.copy(this.subject.p).addScaledVector(this.subject.normal, 0.9);
      frameToView(chest, side, chest);
      this.look.lerp(chest, Math.min(1, moved));
    }
  }

  /** Lift `cam` off the face (keeps its distance behind the rider); failing that, slide it toward a spot minDistance straight off the face at the rider. */
  private findTubeAir(cam: Vector3, clear: (p: Vector3) => boolean): void {
    const q = this.tmpD;
    for (let k = 1; k <= 6; k++) {
      q.copy(cam).addScaledVector(this.subject.normal, 0.12 * k);
      if (clear(q)) {
        cam.copy(q);
        return;
      }
    }
    const anchor = this.tmpG.copy(this.subject.p).addScaledVector(this.subject.normal, CAMERA_OFFSETS.tube.minDistance);
    const from = this.tmpH.copy(cam);
    for (let k = 1; k <= 12; k++) {
      q.lerpVectors(from, anchor, k / 12);
      if (k === 12 || clear(q)) break;
    }
    cam.copy(q);
  }


  private track(s: SurferState, p: Vector3, side: Side, shot: CameraShot): void {
    this.subject.p.copy(p);
    frameToView(p, side, this.viewP);
    this.subject.normal.copy(s.normal);
    // The chase follows the eased travel direction, not the raw heading; the tube side follows `facing`.
    if (shot === 'tube') this.subject.heading.set(this.facing, 0, 0);
    else this.subject.heading.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.subject.mode = s.mode;
    this.subject.launchKind = s.launchKind;
  }

  /** Hard cut to the goal: no spring velocity carries over into the new shot. */
  private cut(): void {
    this.pos.copy(this.goal.pos);
    this.look.copy(this.goal.look);
    this.follow.copy(this.viewP);
    this.vFollow.set(0, 0, 0);
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
