import { Vector3, type PerspectiveCamera } from 'three';
import { SURF_CONFIG, type Side, type SurfConfig } from '../config';
import { springStepVec3 } from '../math/spring';
import { DEG, wrapAngle } from '../math/scalar';
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
   * further toward shore (into the middle of the tube, clear of the crest leaning over the face), looking
   * out the mouth at a point `look` past the rider (and as far out as the camera): the rider stands to
   * one side of the frame, and the eye — straight down the line from the camera — stays open beside them.
   */
  tube: { back: 2.2, lift: 0.3, out: 1.2, look: new Vector3(6, 1.8, 1.5), minDistance: 1.6 },
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

export type CameraShot = 'chase' | 'tube' | 'underwater' | 'title';

/**
 * The title / attract shot (the /surf title screen and the dimmed stage behind every site page): the
 * chase pulled back and up and pitched up to `pitch` below level, so the wave and its lip still fill the
 * lower frame while the beach side (houses, the Oceanic and pier, the water tower) shows above the
 * horizon. The chase's own pitch (≈ 32°) leaves the horizon just above the top edge.
 */
export const TITLE_SHOT = {
  /** Behind the rider along their travel (m) … */
  back: 7,
  /** … this high above them (m; floored above the crest like the chase) … */
  up: 6,
  /** … looking along the travel this far below level. */
  pitch: 19 * (Math.PI / 180),
} as const;

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
/** The tube camera is lifted off the face in steps of this (m), at most TUBE_LIFT_STEPS of them, to find the barrel's air. */
const TUBE_LIFT_STEP = 0.12;
const TUBE_LIFT_STEPS = 6;
/** …and moved in toward the rider along the line in steps of this (m), at most TUBE_IN_STEPS of them (never nearer than minDistance). */
const TUBE_IN_STEP = 0.3;
const TUBE_IN_STEPS = 3;
/** …and, failing that, brought back from the middle of the tube toward the face (−z, rider low in a closing barrel) in steps of this (m). */
const TUBE_OUT_STEP = 0.3;
const TUBE_OUT_STEPS = 3;
/** Line-of-sight samples from the tube camera to the rider, and the clearance each needs from the water (m). */
const SIGHT_SAMPLES = 10;
const SIGHT_CLEARANCE = 0.05;
/**
 * The barrel closing on the rider (no tube spot left, just before the swallow): the tube camera holds
 * its last pose — easing along with the rider while it can, else locked off — for at most this long (s)
 * while that pose stays in the barrel's air, sees the rider and frames them; then the underwater cut (the
 * rider deep in the barrel), a fresh tube pose, or the chase.
 */
const TUBE_HOLD_MAX = 0.5;
/** A held pose is given up once the rider (sliding back into the closeout) comes this close to it (m) … */
export const TUBE_HOLD_MIN_DISTANCE = 1.2;
/** … or once it is nearer the water than this (m: the near plane and the shake, with a margin) … */
const TUBE_HOLD_CLEARANCE = 0.25;
/** … or the rider (their chest) is further off its line of view than this fraction of the half lens. */
const TUBE_HOLD_FRAMING = 0.8;
/** The rider within this of the swallow (m in frame x past −tubeDepth) with no tube pose left: the underwater cut, early. */
const TUBE_SWALLOW_NEAR = 1;

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
 * Chase framing guard: points of the drawn rider (leaning into the turn, see `riderUp`) are kept within
 * these shares of the half-height of the screen from its centre — the chest within 0.7 and the board
 * within 0.8 (clear of the HUD along the bottom edge), the head within 0.8. The chest normally sits
 * ≈ 17° below centre (ndc ≈ −0.5); a fast reversal (a roundhouse running back toward the curl under the
 * still-swinging camera, the body leaning hard) would otherwise carry the rider off the bottom of the
 * screen, so the camera tilts toward them instead (it never moves for this). In ordinary riding it
 * also nudges the view a little (a few % of frames, ≤ ≈ 7°) when the leaned head on a hard carve nears
 * its limit. The guard aims a little inside the limits (render interpolation, the cone vs the screen).
 */
const CHASE_FRAMING = [
  { up: 0, ndc: 0.75 }, // the board
  { up: 0.9, ndc: 0.65 }, // the chest
  { up: 1.5, ndc: 0.8 }, // the head
] as const;
/** Lean of the drawn body: as Character.ts, bank = clamp(turnRate · |v| · BANK_GAIN, ±BANK_MAX). */
const BANK_GAIN = 0.04;
const BANK_MAX = 0.6;

/**
 * The drawn rider's up direction (frame coordinates): the surface normal leaned into the turn about the
 * board's line, as Character.ts banks the body (from the turn rate and speed only, not the pose).
 */
export function riderUp(s: Pick<SurferState, 'normal' | 'heading' | 'turnRate' | 'v' | 'stanceFlipped'>, out: Vector3, fwd = new Vector3()): Vector3 {
  const bank = Math.max(-BANK_MAX, Math.min(BANK_MAX, s.turnRate * s.v.length() * BANK_GAIN)) * (s.stanceFlipped ? 1 : -1);
  fwd.copy(s.heading).multiplyScalar(s.stanceFlipped ? -1 : 1).normalize();
  return out.copy(s.normal).applyAxisAngle(fwd, bank);
}

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
  } else if (shot === 'title') {
    const yaw = travelYaw(s.heading);
    const [dx, dz] = [Math.cos(yaw), Math.sin(yaw)];
    out.pos.set(s.p.x - dx * TITLE_SHOT.back, s.p.y + TITLE_SHOT.up, s.p.z - dz * TITLE_SHOT.back);
    if (wave) out.pos.y = Math.max(out.pos.y, wave.crestY(out.pos.x) + O.crestClearance, wave.crestY(s.p.x) + O.crestClearance);
    const [h, v] = [Math.cos(TITLE_SHOT.pitch), Math.sin(TITLE_SHOT.pitch)];
    out.look.set(out.pos.x + dx * h * 20, out.pos.y - v * 20, out.pos.z + dz * h * 20);
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
 * for `tubeCutIn` s and left after `tubeCutOut` s out of it; the underwater wipeout is also a cut. The
 * tube view has its own wider lens (`tubeFov`): the rider stays small enough for the eye to read.
 * Every tube pose is checked (in the barrel's air, seeing the rider); one that isn't holds the last pose
 * that is — that is also how the barrel closing on the rider plays out, up to the swallow's cut.
 */
export class CameraRig {
  readonly pos = new Vector3();
  readonly look = new Vector3();
  shot: CameraShot = 'chase';
  /** The title / attract shot (TITLE_SHOT) instead of riding shots: set while the title (or loading) shows. */
  private title = false;
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
  private readonly probeSubject: Subject = { p: new Vector3(), normal: new Vector3(0, 1, 0), heading: new Vector3(1, 0, 0), mode: 'riding', launchKind: null };
  private readonly probeGoal: CameraGoal = { pos: new Vector3(), look: new Vector3() };
  /** The tube spot found this frame: moved in along the line / lifted off the face / back toward it (m). */
  private spotIn = 0;
  private spotLift = 0;
  private spotBack = 0;
  /** How long (s) the tube camera has been holding a pose (no tube spot, or a spring step out of the air); 0 = not holding. */
  private heldFor = 0;
  private readonly heldPos = new Vector3();
  private readonly heldLook = new Vector3();
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

  /** The tube camera is holding its last pose, locked off (the barrel closing on the rider). */
  get holding(): boolean {
    return this.shot === 'tube' && this.heldFor > 0;
  }

  /** Title / attract framing on or off; the next update cuts to (or from) the title shot. */
  setTitle(on: boolean): void {
    this.title = on;
  }

  snap(s: SurferState, side: Side): void {
    const shot: CameraShot = this.title ? 'title' : 'chase';
    this.shot = shot;
    this.inFor = 0;
    this.outFor = 0;
    this.heldFor = 0;
    this.yaw = travelYaw(s.heading);
    this.facing = Math.cos(this.yaw) < -FACING_SWITCH ? -1 : 1;
    this.track(s, s.p, side, shot);
    cameraGoal(this.subject, side, shot, this.wave, this.goal, this.cfg);
    this.cut();
    this.apply(0);
  }

  /**
   * The wave frame jumped `dx` m along the wave past everything in it (a section peak's surge): move
   * the camera and its springs with it, as the rider moved, so nothing trails behind the shift.
   */
  shiftAlongWave(dx: number, side: Side): void {
    const d = side === 'right' ? -dx : dx;
    for (const v of [this.pos, this.look, this.follow, this.heldPos, this.heldLook]) v.x += d;
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
    const D = this.wave.params.tubeDepth;
    const pocket = s.mode === 'riding' && s.p.x <= c.pocketX && s.p.x >= -D;
    // … and anywhere in the pocket where the chase can't see the rider past the pitching lip (a
    // roundhouse running back into the pocket high on the face): that cuts straight in.
    const blind = pocket && this.chaseBlind(s, renderP);
    const wanted = s.mode === 'riding' && (s.inTube || blind || (pocket && s.p.y < c.pocketHeightFrac * this.wave.crestY(s.p.x)));
    // …as long as there IS a tube shot: a spot behind the rider in the barrel's air that sees them
    // (not through the falling curtain, not with the barrel closing on them). Otherwise the chase.
    const tubed = !this.title && wanted && this.findTubeSpot(renderP, s.normal);
    this.inFor = tubed ? this.inFor + dt : 0;
    this.outFor = tubed ? 0 : this.outFor + dt;
    // A held tube pose that can't be held any more: the rider deep in the closing barrel is the swallow's
    // underwater cut, a moment early; otherwise a fresh tube pose (the spot found), or the chase.
    const giveUp = (): CameraShot => (s.inTube && renderP.x < TUBE_SWALLOW_NEAR - D ? 'underwater' : tubed ? 'tube' : 'chase');
    const holding = this.shot === 'tube' && this.heldFor > 0;
    let shot: CameraShot;
    let hold = false;
    if (this.title) shot = 'title';
    else if (underwater) shot = 'underwater';
    else if (this.shot === 'underwater') shot = wanted && s.inTube ? 'underwater' : 'chase';
    else if (this.shot === 'tube' && wanted && (holding || !tubed)) {
      // No tube spot any more (the barrel closing on the rider), or already holding: keep the pose while
      // it is good — never a flash of the chase (from above the lip, which hides them) before the swallow.
      // With a spot again the springs may ease on from it (below).
      const good = this.heldFor < TUBE_HOLD_MAX && this.holdable(this.pos, renderP, s.normal, side, TUBE_HOLD_MIN_DISTANCE, this.look);
      shot = good ? 'tube' : giveUp();
      hold = good && !tubed;
    } else if (this.shot === 'tube') shot = this.outFor >= c.tubeCutOut ? 'chase' : 'tube';
    else shot = this.inFor >= c.tubeCutIn || (blind && tubed) ? 'tube' : 'chase';
    this.track(s, renderP, side, shot);
    if (hold) {
      this.holdTube(renderP, s.normal, side, dt);
      this.apply(shakeAmplitude(side === 'right' ? -this.pos.x : this.pos.x, D, c.shake), time);
      return;
    }
    const heldFor = shot === 'tube' && this.shot === 'tube' ? this.heldFor : 0;
    this.heldFor = 0;
    this.heldPos.copy(this.pos);
    this.heldLook.copy(this.look);
    this.aim(s, side, shot);
    // A new shot, the wipeout, the tube camera changing sides of the rider (a glide would pass through
    // them), or a fresh tube pose after a hold that gave out is a cut.
    const fresh = shot === 'tube' && heldFor > 0 && !this.holdable(this.pos, renderP, s.normal, side, TUBE_HOLD_MIN_DISTANCE, this.look);
    const cut = shot !== this.shot || shot === 'underwater' || (shot === 'tube' && (fresh || this.facing !== wasFacing));
    if (cut) this.cut();
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
    if (shot === 'tube') {
      this.clampBehindCloseout(side);
      // The springs can carry the camera out of the air its goal was found in (or behind the curtain)
      // as the barrel closes: hold the last pose instead while that is good, else give up on it.
      if (!cut && !this.holdable(this.pos, renderP, s.normal, side, CAMERA_OFFSETS.tube.minDistance - 0.1, this.look)) {
        this.pos.copy(this.heldPos);
        this.look.copy(this.heldLook);
        this.holdPose();
        this.heldFor = heldFor + dt;
        if (this.heldFor > TUBE_HOLD_MAX || !this.holdable(this.pos, renderP, s.normal, side, TUBE_HOLD_MIN_DISTANCE, this.look)) {
          this.heldFor = 0;
          const next = giveUp();
          this.shot = next;
          this.track(s, renderP, side, next);
          this.aim(s, side, next);
          this.cut();
        }
      }
    }
    if (this.shot === 'chase') this.keepInFrame(s, side);
    const x = side === 'right' ? -this.pos.x : this.pos.x;
    this.apply(this.shot === 'underwater' || this.shot === 'title' ? 0 : shakeAmplitude(x, D, c.shake), time);
  }

  /** Would the chase (its goal behind the eased travel direction) see the rider's chest past the wave? */
  private chaseBlind(s: SurferState, p: Vector3): boolean {
    const w = this.wave;
    if (!w.profile || w.params.xMin === undefined) return false;
    const subj = this.probeSubject;
    subj.p.copy(p);
    subj.normal.copy(s.normal);
    subj.heading.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    subj.mode = s.mode;
    subj.launchKind = s.launchKind;
    // In frame coordinates (the 'left' frame is the canonical one).
    cameraGoal(subj, 'left', 'chase', w, this.probeGoal, this.cfg);
    const chest = this.tmpG.copy(p).addScaledVector(s.normal, 0.9);
    return !this.sees(w as ProfileProbe, this.probeGoal.pos, chest);
  }

  /**
   * Chase: tilt the look target so the leaned rider's board, chest and head sit within CHASE_FRAMING
   * of the screen centre: each pass turns the view axis toward the point furthest past its limit.
   */
  private keepInFrame(s: SurferState, side: Side): void {
    const up = frameToView(riderUp(s, this.tmpB, this.tmpE), side, this.tmpB);
    const toLook = this.tmpC.subVectors(this.look, this.pos);
    const t = Math.tan((this.cfg.fov / 2) * DEG);
    for (let pass = 0; pass < 6; pass++) {
      let excess = 0;
      for (const f of CHASE_FRAMING) {
        const to = this.tmpA.copy(this.viewP).addScaledVector(up, f.up).sub(this.pos);
        if (to.lengthSq() < 1e-6) continue;
        const e = toLook.angleTo(to) - Math.atan(f.ndc * t);
        if (e > excess) {
          excess = e;
          this.tmpH.copy(to);
        }
      }
      if (excess <= 0) break;
      // Rotate the view axis toward that point in the plane they span, until it is at its limit.
      const axis = this.tmpD.crossVectors(toLook, this.tmpH);
      if (axis.lengthSq() < 1e-12) break;
      toLook.applyAxisAngle(axis.normalize(), excess + 1e-4);
    }
    this.look.addVectors(this.pos, toLook);
  }

  /** The goal for a shot (the tube's moved to the spot found for it). */
  private aim(s: SurferState, side: Side, shot: CameraShot): void {
    cameraGoal(this.subject, side, shot, this.wave, this.goal, this.cfg);
    if (shot === 'tube' && (this.spotLift > 0 || this.spotIn > 0 || this.spotBack > 0)) {
      // Moved in / lifted off the face / back toward it, into the air — in the goal, so the spring eases it (no jump).
      frameToView(s.normal, side, this.tmpA);
      this.goal.pos.addScaledVector(this.tmpA, this.spotLift);
      this.goal.pos.x += (side === 'right' ? -1 : 1) * this.facing * this.spotIn;
      this.goal.pos.z -= this.spotBack;
    }
  }

  /** Holding the tube pose (no spot): easing along with the rider while that is good, else locked off. */
  private holdTube(p: Vector3, normal: Vector3, side: Side, dt: number): void {
    this.heldFor += dt;
    const step = this.tmpA.subVectors(this.viewP, this.follow);
    const along = this.tmpD.copy(this.pos).add(step);
    const lookAlong = this.tmpH.copy(this.look).add(step);
    if (this.holdable(along, p, normal, side, CAMERA_OFFSETS.tube.minDistance - 0.1, lookAlong)) {
      this.pos.copy(along);
      this.look.add(step);
    }
    this.holdPose();
  }

  /**
   * Is there a tube shot for a rider at p (frame coordinates)? The tube goal, moved in toward the rider
   * (up to TUBE_IN_STEPS × TUBE_IN_STEP along the line, never nearer than minDistance) and lifted off
   * the face (up to TUBE_LIFT_STEPS × TUBE_LIFT_STEP) — and failing that brought back from the middle
   * of the tube toward the face (up to TUBE_OUT_STEPS × TUBE_OUT_STEP) — until it is in the barrel's air
   * (TUBE_CLEARANCE, in its column and the neighbouring ones) with a clear line of sight to the rider's
   * chest. Sets spotIn / spotLift / spotBack; false when there is no such spot (the rider under the
   * falling curtain, the barrel closing on them). Without a profile (unit stubs) the plain goal is fine.
   */
  private findTubeSpot(p: Vector3, normal: Vector3): boolean {
    this.spotIn = 0;
    this.spotLift = 0;
    this.spotBack = 0;
    const w = this.wave;
    if (!w.profile || w.params.xMin === undefined) return true;
    const probe = w as ProfileProbe;
    const subj = this.probeSubject;
    subj.p.copy(p);
    subj.normal.copy(normal);
    subj.heading.set(this.facing, 0, 0);
    cameraGoal(subj, 'left', 'tube', w, this.probeGoal, this.cfg);
    const base = this.probeGoal.pos;
    const chest = this.tmpG.copy(p).addScaledVector(normal, 0.9);
    const q = this.tmpD;
    const minD = CAMERA_OFFSETS.tube.minDistance - 0.1;
    for (let j = 0; j <= TUBE_OUT_STEPS; j++) {
      for (let i = 0; i <= TUBE_IN_STEPS; i++) {
        for (let k = 0; k <= TUBE_LIFT_STEPS; k++) {
          q.copy(base).addScaledVector(normal, TUBE_LIFT_STEP * k);
          q.x += this.facing * TUBE_IN_STEP * i;
          q.z -= TUBE_OUT_STEP * j;
          if (q.distanceTo(p) < minD) continue;
          if (this.clearAround(probe, q) && this.sees(probe, q, chest)) {
            this.spotIn = TUBE_IN_STEP * i;
            this.spotLift = TUBE_LIFT_STEP * k;
            this.spotBack = TUBE_OUT_STEP * j;
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Is the tube camera at `pos` (view coordinates) good for a rider at p (frame): at least `minDistance`
   * from them, in the barrel's air, with a clear line of sight to their chest — and, looking at `look`
   * (a held pose), with them well inside the frame? Without a profile, always.
   */
  private holdable(pos: Vector3, p: Vector3, normal: Vector3, side: Side, minDistance: number, look?: Vector3): boolean {
    const w = this.wave;
    if (!w.profile || w.params.xMin === undefined) return true;
    const probe = w as ProfileProbe;
    const q = frameToView(pos, side, this.tmpE);
    if (q.distanceTo(p) < minDistance) return false;
    const chest = this.tmpG.copy(p).addScaledVector(normal, 0.9);
    if (look) {
      const view = frameToView(look, side, this.tmpC).sub(q).normalize();
      const toChest = this.tmpB.subVectors(chest, q).normalize();
      if (view.dot(toChest) < Math.cos(((TUBE_HOLD_FRAMING * this.cfg.tubeFov) / 2) * (Math.PI / 180))) return false;
    }
    return this.clearAround(probe, q, look ? TUBE_HOLD_CLEARANCE : TUBE_CLEARANCE) && this.sees(probe, q, chest);
  }

  /** Lock the camera where it is: the springs restart from here, with no velocity. */
  private holdPose(): void {
    this.follow.copy(this.viewP);
    this.vFollow.set(0, 0, 0);
    this.offPos.subVectors(this.pos, this.viewP);
    this.offLook.subVectors(this.look, this.viewP);
    this.vPos.set(0, 0, 0);
    this.vLook.set(0, 0, 0);
  }

  private clearAround(probe: ProfileProbe, q: Vector3, clearance = TUBE_CLEARANCE): boolean {
    // Its own column and the neighbouring ones (the surface changes fast along x near the closeout).
    for (const dx of [0, -0.5, 0.5]) {
      this.tmpF.set(q.x + dx, q.y, q.z);
      if (!inAir(probe, this.tmpF, clearance, this.tmpB, this.tmpC)) return false;
    }
    return true;
  }

  /** No water between `from` and the rider's chest (sampled along the line, stopping short of the rider). */
  private sees(probe: ProfileProbe, from: Vector3, chest: Vector3): boolean {
    for (let i = 1; i < SIGHT_SAMPLES; i++) {
      this.tmpH.lerpVectors(from, chest, i / SIGHT_SAMPLES);
      if (!inAir(probe, this.tmpH, SIGHT_CLEARANCE, this.tmpB, this.tmpC)) return false;
    }
    return true;
  }

  /** The springs can carry the tube camera a little past the closeout its goal is clamped to: hold it there. */
  private clampBehindCloseout(side: Side): void {
    const cam = frameToView(this.pos, side, this.tmpA);
    if (cam.x >= this.cfg.tubeMinX) return;
    cam.x = this.cfg.tubeMinX;
    // Pulled in closer behind the rider: lift off the face instead of crowding them (as the goal does).
    const minD = CAMERA_OFFSETS.tube.minDistance;
    for (let i = 0; i < 8; i++) {
      const d = cam.distanceTo(this.subject.p);
      if (d >= minD) break;
      cam.addScaledVector(this.subject.normal, minD - d + 0.01);
    }
    frameToView(cam, side, this.pos);
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
    // The tube view's wider lens (a cut either way).
    const fov = this.shot === 'tube' ? this.cfg.tubeFov : this.cfg.fov;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    shakeOffset(time, amp, this.shake);
    this.camera.position.copy(this.pos).add(this.shake);
    this.camera.lookAt(this.look);
  }
}
