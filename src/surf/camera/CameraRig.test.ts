import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { Surfer } from '../physics/Surfer';
import { WaveShape } from '../wave/WaveShape';
import { CAMERA_FAR, cameraGoal, CameraRig } from './CameraRig';

const state = () => {
  const cfg = structuredClone(SURF_CONFIG);
  return new Surfer(new WaveShape(cfg.wave), cfg.physics, new EventBus<SurfEvent>()).state;
};
const goal = () => ({ pos: new Vector3(), look: new Vector3() });

describe('cameraGoal', () => {
  it('chases from the shoulder side, in front and above, looking back at the curl', () => {
    const s = state();
    const g = cameraGoal(s, 'left', 0, false, goal());
    expect(g.pos.x).toBeGreaterThan(s.p.x);
    expect(g.pos.y).toBeGreaterThan(s.p.y);
    expect(g.pos.z).toBeGreaterThan(s.p.z);
    expect(g.look.x).toBeLessThan(s.p.x);
  });
  it('mirrors exactly for a RIGHT', () => {
    const s = state();
    const r = cameraGoal(s, 'left', 0.4, false, goal());
    const l = cameraGoal(s, 'right', 0.4, false, goal());
    expect(l.pos.x).toBeCloseTo(-r.pos.x, 9);
    expect(l.pos.y).toBeCloseTo(r.pos.y, 9);
    expect(l.look.x).toBeCloseTo(-r.look.x, 9);
  });
  it('drops low inside the barrel on the exit side (+x) and looks back at the rider', () => {
    const s = state();
    const g = cameraGoal(s, 'left', 1, false, goal());
    expect(g.pos.x).toBeGreaterThan(s.p.x);
    expect(g.pos.y - s.p.y).toBeLessThan(0.5);
    expect(g.look.x).toBeLessThan(s.p.x);
  });
  it('enters the barrel through the mouth: the path dips below both ends', () => {
    const s = state();
    const chase = cameraGoal(s, 'left', 0, false, goal()).pos.y;
    const tube = cameraGoal(s, 'left', 1, false, goal()).pos.y;
    expect(cameraGoal(s, 'left', 0.5, false, goal()).pos.y).toBeLessThan(Math.min(chase, tube));
  });
  it('never puts a tube camera behind tubeMinX', () => {
    const s = state();
    s.p.x = -9;
    expect(cameraGoal(s, 'left', 1, false, goal(), -4).pos.x).toBe(-4);
    expect(cameraGoal(s, 'right', 1, false, goal(), -4).pos.x).toBe(4);
    // Chase is unaffected.
    expect(cameraGoal(s, 'left', 0, false, goal(), -4).pos.x).toBeCloseTo(-3, 9);
  });
  it('pulls back and up by ~40% in a trick air', () => {
    const s = state();
    const ground = cameraGoal(s, 'left', 0, false, goal()).pos.clone().sub(s.p);
    s.mode = 'airborne';
    s.launchKind = 'crest';
    const air = cameraGoal(s, 'left', 0, false, goal()).pos.clone().sub(s.p);
    expect(air.length() / ground.length()).toBeGreaterThan(1.35);
    expect(air.y).toBeGreaterThan(ground.y);
  });
  it('keeps the riding camera in a silent air (launchKind null)', () => {
    const s = state();
    const ground = cameraGoal(s, 'left', 0, false, goal()).pos.clone();
    s.mode = 'airborne';
    s.launchKind = null;
    expect(cameraGoal(s, 'left', 0, false, goal()).pos.distanceTo(ground)).toBeCloseTo(0, 9);
  });
});

describe('CameraRig', () => {
  it('CameraRig eases toward the goal', () => {
    const s = state();
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam, SURF_CONFIG.camera);
    rig.snap(s, 'left');
    s.p.x += 5;
    const before = rig.pos.clone();
    rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.x).toBeGreaterThan(before.x);
    for (let i = 0; i < 600; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.distanceTo(cameraGoal(s, 'left', 0, false, goal()).pos)).toBeLessThan(0.01);
  });
  it('the underwater cut drops the springs\' velocity: the next shot eases from rest', () => {
    const s = state();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera);
    rig.snap(s, 'left');
    // Build up a large +x camera velocity.
    s.p.x += 40;
    for (let i = 0; i < 10; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    s.mode = 'wipeout';
    rig.update(s, s.p, 'left', true, 1 / 60);
    const cut = rig.pos.clone();
    // Surface with the chase goal behind the camera in x: with stale velocity it would keep moving +x.
    s.mode = 'riding';
    s.p.x -= 10;
    rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.x).toBeLessThan(cut.x);
  });
  it('extends the far plane past the sky dome (600 m) and sun sprite (500 m)', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    new CameraRig(cam, SURF_CONFIG.camera);
    expect(CAMERA_FAR).toBeGreaterThanOrEqual(650);
    expect(cam.far).toBeGreaterThanOrEqual(650);
  });
});
