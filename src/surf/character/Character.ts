import { Group, Matrix4, Quaternion, Vector3, type Material, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SurferLook } from '../config';
import { clamp, DEG } from '../math/scalar';
import type { Surfer } from '../physics/Surfer';
import { BOARD, boardRocker, buildBoard, makeDeckTexture } from './board';
import { PoseLayer, poseWeights } from './PoseLayer';
import type { PoseWeights } from './poses';
import { buildProceduralRig, rigFromGltfScene, type SurferRig } from './rig';

export const SURFER_MODEL_URL = '/surf/surfer.glb';

/** Load the CC0 surfer; any load / parse / missing-bone / no-SkinnedMesh failure falls back to the procedural rig. */
export async function loadSurferRig(look: SurferLook, url = SURFER_MODEL_URL): Promise<{ rig: SurferRig; procedural: boolean }> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    try {
      return { rig: rigFromGltfScene(gltf.scene, look), procedural: false };
    } catch (err) {
      disposeObject(gltf.scene);
      throw err;
    }
  } catch (err) {
    console.warn('Surfer model failed to load; using the procedural rig.', err);
    return { rig: buildProceduralRig(look), procedural: true };
  }
}

function disposeMaterial(m: Material): void {
  for (const v of Object.values(m)) if (v && (v as Texture).isTexture) (v as Texture).dispose();
  m.dispose();
}

/** Dispose every geometry, material (with its textures) and skeleton under `root`. */
function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh & { skeleton?: { dispose(): void } };
    mesh.geometry?.dispose();
    mesh.skeleton?.dispose();
    const mat = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
}

const UP = new Vector3(0, 1, 0);
/** Ankle-bone height above the sole (m). */
const FOOT_SOLE = 0.06;
const DECK_Y = BOARD.thickness + boardRocker(0.5);

/**
 * Surfer + board. root: positioned at the (interpolated) contact point and
 * oriented board-forward (+z = nose) with up = surface normal. tilt: stall
 * pitch and rail bank. The rider stands sideways (+x of the model = board's
 * left = facing the wave), lowered by the pose layer's knee-bend drop.
 */
export class Character {
  readonly root = new Group();
  private readonly tilt = new Group();
  readonly board: Mesh;
  readonly pose: PoseLayer;
  private readonly pos = new Vector3();
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();
  private readonly left = new Vector3();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly footL = new Vector3();
  private readonly footR = new Vector3();
  private readonly tumbleAxis = new Vector3(1, 0, 0.3).normalize();
  private tumble = 0;
  private sinceLand = 10;
  private readonly weights: PoseWeights = {};

  constructor(
    readonly rig: SurferRig,
    look: SurferLook,
  ) {
    const deck = typeof document !== 'undefined' ? makeDeckTexture(look) : null;
    this.board = buildBoard(look, deck);
    this.tilt.add(this.board, this.rig.model);
    this.root.add(this.tilt);
    this.pose = new PoseLayer(rig);
    this.pose.snap({ stance: 1 });
    this.plantFeet();
  }

  onLanded(): void {
    this.sinceLand = 0;
  }

  reset(): void {
    this.tumble = 0;
    this.sinceLand = 10;
    this.root.quaternion.identity();
    this.pose.snap({ stance: 1 });
  }

  update(surfer: Surfer, alpha: number, dt: number): void {
    const s = surfer.state;
    this.sinceLand += dt;
    this.pos.lerpVectors(surfer.prevP, s.p, alpha);
    this.root.position.copy(this.pos);

    // A trick air (launchKind set) uses the world-up frame and spin; silent
    // floater mount / dismount airs keep the surface-normal riding frame.
    const trickAir = s.mode === 'airborne' && s.launchKind !== null;

    // Board forward: heading (spun by airYaw in a trick air), flipped when riding fakie.
    this.fwd.lerpVectors(surfer.prevHeading, s.heading, alpha).normalize();
    if (trickAir) this.fwd.applyAxisAngle(UP, s.airYaw);
    if (s.stanceFlipped) this.fwd.negate();
    this.up.copy(trickAir ? UP : s.normal);
    this.left.crossVectors(this.up, this.fwd).normalize();
    this.fwd.crossVectors(this.left, this.up).normalize();
    this.m.makeBasis(this.left, this.up, this.fwd);
    this.q.setFromRotationMatrix(this.m);
    this.root.quaternion.slerp(this.q, 1 - Math.exp(-20 * dt));

    if (s.mode === 'wipeout') {
      this.tumble += dt * 7;
      this.tilt.quaternion.setFromAxisAngle(this.tumbleAxis, this.tumble);
      this.tilt.position.y = Math.max(-1.2, this.tilt.position.y - dt * 0.8);
    } else {
      this.tumble = 0;
      this.tilt.position.y = 0;
      const speed = s.v.length();
      const bank = clamp(s.turnRate * speed * 0.04, -0.6, 0.6) * (s.stanceFlipped ? 1 : -1);
      const stallPitch = s.stalling ? -12 * DEG : 0;
      this.tilt.rotation.set(stallPitch, 0, s.mode === 'riding' ? bank : 0);
    }

    const speed = s.v.length();
    this.pose.update(poseWeights(s, this.sinceLand, this.weights), dt, clamp(0.6 + speed / 20, 0.6, 1.3));
    this.plantFeet();
  }

  /** Move the rider so the lower foot's sole sits on the deck (knee bend lowers the body). */
  plantFeet(): void {
    const model = this.rig.model;
    model.updateMatrixWorld(true);
    this.rig.bones.LeftFoot.getWorldPosition(this.footL);
    this.rig.bones.RightFoot.getWorldPosition(this.footR);
    this.tilt.worldToLocal(this.footL);
    this.tilt.worldToLocal(this.footR);
    model.position.y += DECK_Y + FOOT_SOLE - Math.min(this.footL.y, this.footR.y);
  }

  dispose(): void {
    this.board.geometry.dispose();
    (this.board.material as Material[]).forEach(disposeMaterial);
    disposeObject(this.rig.model);
  }
}
