import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { SURF_CONFIG } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { NO_INPUT } from '../physics/input';
import { Surfer } from '../physics/Surfer';
import { buildWaveGeometry, columnsX } from '../render/waveGeometry';
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
    const g = cameraGoal(s, 'right', 0, false, goal());
    expect(g.pos.x).toBeGreaterThan(s.p.x);
    expect(g.pos.y).toBeGreaterThan(s.p.y);
    expect(g.pos.z).toBeGreaterThan(s.p.z);
    expect(g.look.x).toBeLessThan(s.p.x);
  });
  it('mirrors exactly for a LEFT', () => {
    const s = state();
    const r = cameraGoal(s, 'right', 0.4, false, goal());
    const l = cameraGoal(s, 'left', 0.4, false, goal());
    expect(l.pos.x).toBeCloseTo(-r.pos.x, 9);
    expect(l.pos.y).toBeCloseTo(r.pos.y, 9);
    expect(l.look.x).toBeCloseTo(-r.look.x, 9);
  });
  it('drops low inside the barrel on the exit side (+x) and looks back at the rider', () => {
    const s = state();
    const g = cameraGoal(s, 'right', 1, false, goal());
    expect(g.pos.x).toBeGreaterThan(s.p.x);
    expect(g.pos.y - s.p.y).toBeLessThan(0.5);
    expect(g.look.x).toBeLessThan(s.p.x);
  });
  it('enters the barrel through the mouth: the path dips below both ends', () => {
    const s = state();
    const chase = cameraGoal(s, 'right', 0, false, goal()).pos.y;
    const tube = cameraGoal(s, 'right', 1, false, goal()).pos.y;
    expect(cameraGoal(s, 'right', 0.5, false, goal()).pos.y).toBeLessThan(Math.min(chase, tube));
  });
  it('never puts a tube camera behind tubeMinX', () => {
    const s = state();
    s.p.x = -9;
    expect(cameraGoal(s, 'right', 1, false, goal(), -4).pos.x).toBe(-4);
    expect(cameraGoal(s, 'left', 1, false, goal(), -4).pos.x).toBe(4);
    // Chase is unaffected.
    expect(cameraGoal(s, 'right', 0, false, goal(), -4).pos.x).toBeCloseTo(-3, 9);
  });
  it('pulls back and up by ~40% in a trick air', () => {
    const s = state();
    const ground = cameraGoal(s, 'right', 0, false, goal()).pos.clone().sub(s.p);
    s.mode = 'airborne';
    s.launchKind = 'crest';
    const air = cameraGoal(s, 'right', 0, false, goal()).pos.clone().sub(s.p);
    expect(air.length() / ground.length()).toBeGreaterThan(1.35);
    expect(air.y).toBeGreaterThan(ground.y);
  });
  it('keeps the riding camera in a silent air (launchKind null)', () => {
    const s = state();
    const ground = cameraGoal(s, 'right', 0, false, goal()).pos.clone();
    s.mode = 'airborne';
    s.launchKind = null;
    expect(cameraGoal(s, 'right', 0, false, goal()).pos.distanceTo(ground)).toBeCloseTo(0, 9);
  });
});

describe('CameraRig', () => {
  it('CameraRig eases toward the goal', () => {
    const s = state();
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam, SURF_CONFIG.camera);
    rig.snap(s, 'right');
    s.p.x += 5;
    const before = rig.pos.clone();
    rig.update(s, s.p, 'right', false, 1 / 60);
    expect(rig.pos.x).toBeGreaterThan(before.x);
    for (let i = 0; i < 600; i++) rig.update(s, s.p, 'right', false, 1 / 60);
    expect(rig.pos.distanceTo(cameraGoal(s, 'right', 0, false, goal()).pos)).toBeLessThan(0.01);
  });
  it('the underwater cut drops the springs\' velocity: the next shot eases from rest', () => {
    const s = state();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera);
    rig.snap(s, 'right');
    // Build up a large +x camera velocity.
    s.p.x += 40;
    for (let i = 0; i < 10; i++) rig.update(s, s.p, 'right', false, 1 / 60);
    s.mode = 'wipeout';
    rig.update(s, s.p, 'right', true, 1 / 60);
    const cut = rig.pos.clone();
    // Surface with the chase goal behind the camera in x: with stale velocity it would keep moving +x.
    s.mode = 'riding';
    s.p.x -= 10;
    rig.update(s, s.p, 'right', false, 1 / 60);
    expect(rig.pos.x).toBeLessThan(cut.x);
  });
  it('extends the far plane past the sky dome (600 m) and sun sprite (500 m)', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    new CameraRig(cam, SURF_CONFIG.camera);
    expect(CAMERA_FAR).toBeGreaterThanOrEqual(650);
    expect(cam.far).toBeGreaterThanOrEqual(650);
  });
});

describe('CameraRig in the barrel (real wave mesh, real surfer)', () => {
  /**
   * Stall into the tube and ride it. After the chase → tube move the rider must
   * stay visible (no wave surface between camera and board or chest), on screen,
   * and the camera must never be under the water surface.
   */
  function rideTube(releaseAfter: number | null) {
    const cfg = structuredClone(SURF_CONFIG);
    const wave = new WaveShape(cfg.wave);
    const surfer = new Surfer(wave, cfg.physics, new EventBus<SurfEvent>());
    const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
    front.updateMatrixWorld();
    const cam = new PerspectiveCamera(cfg.camera.fov, 16 / 9, 0.1, 650);
    const rig = new CameraRig(cam, cfg.camera);
    rig.snap(surfer.state, 'right');
    const s = surfer.state;
    const ray = new Raycaster();
    const target = new Vector3();
    const dir = new Vector3();
    const UP = new Vector3(0, 1, 0);
    const ndc = new Vector3();
    const blocked = (h: number) => {
      target.copy(s.p).addScaledVector(s.normal, h);
      dir.subVectors(target, rig.pos);
      const dist = dir.length();
      ray.set(rig.pos, dir.normalize());
      ray.far = dist - 0.2;
      return ray.intersectObject(front, false).length > 0;
    };
    let entered = -1;
    let firstVisible = -1;
    let hiddenAfter = 0;
    let wet = 0;
    let tubeFrames = 0;
    for (let f = 0; f < 60 * 8; f++) {
      const t = entered < 0 ? 0 : (f - entered) / 60;
      const stall = f >= 60 && (releaseAfter === null || entered < 0 || t < releaseAfter);
      for (let k = 0; k < 2; k++) surfer.step({ ...NO_INPUT, stall }, 1 / 120);
      rig.update(s, s.p, 'right', false, 1 / 60);
      if (s.mode !== 'riding' || (entered >= 0 && !s.inTube)) break;
      if (!s.inTube) continue;
      if (entered < 0) entered = f;
      tubeFrames++;
      cam.updateMatrixWorld();
      ndc.copy(s.p).addScaledVector(s.normal, 0.9).project(cam);
      const seen = !blocked(0.2) && !blocked(0.9) && ndc.z < 1 && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.9;
      if (seen && firstVisible < 0) firstVisible = (f - entered) / 60;
      if (!seen && firstVisible >= 0) hiddenAfter++;
      ray.set(rig.pos, UP);
      ray.far = 50;
      const above = ray.intersectObject(front, false)[0];
      if (above && above.face!.normal.y > 0) wet++;
    }
    return { tubeFrames, firstVisible, hiddenAfter, wet };
  }

  // With hollowLength 12 the approach face is more open and the move settles at 0.50 s (0.35 s on the old 45 m fade).
  it('holding the stall until swallowed: rider in view within 0.55 s of entering, and stays in view', () => {
    const r = rideTube(null);
    expect(r.tubeFrames).toBeGreaterThan(60);
    expect(r.firstVisible).toBeGreaterThanOrEqual(0);
    expect(r.firstVisible).toBeLessThan(0.55);
    expect(r.hiddenAfter).toBe(0);
    expect(r.wet).toBe(0);
  });

  // Released after 0.3 s the rider now climbs out of the barrel (height rule); 0.6 s commits them to a deep ride.
  it('stall in, then let go and ride deep: the rider stays in view', () => {
    const r = rideTube(0.6);
    expect(r.tubeFrames).toBeGreaterThan(180);
    expect(r.firstVisible).toBeLessThan(0.55);
    expect(r.hiddenAfter).toBe(0);
    expect(r.wet).toBe(0);
  });
});

describe('chase framing on the open face (real wave mesh, real surfer)', () => {
  it('riding straight for 10 s: the lip stays ≥ 1.8 m off the board and the chase camera sees the chest ≥ 90% of frames', () => {
    const cfg = structuredClone(SURF_CONFIG);
    const wave = new WaveShape(cfg.wave);
    const surfer = new Surfer(wave, cfg.physics, new EventBus<SurfEvent>());
    const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
    front.updateMatrixWorld();
    const rig = new CameraRig(new PerspectiveCamera(cfg.camera.fov, 16 / 9, 0.1, 650), cfg.camera);
    rig.snap(surfer.state, 'right');
    const s = surfer.state;
    const ray = new Raycaster();
    const from = new Vector3();
    const dir = new Vector3();
    let frames = 0;
    let chestSeen = 0;
    let minClearance = Infinity;
    for (let f = 0; f < 60 * 10; f++) {
      for (let k = 0; k < 2; k++) surfer.step(NO_INPUT, 1 / 120);
      rig.update(s, s.p, 'right', false, 1 / 60);
      expect(s.mode).toBe('riding');
      // Skip the drop-in (0.5 s): the rider starts at x = 4, t 0.55, right under the lip, and dives to the face.
      if (f < 30 || s.p.x <= 1) continue;
      frames++;
      // Clearance: first wave surface straight out along the normal from just above the board.
      from.copy(s.p).addScaledVector(s.normal, 0.05);
      ray.set(from, s.normal);
      ray.far = 10;
      const hit = ray.intersectObject(front, false)[0];
      minClearance = Math.min(minClearance, hit ? hit.distance + 0.05 : Infinity);
      from.copy(s.p).addScaledVector(s.normal, 0.9);
      dir.subVectors(from, rig.pos);
      const dist = dir.length();
      ray.set(rig.pos, dir.normalize());
      ray.far = dist - 0.2;
      if (ray.intersectObject(front, false).length === 0) chestSeen++;
    }
    expect(frames).toBeGreaterThan(450);
    expect(minClearance).toBeGreaterThanOrEqual(1.8);
    expect(chestSeen / frames).toBeGreaterThanOrEqual(0.9);
  });
});
