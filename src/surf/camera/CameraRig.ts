import { Vector3, type PerspectiveCamera } from 'three';
import type { Side, SurfConfig } from '../config';
import { springStep, springStepVec3, type Spring1 } from '../math/spring';
import type { SurferState } from '../physics/Surfer';
import { frameToView } from '../wave/mirror';

/** Offsets from the surfer in the canonical frame (+x shoulder, +z shore). */
export const CAMERA_OFFSETS = {
  chase: { pos: new Vector3(6, 2.2, 5), look: new Vector3(-2, 0.3, -0.5) },
  /**
   * Inside the barrel, between the rider and the exit, looking back at the rider.
   * (A camera behind the rider cannot work: released in the tube the rider sits
   * near x ≈ −4, where the closing barrel leaves no room behind them.)
   */
  tube: { pos: new Vector3(3, 0.35, 0.9), look: new Vector3(-2, 0.6, 0.4) },
  /**
   * Bezier control point for the chase → tube move: low and in front of the
   * face, under the lip tip, so the camera enters through the barrel mouth
   * instead of cutting through the curtain.
   */
  mouth: { pos: new Vector3(3, -0.8, 2.4) },
  underwater: { pos: new Vector3(2, -1.4, 3), look: new Vector3(0, -0.6, 0) },
  /** Air: chase offset × this, plus `airLift` up. */
  airScale: 1.4,
  airLift: 1.5,
} as const;

/** Camera far plane (m): must clear the sky dome (600 m) and sun sprite (500 m). */
export const CAMERA_FAR = 650;

export interface CameraGoal {
  pos: Vector3;
  look: Vector3;
}

/**
 * Where the camera wants to be (VIEW coordinates, i.e. already mirrored).
 * tubeBlend 0 = chase, 1 = tube view; air/underwater handled by mode.
 * Only a TRICK air (launchKind set) pulls back; silent floater mount/dismount/drop airs do not.
 * `tubeMinX` (frame x) keeps a tube camera out of the thin, closing back of the barrel.
 */
export function cameraGoal(
  s: Pick<SurferState, 'p' | 'mode' | 'launchKind'>,
  side: Side,
  tubeBlend: number,
  underwater: boolean,
  out: CameraGoal,
  tubeMinX = -Infinity,
): CameraGoal {
  const O = CAMERA_OFFSETS;
  if (underwater) {
    out.pos.copy(s.p).add(O.underwater.pos);
    out.look.copy(s.p).add(O.underwater.look);
  } else {
    out.pos.copy(O.chase.pos);
    out.look.copy(O.chase.look);
    if (s.mode === 'airborne' && s.launchKind !== null) {
      out.pos.multiplyScalar(O.airScale);
      out.pos.y += O.airLift;
    }
    if (tubeBlend > 0) {
      // Quadratic Bezier chase → mouth → tube.
      const b = tubeBlend;
      const a = 1 - b;
      out.pos.multiplyScalar(a * a).addScaledVector(O.mouth.pos, 2 * a * b).addScaledVector(O.tube.pos, b * b);
      out.look.lerp(O.tube.look, b);
    }
    out.pos.add(s.p);
    out.look.add(s.p);
    if (tubeBlend > 0) out.pos.x = Math.max(out.pos.x, tubeMinX);
  }
  frameToView(out.pos, side, out.pos);
  frameToView(out.look, side, out.look);
  return out;
}

/** Critically damped springs on camera position and look target. */
export class CameraRig {
  readonly pos = new Vector3();
  readonly look = new Vector3();
  private readonly vPos = new Vector3();
  private readonly vLook = new Vector3();
  private readonly tube: Spring1 = { x: 0, v: 0 };
  private readonly goal: CameraGoal = { pos: new Vector3(), look: new Vector3() };
  private readonly subject: Pick<SurferState, 'p' | 'mode' | 'launchKind'> = {
    p: new Vector3(),
    mode: 'riding',
    launchKind: null,
  };

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly cfg: SurfConfig['camera'],
  ) {
    if (camera.far < CAMERA_FAR) {
      camera.far = CAMERA_FAR;
      camera.updateProjectionMatrix();
    }
  }

  snap(s: SurferState, side: Side): void {
    this.tube.x = 0;
    this.tube.v = 0;
    this.subject.p.copy(s.p);
    this.subject.mode = s.mode;
    this.subject.launchKind = s.launchKind;
    cameraGoal(this.subject, side, 0, false, this.goal);
    this.pos.copy(this.goal.pos);
    this.look.copy(this.goal.look);
    this.vPos.set(0, 0, 0);
    this.vLook.set(0, 0, 0);
    this.apply();
  }

  /** `renderP` = the interpolated surfer position being drawn this frame. */
  update(s: SurferState, renderP: Vector3, side: Side, underwater: boolean, dt: number): void {
    const c = this.cfg;
    springStep(this.tube, s.inTube ? Math.min(1, c.tubeBlendFloor + s.tubeDepth) : 0, c.tubeBlendRate, dt);
    // The spring can overshoot [0, 1] slightly when the target flips; the path is only defined inside.
    const blend = Math.min(1, Math.max(0, this.tube.x));
    this.subject.p.copy(renderP);
    this.subject.mode = s.mode;
    this.subject.launchKind = s.launchKind;
    cameraGoal(this.subject, side, blend, underwater, this.goal, c.tubeMinX);
    if (underwater) {
      // The wipeout is a hard cut, not a glide: no velocity carries over to the next shot.
      this.pos.copy(this.goal.pos);
      this.look.copy(this.goal.look);
      this.vPos.set(0, 0, 0);
      this.vLook.set(0, 0, 0);
    } else {
      // Stiffer inside the barrel so the camera tracks the mouth path instead of cutting the corner.
      const stiffness = c.stiffness + (c.tubeStiffness - c.stiffness) * blend;
      springStepVec3(this.pos, this.vPos, this.goal.pos, stiffness, dt);
      springStepVec3(this.look, this.vLook, this.goal.look, c.lookStiffness + (c.tubeStiffness - c.lookStiffness) * blend, dt);
    }
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
