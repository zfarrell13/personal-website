import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SURF_CONFIG, SURFER_LOOK } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { Surfer } from '../physics/Surfer';
import { WaveShape } from '../wave/WaveShape';
import { Character, faceHeight } from './Character';
import { PoseLayer, poseWeights, turnPhase } from './PoseLayer';
import { POSE_NAMES, type PoseName } from './poses';
import { boneWorld, TEST_RIGS } from './testRigs';

/** Character-space snapshot of a pose: +x chest side (toe rail), +z the nose (front foot). */
function measure(layer: PoseLayer, name: PoseName) {
  layer.snap({ [name]: 1 });
  const rig = layer.rig;
  const head = boneWorld(rig, 'Head');
  const hips = boneWorld(rig, 'Hips');
  const feet = boneWorld(rig, 'LeftFoot').add(boneWorld(rig, 'RightFoot')).multiplyScalar(0.5);
  const lowFoot = Math.min(boneWorld(rig, 'LeftFoot').y, boneWorld(rig, 'RightFoot').y);
  const handL = boneWorld(rig, 'LeftHand');
  const handR = boneWorld(rig, 'RightHand');
  return {
    /** Head height above the lower foot (what plantFeet keeps on the deck). */
    height: head.y - lowFoot,
    /** Head toward the nose (over the front foot) vs toward the tail. */
    nose: head.z - feet.z,
    /** Head toward the chest / toe rail vs the heel rail. */
    toe: head.x - feet.x,
    /** How far the torso folds forward toward the chest side. */
    fold: head.x - hips.x,
    /** Height (above the lower foot) of the hand on the toe side and the heel side. */
    toeHand: (handL.x > handR.x ? handL : handR).y - lowFoot,
    heelHand: (handL.x > handR.x ? handR : handL).y - lowFoot,
  };
}

describe.each(TEST_RIGS)('maneuver posture on the %s rig', (_name, make) => {
  it('a bottom turn is lower and further over the front foot than the stance; a top turn taller and back on the tail', async () => {
    const layer = new PoseLayer(await make());
    const stance = measure(layer, 'stance');
    for (const side of ['Toe', 'Heel'] as const) {
      const bottom = measure(layer, `bottomTurn${side}`);
      const top = measure(layer, `topTurn${side}`);
      expect(bottom.height, side).toBeLessThan(stance.height - 0.15);
      expect(top.height, side).toBeGreaterThan(stance.height + 0.04);
      expect(bottom.nose, side).toBeGreaterThan(stance.nose + 0.08);
      expect(top.nose, side).toBeLessThan(stance.nose - 0.08);
      // The torso folds forward in a bottom turn and stands up in a top turn.
      expect(bottom.fold, side).toBeGreaterThan(stance.fold);
      expect(top.fold, side).toBeLessThan(stance.fold - 0.05);
    }
  });

  it('toe-side variants lean toward the chest, heel-side toward the back', async () => {
    const layer = new PoseLayer(await make());
    for (const kind of ['bottomTurn', 'topTurn'] as const) {
      expect(measure(layer, `${kind}Toe`).toe, kind).toBeGreaterThan(measure(layer, `${kind}Heel`).toe + 0.15);
    }
  });

  it('in a bottom turn the hand nearest the wave drops low by it', async () => {
    const layer = new PoseLayer(await make());
    const stance = measure(layer, 'stance');
    // Toe side: the wave is on the chest side (frontside); heel side: behind the rider (backside).
    expect(measure(layer, 'bottomTurnToe').toeHand).toBeLessThan(stance.toeHand - 0.2);
    expect(measure(layer, 'bottomTurnHeel').heelHand).toBeLessThan(stance.heelHand - 0.2);
  });

  it('keeps both feet planted on the deck in every maneuver pose', async () => {
    const ch = new Character(await make(), SURFER_LOOK);
    const foot = new Vector3();
    const deckY = (bone: 'LeftFoot' | 'RightFoot') => {
      ch.root.updateMatrixWorld(true);
      return ch.root.worldToLocal(ch.rig.bones[bone].getWorldPosition(foot)).y;
    };
    for (const name of ['stance', 'bottomTurnToe', 'bottomTurnHeel', 'topTurnToe', 'topTurnHeel'] as const) {
      ch.pose.snap({ [name]: 1 });
      ch.plantFeet();
      const l = deckY('LeftFoot');
      const r = deckY('RightFoot');
      expect(Math.min(l, r), name).toBeGreaterThan(0.05);
      expect(Math.min(l, r), name).toBeLessThan(0.25);
      expect(Math.abs(l - r), name).toBeLessThan(0.06);
    }
  });
});

describe('faceHeight', () => {
  it('is 0 at the trough and 1 at the crest', () => {
    const cfg = structuredClone(SURF_CONFIG);
    const surfer = new Surfer(new WaveShape(cfg.wave), cfg.physics, new EventBus<SurfEvent>());
    const s = surfer.state;
    const x = s.param.x;
    surfer.wave.profile(x, 0, s.p);
    expect(faceHeight(surfer)).toBeLessThan(0.02);
    surfer.wave.profile(x, surfer.wave.crestT(x), s.p);
    expect(faceHeight(surfer)).toBeGreaterThan(0.98);
    surfer.wave.profile(x, surfer.wave.crestT(x) * 0.5, s.p);
    expect(faceHeight(surfer)).toBeGreaterThan(0.1);
    expect(faceHeight(surfer)).toBeLessThan(0.9);
  });
});

describe('maneuver pose weights', () => {
  const make = () => {
    const cfg = structuredClone(SURF_CONFIG);
    return new Surfer(new WaveShape(cfg.wave), cfg.physics, new EventBus<SurfEvent>()).state;
  };
  /** A rider on a 45° face (normal tilted toward +z), running along it, turning hard. */
  const onFace = (heading: Vector3, turnRate: number, carve = 1) => {
    const s = make();
    s.normal.set(0, 1, 1).normalize();
    s.heading.copy(heading).normalize();
    s.v.copy(s.heading).multiplyScalar(8);
    s.turnRate = turnRate;
    s.carve = carve;
    return s;
  };
  // The face rises toward −z (its up-face tangent is (0, 1, −1)/√2); +x is down the line (the shoulder).
  const downTheLine = new Vector3(1, 0, 0);
  const upFace = new Vector3(0, 1, -1).normalize();
  const sumOf = (w: Partial<Record<PoseName, number>>) => POSE_NAMES.reduce((a, n) => a + (w[n] ?? 0), 0);

  it('turnPhase: + while the turn swings the line up the face, − while it swings it back down', () => {
    // A rotation about the normal by +yaw takes down-the-line (+x) toward up the face here.
    const s = onFace(downTheLine, 1);
    const probe = s.heading.clone().applyAxisAngle(s.normal, 0.01);
    expect(probe.y).toBeGreaterThan(0);
    expect(turnPhase(s)).toBeGreaterThan(0.9);
    s.turnRate = -1;
    expect(turnPhase(s)).toBeLessThan(-0.9);
    // Running toward the curl (−x) the same yaw sense swings the line down.
    s.heading.set(-1, 0, 0);
    expect(turnPhase(s)).toBeGreaterThan(0.9);
    // Pointing straight up the face, the turn neither climbs nor drops yet.
    s.heading.copy(upFace);
    expect(Math.abs(turnPhase(s))).toBeLessThan(1e-6);
    // No turn, no phase; on the flats there is no face to climb.
    s.heading.copy(downTheLine);
    s.turnRate = 0;
    expect(turnPhase(s)).toBe(0);
    s.turnRate = 1;
    s.normal.set(0, 1, 0);
    expect(Math.abs(turnPhase(s))).toBeLessThan(1e-6);
  });

  it('a turn up the face low down is a bottom turn; high up or turning back down, a top turn', () => {
    const s = onFace(downTheLine, 2.5);
    const w = poseWeights(s, 10, {}, false, 0.1);
    expect(w.bottomTurnToe).toBeGreaterThan(0.9);
    expect(sumOf(w)).toBeCloseTo(1, 6);
    // Same turn high on the face: the top-turn pose.
    expect(poseWeights(s, 10, {}, false, 0.95).topTurnToe).toBeGreaterThan(0.9);
    // Mid-face, turning back down (carve toward the trough = heel side when frontside).
    const down = onFace(downTheLine, -2.5, -1);
    const wd = poseWeights(down, 10, {}, false, 0.55);
    expect(wd.topTurnHeel).toBeGreaterThan(0.9);
    expect(sumOf(wd)).toBeCloseTo(1, 6);
    // Backside, a turn toward the lip is on the heels: the heel-side bottom turn.
    expect(poseWeights(s, 10, {}, true, 0.1).bottomTurnHeel).toBeGreaterThan(0.9);
  });

  it('a turn still easing out after the key is let go keeps its rail', () => {
    // Swinging up the face running down the line (+x): toward the lip, the toe rail frontside.
    const s = onFace(downTheLine, 2.5, 0);
    expect(poseWeights(s, 10, {}, false, 0.1).bottomTurnToe).toBeGreaterThan(0.9);
    // Swinging back down off the top: the heel rail.
    s.turnRate = -2.5;
    expect(poseWeights(s, 10, {}, false, 0.9).topTurnHeel).toBeGreaterThan(0.9);
  });

  it('a cutback back toward the curl holds the tall pose; coming back down the line low, the crouch returns', () => {
    // Running toward the curl, mid-face, turning back down (the cutback / roundhouse).
    const cut = onFace(new Vector3(-1, -0.3, 0.3), 2.5, -1);
    expect(poseWeights(cut, 10, {}, false, 0.4).topTurnHeel).toBeGreaterThan(0.9);
    // Out of the bounce: running down the line again, low, swinging back up the face.
    const out = onFace(new Vector3(1, -0.2, 0.2), 2.5, 1);
    expect(poseWeights(out, 10, {}, false, 0.25).bottomTurnToe).toBeGreaterThan(0.9);
  });

  it('fades to the stance without a turn and blends continuously across the face', () => {
    const s = onFace(downTheLine, 0);
    expect(poseWeights(s, 10, {}, false, 0.1)).toMatchObject({ stance: 1 });
    s.turnRate = 2.5;
    let prev = { ...poseWeights(s, 10, {}, false, 0) };
    for (let i = 1; i <= 200; i++) {
      const w = { ...poseWeights(s, 10, {}, false, i / 200) };
      expect(sumOf(w)).toBeCloseTo(1, 6);
      for (const n of POSE_NAMES) expect(Math.abs((w[n] ?? 0) - (prev[n] ?? 0)), n).toBeLessThan(0.05);
      prev = w;
    }
    // Overlays still mix in on top (the tube crouch).
    s.inTube = true;
    const w = poseWeights(s, 10, {}, false, 0.1);
    expect(w.crouch).toBeCloseTo(0.85);
    expect(sumOf(w)).toBeCloseTo(1, 6);
  });
});
