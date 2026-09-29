import type { BoneName } from './rig';

/**
 * Pose angles in DEGREES, as rotations in character space (NOT bone-local):
 *   pitch — about the character's LEFT axis: + bends forward (toward +x, the wave).
 *   yaw   — about UP: + turns toward the character's left (the board tail).
 *   roll  — about FORWARD: + tilts toward the character's right (the board nose);
 *           so LeftArm roll − lowers the left arm, RightArm roll + lowers the right.
 * A child's rotation composes on top of its parent's (thigh then shin).
 */
export type BodyAngles = readonly [pitch: number, yaw: number, roll: number];
export type PoseBones = Partial<Record<BoneName, BodyAngles>>;

export interface Pose {
  bones: PoseBones;
}

export type PoseName =
  | 'stance'
  | 'carveToe'
  | 'carveHeel'
  | 'crouch'
  | 'pump'
  | 'stall'
  | 'ollie'
  | 'grabMethod'
  | 'grabRail'
  | 'grabStalefish'
  | 'grabIndy'
  | 'spinTuck'
  | 'land'
  | 'wipeout';

export const POSE_NAMES: readonly PoseName[] = [
  'stance',
  'carveToe',
  'carveHeel',
  'crouch',
  'pump',
  'stall',
  'ollie',
  'grabMethod',
  'grabRail',
  'grabStalefish',
  'grabIndy',
  'spinTuck',
  'land',
  'wipeout',
];

/** Side-on surf stance: wide feet along the board, knees bent, arms out, looking at the nose. */
const STANCE: PoseBones = {
  Hips: [10, -15, 0],
  Spine: [10, 0, 0],
  Spine1: [5, 0, 0],
  Spine2: [0, -15, 0],
  Neck: [0, -20, 0],
  Head: [-10, -35, 0],
  LeftArm: [0, 10, -55],
  LeftForeArm: [0, 15, 0],
  LeftHand: [0, 0, 0],
  RightArm: [0, 10, 55],
  RightForeArm: [0, 15, 0],
  RightHand: [0, 0, 0],
  LeftUpLeg: [-25, 0, 22],
  LeftLeg: [45, 0, 0],
  LeftFoot: [-20, 0, -10],
  RightUpLeg: [-25, 0, -22],
  RightLeg: [45, 0, 0],
  RightFoot: [-20, 0, 10],
};

const TUCK: PoseBones = { LeftUpLeg: [-65, 0, 18], LeftLeg: [105, 0, 0], RightUpLeg: [-65, 0, -18], RightLeg: [105, 0, 0] };

const pose = (overrides: PoseBones): Pose => ({ bones: { ...STANCE, ...overrides } });

export const POSES: Record<PoseName, Pose> = {
  stance: pose({}),
  carveToe: pose({ Hips: [22, -15, 0], Spine: [20, 0, 0], LeftUpLeg: [-38, 0, 22], LeftLeg: [65, 0, 0], RightUpLeg: [-38, 0, -22], RightLeg: [65, 0, 0], LeftArm: [10, -25, -40], RightArm: [10, -25, 40] }),
  carveHeel: pose({ Hips: [-8, -15, 0], Spine: [-18, 0, 0], Head: [5, -35, 0], LeftUpLeg: [-35, 0, 22], LeftLeg: [60, 0, 0], RightUpLeg: [-35, 0, -22], RightLeg: [60, 0, 0], LeftArm: [0, -35, -30], RightArm: [0, -35, 30] }),
  crouch: pose({ Hips: [30, -15, 0], Spine: [30, 0, 0], Spine1: [10, 0, 0], Head: [-35, -25, 0], LeftUpLeg: [-55, 0, 20], LeftLeg: [95, 0, 0], LeftFoot: [-40, 0, -10], RightUpLeg: [-55, 0, -20], RightLeg: [95, 0, 0], RightFoot: [-40, 0, 10], LeftArm: [0, -40, -30], RightArm: [20, -30, 60] }),
  pump: pose({ Spine: [22, 0, 0], LeftUpLeg: [-42, 0, 22], LeftLeg: [75, 0, 0], RightUpLeg: [-42, 0, -22], RightLeg: [75, 0, 0] }),
  stall: pose({ Hips: [-12, -15, 0], Spine: [-22, 0, 0], LeftUpLeg: [-38, 0, 22], LeftLeg: [65, 0, 0], RightUpLeg: [-12, 0, -22], RightLeg: [18, 0, 0], LeftArm: [0, 0, -20], RightArm: [0, 0, 20] }),
  ollie: pose({ ...TUCK, Spine: [25, 0, 0], LeftArm: [0, 10, -30], RightArm: [0, 10, 30] }),
  grabMethod: pose({ ...TUCK, Spine: [-15, 0, 0], Head: [-10, -55, 0], LeftArm: [-40, 0, -80] }),
  grabRail: pose({ ...TUCK, Spine: [30, 0, 0], RightArm: [30, 0, 85] }),
  grabStalefish: pose({ ...TUCK, Spine: [10, 0, 0], Spine2: [0, 20, 0], LeftArm: [-60, 0, -85] }),
  grabIndy: pose({ ...TUCK, Spine: [40, 0, 0], RightArm: [45, 0, 80] }),
  spinTuck: pose({ ...TUCK, Spine: [20, 0, 0], LeftArm: [0, -50, -70], RightArm: [0, -50, 70] }),
  land: pose({ Spine: [30, 0, 0], LeftUpLeg: [-50, 0, 22], LeftLeg: [85, 0, 0], RightUpLeg: [-50, 0, -22], RightLeg: [85, 0, 0], LeftArm: [0, 10, -40], RightArm: [0, 10, 40] }),
  wipeout: pose({ Spine: [-40, 0, 0], Head: [-30, 0, 0], LeftArm: [0, 0, 40], RightArm: [0, 0, -40], LeftUpLeg: [-20, 0, 40], RightUpLeg: [-20, 0, -40], LeftLeg: [30, 0, 0], RightLeg: [30, 0, 0] }),
};

export type PoseWeights = Partial<Record<PoseName, number>>;
