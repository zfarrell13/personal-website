import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { SURF_CONFIG, type Side } from '../config';
import { EventBus, type SurfEvent } from '../physics/events';
import { carveFromKeys, NO_INPUT, type SurferInput } from '../physics/input';
import { lineBot } from '../physics/lineBot';
import { Surfer } from '../physics/Surfer';
import { buildWaveGeometry, columnsX } from '../render/waveGeometry';
import { frameToView } from '../wave/mirror';
import { WaveShape } from '../wave/WaveShape';
import { CAMERA_FAR, CAMERA_OFFSETS, cameraGoal, CameraRig, shakeAmplitude, shakeOffset } from './CameraRig';

function world() {
  const cfg = structuredClone(SURF_CONFIG);
  const wave = new WaveShape(cfg.wave);
  const surfer = new Surfer(wave, cfg.physics, new EventBus<SurfEvent>());
  return { cfg, wave, surfer, s: surfer.state };
}
const goal = () => ({ pos: new Vector3(), look: new Vector3() });
const C = SURF_CONFIG.camera;
/** Horizontal (xz) unit direction of v. */
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z).normalize();
/** Rider height used for the screen-size check (m, crouched, along the board normal). */
const RIDER_HEIGHT = 1.5;

describe('cameraGoal', () => {
  it('chase: a close bird’s-eye view from behind — behind the rider along their travel, high above the crest, looking down at a point ahead of them', () => {
    const { wave, s } = world(); // canonical frame = a LEFT: the rider travels +x
    s.heading.set(1, 0, 0);
    const g = cameraGoal(s, 'left', 'chase', wave, goal());
    expect(g.pos.x).toBeCloseTo(s.p.x - C.chaseBack, 9);
    expect(g.pos.z).toBeCloseTo(s.p.z, 9);
    expect(g.pos.y).toBeGreaterThanOrEqual(s.p.y + C.chaseHeight - 1e-9);
    expect(g.pos.y).toBeGreaterThanOrEqual(wave.crestY(g.pos.x) + CAMERA_OFFSETS.crestClearance - 1e-9);
    expect(g.pos.y).toBeGreaterThanOrEqual(wave.crestY(s.p.x) + CAMERA_OFFSETS.crestClearance - 1e-9);
    expect(g.look.x).toBeCloseTo(s.p.x + C.chaseAhead, 9);
    expect(g.look.y).toBeLessThan(g.pos.y - 3); // looking down
  });
  it('follows the travel direction, but never further than chaseMaxYaw off down the line (it stays on the curl side)', () => {
    const { wave, s } = world();
    const yaw = 30 * (Math.PI / 180);
    s.heading.set(Math.cos(yaw), -0.3, -Math.sin(yaw)).normalize(); // climbing the face (−z) and down the line
    let g = cameraGoal(s, 'left', 'chase', wave, goal());
    const back = flat(new Vector3().subVectors(s.p, g.pos));
    expect(back.dot(flat(s.heading))).toBeCloseTo(1, 9);
    s.heading.set(-1, 0, 0.2).normalize(); // heading back toward the curl
    g = cameraGoal(s, 'left', 'chase', wave, goal());
    expect(g.pos.x).toBeLessThan(s.p.x);
    const max = C.chaseMaxYaw * (Math.PI / 180);
    expect(flat(new Vector3().subVectors(s.p, g.pos)).x).toBeCloseTo(Math.cos(max), 9);
  });
  it('mirrors exactly for a RIGHT', () => {
    const { wave, s } = world();
    for (const shot of ['chase', 'tube', 'underwater'] as const) {
      const l = cameraGoal(s, 'left', shot, wave, goal());
      const r = cameraGoal(s, 'right', shot, wave, goal());
      expect(r.pos.x).toBeCloseTo(-l.pos.x, 9);
      expect(r.pos.y).toBeCloseTo(l.pos.y, 9);
      expect(r.pos.z).toBeCloseTo(l.pos.z, 9);
      expect(r.look.x).toBeCloseTo(-l.look.x, 9);
    }
  });
  it('tube: inside the barrel behind the rider (off the face along its normal), looking out down the line', () => {
    const { wave, s } = world();
    s.p.set(-2, 0.8, 2);
    s.normal.set(0, 0.3, 1).normalize();
    const g = cameraGoal(s, 'left', 'tube', wave, goal());
    expect(g.pos.x).toBeCloseTo(s.p.x - CAMERA_OFFSETS.tube.back, 9);
    expect(g.pos.z).toBeGreaterThan(s.p.z);
    expect(g.look.x).toBeGreaterThan(s.p.x);
  });
  it('never puts a tube camera behind tubeMinX (the barrel is closed there)', () => {
    const { wave, s } = world();
    s.p.x = -4.5;
    s.heading.set(1, 0, 0);
    expect(cameraGoal(s, 'left', 'tube', wave, goal()).pos.x).toBe(C.tubeMinX);
    expect(cameraGoal(s, 'right', 'tube', wave, goal()).pos.x).toBe(-C.tubeMinX);
    expect(cameraGoal(s, 'left', 'chase', wave, goal()).pos.x).toBeCloseTo(-4.5 - C.chaseBack, 9);
  });
  it('pulls back and up modestly in a trick air', () => {
    const { s } = world();
    const ground = cameraGoal(s, 'left', 'chase', null, goal()).pos.clone().sub(s.p);
    s.mode = 'airborne';
    s.launchKind = 'crest';
    const air = cameraGoal(s, 'left', 'chase', null, goal()).pos.clone().sub(s.p);
    expect(air.length() / ground.length()).toBeGreaterThan(1.2);
    expect(air.length() / ground.length()).toBeLessThan(1.5);
    expect(air.y).toBeGreaterThan(ground.y);
  });
  it('keeps the riding camera in a silent air (launchKind null)', () => {
    const { wave, s } = world();
    const ground = cameraGoal(s, 'left', 'chase', wave, goal()).pos.clone();
    s.mode = 'airborne';
    s.launchKind = null;
    expect(cameraGoal(s, 'left', 'chase', wave, goal()).pos.distanceTo(ground)).toBeCloseTo(0, 9);
  });
});

describe('camera shake', () => {
  it('is full over the impact zone [−D, 0] and fades to nothing 8 m away', () => {
    expect(shakeAmplitude(-2, 5, 0.06)).toBe(0.06);
    expect(shakeAmplitude(4, 5, 0.06)).toBeCloseTo(0.03, 9);
    expect(shakeAmplitude(-9, 5, 0.06)).toBeCloseTo(0.03, 9);
    expect(shakeAmplitude(20, 5, 0.06)).toBe(0);
  });
  it('is deterministic in sim time and bounded by amp·√3', () => {
    const a = shakeOffset(3.21, 0.1, new Vector3());
    expect(shakeOffset(3.21, 0.1, new Vector3()).equals(a)).toBe(true);
    for (let t = 0; t < 5; t += 0.013) expect(shakeOffset(t, 0.1, new Vector3()).length()).toBeLessThanOrEqual(0.1 * Math.sqrt(3) + 1e-9);
    expect(shakeOffset(1, 0, new Vector3()).length()).toBe(0);
  });
});

describe('CameraRig', () => {
  it("carries the rider's own motion without lag (the springs smooth only changes of the shot) and settles on the chase goal", () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    s.heading.set(1, 0, 0);
    rig.snap(s, 'left');
    const offset = rig.pos.clone().sub(s.p);
    s.p.add(new Vector3(-2, 0.3, 1)); // e.g. a stall: the rider slides back toward the curl
    rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.clone().sub(s.p).distanceTo(offset)).toBeLessThan(0.05);
    for (let i = 0; i < 600; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.distanceTo(cameraGoal(s, 'left', 'chase', wave, goal()).pos)).toBeLessThan(0.01);
  });
  it('eases its travel direction: a sudden 40° change of heading does not whip the camera round', () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    s.heading.set(1, 0, 0);
    rig.snap(s, 'left');
    const yaw = 40 * (Math.PI / 180);
    s.heading.set(Math.cos(yaw), 0, Math.sin(yaw));
    for (let i = 0; i < 6; i++) rig.update(s, s.p, 'left', false, 1 / 60); // 0.1 s
    const back = flat(new Vector3().subVectors(s.p, rig.pos));
    expect(Math.acos(back.x) / (Math.PI / 180)).toBeLessThan(10);
    for (let i = 0; i < 300; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    expect(flat(new Vector3().subVectors(s.p, rig.pos)).dot(flat(s.heading))).toBeGreaterThan(0.999);
  });
  it('cuts to the tube view after tubeCutIn s in the barrel and back after tubeCutOut s out of it', () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    rig.snap(s, 'left');
    s.inTube = true;
    s.p.set(-1, 0.6, 2);
    const frames = (sec: number) => {
      for (let i = 0; i < Math.round(sec * 60); i++) rig.update(s, s.p, 'left', false, 1 / 60);
    };
    frames(C.tubeCutIn - 0.05);
    expect(rig.shot).toBe('chase');
    frames(0.1);
    expect(rig.shot).toBe('tube');
    expect(rig.pos.distanceTo(cameraGoal(s, 'left', 'tube', wave, goal()).pos)).toBeLessThan(1e-9); // a cut, not a glide
    s.inTube = false;
    s.p.set(6, 1.2, 2.5); // out on the open face (beyond the pocket)
    frames(C.tubeCutOut + 0.05);
    expect(rig.shot).toBe('chase');
  });
  it("the underwater cut drops the springs' velocity: the next shot eases from rest", () => {
    const { wave, s } = world();
    const rig = new CameraRig(new PerspectiveCamera(), SURF_CONFIG.camera, wave);
    rig.snap(s, 'left');
    s.p.x += 40;
    for (let i = 0; i < 10; i++) rig.update(s, s.p, 'left', false, 1 / 60);
    s.mode = 'wipeout';
    rig.update(s, s.p, 'left', true, 1 / 60);
    const cut = rig.pos.clone();
    s.mode = 'riding';
    s.p.x -= 10;
    rig.update(s, s.p, 'left', false, 1 / 60);
    expect(rig.pos.x).toBeLessThan(cut.x);
  });
  it('extends the far plane past the sky dome (600 m) and sun sprite (500 m)', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    new CameraRig(cam, SURF_CONFIG.camera, new WaveShape(structuredClone(SURF_CONFIG.wave)));
    expect(CAMERA_FAR).toBeGreaterThanOrEqual(650);
    expect(cam.far).toBeGreaterThanOrEqual(650);
  });
});

/**
 * Ride the real surfer against the real wave mesh with the real rig (canonical frame = LEFT) and
 * probe every rendered frame (16:9, e.g. 1280×720): where the camera is, whether it is under the
 * water, whether the rider's chest is on screen with no wave surface in between, and how big the
 * rider is on screen.
 */
function probe(drive: (surfer: Surfer, wave: WaveShape) => (dt: number) => SurferInput, seconds: number) {
  const { cfg, wave, surfer, s } = world();
  const front = new Mesh(buildWaveGeometry(wave, columnsX(cfg.mesh.columns, cfg.wave.xMin, cfg.wave.xMax), cfg.mesh.rows), new MeshBasicMaterial({ side: DoubleSide }));
  front.updateMatrixWorld();
  const aspect = 16 / 9;
  const cam = new PerspectiveCamera(cfg.camera.fov, aspect, 0.1, 650);
  const rig = new CameraRig(cam, cfg.camera, wave);
  rig.snap(s, 'left');
  const input = drive(surfer, wave);
  const ray = new Raycaster();
  const chest = new Vector3();
  const head = new Vector3();
  const feet = new Vector3();
  const dir = new Vector3();
  const ndc = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const r = {
    chase: 0,
    chaseSeen: 0,
    behind: 0,
    behindTravel: 0,
    lookingDownTheLine: 0,
    lookingDown: 0,
    aboveCrest: 0,
    big: 0,
    minSize: Infinity,
    tube: 0,
    tubeSeen: 0,
    frames: 0,
    seen: 0,
    wet: 0,
  };
  for (let f = 0; f < seconds * 60; f++) {
    for (let k = 0; k < 2; k++) surfer.step(input(1 / 120), 1 / 120);
    rig.update(s, s.p, 'left', false, 1 / 60, s.time);
    if (s.mode !== 'riding' && s.mode !== 'airborne') break;
    cam.updateMatrixWorld();
    chest.copy(s.p).addScaledVector(s.normal, 0.9);
    dir.subVectors(chest, cam.position);
    const dist = dir.length();
    ray.set(cam.position, dir.normalize());
    ray.far = dist - 0.2;
    ndc.copy(chest).project(cam);
    const seen = ray.intersectObject(front, false).length === 0 && ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95;
    ray.set(cam.position, UP);
    ray.far = 50;
    const above = ray.intersectObject(front, false)[0];
    if (above && above.face!.normal.y > 0) r.wet++;
    r.frames++;
    if (seen) r.seen++;
    if (rig.shot === 'chase') {
      r.chase++;
      if (seen) r.chaseSeen++;
      if (cam.position.x < s.p.x) r.behind++;
      // camera → rider (horizontal) along the rider's travel (horizontal heading)
      if (flat(dir.subVectors(s.p, cam.position)).dot(flat(s.heading)) > 0.6) r.behindTravel++;
      if (rig.look.x > cam.position.x) r.lookingDownTheLine++;
      if (rig.look.y < cam.position.y) r.lookingDown++;
      if (cam.position.y > wave.crestY(cam.position.x)) r.aboveCrest++;
      // Projected rider height as a fraction of the viewport height.
      feet.copy(s.p).project(cam);
      head.copy(s.p).addScaledVector(s.normal, RIDER_HEIGHT).project(cam);
      const size = Math.hypot((head.x - feet.x) * aspect, head.y - feet.y) / 2;
      r.minSize = Math.min(r.minSize, size);
      if (size >= 0.12) r.big++;
    } else if (rig.shot === 'tube') {
      r.tube++;
      if (seen) r.tubeSeen++;
    }
  }
  return r;
}

describe('CameraRig on the real wave (ray / visibility probes)', () => {
  it('a 30 s S-turn ride: every chase frame is behind the rider, looking down the line and down at them, above the crest; the rider is seen ≥ 90% and big on screen; never under water', () => {
    const r = probe((surfer, wave) => lineBot(surfer, wave, { pumpEvery: 1 }), 30);
    expect(r.chase).toBeGreaterThan(1500);
    expect(r.behind).toBe(r.chase);
    expect(r.behindTravel / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.lookingDownTheLine).toBe(r.chase);
    expect(r.lookingDown).toBe(r.chase);
    expect(r.aboveCrest).toBe(r.chase);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.big / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.wet).toBe(0);
  });
  it('no input until swallowed: chase then tube view, rider seen ≥ 90% of chase frames and ≥ 90% overall, never under water', () => {
    const r = probe(() => () => NO_INPUT, 10);
    expect(r.tube).toBeGreaterThan(0);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.seen / r.frames).toBeGreaterThanOrEqual(0.9);
    expect(r.big / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.wet).toBe(0);
  });
  it('a barrel (stall while carving, release as the curl arrives, pump out): the tube view and the chase each see the rider ≥ 90%, never under water', () => {
    const r = probe((surfer, wave) => {
      const warmUp = lineBot(surfer, wave, { pumpEvery: 1 });
      const stallLine = lineBot(surfer, wave, { pumpEvery: 0 });
      const pumpOut = lineBot(surfer, wave, { pumpEvery: 0.6 });
      let released = false;
      return (dt) => {
        const st = surfer.state;
        if (st.time >= 6 && st.param.x <= 3) released = true;
        return st.time < 6 ? warmUp(dt) : released ? pumpOut(dt) : { ...stallLine(dt), stall: true };
      };
    }, 16);
    expect(r.tube).toBeGreaterThan(60);
    expect(r.tubeSeen / r.tube).toBeGreaterThanOrEqual(0.9);
    expect(r.chaseSeen / r.chase).toBeGreaterThanOrEqual(0.9);
    expect(r.behindTravel / r.chase).toBeGreaterThanOrEqual(0.95);
    expect(r.wet).toBe(0);
  });
});

describe('screen-relative carving matches the camera', () => {
  it.each(['left', 'right'] as const)('on a %s, the → key (carve +1 = toward the lip) is the side of the screen the lip is on', (side: Side) => {
    const { wave, surfer, s } = world();
    const bot = lineBot(surfer, wave, { pumpEvery: 1 });
    for (let i = 0; i < 3 * 120; i++) surfer.step(bot(1 / 120), 1 / 120);
    const cam = new PerspectiveCamera(SURF_CONFIG.camera.fov, 16 / 9, 0.1, 650);
    const rig = new CameraRig(cam, SURF_CONFIG.camera, wave);
    rig.snap(s, side);
    cam.updateMatrixWorld();
    // Up the face at the rider = toward the lip: the surface point a little higher in t.
    const lip = wave.profile(s.param.x, Math.min(1, s.param.t + 0.05));
    const riderScreen = frameToView(s.p, side, new Vector3()).project(cam).x;
    const lipScreen = frameToView(lip, side, new Vector3()).project(cam).x;
    const lipOnRight = lipScreen > riderScreen;
    expect(carveFromKeys(false, true, side) === 1).toBe(lipOnRight);
  });
});
