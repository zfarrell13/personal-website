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
  | 'bottomTurnToe'
  | 'bottomTurnHeel'
  | 'topTurnToe'
  | 'topTurnHeel'
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
  'bottomTurnToe',
  'bottomTurnHeel',
  'topTurnToe',
  'topTurnHeel',
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

/** Bottom turn: compressed, knees deep, chest forward over the front foot (Spine roll + = toward the nose). */
const BOTTOM_LEGS: PoseBones = { LeftUpLeg: [-62, 0, 22], LeftLeg: [108, 0, 0], LeftFoot: [-40, 0, -10], RightUpLeg: [-62, 0, -22], RightLeg: [108, 0, 0], RightFoot: [-40, 0, 10] };
/** Top turn / cutback: tall, legs nearly straight, upper body upright and back over the tail (Spine roll −). */
const TOP_LEGS: PoseBones = { LeftUpLeg: [-6, 0, 22], LeftLeg: [12, 0, 0], LeftFoot: [-6, 0, -10], RightUpLeg: [-6, 0, -22], RightLeg: [12, 0, 0], RightFoot: [-6, 0, 10] };

const pose = (overrides: PoseBones): Pose => ({ bones: { ...STANCE, ...overrides } });

export const POSES: Record<PoseName, Pose> = {
  stance: pose({}),
  carveToe: pose({ Hips: [22, -15, 0], Spine: [20, 0, 0], LeftUpLeg: [-38, 0, 22], LeftLeg: [65, 0, 0], RightUpLeg: [-38, 0, -22], RightLeg: [65, 0, 0], LeftArm: [10, -25, -40], RightArm: [10, -25, 40] }),
  carveHeel: pose({ Hips: [-8, -15, 0], Spine: [-18, 0, 0], Head: [5, -35, 0], LeftUpLeg: [-35, 0, 22], LeftLeg: [60, 0, 0], RightUpLeg: [-35, 0, -22], RightLeg: [60, 0, 0], LeftArm: [0, -35, -30], RightArm: [0, -35, 30] }),
  // Frontside bottom turn (the wave on the chest side): driving through the toe rail, the rear (left)
  // hand reaching down to the face in front, the front arm out over the nose.
  bottomTurnToe: pose({ ...BOTTOM_LEGS, Hips: [28, -15, 0], Spine: [24, 0, 18], Spine1: [12, 0, 0], Spine2: [0, -20, 0], Head: [-40, -30, 0], LeftArm: [10, -50, -50], LeftForeArm: [0, 10, 0], RightArm: [10, 30, 25] }),
  // Backside bottom turn (the wave behind): sitting down on the heels, chest folded over the knees,
  // the rear (left) hand trailing low behind toward the face.
  bottomTurnHeel: pose({ ...BOTTOM_LEGS, LeftUpLeg: [-50, 0, 22], RightUpLeg: [-50, 0, -22], Hips: [-12, -15, 0], Spine: [40, 0, 18], Spine1: [12, 0, 0], Spine2: [0, -25, 0], Head: [-35, -35, 0], LeftArm: [0, 30, -100], LeftForeArm: [0, 10, 0], RightArm: [0, 70, 15] }),
  // Backside top turn: tall, back on the tail, swinging toward the chest side; shoulders and head
  // turning into the new line, arms up and out leading it.
  topTurnToe: pose({ ...TOP_LEGS, Hips: [6, -5, 0], Spine: [2, 0, -16], Spine1: [0, 0, -4], Spine2: [0, 10, 0], Neck: [0, -10, 0], Head: [5, -20, 0], LeftArm: [-15, 25, -5], RightArm: [30, -10, 0] }),
  // Frontside top turn / cutback: tall, leaning back on the tail and the heel rail, chest opening
  // toward the nose and the turn, arms up and out.
  topTurnHeel: pose({ ...TOP_LEGS, Hips: [-6, -25, 0], Spine: [-8, 0, -16], Spine1: [0, 0, -4], Spine2: [0, -35, 0], Neck: [0, -20, 0], Head: [10, -40, 0], LeftArm: [10, 30, -5], RightArm: [-25, -30, 0] }),
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
