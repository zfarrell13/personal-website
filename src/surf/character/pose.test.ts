import { describe, expect, it } from 'vitest';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { Surfer } from '../physics/Surfer';
import { WaveShape } from '../wave/WaveShape';
import { PoseLayer, poseWeights } from './PoseLayer';
import type { PoseWeights } from './poses';
import { boneWorld, TEST_RIGS } from './testRigs';

describe.each(TEST_RIGS)('pose layer on the %s rig', (_name, make) => {
  it('stance lowers the arms and spreads the feet along z', async () => {
    const rig = await make();
    new PoseLayer(rig).snap({ stance: 1 });
    expect(boneWorld(rig, 'LeftHand').y).toBeLessThan(boneWorld(rig, 'LeftArm').y - 0.2);
    expect(boneWorld(rig, 'RightHand').y).toBeLessThan(boneWorld(rig, 'RightArm').y - 0.2);
    expect(boneWorld(rig, 'RightFoot').z - boneWorld(rig, 'LeftFoot').z).toBeGreaterThan(0.45);
  });

  it('crouch lowers the head; toe-side carve leans toward +x, heel-side toward −x', async () => {
    const rig = await make();
    const layer = new PoseLayer(rig);
    layer.snap({ stance: 1 });
    const standHead = boneWorld(rig, 'Head');
    layer.snap({ crouch: 1 });
    expect(boneWorld(rig, 'Head').y).toBeLessThan(standHead.y - 0.05);
    layer.snap({ carveToe: 1 });
    const toe = boneWorld(rig, 'Head').x;
    layer.snap({ carveHeel: 1 });
    expect(toe).toBeGreaterThan(boneWorld(rig, 'Head').x + 0.2);
  });

  it('springs converge toward the target without overshoot', async () => {
    const layer = new PoseLayer(await make());
    layer.snap({ stance: 1 });
    let prev = layer.angles('LeftLeg')[0];
    for (let i = 0; i < 120; i++) {
      layer.update({ crouch: 1 }, 1 / 60);
      const now = layer.angles('LeftLeg')[0];
      expect(now).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(now).toBeLessThanOrEqual(95 + 1e-9);
      prev = now;
    }
    expect(prev).toBeCloseTo(95, 1);
  });
});

describe('poseWeights', () => {
  const make = () => {
    const cfg = structuredClone(SURF_CONFIG);
    return new Surfer(new WaveShape(cfg.wave), cfg.physics, new EventBus<SurfEvent>()).state;
  };
  it('picks the toe/heel rail by the board\'s yaw and stance', () => {
    const s = make();
    s.v.set(8, 0, 0);
    s.turnRate = 2.5;
    s.carve = 1;
    // The turn's pose (bottom turn / carve / top turn) on the toe rail or the heel rail.
    const toe = (w: PoseWeights) => (w.bottomTurnToe ?? 0) + (w.carveToe ?? 0) + (w.topTurnToe ?? 0);
    const heel = (w: PoseWeights) => (w.bottomTurnHeel ?? 0) + (w.carveHeel ?? 0) + (w.topTurnHeel ?? 0);
    expect(toe(poseWeights(s, 10))).toBeGreaterThan(0.5);
    s.stanceFlipped = true;
    expect(heel(poseWeights(s, 10))).toBeGreaterThan(0.5);
    // Backside (back to the wave), a turn toward the lip is on the heels.
    s.stanceFlipped = false;
    expect(heel(poseWeights(s, 10, {}, true))).toBeGreaterThan(0.5);
    expect(toe(poseWeights(s, 10, {}, true))).toBe(0);
  });
  it('uses grab, tube and wipeout poses', () => {
    const s = make();
    s.mode = 'airborne';
    s.launchKind = 'ollie';
    s.grab = 'indy';
    expect(poseWeights(s, 10)).toEqual({ grabIndy: 1 });
    s.mode = 'riding';
    s.launchKind = null;
    s.grab = null;
    s.inTube = true;
    expect(poseWeights(s, 10).crouch).toBeCloseTo(0.85);
    s.mode = 'wipeout';
    expect(poseWeights(s, 10)).toEqual({ wipeout: 1 });
  });
  it('trick-air poses only for real launches; a silent floater air keeps the riding pose', () => {
    const s = make();
    s.mode = 'airborne';
    s.launchKind = null; // silent mount / dismount
    s.airTime = 0.1;
    s.turnRate = 0;
    s.floating = false;
    const w = poseWeights(s, 10);
    expect(w.ollie).toBeUndefined();
    expect(w.spinTuck).toBeUndefined();
    expect(w.stance).toBeGreaterThan(0.5);
    s.launchKind = 'ollie';
    expect(poseWeights(s, 10)).toEqual({ ollie: 1 });
    s.airTime = 0.5;
    s.launchKind = 'crest';
    expect(poseWeights(s, 10)).toEqual({ spinTuck: 0.5, stance: 0.5 });
  });
  it('reuses a caller-owned weights object and zeroes stale poses', () => {
    const s = make();
    const out = {};
    s.mode = 'wipeout';
    expect(poseWeights(s, 10, out)).toBe(out);
    expect(out).toEqual({ wipeout: 1 });
    s.mode = 'riding';
    expect(poseWeights(s, 10, out)).toBe(out);
    expect((out as { wipeout: number }).wipeout).toBe(0);
    expect((out as { stance: number }).stance).toBe(1);
  });
  it('leanScale only scales carve lean, not crouch depth', async () => {
    const layer = new PoseLayer(await TEST_RIGS[0]![1]());
    layer.snap({ crouch: 1 });
    const crouch = layer.angles('LeftLeg')[0];
    for (let i = 0; i < 200; i++) layer.update({ crouch: 1 }, 1 / 60, 0.6);
    expect(layer.angles('LeftLeg')[0]).toBeCloseTo(crouch, 3);
    const a = new PoseLayer(await TEST_RIGS[0]![1]());
    const b = new PoseLayer(await TEST_RIGS[0]![1]());
    a.snap({ stance: 1 }); b.snap({ stance: 1 });
    for (let i = 0; i < 200; i++) { a.update({ carveToe: 1 }, 1 / 60, 0.6); b.update({ carveToe: 1 }, 1 / 60, 1.2); }
    expect(b.angles('Hips')[0]).toBeGreaterThan(a.angles('Hips')[0] + 1);
  });
  it('weights sum to one', () => {
    const s = make();
    s.v.set(6, 0, 0);
    s.turnRate = 1.2;
    s.carve = -1;
    s.inTube = true;
    s.sincePump = 0.1;
    const sum = Object.values(poseWeights(s, 0.1)).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});
