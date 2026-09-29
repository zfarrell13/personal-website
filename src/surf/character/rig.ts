import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  Color,
  Group,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
  Box3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { retroMaterial } from '@/retro/retroMaterial';
import type { SurferLook } from '../config';

/** Bones the pose layer drives. Names match the Quaternius "Animated Human" (Mixamo-style) rig. */
export const DRIVEN_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
] as const;
export type BoneName = (typeof DRIVEN_BONES)[number];

export const TARGET_HEIGHT = 1.75;

/**
 * A rigged surfer in "character space": T-pose, facing +x, up +y, the
 * character's LEFT side toward −z, feet at y = 0, TARGET_HEIGHT tall.
 */
export interface SurferRig {
  model: Object3D;
  mesh: SkinnedMesh;
  bones: Record<BoneName, Bone>;
  restLocal: Record<BoneName, Quaternion>;
  /** Rest orientation of each bone relative to `model`. */
  restChar: Record<BoneName, Quaternion>;
}

export type Region = 'skin' | 'hair' | 'top' | 'shorts';

const TOP_BONES = new Set(['Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm']);
const SHORTS_BONES = new Set(['Hips', 'LeftUpLeg', 'RightUpLeg']);
const HEAD_BONES = new Set(['Head', 'HeadTop_End']);

/** Single source of the outfit palette, shared by the glTF recolor and the procedural rig. */
function regionColors(look: SurferLook): Record<Region, Color> {
  return {
    skin: new Color(look.skin),
    hair: new Color(look.hair),
    top: new Color(look.top),
    shorts: new Color(look.shorts),
  };
}

function lambertVertexColors(): MeshLambertMaterial {
  return retroMaterial(new MeshLambertMaterial({ vertexColors: true }));
}

/**
 * Which outfit region a vertex belongs to, from its dominant bone and its
 * character-space position. `headCenterY` ≈ midpoint of Head → HeadTop_End.
 */
export function regionFor(bone: string, p: Vector3, headCenterY: number): Region {
  if (HEAD_BONES.has(bone)) {
    const top = p.y > headCenterY + 0.03;
    const back = p.x < -0.04 && p.y > headCenterY - 0.06;
    return top || back ? 'hair' : 'skin';
  }
  if (TOP_BONES.has(bone)) return 'top';
  if (SHORTS_BONES.has(bone)) return 'shorts';
  return 'skin';
}

function collectRest(model: Object3D, skeleton: Skeleton): Pick<SurferRig, 'bones' | 'restLocal' | 'restChar'> {
  model.updateMatrixWorld(true);
  const modelInv = new Quaternion();
  model.getWorldQuaternion(modelInv).invert();
  const bones = {} as Record<BoneName, Bone>;
  const restLocal = {} as Record<BoneName, Quaternion>;
  const restChar = {} as Record<BoneName, Quaternion>;
  for (const name of DRIVEN_BONES) {
    const bone = skeleton.getBoneByName(name);
    if (!bone) throw new Error(`Surfer rig is missing bone "${name}"`);
    bones[name] = bone;
    restLocal[name] = bone.quaternion.clone();
    restChar[name] = modelInv.clone().multiply(bone.getWorldQuaternion(new Quaternion()));
  }
  return { bones, restLocal, restChar };
}

/** Paints vertex colors by region and swaps in a retro Lambert material. */
export function recolorSkinnedMesh(mesh: SkinnedMesh, model: Object3D, look: SurferLook): void {
  model.updateMatrixWorld(true);
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const toModel = new Matrix4().copy(model.matrixWorld).invert().multiply(mesh.matrixWorld);
  const bones = mesh.skeleton.bones;
  const head = mesh.skeleton.getBoneByName('Head')!;
  const top = mesh.skeleton.getBoneByName('HeadTop_End')!;
  const worldToModel = new Matrix4().copy(model.matrixWorld).invert();
  const hy = head.getWorldPosition(new Vector3()).applyMatrix4(worldToModel).y;
  const ty = top.getWorldPosition(new Vector3()).applyMatrix4(worldToModel).y;
  const headCenterY = (hy + ty) / 2;
  const colors = regionColors(look);
  const out = new Float32Array(pos.count * 3);
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
    const bone = bones[si.getComponent(i, best)]!.name;
    p.fromBufferAttribute(pos, i).applyMatrix4(toModel);
    const c = colors[regionFor(bone, p, headCenterY)];
    out.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(out, 3));
  const old = mesh.material;
  (Array.isArray(old) ? old : [old]).forEach((m) => m.dispose());
  mesh.material = lambertVertexColors();
}

/** Wraps a loaded glTF scene (Quaternius Animated Human) into a normalized SurferRig. */
export function rigFromGltfScene(scene: Object3D, look: SurferLook): SurferRig {
  let mesh: SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new Error('Surfer model has no SkinnedMesh');
  const skinned = mesh as SkinnedMesh;
  skinned.skeleton.pose(); // bind (T) pose, not whatever the file's nodes hold
  skinned.frustumCulled = false;
  const model = new Group();
  model.add(scene);
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const k = TARGET_HEIGHT / Math.max(1e-6, box.max.y - box.min.y);
  scene.scale.multiplyScalar(k);
  scene.position.y -= box.min.y * k;
  recolorSkinnedMesh(skinned, model, look);
  return { model, mesh: skinned, ...collectRest(model, skinned.skeleton) };
}

/** Rest joint positions (m, character space) for the procedural fallback rig. */
export const REST_JOINTS: Record<string, { parent: string | null; pos: [number, number, number] }> = {
  Hips: { parent: null, pos: [0, 0.9, 0] },
  Spine: { parent: 'Hips', pos: [0, 0.98, 0] },
  Spine1: { parent: 'Spine', pos: [0, 1.1, 0] },
  Spine2: { parent: 'Spine1', pos: [0, 1.24, 0] },
  Neck: { parent: 'Spine2', pos: [0, 1.4, 0] },
  Head: { parent: 'Neck', pos: [0, 1.47, 0] },
  HeadTop_End: { parent: 'Head', pos: [0, 1.75, 0] },
  LeftShoulder: { parent: 'Spine2', pos: [0, 1.38, -0.06] },
  LeftArm: { parent: 'LeftShoulder', pos: [0, 1.34, -0.19] },
  LeftForeArm: { parent: 'LeftArm', pos: [0, 1.3, -0.47] },
  LeftHand: { parent: 'LeftForeArm', pos: [0, 1.27, -0.75] },
  LeftHandTip: { parent: 'LeftHand', pos: [0, 1.26, -0.93] },
  RightShoulder: { parent: 'Spine2', pos: [0, 1.38, 0.06] },
  RightArm: { parent: 'RightShoulder', pos: [0, 1.34, 0.19] },
  RightForeArm: { parent: 'RightArm', pos: [0, 1.3, 0.47] },
  RightHand: { parent: 'RightForeArm', pos: [0, 1.27, 0.75] },
  RightHandTip: { parent: 'RightHand', pos: [0, 1.26, 0.93] },
  LeftUpLeg: { parent: 'Hips', pos: [0, 0.84, -0.08] },
  LeftLeg: { parent: 'LeftUpLeg', pos: [0, 0.45, -0.1] },
  LeftFoot: { parent: 'LeftLeg', pos: [0, 0.06, -0.11] },
  LeftToe_End: { parent: 'LeftFoot', pos: [0.19, 0.0, -0.1] },
  RightUpLeg: { parent: 'Hips', pos: [0, 0.84, 0.08] },
  RightLeg: { parent: 'RightUpLeg', pos: [0, 0.45, 0.1] },
  RightFoot: { parent: 'RightLeg', pos: [0, 0.06, 0.11] },
  RightToe_End: { parent: 'RightFoot', pos: [0.19, 0.0, 0.1] },
};

/** [from joint, to joint, width, depth, region] boxes skinned rigidly to `from`. */
const SEGMENTS: ReadonlyArray<readonly [string, string, number, number, Region]> = [
  ['Hips', 'Spine1', 0.32, 0.2, 'shorts'],
  ['Spine1', 'Neck', 0.36, 0.22, 'top'],
  ['Neck', 'Head', 0.1, 0.1, 'skin'],
  ['Head', 'HeadTop_End', 0.22, 0.24, 'skin'],
  ['LeftArm', 'LeftForeArm', 0.1, 0.1, 'top'],
  ['LeftForeArm', 'LeftHand', 0.08, 0.08, 'skin'],
  ['LeftHand', 'LeftHandTip', 0.09, 0.04, 'skin'],
  ['RightArm', 'RightForeArm', 0.1, 0.1, 'top'],
  ['RightForeArm', 'RightHand', 0.08, 0.08, 'skin'],
  ['RightHand', 'RightHandTip', 0.09, 0.04, 'skin'],
  ['LeftUpLeg', 'LeftLeg', 0.15, 0.15, 'shorts'],
  ['LeftLeg', 'LeftFoot', 0.11, 0.11, 'skin'],
  ['LeftFoot', 'LeftToe_End', 0.09, 0.08, 'skin'],
  ['RightUpLeg', 'RightLeg', 0.15, 0.15, 'shorts'],
  ['RightLeg', 'RightFoot', 0.11, 0.11, 'skin'],
  ['RightFoot', 'RightToe_End', 0.09, 0.08, 'skin'],
];

/** Rigidly skins every vertex of `g` to bone `boneIndex` and paints it one color. */
function skinRigid(g: BufferGeometry, boneIndex: number, c: Color): void {
  const n = g.getAttribute('position').count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = boneIndex;
    w[i * 4] = 1;
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('skinIndex', new BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new BufferAttribute(w, 4));
  g.setAttribute('color', new BufferAttribute(col, 3));
}

/**
 * Fallback: a segmented low-poly humanoid with a THREE.Skeleton built in code,
 * same bone names and rest layout as the glTF model. Used if the model fails
 * to load (and in unit tests).
 */
export function buildProceduralRig(look: SurferLook): SurferRig {
  const names = Object.keys(REST_JOINTS);
  const boneMap = new Map<string, Bone>();
  for (const name of names) {
    const b = new Bone();
    b.name = name;
    boneMap.set(name, b);
  }
  let root: Bone | null = null;
  for (const name of names) {
    const { parent, pos } = REST_JOINTS[name]!;
    const b = boneMap.get(name)!;
    if (parent) {
      const pp = REST_JOINTS[parent]!.pos;
      b.position.set(pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]);
      boneMap.get(parent)!.add(b);
    } else {
      b.position.set(...pos);
      root = b;
    }
  }
  const boneList = names.map((n) => boneMap.get(n)!);
  const colors = regionColors(look);
  const parts: BufferGeometry[] = [];
  const up = new Vector3(0, 1, 0);
  for (const [from, to, w, d, region] of SEGMENTS) {
    const a = new Vector3(...REST_JOINTS[from]!.pos);
    const b = new Vector3(...REST_JOINTS[to]!.pos);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const g = new BoxGeometry(w, len, d).toNonIndexed();
    g.deleteAttribute('uv');
    g.applyQuaternion(new Quaternion().setFromUnitVectors(up, dir.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    skinRigid(g, names.indexOf(from), colors[region]);
    parts.push(g);
  }
  // Hair cap.
  const hair = new BoxGeometry(0.24, 0.1, 0.26).toNonIndexed();
  hair.deleteAttribute('uv');
  hair.translate(-0.01, 1.72, 0);
  skinRigid(hair, names.indexOf('Head'), colors.hair);
  parts.push(hair);

  const geometry = mergeGeometries(parts);
  const mesh = new SkinnedMesh(geometry, lambertVertexColors());
  mesh.frustumCulled = false;
  mesh.add(root!);
  const skeleton = new Skeleton(boneList);
  mesh.bind(skeleton);
  const model = new Group();
  model.add(mesh);
  return { model, mesh, ...collectRest(model, skeleton) };
}
